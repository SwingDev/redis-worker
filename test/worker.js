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

  TestWorker.prototype.error = function(err, task, done) {
    return done();
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
    it('should exit process on unhandled exc. letting all running tasks finish', function(done) {
      var autofinishJob, concurrency, excThrowingTaskId, processExit, worker;
      concurrency = 5;
      excThrowingTaskId = null;
      processExit = function(code) {
        var err;
        try {
          expect(worker.runningTasks).to.eql([excThrowingTaskId]);
          expect(worker.doneTasks.length).to.equal(concurrency - 1);
          expect(worker.failedTasks.length).to.equal(0);
          return done();
        } catch (_error) {
          err = _error;
          return done(err);
        } finally {
          process.exit.restore();
        }
      };
      sinon.stub(process, 'exit', processExit);
      worker = createWorker("exit_test_1", concurrency);
      autofinishJob = function(id) {
        if (worker.runningTasks.length > (concurrency - 1)) {
          excThrowingTaskId = id;
          throw new Error("Unhandled exception mock.");
        }
        return setTimeout(function() {
          return worker.finishTask(id);
        }, 1000 + Math.random() * 500);
      };
      worker.emitter.on('running', autofinishJob);
      return async.series([
        function(next) {
          return cleanWorker(worker, next);
        }, function(next) {
          return worker.waitForTasks(next);
        }, function(next) {
          var _i, _results;
          return async.each((function() {
            _results = [];
            for (var _i = 1; 1 <= concurrency ? _i <= concurrency : _i >= concurrency; 1 <= concurrency ? _i++ : _i--){ _results.push(_i); }
            return _results;
          }).apply(this), function(id, innerNext) {
            return worker.pushJob({
              id: id
            }, innerNext);
          }, next);
        }
      ], function(err) {
        if (err) {
          return done(err);
        }
      });
    });
    it('should exit process on two unhandled exc. letting all running tasks finish', function(done) {
      var autofinishJob, concurrency, excThrowingTaskIds, processExit, worker;
      concurrency = 5;
      excThrowingTaskIds = [];
      processExit = function(code) {
        var err;
        try {
          expect(worker.runningTasks).to.eql(excThrowingTaskIds);
          expect(worker.doneTasks.length).to.equal(concurrency - 2);
          expect(worker.failedTasks.length).to.equal(0);
          return done();
        } catch (_error) {
          err = _error;
          return done(err);
        } finally {
          process.exit.restore();
        }
      };
      sinon.stub(process, 'exit', processExit);
      worker = createWorker("exit_test_1", concurrency);
      autofinishJob = function(id) {
        if (worker.runningTasks.length > (concurrency - 2)) {
          excThrowingTaskIds.push(id);
          throw new Error("Unhandled exception mock.");
        }
        return setTimeout(function() {
          return worker.finishTask(id);
        }, 1000 + Math.random() * 500);
      };
      worker.emitter.on('running', autofinishJob);
      return async.series([
        function(next) {
          return cleanWorker(worker, next);
        }, function(next) {
          return worker.waitForTasks(next);
        }, function(next) {
          var _i, _results;
          return async.each((function() {
            _results = [];
            for (var _i = 1; 1 <= concurrency ? _i <= concurrency : _i >= concurrency; 1 <= concurrency ? _i++ : _i--){ _results.push(_i); }
            return _results;
          }).apply(this), function(id, innerNext) {
            return worker.pushJob({
              id: id
            }, innerNext);
          }, next);
        }
      ], function(err) {
        if (err) {
          return done(err);
        }
      });
    });
    it('should exit process on unhandled exc. killing all running tasks if they don\'t manage to finish on time', function(done) {
      var autofinishJob, concurrency, excThrowingTaskId, processExit, worker;
      concurrency = 5;
      excThrowingTaskId = null;
      processExit = function(code) {
        var err, _i, _results;
        try {
          expect(worker.runningTasks).to.eql((function() {
            _results = [];
            for (var _i = 1; 1 <= concurrency ? _i <= concurrency : _i >= concurrency; 1 <= concurrency ? _i++ : _i--){ _results.push(_i); }
            return _results;
          }).apply(this));
          expect(worker.doneTasks.length).to.equal(0);
          expect(worker.failedTasks.length).to.equal(0);
          return done();
        } catch (_error) {
          err = _error;
          return done(err);
        } finally {
          process.exit.restore();
        }
      };
      sinon.stub(process, 'exit', processExit);
      worker = createWorker("exit_test_1", concurrency);
      worker.gracefulShutdownTimeout = 1000;
      autofinishJob = function(id) {
        if (worker.runningTasks.length > (concurrency - 1)) {
          excThrowingTaskId = id;
          throw new Error("Unhandled exception mock.");
        }
        return setTimeout(function() {
          return worker.finishTask(id);
        }, 150000 + Math.random() * 500);
      };
      worker.emitter.on('running', autofinishJob);
      return async.series([
        function(next) {
          return cleanWorker(worker, next);
        }, function(next) {
          return worker.waitForTasks(next);
        }, function(next) {
          var _i, _results;
          return async.each((function() {
            _results = [];
            for (var _i = 1; 1 <= concurrency ? _i <= concurrency : _i >= concurrency; 1 <= concurrency ? _i++ : _i--){ _results.push(_i); }
            return _results;
          }).apply(this), function(id, innerNext) {
            return worker.pushJob({
              id: id
            }, innerNext);
          }, next);
        }
      ], function(err) {
        if (err) {
          return done(err);
        }
      });
    });
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
          expect(_.max(runningTasksStDevPerWorker)).to.be.below(concurrency * 0.2);
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

//# sourceMappingURL=data:application/json;base64,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QUFELEdBQUE7QUFFRCxjQUFBLFNBQUE7QUFBQSxlQUFBLGdEQUFBO2lDQUFBO0FBRUUsWUFBQSxNQUFBLENBQU8sTUFBTSxDQUFDLGVBQWUsQ0FBQyxTQUE5QixDQUF3QyxDQUFDLEVBQUUsQ0FBQyxFQUFFLENBQUMsS0FBL0MsQ0FBcUQsTUFBTSxDQUFDLFNBQVMsQ0FBQyxNQUFqQixHQUEwQixHQUEvRSxDQUFBLENBQUE7QUFBQSxZQUVBLE1BQU0sQ0FBQyxPQUFPLENBQUMsY0FBZixDQUE4QixTQUE5QixFQUF5QyxNQUFNLENBQUMsbUJBQWhELENBRkEsQ0FBQTtBQUFBLFlBR0EsTUFBTSxDQUFDLGVBQWUsQ0FBQyxPQUF2QixDQUFBLENBSEEsQ0FGRjtBQUFBLFdBQUE7aUJBT0EsSUFBQSxDQUFLLEdBQUwsRUFUQztRQUFBLENBckNILEVBYkE7TUFBQSxDQVpGLEVBTjZDO0lBQUEsQ0FBL0MsRUFyTDRCO0VBQUEsQ0FBOUIsRUF0SzZCO0FBQUEsQ0FBL0IsQ0EvSUEsQ0FBQSIsImZpbGUiOiJ0ZXN0L3dvcmtlci5qcyIsInNvdXJjZVJvb3QiOiIvc291cmNlLyIsInNvdXJjZXNDb250ZW50IjpbIl8gICAgICAgICA9IHJlcXVpcmUoJ2xvZGFzaCcpXG5cbmFzeW5jICAgICA9IHJlcXVpcmUoJ2FzeW5jJylcbnJlZGlzICAgICA9IHJlcXVpcmUoJ3JlZGlzJylcbmZha2VyZWRpcyA9IHJlcXVpcmUoJ2Zha2VyZWRpcycpXG5jaGFpICAgICAgPSByZXF1aXJlKCdjaGFpJylcbmV4cGVjdCAgICA9IHJlcXVpcmUoJ2NoYWknKS5leHBlY3RcbnNpbm9uICAgICA9IHJlcXVpcmUoJ3Npbm9uJylcblxuUmVkaXNXb3JrZXIgPSByZXF1aXJlKCcuLi9saWIvaW5kZXguanMnKVxuV29ya2VyICAgICAgPSBSZWRpc1dvcmtlci5Xb3JrZXJcblxuRXZlbnRFbWl0dGVyID0gcmVxdWlyZSgnZXZlbnRzJykuRXZlbnRFbWl0dGVyXG5cbmNsYXNzIFRlc3RXb3JrZXIgZXh0ZW5kcyBXb3JrZXJcbiAgY29uc3RydWN0b3I6IChAdXJsLCBAdGFza0xpbWl0KSAtPlxuICAgIHN1cGVyXG5cbiAgICBAZW1pdHRlciAgICAgICAgPSBuZXcgRXZlbnRFbWl0dGVyKClcbiAgICBAcmVzZXQoKVxuXG4gIG5hbWU6ICgpIC0+IFwiVGVzdCN7QHdvcmtlcklEfVwiXG5cbiAgcmVzZXQ6ICgpIC0+XG4gICAgQHBlbmRpbmdUYXNrcyAgID0gW11cbiAgICBAcnVubmluZ1Rhc2tzICAgPSBbXVxuICAgIEBkb25lVGFza3MgICAgICA9IFtdXG4gICAgQGZhaWxlZFRhc2tzICAgID0gW11cbiAgICBAdGFza3NDYWxsYmFja3MgPSB7fVxuXG4gICAgQG1heFJ1bm5pbmdBdE9uY2UgPSAwXG5cbiAgZXJyb3JUYXNrOiAoaWQpIC0+XG4gICAgZXhwZWN0KEBydW5uaW5nVGFza3MpLnRvLmNvbnRhaW4gaWRcbiAgICBleHBlY3QoQGRvbmVUYXNrcykudG8ubm90LmNvbnRhaW4gaWRcbiAgICBleHBlY3QoQGZhaWxlZFRhc2tzKS50by5ub3QuY29udGFpbiBpZFxuXG4gICAgQGZhaWxlZFRhc2tzLnB1c2ggaWRcbiAgICBAcnVubmluZ1Rhc2tzID0gXy5yZWplY3QgQHJ1bm5pbmdUYXNrcywgKHJ1bm5pbmdJdGVtSUQpIC0+IHJ1bm5pbmdJdGVtSUQgPT0gaWRcblxuICAgIEBlbWl0dGVyLmVtaXQgJ2ZhaWxlZCcsIGlkXG5cbiAgICBAdGFza3NDYWxsYmFja3NbaWRdIG5ldyBFcnJvcihcImVycm9yXCIpXG5cbiAgZmluaXNoU29tZVRhc2s6ICgpIC0+XG4gICAgQGZpbmlzaFRhc2sgQHJ1bm5pbmdUYXNrc1swXVxuXG4gIGZpbmlzaFRhc2s6IChpZCkgLT5cbiAgICBleHBlY3QoQHJ1bm5pbmdUYXNrcykudG8uY29udGFpbiBpZFxuICAgIGV4cGVjdChAZG9uZVRhc2tzKS50by5ub3QuY29udGFpbiBpZFxuICAgIGV4cGVjdChAZmFpbGVkVGFza3MpLnRvLm5vdC5jb250YWluIGlkXG5cbiAgICBAZG9uZVRhc2tzLnB1c2ggaWRcbiAgICBAcnVubmluZ1Rhc2tzID0gXy5yZWplY3QgQHJ1bm5pbmdUYXNrcywgKHJ1bm5pbmdJdGVtSUQpIC0+IHJ1bm5pbmdJdGVtSUQgPT0gaWRcblxuICAgIEBlbWl0dGVyLmVtaXQgJ2RvbmUnLCBpZFxuXG4gICAgQHRhc2tzQ2FsbGJhY2tzW2lkXSgpXG5cbiAgcHVzaEpvYjogKHBheWxvYWQsIGNiKSAtPlxuICAgIHN1cGVyXG4gICAgQHBlbmRpbmdUYXNrcy5wdXNoIHBheWxvYWQuaWRcblxuICB3b3JrOiAocGF5bG9hZCwgZG9uZSkgLT5cbiAgICBwYXlsb2FkID0gSlNPTi5wYXJzZShwYXlsb2FkKVxuXG4gICAgaWQgPSBwYXlsb2FkLmlkXG5cbiAgICBAdGFza3NDYWxsYmFja3NbaWRdID0gZG9uZVxuXG4gICAgQHJ1bm5pbmdUYXNrcy5wdXNoIGlkXG4gICAgQHBlbmRpbmdUYXNrcyA9IF8ucmVqZWN0IEBwZW5kaW5nVGFza3MsIChwZW5kaW5nSXRlbUlEKSAtPiBwZW5kaW5nSXRlbUlEID09IGlkXG5cbiAgICBAZW1pdHRlci5lbWl0ICdydW5uaW5nJywgaWRcblxuICAgIEBtYXhSdW5uaW5nQXRPbmNlID0gTWF0aC5tYXgoQG1heFJ1bm5pbmdBdE9uY2UsIEBydW5uaW5nVGFza3MubGVuZ3RoKVxuXG4gIGVycm9yOiAoZXJyLCB0YXNrLCBkb25lKSAtPlxuICAgICNjb25zb2xlLmxvZyAnW0Vycm9yXScsIGVyciBpZiBlcnJcbiAgICBkb25lKClcblxuXG5jcmVhdGVXb3JrZXIgPSAod29ya2VySUQsIHRhc2tMaW1pdCkgLT5cbiAgd29ya2VyID0gbmV3IFRlc3RXb3JrZXIgXCJyZWRpczovL2xvY2FsaG9zdDo2Mzc5LzMyXCIsIHRhc2tMaW1pdFxuICB3b3JrZXIud29ya2VySUQgPSB3b3JrZXJJRFxuXG4gIHdvcmtlclxuXG5jbGVhbldvcmtlciA9ICh3b3JrZXIsIGNhbGxiYWNrKSAtPlxuICB3b3JrZXIucmVzZXQoKVxuICB3b3JrZXIub2J0YWluTGlzdENsaWVudCAoZXJyLCBjbGllbnQpIC0+XG4gICAgcmV0dXJuIGNhbGxiYWNrIGVyciBpZiBlcnJcblxuICAgIGFzeW5jLnBhcmFsbGVsIFtcbiAgICAgIChuZXh0KSAtPiBjbGllbnQuZGVsIHdvcmtlci5saXN0S2V5KCksIG5leHQsXG4gICAgICAobmV4dCkgLT4gY2xpZW50LmRlbCB3b3JrZXIuY2hhbm5lbEtleSgpLCBuZXh0XG4gICAgXSwgY2FsbGJhY2tcblxuXG5jb25jdXJyZW5jeTFXb3JrZXIgPSBudWxsXG5jb25jdXJyZW5jeTJXb3JrZXIgPSBudWxsXG5cbmJlZm9yZSAoZG9uZSkgLT5cbiAgc2lub24uc3R1YihyZWRpcywgJ2NyZWF0ZUNsaWVudCcsIGZha2VyZWRpcy5jcmVhdGVDbGllbnQpXG5cbiAgY29uY3VycmVuY3kxV29ya2VyID0gY3JlYXRlV29ya2VyKFwiY29uY3VycmVuY3kxV29ya2VyXCIsIDEpXG4gIGNvbmN1cnJlbmN5MldvcmtlciA9IGNyZWF0ZVdvcmtlcihcImNvbmN1cnJlbmN5MldvcmtlclwiLCAyKVxuXG4gIGFzeW5jLmVhY2ggW2NvbmN1cnJlbmN5MVdvcmtlciwgY29uY3VycmVuY3kyV29ya2VyXVxuICAsICh3b3JrZXIsIG5leHQpIC0+XG4gICAgYXN5bmMuc2VyaWVzIFtcbiAgICAgIChpbm5lck5leHQpIC0+IHdvcmtlci53YWl0Rm9yVGFza3MgaW5uZXJOZXh0XG4gICAgXSwgbmV4dFxuICAsIGRvbmVcblxuYWZ0ZXIgKGRvbmUpIC0+XG4gIGNvbmN1cnJlbmN5MldvcmtlciA9IG51bGxcbiAgY29uY3VycmVuY3kxV29ya2VyID0gbnVsbFxuXG4gIHJlZGlzLmNyZWF0ZUNsaWVudC5yZXN0b3JlKClcblxuICBkb25lKClcblxuYmVmb3JlRWFjaCAoZG9uZSkgLT5cbiAgYXN5bmMuZWFjaCBbY29uY3VycmVuY3kxV29ya2VyLCBjb25jdXJyZW5jeTJXb3JrZXJdLCBjbGVhbldvcmtlciwgZG9uZVxuXG4jIEhlbHBlcnNcbndhaXRVbnRpbCA9ICh0ZXN0RnVuYywgY2FsbGJhY2spIC0+XG4gIGlmIHRlc3RGdW5jKClcbiAgICBjYWxsYmFjaygpXG4gIGVsc2VcbiAgICBzZXRUaW1lb3V0ICgpIC0+XG4gICAgICB3YWl0VW50aWwodGVzdEZ1bmMsIGNhbGxiYWNrKVxuICAgICwgMTAwXG5cbk1hdGgubWVhbiA9IChhcnJheSkgLT4gKF8ucmVkdWNlIGFycmF5LCAoYSwgYikgLT4gYStiKSAvIGFycmF5Lmxlbmd0aFxuXG5NYXRoLnN0RGV2ID0gKGFycmF5KSAtPlxuICBtZWFuID0gTWF0aC5tZWFuIGFycmF5XG4gIGRldiAgPSBfLm1hcCBhcnJheSwgKGl0bSkgLT4gKGl0bS1tZWFuKSAqIChpdG0tbWVhbilcblxuICByZXR1cm4gTWF0aC5zcXJ0IE1hdGgubWVhbihkZXYpXG5cbmRlc2NyaWJlICdyZWRpcy13b3JrZXIgdGVzdHMnLCAoKSAtPlxuICBkZXNjcmliZSAnbm9ybWFsIHRlc3RzJywgKCkgLT4gICAgXG4gICAgaXQgJ3Nob3VsZCBleGl0IHByb2Nlc3Mgb24gdW5oYW5kbGVkIGV4Yy4gbGV0dGluZyBhbGwgcnVubmluZyB0YXNrcyBmaW5pc2gnLCAoZG9uZSkgLT5cbiAgICAgIGNvbmN1cnJlbmN5ID0gNVxuICAgICAgZXhjVGhyb3dpbmdUYXNrSWQgPSBudWxsXG5cbiAgICAgIHByb2Nlc3NFeGl0ID0gKGNvZGUpIC0+XG4gICAgICAgIHRyeVxuICAgICAgICAgIGV4cGVjdCh3b3JrZXIucnVubmluZ1Rhc2tzKS50by5lcWwgW2V4Y1Rocm93aW5nVGFza0lkXVxuICAgICAgICAgIGV4cGVjdCh3b3JrZXIuZG9uZVRhc2tzLmxlbmd0aCkudG8uZXF1YWwgKGNvbmN1cnJlbmN5IC0gMSlcbiAgICAgICAgICBleHBlY3Qod29ya2VyLmZhaWxlZFRhc2tzLmxlbmd0aCkudG8uZXF1YWwgMFxuXG4gICAgICAgICAgZG9uZSgpXG4gICAgICAgIGNhdGNoIGVyclxuICAgICAgICAgIGRvbmUgZXJyICBcbiAgICAgICAgZmluYWxseVxuICAgICAgICAgIHByb2Nlc3MuZXhpdC5yZXN0b3JlKClcblxuICAgICAgc2lub24uc3R1Yihwcm9jZXNzLCAnZXhpdCcsIHByb2Nlc3NFeGl0KVxuXG4gICAgICB3b3JrZXIgPSBjcmVhdGVXb3JrZXIgXCJleGl0X3Rlc3RfMVwiLCBjb25jdXJyZW5jeVxuICAgICAgYXV0b2ZpbmlzaEpvYiA9IChpZCkgLT5cbiAgICAgICAgaWYgd29ya2VyLnJ1bm5pbmdUYXNrcy5sZW5ndGggPiAoY29uY3VycmVuY3kgLSAxKVxuICAgICAgICAgIGV4Y1Rocm93aW5nVGFza0lkID0gaWRcbiAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IgXCJVbmhhbmRsZWQgZXhjZXB0aW9uIG1vY2suXCJcblxuICAgICAgICBzZXRUaW1lb3V0ICgpIC0+XG4gICAgICAgICAgd29ya2VyLmZpbmlzaFRhc2soaWQpXG4gICAgICAgICwgKDEwMDAgKyBNYXRoLnJhbmRvbSgpICogNTAwKVxuXG4gICAgICB3b3JrZXIuZW1pdHRlci5vbiAncnVubmluZycsIGF1dG9maW5pc2hKb2JcblxuICAgICAgYXN5bmMuc2VyaWVzIFtcbiAgICAgICAgKG5leHQpIC0+IGNsZWFuV29ya2VyIHdvcmtlciwgbmV4dCxcbiAgICAgICAgKG5leHQpIC0+IHdvcmtlci53YWl0Rm9yVGFza3MgbmV4dCxcbiAgICAgICAgKG5leHQpIC0+IFxuICAgICAgICAgIGFzeW5jLmVhY2ggWzEuLmNvbmN1cnJlbmN5XSwgKGlkLCBpbm5lck5leHQpIC0+XG4gICAgICAgICAgICB3b3JrZXIucHVzaEpvYiB7IGlkOiBpZCB9LCBpbm5lck5leHRcbiAgICAgICAgICAsIG5leHRcbiAgICAgIF0sIChlcnIpIC0+XG4gICAgICAgIHJldHVybiBkb25lIGVyciBpZiBlcnJcblxuICAgIGl0ICdzaG91bGQgZXhpdCBwcm9jZXNzIG9uIHR3byB1bmhhbmRsZWQgZXhjLiBsZXR0aW5nIGFsbCBydW5uaW5nIHRhc2tzIGZpbmlzaCcsIChkb25lKSAtPlxuICAgICAgY29uY3VycmVuY3kgPSA1XG4gICAgICBleGNUaHJvd2luZ1Rhc2tJZHMgPSBbXVxuXG4gICAgICBwcm9jZXNzRXhpdCA9IChjb2RlKSAtPlxuICAgICAgICB0cnlcbiAgICAgICAgICBleHBlY3Qod29ya2VyLnJ1bm5pbmdUYXNrcykudG8uZXFsIGV4Y1Rocm93aW5nVGFza0lkc1xuICAgICAgICAgIGV4cGVjdCh3b3JrZXIuZG9uZVRhc2tzLmxlbmd0aCkudG8uZXF1YWwgKGNvbmN1cnJlbmN5IC0gMilcbiAgICAgICAgICBleHBlY3Qod29ya2VyLmZhaWxlZFRhc2tzLmxlbmd0aCkudG8uZXF1YWwgMFxuXG4gICAgICAgICAgZG9uZSgpXG4gICAgICAgIGNhdGNoIGVyclxuICAgICAgICAgIGRvbmUgZXJyICBcbiAgICAgICAgZmluYWxseVxuICAgICAgICAgIHByb2Nlc3MuZXhpdC5yZXN0b3JlKClcblxuICAgICAgc2lub24uc3R1Yihwcm9jZXNzLCAnZXhpdCcsIHByb2Nlc3NFeGl0KVxuXG4gICAgICB3b3JrZXIgPSBjcmVhdGVXb3JrZXIgXCJleGl0X3Rlc3RfMVwiLCBjb25jdXJyZW5jeVxuICAgICAgYXV0b2ZpbmlzaEpvYiA9IChpZCkgLT5cbiAgICAgICAgaWYgd29ya2VyLnJ1bm5pbmdUYXNrcy5sZW5ndGggPiAoY29uY3VycmVuY3kgLSAyKVxuICAgICAgICAgIGV4Y1Rocm93aW5nVGFza0lkcy5wdXNoIGlkXG4gICAgICAgICAgdGhyb3cgbmV3IEVycm9yIFwiVW5oYW5kbGVkIGV4Y2VwdGlvbiBtb2NrLlwiXG5cbiAgICAgICAgc2V0VGltZW91dCAoKSAtPlxuICAgICAgICAgIHdvcmtlci5maW5pc2hUYXNrKGlkKVxuICAgICAgICAsICgxMDAwICsgTWF0aC5yYW5kb20oKSAqIDUwMClcblxuICAgICAgd29ya2VyLmVtaXR0ZXIub24gJ3J1bm5pbmcnLCBhdXRvZmluaXNoSm9iXG5cbiAgICAgIGFzeW5jLnNlcmllcyBbXG4gICAgICAgIChuZXh0KSAtPiBjbGVhbldvcmtlciB3b3JrZXIsIG5leHQsXG4gICAgICAgIChuZXh0KSAtPiB3b3JrZXIud2FpdEZvclRhc2tzIG5leHQsXG4gICAgICAgIChuZXh0KSAtPiBcbiAgICAgICAgICBhc3luYy5lYWNoIFsxLi5jb25jdXJyZW5jeV0sIChpZCwgaW5uZXJOZXh0KSAtPlxuICAgICAgICAgICAgd29ya2VyLnB1c2hKb2IgeyBpZDogaWQgfSwgaW5uZXJOZXh0XG4gICAgICAgICAgLCBuZXh0XG4gICAgICBdLCAoZXJyKSAtPlxuICAgICAgICByZXR1cm4gZG9uZSBlcnIgaWYgZXJyXG5cbiAgICBpdCAnc2hvdWxkIGV4aXQgcHJvY2VzcyBvbiB1bmhhbmRsZWQgZXhjLiBraWxsaW5nIGFsbCBydW5uaW5nIHRhc2tzIGlmIHRoZXkgZG9uXFwndCBtYW5hZ2UgdG8gZmluaXNoIG9uIHRpbWUnLCAoZG9uZSkgLT5cbiAgICAgIGNvbmN1cnJlbmN5ID0gNVxuICAgICAgZXhjVGhyb3dpbmdUYXNrSWQgPSBudWxsXG5cbiAgICAgIHByb2Nlc3NFeGl0ID0gKGNvZGUpIC0+XG4gICAgICAgIHRyeVxuICAgICAgICAgIGV4cGVjdCh3b3JrZXIucnVubmluZ1Rhc2tzKS50by5lcWwgWzEuLmNvbmN1cnJlbmN5XVxuICAgICAgICAgIGV4cGVjdCh3b3JrZXIuZG9uZVRhc2tzLmxlbmd0aCkudG8uZXF1YWwgMFxuICAgICAgICAgIGV4cGVjdCh3b3JrZXIuZmFpbGVkVGFza3MubGVuZ3RoKS50by5lcXVhbCAwXG5cbiAgICAgICAgICBkb25lKClcbiAgICAgICAgY2F0Y2ggZXJyXG4gICAgICAgICAgZG9uZSBlcnIgIFxuICAgICAgICBmaW5hbGx5XG4gICAgICAgICAgcHJvY2Vzcy5leGl0LnJlc3RvcmUoKVxuXG4gICAgICBzaW5vbi5zdHViKHByb2Nlc3MsICdleGl0JywgcHJvY2Vzc0V4aXQpXG5cbiAgICAgIHdvcmtlciA9IGNyZWF0ZVdvcmtlciBcImV4aXRfdGVzdF8xXCIsIGNvbmN1cnJlbmN5XG4gICAgICB3b3JrZXIuZ3JhY2VmdWxTaHV0ZG93blRpbWVvdXQgPSAxMDAwXG4gICAgICBhdXRvZmluaXNoSm9iID0gKGlkKSAtPlxuICAgICAgICBpZiB3b3JrZXIucnVubmluZ1Rhc2tzLmxlbmd0aCA+IChjb25jdXJyZW5jeSAtIDEpXG4gICAgICAgICAgZXhjVGhyb3dpbmdUYXNrSWQgPSBpZFxuICAgICAgICAgIHRocm93IG5ldyBFcnJvciBcIlVuaGFuZGxlZCBleGNlcHRpb24gbW9jay5cIlxuXG4gICAgICAgIHNldFRpbWVvdXQgKCkgLT5cbiAgICAgICAgICB3b3JrZXIuZmluaXNoVGFzayhpZClcbiAgICAgICAgLCAoMTUwMDAwICsgTWF0aC5yYW5kb20oKSAqIDUwMClcblxuICAgICAgd29ya2VyLmVtaXR0ZXIub24gJ3J1bm5pbmcnLCBhdXRvZmluaXNoSm9iXG5cbiAgICAgIGFzeW5jLnNlcmllcyBbXG4gICAgICAgIChuZXh0KSAtPiBjbGVhbldvcmtlciB3b3JrZXIsIG5leHQsXG4gICAgICAgIChuZXh0KSAtPiB3b3JrZXIud2FpdEZvclRhc2tzIG5leHQsXG4gICAgICAgIChuZXh0KSAtPiBcbiAgICAgICAgICBhc3luYy5lYWNoIFsxLi5jb25jdXJyZW5jeV0sIChpZCwgaW5uZXJOZXh0KSAtPlxuICAgICAgICAgICAgd29ya2VyLnB1c2hKb2IgeyBpZDogaWQgfSwgaW5uZXJOZXh0XG4gICAgICAgICAgLCBuZXh0XG4gICAgICBdLCAoZXJyKSAtPlxuICAgICAgICByZXR1cm4gZG9uZSBlcnIgaWYgZXJyXG5cbiAgICBpdCAnc2hvdWxkIHF1ZXVlIHVwIGEgam9iIGFuZCBkbyBpdCcsIChkb25lKSAtPlxuICAgICAgYXN5bmMuc2VyaWVzIFtcbiAgICAgICAgKG5leHQpIC0+IGNvbmN1cnJlbmN5MVdvcmtlci5wdXNoSm9iIHsgaWQ6IFwiMVwiIH0sIG5leHQsXG4gICAgICAgIChuZXh0KSAtPlxuICAgICAgICAgIHdhaXRVbnRpbCAoKSAtPlxuICAgICAgICAgICAgXCIxXCIgaW4gY29uY3VycmVuY3kxV29ya2VyLnJ1bm5pbmdUYXNrc1xuICAgICAgICAgICwgbmV4dCxcbiAgICAgICAgKG5leHQpIC0+XG4gICAgICAgICAgY29uY3VycmVuY3kxV29ya2VyLmZpbmlzaFRhc2sgXCIxXCJcbiAgICAgICAgICB3YWl0VW50aWwgKCkgLT5cbiAgICAgICAgICAgIFwiMVwiIGluIGNvbmN1cnJlbmN5MVdvcmtlci5kb25lVGFza3NcbiAgICAgICAgICAsIG5leHRcbiAgICAgIF0sIChlcnIpIC0+XG4gICAgICAgIGV4cGVjdChjb25jdXJyZW5jeTFXb3JrZXIuZG9uZVRhc2tzKS50by5jb250YWluIFwiMVwiXG4gICAgICAgIGRvbmUgZXJyXG5cbiAgICBpdCAnc2hvdWxkIHF1ZXVlIHVwIGEgam9iIGFuZCBkbyBpdCBpbiBvcmRlcicsIChkb25lKSAtPlxuICAgICAgYXN5bmMuc2VyaWVzIFtcbiAgICAgICAgKG5leHQpIC0+IGNvbmN1cnJlbmN5MVdvcmtlci5wdXNoSm9iIHsgaWQ6IFwiMVwiIH0sIG5leHQsXG4gICAgICAgIChuZXh0KSAtPiBjb25jdXJyZW5jeTFXb3JrZXIucHVzaEpvYiB7IGlkOiBcIjJcIiB9LCBuZXh0LFxuICAgICAgICAobmV4dCkgLT5cbiAgICAgICAgICB3YWl0VW50aWwgKCkgLT5cbiAgICAgICAgICAgIFwiMVwiIGluIGNvbmN1cnJlbmN5MVdvcmtlci5ydW5uaW5nVGFza3NcbiAgICAgICAgICAsIG5leHQsXG4gICAgICAgIChuZXh0KSAtPlxuICAgICAgICAgIGNvbmN1cnJlbmN5MVdvcmtlci5maW5pc2hTb21lVGFzaygpXG4gICAgICAgICAgd2FpdFVudGlsICgpIC0+XG4gICAgICAgICAgICBcIjJcIiBpbiBjb25jdXJyZW5jeTFXb3JrZXIucnVubmluZ1Rhc2tzXG4gICAgICAgICAgLCBuZXh0LFxuICAgICAgICAobmV4dCkgLT5cbiAgICAgICAgICBjb25jdXJyZW5jeTFXb3JrZXIuZmluaXNoU29tZVRhc2soKVxuICAgICAgICAgIHdhaXRVbnRpbCAoKSAtPlxuICAgICAgICAgICAgXCIyXCIgaW4gY29uY3VycmVuY3kxV29ya2VyLmRvbmVUYXNrc1xuICAgICAgICAgICwgbmV4dFxuICAgICAgXSwgKGVycikgLT5cbiAgICAgICAgZXhwZWN0KGNvbmN1cnJlbmN5MVdvcmtlci5kb25lVGFza3MpLnRvLmNvbnRhaW4gXCIxXCJcbiAgICAgICAgZXhwZWN0KGNvbmN1cnJlbmN5MVdvcmtlci5kb25lVGFza3MpLnRvLmNvbnRhaW4gXCIyXCJcbiAgICAgICAgZXhwZWN0KGNvbmN1cnJlbmN5MVdvcmtlci5tYXhSdW5uaW5nQXRPbmNlKS50by5lcXVhbCAxXG5cbiAgICAgICAgZG9uZSBlcnJcblxuIyBAVE9ETzogVGVzdCBpZiBlcnJvciBpcyBjYWxsZWQgb3V0IHdoZW4gQHdvcmsgcmV0dXJucyBhbiBlcnJvci5cblxuICBkZXNjcmliZSAnY29uY3VycmVuY3kgdGVzdHMnLCAoKSAtPlxuICAgIGl0ICdzaG91bGQgcnVuIHVwIHRvIDx0YXNrTGltaXQ+IGpvYnMgYXQgb25jZScsIChkb25lKSAtPlxuICAgICAgd29ya2VyICAgICAgPSBjb25jdXJyZW5jeTJXb3JrZXJcbiAgICAgIHRhc2tzTnVtYmVyID0gMjBcblxuICAgICAgYXV0b2ZpbmlzaEpvYkluNTBtcyA9IChpZCkgLT5cbiAgICAgICAgc2V0VGltZW91dCAoKSAtPlxuICAgICAgICAgIHdvcmtlci5maW5pc2hUYXNrKGlkKVxuICAgICAgICAsIDUwXG5cbiAgICAgIHdvcmtlci5lbWl0dGVyLm9uICdydW5uaW5nJywgYXV0b2ZpbmlzaEpvYkluNTBtc1xuXG4gICAgICBhc3luYy5zZXJpZXMgW1xuICAgICAgICAobmV4dCkgLT5cbiAgICAgICAgICBhc3luYy5lYWNoIFsxLi50YXNrc051bWJlcl0sIChpZCwgaW5uZXJOZXh0KSAtPlxuICAgICAgICAgICAgd29ya2VyLnB1c2hKb2IgeyBpZDogaWQgfSwgaW5uZXJOZXh0XG4gICAgICAgICAgLCBuZXh0XG4gICAgICAgIChuZXh0KSAtPlxuICAgICAgICAgIHdhaXRVbnRpbCAoKSAtPlxuICAgICAgICAgICAgd29ya2VyLnBlbmRpbmdUYXNrcy5sZW5ndGggPT0gMFxuICAgICAgICAgICwgbmV4dCxcbiAgICAgICAgKG5leHQpIC0+XG4gICAgICAgICAgd2FpdFVudGlsICgpIC0+XG4gICAgICAgICAgICB3b3JrZXIuZG9uZVRhc2tzLmxlbmd0aCA9PSB0YXNrc051bWJlclxuICAgICAgICAgICwgbmV4dCxcbiAgICAgIF0sIChlcnIpIC0+XG4gICAgICAgIGV4cGVjdCh3b3JrZXIubWF4UnVubmluZ0F0T25jZSkudG8uZXF1YWwgd29ya2VyLnRhc2tMaW1pdFxuXG4gICAgICAgIHdvcmtlci5lbWl0dGVyLnJlbW92ZUxpc3RlbmVyICdydW5uaW5nJywgYXV0b2ZpbmlzaEpvYkluNTBtc1xuICAgICAgICBkb25lIGVyclxuXG4gICAgaXQgJ3Nob3VsZCBub3Qgc3RhcnZlIG90aGVyIHF1ZXVlcyBpZiBydW5uaW5nIHNpZGUgYnkgc2lkZScsIChkb25lKSAtPlxuICAgICAgdGFza3NOdW1iZXIgID0gMjAwMFxuICAgICAgY29uY3VycmVuY3kgID0gMjBcbiAgICAgIHdvcmtlcnNDb3VudCA9IDVcblxuICAgICAgd29ya2VycyA9IFtdXG4gICAgICBhc3luYy5tYXAgWzEuLndvcmtlcnNDb3VudF0sIChpZHgsIG5leHQpIC0+XG4gICAgICAgIHdvcmtlciA9IGNyZWF0ZVdvcmtlciBcInNhbWVfaWRcIiwgY29uY3VycmVuY3lcbiAgICAgICAgY2xlYW5Xb3JrZXIgd29ya2VyLCAoZXJyKSAtPlxuICAgICAgICAgIHJldHVybiBuZXh0IGVyciBpZiBlcnJcblxuICAgICAgICAgIHdvcmtlci53YWl0Rm9yVGFza3MgKGVycikgLT5cbiAgICAgICAgICAgIG5leHQgZXJyLCB3b3JrZXJcbiAgICAgICwgKGVyciwgd29ya2VycykgLT5cbiAgICAgICAgYXV0b2ZpbmlzaEpvYkluNTBtc0ZhY3RvcnkgPSAod29ya2VyKSAtPlxuICAgICAgICAgIChpZCkgLT5cbiAgICAgICAgICAgIHNldFRpbWVvdXQgKCkgLT5cbiAgICAgICAgICAgICAgd29ya2VyLmZpbmlzaFRhc2soaWQpXG4gICAgICAgICAgICAsICg4MCArIE1hdGgucmFuZG9tKCkgKiA0MClcblxuICAgICAgICBmb3Igd29ya2VyIGluIHdvcmtlcnNcbiAgICAgICAgICB3b3JrZXIuYXV0b2ZpbmlzaEpvYkluNTBtcyA9IGF1dG9maW5pc2hKb2JJbjUwbXNGYWN0b3J5KHdvcmtlcilcbiAgICAgICAgICB3b3JrZXIuZW1pdHRlci5vbiAncnVubmluZycsIHdvcmtlci5hdXRvZmluaXNoSm9iSW41MG1zXG5cbiAgICAgICAgY291bnRBbGxEb25lVGFza3MgPSAoKSAtPiBfLnJlZHVjZSB3b3JrZXJzLCAoKHN1bSwgd29ya2VyKSAtPiBzdW0gKyB3b3JrZXIuZG9uZVRhc2tzLmxlbmd0aCksIDBcblxuICAgICAgICBhc3luYy5zZXJpZXMgW1xuICAgICAgICAgIChuZXh0KSAtPlxuICAgICAgICAgICAgYXN5bmMuZWFjaCBbMS4udGFza3NOdW1iZXJdLCAoaWQsIGlubmVyTmV4dCkgLT5cbiAgICAgICAgICAgICAgd29ya2Vyc1swXS5wdXNoSm9iIHsgaWQ6IFwiQSN7aWR9XCIgfSwgaW5uZXJOZXh0XG4gICAgICAgICAgICAsIG5leHRcbiAgICAgICAgICAobmV4dCkgLT5cbiAgICAgICAgICAgIHdhaXRVbnRpbCAoKSAtPlxuICAgICAgICAgICAgICBjb3VudEFsbERvbmVUYXNrcygpID09IHRhc2tzTnVtYmVyXG4gICAgICAgICAgICAsIG5leHQsXG4gICAgICAgIF0sIChlcnIpIC0+XG4gICAgICAgICAgZm9yIHdvcmtlciBpbiB3b3JrZXJzXG4gICAgICAgICAgICB3b3JrZXIuZW1pdHRlci5yZW1vdmVMaXN0ZW5lciAncnVubmluZycsIHdvcmtlci5hdXRvZmluaXNoSm9iSW41MG1zXG5cbiAgICAgICAgICBkb25lVGFza3MgPSBfLm1hcCB3b3JrZXJzLCAod29ya2VyKSAtPiB3b3JrZXIuZG9uZVRhc2tzLmxlbmd0aFxuICAgICAgICAgIGV4cGVjdChNYXRoLnN0RGV2IGRvbmVUYXNrcykudG8uYmUuYmVsb3codGFza3NOdW1iZXIgLyAxMDAuMClcblxuICAgICAgICAgIGRvbmUgZXJyXG5cbiAgICBpdCAnc2hvdWxkIG5vdCBzdGFydmUgb3RoZXIgcXVldWVzIGlmIHN0YXJ0aW5nIHdpdGggcHVzaGVkIHRhc2tzJywgKGRvbmUpIC0+XG4gICAgICB0YXNrc051bWJlciAgPSA0MDBcbiAgICAgIGNvbmN1cnJlbmN5ICA9IDIwXG4gICAgICB3b3JrZXJzQ291bnQgPSA1XG5cbiAgICAgIHdvcmtlcnMgPSBbXVxuICAgICAgYXN5bmMubWFwIFsxLi53b3JrZXJzQ291bnRdLCAoaWR4LCBuZXh0KSAtPlxuICAgICAgICB3b3JrZXIgPSBjcmVhdGVXb3JrZXIgXCJzYW1lX2lkMlwiLCBjb25jdXJyZW5jeVxuICAgICAgICBjbGVhbldvcmtlciB3b3JrZXIsIChlcnIpIC0+XG4gICAgICAgICAgbmV4dCBlcnIsIHdvcmtlclxuICAgICAgLCAoZXJyLCB3b3JrZXJzKSAtPlxuICAgICAgICBhdXRvZmluaXNoSm9iSW41MG1zRmFjdG9yeSA9ICh3b3JrZXIpIC0+XG4gICAgICAgICAgKGlkKSAtPlxuICAgICAgICAgICAgc2V0VGltZW91dCAoKSAtPlxuICAgICAgICAgICAgICB3b3JrZXIuZmluaXNoVGFzayhpZClcbiAgICAgICAgICAgICwgKDgwICsgTWF0aC5yYW5kb20oKSAqIDQwKVxuXG4gICAgICAgIGZvciB3b3JrZXIgaW4gd29ya2Vyc1xuICAgICAgICAgIHdvcmtlci5hdXRvZmluaXNoSm9iSW41MG1zID0gYXV0b2ZpbmlzaEpvYkluNTBtc0ZhY3Rvcnkod29ya2VyKVxuICAgICAgICAgIHdvcmtlci5lbWl0dGVyLm9uICdydW5uaW5nJywgd29ya2VyLmF1dG9maW5pc2hKb2JJbjUwbXNcblxuICAgICAgICBjb3VudEFsbERvbmVUYXNrcyA9ICgpIC0+IF8ucmVkdWNlIHdvcmtlcnMsICgoc3VtLCB3b3JrZXIpIC0+IHN1bSArIHdvcmtlci5kb25lVGFza3MubGVuZ3RoKSwgMFxuXG4gICAgICAgIGFzeW5jLnNlcmllcyBbXG4gICAgICAgICAgKG5leHQpIC0+XG4gICAgICAgICAgICBhc3luYy5lYWNoIFsxLi50YXNrc051bWJlcl0sIChpZCwgaW5uZXJOZXh0KSAtPlxuICAgICAgICAgICAgICB3b3JrZXJzWzBdLnB1c2hKb2IgeyBpZDogXCJCI3tpZH1cIiB9LCBpbm5lck5leHRcbiAgICAgICAgICAgICwgbmV4dFxuICAgICAgICAgIChuZXh0KSAtPlxuICAgICAgICAgICAgYXN5bmMuZWFjaFNlcmllcyB3b3JrZXJzLCAod29ya2VyLCBpbm5lck5leHQpIC0+XG4gICAgICAgICAgICAgIHdvcmtlci53YWl0Rm9yVGFza3MgaW5uZXJOZXh0XG4gICAgICAgICAgICAsIG5leHRcbiAgICAgICAgICAobmV4dCkgLT5cbiAgICAgICAgICAgIHdhaXRVbnRpbCAoKSAtPlxuICAgICAgICAgICAgICBjb3VudEFsbERvbmVUYXNrcygpID09IHRhc2tzTnVtYmVyXG4gICAgICAgICAgICAsIG5leHQsXG4gICAgICAgIF0sIChlcnIpIC0+XG4gICAgICAgICAgZm9yIHdvcmtlciBpbiB3b3JrZXJzXG4gICAgICAgICAgICB3b3JrZXIuZW1pdHRlci5yZW1vdmVMaXN0ZW5lciAncnVubmluZycsIHdvcmtlci5hdXRvZmluaXNoSm9iSW41MG1zXG5cbiAgICAgICAgICBkb25lVGFza3MgPSBfLm1hcCB3b3JrZXJzLCAod29ya2VyKSAtPiB3b3JrZXIuZG9uZVRhc2tzLmxlbmd0aFxuICAgICAgICAgIGV4cGVjdChNYXRoLnN0RGV2IGRvbmVUYXNrcykudG8uYmUuYmVsb3codGFza3NOdW1iZXIgLyAxMDAuMClcblxuICAgICAgICAgIGRvbmUgZXJyXG5cbiAgICBpdCAnc2hvdWxkIHVzZSBhbGwgY29uY3VycmVuY3kgc2xvdHMgYXQgYWxsIHRpbWVzJywgKGRvbmUpIC0+XG4gICAgICB0YXNrc051bWJlciAgPSAyMDAwXG4gICAgICBjb25jdXJyZW5jeSAgPSAxMFxuICAgICAgd29ya2Vyc0NvdW50ID0gNVxuXG4gICAgICB3b3JrZXJzID0gW11cbiAgICAgIGFzeW5jLm1hcCBbMS4ud29ya2Vyc0NvdW50XSwgKGlkeCwgbmV4dCkgLT5cbiAgICAgICAgd29ya2VyID0gY3JlYXRlV29ya2VyIFwic2FtZV9pZDNcIiwgY29uY3VycmVuY3lcbiAgICAgICAgY2xlYW5Xb3JrZXIgd29ya2VyLCAoZXJyKSAtPlxuICAgICAgICAgIG5leHQgZXJyLCB3b3JrZXJcbiAgICAgICwgKGVyciwgd29ya2VycykgLT5cbiAgICAgICAgYXV0b2ZpbmlzaEpvYkluNTBtc0ZhY3RvcnkgPSAod29ya2VyKSAtPlxuICAgICAgICAgIChpZCkgLT5cbiAgICAgICAgICAgIHNldFRpbWVvdXQgKCkgLT5cbiAgICAgICAgICAgICAgd29ya2VyLmZpbmlzaFRhc2soaWQpXG4gICAgICAgICAgICAsICg0MCArIE1hdGgucmFuZG9tKCkgKiA0MClcblxuICAgICAgICBmb3Igd29ya2VyIGluIHdvcmtlcnNcbiAgICAgICAgICB3b3JrZXIuYXV0b2ZpbmlzaEpvYkluNTBtcyA9IGF1dG9maW5pc2hKb2JJbjUwbXNGYWN0b3J5KHdvcmtlcilcbiAgICAgICAgICB3b3JrZXIuZW1pdHRlci5vbiAncnVubmluZycsIHdvcmtlci5hdXRvZmluaXNoSm9iSW41MG1zXG5cbiAgICAgICAgY291bnRBbGxEb25lVGFza3MgICAgPSAoKSAtPiBfLnJlZHVjZSB3b3JrZXJzLCAoKHN1bSwgd29ya2VyKSAtPiBzdW0gKyB3b3JrZXIuZG9uZVRhc2tzLmxlbmd0aCksIDBcbiAgICAgICAgc3VtbWFyaXplQWxsUnVubmluZ1Rhc2tzID0gKCkgLT4gXy5tYXAgd29ya2VycywgKHdvcmtlcikgLT4gd29ya2VyLnJ1bm5pbmdUYXNrcy5sZW5ndGhcblxuICAgICAgICB3b3JrZXJzUnVubmluZ1Rhc2tzUHJvZmlsZSAgPSBbXVxuICAgICAgICBwcm9maWxlclRpbWVySm9iID0gc2V0SW50ZXJ2YWwgKCkgLT5cbiAgICAgICAgICB3b3JrZXJzUnVubmluZ1Rhc2tzUHJvZmlsZS5wdXNoIHN1bW1hcml6ZUFsbFJ1bm5pbmdUYXNrcygpXG4gICAgICAgICwgMTBcblxuICAgICAgICBhc3luYy5zZXJpZXMgW1xuICAgICAgICAgIChuZXh0KSAtPlxuICAgICAgICAgICAgYXN5bmMuZWFjaCBbMS4udGFza3NOdW1iZXJdLCAoaWQsIGlubmVyTmV4dCkgLT5cbiAgICAgICAgICAgICAgd29ya2Vyc1swXS5wdXNoSm9iIHsgaWQ6IFwiQiN7aWR9XCIgfSwgaW5uZXJOZXh0XG4gICAgICAgICAgICAsIG5leHRcbiAgICAgICAgICAobmV4dCkgLT5cbiAgICAgICAgICAgIGFzeW5jLmVhY2ggd29ya2VycywgKHdvcmtlciwgaW5uZXJOZXh0KSAtPlxuICAgICAgICAgICAgICB3b3JrZXIud2FpdEZvclRhc2tzIGlubmVyTmV4dFxuICAgICAgICAgICAgLCBuZXh0XG4gICAgICAgICAgKG5leHQpIC0+XG4gICAgICAgICAgICB3YWl0VW50aWwgKCkgLT5cbiAgICAgICAgICAgICAgY291bnRBbGxEb25lVGFza3MoKSA9PSB0YXNrc051bWJlclxuICAgICAgICAgICAgLCBuZXh0LFxuICAgICAgICBdLCAoZXJyKSAtPlxuICAgICAgICAgIGZvciB3b3JrZXIgaW4gd29ya2Vyc1xuICAgICAgICAgICAgd29ya2VyLmVtaXR0ZXIucmVtb3ZlTGlzdGVuZXIgJ3J1bm5pbmcnLCB3b3JrZXIuYXV0b2ZpbmlzaEpvYkluNTBtc1xuICAgICAgICAgIGNsZWFySW50ZXJ2YWwgcHJvZmlsZXJUaW1lckpvYlxuXG4gICAgICAgICAgcnVubmluZ1Rhc2tzTWVhblBlcldvcmtlciAgPSBbXVxuICAgICAgICAgIHJ1bm5pbmdUYXNrc1N0RGV2UGVyV29ya2VyID0gW11cbiAgICAgICAgICBmb3Igd29ya2VySWR4IGluIFswLi4ud29ya2Vycy5sZW5ndGhdXG4gICAgICAgICAgICB3b3JrZXJSdW5uaW5nVGFza3NQcm9maWxlID0gXy5tYXAgd29ya2Vyc1J1bm5pbmdUYXNrc1Byb2ZpbGUsIChydW5uaW5nVGFza3NQcm9maWxlKSAtPiBydW5uaW5nVGFza3NQcm9maWxlW3dvcmtlcklkeF1cbiAgICAgICAgICAgIHdvcmtlclJ1bm5pbmdUYXNrc1Byb2ZpbGVPbmx5TWlkUG9pbnRzID0gd29ya2VyUnVubmluZ1Rhc2tzUHJvZmlsZVsxMC4uLTIwXVxuXG4gICAgICAgICAgICBydW5uaW5nVGFza3NNZWFuUGVyV29ya2VyLnB1c2ggIE1hdGgubWVhbih3b3JrZXJSdW5uaW5nVGFza3NQcm9maWxlT25seU1pZFBvaW50cylcbiAgICAgICAgICAgIHJ1bm5pbmdUYXNrc1N0RGV2UGVyV29ya2VyLnB1c2ggTWF0aC5zdERldih3b3JrZXJSdW5uaW5nVGFza3NQcm9maWxlT25seU1pZFBvaW50cylcblxuICAgICAgICAgIGV4cGVjdChfLm1pbiBydW5uaW5nVGFza3NNZWFuUGVyV29ya2VyKS50by5iZS5hYm92ZShjb25jdXJyZW5jeSAqIDAuOSlcbiAgICAgICAgICBleHBlY3QoXy5tYXggcnVubmluZ1Rhc2tzU3REZXZQZXJXb3JrZXIpLnRvLmJlLmJlbG93KGNvbmN1cnJlbmN5ICogMC4yKVxuICAgICAgICAgICAgXG4gICAgICAgICAgZG9uZSBlcnJcblxuICAgIGl0ICdzaG91bGQgbm90IHVzZSByZWRpcyBtb3JlIHRoYW4gbmVjZXNzYXJ5JywgKGRvbmUpIC0+XG4gICAgICB0YXNrc051bWJlclBlcldvcmtlciA9IDIwMFxuICAgICAgY29uY3VycmVuY3kgID0gNVxuICAgICAgd29ya2Vyc0NvdW50ID0gM1xuXG4gICAgICB3b3JrZXJzID0gW11cbiAgICAgIGFzeW5jLm1hcCBbMS4ud29ya2Vyc0NvdW50XSwgKGlkeCwgbmV4dCkgLT5cbiAgICAgICAgd29ya2VyID0gY3JlYXRlV29ya2VyIFwidGVzdDFfd29ya2VyI3tpZHh9XCIsIGNvbmN1cnJlbmN5XG5cbiAgICAgICAgIyBTZXR1cCByZWRpcyBjYWxsIHNweS5cbiAgICAgICAgc2lub24uc3B5IHdvcmtlciwgJ3BvcEpvYkZyb21RdWV1ZSdcblxuICAgICAgICAjIFByZXBhcmUgd29ya2VyLlxuICAgICAgICBjbGVhbldvcmtlciB3b3JrZXIsIChlcnIpIC0+XG4gICAgICAgICAgcmV0dXJuIG5leHQgZXJyIGlmIGVyclxuXG4gICAgICAgICAgd29ya2VyLndhaXRGb3JUYXNrcyAoZXJyKSAtPlxuICAgICAgICAgICAgbmV4dCBlcnIsIHdvcmtlclxuICAgICAgLCAoZXJyLCB3b3JrZXJzKSAtPlxuICAgICAgICBhdXRvZmluaXNoSm9iSW41MG1zRmFjdG9yeSA9ICh3b3JrZXIpIC0+XG4gICAgICAgICAgKGlkKSAtPlxuICAgICAgICAgICAgc2V0VGltZW91dCAoKSAtPlxuICAgICAgICAgICAgICB3b3JrZXIuZmluaXNoVGFzayhpZClcbiAgICAgICAgICAgICwgKDQwICsgTWF0aC5yYW5kb20oKSAqIDQwKVxuXG4gICAgICAgIGZvciB3b3JrZXIgaW4gd29ya2Vyc1xuICAgICAgICAgIHdvcmtlci5hdXRvZmluaXNoSm9iSW41MG1zID0gYXV0b2ZpbmlzaEpvYkluNTBtc0ZhY3Rvcnkod29ya2VyKVxuICAgICAgICAgIHdvcmtlci5lbWl0dGVyLm9uICdydW5uaW5nJywgd29ya2VyLmF1dG9maW5pc2hKb2JJbjUwbXNcblxuICAgICAgICBjb3VudEFsbERvbmVUYXNrcyA9ICgpIC0+IF8ucmVkdWNlIHdvcmtlcnMsICgoc3VtLCB3b3JrZXIpIC0+IHN1bSArIHdvcmtlci5kb25lVGFza3MubGVuZ3RoKSwgMFxuXG4gICAgICAgIGFzeW5jLnNlcmllcyBbXG4gICAgICAgICAgKG5leHQpIC0+XG4gICAgICAgICAgICAjIEFkZCAndGFza3NOdW1iZXJQZXJXb3JrZXInIHRhc2tzIGZvciBlYWNoIG9mIHRoZSAoc2VwYXJhdGUhKSB3b3JrZXJzXG4gICAgICAgICAgICBhc3luYy5lYWNoIHdvcmtlcnMsICh3b3JrZXIsIGlubmVyTmV4dCkgLT5cbiAgICAgICAgICAgICAgYXN5bmMuZWFjaCBbMS4udGFza3NOdW1iZXJQZXJXb3JrZXJdLCAoaWQsIGlubmVySW5uZXJOZXh0KSAtPlxuICAgICAgICAgICAgICAgIHdvcmtlci5wdXNoSm9iIHsgaWQ6IFwiQSN7aWR9XCIgfSwgaW5uZXJJbm5lck5leHRcbiAgICAgICAgICAgICAgLCBpbm5lck5leHRcbiAgICAgICAgICAgICwgbmV4dFxuICAgICAgICAgIChuZXh0KSAtPlxuICAgICAgICAgICAgIyBXYWl0IHRpbGwgdGhleSBmaW5pc2guXG4gICAgICAgICAgICB3YWl0VW50aWwgKCkgLT5cbiAgICAgICAgICAgICAgY291bnRBbGxEb25lVGFza3MoKSA9PSB0YXNrc051bWJlclBlcldvcmtlciAqIHdvcmtlcnNDb3VudFxuICAgICAgICAgICAgLCBuZXh0LFxuICAgICAgICAgIChuZXh0KSAtPlxuICAgICAgICAgICAgIyBBZGQgJ3Rhc2tzTnVtYmVyUGVyV29ya2VyJyB0YXNrcyBmb3Igb25seSBvbmUgb2YgdGhlIHdvcmtlcnNcbiAgICAgICAgICAgIGFzeW5jLmVhY2ggWzEuLnRhc2tzTnVtYmVyUGVyV29ya2VyXSwgKGlkLCBpbm5lck5leHQpIC0+XG4gICAgICAgICAgICAgIHdvcmtlcnNbMF0ucHVzaEpvYiB7IGlkOiBcIkIje2lkfVwiIH0sIGlubmVyTmV4dFxuICAgICAgICAgICAgLCBuZXh0XG4gICAgICAgICAgICAjIEFkZCAndGFza3NOdW1iZXJQZXJXb3JrZXInIHRhc2tzIGZvciBvbmx5IG9uZSBvZiB0aGUgd29ya2Vyc1xuICAgICAgICAgICAgYXN5bmMuZWFjaCBbMS4udGFza3NOdW1iZXJQZXJXb3JrZXJdLCAoaWQsIGlubmVyTmV4dCkgLT5cbiAgICAgICAgICAgICAgd29ya2Vyc1sxXS5wdXNoSm9iIHsgaWQ6IFwiQiN7aWR9XCIgfSwgaW5uZXJOZXh0XG4gICAgICAgICAgICAsIG5leHRcbiAgICAgICAgICAobmV4dCkgLT5cbiAgICAgICAgICAgICMgV2FpdCB0aWxsIGl0J3MgZmluaXNoZWQuXG4gICAgICAgICAgICB3YWl0VW50aWwgKCkgLT5cbiAgICAgICAgICAgICAgd29ya2Vyc1swXS5kb25lVGFza3MubGVuZ3RoID09IDIgKiB0YXNrc051bWJlclBlcldvcmtlciBhbmQgd29ya2Vyc1sxXS5kb25lVGFza3MubGVuZ3RoID09IDIgKiB0YXNrc051bWJlclBlcldvcmtlclxuICAgICAgICAgICAgLCBuZXh0LFxuICAgICAgICAgIChuZXh0KSAtPlxuICAgICAgICAgICAgIyBBZGQgJ3Rhc2tzTnVtYmVyUGVyV29ya2VyJyB0YXNrcyBmb3Igb25seSBvbmUgb2YgdGhlIHdvcmtlcnNcbiAgICAgICAgICAgIGFzeW5jLmVhY2ggWzEuLnRhc2tzTnVtYmVyUGVyV29ya2VyXSwgKGlkLCBpbm5lck5leHQpIC0+XG4gICAgICAgICAgICAgIHdvcmtlcnNbMl0ucHVzaEpvYiB7IGlkOiBcIkMje2lkfVwiIH0sIGlubmVyTmV4dFxuICAgICAgICAgICAgLCBuZXh0XG4gICAgICAgICAgKG5leHQpIC0+XG4gICAgICAgICAgICAjIFdhaXQgdGlsbCBpdCdzIGZpbmlzaGVkLlxuICAgICAgICAgICAgd2FpdFVudGlsICgpIC0+XG4gICAgICAgICAgICAgIHdvcmtlcnNbMl0uZG9uZVRhc2tzLmxlbmd0aCA9PSAyICogdGFza3NOdW1iZXJQZXJXb3JrZXJcbiAgICAgICAgICAgICwgbmV4dCxcbiAgICAgICAgXSwgKGVycikgLT5cbiAgICAgICAgICAjIENsZWFudXBcbiAgICAgICAgICBmb3Igd29ya2VyIGluIHdvcmtlcnNcbiAgICAgICAgICAgICMgQ291bnQgbnVtYmVyIG9mIHRpbWVzIHJlZGlzIHdhcyBjYWxsZWQuXG4gICAgICAgICAgICBleHBlY3Qod29ya2VyLnBvcEpvYkZyb21RdWV1ZS5jYWxsQ291bnQpLnRvLmJlLmJlbG93KHdvcmtlci5kb25lVGFza3MubGVuZ3RoICogMS4yKVxuXG4gICAgICAgICAgICB3b3JrZXIuZW1pdHRlci5yZW1vdmVMaXN0ZW5lciAncnVubmluZycsIHdvcmtlci5hdXRvZmluaXNoSm9iSW41MG1zXG4gICAgICAgICAgICB3b3JrZXIucG9wSm9iRnJvbVF1ZXVlLnJlc3RvcmUoKVxuXG4gICAgICAgICAgZG9uZSBlcnJcbiJdfQ==