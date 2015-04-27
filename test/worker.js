var EventEmitter, RedisWorker, TestWorker, Worker, _, async, chai, cleanWorker, concurrency1Worker, concurrency2Worker, createWorker, expect, fakeredis, redis, sinon, waitUntil,
  extend = function(child, parent) { for (var key in parent) { if (hasProp.call(parent, key)) child[key] = parent[key]; } function ctor() { this.constructor = child; } ctor.prototype = parent.prototype; child.prototype = new ctor(); child.__super__ = parent.prototype; return child; },
  hasProp = {}.hasOwnProperty,
  indexOf = [].indexOf || function(item) { for (var i = 0, l = this.length; i < l; i++) { if (i in this && this[i] === item) return i; } return -1; };

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

TestWorker = (function(superClass) {
  extend(TestWorker, superClass);

  function TestWorker(options) {
    this.url = options.url, this.taskLimit = options.taskLimit, this.retryTasks = options.retryTasks;
    TestWorker.__super__.constructor.call(this, {
      url: this.url,
      taskLimit: this.taskLimit,
      retryTasks: this.retryTasks
    });
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
  worker = new TestWorker({
    url: "redis://localhost:6379/32",
    taskLimit: taskLimit
  });
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
          var i, results;
          return async.each((function() {
            results = [];
            for (var i = 1; 1 <= concurrency ? i <= concurrency : i >= concurrency; 1 <= concurrency ? i++ : i--){ results.push(i); }
            return results;
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
          var i, results;
          return async.each((function() {
            results = [];
            for (var i = 1; 1 <= concurrency ? i <= concurrency : i >= concurrency; 1 <= concurrency ? i++ : i--){ results.push(i); }
            return results;
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
        var err, i, results;
        try {
          expect(worker.runningTasks).to.eql((function() {
            results = [];
            for (var i = 1; 1 <= concurrency ? i <= concurrency : i >= concurrency; 1 <= concurrency ? i++ : i--){ results.push(i); }
            return results;
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
          var i, results;
          return async.each((function() {
            results = [];
            for (var i = 1; 1 <= concurrency ? i <= concurrency : i >= concurrency; 1 <= concurrency ? i++ : i--){ results.push(i); }
            return results;
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
            return indexOf.call(concurrency1Worker.runningTasks, "1") >= 0;
          }, next);
        }, function(next) {
          concurrency1Worker.finishTask("1");
          return waitUntil(function() {
            return indexOf.call(concurrency1Worker.doneTasks, "1") >= 0;
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
            return indexOf.call(concurrency1Worker.runningTasks, "1") >= 0;
          }, next);
        }, function(next) {
          concurrency1Worker.finishSomeTask();
          return waitUntil(function() {
            return indexOf.call(concurrency1Worker.runningTasks, "2") >= 0;
          }, next);
        }, function(next) {
          concurrency1Worker.finishSomeTask();
          return waitUntil(function() {
            return indexOf.call(concurrency1Worker.doneTasks, "2") >= 0;
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
          var i, results;
          return async.each((function() {
            results = [];
            for (var i = 1; 1 <= tasksNumber ? i <= tasksNumber : i >= tasksNumber; 1 <= tasksNumber ? i++ : i--){ results.push(i); }
            return results;
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
      var concurrency, i, results, tasksNumber, workers, workersCount;
      tasksNumber = 2000;
      concurrency = 20;
      workersCount = 5;
      workers = [];
      return async.map((function() {
        results = [];
        for (var i = 1; 1 <= workersCount ? i <= workersCount : i >= workersCount; 1 <= workersCount ? i++ : i--){ results.push(i); }
        return results;
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
        var autofinishJobIn50msFactory, countAllDoneTasks, j, len, worker;
        autofinishJobIn50msFactory = function(worker) {
          return function(id) {
            return setTimeout(function() {
              return worker.finishTask(id);
            }, 80 + Math.random() * 40);
          };
        };
        for (j = 0, len = workers.length; j < len; j++) {
          worker = workers[j];
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
            var k, results1;
            return async.each((function() {
              results1 = [];
              for (var k = 1; 1 <= tasksNumber ? k <= tasksNumber : k >= tasksNumber; 1 <= tasksNumber ? k++ : k--){ results1.push(k); }
              return results1;
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
          var doneTasks, k, len1;
          for (k = 0, len1 = workers.length; k < len1; k++) {
            worker = workers[k];
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
      var concurrency, i, results, tasksNumber, workers, workersCount;
      tasksNumber = 400;
      concurrency = 20;
      workersCount = 5;
      workers = [];
      return async.map((function() {
        results = [];
        for (var i = 1; 1 <= workersCount ? i <= workersCount : i >= workersCount; 1 <= workersCount ? i++ : i--){ results.push(i); }
        return results;
      }).apply(this), function(idx, next) {
        var worker;
        worker = createWorker("same_id2", concurrency);
        return cleanWorker(worker, function(err) {
          return next(err, worker);
        });
      }, function(err, workers) {
        var autofinishJobIn50msFactory, countAllDoneTasks, j, len, worker;
        autofinishJobIn50msFactory = function(worker) {
          return function(id) {
            return setTimeout(function() {
              return worker.finishTask(id);
            }, 80 + Math.random() * 40);
          };
        };
        for (j = 0, len = workers.length; j < len; j++) {
          worker = workers[j];
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
            var k, results1;
            return async.each((function() {
              results1 = [];
              for (var k = 1; 1 <= tasksNumber ? k <= tasksNumber : k >= tasksNumber; 1 <= tasksNumber ? k++ : k--){ results1.push(k); }
              return results1;
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
          var doneTasks, k, len1;
          for (k = 0, len1 = workers.length; k < len1; k++) {
            worker = workers[k];
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
      var concurrency, i, results, tasksNumber, workers, workersCount;
      tasksNumber = 2000;
      concurrency = 10;
      workersCount = 5;
      workers = [];
      return async.map((function() {
        results = [];
        for (var i = 1; 1 <= workersCount ? i <= workersCount : i >= workersCount; 1 <= workersCount ? i++ : i--){ results.push(i); }
        return results;
      }).apply(this), function(idx, next) {
        var worker;
        worker = createWorker("same_id3", concurrency);
        return cleanWorker(worker, function(err) {
          return next(err, worker);
        });
      }, function(err, workers) {
        var autofinishJobIn50msFactory, countAllDoneTasks, j, len, profilerTimerJob, summarizeAllRunningTasks, worker, workersRunningTasksProfile;
        autofinishJobIn50msFactory = function(worker) {
          return function(id) {
            return setTimeout(function() {
              return worker.finishTask(id);
            }, 40 + Math.random() * 40);
          };
        };
        for (j = 0, len = workers.length; j < len; j++) {
          worker = workers[j];
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
            var k, results1;
            return async.each((function() {
              results1 = [];
              for (var k = 1; 1 <= tasksNumber ? k <= tasksNumber : k >= tasksNumber; 1 <= tasksNumber ? k++ : k--){ results1.push(k); }
              return results1;
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
          var k, l, len1, ref, runningTasksMeanPerWorker, runningTasksStDevPerWorker, workerIdx, workerRunningTasksProfile, workerRunningTasksProfileOnlyMidPoints;
          for (k = 0, len1 = workers.length; k < len1; k++) {
            worker = workers[k];
            worker.emitter.removeListener('running', worker.autofinishJobIn50ms);
          }
          clearInterval(profilerTimerJob);
          runningTasksMeanPerWorker = [];
          runningTasksStDevPerWorker = [];
          for (workerIdx = l = 0, ref = workers.length; 0 <= ref ? l < ref : l > ref; workerIdx = 0 <= ref ? ++l : --l) {
            workerRunningTasksProfile = _.map(workersRunningTasksProfile, function(runningTasksProfile) {
              return runningTasksProfile[workerIdx];
            });
            workerRunningTasksProfileOnlyMidPoints = workerRunningTasksProfile.slice(10, -19);
            runningTasksMeanPerWorker.push(Math.mean(workerRunningTasksProfileOnlyMidPoints));
            runningTasksStDevPerWorker.push(Math.stDev(workerRunningTasksProfileOnlyMidPoints));
          }
          expect(_.min(runningTasksMeanPerWorker)).to.be.above(concurrency * 0.6);
          expect(_.max(runningTasksStDevPerWorker)).to.be.below(concurrency * 0.3);
          return done(err);
        });
      });
    });
    return it('should not use redis more than necessary', function(done) {
      var concurrency, i, results, tasksNumberPerWorker, workers, workersCount;
      tasksNumberPerWorker = 200;
      concurrency = 5;
      workersCount = 3;
      workers = [];
      return async.map((function() {
        results = [];
        for (var i = 1; 1 <= workersCount ? i <= workersCount : i >= workersCount; 1 <= workersCount ? i++ : i--){ results.push(i); }
        return results;
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
        var autofinishJobIn50msFactory, countAllDoneTasks, j, len, worker;
        autofinishJobIn50msFactory = function(worker) {
          return function(id) {
            return setTimeout(function() {
              return worker.finishTask(id);
            }, 40 + Math.random() * 40);
          };
        };
        for (j = 0, len = workers.length; j < len; j++) {
          worker = workers[j];
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
              var k, results1;
              return async.each((function() {
                results1 = [];
                for (var k = 1; 1 <= tasksNumberPerWorker ? k <= tasksNumberPerWorker : k >= tasksNumberPerWorker; 1 <= tasksNumberPerWorker ? k++ : k--){ results1.push(k); }
                return results1;
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
            var k, l, results1, results2;
            async.each((function() {
              results1 = [];
              for (var k = 1; 1 <= tasksNumberPerWorker ? k <= tasksNumberPerWorker : k >= tasksNumberPerWorker; 1 <= tasksNumberPerWorker ? k++ : k--){ results1.push(k); }
              return results1;
            }).apply(this), function(id, innerNext) {
              return workers[0].pushJob({
                id: "B" + id
              }, innerNext);
            }, next);
            return async.each((function() {
              results2 = [];
              for (var l = 1; 1 <= tasksNumberPerWorker ? l <= tasksNumberPerWorker : l >= tasksNumberPerWorker; 1 <= tasksNumberPerWorker ? l++ : l--){ results2.push(l); }
              return results2;
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
            var k, results1;
            return async.each((function() {
              results1 = [];
              for (var k = 1; 1 <= tasksNumberPerWorker ? k <= tasksNumberPerWorker : k >= tasksNumberPerWorker; 1 <= tasksNumberPerWorker ? k++ : k--){ results1.push(k); }
              return results1;
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
          var k, len1;
          for (k = 0, len1 = workers.length; k < len1; k++) {
            worker = workers[k];
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

//# sourceMappingURL=data:application/json;base64,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R0FBQTttQkFFRSxTQUFBLENBQVUsU0FBQSxHQUFBO3FCQUNSLE9BQVEsQ0FBQSxDQUFBLENBQUUsQ0FBQyxTQUFTLENBQUMsTUFBckIsS0FBK0IsQ0FBQSxHQUFJLHFCQUQzQjtZQUFBLENBQVYsRUFFRSxJQUZGLEVBRkY7VUFBQSxDQWhDVztTQUFiLEVBcUNHLFNBQUMsR0FBRCxHQUFBO0FBRUQsY0FBQSxPQUFBO0FBQUEsZUFBQSwyQ0FBQTtnQ0FBQTtBQUVFLFlBQUEsTUFBQSxDQUFPLE1BQU0sQ0FBQyxlQUFlLENBQUMsU0FBOUIsQ0FBd0MsQ0FBQyxFQUFFLENBQUMsRUFBRSxDQUFDLEtBQS9DLENBQXFELE1BQU0sQ0FBQyxTQUFTLENBQUMsTUFBakIsR0FBMEIsR0FBL0UsQ0FBQSxDQUFBO0FBQUEsWUFFQSxNQUFNLENBQUMsT0FBTyxDQUFDLGNBQWYsQ0FBOEIsU0FBOUIsRUFBeUMsTUFBTSxDQUFDLG1CQUFoRCxDQUZBLENBQUE7QUFBQSxZQUdBLE1BQU0sQ0FBQyxlQUFlLENBQUMsT0FBdkIsQ0FBQSxDQUhBLENBRkY7QUFBQSxXQUFBO2lCQU9BLElBQUEsQ0FBSyxHQUFMLEVBVEM7UUFBQSxDQXJDSCxFQWJBO01BQUEsQ0FaRixFQU42QztJQUFBLENBQS9DLEVBdEw0QjtFQUFBLENBQTlCLEVBdEs2QjtBQUFBLENBQS9CLENBL0lBLENBQUEiLCJmaWxlIjoidGVzdC93b3JrZXIuanMiLCJzb3VyY2VSb290IjoiL3NvdXJjZS8iLCJzb3VyY2VzQ29udGVudCI6WyJfICAgICAgICAgPSByZXF1aXJlKCdsb2Rhc2gnKVxuYXN5bmMgICAgID0gcmVxdWlyZSgnYXN5bmMnKVxucmVkaXMgICAgID0gcmVxdWlyZSgncmVkaXMnKVxuZmFrZXJlZGlzID0gcmVxdWlyZSgnZmFrZXJlZGlzJylcbmNoYWkgICAgICA9IHJlcXVpcmUoJ2NoYWknKVxuZXhwZWN0ICAgID0gcmVxdWlyZSgnY2hhaScpLmV4cGVjdFxuc2lub24gICAgID0gcmVxdWlyZSgnc2lub24nKVxuXG5SZWRpc1dvcmtlciA9IHJlcXVpcmUoJy4uL2xpYi9pbmRleC5qcycpXG5Xb3JrZXIgICAgICA9IFJlZGlzV29ya2VyLldvcmtlclxuXG5FdmVudEVtaXR0ZXIgPSByZXF1aXJlKCdldmVudHMnKS5FdmVudEVtaXR0ZXJcblxuY2xhc3MgVGVzdFdvcmtlciBleHRlbmRzIFdvcmtlclxuICBjb25zdHJ1Y3RvcjogKG9wdGlvbnMpIC0+XG4gICAge0B1cmwsIEB0YXNrTGltaXQsIEByZXRyeVRhc2tzfSA9IG9wdGlvbnNcbiAgICBzdXBlciB1cmw6IEB1cmwsIHRhc2tMaW1pdDogQHRhc2tMaW1pdCwgcmV0cnlUYXNrczogQHJldHJ5VGFza3NcblxuICAgIEBlbWl0dGVyICAgICAgICA9IG5ldyBFdmVudEVtaXR0ZXIoKVxuICAgIEByZXNldCgpXG5cbiAgbmFtZTogKCkgLT4gXCJUZXN0I3tAd29ya2VySUR9XCJcblxuICByZXNldDogKCkgLT5cbiAgICBAcGVuZGluZ1Rhc2tzICAgPSBbXVxuICAgIEBydW5uaW5nVGFza3MgICA9IFtdXG4gICAgQGRvbmVUYXNrcyAgICAgID0gW11cbiAgICBAZmFpbGVkVGFza3MgICAgPSBbXVxuICAgIEB0YXNrc0NhbGxiYWNrcyA9IHt9XG5cbiAgICBAbWF4UnVubmluZ0F0T25jZSA9IDBcblxuICBlcnJvclRhc2s6IChpZCkgLT5cbiAgICBleHBlY3QoQHJ1bm5pbmdUYXNrcykudG8uY29udGFpbiBpZFxuICAgIGV4cGVjdChAZG9uZVRhc2tzKS50by5ub3QuY29udGFpbiBpZFxuICAgIGV4cGVjdChAZmFpbGVkVGFza3MpLnRvLm5vdC5jb250YWluIGlkXG5cbiAgICBAZmFpbGVkVGFza3MucHVzaCBpZFxuICAgIEBydW5uaW5nVGFza3MgPSBfLnJlamVjdCBAcnVubmluZ1Rhc2tzLCAocnVubmluZ0l0ZW1JRCkgLT4gcnVubmluZ0l0ZW1JRCA9PSBpZFxuXG4gICAgQGVtaXR0ZXIuZW1pdCAnZmFpbGVkJywgaWRcblxuICAgIEB0YXNrc0NhbGxiYWNrc1tpZF0gbmV3IEVycm9yKFwiZXJyb3JcIilcblxuICBmaW5pc2hTb21lVGFzazogKCkgLT5cbiAgICBAZmluaXNoVGFzayBAcnVubmluZ1Rhc2tzWzBdXG5cbiAgZmluaXNoVGFzazogKGlkKSAtPlxuICAgIGV4cGVjdChAcnVubmluZ1Rhc2tzKS50by5jb250YWluIGlkXG4gICAgZXhwZWN0KEBkb25lVGFza3MpLnRvLm5vdC5jb250YWluIGlkXG4gICAgZXhwZWN0KEBmYWlsZWRUYXNrcykudG8ubm90LmNvbnRhaW4gaWRcblxuICAgIEBkb25lVGFza3MucHVzaCBpZFxuICAgIEBydW5uaW5nVGFza3MgPSBfLnJlamVjdCBAcnVubmluZ1Rhc2tzLCAocnVubmluZ0l0ZW1JRCkgLT4gcnVubmluZ0l0ZW1JRCA9PSBpZFxuXG4gICAgQGVtaXR0ZXIuZW1pdCAnZG9uZScsIGlkXG5cbiAgICBAdGFza3NDYWxsYmFja3NbaWRdKClcblxuICBwdXNoSm9iOiAocGF5bG9hZCwgY2IpIC0+XG4gICAgc3VwZXJcbiAgICBAcGVuZGluZ1Rhc2tzLnB1c2ggcGF5bG9hZC5pZFxuXG4gIHdvcms6IChwYXlsb2FkLCBkb25lKSAtPlxuICAgIHBheWxvYWQgPSBKU09OLnBhcnNlKHBheWxvYWQpXG5cbiAgICBpZCA9IHBheWxvYWQuaWRcblxuICAgIEB0YXNrc0NhbGxiYWNrc1tpZF0gPSBkb25lXG5cbiAgICBAcnVubmluZ1Rhc2tzLnB1c2ggaWRcbiAgICBAcGVuZGluZ1Rhc2tzID0gXy5yZWplY3QgQHBlbmRpbmdUYXNrcywgKHBlbmRpbmdJdGVtSUQpIC0+IHBlbmRpbmdJdGVtSUQgPT0gaWRcblxuICAgIEBlbWl0dGVyLmVtaXQgJ3J1bm5pbmcnLCBpZFxuXG4gICAgQG1heFJ1bm5pbmdBdE9uY2UgPSBNYXRoLm1heChAbWF4UnVubmluZ0F0T25jZSwgQHJ1bm5pbmdUYXNrcy5sZW5ndGgpXG5cbiAgZXJyb3I6IChlcnIsIHRhc2ssIGRvbmUpIC0+XG4gICAgI2NvbnNvbGUubG9nICdbRXJyb3JdJywgZXJyIGlmIGVyclxuICAgIGRvbmUoKVxuXG5cbmNyZWF0ZVdvcmtlciA9ICh3b3JrZXJJRCwgdGFza0xpbWl0KSAtPlxuICB3b3JrZXIgPSBuZXcgVGVzdFdvcmtlciB1cmw6IFwicmVkaXM6Ly9sb2NhbGhvc3Q6NjM3OS8zMlwiLCB0YXNrTGltaXQ6IHRhc2tMaW1pdFxuICB3b3JrZXIud29ya2VySUQgPSB3b3JrZXJJRFxuXG4gIHdvcmtlclxuXG5jbGVhbldvcmtlciA9ICh3b3JrZXIsIGNhbGxiYWNrKSAtPlxuICB3b3JrZXIucmVzZXQoKVxuICB3b3JrZXIub2J0YWluTGlzdENsaWVudCAoZXJyLCBjbGllbnQpIC0+XG4gICAgcmV0dXJuIGNhbGxiYWNrIGVyciBpZiBlcnJcblxuICAgIGFzeW5jLnBhcmFsbGVsIFtcbiAgICAgIChuZXh0KSAtPiBjbGllbnQuZGVsIHdvcmtlci5saXN0S2V5KCksIG5leHQsXG4gICAgICAobmV4dCkgLT4gY2xpZW50LmRlbCB3b3JrZXIuY2hhbm5lbEtleSgpLCBuZXh0XG4gICAgXSwgY2FsbGJhY2tcblxuXG5jb25jdXJyZW5jeTFXb3JrZXIgPSBudWxsXG5jb25jdXJyZW5jeTJXb3JrZXIgPSBudWxsXG5cbmJlZm9yZSAoZG9uZSkgLT5cbiAgc2lub24uc3R1YihyZWRpcywgJ2NyZWF0ZUNsaWVudCcsIGZha2VyZWRpcy5jcmVhdGVDbGllbnQpXG5cbiAgY29uY3VycmVuY3kxV29ya2VyID0gY3JlYXRlV29ya2VyKFwiY29uY3VycmVuY3kxV29ya2VyXCIsIDEpXG4gIGNvbmN1cnJlbmN5MldvcmtlciA9IGNyZWF0ZVdvcmtlcihcImNvbmN1cnJlbmN5MldvcmtlclwiLCAyKVxuXG4gIGFzeW5jLmVhY2ggW2NvbmN1cnJlbmN5MVdvcmtlciwgY29uY3VycmVuY3kyV29ya2VyXVxuICAsICh3b3JrZXIsIG5leHQpIC0+XG4gICAgYXN5bmMuc2VyaWVzIFtcbiAgICAgIChpbm5lck5leHQpIC0+IHdvcmtlci53YWl0Rm9yVGFza3MgaW5uZXJOZXh0XG4gICAgXSwgbmV4dFxuICAsIGRvbmVcblxuYWZ0ZXIgKGRvbmUpIC0+XG4gIGNvbmN1cnJlbmN5MldvcmtlciA9IG51bGxcbiAgY29uY3VycmVuY3kxV29ya2VyID0gbnVsbFxuXG4gIHJlZGlzLmNyZWF0ZUNsaWVudC5yZXN0b3JlKClcblxuICBkb25lKClcblxuYmVmb3JlRWFjaCAoZG9uZSkgLT5cbiAgYXN5bmMuZWFjaCBbY29uY3VycmVuY3kxV29ya2VyLCBjb25jdXJyZW5jeTJXb3JrZXJdLCBjbGVhbldvcmtlciwgZG9uZVxuXG4jIEhlbHBlcnNcbndhaXRVbnRpbCA9ICh0ZXN0RnVuYywgY2FsbGJhY2spIC0+XG4gIGlmIHRlc3RGdW5jKClcbiAgICBjYWxsYmFjaygpXG4gIGVsc2VcbiAgICBzZXRUaW1lb3V0ICgpIC0+XG4gICAgICB3YWl0VW50aWwodGVzdEZ1bmMsIGNhbGxiYWNrKVxuICAgICwgMTAwXG5cbk1hdGgubWVhbiA9IChhcnJheSkgLT4gKF8ucmVkdWNlIGFycmF5LCAoYSwgYikgLT4gYStiKSAvIGFycmF5Lmxlbmd0aFxuXG5NYXRoLnN0RGV2ID0gKGFycmF5KSAtPlxuICBtZWFuID0gTWF0aC5tZWFuIGFycmF5XG4gIGRldiAgPSBfLm1hcCBhcnJheSwgKGl0bSkgLT4gKGl0bS1tZWFuKSAqIChpdG0tbWVhbilcblxuICByZXR1cm4gTWF0aC5zcXJ0IE1hdGgubWVhbihkZXYpXG5cbmRlc2NyaWJlICdyZWRpcy13b3JrZXIgdGVzdHMnLCAoKSAtPlxuICBkZXNjcmliZSAnbm9ybWFsIHRlc3RzJywgKCkgLT4gICAgXG4gICAgaXQgJ3Nob3VsZCBleGl0IHByb2Nlc3Mgb24gdW5oYW5kbGVkIGV4Yy4gbGV0dGluZyBhbGwgcnVubmluZyB0YXNrcyBmaW5pc2gnLCAoZG9uZSkgLT5cbiAgICAgIGNvbmN1cnJlbmN5ID0gNVxuICAgICAgZXhjVGhyb3dpbmdUYXNrSWQgPSBudWxsXG5cbiAgICAgIHByb2Nlc3NFeGl0ID0gKGNvZGUpIC0+XG4gICAgICAgIHRyeVxuICAgICAgICAgIGV4cGVjdCh3b3JrZXIucnVubmluZ1Rhc2tzKS50by5lcWwgW2V4Y1Rocm93aW5nVGFza0lkXVxuICAgICAgICAgIGV4cGVjdCh3b3JrZXIuZG9uZVRhc2tzLmxlbmd0aCkudG8uZXF1YWwgKGNvbmN1cnJlbmN5IC0gMSlcbiAgICAgICAgICBleHBlY3Qod29ya2VyLmZhaWxlZFRhc2tzLmxlbmd0aCkudG8uZXF1YWwgMFxuXG4gICAgICAgICAgZG9uZSgpXG4gICAgICAgIGNhdGNoIGVyclxuICAgICAgICAgIGRvbmUgZXJyICBcbiAgICAgICAgZmluYWxseVxuICAgICAgICAgIHByb2Nlc3MuZXhpdC5yZXN0b3JlKClcblxuICAgICAgc2lub24uc3R1Yihwcm9jZXNzLCAnZXhpdCcsIHByb2Nlc3NFeGl0KVxuXG4gICAgICB3b3JrZXIgPSBjcmVhdGVXb3JrZXIgXCJleGl0X3Rlc3RfMVwiLCBjb25jdXJyZW5jeVxuICAgICAgYXV0b2ZpbmlzaEpvYiA9IChpZCkgLT5cbiAgICAgICAgaWYgd29ya2VyLnJ1bm5pbmdUYXNrcy5sZW5ndGggPiAoY29uY3VycmVuY3kgLSAxKVxuICAgICAgICAgIGV4Y1Rocm93aW5nVGFza0lkID0gaWRcbiAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IgXCJVbmhhbmRsZWQgZXhjZXB0aW9uIG1vY2suXCJcblxuICAgICAgICBzZXRUaW1lb3V0ICgpIC0+XG4gICAgICAgICAgd29ya2VyLmZpbmlzaFRhc2soaWQpXG4gICAgICAgICwgKDEwMDAgKyBNYXRoLnJhbmRvbSgpICogNTAwKVxuXG4gICAgICB3b3JrZXIuZW1pdHRlci5vbiAncnVubmluZycsIGF1dG9maW5pc2hKb2JcblxuICAgICAgYXN5bmMuc2VyaWVzIFtcbiAgICAgICAgKG5leHQpIC0+IGNsZWFuV29ya2VyIHdvcmtlciwgbmV4dCxcbiAgICAgICAgKG5leHQpIC0+IHdvcmtlci53YWl0Rm9yVGFza3MgbmV4dCxcbiAgICAgICAgKG5leHQpIC0+IFxuICAgICAgICAgIGFzeW5jLmVhY2ggWzEuLmNvbmN1cnJlbmN5XSwgKGlkLCBpbm5lck5leHQpIC0+XG4gICAgICAgICAgICB3b3JrZXIucHVzaEpvYiB7IGlkOiBpZCB9LCBpbm5lck5leHRcbiAgICAgICAgICAsIG5leHRcbiAgICAgIF0sIChlcnIpIC0+XG4gICAgICAgIHJldHVybiBkb25lIGVyciBpZiBlcnJcblxuICAgIGl0ICdzaG91bGQgZXhpdCBwcm9jZXNzIG9uIHR3byB1bmhhbmRsZWQgZXhjLiBsZXR0aW5nIGFsbCBydW5uaW5nIHRhc2tzIGZpbmlzaCcsIChkb25lKSAtPlxuICAgICAgY29uY3VycmVuY3kgPSA1XG4gICAgICBleGNUaHJvd2luZ1Rhc2tJZHMgPSBbXVxuXG4gICAgICBwcm9jZXNzRXhpdCA9IChjb2RlKSAtPlxuICAgICAgICB0cnlcbiAgICAgICAgICBleHBlY3Qod29ya2VyLnJ1bm5pbmdUYXNrcykudG8uZXFsIGV4Y1Rocm93aW5nVGFza0lkc1xuICAgICAgICAgIGV4cGVjdCh3b3JrZXIuZG9uZVRhc2tzLmxlbmd0aCkudG8uZXF1YWwgKGNvbmN1cnJlbmN5IC0gMilcbiAgICAgICAgICBleHBlY3Qod29ya2VyLmZhaWxlZFRhc2tzLmxlbmd0aCkudG8uZXF1YWwgMFxuXG4gICAgICAgICAgZG9uZSgpXG4gICAgICAgIGNhdGNoIGVyclxuICAgICAgICAgIGRvbmUgZXJyICBcbiAgICAgICAgZmluYWxseVxuICAgICAgICAgIHByb2Nlc3MuZXhpdC5yZXN0b3JlKClcblxuICAgICAgc2lub24uc3R1Yihwcm9jZXNzLCAnZXhpdCcsIHByb2Nlc3NFeGl0KVxuXG4gICAgICB3b3JrZXIgPSBjcmVhdGVXb3JrZXIgXCJleGl0X3Rlc3RfMVwiLCBjb25jdXJyZW5jeVxuICAgICAgYXV0b2ZpbmlzaEpvYiA9IChpZCkgLT5cbiAgICAgICAgaWYgd29ya2VyLnJ1bm5pbmdUYXNrcy5sZW5ndGggPiAoY29uY3VycmVuY3kgLSAyKVxuICAgICAgICAgIGV4Y1Rocm93aW5nVGFza0lkcy5wdXNoIGlkXG4gICAgICAgICAgdGhyb3cgbmV3IEVycm9yIFwiVW5oYW5kbGVkIGV4Y2VwdGlvbiBtb2NrLlwiXG5cbiAgICAgICAgc2V0VGltZW91dCAoKSAtPlxuICAgICAgICAgIHdvcmtlci5maW5pc2hUYXNrKGlkKVxuICAgICAgICAsICgxMDAwICsgTWF0aC5yYW5kb20oKSAqIDUwMClcblxuICAgICAgd29ya2VyLmVtaXR0ZXIub24gJ3J1bm5pbmcnLCBhdXRvZmluaXNoSm9iXG5cbiAgICAgIGFzeW5jLnNlcmllcyBbXG4gICAgICAgIChuZXh0KSAtPiBjbGVhbldvcmtlciB3b3JrZXIsIG5leHQsXG4gICAgICAgIChuZXh0KSAtPiB3b3JrZXIud2FpdEZvclRhc2tzIG5leHQsXG4gICAgICAgIChuZXh0KSAtPiBcbiAgICAgICAgICBhc3luYy5lYWNoIFsxLi5jb25jdXJyZW5jeV0sIChpZCwgaW5uZXJOZXh0KSAtPlxuICAgICAgICAgICAgd29ya2VyLnB1c2hKb2IgeyBpZDogaWQgfSwgaW5uZXJOZXh0XG4gICAgICAgICAgLCBuZXh0XG4gICAgICBdLCAoZXJyKSAtPlxuICAgICAgICByZXR1cm4gZG9uZSBlcnIgaWYgZXJyXG5cbiAgICBpdCAnc2hvdWxkIGV4aXQgcHJvY2VzcyBvbiB1bmhhbmRsZWQgZXhjLiBraWxsaW5nIGFsbCBydW5uaW5nIHRhc2tzIGlmIHRoZXkgZG9uXFwndCBtYW5hZ2UgdG8gZmluaXNoIG9uIHRpbWUnLCAoZG9uZSkgLT5cbiAgICAgIGNvbmN1cnJlbmN5ID0gNVxuICAgICAgZXhjVGhyb3dpbmdUYXNrSWQgPSBudWxsXG5cbiAgICAgIHByb2Nlc3NFeGl0ID0gKGNvZGUpIC0+XG4gICAgICAgIHRyeVxuICAgICAgICAgIGV4cGVjdCh3b3JrZXIucnVubmluZ1Rhc2tzKS50by5lcWwgWzEuLmNvbmN1cnJlbmN5XVxuICAgICAgICAgIGV4cGVjdCh3b3JrZXIuZG9uZVRhc2tzLmxlbmd0aCkudG8uZXF1YWwgMFxuICAgICAgICAgIGV4cGVjdCh3b3JrZXIuZmFpbGVkVGFza3MubGVuZ3RoKS50by5lcXVhbCAwXG5cbiAgICAgICAgICBkb25lKClcbiAgICAgICAgY2F0Y2ggZXJyXG4gICAgICAgICAgZG9uZSBlcnIgIFxuICAgICAgICBmaW5hbGx5XG4gICAgICAgICAgcHJvY2Vzcy5leGl0LnJlc3RvcmUoKVxuXG4gICAgICBzaW5vbi5zdHViKHByb2Nlc3MsICdleGl0JywgcHJvY2Vzc0V4aXQpXG5cbiAgICAgIHdvcmtlciA9IGNyZWF0ZVdvcmtlciBcImV4aXRfdGVzdF8xXCIsIGNvbmN1cnJlbmN5XG4gICAgICB3b3JrZXIuZ3JhY2VmdWxTaHV0ZG93blRpbWVvdXQgPSAxMDAwXG4gICAgICBhdXRvZmluaXNoSm9iID0gKGlkKSAtPlxuICAgICAgICBpZiB3b3JrZXIucnVubmluZ1Rhc2tzLmxlbmd0aCA+IChjb25jdXJyZW5jeSAtIDEpXG4gICAgICAgICAgZXhjVGhyb3dpbmdUYXNrSWQgPSBpZFxuICAgICAgICAgIHRocm93IG5ldyBFcnJvciBcIlVuaGFuZGxlZCBleGNlcHRpb24gbW9jay5cIlxuXG4gICAgICAgIHNldFRpbWVvdXQgKCkgLT5cbiAgICAgICAgICB3b3JrZXIuZmluaXNoVGFzayhpZClcbiAgICAgICAgLCAoMTUwMDAwICsgTWF0aC5yYW5kb20oKSAqIDUwMClcblxuICAgICAgd29ya2VyLmVtaXR0ZXIub24gJ3J1bm5pbmcnLCBhdXRvZmluaXNoSm9iXG5cbiAgICAgIGFzeW5jLnNlcmllcyBbXG4gICAgICAgIChuZXh0KSAtPiBjbGVhbldvcmtlciB3b3JrZXIsIG5leHQsXG4gICAgICAgIChuZXh0KSAtPiB3b3JrZXIud2FpdEZvclRhc2tzIG5leHQsXG4gICAgICAgIChuZXh0KSAtPiBcbiAgICAgICAgICBhc3luYy5lYWNoIFsxLi5jb25jdXJyZW5jeV0sIChpZCwgaW5uZXJOZXh0KSAtPlxuICAgICAgICAgICAgd29ya2VyLnB1c2hKb2IgeyBpZDogaWQgfSwgaW5uZXJOZXh0XG4gICAgICAgICAgLCBuZXh0XG4gICAgICBdLCAoZXJyKSAtPlxuICAgICAgICByZXR1cm4gZG9uZSBlcnIgaWYgZXJyXG5cbiAgICBpdCAnc2hvdWxkIHF1ZXVlIHVwIGEgam9iIGFuZCBkbyBpdCcsIChkb25lKSAtPlxuICAgICAgYXN5bmMuc2VyaWVzIFtcbiAgICAgICAgKG5leHQpIC0+IGNvbmN1cnJlbmN5MVdvcmtlci5wdXNoSm9iIHsgaWQ6IFwiMVwiIH0sIG5leHQsXG4gICAgICAgIChuZXh0KSAtPlxuICAgICAgICAgIHdhaXRVbnRpbCAoKSAtPlxuICAgICAgICAgICAgXCIxXCIgaW4gY29uY3VycmVuY3kxV29ya2VyLnJ1bm5pbmdUYXNrc1xuICAgICAgICAgICwgbmV4dCxcbiAgICAgICAgKG5leHQpIC0+XG4gICAgICAgICAgY29uY3VycmVuY3kxV29ya2VyLmZpbmlzaFRhc2sgXCIxXCJcbiAgICAgICAgICB3YWl0VW50aWwgKCkgLT5cbiAgICAgICAgICAgIFwiMVwiIGluIGNvbmN1cnJlbmN5MVdvcmtlci5kb25lVGFza3NcbiAgICAgICAgICAsIG5leHRcbiAgICAgIF0sIChlcnIpIC0+XG4gICAgICAgIGV4cGVjdChjb25jdXJyZW5jeTFXb3JrZXIuZG9uZVRhc2tzKS50by5jb250YWluIFwiMVwiXG4gICAgICAgIGRvbmUgZXJyXG5cbiAgICBpdCAnc2hvdWxkIHF1ZXVlIHVwIGEgam9iIGFuZCBkbyBpdCBpbiBvcmRlcicsIChkb25lKSAtPlxuICAgICAgYXN5bmMuc2VyaWVzIFtcbiAgICAgICAgKG5leHQpIC0+IGNvbmN1cnJlbmN5MVdvcmtlci5wdXNoSm9iIHsgaWQ6IFwiMVwiIH0sIG5leHQsXG4gICAgICAgIChuZXh0KSAtPiBjb25jdXJyZW5jeTFXb3JrZXIucHVzaEpvYiB7IGlkOiBcIjJcIiB9LCBuZXh0LFxuICAgICAgICAobmV4dCkgLT5cbiAgICAgICAgICB3YWl0VW50aWwgKCkgLT5cbiAgICAgICAgICAgIFwiMVwiIGluIGNvbmN1cnJlbmN5MVdvcmtlci5ydW5uaW5nVGFza3NcbiAgICAgICAgICAsIG5leHQsXG4gICAgICAgIChuZXh0KSAtPlxuICAgICAgICAgIGNvbmN1cnJlbmN5MVdvcmtlci5maW5pc2hTb21lVGFzaygpXG4gICAgICAgICAgd2FpdFVudGlsICgpIC0+XG4gICAgICAgICAgICBcIjJcIiBpbiBjb25jdXJyZW5jeTFXb3JrZXIucnVubmluZ1Rhc2tzXG4gICAgICAgICAgLCBuZXh0LFxuICAgICAgICAobmV4dCkgLT5cbiAgICAgICAgICBjb25jdXJyZW5jeTFXb3JrZXIuZmluaXNoU29tZVRhc2soKVxuICAgICAgICAgIHdhaXRVbnRpbCAoKSAtPlxuICAgICAgICAgICAgXCIyXCIgaW4gY29uY3VycmVuY3kxV29ya2VyLmRvbmVUYXNrc1xuICAgICAgICAgICwgbmV4dFxuICAgICAgXSwgKGVycikgLT5cbiAgICAgICAgZXhwZWN0KGNvbmN1cnJlbmN5MVdvcmtlci5kb25lVGFza3MpLnRvLmNvbnRhaW4gXCIxXCJcbiAgICAgICAgZXhwZWN0KGNvbmN1cnJlbmN5MVdvcmtlci5kb25lVGFza3MpLnRvLmNvbnRhaW4gXCIyXCJcbiAgICAgICAgZXhwZWN0KGNvbmN1cnJlbmN5MVdvcmtlci5tYXhSdW5uaW5nQXRPbmNlKS50by5lcXVhbCAxXG5cbiAgICAgICAgZG9uZSBlcnJcblxuIyBAVE9ETzogVGVzdCBpZiBlcnJvciBpcyBjYWxsZWQgb3V0IHdoZW4gQHdvcmsgcmV0dXJucyBhbiBlcnJvci5cblxuICBkZXNjcmliZSAnY29uY3VycmVuY3kgdGVzdHMnLCAoKSAtPlxuICAgIGl0ICdzaG91bGQgcnVuIHVwIHRvIDx0YXNrTGltaXQ+IGpvYnMgYXQgb25jZScsIChkb25lKSAtPlxuICAgICAgd29ya2VyICAgICAgPSBjb25jdXJyZW5jeTJXb3JrZXJcbiAgICAgIHRhc2tzTnVtYmVyID0gMjBcblxuICAgICAgYXV0b2ZpbmlzaEpvYkluNTBtcyA9IChpZCkgLT5cbiAgICAgICAgc2V0VGltZW91dCAoKSAtPlxuICAgICAgICAgIHdvcmtlci5maW5pc2hUYXNrKGlkKVxuICAgICAgICAsIDUwXG5cbiAgICAgIHdvcmtlci5lbWl0dGVyLm9uICdydW5uaW5nJywgYXV0b2ZpbmlzaEpvYkluNTBtc1xuXG4gICAgICBhc3luYy5zZXJpZXMgW1xuICAgICAgICAobmV4dCkgLT5cbiAgICAgICAgICBhc3luYy5lYWNoIFsxLi50YXNrc051bWJlcl0sIChpZCwgaW5uZXJOZXh0KSAtPlxuICAgICAgICAgICAgd29ya2VyLnB1c2hKb2IgeyBpZDogaWQgfSwgaW5uZXJOZXh0XG4gICAgICAgICAgLCBuZXh0XG4gICAgICAgIChuZXh0KSAtPlxuICAgICAgICAgIHdhaXRVbnRpbCAoKSAtPlxuICAgICAgICAgICAgd29ya2VyLnBlbmRpbmdUYXNrcy5sZW5ndGggPT0gMFxuICAgICAgICAgICwgbmV4dCxcbiAgICAgICAgKG5leHQpIC0+XG4gICAgICAgICAgd2FpdFVudGlsICgpIC0+XG4gICAgICAgICAgICB3b3JrZXIuZG9uZVRhc2tzLmxlbmd0aCA9PSB0YXNrc051bWJlclxuICAgICAgICAgICwgbmV4dCxcbiAgICAgIF0sIChlcnIpIC0+XG4gICAgICAgIGV4cGVjdCh3b3JrZXIubWF4UnVubmluZ0F0T25jZSkudG8uZXF1YWwgd29ya2VyLnRhc2tMaW1pdFxuXG4gICAgICAgIHdvcmtlci5lbWl0dGVyLnJlbW92ZUxpc3RlbmVyICdydW5uaW5nJywgYXV0b2ZpbmlzaEpvYkluNTBtc1xuICAgICAgICBkb25lIGVyclxuXG4gICAgaXQgJ3Nob3VsZCBub3Qgc3RhcnZlIG90aGVyIHF1ZXVlcyBpZiBydW5uaW5nIHNpZGUgYnkgc2lkZScsIChkb25lKSAtPlxuICAgICAgdGFza3NOdW1iZXIgID0gMjAwMFxuICAgICAgY29uY3VycmVuY3kgID0gMjBcbiAgICAgIHdvcmtlcnNDb3VudCA9IDVcblxuICAgICAgd29ya2VycyA9IFtdXG4gICAgICBhc3luYy5tYXAgWzEuLndvcmtlcnNDb3VudF0sIChpZHgsIG5leHQpIC0+XG4gICAgICAgIHdvcmtlciA9IGNyZWF0ZVdvcmtlciBcInNhbWVfaWRcIiwgY29uY3VycmVuY3lcbiAgICAgICAgY2xlYW5Xb3JrZXIgd29ya2VyLCAoZXJyKSAtPlxuICAgICAgICAgIHJldHVybiBuZXh0IGVyciBpZiBlcnJcblxuICAgICAgICAgIHdvcmtlci53YWl0Rm9yVGFza3MgKGVycikgLT5cbiAgICAgICAgICAgIG5leHQgZXJyLCB3b3JrZXJcbiAgICAgICwgKGVyciwgd29ya2VycykgLT5cbiAgICAgICAgYXV0b2ZpbmlzaEpvYkluNTBtc0ZhY3RvcnkgPSAod29ya2VyKSAtPlxuICAgICAgICAgIChpZCkgLT5cbiAgICAgICAgICAgIHNldFRpbWVvdXQgKCkgLT5cbiAgICAgICAgICAgICAgd29ya2VyLmZpbmlzaFRhc2soaWQpXG4gICAgICAgICAgICAsICg4MCArIE1hdGgucmFuZG9tKCkgKiA0MClcblxuICAgICAgICBmb3Igd29ya2VyIGluIHdvcmtlcnNcbiAgICAgICAgICB3b3JrZXIuYXV0b2ZpbmlzaEpvYkluNTBtcyA9IGF1dG9maW5pc2hKb2JJbjUwbXNGYWN0b3J5KHdvcmtlcilcbiAgICAgICAgICB3b3JrZXIuZW1pdHRlci5vbiAncnVubmluZycsIHdvcmtlci5hdXRvZmluaXNoSm9iSW41MG1zXG5cbiAgICAgICAgY291bnRBbGxEb25lVGFza3MgPSAoKSAtPiBfLnJlZHVjZSB3b3JrZXJzLCAoKHN1bSwgd29ya2VyKSAtPiBzdW0gKyB3b3JrZXIuZG9uZVRhc2tzLmxlbmd0aCksIDBcblxuICAgICAgICBhc3luYy5zZXJpZXMgW1xuICAgICAgICAgIChuZXh0KSAtPlxuICAgICAgICAgICAgYXN5bmMuZWFjaCBbMS4udGFza3NOdW1iZXJdLCAoaWQsIGlubmVyTmV4dCkgLT5cbiAgICAgICAgICAgICAgd29ya2Vyc1swXS5wdXNoSm9iIHsgaWQ6IFwiQSN7aWR9XCIgfSwgaW5uZXJOZXh0XG4gICAgICAgICAgICAsIG5leHRcbiAgICAgICAgICAobmV4dCkgLT5cbiAgICAgICAgICAgIHdhaXRVbnRpbCAoKSAtPlxuICAgICAgICAgICAgICBjb3VudEFsbERvbmVUYXNrcygpID09IHRhc2tzTnVtYmVyXG4gICAgICAgICAgICAsIG5leHQsXG4gICAgICAgIF0sIChlcnIpIC0+XG4gICAgICAgICAgZm9yIHdvcmtlciBpbiB3b3JrZXJzXG4gICAgICAgICAgICB3b3JrZXIuZW1pdHRlci5yZW1vdmVMaXN0ZW5lciAncnVubmluZycsIHdvcmtlci5hdXRvZmluaXNoSm9iSW41MG1zXG5cbiAgICAgICAgICBkb25lVGFza3MgPSBfLm1hcCB3b3JrZXJzLCAod29ya2VyKSAtPiB3b3JrZXIuZG9uZVRhc2tzLmxlbmd0aFxuICAgICAgICAgIGV4cGVjdChNYXRoLnN0RGV2IGRvbmVUYXNrcykudG8uYmUuYmVsb3codGFza3NOdW1iZXIgLyAxMDAuMClcblxuICAgICAgICAgIGRvbmUgZXJyXG5cbiAgICBpdCAnc2hvdWxkIG5vdCBzdGFydmUgb3RoZXIgcXVldWVzIGlmIHN0YXJ0aW5nIHdpdGggcHVzaGVkIHRhc2tzJywgKGRvbmUpIC0+XG4gICAgICB0YXNrc051bWJlciAgPSA0MDBcbiAgICAgIGNvbmN1cnJlbmN5ICA9IDIwXG4gICAgICB3b3JrZXJzQ291bnQgPSA1XG5cbiAgICAgIHdvcmtlcnMgPSBbXVxuICAgICAgYXN5bmMubWFwIFsxLi53b3JrZXJzQ291bnRdLCAoaWR4LCBuZXh0KSAtPlxuICAgICAgICB3b3JrZXIgPSBjcmVhdGVXb3JrZXIgXCJzYW1lX2lkMlwiLCBjb25jdXJyZW5jeVxuICAgICAgICBjbGVhbldvcmtlciB3b3JrZXIsIChlcnIpIC0+XG4gICAgICAgICAgbmV4dCBlcnIsIHdvcmtlclxuICAgICAgLCAoZXJyLCB3b3JrZXJzKSAtPlxuICAgICAgICBhdXRvZmluaXNoSm9iSW41MG1zRmFjdG9yeSA9ICh3b3JrZXIpIC0+XG4gICAgICAgICAgKGlkKSAtPlxuICAgICAgICAgICAgc2V0VGltZW91dCAoKSAtPlxuICAgICAgICAgICAgICB3b3JrZXIuZmluaXNoVGFzayhpZClcbiAgICAgICAgICAgICwgKDgwICsgTWF0aC5yYW5kb20oKSAqIDQwKVxuXG4gICAgICAgIGZvciB3b3JrZXIgaW4gd29ya2Vyc1xuICAgICAgICAgIHdvcmtlci5hdXRvZmluaXNoSm9iSW41MG1zID0gYXV0b2ZpbmlzaEpvYkluNTBtc0ZhY3Rvcnkod29ya2VyKVxuICAgICAgICAgIHdvcmtlci5lbWl0dGVyLm9uICdydW5uaW5nJywgd29ya2VyLmF1dG9maW5pc2hKb2JJbjUwbXNcblxuICAgICAgICBjb3VudEFsbERvbmVUYXNrcyA9ICgpIC0+IF8ucmVkdWNlIHdvcmtlcnMsICgoc3VtLCB3b3JrZXIpIC0+IHN1bSArIHdvcmtlci5kb25lVGFza3MubGVuZ3RoKSwgMFxuXG4gICAgICAgIGFzeW5jLnNlcmllcyBbXG4gICAgICAgICAgKG5leHQpIC0+XG4gICAgICAgICAgICBhc3luYy5lYWNoIFsxLi50YXNrc051bWJlcl0sIChpZCwgaW5uZXJOZXh0KSAtPlxuICAgICAgICAgICAgICB3b3JrZXJzWzBdLnB1c2hKb2IgeyBpZDogXCJCI3tpZH1cIiB9LCBpbm5lck5leHRcbiAgICAgICAgICAgICwgbmV4dFxuICAgICAgICAgIChuZXh0KSAtPlxuICAgICAgICAgICAgYXN5bmMuZWFjaFNlcmllcyB3b3JrZXJzLCAod29ya2VyLCBpbm5lck5leHQpIC0+XG4gICAgICAgICAgICAgIHdvcmtlci53YWl0Rm9yVGFza3MgaW5uZXJOZXh0XG4gICAgICAgICAgICAsIG5leHRcbiAgICAgICAgICAobmV4dCkgLT5cbiAgICAgICAgICAgIHdhaXRVbnRpbCAoKSAtPlxuICAgICAgICAgICAgICBjb3VudEFsbERvbmVUYXNrcygpID09IHRhc2tzTnVtYmVyXG4gICAgICAgICAgICAsIG5leHQsXG4gICAgICAgIF0sIChlcnIpIC0+XG4gICAgICAgICAgZm9yIHdvcmtlciBpbiB3b3JrZXJzXG4gICAgICAgICAgICB3b3JrZXIuZW1pdHRlci5yZW1vdmVMaXN0ZW5lciAncnVubmluZycsIHdvcmtlci5hdXRvZmluaXNoSm9iSW41MG1zXG5cbiAgICAgICAgICBkb25lVGFza3MgPSBfLm1hcCB3b3JrZXJzLCAod29ya2VyKSAtPiB3b3JrZXIuZG9uZVRhc2tzLmxlbmd0aFxuICAgICAgICAgIGV4cGVjdChNYXRoLnN0RGV2IGRvbmVUYXNrcykudG8uYmUuYmVsb3codGFza3NOdW1iZXIgLyAxMDAuMClcblxuICAgICAgICAgIGRvbmUgZXJyXG5cbiAgICBpdCAnc2hvdWxkIHVzZSBhbGwgY29uY3VycmVuY3kgc2xvdHMgYXQgYWxsIHRpbWVzJywgKGRvbmUpIC0+XG4gICAgICB0YXNrc051bWJlciAgPSAyMDAwXG4gICAgICBjb25jdXJyZW5jeSAgPSAxMFxuICAgICAgd29ya2Vyc0NvdW50ID0gNVxuXG4gICAgICB3b3JrZXJzID0gW11cbiAgICAgIGFzeW5jLm1hcCBbMS4ud29ya2Vyc0NvdW50XSwgKGlkeCwgbmV4dCkgLT5cbiAgICAgICAgd29ya2VyID0gY3JlYXRlV29ya2VyIFwic2FtZV9pZDNcIiwgY29uY3VycmVuY3lcbiAgICAgICAgY2xlYW5Xb3JrZXIgd29ya2VyLCAoZXJyKSAtPlxuICAgICAgICAgIG5leHQgZXJyLCB3b3JrZXJcbiAgICAgICwgKGVyciwgd29ya2VycykgLT5cbiAgICAgICAgYXV0b2ZpbmlzaEpvYkluNTBtc0ZhY3RvcnkgPSAod29ya2VyKSAtPlxuICAgICAgICAgIChpZCkgLT5cbiAgICAgICAgICAgIHNldFRpbWVvdXQgKCkgLT5cbiAgICAgICAgICAgICAgd29ya2VyLmZpbmlzaFRhc2soaWQpXG4gICAgICAgICAgICAsICg0MCArIE1hdGgucmFuZG9tKCkgKiA0MClcblxuICAgICAgICBmb3Igd29ya2VyIGluIHdvcmtlcnNcbiAgICAgICAgICB3b3JrZXIuYXV0b2ZpbmlzaEpvYkluNTBtcyA9IGF1dG9maW5pc2hKb2JJbjUwbXNGYWN0b3J5KHdvcmtlcilcbiAgICAgICAgICB3b3JrZXIuZW1pdHRlci5vbiAncnVubmluZycsIHdvcmtlci5hdXRvZmluaXNoSm9iSW41MG1zXG5cbiAgICAgICAgY291bnRBbGxEb25lVGFza3MgICAgPSAoKSAtPiBfLnJlZHVjZSB3b3JrZXJzLCAoKHN1bSwgd29ya2VyKSAtPiBzdW0gKyB3b3JrZXIuZG9uZVRhc2tzLmxlbmd0aCksIDBcbiAgICAgICAgc3VtbWFyaXplQWxsUnVubmluZ1Rhc2tzID0gKCkgLT4gXy5tYXAgd29ya2VycywgKHdvcmtlcikgLT4gd29ya2VyLnJ1bm5pbmdUYXNrcy5sZW5ndGhcblxuICAgICAgICB3b3JrZXJzUnVubmluZ1Rhc2tzUHJvZmlsZSAgPSBbXVxuICAgICAgICBwcm9maWxlclRpbWVySm9iID0gc2V0SW50ZXJ2YWwgKCkgLT5cbiAgICAgICAgICB3b3JrZXJzUnVubmluZ1Rhc2tzUHJvZmlsZS5wdXNoIHN1bW1hcml6ZUFsbFJ1bm5pbmdUYXNrcygpXG4gICAgICAgICwgMTBcblxuICAgICAgICBhc3luYy5zZXJpZXMgW1xuICAgICAgICAgIChuZXh0KSAtPlxuICAgICAgICAgICAgYXN5bmMuZWFjaCBbMS4udGFza3NOdW1iZXJdLCAoaWQsIGlubmVyTmV4dCkgLT5cbiAgICAgICAgICAgICAgd29ya2Vyc1swXS5wdXNoSm9iIHsgaWQ6IFwiQiN7aWR9XCIgfSwgaW5uZXJOZXh0XG4gICAgICAgICAgICAsIG5leHRcbiAgICAgICAgICAobmV4dCkgLT5cbiAgICAgICAgICAgIGFzeW5jLmVhY2ggd29ya2VycywgKHdvcmtlciwgaW5uZXJOZXh0KSAtPlxuICAgICAgICAgICAgICB3b3JrZXIud2FpdEZvclRhc2tzIGlubmVyTmV4dFxuICAgICAgICAgICAgLCBuZXh0XG4gICAgICAgICAgKG5leHQpIC0+XG4gICAgICAgICAgICB3YWl0VW50aWwgKCkgLT5cbiAgICAgICAgICAgICAgY291bnRBbGxEb25lVGFza3MoKSA9PSB0YXNrc051bWJlclxuICAgICAgICAgICAgLCBuZXh0LFxuICAgICAgICBdLCAoZXJyKSAtPlxuICAgICAgICAgIGZvciB3b3JrZXIgaW4gd29ya2Vyc1xuICAgICAgICAgICAgd29ya2VyLmVtaXR0ZXIucmVtb3ZlTGlzdGVuZXIgJ3J1bm5pbmcnLCB3b3JrZXIuYXV0b2ZpbmlzaEpvYkluNTBtc1xuICAgICAgICAgIGNsZWFySW50ZXJ2YWwgcHJvZmlsZXJUaW1lckpvYlxuXG4gICAgICAgICAgcnVubmluZ1Rhc2tzTWVhblBlcldvcmtlciAgPSBbXVxuICAgICAgICAgIHJ1bm5pbmdUYXNrc1N0RGV2UGVyV29ya2VyID0gW11cbiAgICAgICAgICBmb3Igd29ya2VySWR4IGluIFswLi4ud29ya2Vycy5sZW5ndGhdXG4gICAgICAgICAgICB3b3JrZXJSdW5uaW5nVGFza3NQcm9maWxlID0gXy5tYXAgd29ya2Vyc1J1bm5pbmdUYXNrc1Byb2ZpbGUsIChydW5uaW5nVGFza3NQcm9maWxlKSAtPiBydW5uaW5nVGFza3NQcm9maWxlW3dvcmtlcklkeF1cbiAgICAgICAgICAgIHdvcmtlclJ1bm5pbmdUYXNrc1Byb2ZpbGVPbmx5TWlkUG9pbnRzID0gd29ya2VyUnVubmluZ1Rhc2tzUHJvZmlsZVsxMC4uLTIwXVxuXG4gICAgICAgICAgICBydW5uaW5nVGFza3NNZWFuUGVyV29ya2VyLnB1c2ggIE1hdGgubWVhbih3b3JrZXJSdW5uaW5nVGFza3NQcm9maWxlT25seU1pZFBvaW50cylcbiAgICAgICAgICAgIHJ1bm5pbmdUYXNrc1N0RGV2UGVyV29ya2VyLnB1c2ggTWF0aC5zdERldih3b3JrZXJSdW5uaW5nVGFza3NQcm9maWxlT25seU1pZFBvaW50cylcblxuICAgICAgICAgICMgMC45ICwgMC4yXG4gICAgICAgICAgZXhwZWN0KF8ubWluIHJ1bm5pbmdUYXNrc01lYW5QZXJXb3JrZXIpLnRvLmJlLmFib3ZlKGNvbmN1cnJlbmN5ICogMC42KVxuICAgICAgICAgIGV4cGVjdChfLm1heCBydW5uaW5nVGFza3NTdERldlBlcldvcmtlcikudG8uYmUuYmVsb3coY29uY3VycmVuY3kgKiAwLjMpXG4gICAgICAgICAgICBcbiAgICAgICAgICBkb25lIGVyclxuXG4gICAgaXQgJ3Nob3VsZCBub3QgdXNlIHJlZGlzIG1vcmUgdGhhbiBuZWNlc3NhcnknLCAoZG9uZSkgLT5cbiAgICAgIHRhc2tzTnVtYmVyUGVyV29ya2VyID0gMjAwXG4gICAgICBjb25jdXJyZW5jeSAgPSA1XG4gICAgICB3b3JrZXJzQ291bnQgPSAzXG5cbiAgICAgIHdvcmtlcnMgPSBbXVxuICAgICAgYXN5bmMubWFwIFsxLi53b3JrZXJzQ291bnRdLCAoaWR4LCBuZXh0KSAtPlxuICAgICAgICB3b3JrZXIgPSBjcmVhdGVXb3JrZXIgXCJ0ZXN0MV93b3JrZXIje2lkeH1cIiwgY29uY3VycmVuY3lcblxuICAgICAgICAjIFNldHVwIHJlZGlzIGNhbGwgc3B5LlxuICAgICAgICBzaW5vbi5zcHkgd29ya2VyLCAncG9wSm9iRnJvbVF1ZXVlJ1xuXG4gICAgICAgICMgUHJlcGFyZSB3b3JrZXIuXG4gICAgICAgIGNsZWFuV29ya2VyIHdvcmtlciwgKGVycikgLT5cbiAgICAgICAgICByZXR1cm4gbmV4dCBlcnIgaWYgZXJyXG5cbiAgICAgICAgICB3b3JrZXIud2FpdEZvclRhc2tzIChlcnIpIC0+XG4gICAgICAgICAgICBuZXh0IGVyciwgd29ya2VyXG4gICAgICAsIChlcnIsIHdvcmtlcnMpIC0+XG4gICAgICAgIGF1dG9maW5pc2hKb2JJbjUwbXNGYWN0b3J5ID0gKHdvcmtlcikgLT5cbiAgICAgICAgICAoaWQpIC0+XG4gICAgICAgICAgICBzZXRUaW1lb3V0ICgpIC0+XG4gICAgICAgICAgICAgIHdvcmtlci5maW5pc2hUYXNrKGlkKVxuICAgICAgICAgICAgLCAoNDAgKyBNYXRoLnJhbmRvbSgpICogNDApXG5cbiAgICAgICAgZm9yIHdvcmtlciBpbiB3b3JrZXJzXG4gICAgICAgICAgd29ya2VyLmF1dG9maW5pc2hKb2JJbjUwbXMgPSBhdXRvZmluaXNoSm9iSW41MG1zRmFjdG9yeSh3b3JrZXIpXG4gICAgICAgICAgd29ya2VyLmVtaXR0ZXIub24gJ3J1bm5pbmcnLCB3b3JrZXIuYXV0b2ZpbmlzaEpvYkluNTBtc1xuXG4gICAgICAgIGNvdW50QWxsRG9uZVRhc2tzID0gKCkgLT4gXy5yZWR1Y2Ugd29ya2VycywgKChzdW0sIHdvcmtlcikgLT4gc3VtICsgd29ya2VyLmRvbmVUYXNrcy5sZW5ndGgpLCAwXG5cbiAgICAgICAgYXN5bmMuc2VyaWVzIFtcbiAgICAgICAgICAobmV4dCkgLT5cbiAgICAgICAgICAgICMgQWRkICd0YXNrc051bWJlclBlcldvcmtlcicgdGFza3MgZm9yIGVhY2ggb2YgdGhlIChzZXBhcmF0ZSEpIHdvcmtlcnNcbiAgICAgICAgICAgIGFzeW5jLmVhY2ggd29ya2VycywgKHdvcmtlciwgaW5uZXJOZXh0KSAtPlxuICAgICAgICAgICAgICBhc3luYy5lYWNoIFsxLi50YXNrc051bWJlclBlcldvcmtlcl0sIChpZCwgaW5uZXJJbm5lck5leHQpIC0+XG4gICAgICAgICAgICAgICAgd29ya2VyLnB1c2hKb2IgeyBpZDogXCJBI3tpZH1cIiB9LCBpbm5lcklubmVyTmV4dFxuICAgICAgICAgICAgICAsIGlubmVyTmV4dFxuICAgICAgICAgICAgLCBuZXh0XG4gICAgICAgICAgKG5leHQpIC0+XG4gICAgICAgICAgICAjIFdhaXQgdGlsbCB0aGV5IGZpbmlzaC5cbiAgICAgICAgICAgIHdhaXRVbnRpbCAoKSAtPlxuICAgICAgICAgICAgICBjb3VudEFsbERvbmVUYXNrcygpID09IHRhc2tzTnVtYmVyUGVyV29ya2VyICogd29ya2Vyc0NvdW50XG4gICAgICAgICAgICAsIG5leHQsXG4gICAgICAgICAgKG5leHQpIC0+XG4gICAgICAgICAgICAjIEFkZCAndGFza3NOdW1iZXJQZXJXb3JrZXInIHRhc2tzIGZvciBvbmx5IG9uZSBvZiB0aGUgd29ya2Vyc1xuICAgICAgICAgICAgYXN5bmMuZWFjaCBbMS4udGFza3NOdW1iZXJQZXJXb3JrZXJdLCAoaWQsIGlubmVyTmV4dCkgLT5cbiAgICAgICAgICAgICAgd29ya2Vyc1swXS5wdXNoSm9iIHsgaWQ6IFwiQiN7aWR9XCIgfSwgaW5uZXJOZXh0XG4gICAgICAgICAgICAsIG5leHRcbiAgICAgICAgICAgICMgQWRkICd0YXNrc051bWJlclBlcldvcmtlcicgdGFza3MgZm9yIG9ubHkgb25lIG9mIHRoZSB3b3JrZXJzXG4gICAgICAgICAgICBhc3luYy5lYWNoIFsxLi50YXNrc051bWJlclBlcldvcmtlcl0sIChpZCwgaW5uZXJOZXh0KSAtPlxuICAgICAgICAgICAgICB3b3JrZXJzWzFdLnB1c2hKb2IgeyBpZDogXCJCI3tpZH1cIiB9LCBpbm5lck5leHRcbiAgICAgICAgICAgICwgbmV4dFxuICAgICAgICAgIChuZXh0KSAtPlxuICAgICAgICAgICAgIyBXYWl0IHRpbGwgaXQncyBmaW5pc2hlZC5cbiAgICAgICAgICAgIHdhaXRVbnRpbCAoKSAtPlxuICAgICAgICAgICAgICB3b3JrZXJzWzBdLmRvbmVUYXNrcy5sZW5ndGggPT0gMiAqIHRhc2tzTnVtYmVyUGVyV29ya2VyIGFuZCB3b3JrZXJzWzFdLmRvbmVUYXNrcy5sZW5ndGggPT0gMiAqIHRhc2tzTnVtYmVyUGVyV29ya2VyXG4gICAgICAgICAgICAsIG5leHQsXG4gICAgICAgICAgKG5leHQpIC0+XG4gICAgICAgICAgICAjIEFkZCAndGFza3NOdW1iZXJQZXJXb3JrZXInIHRhc2tzIGZvciBvbmx5IG9uZSBvZiB0aGUgd29ya2Vyc1xuICAgICAgICAgICAgYXN5bmMuZWFjaCBbMS4udGFza3NOdW1iZXJQZXJXb3JrZXJdLCAoaWQsIGlubmVyTmV4dCkgLT5cbiAgICAgICAgICAgICAgd29ya2Vyc1syXS5wdXNoSm9iIHsgaWQ6IFwiQyN7aWR9XCIgfSwgaW5uZXJOZXh0XG4gICAgICAgICAgICAsIG5leHRcbiAgICAgICAgICAobmV4dCkgLT5cbiAgICAgICAgICAgICMgV2FpdCB0aWxsIGl0J3MgZmluaXNoZWQuXG4gICAgICAgICAgICB3YWl0VW50aWwgKCkgLT5cbiAgICAgICAgICAgICAgd29ya2Vyc1syXS5kb25lVGFza3MubGVuZ3RoID09IDIgKiB0YXNrc051bWJlclBlcldvcmtlclxuICAgICAgICAgICAgLCBuZXh0LFxuICAgICAgICBdLCAoZXJyKSAtPlxuICAgICAgICAgICMgQ2xlYW51cFxuICAgICAgICAgIGZvciB3b3JrZXIgaW4gd29ya2Vyc1xuICAgICAgICAgICAgIyBDb3VudCBudW1iZXIgb2YgdGltZXMgcmVkaXMgd2FzIGNhbGxlZC5cbiAgICAgICAgICAgIGV4cGVjdCh3b3JrZXIucG9wSm9iRnJvbVF1ZXVlLmNhbGxDb3VudCkudG8uYmUuYmVsb3cod29ya2VyLmRvbmVUYXNrcy5sZW5ndGggKiAxLjIpXG5cbiAgICAgICAgICAgIHdvcmtlci5lbWl0dGVyLnJlbW92ZUxpc3RlbmVyICdydW5uaW5nJywgd29ya2VyLmF1dG9maW5pc2hKb2JJbjUwbXNcbiAgICAgICAgICAgIHdvcmtlci5wb3BKb2JGcm9tUXVldWUucmVzdG9yZSgpXG5cbiAgICAgICAgICBkb25lIGVyclxuIl19