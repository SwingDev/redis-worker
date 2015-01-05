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
            return async.each(workers, function(worker, innerNext) {
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

//# sourceMappingURL=data:application/json;base64,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QUFBQSxnQkFBRSxFQUFBLEVBQUssR0FBQSxHQUFHLEVBQVY7ZUFBbkIsRUFBcUMsU0FBckMsRUFEb0M7WUFBQSxDQUF0QyxFQUVFLElBRkYsRUFGRjtVQUFBLENBM0JXLEVBZ0NYLFNBQUMsSUFBRCxHQUFBO21CQUVFLFNBQUEsQ0FBVSxTQUFBLEdBQUE7cUJBQ1IsT0FBUSxDQUFBLENBQUEsQ0FBRSxDQUFDLFNBQVMsQ0FBQyxNQUFyQixLQUErQixDQUFBLEdBQUkscUJBRDNCO1lBQUEsQ0FBVixFQUVFLElBRkYsRUFGRjtVQUFBLENBaENXO1NBQWIsRUFxQ0csU0FBQyxHQUFELEdBQUE7QUFFRCxjQUFBLFNBQUE7QUFBQSxlQUFBLGdEQUFBO2lDQUFBO0FBRUUsWUFBQSxNQUFBLENBQU8sTUFBTSxDQUFDLGVBQWUsQ0FBQyxTQUE5QixDQUF3QyxDQUFDLEVBQUUsQ0FBQyxFQUFFLENBQUMsS0FBL0MsQ0FBcUQsTUFBTSxDQUFDLFNBQVMsQ0FBQyxNQUFqQixHQUEwQixHQUEvRSxDQUFBLENBQUE7QUFBQSxZQUVBLE1BQU0sQ0FBQyxPQUFPLENBQUMsY0FBZixDQUE4QixTQUE5QixFQUF5QyxNQUFNLENBQUMsbUJBQWhELENBRkEsQ0FBQTtBQUFBLFlBR0EsTUFBTSxDQUFDLGVBQWUsQ0FBQyxPQUF2QixDQUFBLENBSEEsQ0FGRjtBQUFBLFdBQUE7aUJBT0EsSUFBQSxDQUFLLEdBQUwsRUFUQztRQUFBLENBckNILEVBYkE7TUFBQSxDQVpGLEVBTjZDO0lBQUEsQ0FBL0MsRUFyTDRCO0VBQUEsQ0FBOUIsRUE3QzZCO0FBQUEsQ0FBL0IsQ0F6SUEsQ0FBQSIsImZpbGUiOiJ0ZXN0L3dvcmtlci5qcyIsInNvdXJjZVJvb3QiOiIvc291cmNlLyIsInNvdXJjZXNDb250ZW50IjpbIl8gICAgICAgICA9IHJlcXVpcmUoJ2xvZGFzaCcpXG5cbmFzeW5jICAgICA9IHJlcXVpcmUoJ2FzeW5jJylcbnJlZGlzICAgICA9IHJlcXVpcmUoJ3JlZGlzJylcbmZha2VyZWRpcyA9IHJlcXVpcmUoJ2Zha2VyZWRpcycpXG5jaGFpICAgICAgPSByZXF1aXJlKCdjaGFpJylcbmV4cGVjdCAgICA9IHJlcXVpcmUoJ2NoYWknKS5leHBlY3RcbnNpbm9uICAgICA9IHJlcXVpcmUoJ3Npbm9uJylcblxuUmVkaXNXb3JrZXIgPSByZXF1aXJlKCcuLi9saWIvaW5kZXguanMnKVxuV29ya2VyICAgICAgPSBSZWRpc1dvcmtlci5Xb3JrZXJcblxuRXZlbnRFbWl0dGVyID0gcmVxdWlyZSgnZXZlbnRzJykuRXZlbnRFbWl0dGVyXG5cbmNsYXNzIFRlc3RXb3JrZXIgZXh0ZW5kcyBXb3JrZXJcbiAgY29uc3RydWN0b3I6IChAdXJsLCBAdGFza0xpbWl0KSAtPlxuICAgIHN1cGVyXG5cbiAgICBAZW1pdHRlciAgICAgICAgPSBuZXcgRXZlbnRFbWl0dGVyKClcbiAgICBAcmVzZXQoKVxuXG4gIG5hbWU6ICgpIC0+IFwiVGVzdCN7QHdvcmtlcklEfVwiXG5cbiAgcmVzZXQ6ICgpIC0+XG4gICAgQHBlbmRpbmdUYXNrcyAgID0gW11cbiAgICBAcnVubmluZ1Rhc2tzICAgPSBbXVxuICAgIEBkb25lVGFza3MgICAgICA9IFtdXG4gICAgQGZhaWxlZFRhc2tzICAgID0gW11cbiAgICBAdGFza3NDYWxsYmFja3MgPSB7fVxuXG4gICAgQG1heFJ1bm5pbmdBdE9uY2UgPSAwXG5cbiAgZXJyb3JUYXNrOiAoaWQpIC0+XG4gICAgZXhwZWN0KEBydW5uaW5nVGFza3MpLnRvLmNvbnRhaW4gaWRcbiAgICBleHBlY3QoQGRvbmVUYXNrcykudG8ubm90LmNvbnRhaW4gaWRcbiAgICBleHBlY3QoQGZhaWxlZFRhc2tzKS50by5ub3QuY29udGFpbiBpZFxuXG4gICAgQGZhaWxlZFRhc2tzLnB1c2ggaWRcbiAgICBAcnVubmluZ1Rhc2tzID0gXy5yZWplY3QgQHJ1bm5pbmdUYXNrcywgKHJ1bm5pbmdJdGVtSUQpIC0+IHJ1bm5pbmdJdGVtSUQgPT0gaWRcblxuICAgIEBlbWl0dGVyLmVtaXQgJ2ZhaWxlZCcsIGlkXG5cbiAgICBAdGFza3NDYWxsYmFja3NbaWRdIG5ldyBFcnJvcihcImVycm9yXCIpXG5cbiAgZmluaXNoU29tZVRhc2s6ICgpIC0+XG4gICAgQGZpbmlzaFRhc2sgQHJ1bm5pbmdUYXNrc1swXVxuXG4gIGZpbmlzaFRhc2s6IChpZCkgLT5cbiAgICBleHBlY3QoQHJ1bm5pbmdUYXNrcykudG8uY29udGFpbiBpZFxuICAgIGV4cGVjdChAZG9uZVRhc2tzKS50by5ub3QuY29udGFpbiBpZFxuICAgIGV4cGVjdChAZmFpbGVkVGFza3MpLnRvLm5vdC5jb250YWluIGlkXG5cbiAgICBAZG9uZVRhc2tzLnB1c2ggaWRcbiAgICBAcnVubmluZ1Rhc2tzID0gXy5yZWplY3QgQHJ1bm5pbmdUYXNrcywgKHJ1bm5pbmdJdGVtSUQpIC0+IHJ1bm5pbmdJdGVtSUQgPT0gaWRcblxuICAgIEBlbWl0dGVyLmVtaXQgJ2RvbmUnLCBpZFxuXG4gICAgQHRhc2tzQ2FsbGJhY2tzW2lkXSgpXG5cbiAgcHVzaEpvYjogKHBheWxvYWQsIGNiKSAtPlxuICAgIHN1cGVyXG4gICAgQHBlbmRpbmdUYXNrcy5wdXNoIHBheWxvYWQuaWRcblxuICB3b3JrOiAocGF5bG9hZCwgZG9uZSkgLT5cbiAgICBwYXlsb2FkID0gSlNPTi5wYXJzZShwYXlsb2FkKVxuXG4gICAgaWQgPSBwYXlsb2FkLmlkXG5cbiAgICBAdGFza3NDYWxsYmFja3NbaWRdID0gZG9uZVxuXG4gICAgQHJ1bm5pbmdUYXNrcy5wdXNoIGlkXG4gICAgQHBlbmRpbmdUYXNrcyA9IF8ucmVqZWN0IEBwZW5kaW5nVGFza3MsIChwZW5kaW5nSXRlbUlEKSAtPiBwZW5kaW5nSXRlbUlEID09IGlkXG5cbiAgICBAZW1pdHRlci5lbWl0ICdydW5uaW5nJywgaWRcblxuICAgIEBtYXhSdW5uaW5nQXRPbmNlID0gTWF0aC5tYXgoQG1heFJ1bm5pbmdBdE9uY2UsIEBydW5uaW5nVGFza3MubGVuZ3RoKVxuXG5jcmVhdGVXb3JrZXIgPSAod29ya2VySUQsIHRhc2tMaW1pdCkgLT5cbiAgd29ya2VyID0gbmV3IFRlc3RXb3JrZXIgXCJyZWRpczovL2xvY2FsaG9zdDo2Mzc5LzMyXCIsIHRhc2tMaW1pdFxuICB3b3JrZXIud29ya2VySUQgPSB3b3JrZXJJRFxuXG4gIHdvcmtlclxuXG5jbGVhbldvcmtlciA9ICh3b3JrZXIsIGNhbGxiYWNrKSAtPlxuICB3b3JrZXIucmVzZXQoKVxuICB3b3JrZXIub2J0YWluTGlzdENsaWVudCAoZXJyLCBjbGllbnQpIC0+XG4gICAgcmV0dXJuIGNhbGxiYWNrIGVyciBpZiBlcnJcblxuICAgIGFzeW5jLnBhcmFsbGVsIFtcbiAgICAgIChuZXh0KSAtPiBjbGllbnQuZGVsIHdvcmtlci5saXN0S2V5KCksIG5leHQsXG4gICAgICAobmV4dCkgLT4gY2xpZW50LmRlbCB3b3JrZXIuY2hhbm5lbEtleSgpLCBuZXh0XG4gICAgXSwgY2FsbGJhY2tcblxuXG5jb25jdXJyZW5jeTFXb3JrZXIgPSBudWxsXG5jb25jdXJyZW5jeTJXb3JrZXIgPSBudWxsXG5iZWZvcmUgKGRvbmUpIC0+XG4gIHNpbm9uLnN0dWIocmVkaXMsICdjcmVhdGVDbGllbnQnLCBmYWtlcmVkaXMuY3JlYXRlQ2xpZW50KVxuXG4gIGNvbmN1cnJlbmN5MVdvcmtlciA9IGNyZWF0ZVdvcmtlcihcImNvbmN1cnJlbmN5MVdvcmtlclwiLCAxKVxuICBjb25jdXJyZW5jeTJXb3JrZXIgPSBjcmVhdGVXb3JrZXIoXCJjb25jdXJyZW5jeTJXb3JrZXJcIiwgMilcblxuICBhc3luYy5lYWNoIFtjb25jdXJyZW5jeTFXb3JrZXIsIGNvbmN1cnJlbmN5Mldvcmtlcl1cbiAgLCAod29ya2VyLCBuZXh0KSAtPlxuICAgIGFzeW5jLnNlcmllcyBbXG4gICAgICAoaW5uZXJOZXh0KSAtPiB3b3JrZXIud2FpdEZvclRhc2tzIGlubmVyTmV4dFxuICAgIF0sIG5leHRcbiAgLCBkb25lXG5cbmFmdGVyIChkb25lKSAtPlxuICBjb25jdXJyZW5jeTJXb3JrZXIgPSBudWxsXG4gIGNvbmN1cnJlbmN5MVdvcmtlciA9IG51bGxcblxuICByZWRpcy5jcmVhdGVDbGllbnQucmVzdG9yZSgpXG5cbiAgZG9uZSgpXG5cbmJlZm9yZUVhY2ggKGRvbmUpIC0+XG4gIGFzeW5jLmVhY2ggW2NvbmN1cnJlbmN5MVdvcmtlciwgY29uY3VycmVuY3kyV29ya2VyXSwgY2xlYW5Xb3JrZXIsIGRvbmVcblxuIyBIZWxwZXJzXG53YWl0VW50aWwgPSAodGVzdEZ1bmMsIGNhbGxiYWNrKSAtPlxuICBpZiB0ZXN0RnVuYygpXG4gICAgY2FsbGJhY2soKVxuICBlbHNlXG4gICAgc2V0VGltZW91dCAoKSAtPlxuICAgICAgd2FpdFVudGlsKHRlc3RGdW5jLCBjYWxsYmFjaylcbiAgICAsIDEwMFxuXG5NYXRoLm1lYW4gPSAoYXJyYXkpIC0+IChfLnJlZHVjZSBhcnJheSwgKGEsIGIpIC0+IGErYikgLyBhcnJheS5sZW5ndGhcblxuTWF0aC5zdERldiA9IChhcnJheSkgLT5cbiAgICBtZWFuID0gTWF0aC5tZWFuIGFycmF5XG4gICAgZGV2ICA9IF8ubWFwIGFycmF5LCAoaXRtKSAtPiAoaXRtLW1lYW4pICogKGl0bS1tZWFuKVxuXG4gICAgcmV0dXJuIE1hdGguc3FydCBNYXRoLm1lYW4oZGV2KVxuXG5kZXNjcmliZSAncmVkaXMtd29ya2VyIHRlc3RzJywgKCkgLT5cbiAgZGVzY3JpYmUgJ25vcm1hbCB0ZXN0cycsICgpIC0+XG4gICAgaXQgJ3Nob3VsZCBxdWV1ZSB1cCBhIGpvYiBhbmQgZG8gaXQnLCAoZG9uZSkgLT5cbiAgICAgIGFzeW5jLnNlcmllcyBbXG4gICAgICAgIChuZXh0KSAtPiBjb25jdXJyZW5jeTFXb3JrZXIucHVzaEpvYiB7IGlkOiBcIjFcIiB9LCBuZXh0LFxuICAgICAgICAobmV4dCkgLT5cbiAgICAgICAgICB3YWl0VW50aWwgKCkgLT5cbiAgICAgICAgICAgIFwiMVwiIGluIGNvbmN1cnJlbmN5MVdvcmtlci5ydW5uaW5nVGFza3NcbiAgICAgICAgICAsIG5leHQsXG4gICAgICAgIChuZXh0KSAtPlxuICAgICAgICAgIGNvbmN1cnJlbmN5MVdvcmtlci5maW5pc2hUYXNrIFwiMVwiXG4gICAgICAgICAgd2FpdFVudGlsICgpIC0+XG4gICAgICAgICAgICBcIjFcIiBpbiBjb25jdXJyZW5jeTFXb3JrZXIuZG9uZVRhc2tzXG4gICAgICAgICAgLCBuZXh0XG4gICAgICBdLCAoZXJyKSAtPlxuICAgICAgICBleHBlY3QoY29uY3VycmVuY3kxV29ya2VyLmRvbmVUYXNrcykudG8uY29udGFpbiBcIjFcIlxuICAgICAgICBkb25lIGVyclxuXG4gICAgaXQgJ3Nob3VsZCBxdWV1ZSB1cCBhIGpvYiBhbmQgZG8gaXQgaW4gb3JkZXInLCAoZG9uZSkgLT5cbiAgICAgIGFzeW5jLnNlcmllcyBbXG4gICAgICAgIChuZXh0KSAtPiBjb25jdXJyZW5jeTFXb3JrZXIucHVzaEpvYiB7IGlkOiBcIjFcIiB9LCBuZXh0LFxuICAgICAgICAobmV4dCkgLT4gY29uY3VycmVuY3kxV29ya2VyLnB1c2hKb2IgeyBpZDogXCIyXCIgfSwgbmV4dCxcbiAgICAgICAgKG5leHQpIC0+XG4gICAgICAgICAgd2FpdFVudGlsICgpIC0+XG4gICAgICAgICAgICBcIjFcIiBpbiBjb25jdXJyZW5jeTFXb3JrZXIucnVubmluZ1Rhc2tzXG4gICAgICAgICAgLCBuZXh0LFxuICAgICAgICAobmV4dCkgLT5cbiAgICAgICAgICBjb25jdXJyZW5jeTFXb3JrZXIuZmluaXNoU29tZVRhc2soKVxuICAgICAgICAgIHdhaXRVbnRpbCAoKSAtPlxuICAgICAgICAgICAgXCIyXCIgaW4gY29uY3VycmVuY3kxV29ya2VyLnJ1bm5pbmdUYXNrc1xuICAgICAgICAgICwgbmV4dCxcbiAgICAgICAgKG5leHQpIC0+XG4gICAgICAgICAgY29uY3VycmVuY3kxV29ya2VyLmZpbmlzaFNvbWVUYXNrKClcbiAgICAgICAgICB3YWl0VW50aWwgKCkgLT5cbiAgICAgICAgICAgIFwiMlwiIGluIGNvbmN1cnJlbmN5MVdvcmtlci5kb25lVGFza3NcbiAgICAgICAgICAsIG5leHRcbiAgICAgIF0sIChlcnIpIC0+XG4gICAgICAgIGV4cGVjdChjb25jdXJyZW5jeTFXb3JrZXIuZG9uZVRhc2tzKS50by5jb250YWluIFwiMVwiXG4gICAgICAgIGV4cGVjdChjb25jdXJyZW5jeTFXb3JrZXIuZG9uZVRhc2tzKS50by5jb250YWluIFwiMlwiXG4gICAgICAgIGV4cGVjdChjb25jdXJyZW5jeTFXb3JrZXIubWF4UnVubmluZ0F0T25jZSkudG8uZXF1YWwgMVxuXG4gICAgICAgIGRvbmUgZXJyXG5cbiMgQFRPRE86IFRlc3QgaWYgZXJyb3IgaXMgY2FsbGVkIG91dCB3aGVuIEB3b3JrIHJldHVybnMgYW4gZXJyb3IuXG5cbiAgZGVzY3JpYmUgJ2NvbmN1cnJlbmN5IHRlc3RzJywgKCkgLT5cbiAgICBpdCAnc2hvdWxkIHJ1biB1cCB0byA8dGFza0xpbWl0PiBqb2JzIGF0IG9uY2UnLCAoZG9uZSkgLT5cbiAgICAgIHdvcmtlciAgICAgID0gY29uY3VycmVuY3kyV29ya2VyXG4gICAgICB0YXNrc051bWJlciA9IDIwXG5cbiAgICAgIGF1dG9maW5pc2hKb2JJbjUwbXMgPSAoaWQpIC0+XG4gICAgICAgIHNldFRpbWVvdXQgKCkgLT5cbiAgICAgICAgICB3b3JrZXIuZmluaXNoVGFzayhpZClcbiAgICAgICAgLCA1MFxuXG4gICAgICB3b3JrZXIuZW1pdHRlci5vbiAncnVubmluZycsIGF1dG9maW5pc2hKb2JJbjUwbXNcblxuICAgICAgYXN5bmMuc2VyaWVzIFtcbiAgICAgICAgKG5leHQpIC0+XG4gICAgICAgICAgYXN5bmMuZWFjaCBbMS4udGFza3NOdW1iZXJdLCAoaWQsIGlubmVyTmV4dCkgLT5cbiAgICAgICAgICAgIHdvcmtlci5wdXNoSm9iIHsgaWQ6IGlkIH0sIGlubmVyTmV4dFxuICAgICAgICAgICwgbmV4dFxuICAgICAgICAobmV4dCkgLT5cbiAgICAgICAgICB3YWl0VW50aWwgKCkgLT5cbiAgICAgICAgICAgIHdvcmtlci5wZW5kaW5nVGFza3MubGVuZ3RoID09IDBcbiAgICAgICAgICAsIG5leHQsXG4gICAgICAgIChuZXh0KSAtPlxuICAgICAgICAgIHdhaXRVbnRpbCAoKSAtPlxuICAgICAgICAgICAgd29ya2VyLmRvbmVUYXNrcy5sZW5ndGggPT0gdGFza3NOdW1iZXJcbiAgICAgICAgICAsIG5leHQsXG4gICAgICBdLCAoZXJyKSAtPlxuICAgICAgICBleHBlY3Qod29ya2VyLm1heFJ1bm5pbmdBdE9uY2UpLnRvLmVxdWFsIHdvcmtlci50YXNrTGltaXRcblxuICAgICAgICB3b3JrZXIuZW1pdHRlci5yZW1vdmVMaXN0ZW5lciAncnVubmluZycsIGF1dG9maW5pc2hKb2JJbjUwbXNcbiAgICAgICAgZG9uZSBlcnJcblxuICAgIGl0ICdzaG91bGQgbm90IHN0YXJ2ZSBvdGhlciBxdWV1ZXMgaWYgcnVubmluZyBzaWRlIGJ5IHNpZGUnLCAoZG9uZSkgLT5cbiAgICAgIHRhc2tzTnVtYmVyICA9IDIwMDBcbiAgICAgIGNvbmN1cnJlbmN5ICA9IDIwXG4gICAgICB3b3JrZXJzQ291bnQgPSA1XG5cbiAgICAgIHdvcmtlcnMgPSBbXVxuICAgICAgYXN5bmMubWFwIFsxLi53b3JrZXJzQ291bnRdLCAoaWR4LCBuZXh0KSAtPlxuICAgICAgICB3b3JrZXIgPSBjcmVhdGVXb3JrZXIgXCJzYW1lX2lkXCIsIGNvbmN1cnJlbmN5XG4gICAgICAgIGNsZWFuV29ya2VyIHdvcmtlciwgKGVycikgLT5cbiAgICAgICAgICByZXR1cm4gbmV4dCBlcnIgaWYgZXJyXG5cbiAgICAgICAgICB3b3JrZXIud2FpdEZvclRhc2tzIChlcnIpIC0+XG4gICAgICAgICAgICBuZXh0IGVyciwgd29ya2VyXG4gICAgICAsIChlcnIsIHdvcmtlcnMpIC0+XG4gICAgICAgIGF1dG9maW5pc2hKb2JJbjUwbXNGYWN0b3J5ID0gKHdvcmtlcikgLT5cbiAgICAgICAgICAoaWQpIC0+XG4gICAgICAgICAgICBzZXRUaW1lb3V0ICgpIC0+XG4gICAgICAgICAgICAgIHdvcmtlci5maW5pc2hUYXNrKGlkKVxuICAgICAgICAgICAgLCAoODAgKyBNYXRoLnJhbmRvbSgpICogNDApXG5cbiAgICAgICAgZm9yIHdvcmtlciBpbiB3b3JrZXJzXG4gICAgICAgICAgd29ya2VyLmF1dG9maW5pc2hKb2JJbjUwbXMgPSBhdXRvZmluaXNoSm9iSW41MG1zRmFjdG9yeSh3b3JrZXIpXG4gICAgICAgICAgd29ya2VyLmVtaXR0ZXIub24gJ3J1bm5pbmcnLCB3b3JrZXIuYXV0b2ZpbmlzaEpvYkluNTBtc1xuXG4gICAgICAgIGNvdW50QWxsRG9uZVRhc2tzID0gKCkgLT4gXy5yZWR1Y2Ugd29ya2VycywgKChzdW0sIHdvcmtlcikgLT4gc3VtICsgd29ya2VyLmRvbmVUYXNrcy5sZW5ndGgpLCAwXG5cbiAgICAgICAgYXN5bmMuc2VyaWVzIFtcbiAgICAgICAgICAobmV4dCkgLT5cbiAgICAgICAgICAgIGFzeW5jLmVhY2ggWzEuLnRhc2tzTnVtYmVyXSwgKGlkLCBpbm5lck5leHQpIC0+XG4gICAgICAgICAgICAgIHdvcmtlcnNbMF0ucHVzaEpvYiB7IGlkOiBcIkEje2lkfVwiIH0sIGlubmVyTmV4dFxuICAgICAgICAgICAgLCBuZXh0XG4gICAgICAgICAgKG5leHQpIC0+XG4gICAgICAgICAgICB3YWl0VW50aWwgKCkgLT5cbiAgICAgICAgICAgICAgY291bnRBbGxEb25lVGFza3MoKSA9PSB0YXNrc051bWJlclxuICAgICAgICAgICAgLCBuZXh0LFxuICAgICAgICBdLCAoZXJyKSAtPlxuICAgICAgICAgIGZvciB3b3JrZXIgaW4gd29ya2Vyc1xuICAgICAgICAgICAgd29ya2VyLmVtaXR0ZXIucmVtb3ZlTGlzdGVuZXIgJ3J1bm5pbmcnLCB3b3JrZXIuYXV0b2ZpbmlzaEpvYkluNTBtc1xuXG4gICAgICAgICAgZG9uZVRhc2tzID0gXy5tYXAgd29ya2VycywgKHdvcmtlcikgLT4gd29ya2VyLmRvbmVUYXNrcy5sZW5ndGhcbiAgICAgICAgICBleHBlY3QoTWF0aC5zdERldiBkb25lVGFza3MpLnRvLmJlLmJlbG93KHRhc2tzTnVtYmVyIC8gMTAwLjApXG5cbiAgICAgICAgICBkb25lIGVyclxuXG4gICAgaXQgJ3Nob3VsZCBub3Qgc3RhcnZlIG90aGVyIHF1ZXVlcyBpZiBzdGFydGluZyB3aXRoIHB1c2hlZCB0YXNrcycsIChkb25lKSAtPlxuICAgICAgdGFza3NOdW1iZXIgID0gNDAwXG4gICAgICBjb25jdXJyZW5jeSAgPSAyMFxuICAgICAgd29ya2Vyc0NvdW50ID0gNVxuXG4gICAgICB3b3JrZXJzID0gW11cbiAgICAgIGFzeW5jLm1hcCBbMS4ud29ya2Vyc0NvdW50XSwgKGlkeCwgbmV4dCkgLT5cbiAgICAgICAgd29ya2VyID0gY3JlYXRlV29ya2VyIFwic2FtZV9pZDJcIiwgY29uY3VycmVuY3lcbiAgICAgICAgY2xlYW5Xb3JrZXIgd29ya2VyLCAoZXJyKSAtPlxuICAgICAgICAgIG5leHQgZXJyLCB3b3JrZXJcbiAgICAgICwgKGVyciwgd29ya2VycykgLT5cbiAgICAgICAgYXV0b2ZpbmlzaEpvYkluNTBtc0ZhY3RvcnkgPSAod29ya2VyKSAtPlxuICAgICAgICAgIChpZCkgLT5cbiAgICAgICAgICAgIHNldFRpbWVvdXQgKCkgLT5cbiAgICAgICAgICAgICAgd29ya2VyLmZpbmlzaFRhc2soaWQpXG4gICAgICAgICAgICAsICg4MCArIE1hdGgucmFuZG9tKCkgKiA0MClcblxuICAgICAgICBmb3Igd29ya2VyIGluIHdvcmtlcnNcbiAgICAgICAgICB3b3JrZXIuYXV0b2ZpbmlzaEpvYkluNTBtcyA9IGF1dG9maW5pc2hKb2JJbjUwbXNGYWN0b3J5KHdvcmtlcilcbiAgICAgICAgICB3b3JrZXIuZW1pdHRlci5vbiAncnVubmluZycsIHdvcmtlci5hdXRvZmluaXNoSm9iSW41MG1zXG5cbiAgICAgICAgY291bnRBbGxEb25lVGFza3MgPSAoKSAtPiBfLnJlZHVjZSB3b3JrZXJzLCAoKHN1bSwgd29ya2VyKSAtPiBzdW0gKyB3b3JrZXIuZG9uZVRhc2tzLmxlbmd0aCksIDBcblxuICAgICAgICBhc3luYy5zZXJpZXMgW1xuICAgICAgICAgIChuZXh0KSAtPlxuICAgICAgICAgICAgYXN5bmMuZWFjaCBbMS4udGFza3NOdW1iZXJdLCAoaWQsIGlubmVyTmV4dCkgLT5cbiAgICAgICAgICAgICAgd29ya2Vyc1swXS5wdXNoSm9iIHsgaWQ6IFwiQiN7aWR9XCIgfSwgaW5uZXJOZXh0XG4gICAgICAgICAgICAsIG5leHRcbiAgICAgICAgICAobmV4dCkgLT5cbiAgICAgICAgICAgIGFzeW5jLmVhY2ggd29ya2VycywgKHdvcmtlciwgaW5uZXJOZXh0KSAtPlxuICAgICAgICAgICAgICB3b3JrZXIud2FpdEZvclRhc2tzIGlubmVyTmV4dFxuICAgICAgICAgICAgLCBuZXh0XG4gICAgICAgICAgKG5leHQpIC0+XG4gICAgICAgICAgICB3YWl0VW50aWwgKCkgLT5cbiAgICAgICAgICAgICAgY291bnRBbGxEb25lVGFza3MoKSA9PSB0YXNrc051bWJlclxuICAgICAgICAgICAgLCBuZXh0LFxuICAgICAgICBdLCAoZXJyKSAtPlxuICAgICAgICAgIGZvciB3b3JrZXIgaW4gd29ya2Vyc1xuICAgICAgICAgICAgd29ya2VyLmVtaXR0ZXIucmVtb3ZlTGlzdGVuZXIgJ3J1bm5pbmcnLCB3b3JrZXIuYXV0b2ZpbmlzaEpvYkluNTBtc1xuXG4gICAgICAgICAgZG9uZVRhc2tzID0gXy5tYXAgd29ya2VycywgKHdvcmtlcikgLT4gd29ya2VyLmRvbmVUYXNrcy5sZW5ndGhcbiAgICAgICAgICBleHBlY3QoTWF0aC5zdERldiBkb25lVGFza3MpLnRvLmJlLmJlbG93KHRhc2tzTnVtYmVyIC8gMTAwLjApXG5cbiAgICAgICAgICBkb25lIGVyclxuXG4gICAgaXQgJ3Nob3VsZCB1c2UgYWxsIGNvbmN1cnJlbmN5IHNsb3RzIGF0IGFsbCB0aW1lcycsIChkb25lKSAtPlxuICAgICAgdGFza3NOdW1iZXIgID0gMjAwMFxuICAgICAgY29uY3VycmVuY3kgID0gMTBcbiAgICAgIHdvcmtlcnNDb3VudCA9IDVcblxuICAgICAgd29ya2VycyA9IFtdXG4gICAgICBhc3luYy5tYXAgWzEuLndvcmtlcnNDb3VudF0sIChpZHgsIG5leHQpIC0+XG4gICAgICAgIHdvcmtlciA9IGNyZWF0ZVdvcmtlciBcInNhbWVfaWQzXCIsIGNvbmN1cnJlbmN5XG4gICAgICAgIGNsZWFuV29ya2VyIHdvcmtlciwgKGVycikgLT5cbiAgICAgICAgICBuZXh0IGVyciwgd29ya2VyXG4gICAgICAsIChlcnIsIHdvcmtlcnMpIC0+XG4gICAgICAgIGF1dG9maW5pc2hKb2JJbjUwbXNGYWN0b3J5ID0gKHdvcmtlcikgLT5cbiAgICAgICAgICAoaWQpIC0+XG4gICAgICAgICAgICBzZXRUaW1lb3V0ICgpIC0+XG4gICAgICAgICAgICAgIHdvcmtlci5maW5pc2hUYXNrKGlkKVxuICAgICAgICAgICAgLCAoNDAgKyBNYXRoLnJhbmRvbSgpICogNDApXG5cbiAgICAgICAgZm9yIHdvcmtlciBpbiB3b3JrZXJzXG4gICAgICAgICAgd29ya2VyLmF1dG9maW5pc2hKb2JJbjUwbXMgPSBhdXRvZmluaXNoSm9iSW41MG1zRmFjdG9yeSh3b3JrZXIpXG4gICAgICAgICAgd29ya2VyLmVtaXR0ZXIub24gJ3J1bm5pbmcnLCB3b3JrZXIuYXV0b2ZpbmlzaEpvYkluNTBtc1xuXG4gICAgICAgIGNvdW50QWxsRG9uZVRhc2tzICAgID0gKCkgLT4gXy5yZWR1Y2Ugd29ya2VycywgKChzdW0sIHdvcmtlcikgLT4gc3VtICsgd29ya2VyLmRvbmVUYXNrcy5sZW5ndGgpLCAwXG4gICAgICAgIHN1bW1hcml6ZUFsbFJ1bm5pbmdUYXNrcyA9ICgpIC0+IF8ubWFwIHdvcmtlcnMsICh3b3JrZXIpIC0+IHdvcmtlci5ydW5uaW5nVGFza3MubGVuZ3RoXG5cbiAgICAgICAgd29ya2Vyc1J1bm5pbmdUYXNrc1Byb2ZpbGUgID0gW11cbiAgICAgICAgcHJvZmlsZXJUaW1lckpvYiA9IHNldEludGVydmFsICgpIC0+XG4gICAgICAgICAgd29ya2Vyc1J1bm5pbmdUYXNrc1Byb2ZpbGUucHVzaCBzdW1tYXJpemVBbGxSdW5uaW5nVGFza3MoKVxuICAgICAgICAsIDEwXG5cbiAgICAgICAgYXN5bmMuc2VyaWVzIFtcbiAgICAgICAgICAobmV4dCkgLT5cbiAgICAgICAgICAgIGFzeW5jLmVhY2ggWzEuLnRhc2tzTnVtYmVyXSwgKGlkLCBpbm5lck5leHQpIC0+XG4gICAgICAgICAgICAgIHdvcmtlcnNbMF0ucHVzaEpvYiB7IGlkOiBcIkIje2lkfVwiIH0sIGlubmVyTmV4dFxuICAgICAgICAgICAgLCBuZXh0XG4gICAgICAgICAgKG5leHQpIC0+XG4gICAgICAgICAgICBhc3luYy5lYWNoIHdvcmtlcnMsICh3b3JrZXIsIGlubmVyTmV4dCkgLT5cbiAgICAgICAgICAgICAgd29ya2VyLndhaXRGb3JUYXNrcyBpbm5lck5leHRcbiAgICAgICAgICAgICwgbmV4dFxuICAgICAgICAgIChuZXh0KSAtPlxuICAgICAgICAgICAgd2FpdFVudGlsICgpIC0+XG4gICAgICAgICAgICAgIGNvdW50QWxsRG9uZVRhc2tzKCkgPT0gdGFza3NOdW1iZXJcbiAgICAgICAgICAgICwgbmV4dCxcbiAgICAgICAgXSwgKGVycikgLT5cbiAgICAgICAgICBmb3Igd29ya2VyIGluIHdvcmtlcnNcbiAgICAgICAgICAgIHdvcmtlci5lbWl0dGVyLnJlbW92ZUxpc3RlbmVyICdydW5uaW5nJywgd29ya2VyLmF1dG9maW5pc2hKb2JJbjUwbXNcbiAgICAgICAgICBjbGVhckludGVydmFsIHByb2ZpbGVyVGltZXJKb2JcblxuICAgICAgICAgIHJ1bm5pbmdUYXNrc01lYW5QZXJXb3JrZXIgID0gW11cbiAgICAgICAgICBydW5uaW5nVGFza3NTdERldlBlcldvcmtlciA9IFtdXG4gICAgICAgICAgZm9yIHdvcmtlcklkeCBpbiBbMC4uLndvcmtlcnMubGVuZ3RoXVxuICAgICAgICAgICAgd29ya2VyUnVubmluZ1Rhc2tzUHJvZmlsZSA9IF8ubWFwIHdvcmtlcnNSdW5uaW5nVGFza3NQcm9maWxlLCAocnVubmluZ1Rhc2tzUHJvZmlsZSkgLT4gcnVubmluZ1Rhc2tzUHJvZmlsZVt3b3JrZXJJZHhdXG4gICAgICAgICAgICB3b3JrZXJSdW5uaW5nVGFza3NQcm9maWxlT25seU1pZFBvaW50cyA9IHdvcmtlclJ1bm5pbmdUYXNrc1Byb2ZpbGVbMTAuLi0yMF1cblxuICAgICAgICAgICAgcnVubmluZ1Rhc2tzTWVhblBlcldvcmtlci5wdXNoICBNYXRoLm1lYW4od29ya2VyUnVubmluZ1Rhc2tzUHJvZmlsZU9ubHlNaWRQb2ludHMpXG4gICAgICAgICAgICBydW5uaW5nVGFza3NTdERldlBlcldvcmtlci5wdXNoIE1hdGguc3REZXYod29ya2VyUnVubmluZ1Rhc2tzUHJvZmlsZU9ubHlNaWRQb2ludHMpXG5cbiAgICAgICAgICBleHBlY3QoXy5taW4gcnVubmluZ1Rhc2tzTWVhblBlcldvcmtlcikudG8uYmUuYWJvdmUoY29uY3VycmVuY3kgKiAwLjkpXG4gICAgICAgICAgZXhwZWN0KF8ubWF4IHJ1bm5pbmdUYXNrc1N0RGV2UGVyV29ya2VyKS50by5iZS5iZWxvdyhjb25jdXJyZW5jeSAqIDAuMSlcblxuICAgICAgICAgIGRvbmUgZXJyXG5cbiAgICBpdCAnc2hvdWxkIG5vdCB1c2UgcmVkaXMgbW9yZSB0aGFuIG5lY2Vzc2FyeScsIChkb25lKSAtPlxuICAgICAgdGFza3NOdW1iZXJQZXJXb3JrZXIgPSAyMDBcbiAgICAgIGNvbmN1cnJlbmN5ICA9IDVcbiAgICAgIHdvcmtlcnNDb3VudCA9IDNcblxuICAgICAgd29ya2VycyA9IFtdXG4gICAgICBhc3luYy5tYXAgWzEuLndvcmtlcnNDb3VudF0sIChpZHgsIG5leHQpIC0+XG4gICAgICAgIHdvcmtlciA9IGNyZWF0ZVdvcmtlciBcInRlc3QxX3dvcmtlciN7aWR4fVwiLCBjb25jdXJyZW5jeVxuXG4gICAgICAgICMgU2V0dXAgcmVkaXMgY2FsbCBzcHkuXG4gICAgICAgIHNpbm9uLnNweSB3b3JrZXIsICdwb3BKb2JGcm9tUXVldWUnXG5cbiAgICAgICAgIyBQcmVwYXJlIHdvcmtlci5cbiAgICAgICAgY2xlYW5Xb3JrZXIgd29ya2VyLCAoZXJyKSAtPlxuICAgICAgICAgIHJldHVybiBuZXh0IGVyciBpZiBlcnJcblxuICAgICAgICAgIHdvcmtlci53YWl0Rm9yVGFza3MgKGVycikgLT5cbiAgICAgICAgICAgIG5leHQgZXJyLCB3b3JrZXJcbiAgICAgICwgKGVyciwgd29ya2VycykgLT5cbiAgICAgICAgYXV0b2ZpbmlzaEpvYkluNTBtc0ZhY3RvcnkgPSAod29ya2VyKSAtPlxuICAgICAgICAgIChpZCkgLT5cbiAgICAgICAgICAgIHNldFRpbWVvdXQgKCkgLT5cbiAgICAgICAgICAgICAgd29ya2VyLmZpbmlzaFRhc2soaWQpXG4gICAgICAgICAgICAsICg0MCArIE1hdGgucmFuZG9tKCkgKiA0MClcblxuICAgICAgICBmb3Igd29ya2VyIGluIHdvcmtlcnNcbiAgICAgICAgICB3b3JrZXIuYXV0b2ZpbmlzaEpvYkluNTBtcyA9IGF1dG9maW5pc2hKb2JJbjUwbXNGYWN0b3J5KHdvcmtlcilcbiAgICAgICAgICB3b3JrZXIuZW1pdHRlci5vbiAncnVubmluZycsIHdvcmtlci5hdXRvZmluaXNoSm9iSW41MG1zXG5cbiAgICAgICAgY291bnRBbGxEb25lVGFza3MgPSAoKSAtPiBfLnJlZHVjZSB3b3JrZXJzLCAoKHN1bSwgd29ya2VyKSAtPiBzdW0gKyB3b3JrZXIuZG9uZVRhc2tzLmxlbmd0aCksIDBcblxuICAgICAgICBhc3luYy5zZXJpZXMgW1xuICAgICAgICAgIChuZXh0KSAtPlxuICAgICAgICAgICAgIyBBZGQgJ3Rhc2tzTnVtYmVyUGVyV29ya2VyJyB0YXNrcyBmb3IgZWFjaCBvZiB0aGUgKHNlcGFyYXRlISkgd29ya2Vyc1xuICAgICAgICAgICAgYXN5bmMuZWFjaCB3b3JrZXJzLCAod29ya2VyLCBpbm5lck5leHQpIC0+XG4gICAgICAgICAgICAgIGFzeW5jLmVhY2ggWzEuLnRhc2tzTnVtYmVyUGVyV29ya2VyXSwgKGlkLCBpbm5lcklubmVyTmV4dCkgLT5cbiAgICAgICAgICAgICAgICB3b3JrZXIucHVzaEpvYiB7IGlkOiBcIkEje2lkfVwiIH0sIGlubmVySW5uZXJOZXh0XG4gICAgICAgICAgICAgICwgaW5uZXJOZXh0XG4gICAgICAgICAgICAsIG5leHRcbiAgICAgICAgICAobmV4dCkgLT5cbiAgICAgICAgICAgICMgV2FpdCB0aWxsIHRoZXkgZmluaXNoLlxuICAgICAgICAgICAgd2FpdFVudGlsICgpIC0+XG4gICAgICAgICAgICAgIGNvdW50QWxsRG9uZVRhc2tzKCkgPT0gdGFza3NOdW1iZXJQZXJXb3JrZXIgKiB3b3JrZXJzQ291bnRcbiAgICAgICAgICAgICwgbmV4dCxcbiAgICAgICAgICAobmV4dCkgLT5cbiAgICAgICAgICAgICMgQWRkICd0YXNrc051bWJlclBlcldvcmtlcicgdGFza3MgZm9yIG9ubHkgb25lIG9mIHRoZSB3b3JrZXJzXG4gICAgICAgICAgICBhc3luYy5lYWNoIFsxLi50YXNrc051bWJlclBlcldvcmtlcl0sIChpZCwgaW5uZXJOZXh0KSAtPlxuICAgICAgICAgICAgICB3b3JrZXJzWzBdLnB1c2hKb2IgeyBpZDogXCJCI3tpZH1cIiB9LCBpbm5lck5leHRcbiAgICAgICAgICAgICwgbmV4dFxuICAgICAgICAgICAgIyBBZGQgJ3Rhc2tzTnVtYmVyUGVyV29ya2VyJyB0YXNrcyBmb3Igb25seSBvbmUgb2YgdGhlIHdvcmtlcnNcbiAgICAgICAgICAgIGFzeW5jLmVhY2ggWzEuLnRhc2tzTnVtYmVyUGVyV29ya2VyXSwgKGlkLCBpbm5lck5leHQpIC0+XG4gICAgICAgICAgICAgIHdvcmtlcnNbMV0ucHVzaEpvYiB7IGlkOiBcIkIje2lkfVwiIH0sIGlubmVyTmV4dFxuICAgICAgICAgICAgLCBuZXh0XG4gICAgICAgICAgKG5leHQpIC0+XG4gICAgICAgICAgICAjIFdhaXQgdGlsbCBpdCdzIGZpbmlzaGVkLlxuICAgICAgICAgICAgd2FpdFVudGlsICgpIC0+XG4gICAgICAgICAgICAgIHdvcmtlcnNbMF0uZG9uZVRhc2tzLmxlbmd0aCA9PSAyICogdGFza3NOdW1iZXJQZXJXb3JrZXIgYW5kIHdvcmtlcnNbMV0uZG9uZVRhc2tzLmxlbmd0aCA9PSAyICogdGFza3NOdW1iZXJQZXJXb3JrZXJcbiAgICAgICAgICAgICwgbmV4dCxcbiAgICAgICAgICAobmV4dCkgLT5cbiAgICAgICAgICAgICMgQWRkICd0YXNrc051bWJlclBlcldvcmtlcicgdGFza3MgZm9yIG9ubHkgb25lIG9mIHRoZSB3b3JrZXJzXG4gICAgICAgICAgICBhc3luYy5lYWNoIFsxLi50YXNrc051bWJlclBlcldvcmtlcl0sIChpZCwgaW5uZXJOZXh0KSAtPlxuICAgICAgICAgICAgICB3b3JrZXJzWzJdLnB1c2hKb2IgeyBpZDogXCJDI3tpZH1cIiB9LCBpbm5lck5leHRcbiAgICAgICAgICAgICwgbmV4dFxuICAgICAgICAgIChuZXh0KSAtPlxuICAgICAgICAgICAgIyBXYWl0IHRpbGwgaXQncyBmaW5pc2hlZC5cbiAgICAgICAgICAgIHdhaXRVbnRpbCAoKSAtPlxuICAgICAgICAgICAgICB3b3JrZXJzWzJdLmRvbmVUYXNrcy5sZW5ndGggPT0gMiAqIHRhc2tzTnVtYmVyUGVyV29ya2VyXG4gICAgICAgICAgICAsIG5leHQsXG4gICAgICAgIF0sIChlcnIpIC0+XG4gICAgICAgICAgIyBDbGVhbnVwXG4gICAgICAgICAgZm9yIHdvcmtlciBpbiB3b3JrZXJzXG4gICAgICAgICAgICAjIENvdW50IG51bWJlciBvZiB0aW1lcyByZWRpcyB3YXMgY2FsbGVkLlxuICAgICAgICAgICAgZXhwZWN0KHdvcmtlci5wb3BKb2JGcm9tUXVldWUuY2FsbENvdW50KS50by5iZS5iZWxvdyh3b3JrZXIuZG9uZVRhc2tzLmxlbmd0aCAqIDEuMilcblxuICAgICAgICAgICAgd29ya2VyLmVtaXR0ZXIucmVtb3ZlTGlzdGVuZXIgJ3J1bm5pbmcnLCB3b3JrZXIuYXV0b2ZpbmlzaEpvYkluNTBtc1xuICAgICAgICAgICAgd29ya2VyLnBvcEpvYkZyb21RdWV1ZS5yZXN0b3JlKClcblxuICAgICAgICAgIGRvbmUgZXJyXG4iXX0=