var EventEmitter, RedisWorker, TestWorker, Worker, async, chai, cleanWorker, concurrency1Worker, concurrency2Worker, createWorker, expect, fakeredis, redis, sinon, waitUntil, _,
  __hasProp = {}.hasOwnProperty,
  __extends = function(child, parent) { for (var key in parent) { if (__hasProp.call(parent, key)) child[key] = parent[key]; } function ctor() { this.constructor = child; } ctor.prototype = parent.prototype; child.prototype = new ctor(); child.__super__ = parent.prototype; return child; },
  __indexOf = [].indexOf || function(item) { for (var i = 0, l = this.length; i < l; i++) { if (i in this && this[i] === item) return i; } return -1; };

_ = require('lodash');

async = require('async');

redis = require('redis');

fakeredis = require('fakeredis');

chai = require('chai');

expect = require('chai').expect;

sinon = require('sinon');

RedisWorker = require('../lib/index.js');

Worker = RedisWorker.Worker;

EventEmitter = require('events').EventEmitter;

TestWorker = (function(_super) {
  __extends(TestWorker, _super);

  function TestWorker(url, taskLimit) {
    this.url = url;
    this.taskLimit = taskLimit;
    TestWorker.__super__.constructor.apply(this, arguments);
    this.emitter = new EventEmitter();
    this.reset();
  }

  TestWorker.prototype.name = function() {
    return "Test" + this.workerID;
  };

  TestWorker.prototype.reset = function() {
    this.pendingTasks = [];
    this.runningTasks = [];
    this.doneTasks = [];
    this.failedTasks = [];
    this.tasksCallbacks = {};
    return this.maxRunningAtOnce = 0;
  };

  TestWorker.prototype.errorTask = function(id) {
    expect(this.runningTasks).to.contain(id);
    expect(this.doneTasks).to.not.contain(id);
    expect(this.failedTasks).to.not.contain(id);
    this.failedTasks.push(id);
    this.runningTasks = _.reject(this.runningTasks, function(runningItemID) {
      return runningItemID === id;
    });
    this.emitter.emit('failed', id);
    return this.tasksCallbacks[id](new Error("error"));
  };

  TestWorker.prototype.finishSomeTask = function() {
    return this.finishTask(this.runningTasks[0]);
  };

  TestWorker.prototype.finishTask = function(id) {
    expect(this.runningTasks).to.contain(id);
    expect(this.doneTasks).to.not.contain(id);
    expect(this.failedTasks).to.not.contain(id);
    this.doneTasks.push(id);
    this.runningTasks = _.reject(this.runningTasks, function(runningItemID) {
      return runningItemID === id;
    });
    this.emitter.emit('done', id);
    return this.tasksCallbacks[id]();
  };

  TestWorker.prototype.pushJob = function(payload, cb) {
    TestWorker.__super__.pushJob.apply(this, arguments);
    return this.pendingTasks.push(payload.id);
  };

  TestWorker.prototype.work = function(payload, done) {
    var id;
    payload = JSON.parse(payload);
    id = payload.id;
    this.tasksCallbacks[id] = done;
    this.runningTasks.push(id);
    this.pendingTasks = _.reject(this.pendingTasks, function(pendingItemID) {
      return pendingItemID === id;
    });
    this.emitter.emit('running', id);
    return this.maxRunningAtOnce = Math.max(this.maxRunningAtOnce, this.runningTasks.length);
  };

  return TestWorker;

})(Worker);

createWorker = function(workerID, taskLimit) {
  var worker;
  worker = new TestWorker("redis://localhost:6379/32", taskLimit);
  worker.workerID = workerID;
  return worker;
};

cleanWorker = function(worker, callback) {
  worker.reset();
  return worker.obtainListClient(function(err, client) {
    if (err) {
      return callback(err);
    }
    return async.parallel([
      function(next) {
        return client.del(worker.listKey(), next);
      }, function(next) {
        return client.del(worker.channelKey(), next);
      }
    ], callback);
  });
};

concurrency1Worker = null;

concurrency2Worker = null;

before(function(done) {
  sinon.stub(redis, 'createClient', fakeredis.createClient);
  concurrency1Worker = createWorker("concurrency1Worker", 1);
  concurrency2Worker = createWorker("concurrency2Worker", 2);
  return async.each([concurrency1Worker, concurrency2Worker], function(worker, next) {
    return async.series([
      function(innerNext) {
        return worker.waitForTasks(innerNext);
      }
    ], next);
  }, done);
});

after(function(done) {
  concurrency2Worker = null;
  concurrency1Worker = null;
  redis.createClient.restore();
  return done();
});

beforeEach(function(done) {
  return async.each([concurrency1Worker, concurrency2Worker], cleanWorker, done);
});

waitUntil = function(testFunc, callback) {
  if (testFunc()) {
    return callback();
  } else {
    return setTimeout(function() {
      return waitUntil(testFunc, callback);
    }, 100);
  }
};

Math.mean = function(array) {
  return (_.reduce(array, function(a, b) {
    return a + b;
  })) / array.length;
};

Math.stDev = function(array) {
  var dev, mean;
  mean = Math.mean(array);
  dev = _.map(array, function(itm) {
    return (itm - mean) * (itm - mean);
  });
  return Math.sqrt(Math.mean(dev));
};

describe('redis-worker tests', function() {
  describe('normal tests', function() {
    it('should queue up a job and do it', function(done) {
      return async.series([
        function(next) {
          return concurrency1Worker.pushJob({
            id: "1"
          }, next);
        }, function(next) {
          return waitUntil(function() {
            return __indexOf.call(concurrency1Worker.runningTasks, "1") >= 0;
          }, next);
        }, function(next) {
          concurrency1Worker.finishTask("1");
          return waitUntil(function() {
            return __indexOf.call(concurrency1Worker.doneTasks, "1") >= 0;
          }, next);
        }
      ], function(err) {
        expect(concurrency1Worker.doneTasks).to.contain("1");
        return done(err);
      });
    });
    return it('should queue up a job and do it in order', function(done) {
      return async.series([
        function(next) {
          return concurrency1Worker.pushJob({
            id: "1"
          }, next);
        }, function(next) {
          return concurrency1Worker.pushJob({
            id: "2"
          }, next);
        }, function(next) {
          return waitUntil(function() {
            return __indexOf.call(concurrency1Worker.runningTasks, "1") >= 0;
          }, next);
        }, function(next) {
          concurrency1Worker.finishSomeTask();
          return waitUntil(function() {
            return __indexOf.call(concurrency1Worker.runningTasks, "2") >= 0;
          }, next);
        }, function(next) {
          concurrency1Worker.finishSomeTask();
          return waitUntil(function() {
            return __indexOf.call(concurrency1Worker.doneTasks, "2") >= 0;
          }, next);
        }
      ], function(err) {
        expect(concurrency1Worker.doneTasks).to.contain("1");
        expect(concurrency1Worker.doneTasks).to.contain("2");
        expect(concurrency1Worker.maxRunningAtOnce).to.equal(1);
        return done(err);
      });
    });
  });
  return describe('concurrency tests', function() {
    it('should run up to <taskLimit> jobs at once', function(done) {
      var autofinishJobIn50ms, tasksNumber, worker;
      worker = concurrency2Worker;
      tasksNumber = 20;
      autofinishJobIn50ms = function(id) {
        return setTimeout(function() {
          return worker.finishTask(id);
        }, 50);
      };
      worker.emitter.on('running', autofinishJobIn50ms);
      return async.series([
        function(next) {
          var _i, _results;
          return async.each((function() {
            _results = [];
            for (var _i = 1; 1 <= tasksNumber ? _i <= tasksNumber : _i >= tasksNumber; 1 <= tasksNumber ? _i++ : _i--){ _results.push(_i); }
            return _results;
          }).apply(this), function(id, innerNext) {
            return worker.pushJob({
              id: id
            }, innerNext);
          }, next);
        }, function(next) {
          return waitUntil(function() {
            return worker.pendingTasks.length === 0;
          }, next);
        }, function(next) {
          return waitUntil(function() {
            return worker.doneTasks.length === tasksNumber;
          }, next);
        }
      ], function(err) {
        expect(worker.maxRunningAtOnce).to.equal(worker.taskLimit);
        worker.emitter.removeListener('running', autofinishJobIn50ms);
        return done(err);
      });
    });
    it('should not starve other queues if running side by side', function(done) {
      var concurrency, tasksNumber, workers, workersCount, _i, _results;
      tasksNumber = 2000;
      concurrency = 20;
      workersCount = 5;
      workers = [];
      return async.map((function() {
        _results = [];
        for (var _i = 1; 1 <= workersCount ? _i <= workersCount : _i >= workersCount; 1 <= workersCount ? _i++ : _i--){ _results.push(_i); }
        return _results;
      }).apply(this), function(idx, next) {
        var worker;
        worker = createWorker("same_id", concurrency);
        return cleanWorker(worker, function(err) {
          if (err) {
            return next(err);
          }
          return worker.waitForTasks(function(err) {
            return next(err, worker);
          });
        });
      }, function(err, workers) {
        var autofinishJobIn50msFactory, countAllDoneTasks, worker, _j, _len;
        autofinishJobIn50msFactory = function(worker) {
          return function(id) {
            return setTimeout(function() {
              return worker.finishTask(id);
            }, 80 + Math.random() * 40);
          };
        };
        for (_j = 0, _len = workers.length; _j < _len; _j++) {
          worker = workers[_j];
          worker.autofinishJobIn50ms = autofinishJobIn50msFactory(worker);
          worker.emitter.on('running', worker.autofinishJobIn50ms);
        }
        countAllDoneTasks = function() {
          return _.reduce(workers, (function(sum, worker) {
            return sum + worker.doneTasks.length;
          }), 0);
        };
        return async.series([
          function(next) {
            var _k, _results1;
            return async.each((function() {
              _results1 = [];
              for (var _k = 1; 1 <= tasksNumber ? _k <= tasksNumber : _k >= tasksNumber; 1 <= tasksNumber ? _k++ : _k--){ _results1.push(_k); }
              return _results1;
            }).apply(this), function(id, innerNext) {
              return workers[0].pushJob({
                id: "A" + id
              }, innerNext);
            }, next);
          }, function(next) {
            return waitUntil(function() {
              return countAllDoneTasks() === tasksNumber;
            }, next);
          }
        ], function(err) {
          var doneTasks, _k, _len1;
          for (_k = 0, _len1 = workers.length; _k < _len1; _k++) {
            worker = workers[_k];
            worker.emitter.removeListener('running', worker.autofinishJobIn50ms);
          }
          doneTasks = _.map(workers, function(worker) {
            return worker.doneTasks.length;
          });
          expect(Math.stDev(doneTasks)).to.be.below(tasksNumber / 100.0);
          return done(err);
        });
      });
    });
    it('should not starve other queues if starting with pushed tasks', function(done) {
      var concurrency, tasksNumber, workers, workersCount, _i, _results;
      tasksNumber = 400;
      concurrency = 20;
      workersCount = 5;
      workers = [];
      return async.map((function() {
        _results = [];
        for (var _i = 1; 1 <= workersCount ? _i <= workersCount : _i >= workersCount; 1 <= workersCount ? _i++ : _i--){ _results.push(_i); }
        return _results;
      }).apply(this), function(idx, next) {
        var worker;
        worker = createWorker("same_id2", concurrency);
        return cleanWorker(worker, function(err) {
          return next(err, worker);
        });
      }, function(err, workers) {
        var autofinishJobIn50msFactory, countAllDoneTasks, worker, _j, _len;
        autofinishJobIn50msFactory = function(worker) {
          return function(id) {
            return setTimeout(function() {
              return worker.finishTask(id);
            }, 80 + Math.random() * 40);
          };
        };
        for (_j = 0, _len = workers.length; _j < _len; _j++) {
          worker = workers[_j];
          worker.autofinishJobIn50ms = autofinishJobIn50msFactory(worker);
          worker.emitter.on('running', worker.autofinishJobIn50ms);
        }
        countAllDoneTasks = function() {
          return _.reduce(workers, (function(sum, worker) {
            return sum + worker.doneTasks.length;
          }), 0);
        };
        return async.series([
          function(next) {
            var _k, _results1;
            return async.each((function() {
              _results1 = [];
              for (var _k = 1; 1 <= tasksNumber ? _k <= tasksNumber : _k >= tasksNumber; 1 <= tasksNumber ? _k++ : _k--){ _results1.push(_k); }
              return _results1;
            }).apply(this), function(id, innerNext) {
              return workers[0].pushJob({
                id: "B" + id
              }, innerNext);
            }, next);
          }, function(next) {
            return async.eachSeries(workers, function(worker, innerNext) {
              return worker.waitForTasks(innerNext);
            }, next);
          }, function(next) {
            return waitUntil(function() {
              return countAllDoneTasks() === tasksNumber;
            }, next);
          }
        ], function(err) {
          var doneTasks, _k, _len1;
          for (_k = 0, _len1 = workers.length; _k < _len1; _k++) {
            worker = workers[_k];
            worker.emitter.removeListener('running', worker.autofinishJobIn50ms);
          }
          doneTasks = _.map(workers, function(worker) {
            return worker.doneTasks.length;
          });
          expect(Math.stDev(doneTasks)).to.be.below(tasksNumber / 100.0);
          return done(err);
        });
      });
    });
    it('should use all concurrency slots at all times', function(done) {
      var concurrency, tasksNumber, workers, workersCount, _i, _results;
      tasksNumber = 2000;
      concurrency = 10;
      workersCount = 5;
      workers = [];
      return async.map((function() {
        _results = [];
        for (var _i = 1; 1 <= workersCount ? _i <= workersCount : _i >= workersCount; 1 <= workersCount ? _i++ : _i--){ _results.push(_i); }
        return _results;
      }).apply(this), function(idx, next) {
        var worker;
        worker = createWorker("same_id3", concurrency);
        return cleanWorker(worker, function(err) {
          return next(err, worker);
        });
      }, function(err, workers) {
        var autofinishJobIn50msFactory, countAllDoneTasks, profilerTimerJob, summarizeAllRunningTasks, worker, workersRunningTasksProfile, _j, _len;
        autofinishJobIn50msFactory = function(worker) {
          return function(id) {
            return setTimeout(function() {
              return worker.finishTask(id);
            }, 40 + Math.random() * 40);
          };
        };
        for (_j = 0, _len = workers.length; _j < _len; _j++) {
          worker = workers[_j];
          worker.autofinishJobIn50ms = autofinishJobIn50msFactory(worker);
          worker.emitter.on('running', worker.autofinishJobIn50ms);
        }
        countAllDoneTasks = function() {
          return _.reduce(workers, (function(sum, worker) {
            return sum + worker.doneTasks.length;
          }), 0);
        };
        summarizeAllRunningTasks = function() {
          return _.map(workers, function(worker) {
            return worker.runningTasks.length;
          });
        };
        workersRunningTasksProfile = [];
        profilerTimerJob = setInterval(function() {
          return workersRunningTasksProfile.push(summarizeAllRunningTasks());
        }, 10);
        return async.series([
          function(next) {
            var _k, _results1;
            return async.each((function() {
              _results1 = [];
              for (var _k = 1; 1 <= tasksNumber ? _k <= tasksNumber : _k >= tasksNumber; 1 <= tasksNumber ? _k++ : _k--){ _results1.push(_k); }
              return _results1;
            }).apply(this), function(id, innerNext) {
              return workers[0].pushJob({
                id: "B" + id
              }, innerNext);
            }, next);
          }, function(next) {
            return async.each(workers, function(worker, innerNext) {
              return worker.waitForTasks(innerNext);
            }, next);
          }, function(next) {
            return waitUntil(function() {
              return countAllDoneTasks() === tasksNumber;
            }, next);
          }
        ], function(err) {
          var runningTasksMeanPerWorker, runningTasksStDevPerWorker, workerIdx, workerRunningTasksProfile, workerRunningTasksProfileOnlyMidPoints, _k, _l, _len1, _ref;
          for (_k = 0, _len1 = workers.length; _k < _len1; _k++) {
            worker = workers[_k];
            worker.emitter.removeListener('running', worker.autofinishJobIn50ms);
          }
          clearInterval(profilerTimerJob);
          runningTasksMeanPerWorker = [];
          runningTasksStDevPerWorker = [];
          for (workerIdx = _l = 0, _ref = workers.length; 0 <= _ref ? _l < _ref : _l > _ref; workerIdx = 0 <= _ref ? ++_l : --_l) {
            workerRunningTasksProfile = _.map(workersRunningTasksProfile, function(runningTasksProfile) {
              return runningTasksProfile[workerIdx];
            });
            workerRunningTasksProfileOnlyMidPoints = workerRunningTasksProfile.slice(10, -19);
            runningTasksMeanPerWorker.push(Math.mean(workerRunningTasksProfileOnlyMidPoints));
            runningTasksStDevPerWorker.push(Math.stDev(workerRunningTasksProfileOnlyMidPoints));
          }
          expect(_.min(runningTasksMeanPerWorker)).to.be.above(concurrency * 0.9);
          expect(_.max(runningTasksStDevPerWorker)).to.be.below(concurrency * 0.1);
          return done(err);
        });
      });
    });
    return it('should not use redis more than necessary', function(done) {
      var concurrency, tasksNumberPerWorker, workers, workersCount, _i, _results;
      tasksNumberPerWorker = 200;
      concurrency = 5;
      workersCount = 3;
      workers = [];
      return async.map((function() {
        _results = [];
        for (var _i = 1; 1 <= workersCount ? _i <= workersCount : _i >= workersCount; 1 <= workersCount ? _i++ : _i--){ _results.push(_i); }
        return _results;
      }).apply(this), function(idx, next) {
        var worker;
        worker = createWorker("test1_worker" + idx, concurrency);
        sinon.spy(worker, 'popJobFromQueue');
        return cleanWorker(worker, function(err) {
          if (err) {
            return next(err);
          }
          return worker.waitForTasks(function(err) {
            return next(err, worker);
          });
        });
      }, function(err, workers) {
        var autofinishJobIn50msFactory, countAllDoneTasks, worker, _j, _len;
        autofinishJobIn50msFactory = function(worker) {
          return function(id) {
            return setTimeout(function() {
              return worker.finishTask(id);
            }, 40 + Math.random() * 40);
          };
        };
        for (_j = 0, _len = workers.length; _j < _len; _j++) {
          worker = workers[_j];
          worker.autofinishJobIn50ms = autofinishJobIn50msFactory(worker);
          worker.emitter.on('running', worker.autofinishJobIn50ms);
        }
        countAllDoneTasks = function() {
          return _.reduce(workers, (function(sum, worker) {
            return sum + worker.doneTasks.length;
          }), 0);
        };
        return async.series([
          function(next) {
            return async.each(workers, function(worker, innerNext) {
              var _k, _results1;
              return async.each((function() {
                _results1 = [];
                for (var _k = 1; 1 <= tasksNumberPerWorker ? _k <= tasksNumberPerWorker : _k >= tasksNumberPerWorker; 1 <= tasksNumberPerWorker ? _k++ : _k--){ _results1.push(_k); }
                return _results1;
              }).apply(this), function(id, innerInnerNext) {
                return worker.pushJob({
                  id: "A" + id
                }, innerInnerNext);
              }, innerNext);
            }, next);
          }, function(next) {
            return waitUntil(function() {
              return countAllDoneTasks() === tasksNumberPerWorker * workersCount;
            }, next);
          }, function(next) {
            var _k, _l, _results1, _results2;
            async.each((function() {
              _results1 = [];
              for (var _k = 1; 1 <= tasksNumberPerWorker ? _k <= tasksNumberPerWorker : _k >= tasksNumberPerWorker; 1 <= tasksNumberPerWorker ? _k++ : _k--){ _results1.push(_k); }
              return _results1;
            }).apply(this), function(id, innerNext) {
              return workers[0].pushJob({
                id: "B" + id
              }, innerNext);
            }, next);
            return async.each((function() {
              _results2 = [];
              for (var _l = 1; 1 <= tasksNumberPerWorker ? _l <= tasksNumberPerWorker : _l >= tasksNumberPerWorker; 1 <= tasksNumberPerWorker ? _l++ : _l--){ _results2.push(_l); }
              return _results2;
            }).apply(this), function(id, innerNext) {
              return workers[1].pushJob({
                id: "B" + id
              }, innerNext);
            }, next);
          }, function(next) {
            return waitUntil(function() {
              return workers[0].doneTasks.length === 2 * tasksNumberPerWorker && workers[1].doneTasks.length === 2 * tasksNumberPerWorker;
            }, next);
          }, function(next) {
            var _k, _results1;
            return async.each((function() {
              _results1 = [];
              for (var _k = 1; 1 <= tasksNumberPerWorker ? _k <= tasksNumberPerWorker : _k >= tasksNumberPerWorker; 1 <= tasksNumberPerWorker ? _k++ : _k--){ _results1.push(_k); }
              return _results1;
            }).apply(this), function(id, innerNext) {
              return workers[2].pushJob({
                id: "C" + id
              }, innerNext);
            }, next);
          }, function(next) {
            return waitUntil(function() {
              return workers[2].doneTasks.length === 2 * tasksNumberPerWorker;
            }, next);
          }
        ], function(err) {
          var _k, _len1;
          for (_k = 0, _len1 = workers.length; _k < _len1; _k++) {
            worker = workers[_k];
            expect(worker.popJobFromQueue.callCount).to.be.below(worker.doneTasks.length * 1.2);
            worker.emitter.removeListener('running', worker.autofinishJobIn50ms);
            worker.popJobFromQueue.restore();
          }
          return done(err);
        });
      });
    });
  });
});

//# sourceMappingURL=data:application/json;base64,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QjtBQUFBLGdCQUFFLEVBQUEsRUFBSyxHQUFBLEdBQUcsRUFBVjtlQUFuQixFQUFxQyxTQUFyQyxFQURvQztZQUFBLENBQXRDLEVBRUUsSUFGRixFQUZGO1VBQUEsQ0EzQlcsRUFnQ1gsU0FBQyxJQUFELEdBQUE7bUJBRUUsU0FBQSxDQUFVLFNBQUEsR0FBQTtxQkFDUixPQUFRLENBQUEsQ0FBQSxDQUFFLENBQUMsU0FBUyxDQUFDLE1BQXJCLEtBQStCLENBQUEsR0FBSSxxQkFEM0I7WUFBQSxDQUFWLEVBRUUsSUFGRixFQUZGO1VBQUEsQ0FoQ1c7U0FBYixFQXFDRyxTQUFDLEdBQUQsR0FBQTtBQUVELGNBQUEsU0FBQTtBQUFBLGVBQUEsZ0RBQUE7aUNBQUE7QUFFRSxZQUFBLE1BQUEsQ0FBTyxNQUFNLENBQUMsZUFBZSxDQUFDLFNBQTlCLENBQXdDLENBQUMsRUFBRSxDQUFDLEVBQUUsQ0FBQyxLQUEvQyxDQUFxRCxNQUFNLENBQUMsU0FBUyxDQUFDLE1BQWpCLEdBQTBCLEdBQS9FLENBQUEsQ0FBQTtBQUFBLFlBRUEsTUFBTSxDQUFDLE9BQU8sQ0FBQyxjQUFmLENBQThCLFNBQTlCLEVBQXlDLE1BQU0sQ0FBQyxtQkFBaEQsQ0FGQSxDQUFBO0FBQUEsWUFHQSxNQUFNLENBQUMsZUFBZSxDQUFDLE9BQXZCLENBQUEsQ0FIQSxDQUZGO0FBQUEsV0FBQTtpQkFPQSxJQUFBLENBQUssR0FBTCxFQVRDO1FBQUEsQ0FyQ0gsRUFiQTtNQUFBLENBWkYsRUFONkM7SUFBQSxDQUEvQyxFQXJMNEI7RUFBQSxDQUE5QixFQTdDNkI7QUFBQSxDQUEvQixDQXpJQSxDQUFBIiwiZmlsZSI6InRlc3Qvd29ya2VyLmpzIiwic291cmNlUm9vdCI6Ii9zb3VyY2UvIiwic291cmNlc0NvbnRlbnQiOlsiXyAgICAgICAgID0gcmVxdWlyZSgnbG9kYXNoJylcblxuYXN5bmMgICAgID0gcmVxdWlyZSgnYXN5bmMnKVxucmVkaXMgICAgID0gcmVxdWlyZSgncmVkaXMnKVxuZmFrZXJlZGlzID0gcmVxdWlyZSgnZmFrZXJlZGlzJylcbmNoYWkgICAgICA9IHJlcXVpcmUoJ2NoYWknKVxuZXhwZWN0ICAgID0gcmVxdWlyZSgnY2hhaScpLmV4cGVjdFxuc2lub24gICAgID0gcmVxdWlyZSgnc2lub24nKVxuXG5SZWRpc1dvcmtlciA9IHJlcXVpcmUoJy4uL2xpYi9pbmRleC5qcycpXG5Xb3JrZXIgICAgICA9IFJlZGlzV29ya2VyLldvcmtlclxuXG5FdmVudEVtaXR0ZXIgPSByZXF1aXJlKCdldmVudHMnKS5FdmVudEVtaXR0ZXJcblxuY2xhc3MgVGVzdFdvcmtlciBleHRlbmRzIFdvcmtlclxuICBjb25zdHJ1Y3RvcjogKEB1cmwsIEB0YXNrTGltaXQpIC0+XG4gICAgc3VwZXJcblxuICAgIEBlbWl0dGVyICAgICAgICA9IG5ldyBFdmVudEVtaXR0ZXIoKVxuICAgIEByZXNldCgpXG5cbiAgbmFtZTogKCkgLT4gXCJUZXN0I3tAd29ya2VySUR9XCJcblxuICByZXNldDogKCkgLT5cbiAgICBAcGVuZGluZ1Rhc2tzICAgPSBbXVxuICAgIEBydW5uaW5nVGFza3MgICA9IFtdXG4gICAgQGRvbmVUYXNrcyAgICAgID0gW11cbiAgICBAZmFpbGVkVGFza3MgICAgPSBbXVxuICAgIEB0YXNrc0NhbGxiYWNrcyA9IHt9XG5cbiAgICBAbWF4UnVubmluZ0F0T25jZSA9IDBcblxuICBlcnJvclRhc2s6IChpZCkgLT5cbiAgICBleHBlY3QoQHJ1bm5pbmdUYXNrcykudG8uY29udGFpbiBpZFxuICAgIGV4cGVjdChAZG9uZVRhc2tzKS50by5ub3QuY29udGFpbiBpZFxuICAgIGV4cGVjdChAZmFpbGVkVGFza3MpLnRvLm5vdC5jb250YWluIGlkXG5cbiAgICBAZmFpbGVkVGFza3MucHVzaCBpZFxuICAgIEBydW5uaW5nVGFza3MgPSBfLnJlamVjdCBAcnVubmluZ1Rhc2tzLCAocnVubmluZ0l0ZW1JRCkgLT4gcnVubmluZ0l0ZW1JRCA9PSBpZFxuXG4gICAgQGVtaXR0ZXIuZW1pdCAnZmFpbGVkJywgaWRcblxuICAgIEB0YXNrc0NhbGxiYWNrc1tpZF0gbmV3IEVycm9yKFwiZXJyb3JcIilcblxuICBmaW5pc2hTb21lVGFzazogKCkgLT5cbiAgICBAZmluaXNoVGFzayBAcnVubmluZ1Rhc2tzWzBdXG5cbiAgZmluaXNoVGFzazogKGlkKSAtPlxuICAgIGV4cGVjdChAcnVubmluZ1Rhc2tzKS50by5jb250YWluIGlkXG4gICAgZXhwZWN0KEBkb25lVGFza3MpLnRvLm5vdC5jb250YWluIGlkXG4gICAgZXhwZWN0KEBmYWlsZWRUYXNrcykudG8ubm90LmNvbnRhaW4gaWRcblxuICAgIEBkb25lVGFza3MucHVzaCBpZFxuICAgIEBydW5uaW5nVGFza3MgPSBfLnJlamVjdCBAcnVubmluZ1Rhc2tzLCAocnVubmluZ0l0ZW1JRCkgLT4gcnVubmluZ0l0ZW1JRCA9PSBpZFxuXG4gICAgQGVtaXR0ZXIuZW1pdCAnZG9uZScsIGlkXG5cbiAgICBAdGFza3NDYWxsYmFja3NbaWRdKClcblxuICBwdXNoSm9iOiAocGF5bG9hZCwgY2IpIC0+XG4gICAgc3VwZXJcbiAgICBAcGVuZGluZ1Rhc2tzLnB1c2ggcGF5bG9hZC5pZFxuXG4gIHdvcms6IChwYXlsb2FkLCBkb25lKSAtPlxuICAgIHBheWxvYWQgPSBKU09OLnBhcnNlKHBheWxvYWQpXG5cbiAgICBpZCA9IHBheWxvYWQuaWRcblxuICAgIEB0YXNrc0NhbGxiYWNrc1tpZF0gPSBkb25lXG5cbiAgICBAcnVubmluZ1Rhc2tzLnB1c2ggaWRcbiAgICBAcGVuZGluZ1Rhc2tzID0gXy5yZWplY3QgQHBlbmRpbmdUYXNrcywgKHBlbmRpbmdJdGVtSUQpIC0+IHBlbmRpbmdJdGVtSUQgPT0gaWRcblxuICAgIEBlbWl0dGVyLmVtaXQgJ3J1bm5pbmcnLCBpZFxuXG4gICAgQG1heFJ1bm5pbmdBdE9uY2UgPSBNYXRoLm1heChAbWF4UnVubmluZ0F0T25jZSwgQHJ1bm5pbmdUYXNrcy5sZW5ndGgpXG5cbmNyZWF0ZVdvcmtlciA9ICh3b3JrZXJJRCwgdGFza0xpbWl0KSAtPlxuICB3b3JrZXIgPSBuZXcgVGVzdFdvcmtlciBcInJlZGlzOi8vbG9jYWxob3N0OjYzNzkvMzJcIiwgdGFza0xpbWl0XG4gIHdvcmtlci53b3JrZXJJRCA9IHdvcmtlcklEXG5cbiAgd29ya2VyXG5cbmNsZWFuV29ya2VyID0gKHdvcmtlciwgY2FsbGJhY2spIC0+XG4gIHdvcmtlci5yZXNldCgpXG4gIHdvcmtlci5vYnRhaW5MaXN0Q2xpZW50IChlcnIsIGNsaWVudCkgLT5cbiAgICByZXR1cm4gY2FsbGJhY2sgZXJyIGlmIGVyclxuXG4gICAgYXN5bmMucGFyYWxsZWwgW1xuICAgICAgKG5leHQpIC0+IGNsaWVudC5kZWwgd29ya2VyLmxpc3RLZXkoKSwgbmV4dCxcbiAgICAgIChuZXh0KSAtPiBjbGllbnQuZGVsIHdvcmtlci5jaGFubmVsS2V5KCksIG5leHRcbiAgICBdLCBjYWxsYmFja1xuXG5cbmNvbmN1cnJlbmN5MVdvcmtlciA9IG51bGxcbmNvbmN1cnJlbmN5MldvcmtlciA9IG51bGxcbmJlZm9yZSAoZG9uZSkgLT5cbiAgc2lub24uc3R1YihyZWRpcywgJ2NyZWF0ZUNsaWVudCcsIGZha2VyZWRpcy5jcmVhdGVDbGllbnQpXG5cbiAgY29uY3VycmVuY3kxV29ya2VyID0gY3JlYXRlV29ya2VyKFwiY29uY3VycmVuY3kxV29ya2VyXCIsIDEpXG4gIGNvbmN1cnJlbmN5MldvcmtlciA9IGNyZWF0ZVdvcmtlcihcImNvbmN1cnJlbmN5MldvcmtlclwiLCAyKVxuXG4gIGFzeW5jLmVhY2ggW2NvbmN1cnJlbmN5MVdvcmtlciwgY29uY3VycmVuY3kyV29ya2VyXVxuICAsICh3b3JrZXIsIG5leHQpIC0+XG4gICAgYXN5bmMuc2VyaWVzIFtcbiAgICAgIChpbm5lck5leHQpIC0+IHdvcmtlci53YWl0Rm9yVGFza3MgaW5uZXJOZXh0XG4gICAgXSwgbmV4dFxuICAsIGRvbmVcblxuYWZ0ZXIgKGRvbmUpIC0+XG4gIGNvbmN1cnJlbmN5MldvcmtlciA9IG51bGxcbiAgY29uY3VycmVuY3kxV29ya2VyID0gbnVsbFxuXG4gIHJlZGlzLmNyZWF0ZUNsaWVudC5yZXN0b3JlKClcblxuICBkb25lKClcblxuYmVmb3JlRWFjaCAoZG9uZSkgLT5cbiAgYXN5bmMuZWFjaCBbY29uY3VycmVuY3kxV29ya2VyLCBjb25jdXJyZW5jeTJXb3JrZXJdLCBjbGVhbldvcmtlciwgZG9uZVxuXG4jIEhlbHBlcnNcbndhaXRVbnRpbCA9ICh0ZXN0RnVuYywgY2FsbGJhY2spIC0+XG4gIGlmIHRlc3RGdW5jKClcbiAgICBjYWxsYmFjaygpXG4gIGVsc2VcbiAgICBzZXRUaW1lb3V0ICgpIC0+XG4gICAgICB3YWl0VW50aWwodGVzdEZ1bmMsIGNhbGxiYWNrKVxuICAgICwgMTAwXG5cbk1hdGgubWVhbiA9IChhcnJheSkgLT4gKF8ucmVkdWNlIGFycmF5LCAoYSwgYikgLT4gYStiKSAvIGFycmF5Lmxlbmd0aFxuXG5NYXRoLnN0RGV2ID0gKGFycmF5KSAtPlxuICAgIG1lYW4gPSBNYXRoLm1lYW4gYXJyYXlcbiAgICBkZXYgID0gXy5tYXAgYXJyYXksIChpdG0pIC0+IChpdG0tbWVhbikgKiAoaXRtLW1lYW4pXG5cbiAgICByZXR1cm4gTWF0aC5zcXJ0IE1hdGgubWVhbihkZXYpXG5cbmRlc2NyaWJlICdyZWRpcy13b3JrZXIgdGVzdHMnLCAoKSAtPlxuICBkZXNjcmliZSAnbm9ybWFsIHRlc3RzJywgKCkgLT5cbiAgICBpdCAnc2hvdWxkIHF1ZXVlIHVwIGEgam9iIGFuZCBkbyBpdCcsIChkb25lKSAtPlxuICAgICAgYXN5bmMuc2VyaWVzIFtcbiAgICAgICAgKG5leHQpIC0+IGNvbmN1cnJlbmN5MVdvcmtlci5wdXNoSm9iIHsgaWQ6IFwiMVwiIH0sIG5leHQsXG4gICAgICAgIChuZXh0KSAtPlxuICAgICAgICAgIHdhaXRVbnRpbCAoKSAtPlxuICAgICAgICAgICAgXCIxXCIgaW4gY29uY3VycmVuY3kxV29ya2VyLnJ1bm5pbmdUYXNrc1xuICAgICAgICAgICwgbmV4dCxcbiAgICAgICAgKG5leHQpIC0+XG4gICAgICAgICAgY29uY3VycmVuY3kxV29ya2VyLmZpbmlzaFRhc2sgXCIxXCJcbiAgICAgICAgICB3YWl0VW50aWwgKCkgLT5cbiAgICAgICAgICAgIFwiMVwiIGluIGNvbmN1cnJlbmN5MVdvcmtlci5kb25lVGFza3NcbiAgICAgICAgICAsIG5leHRcbiAgICAgIF0sIChlcnIpIC0+XG4gICAgICAgIGV4cGVjdChjb25jdXJyZW5jeTFXb3JrZXIuZG9uZVRhc2tzKS50by5jb250YWluIFwiMVwiXG4gICAgICAgIGRvbmUgZXJyXG5cbiAgICBpdCAnc2hvdWxkIHF1ZXVlIHVwIGEgam9iIGFuZCBkbyBpdCBpbiBvcmRlcicsIChkb25lKSAtPlxuICAgICAgYXN5bmMuc2VyaWVzIFtcbiAgICAgICAgKG5leHQpIC0+IGNvbmN1cnJlbmN5MVdvcmtlci5wdXNoSm9iIHsgaWQ6IFwiMVwiIH0sIG5leHQsXG4gICAgICAgIChuZXh0KSAtPiBjb25jdXJyZW5jeTFXb3JrZXIucHVzaEpvYiB7IGlkOiBcIjJcIiB9LCBuZXh0LFxuICAgICAgICAobmV4dCkgLT5cbiAgICAgICAgICB3YWl0VW50aWwgKCkgLT5cbiAgICAgICAgICAgIFwiMVwiIGluIGNvbmN1cnJlbmN5MVdvcmtlci5ydW5uaW5nVGFza3NcbiAgICAgICAgICAsIG5leHQsXG4gICAgICAgIChuZXh0KSAtPlxuICAgICAgICAgIGNvbmN1cnJlbmN5MVdvcmtlci5maW5pc2hTb21lVGFzaygpXG4gICAgICAgICAgd2FpdFVudGlsICgpIC0+XG4gICAgICAgICAgICBcIjJcIiBpbiBjb25jdXJyZW5jeTFXb3JrZXIucnVubmluZ1Rhc2tzXG4gICAgICAgICAgLCBuZXh0LFxuICAgICAgICAobmV4dCkgLT5cbiAgICAgICAgICBjb25jdXJyZW5jeTFXb3JrZXIuZmluaXNoU29tZVRhc2soKVxuICAgICAgICAgIHdhaXRVbnRpbCAoKSAtPlxuICAgICAgICAgICAgXCIyXCIgaW4gY29uY3VycmVuY3kxV29ya2VyLmRvbmVUYXNrc1xuICAgICAgICAgICwgbmV4dFxuICAgICAgXSwgKGVycikgLT5cbiAgICAgICAgZXhwZWN0KGNvbmN1cnJlbmN5MVdvcmtlci5kb25lVGFza3MpLnRvLmNvbnRhaW4gXCIxXCJcbiAgICAgICAgZXhwZWN0KGNvbmN1cnJlbmN5MVdvcmtlci5kb25lVGFza3MpLnRvLmNvbnRhaW4gXCIyXCJcbiAgICAgICAgZXhwZWN0KGNvbmN1cnJlbmN5MVdvcmtlci5tYXhSdW5uaW5nQXRPbmNlKS50by5lcXVhbCAxXG5cbiAgICAgICAgZG9uZSBlcnJcblxuIyBAVE9ETzogVGVzdCBpZiBlcnJvciBpcyBjYWxsZWQgb3V0IHdoZW4gQHdvcmsgcmV0dXJucyBhbiBlcnJvci5cblxuICBkZXNjcmliZSAnY29uY3VycmVuY3kgdGVzdHMnLCAoKSAtPlxuICAgIGl0ICdzaG91bGQgcnVuIHVwIHRvIDx0YXNrTGltaXQ+IGpvYnMgYXQgb25jZScsIChkb25lKSAtPlxuICAgICAgd29ya2VyICAgICAgPSBjb25jdXJyZW5jeTJXb3JrZXJcbiAgICAgIHRhc2tzTnVtYmVyID0gMjBcblxuICAgICAgYXV0b2ZpbmlzaEpvYkluNTBtcyA9IChpZCkgLT5cbiAgICAgICAgc2V0VGltZW91dCAoKSAtPlxuICAgICAgICAgIHdvcmtlci5maW5pc2hUYXNrKGlkKVxuICAgICAgICAsIDUwXG5cbiAgICAgIHdvcmtlci5lbWl0dGVyLm9uICdydW5uaW5nJywgYXV0b2ZpbmlzaEpvYkluNTBtc1xuXG4gICAgICBhc3luYy5zZXJpZXMgW1xuICAgICAgICAobmV4dCkgLT5cbiAgICAgICAgICBhc3luYy5lYWNoIFsxLi50YXNrc051bWJlcl0sIChpZCwgaW5uZXJOZXh0KSAtPlxuICAgICAgICAgICAgd29ya2VyLnB1c2hKb2IgeyBpZDogaWQgfSwgaW5uZXJOZXh0XG4gICAgICAgICAgLCBuZXh0XG4gICAgICAgIChuZXh0KSAtPlxuICAgICAgICAgIHdhaXRVbnRpbCAoKSAtPlxuICAgICAgICAgICAgd29ya2VyLnBlbmRpbmdUYXNrcy5sZW5ndGggPT0gMFxuICAgICAgICAgICwgbmV4dCxcbiAgICAgICAgKG5leHQpIC0+XG4gICAgICAgICAgd2FpdFVudGlsICgpIC0+XG4gICAgICAgICAgICB3b3JrZXIuZG9uZVRhc2tzLmxlbmd0aCA9PSB0YXNrc051bWJlclxuICAgICAgICAgICwgbmV4dCxcbiAgICAgIF0sIChlcnIpIC0+XG4gICAgICAgIGV4cGVjdCh3b3JrZXIubWF4UnVubmluZ0F0T25jZSkudG8uZXF1YWwgd29ya2VyLnRhc2tMaW1pdFxuXG4gICAgICAgIHdvcmtlci5lbWl0dGVyLnJlbW92ZUxpc3RlbmVyICdydW5uaW5nJywgYXV0b2ZpbmlzaEpvYkluNTBtc1xuICAgICAgICBkb25lIGVyclxuXG4gICAgaXQgJ3Nob3VsZCBub3Qgc3RhcnZlIG90aGVyIHF1ZXVlcyBpZiBydW5uaW5nIHNpZGUgYnkgc2lkZScsIChkb25lKSAtPlxuICAgICAgdGFza3NOdW1iZXIgID0gMjAwMFxuICAgICAgY29uY3VycmVuY3kgID0gMjBcbiAgICAgIHdvcmtlcnNDb3VudCA9IDVcblxuICAgICAgd29ya2VycyA9IFtdXG4gICAgICBhc3luYy5tYXAgWzEuLndvcmtlcnNDb3VudF0sIChpZHgsIG5leHQpIC0+XG4gICAgICAgIHdvcmtlciA9IGNyZWF0ZVdvcmtlciBcInNhbWVfaWRcIiwgY29uY3VycmVuY3lcbiAgICAgICAgY2xlYW5Xb3JrZXIgd29ya2VyLCAoZXJyKSAtPlxuICAgICAgICAgIHJldHVybiBuZXh0IGVyciBpZiBlcnJcblxuICAgICAgICAgIHdvcmtlci53YWl0Rm9yVGFza3MgKGVycikgLT5cbiAgICAgICAgICAgIG5leHQgZXJyLCB3b3JrZXJcbiAgICAgICwgKGVyciwgd29ya2VycykgLT5cbiAgICAgICAgYXV0b2ZpbmlzaEpvYkluNTBtc0ZhY3RvcnkgPSAod29ya2VyKSAtPlxuICAgICAgICAgIChpZCkgLT5cbiAgICAgICAgICAgIHNldFRpbWVvdXQgKCkgLT5cbiAgICAgICAgICAgICAgd29ya2VyLmZpbmlzaFRhc2soaWQpXG4gICAgICAgICAgICAsICg4MCArIE1hdGgucmFuZG9tKCkgKiA0MClcblxuICAgICAgICBmb3Igd29ya2VyIGluIHdvcmtlcnNcbiAgICAgICAgICB3b3JrZXIuYXV0b2ZpbmlzaEpvYkluNTBtcyA9IGF1dG9maW5pc2hKb2JJbjUwbXNGYWN0b3J5KHdvcmtlcilcbiAgICAgICAgICB3b3JrZXIuZW1pdHRlci5vbiAncnVubmluZycsIHdvcmtlci5hdXRvZmluaXNoSm9iSW41MG1zXG5cbiAgICAgICAgY291bnRBbGxEb25lVGFza3MgPSAoKSAtPiBfLnJlZHVjZSB3b3JrZXJzLCAoKHN1bSwgd29ya2VyKSAtPiBzdW0gKyB3b3JrZXIuZG9uZVRhc2tzLmxlbmd0aCksIDBcblxuICAgICAgICBhc3luYy5zZXJpZXMgW1xuICAgICAgICAgIChuZXh0KSAtPlxuICAgICAgICAgICAgYXN5bmMuZWFjaCBbMS4udGFza3NOdW1iZXJdLCAoaWQsIGlubmVyTmV4dCkgLT5cbiAgICAgICAgICAgICAgd29ya2Vyc1swXS5wdXNoSm9iIHsgaWQ6IFwiQSN7aWR9XCIgfSwgaW5uZXJOZXh0XG4gICAgICAgICAgICAsIG5leHRcbiAgICAgICAgICAobmV4dCkgLT5cbiAgICAgICAgICAgIHdhaXRVbnRpbCAoKSAtPlxuICAgICAgICAgICAgICBjb3VudEFsbERvbmVUYXNrcygpID09IHRhc2tzTnVtYmVyXG4gICAgICAgICAgICAsIG5leHQsXG4gICAgICAgIF0sIChlcnIpIC0+XG4gICAgICAgICAgZm9yIHdvcmtlciBpbiB3b3JrZXJzXG4gICAgICAgICAgICB3b3JrZXIuZW1pdHRlci5yZW1vdmVMaXN0ZW5lciAncnVubmluZycsIHdvcmtlci5hdXRvZmluaXNoSm9iSW41MG1zXG5cbiAgICAgICAgICBkb25lVGFza3MgPSBfLm1hcCB3b3JrZXJzLCAod29ya2VyKSAtPiB3b3JrZXIuZG9uZVRhc2tzLmxlbmd0aFxuICAgICAgICAgIGV4cGVjdChNYXRoLnN0RGV2IGRvbmVUYXNrcykudG8uYmUuYmVsb3codGFza3NOdW1iZXIgLyAxMDAuMClcblxuICAgICAgICAgIGRvbmUgZXJyXG5cbiAgICBpdCAnc2hvdWxkIG5vdCBzdGFydmUgb3RoZXIgcXVldWVzIGlmIHN0YXJ0aW5nIHdpdGggcHVzaGVkIHRhc2tzJywgKGRvbmUpIC0+XG4gICAgICB0YXNrc051bWJlciAgPSA0MDBcbiAgICAgIGNvbmN1cnJlbmN5ICA9IDIwXG4gICAgICB3b3JrZXJzQ291bnQgPSA1XG5cbiAgICAgIHdvcmtlcnMgPSBbXVxuICAgICAgYXN5bmMubWFwIFsxLi53b3JrZXJzQ291bnRdLCAoaWR4LCBuZXh0KSAtPlxuICAgICAgICB3b3JrZXIgPSBjcmVhdGVXb3JrZXIgXCJzYW1lX2lkMlwiLCBjb25jdXJyZW5jeVxuICAgICAgICBjbGVhbldvcmtlciB3b3JrZXIsIChlcnIpIC0+XG4gICAgICAgICAgbmV4dCBlcnIsIHdvcmtlclxuICAgICAgLCAoZXJyLCB3b3JrZXJzKSAtPlxuICAgICAgICBhdXRvZmluaXNoSm9iSW41MG1zRmFjdG9yeSA9ICh3b3JrZXIpIC0+XG4gICAgICAgICAgKGlkKSAtPlxuICAgICAgICAgICAgc2V0VGltZW91dCAoKSAtPlxuICAgICAgICAgICAgICB3b3JrZXIuZmluaXNoVGFzayhpZClcbiAgICAgICAgICAgICwgKDgwICsgTWF0aC5yYW5kb20oKSAqIDQwKVxuXG4gICAgICAgIGZvciB3b3JrZXIgaW4gd29ya2Vyc1xuICAgICAgICAgIHdvcmtlci5hdXRvZmluaXNoSm9iSW41MG1zID0gYXV0b2ZpbmlzaEpvYkluNTBtc0ZhY3Rvcnkod29ya2VyKVxuICAgICAgICAgIHdvcmtlci5lbWl0dGVyLm9uICdydW5uaW5nJywgd29ya2VyLmF1dG9maW5pc2hKb2JJbjUwbXNcblxuICAgICAgICBjb3VudEFsbERvbmVUYXNrcyA9ICgpIC0+IF8ucmVkdWNlIHdvcmtlcnMsICgoc3VtLCB3b3JrZXIpIC0+IHN1bSArIHdvcmtlci5kb25lVGFza3MubGVuZ3RoKSwgMFxuXG4gICAgICAgIGFzeW5jLnNlcmllcyBbXG4gICAgICAgICAgKG5leHQpIC0+XG4gICAgICAgICAgICBhc3luYy5lYWNoIFsxLi50YXNrc051bWJlcl0sIChpZCwgaW5uZXJOZXh0KSAtPlxuICAgICAgICAgICAgICB3b3JrZXJzWzBdLnB1c2hKb2IgeyBpZDogXCJCI3tpZH1cIiB9LCBpbm5lck5leHRcbiAgICAgICAgICAgICwgbmV4dFxuICAgICAgICAgIChuZXh0KSAtPlxuICAgICAgICAgICAgYXN5bmMuZWFjaFNlcmllcyB3b3JrZXJzLCAod29ya2VyLCBpbm5lck5leHQpIC0+XG4gICAgICAgICAgICAgIHdvcmtlci53YWl0Rm9yVGFza3MgaW5uZXJOZXh0XG4gICAgICAgICAgICAsIG5leHRcbiAgICAgICAgICAobmV4dCkgLT5cbiAgICAgICAgICAgIHdhaXRVbnRpbCAoKSAtPlxuICAgICAgICAgICAgICBjb3VudEFsbERvbmVUYXNrcygpID09IHRhc2tzTnVtYmVyXG4gICAgICAgICAgICAsIG5leHQsXG4gICAgICAgIF0sIChlcnIpIC0+XG4gICAgICAgICAgZm9yIHdvcmtlciBpbiB3b3JrZXJzXG4gICAgICAgICAgICB3b3JrZXIuZW1pdHRlci5yZW1vdmVMaXN0ZW5lciAncnVubmluZycsIHdvcmtlci5hdXRvZmluaXNoSm9iSW41MG1zXG5cbiAgICAgICAgICBkb25lVGFza3MgPSBfLm1hcCB3b3JrZXJzLCAod29ya2VyKSAtPiB3b3JrZXIuZG9uZVRhc2tzLmxlbmd0aFxuICAgICAgICAgIGV4cGVjdChNYXRoLnN0RGV2IGRvbmVUYXNrcykudG8uYmUuYmVsb3codGFza3NOdW1iZXIgLyAxMDAuMClcblxuICAgICAgICAgIGRvbmUgZXJyXG5cbiAgICBpdCAnc2hvdWxkIHVzZSBhbGwgY29uY3VycmVuY3kgc2xvdHMgYXQgYWxsIHRpbWVzJywgKGRvbmUpIC0+XG4gICAgICB0YXNrc051bWJlciAgPSAyMDAwXG4gICAgICBjb25jdXJyZW5jeSAgPSAxMFxuICAgICAgd29ya2Vyc0NvdW50ID0gNVxuXG4gICAgICB3b3JrZXJzID0gW11cbiAgICAgIGFzeW5jLm1hcCBbMS4ud29ya2Vyc0NvdW50XSwgKGlkeCwgbmV4dCkgLT5cbiAgICAgICAgd29ya2VyID0gY3JlYXRlV29ya2VyIFwic2FtZV9pZDNcIiwgY29uY3VycmVuY3lcbiAgICAgICAgY2xlYW5Xb3JrZXIgd29ya2VyLCAoZXJyKSAtPlxuICAgICAgICAgIG5leHQgZXJyLCB3b3JrZXJcbiAgICAgICwgKGVyciwgd29ya2VycykgLT5cbiAgICAgICAgYXV0b2ZpbmlzaEpvYkluNTBtc0ZhY3RvcnkgPSAod29ya2VyKSAtPlxuICAgICAgICAgIChpZCkgLT5cbiAgICAgICAgICAgIHNldFRpbWVvdXQgKCkgLT5cbiAgICAgICAgICAgICAgd29ya2VyLmZpbmlzaFRhc2soaWQpXG4gICAgICAgICAgICAsICg0MCArIE1hdGgucmFuZG9tKCkgKiA0MClcblxuICAgICAgICBmb3Igd29ya2VyIGluIHdvcmtlcnNcbiAgICAgICAgICB3b3JrZXIuYXV0b2ZpbmlzaEpvYkluNTBtcyA9IGF1dG9maW5pc2hKb2JJbjUwbXNGYWN0b3J5KHdvcmtlcilcbiAgICAgICAgICB3b3JrZXIuZW1pdHRlci5vbiAncnVubmluZycsIHdvcmtlci5hdXRvZmluaXNoSm9iSW41MG1zXG5cbiAgICAgICAgY291bnRBbGxEb25lVGFza3MgICAgPSAoKSAtPiBfLnJlZHVjZSB3b3JrZXJzLCAoKHN1bSwgd29ya2VyKSAtPiBzdW0gKyB3b3JrZXIuZG9uZVRhc2tzLmxlbmd0aCksIDBcbiAgICAgICAgc3VtbWFyaXplQWxsUnVubmluZ1Rhc2tzID0gKCkgLT4gXy5tYXAgd29ya2VycywgKHdvcmtlcikgLT4gd29ya2VyLnJ1bm5pbmdUYXNrcy5sZW5ndGhcblxuICAgICAgICB3b3JrZXJzUnVubmluZ1Rhc2tzUHJvZmlsZSAgPSBbXVxuICAgICAgICBwcm9maWxlclRpbWVySm9iID0gc2V0SW50ZXJ2YWwgKCkgLT5cbiAgICAgICAgICB3b3JrZXJzUnVubmluZ1Rhc2tzUHJvZmlsZS5wdXNoIHN1bW1hcml6ZUFsbFJ1bm5pbmdUYXNrcygpXG4gICAgICAgICwgMTBcblxuICAgICAgICBhc3luYy5zZXJpZXMgW1xuICAgICAgICAgIChuZXh0KSAtPlxuICAgICAgICAgICAgYXN5bmMuZWFjaCBbMS4udGFza3NOdW1iZXJdLCAoaWQsIGlubmVyTmV4dCkgLT5cbiAgICAgICAgICAgICAgd29ya2Vyc1swXS5wdXNoSm9iIHsgaWQ6IFwiQiN7aWR9XCIgfSwgaW5uZXJOZXh0XG4gICAgICAgICAgICAsIG5leHRcbiAgICAgICAgICAobmV4dCkgLT5cbiAgICAgICAgICAgIGFzeW5jLmVhY2ggd29ya2VycywgKHdvcmtlciwgaW5uZXJOZXh0KSAtPlxuICAgICAgICAgICAgICB3b3JrZXIud2FpdEZvclRhc2tzIGlubmVyTmV4dFxuICAgICAgICAgICAgLCBuZXh0XG4gICAgICAgICAgKG5leHQpIC0+XG4gICAgICAgICAgICB3YWl0VW50aWwgKCkgLT5cbiAgICAgICAgICAgICAgY291bnRBbGxEb25lVGFza3MoKSA9PSB0YXNrc051bWJlclxuICAgICAgICAgICAgLCBuZXh0LFxuICAgICAgICBdLCAoZXJyKSAtPlxuICAgICAgICAgIGZvciB3b3JrZXIgaW4gd29ya2Vyc1xuICAgICAgICAgICAgd29ya2VyLmVtaXR0ZXIucmVtb3ZlTGlzdGVuZXIgJ3J1bm5pbmcnLCB3b3JrZXIuYXV0b2ZpbmlzaEpvYkluNTBtc1xuICAgICAgICAgIGNsZWFySW50ZXJ2YWwgcHJvZmlsZXJUaW1lckpvYlxuXG4gICAgICAgICAgcnVubmluZ1Rhc2tzTWVhblBlcldvcmtlciAgPSBbXVxuICAgICAgICAgIHJ1bm5pbmdUYXNrc1N0RGV2UGVyV29ya2VyID0gW11cbiAgICAgICAgICBmb3Igd29ya2VySWR4IGluIFswLi4ud29ya2Vycy5sZW5ndGhdXG4gICAgICAgICAgICB3b3JrZXJSdW5uaW5nVGFza3NQcm9maWxlID0gXy5tYXAgd29ya2Vyc1J1bm5pbmdUYXNrc1Byb2ZpbGUsIChydW5uaW5nVGFza3NQcm9maWxlKSAtPiBydW5uaW5nVGFza3NQcm9maWxlW3dvcmtlcklkeF1cbiAgICAgICAgICAgIHdvcmtlclJ1bm5pbmdUYXNrc1Byb2ZpbGVPbmx5TWlkUG9pbnRzID0gd29ya2VyUnVubmluZ1Rhc2tzUHJvZmlsZVsxMC4uLTIwXVxuXG4gICAgICAgICAgICBydW5uaW5nVGFza3NNZWFuUGVyV29ya2VyLnB1c2ggIE1hdGgubWVhbih3b3JrZXJSdW5uaW5nVGFza3NQcm9maWxlT25seU1pZFBvaW50cylcbiAgICAgICAgICAgIHJ1bm5pbmdUYXNrc1N0RGV2UGVyV29ya2VyLnB1c2ggTWF0aC5zdERldih3b3JrZXJSdW5uaW5nVGFza3NQcm9maWxlT25seU1pZFBvaW50cylcblxuICAgICAgICAgIGV4cGVjdChfLm1pbiBydW5uaW5nVGFza3NNZWFuUGVyV29ya2VyKS50by5iZS5hYm92ZShjb25jdXJyZW5jeSAqIDAuOSlcbiAgICAgICAgICBleHBlY3QoXy5tYXggcnVubmluZ1Rhc2tzU3REZXZQZXJXb3JrZXIpLnRvLmJlLmJlbG93KGNvbmN1cnJlbmN5ICogMC4xKVxuXG4gICAgICAgICAgZG9uZSBlcnJcblxuICAgIGl0ICdzaG91bGQgbm90IHVzZSByZWRpcyBtb3JlIHRoYW4gbmVjZXNzYXJ5JywgKGRvbmUpIC0+XG4gICAgICB0YXNrc051bWJlclBlcldvcmtlciA9IDIwMFxuICAgICAgY29uY3VycmVuY3kgID0gNVxuICAgICAgd29ya2Vyc0NvdW50ID0gM1xuXG4gICAgICB3b3JrZXJzID0gW11cbiAgICAgIGFzeW5jLm1hcCBbMS4ud29ya2Vyc0NvdW50XSwgKGlkeCwgbmV4dCkgLT5cbiAgICAgICAgd29ya2VyID0gY3JlYXRlV29ya2VyIFwidGVzdDFfd29ya2VyI3tpZHh9XCIsIGNvbmN1cnJlbmN5XG5cbiAgICAgICAgIyBTZXR1cCByZWRpcyBjYWxsIHNweS5cbiAgICAgICAgc2lub24uc3B5IHdvcmtlciwgJ3BvcEpvYkZyb21RdWV1ZSdcblxuICAgICAgICAjIFByZXBhcmUgd29ya2VyLlxuICAgICAgICBjbGVhbldvcmtlciB3b3JrZXIsIChlcnIpIC0+XG4gICAgICAgICAgcmV0dXJuIG5leHQgZXJyIGlmIGVyclxuXG4gICAgICAgICAgd29ya2VyLndhaXRGb3JUYXNrcyAoZXJyKSAtPlxuICAgICAgICAgICAgbmV4dCBlcnIsIHdvcmtlclxuICAgICAgLCAoZXJyLCB3b3JrZXJzKSAtPlxuICAgICAgICBhdXRvZmluaXNoSm9iSW41MG1zRmFjdG9yeSA9ICh3b3JrZXIpIC0+XG4gICAgICAgICAgKGlkKSAtPlxuICAgICAgICAgICAgc2V0VGltZW91dCAoKSAtPlxuICAgICAgICAgICAgICB3b3JrZXIuZmluaXNoVGFzayhpZClcbiAgICAgICAgICAgICwgKDQwICsgTWF0aC5yYW5kb20oKSAqIDQwKVxuXG4gICAgICAgIGZvciB3b3JrZXIgaW4gd29ya2Vyc1xuICAgICAgICAgIHdvcmtlci5hdXRvZmluaXNoSm9iSW41MG1zID0gYXV0b2ZpbmlzaEpvYkluNTBtc0ZhY3Rvcnkod29ya2VyKVxuICAgICAgICAgIHdvcmtlci5lbWl0dGVyLm9uICdydW5uaW5nJywgd29ya2VyLmF1dG9maW5pc2hKb2JJbjUwbXNcblxuICAgICAgICBjb3VudEFsbERvbmVUYXNrcyA9ICgpIC0+IF8ucmVkdWNlIHdvcmtlcnMsICgoc3VtLCB3b3JrZXIpIC0+IHN1bSArIHdvcmtlci5kb25lVGFza3MubGVuZ3RoKSwgMFxuXG4gICAgICAgIGFzeW5jLnNlcmllcyBbXG4gICAgICAgICAgKG5leHQpIC0+XG4gICAgICAgICAgICAjIEFkZCAndGFza3NOdW1iZXJQZXJXb3JrZXInIHRhc2tzIGZvciBlYWNoIG9mIHRoZSAoc2VwYXJhdGUhKSB3b3JrZXJzXG4gICAgICAgICAgICBhc3luYy5lYWNoIHdvcmtlcnMsICh3b3JrZXIsIGlubmVyTmV4dCkgLT5cbiAgICAgICAgICAgICAgYXN5bmMuZWFjaCBbMS4udGFza3NOdW1iZXJQZXJXb3JrZXJdLCAoaWQsIGlubmVySW5uZXJOZXh0KSAtPlxuICAgICAgICAgICAgICAgIHdvcmtlci5wdXNoSm9iIHsgaWQ6IFwiQSN7aWR9XCIgfSwgaW5uZXJJbm5lck5leHRcbiAgICAgICAgICAgICAgLCBpbm5lck5leHRcbiAgICAgICAgICAgICwgbmV4dFxuICAgICAgICAgIChuZXh0KSAtPlxuICAgICAgICAgICAgIyBXYWl0IHRpbGwgdGhleSBmaW5pc2guXG4gICAgICAgICAgICB3YWl0VW50aWwgKCkgLT5cbiAgICAgICAgICAgICAgY291bnRBbGxEb25lVGFza3MoKSA9PSB0YXNrc051bWJlclBlcldvcmtlciAqIHdvcmtlcnNDb3VudFxuICAgICAgICAgICAgLCBuZXh0LFxuICAgICAgICAgIChuZXh0KSAtPlxuICAgICAgICAgICAgIyBBZGQgJ3Rhc2tzTnVtYmVyUGVyV29ya2VyJyB0YXNrcyBmb3Igb25seSBvbmUgb2YgdGhlIHdvcmtlcnNcbiAgICAgICAgICAgIGFzeW5jLmVhY2ggWzEuLnRhc2tzTnVtYmVyUGVyV29ya2VyXSwgKGlkLCBpbm5lck5leHQpIC0+XG4gICAgICAgICAgICAgIHdvcmtlcnNbMF0ucHVzaEpvYiB7IGlkOiBcIkIje2lkfVwiIH0sIGlubmVyTmV4dFxuICAgICAgICAgICAgLCBuZXh0XG4gICAgICAgICAgICAjIEFkZCAndGFza3NOdW1iZXJQZXJXb3JrZXInIHRhc2tzIGZvciBvbmx5IG9uZSBvZiB0aGUgd29ya2Vyc1xuICAgICAgICAgICAgYXN5bmMuZWFjaCBbMS4udGFza3NOdW1iZXJQZXJXb3JrZXJdLCAoaWQsIGlubmVyTmV4dCkgLT5cbiAgICAgICAgICAgICAgd29ya2Vyc1sxXS5wdXNoSm9iIHsgaWQ6IFwiQiN7aWR9XCIgfSwgaW5uZXJOZXh0XG4gICAgICAgICAgICAsIG5leHRcbiAgICAgICAgICAobmV4dCkgLT5cbiAgICAgICAgICAgICMgV2FpdCB0aWxsIGl0J3MgZmluaXNoZWQuXG4gICAgICAgICAgICB3YWl0VW50aWwgKCkgLT5cbiAgICAgICAgICAgICAgd29ya2Vyc1swXS5kb25lVGFza3MubGVuZ3RoID09IDIgKiB0YXNrc051bWJlclBlcldvcmtlciBhbmQgd29ya2Vyc1sxXS5kb25lVGFza3MubGVuZ3RoID09IDIgKiB0YXNrc051bWJlclBlcldvcmtlclxuICAgICAgICAgICAgLCBuZXh0LFxuICAgICAgICAgIChuZXh0KSAtPlxuICAgICAgICAgICAgIyBBZGQgJ3Rhc2tzTnVtYmVyUGVyV29ya2VyJyB0YXNrcyBmb3Igb25seSBvbmUgb2YgdGhlIHdvcmtlcnNcbiAgICAgICAgICAgIGFzeW5jLmVhY2ggWzEuLnRhc2tzTnVtYmVyUGVyV29ya2VyXSwgKGlkLCBpbm5lck5leHQpIC0+XG4gICAgICAgICAgICAgIHdvcmtlcnNbMl0ucHVzaEpvYiB7IGlkOiBcIkMje2lkfVwiIH0sIGlubmVyTmV4dFxuICAgICAgICAgICAgLCBuZXh0XG4gICAgICAgICAgKG5leHQpIC0+XG4gICAgICAgICAgICAjIFdhaXQgdGlsbCBpdCdzIGZpbmlzaGVkLlxuICAgICAgICAgICAgd2FpdFVudGlsICgpIC0+XG4gICAgICAgICAgICAgIHdvcmtlcnNbMl0uZG9uZVRhc2tzLmxlbmd0aCA9PSAyICogdGFza3NOdW1iZXJQZXJXb3JrZXJcbiAgICAgICAgICAgICwgbmV4dCxcbiAgICAgICAgXSwgKGVycikgLT5cbiAgICAgICAgICAjIENsZWFudXBcbiAgICAgICAgICBmb3Igd29ya2VyIGluIHdvcmtlcnNcbiAgICAgICAgICAgICMgQ291bnQgbnVtYmVyIG9mIHRpbWVzIHJlZGlzIHdhcyBjYWxsZWQuXG4gICAgICAgICAgICBleHBlY3Qod29ya2VyLnBvcEpvYkZyb21RdWV1ZS5jYWxsQ291bnQpLnRvLmJlLmJlbG93KHdvcmtlci5kb25lVGFza3MubGVuZ3RoICogMS4yKVxuXG4gICAgICAgICAgICB3b3JrZXIuZW1pdHRlci5yZW1vdmVMaXN0ZW5lciAncnVubmluZycsIHdvcmtlci5hdXRvZmluaXNoSm9iSW41MG1zXG4gICAgICAgICAgICB3b3JrZXIucG9wSm9iRnJvbVF1ZXVlLnJlc3RvcmUoKVxuXG4gICAgICAgICAgZG9uZSBlcnJcbiJdfQ==