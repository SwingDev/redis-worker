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

  function TestWorker(url, taskLimit1) {
    this.url = url;
    this.taskLimit = taskLimit1;
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
          expect(_.min(runningTasksMeanPerWorker)).to.be.above(concurrency * 0.9);
          expect(_.max(runningTasksStDevPerWorker)).to.be.below(concurrency * 0.2);
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

//# sourceMappingURL=data:application/json;base64,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QUQsR0FBQTtBQUVELGNBQUEsT0FBQTtBQUFBLGVBQUEsMkNBQUE7Z0NBQUE7QUFFRSxZQUFBLE1BQUEsQ0FBTyxNQUFNLENBQUMsZUFBZSxDQUFDLFNBQTlCLENBQXdDLENBQUMsRUFBRSxDQUFDLEVBQUUsQ0FBQyxLQUEvQyxDQUFxRCxNQUFNLENBQUMsU0FBUyxDQUFDLE1BQWpCLEdBQTBCLEdBQS9FLENBQUEsQ0FBQTtBQUFBLFlBRUEsTUFBTSxDQUFDLE9BQU8sQ0FBQyxjQUFmLENBQThCLFNBQTlCLEVBQXlDLE1BQU0sQ0FBQyxtQkFBaEQsQ0FGQSxDQUFBO0FBQUEsWUFHQSxNQUFNLENBQUMsZUFBZSxDQUFDLE9BQXZCLENBQUEsQ0FIQSxDQUZGO0FBQUEsV0FBQTtpQkFPQSxJQUFBLENBQUssR0FBTCxFQVRDO1FBQUEsQ0FyQ0gsRUFiQTtNQUFBLENBWkYsRUFONkM7SUFBQSxDQUEvQyxFQXJMNEI7RUFBQSxDQUE5QixFQXRLNkI7QUFBQSxDQUEvQixDQS9JQSxDQUFBIiwiZmlsZSI6InRlc3Qvd29ya2VyLmpzIiwic291cmNlUm9vdCI6Ii9zb3VyY2UvIiwic291cmNlc0NvbnRlbnQiOlsiXyAgICAgICAgID0gcmVxdWlyZSgnbG9kYXNoJylcblxuYXN5bmMgICAgID0gcmVxdWlyZSgnYXN5bmMnKVxucmVkaXMgICAgID0gcmVxdWlyZSgncmVkaXMnKVxuZmFrZXJlZGlzID0gcmVxdWlyZSgnZmFrZXJlZGlzJylcbmNoYWkgICAgICA9IHJlcXVpcmUoJ2NoYWknKVxuZXhwZWN0ICAgID0gcmVxdWlyZSgnY2hhaScpLmV4cGVjdFxuc2lub24gICAgID0gcmVxdWlyZSgnc2lub24nKVxuXG5SZWRpc1dvcmtlciA9IHJlcXVpcmUoJy4uL2xpYi9pbmRleC5qcycpXG5Xb3JrZXIgICAgICA9IFJlZGlzV29ya2VyLldvcmtlclxuXG5FdmVudEVtaXR0ZXIgPSByZXF1aXJlKCdldmVudHMnKS5FdmVudEVtaXR0ZXJcblxuY2xhc3MgVGVzdFdvcmtlciBleHRlbmRzIFdvcmtlclxuICBjb25zdHJ1Y3RvcjogKEB1cmwsIEB0YXNrTGltaXQpIC0+XG4gICAgc3VwZXJcblxuICAgIEBlbWl0dGVyICAgICAgICA9IG5ldyBFdmVudEVtaXR0ZXIoKVxuICAgIEByZXNldCgpXG5cbiAgbmFtZTogKCkgLT4gXCJUZXN0I3tAd29ya2VySUR9XCJcblxuICByZXNldDogKCkgLT5cbiAgICBAcGVuZGluZ1Rhc2tzICAgPSBbXVxuICAgIEBydW5uaW5nVGFza3MgICA9IFtdXG4gICAgQGRvbmVUYXNrcyAgICAgID0gW11cbiAgICBAZmFpbGVkVGFza3MgICAgPSBbXVxuICAgIEB0YXNrc0NhbGxiYWNrcyA9IHt9XG5cbiAgICBAbWF4UnVubmluZ0F0T25jZSA9IDBcblxuICBlcnJvclRhc2s6IChpZCkgLT5cbiAgICBleHBlY3QoQHJ1bm5pbmdUYXNrcykudG8uY29udGFpbiBpZFxuICAgIGV4cGVjdChAZG9uZVRhc2tzKS50by5ub3QuY29udGFpbiBpZFxuICAgIGV4cGVjdChAZmFpbGVkVGFza3MpLnRvLm5vdC5jb250YWluIGlkXG5cbiAgICBAZmFpbGVkVGFza3MucHVzaCBpZFxuICAgIEBydW5uaW5nVGFza3MgPSBfLnJlamVjdCBAcnVubmluZ1Rhc2tzLCAocnVubmluZ0l0ZW1JRCkgLT4gcnVubmluZ0l0ZW1JRCA9PSBpZFxuXG4gICAgQGVtaXR0ZXIuZW1pdCAnZmFpbGVkJywgaWRcblxuICAgIEB0YXNrc0NhbGxiYWNrc1tpZF0gbmV3IEVycm9yKFwiZXJyb3JcIilcblxuICBmaW5pc2hTb21lVGFzazogKCkgLT5cbiAgICBAZmluaXNoVGFzayBAcnVubmluZ1Rhc2tzWzBdXG5cbiAgZmluaXNoVGFzazogKGlkKSAtPlxuICAgIGV4cGVjdChAcnVubmluZ1Rhc2tzKS50by5jb250YWluIGlkXG4gICAgZXhwZWN0KEBkb25lVGFza3MpLnRvLm5vdC5jb250YWluIGlkXG4gICAgZXhwZWN0KEBmYWlsZWRUYXNrcykudG8ubm90LmNvbnRhaW4gaWRcblxuICAgIEBkb25lVGFza3MucHVzaCBpZFxuICAgIEBydW5uaW5nVGFza3MgPSBfLnJlamVjdCBAcnVubmluZ1Rhc2tzLCAocnVubmluZ0l0ZW1JRCkgLT4gcnVubmluZ0l0ZW1JRCA9PSBpZFxuXG4gICAgQGVtaXR0ZXIuZW1pdCAnZG9uZScsIGlkXG5cbiAgICBAdGFza3NDYWxsYmFja3NbaWRdKClcblxuICBwdXNoSm9iOiAocGF5bG9hZCwgY2IpIC0+XG4gICAgc3VwZXJcbiAgICBAcGVuZGluZ1Rhc2tzLnB1c2ggcGF5bG9hZC5pZFxuXG4gIHdvcms6IChwYXlsb2FkLCBkb25lKSAtPlxuICAgIHBheWxvYWQgPSBKU09OLnBhcnNlKHBheWxvYWQpXG5cbiAgICBpZCA9IHBheWxvYWQuaWRcblxuICAgIEB0YXNrc0NhbGxiYWNrc1tpZF0gPSBkb25lXG5cbiAgICBAcnVubmluZ1Rhc2tzLnB1c2ggaWRcbiAgICBAcGVuZGluZ1Rhc2tzID0gXy5yZWplY3QgQHBlbmRpbmdUYXNrcywgKHBlbmRpbmdJdGVtSUQpIC0+IHBlbmRpbmdJdGVtSUQgPT0gaWRcblxuICAgIEBlbWl0dGVyLmVtaXQgJ3J1bm5pbmcnLCBpZFxuXG4gICAgQG1heFJ1bm5pbmdBdE9uY2UgPSBNYXRoLm1heChAbWF4UnVubmluZ0F0T25jZSwgQHJ1bm5pbmdUYXNrcy5sZW5ndGgpXG5cbiAgZXJyb3I6IChlcnIsIHRhc2ssIGRvbmUpIC0+XG4gICAgI2NvbnNvbGUubG9nICdbRXJyb3JdJywgZXJyIGlmIGVyclxuICAgIGRvbmUoKVxuXG5cbmNyZWF0ZVdvcmtlciA9ICh3b3JrZXJJRCwgdGFza0xpbWl0KSAtPlxuICB3b3JrZXIgPSBuZXcgVGVzdFdvcmtlciBcInJlZGlzOi8vbG9jYWxob3N0OjYzNzkvMzJcIiwgdGFza0xpbWl0XG4gIHdvcmtlci53b3JrZXJJRCA9IHdvcmtlcklEXG5cbiAgd29ya2VyXG5cbmNsZWFuV29ya2VyID0gKHdvcmtlciwgY2FsbGJhY2spIC0+XG4gIHdvcmtlci5yZXNldCgpXG4gIHdvcmtlci5vYnRhaW5MaXN0Q2xpZW50IChlcnIsIGNsaWVudCkgLT5cbiAgICByZXR1cm4gY2FsbGJhY2sgZXJyIGlmIGVyclxuXG4gICAgYXN5bmMucGFyYWxsZWwgW1xuICAgICAgKG5leHQpIC0+IGNsaWVudC5kZWwgd29ya2VyLmxpc3RLZXkoKSwgbmV4dCxcbiAgICAgIChuZXh0KSAtPiBjbGllbnQuZGVsIHdvcmtlci5jaGFubmVsS2V5KCksIG5leHRcbiAgICBdLCBjYWxsYmFja1xuXG5cbmNvbmN1cnJlbmN5MVdvcmtlciA9IG51bGxcbmNvbmN1cnJlbmN5MldvcmtlciA9IG51bGxcblxuYmVmb3JlIChkb25lKSAtPlxuICBzaW5vbi5zdHViKHJlZGlzLCAnY3JlYXRlQ2xpZW50JywgZmFrZXJlZGlzLmNyZWF0ZUNsaWVudClcblxuICBjb25jdXJyZW5jeTFXb3JrZXIgPSBjcmVhdGVXb3JrZXIoXCJjb25jdXJyZW5jeTFXb3JrZXJcIiwgMSlcbiAgY29uY3VycmVuY3kyV29ya2VyID0gY3JlYXRlV29ya2VyKFwiY29uY3VycmVuY3kyV29ya2VyXCIsIDIpXG5cbiAgYXN5bmMuZWFjaCBbY29uY3VycmVuY3kxV29ya2VyLCBjb25jdXJyZW5jeTJXb3JrZXJdXG4gICwgKHdvcmtlciwgbmV4dCkgLT5cbiAgICBhc3luYy5zZXJpZXMgW1xuICAgICAgKGlubmVyTmV4dCkgLT4gd29ya2VyLndhaXRGb3JUYXNrcyBpbm5lck5leHRcbiAgICBdLCBuZXh0XG4gICwgZG9uZVxuXG5hZnRlciAoZG9uZSkgLT5cbiAgY29uY3VycmVuY3kyV29ya2VyID0gbnVsbFxuICBjb25jdXJyZW5jeTFXb3JrZXIgPSBudWxsXG5cbiAgcmVkaXMuY3JlYXRlQ2xpZW50LnJlc3RvcmUoKVxuXG4gIGRvbmUoKVxuXG5iZWZvcmVFYWNoIChkb25lKSAtPlxuICBhc3luYy5lYWNoIFtjb25jdXJyZW5jeTFXb3JrZXIsIGNvbmN1cnJlbmN5Mldvcmtlcl0sIGNsZWFuV29ya2VyLCBkb25lXG5cbiMgSGVscGVyc1xud2FpdFVudGlsID0gKHRlc3RGdW5jLCBjYWxsYmFjaykgLT5cbiAgaWYgdGVzdEZ1bmMoKVxuICAgIGNhbGxiYWNrKClcbiAgZWxzZVxuICAgIHNldFRpbWVvdXQgKCkgLT5cbiAgICAgIHdhaXRVbnRpbCh0ZXN0RnVuYywgY2FsbGJhY2spXG4gICAgLCAxMDBcblxuTWF0aC5tZWFuID0gKGFycmF5KSAtPiAoXy5yZWR1Y2UgYXJyYXksIChhLCBiKSAtPiBhK2IpIC8gYXJyYXkubGVuZ3RoXG5cbk1hdGguc3REZXYgPSAoYXJyYXkpIC0+XG4gIG1lYW4gPSBNYXRoLm1lYW4gYXJyYXlcbiAgZGV2ICA9IF8ubWFwIGFycmF5LCAoaXRtKSAtPiAoaXRtLW1lYW4pICogKGl0bS1tZWFuKVxuXG4gIHJldHVybiBNYXRoLnNxcnQgTWF0aC5tZWFuKGRldilcblxuZGVzY3JpYmUgJ3JlZGlzLXdvcmtlciB0ZXN0cycsICgpIC0+XG4gIGRlc2NyaWJlICdub3JtYWwgdGVzdHMnLCAoKSAtPiAgICBcbiAgICBpdCAnc2hvdWxkIGV4aXQgcHJvY2VzcyBvbiB1bmhhbmRsZWQgZXhjLiBsZXR0aW5nIGFsbCBydW5uaW5nIHRhc2tzIGZpbmlzaCcsIChkb25lKSAtPlxuICAgICAgY29uY3VycmVuY3kgPSA1XG4gICAgICBleGNUaHJvd2luZ1Rhc2tJZCA9IG51bGxcblxuICAgICAgcHJvY2Vzc0V4aXQgPSAoY29kZSkgLT5cbiAgICAgICAgdHJ5XG4gICAgICAgICAgZXhwZWN0KHdvcmtlci5ydW5uaW5nVGFza3MpLnRvLmVxbCBbZXhjVGhyb3dpbmdUYXNrSWRdXG4gICAgICAgICAgZXhwZWN0KHdvcmtlci5kb25lVGFza3MubGVuZ3RoKS50by5lcXVhbCAoY29uY3VycmVuY3kgLSAxKVxuICAgICAgICAgIGV4cGVjdCh3b3JrZXIuZmFpbGVkVGFza3MubGVuZ3RoKS50by5lcXVhbCAwXG5cbiAgICAgICAgICBkb25lKClcbiAgICAgICAgY2F0Y2ggZXJyXG4gICAgICAgICAgZG9uZSBlcnIgIFxuICAgICAgICBmaW5hbGx5XG4gICAgICAgICAgcHJvY2Vzcy5leGl0LnJlc3RvcmUoKVxuXG4gICAgICBzaW5vbi5zdHViKHByb2Nlc3MsICdleGl0JywgcHJvY2Vzc0V4aXQpXG5cbiAgICAgIHdvcmtlciA9IGNyZWF0ZVdvcmtlciBcImV4aXRfdGVzdF8xXCIsIGNvbmN1cnJlbmN5XG4gICAgICBhdXRvZmluaXNoSm9iID0gKGlkKSAtPlxuICAgICAgICBpZiB3b3JrZXIucnVubmluZ1Rhc2tzLmxlbmd0aCA+IChjb25jdXJyZW5jeSAtIDEpXG4gICAgICAgICAgZXhjVGhyb3dpbmdUYXNrSWQgPSBpZFxuICAgICAgICAgIHRocm93IG5ldyBFcnJvciBcIlVuaGFuZGxlZCBleGNlcHRpb24gbW9jay5cIlxuXG4gICAgICAgIHNldFRpbWVvdXQgKCkgLT5cbiAgICAgICAgICB3b3JrZXIuZmluaXNoVGFzayhpZClcbiAgICAgICAgLCAoMTAwMCArIE1hdGgucmFuZG9tKCkgKiA1MDApXG5cbiAgICAgIHdvcmtlci5lbWl0dGVyLm9uICdydW5uaW5nJywgYXV0b2ZpbmlzaEpvYlxuXG4gICAgICBhc3luYy5zZXJpZXMgW1xuICAgICAgICAobmV4dCkgLT4gY2xlYW5Xb3JrZXIgd29ya2VyLCBuZXh0LFxuICAgICAgICAobmV4dCkgLT4gd29ya2VyLndhaXRGb3JUYXNrcyBuZXh0LFxuICAgICAgICAobmV4dCkgLT4gXG4gICAgICAgICAgYXN5bmMuZWFjaCBbMS4uY29uY3VycmVuY3ldLCAoaWQsIGlubmVyTmV4dCkgLT5cbiAgICAgICAgICAgIHdvcmtlci5wdXNoSm9iIHsgaWQ6IGlkIH0sIGlubmVyTmV4dFxuICAgICAgICAgICwgbmV4dFxuICAgICAgXSwgKGVycikgLT5cbiAgICAgICAgcmV0dXJuIGRvbmUgZXJyIGlmIGVyclxuXG4gICAgaXQgJ3Nob3VsZCBleGl0IHByb2Nlc3Mgb24gdHdvIHVuaGFuZGxlZCBleGMuIGxldHRpbmcgYWxsIHJ1bm5pbmcgdGFza3MgZmluaXNoJywgKGRvbmUpIC0+XG4gICAgICBjb25jdXJyZW5jeSA9IDVcbiAgICAgIGV4Y1Rocm93aW5nVGFza0lkcyA9IFtdXG5cbiAgICAgIHByb2Nlc3NFeGl0ID0gKGNvZGUpIC0+XG4gICAgICAgIHRyeVxuICAgICAgICAgIGV4cGVjdCh3b3JrZXIucnVubmluZ1Rhc2tzKS50by5lcWwgZXhjVGhyb3dpbmdUYXNrSWRzXG4gICAgICAgICAgZXhwZWN0KHdvcmtlci5kb25lVGFza3MubGVuZ3RoKS50by5lcXVhbCAoY29uY3VycmVuY3kgLSAyKVxuICAgICAgICAgIGV4cGVjdCh3b3JrZXIuZmFpbGVkVGFza3MubGVuZ3RoKS50by5lcXVhbCAwXG5cbiAgICAgICAgICBkb25lKClcbiAgICAgICAgY2F0Y2ggZXJyXG4gICAgICAgICAgZG9uZSBlcnIgIFxuICAgICAgICBmaW5hbGx5XG4gICAgICAgICAgcHJvY2Vzcy5leGl0LnJlc3RvcmUoKVxuXG4gICAgICBzaW5vbi5zdHViKHByb2Nlc3MsICdleGl0JywgcHJvY2Vzc0V4aXQpXG5cbiAgICAgIHdvcmtlciA9IGNyZWF0ZVdvcmtlciBcImV4aXRfdGVzdF8xXCIsIGNvbmN1cnJlbmN5XG4gICAgICBhdXRvZmluaXNoSm9iID0gKGlkKSAtPlxuICAgICAgICBpZiB3b3JrZXIucnVubmluZ1Rhc2tzLmxlbmd0aCA+IChjb25jdXJyZW5jeSAtIDIpXG4gICAgICAgICAgZXhjVGhyb3dpbmdUYXNrSWRzLnB1c2ggaWRcbiAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IgXCJVbmhhbmRsZWQgZXhjZXB0aW9uIG1vY2suXCJcblxuICAgICAgICBzZXRUaW1lb3V0ICgpIC0+XG4gICAgICAgICAgd29ya2VyLmZpbmlzaFRhc2soaWQpXG4gICAgICAgICwgKDEwMDAgKyBNYXRoLnJhbmRvbSgpICogNTAwKVxuXG4gICAgICB3b3JrZXIuZW1pdHRlci5vbiAncnVubmluZycsIGF1dG9maW5pc2hKb2JcblxuICAgICAgYXN5bmMuc2VyaWVzIFtcbiAgICAgICAgKG5leHQpIC0+IGNsZWFuV29ya2VyIHdvcmtlciwgbmV4dCxcbiAgICAgICAgKG5leHQpIC0+IHdvcmtlci53YWl0Rm9yVGFza3MgbmV4dCxcbiAgICAgICAgKG5leHQpIC0+IFxuICAgICAgICAgIGFzeW5jLmVhY2ggWzEuLmNvbmN1cnJlbmN5XSwgKGlkLCBpbm5lck5leHQpIC0+XG4gICAgICAgICAgICB3b3JrZXIucHVzaEpvYiB7IGlkOiBpZCB9LCBpbm5lck5leHRcbiAgICAgICAgICAsIG5leHRcbiAgICAgIF0sIChlcnIpIC0+XG4gICAgICAgIHJldHVybiBkb25lIGVyciBpZiBlcnJcblxuICAgIGl0ICdzaG91bGQgZXhpdCBwcm9jZXNzIG9uIHVuaGFuZGxlZCBleGMuIGtpbGxpbmcgYWxsIHJ1bm5pbmcgdGFza3MgaWYgdGhleSBkb25cXCd0IG1hbmFnZSB0byBmaW5pc2ggb24gdGltZScsIChkb25lKSAtPlxuICAgICAgY29uY3VycmVuY3kgPSA1XG4gICAgICBleGNUaHJvd2luZ1Rhc2tJZCA9IG51bGxcblxuICAgICAgcHJvY2Vzc0V4aXQgPSAoY29kZSkgLT5cbiAgICAgICAgdHJ5XG4gICAgICAgICAgZXhwZWN0KHdvcmtlci5ydW5uaW5nVGFza3MpLnRvLmVxbCBbMS4uY29uY3VycmVuY3ldXG4gICAgICAgICAgZXhwZWN0KHdvcmtlci5kb25lVGFza3MubGVuZ3RoKS50by5lcXVhbCAwXG4gICAgICAgICAgZXhwZWN0KHdvcmtlci5mYWlsZWRUYXNrcy5sZW5ndGgpLnRvLmVxdWFsIDBcblxuICAgICAgICAgIGRvbmUoKVxuICAgICAgICBjYXRjaCBlcnJcbiAgICAgICAgICBkb25lIGVyciAgXG4gICAgICAgIGZpbmFsbHlcbiAgICAgICAgICBwcm9jZXNzLmV4aXQucmVzdG9yZSgpXG5cbiAgICAgIHNpbm9uLnN0dWIocHJvY2VzcywgJ2V4aXQnLCBwcm9jZXNzRXhpdClcblxuICAgICAgd29ya2VyID0gY3JlYXRlV29ya2VyIFwiZXhpdF90ZXN0XzFcIiwgY29uY3VycmVuY3lcbiAgICAgIHdvcmtlci5ncmFjZWZ1bFNodXRkb3duVGltZW91dCA9IDEwMDBcbiAgICAgIGF1dG9maW5pc2hKb2IgPSAoaWQpIC0+XG4gICAgICAgIGlmIHdvcmtlci5ydW5uaW5nVGFza3MubGVuZ3RoID4gKGNvbmN1cnJlbmN5IC0gMSlcbiAgICAgICAgICBleGNUaHJvd2luZ1Rhc2tJZCA9IGlkXG4gICAgICAgICAgdGhyb3cgbmV3IEVycm9yIFwiVW5oYW5kbGVkIGV4Y2VwdGlvbiBtb2NrLlwiXG5cbiAgICAgICAgc2V0VGltZW91dCAoKSAtPlxuICAgICAgICAgIHdvcmtlci5maW5pc2hUYXNrKGlkKVxuICAgICAgICAsICgxNTAwMDAgKyBNYXRoLnJhbmRvbSgpICogNTAwKVxuXG4gICAgICB3b3JrZXIuZW1pdHRlci5vbiAncnVubmluZycsIGF1dG9maW5pc2hKb2JcblxuICAgICAgYXN5bmMuc2VyaWVzIFtcbiAgICAgICAgKG5leHQpIC0+IGNsZWFuV29ya2VyIHdvcmtlciwgbmV4dCxcbiAgICAgICAgKG5leHQpIC0+IHdvcmtlci53YWl0Rm9yVGFza3MgbmV4dCxcbiAgICAgICAgKG5leHQpIC0+IFxuICAgICAgICAgIGFzeW5jLmVhY2ggWzEuLmNvbmN1cnJlbmN5XSwgKGlkLCBpbm5lck5leHQpIC0+XG4gICAgICAgICAgICB3b3JrZXIucHVzaEpvYiB7IGlkOiBpZCB9LCBpbm5lck5leHRcbiAgICAgICAgICAsIG5leHRcbiAgICAgIF0sIChlcnIpIC0+XG4gICAgICAgIHJldHVybiBkb25lIGVyciBpZiBlcnJcblxuICAgIGl0ICdzaG91bGQgcXVldWUgdXAgYSBqb2IgYW5kIGRvIGl0JywgKGRvbmUpIC0+XG4gICAgICBhc3luYy5zZXJpZXMgW1xuICAgICAgICAobmV4dCkgLT4gY29uY3VycmVuY3kxV29ya2VyLnB1c2hKb2IgeyBpZDogXCIxXCIgfSwgbmV4dCxcbiAgICAgICAgKG5leHQpIC0+XG4gICAgICAgICAgd2FpdFVudGlsICgpIC0+XG4gICAgICAgICAgICBcIjFcIiBpbiBjb25jdXJyZW5jeTFXb3JrZXIucnVubmluZ1Rhc2tzXG4gICAgICAgICAgLCBuZXh0LFxuICAgICAgICAobmV4dCkgLT5cbiAgICAgICAgICBjb25jdXJyZW5jeTFXb3JrZXIuZmluaXNoVGFzayBcIjFcIlxuICAgICAgICAgIHdhaXRVbnRpbCAoKSAtPlxuICAgICAgICAgICAgXCIxXCIgaW4gY29uY3VycmVuY3kxV29ya2VyLmRvbmVUYXNrc1xuICAgICAgICAgICwgbmV4dFxuICAgICAgXSwgKGVycikgLT5cbiAgICAgICAgZXhwZWN0KGNvbmN1cnJlbmN5MVdvcmtlci5kb25lVGFza3MpLnRvLmNvbnRhaW4gXCIxXCJcbiAgICAgICAgZG9uZSBlcnJcblxuICAgIGl0ICdzaG91bGQgcXVldWUgdXAgYSBqb2IgYW5kIGRvIGl0IGluIG9yZGVyJywgKGRvbmUpIC0+XG4gICAgICBhc3luYy5zZXJpZXMgW1xuICAgICAgICAobmV4dCkgLT4gY29uY3VycmVuY3kxV29ya2VyLnB1c2hKb2IgeyBpZDogXCIxXCIgfSwgbmV4dCxcbiAgICAgICAgKG5leHQpIC0+IGNvbmN1cnJlbmN5MVdvcmtlci5wdXNoSm9iIHsgaWQ6IFwiMlwiIH0sIG5leHQsXG4gICAgICAgIChuZXh0KSAtPlxuICAgICAgICAgIHdhaXRVbnRpbCAoKSAtPlxuICAgICAgICAgICAgXCIxXCIgaW4gY29uY3VycmVuY3kxV29ya2VyLnJ1bm5pbmdUYXNrc1xuICAgICAgICAgICwgbmV4dCxcbiAgICAgICAgKG5leHQpIC0+XG4gICAgICAgICAgY29uY3VycmVuY3kxV29ya2VyLmZpbmlzaFNvbWVUYXNrKClcbiAgICAgICAgICB3YWl0VW50aWwgKCkgLT5cbiAgICAgICAgICAgIFwiMlwiIGluIGNvbmN1cnJlbmN5MVdvcmtlci5ydW5uaW5nVGFza3NcbiAgICAgICAgICAsIG5leHQsXG4gICAgICAgIChuZXh0KSAtPlxuICAgICAgICAgIGNvbmN1cnJlbmN5MVdvcmtlci5maW5pc2hTb21lVGFzaygpXG4gICAgICAgICAgd2FpdFVudGlsICgpIC0+XG4gICAgICAgICAgICBcIjJcIiBpbiBjb25jdXJyZW5jeTFXb3JrZXIuZG9uZVRhc2tzXG4gICAgICAgICAgLCBuZXh0XG4gICAgICBdLCAoZXJyKSAtPlxuICAgICAgICBleHBlY3QoY29uY3VycmVuY3kxV29ya2VyLmRvbmVUYXNrcykudG8uY29udGFpbiBcIjFcIlxuICAgICAgICBleHBlY3QoY29uY3VycmVuY3kxV29ya2VyLmRvbmVUYXNrcykudG8uY29udGFpbiBcIjJcIlxuICAgICAgICBleHBlY3QoY29uY3VycmVuY3kxV29ya2VyLm1heFJ1bm5pbmdBdE9uY2UpLnRvLmVxdWFsIDFcblxuICAgICAgICBkb25lIGVyclxuXG4jIEBUT0RPOiBUZXN0IGlmIGVycm9yIGlzIGNhbGxlZCBvdXQgd2hlbiBAd29yayByZXR1cm5zIGFuIGVycm9yLlxuXG4gIGRlc2NyaWJlICdjb25jdXJyZW5jeSB0ZXN0cycsICgpIC0+XG4gICAgaXQgJ3Nob3VsZCBydW4gdXAgdG8gPHRhc2tMaW1pdD4gam9icyBhdCBvbmNlJywgKGRvbmUpIC0+XG4gICAgICB3b3JrZXIgICAgICA9IGNvbmN1cnJlbmN5MldvcmtlclxuICAgICAgdGFza3NOdW1iZXIgPSAyMFxuXG4gICAgICBhdXRvZmluaXNoSm9iSW41MG1zID0gKGlkKSAtPlxuICAgICAgICBzZXRUaW1lb3V0ICgpIC0+XG4gICAgICAgICAgd29ya2VyLmZpbmlzaFRhc2soaWQpXG4gICAgICAgICwgNTBcblxuICAgICAgd29ya2VyLmVtaXR0ZXIub24gJ3J1bm5pbmcnLCBhdXRvZmluaXNoSm9iSW41MG1zXG5cbiAgICAgIGFzeW5jLnNlcmllcyBbXG4gICAgICAgIChuZXh0KSAtPlxuICAgICAgICAgIGFzeW5jLmVhY2ggWzEuLnRhc2tzTnVtYmVyXSwgKGlkLCBpbm5lck5leHQpIC0+XG4gICAgICAgICAgICB3b3JrZXIucHVzaEpvYiB7IGlkOiBpZCB9LCBpbm5lck5leHRcbiAgICAgICAgICAsIG5leHRcbiAgICAgICAgKG5leHQpIC0+XG4gICAgICAgICAgd2FpdFVudGlsICgpIC0+XG4gICAgICAgICAgICB3b3JrZXIucGVuZGluZ1Rhc2tzLmxlbmd0aCA9PSAwXG4gICAgICAgICAgLCBuZXh0LFxuICAgICAgICAobmV4dCkgLT5cbiAgICAgICAgICB3YWl0VW50aWwgKCkgLT5cbiAgICAgICAgICAgIHdvcmtlci5kb25lVGFza3MubGVuZ3RoID09IHRhc2tzTnVtYmVyXG4gICAgICAgICAgLCBuZXh0LFxuICAgICAgXSwgKGVycikgLT5cbiAgICAgICAgZXhwZWN0KHdvcmtlci5tYXhSdW5uaW5nQXRPbmNlKS50by5lcXVhbCB3b3JrZXIudGFza0xpbWl0XG5cbiAgICAgICAgd29ya2VyLmVtaXR0ZXIucmVtb3ZlTGlzdGVuZXIgJ3J1bm5pbmcnLCBhdXRvZmluaXNoSm9iSW41MG1zXG4gICAgICAgIGRvbmUgZXJyXG5cbiAgICBpdCAnc2hvdWxkIG5vdCBzdGFydmUgb3RoZXIgcXVldWVzIGlmIHJ1bm5pbmcgc2lkZSBieSBzaWRlJywgKGRvbmUpIC0+XG4gICAgICB0YXNrc051bWJlciAgPSAyMDAwXG4gICAgICBjb25jdXJyZW5jeSAgPSAyMFxuICAgICAgd29ya2Vyc0NvdW50ID0gNVxuXG4gICAgICB3b3JrZXJzID0gW11cbiAgICAgIGFzeW5jLm1hcCBbMS4ud29ya2Vyc0NvdW50XSwgKGlkeCwgbmV4dCkgLT5cbiAgICAgICAgd29ya2VyID0gY3JlYXRlV29ya2VyIFwic2FtZV9pZFwiLCBjb25jdXJyZW5jeVxuICAgICAgICBjbGVhbldvcmtlciB3b3JrZXIsIChlcnIpIC0+XG4gICAgICAgICAgcmV0dXJuIG5leHQgZXJyIGlmIGVyclxuXG4gICAgICAgICAgd29ya2VyLndhaXRGb3JUYXNrcyAoZXJyKSAtPlxuICAgICAgICAgICAgbmV4dCBlcnIsIHdvcmtlclxuICAgICAgLCAoZXJyLCB3b3JrZXJzKSAtPlxuICAgICAgICBhdXRvZmluaXNoSm9iSW41MG1zRmFjdG9yeSA9ICh3b3JrZXIpIC0+XG4gICAgICAgICAgKGlkKSAtPlxuICAgICAgICAgICAgc2V0VGltZW91dCAoKSAtPlxuICAgICAgICAgICAgICB3b3JrZXIuZmluaXNoVGFzayhpZClcbiAgICAgICAgICAgICwgKDgwICsgTWF0aC5yYW5kb20oKSAqIDQwKVxuXG4gICAgICAgIGZvciB3b3JrZXIgaW4gd29ya2Vyc1xuICAgICAgICAgIHdvcmtlci5hdXRvZmluaXNoSm9iSW41MG1zID0gYXV0b2ZpbmlzaEpvYkluNTBtc0ZhY3Rvcnkod29ya2VyKVxuICAgICAgICAgIHdvcmtlci5lbWl0dGVyLm9uICdydW5uaW5nJywgd29ya2VyLmF1dG9maW5pc2hKb2JJbjUwbXNcblxuICAgICAgICBjb3VudEFsbERvbmVUYXNrcyA9ICgpIC0+IF8ucmVkdWNlIHdvcmtlcnMsICgoc3VtLCB3b3JrZXIpIC0+IHN1bSArIHdvcmtlci5kb25lVGFza3MubGVuZ3RoKSwgMFxuXG4gICAgICAgIGFzeW5jLnNlcmllcyBbXG4gICAgICAgICAgKG5leHQpIC0+XG4gICAgICAgICAgICBhc3luYy5lYWNoIFsxLi50YXNrc051bWJlcl0sIChpZCwgaW5uZXJOZXh0KSAtPlxuICAgICAgICAgICAgICB3b3JrZXJzWzBdLnB1c2hKb2IgeyBpZDogXCJBI3tpZH1cIiB9LCBpbm5lck5leHRcbiAgICAgICAgICAgICwgbmV4dFxuICAgICAgICAgIChuZXh0KSAtPlxuICAgICAgICAgICAgd2FpdFVudGlsICgpIC0+XG4gICAgICAgICAgICAgIGNvdW50QWxsRG9uZVRhc2tzKCkgPT0gdGFza3NOdW1iZXJcbiAgICAgICAgICAgICwgbmV4dCxcbiAgICAgICAgXSwgKGVycikgLT5cbiAgICAgICAgICBmb3Igd29ya2VyIGluIHdvcmtlcnNcbiAgICAgICAgICAgIHdvcmtlci5lbWl0dGVyLnJlbW92ZUxpc3RlbmVyICdydW5uaW5nJywgd29ya2VyLmF1dG9maW5pc2hKb2JJbjUwbXNcblxuICAgICAgICAgIGRvbmVUYXNrcyA9IF8ubWFwIHdvcmtlcnMsICh3b3JrZXIpIC0+IHdvcmtlci5kb25lVGFza3MubGVuZ3RoXG4gICAgICAgICAgZXhwZWN0KE1hdGguc3REZXYgZG9uZVRhc2tzKS50by5iZS5iZWxvdyh0YXNrc051bWJlciAvIDEwMC4wKVxuXG4gICAgICAgICAgZG9uZSBlcnJcblxuICAgIGl0ICdzaG91bGQgbm90IHN0YXJ2ZSBvdGhlciBxdWV1ZXMgaWYgc3RhcnRpbmcgd2l0aCBwdXNoZWQgdGFza3MnLCAoZG9uZSkgLT5cbiAgICAgIHRhc2tzTnVtYmVyICA9IDQwMFxuICAgICAgY29uY3VycmVuY3kgID0gMjBcbiAgICAgIHdvcmtlcnNDb3VudCA9IDVcblxuICAgICAgd29ya2VycyA9IFtdXG4gICAgICBhc3luYy5tYXAgWzEuLndvcmtlcnNDb3VudF0sIChpZHgsIG5leHQpIC0+XG4gICAgICAgIHdvcmtlciA9IGNyZWF0ZVdvcmtlciBcInNhbWVfaWQyXCIsIGNvbmN1cnJlbmN5XG4gICAgICAgIGNsZWFuV29ya2VyIHdvcmtlciwgKGVycikgLT5cbiAgICAgICAgICBuZXh0IGVyciwgd29ya2VyXG4gICAgICAsIChlcnIsIHdvcmtlcnMpIC0+XG4gICAgICAgIGF1dG9maW5pc2hKb2JJbjUwbXNGYWN0b3J5ID0gKHdvcmtlcikgLT5cbiAgICAgICAgICAoaWQpIC0+XG4gICAgICAgICAgICBzZXRUaW1lb3V0ICgpIC0+XG4gICAgICAgICAgICAgIHdvcmtlci5maW5pc2hUYXNrKGlkKVxuICAgICAgICAgICAgLCAoODAgKyBNYXRoLnJhbmRvbSgpICogNDApXG5cbiAgICAgICAgZm9yIHdvcmtlciBpbiB3b3JrZXJzXG4gICAgICAgICAgd29ya2VyLmF1dG9maW5pc2hKb2JJbjUwbXMgPSBhdXRvZmluaXNoSm9iSW41MG1zRmFjdG9yeSh3b3JrZXIpXG4gICAgICAgICAgd29ya2VyLmVtaXR0ZXIub24gJ3J1bm5pbmcnLCB3b3JrZXIuYXV0b2ZpbmlzaEpvYkluNTBtc1xuXG4gICAgICAgIGNvdW50QWxsRG9uZVRhc2tzID0gKCkgLT4gXy5yZWR1Y2Ugd29ya2VycywgKChzdW0sIHdvcmtlcikgLT4gc3VtICsgd29ya2VyLmRvbmVUYXNrcy5sZW5ndGgpLCAwXG5cbiAgICAgICAgYXN5bmMuc2VyaWVzIFtcbiAgICAgICAgICAobmV4dCkgLT5cbiAgICAgICAgICAgIGFzeW5jLmVhY2ggWzEuLnRhc2tzTnVtYmVyXSwgKGlkLCBpbm5lck5leHQpIC0+XG4gICAgICAgICAgICAgIHdvcmtlcnNbMF0ucHVzaEpvYiB7IGlkOiBcIkIje2lkfVwiIH0sIGlubmVyTmV4dFxuICAgICAgICAgICAgLCBuZXh0XG4gICAgICAgICAgKG5leHQpIC0+XG4gICAgICAgICAgICBhc3luYy5lYWNoU2VyaWVzIHdvcmtlcnMsICh3b3JrZXIsIGlubmVyTmV4dCkgLT5cbiAgICAgICAgICAgICAgd29ya2VyLndhaXRGb3JUYXNrcyBpbm5lck5leHRcbiAgICAgICAgICAgICwgbmV4dFxuICAgICAgICAgIChuZXh0KSAtPlxuICAgICAgICAgICAgd2FpdFVudGlsICgpIC0+XG4gICAgICAgICAgICAgIGNvdW50QWxsRG9uZVRhc2tzKCkgPT0gdGFza3NOdW1iZXJcbiAgICAgICAgICAgICwgbmV4dCxcbiAgICAgICAgXSwgKGVycikgLT5cbiAgICAgICAgICBmb3Igd29ya2VyIGluIHdvcmtlcnNcbiAgICAgICAgICAgIHdvcmtlci5lbWl0dGVyLnJlbW92ZUxpc3RlbmVyICdydW5uaW5nJywgd29ya2VyLmF1dG9maW5pc2hKb2JJbjUwbXNcblxuICAgICAgICAgIGRvbmVUYXNrcyA9IF8ubWFwIHdvcmtlcnMsICh3b3JrZXIpIC0+IHdvcmtlci5kb25lVGFza3MubGVuZ3RoXG4gICAgICAgICAgZXhwZWN0KE1hdGguc3REZXYgZG9uZVRhc2tzKS50by5iZS5iZWxvdyh0YXNrc051bWJlciAvIDEwMC4wKVxuXG4gICAgICAgICAgZG9uZSBlcnJcblxuICAgIGl0ICdzaG91bGQgdXNlIGFsbCBjb25jdXJyZW5jeSBzbG90cyBhdCBhbGwgdGltZXMnLCAoZG9uZSkgLT5cbiAgICAgIHRhc2tzTnVtYmVyICA9IDIwMDBcbiAgICAgIGNvbmN1cnJlbmN5ICA9IDEwXG4gICAgICB3b3JrZXJzQ291bnQgPSA1XG5cbiAgICAgIHdvcmtlcnMgPSBbXVxuICAgICAgYXN5bmMubWFwIFsxLi53b3JrZXJzQ291bnRdLCAoaWR4LCBuZXh0KSAtPlxuICAgICAgICB3b3JrZXIgPSBjcmVhdGVXb3JrZXIgXCJzYW1lX2lkM1wiLCBjb25jdXJyZW5jeVxuICAgICAgICBjbGVhbldvcmtlciB3b3JrZXIsIChlcnIpIC0+XG4gICAgICAgICAgbmV4dCBlcnIsIHdvcmtlclxuICAgICAgLCAoZXJyLCB3b3JrZXJzKSAtPlxuICAgICAgICBhdXRvZmluaXNoSm9iSW41MG1zRmFjdG9yeSA9ICh3b3JrZXIpIC0+XG4gICAgICAgICAgKGlkKSAtPlxuICAgICAgICAgICAgc2V0VGltZW91dCAoKSAtPlxuICAgICAgICAgICAgICB3b3JrZXIuZmluaXNoVGFzayhpZClcbiAgICAgICAgICAgICwgKDQwICsgTWF0aC5yYW5kb20oKSAqIDQwKVxuXG4gICAgICAgIGZvciB3b3JrZXIgaW4gd29ya2Vyc1xuICAgICAgICAgIHdvcmtlci5hdXRvZmluaXNoSm9iSW41MG1zID0gYXV0b2ZpbmlzaEpvYkluNTBtc0ZhY3Rvcnkod29ya2VyKVxuICAgICAgICAgIHdvcmtlci5lbWl0dGVyLm9uICdydW5uaW5nJywgd29ya2VyLmF1dG9maW5pc2hKb2JJbjUwbXNcblxuICAgICAgICBjb3VudEFsbERvbmVUYXNrcyAgICA9ICgpIC0+IF8ucmVkdWNlIHdvcmtlcnMsICgoc3VtLCB3b3JrZXIpIC0+IHN1bSArIHdvcmtlci5kb25lVGFza3MubGVuZ3RoKSwgMFxuICAgICAgICBzdW1tYXJpemVBbGxSdW5uaW5nVGFza3MgPSAoKSAtPiBfLm1hcCB3b3JrZXJzLCAod29ya2VyKSAtPiB3b3JrZXIucnVubmluZ1Rhc2tzLmxlbmd0aFxuXG4gICAgICAgIHdvcmtlcnNSdW5uaW5nVGFza3NQcm9maWxlICA9IFtdXG4gICAgICAgIHByb2ZpbGVyVGltZXJKb2IgPSBzZXRJbnRlcnZhbCAoKSAtPlxuICAgICAgICAgIHdvcmtlcnNSdW5uaW5nVGFza3NQcm9maWxlLnB1c2ggc3VtbWFyaXplQWxsUnVubmluZ1Rhc2tzKClcbiAgICAgICAgLCAxMFxuXG4gICAgICAgIGFzeW5jLnNlcmllcyBbXG4gICAgICAgICAgKG5leHQpIC0+XG4gICAgICAgICAgICBhc3luYy5lYWNoIFsxLi50YXNrc051bWJlcl0sIChpZCwgaW5uZXJOZXh0KSAtPlxuICAgICAgICAgICAgICB3b3JrZXJzWzBdLnB1c2hKb2IgeyBpZDogXCJCI3tpZH1cIiB9LCBpbm5lck5leHRcbiAgICAgICAgICAgICwgbmV4dFxuICAgICAgICAgIChuZXh0KSAtPlxuICAgICAgICAgICAgYXN5bmMuZWFjaCB3b3JrZXJzLCAod29ya2VyLCBpbm5lck5leHQpIC0+XG4gICAgICAgICAgICAgIHdvcmtlci53YWl0Rm9yVGFza3MgaW5uZXJOZXh0XG4gICAgICAgICAgICAsIG5leHRcbiAgICAgICAgICAobmV4dCkgLT5cbiAgICAgICAgICAgIHdhaXRVbnRpbCAoKSAtPlxuICAgICAgICAgICAgICBjb3VudEFsbERvbmVUYXNrcygpID09IHRhc2tzTnVtYmVyXG4gICAgICAgICAgICAsIG5leHQsXG4gICAgICAgIF0sIChlcnIpIC0+XG4gICAgICAgICAgZm9yIHdvcmtlciBpbiB3b3JrZXJzXG4gICAgICAgICAgICB3b3JrZXIuZW1pdHRlci5yZW1vdmVMaXN0ZW5lciAncnVubmluZycsIHdvcmtlci5hdXRvZmluaXNoSm9iSW41MG1zXG4gICAgICAgICAgY2xlYXJJbnRlcnZhbCBwcm9maWxlclRpbWVySm9iXG5cbiAgICAgICAgICBydW5uaW5nVGFza3NNZWFuUGVyV29ya2VyICA9IFtdXG4gICAgICAgICAgcnVubmluZ1Rhc2tzU3REZXZQZXJXb3JrZXIgPSBbXVxuICAgICAgICAgIGZvciB3b3JrZXJJZHggaW4gWzAuLi53b3JrZXJzLmxlbmd0aF1cbiAgICAgICAgICAgIHdvcmtlclJ1bm5pbmdUYXNrc1Byb2ZpbGUgPSBfLm1hcCB3b3JrZXJzUnVubmluZ1Rhc2tzUHJvZmlsZSwgKHJ1bm5pbmdUYXNrc1Byb2ZpbGUpIC0+IHJ1bm5pbmdUYXNrc1Byb2ZpbGVbd29ya2VySWR4XVxuICAgICAgICAgICAgd29ya2VyUnVubmluZ1Rhc2tzUHJvZmlsZU9ubHlNaWRQb2ludHMgPSB3b3JrZXJSdW5uaW5nVGFza3NQcm9maWxlWzEwLi4tMjBdXG5cbiAgICAgICAgICAgIHJ1bm5pbmdUYXNrc01lYW5QZXJXb3JrZXIucHVzaCAgTWF0aC5tZWFuKHdvcmtlclJ1bm5pbmdUYXNrc1Byb2ZpbGVPbmx5TWlkUG9pbnRzKVxuICAgICAgICAgICAgcnVubmluZ1Rhc2tzU3REZXZQZXJXb3JrZXIucHVzaCBNYXRoLnN0RGV2KHdvcmtlclJ1bm5pbmdUYXNrc1Byb2ZpbGVPbmx5TWlkUG9pbnRzKVxuXG4gICAgICAgICAgZXhwZWN0KF8ubWluIHJ1bm5pbmdUYXNrc01lYW5QZXJXb3JrZXIpLnRvLmJlLmFib3ZlKGNvbmN1cnJlbmN5ICogMC45KVxuICAgICAgICAgIGV4cGVjdChfLm1heCBydW5uaW5nVGFza3NTdERldlBlcldvcmtlcikudG8uYmUuYmVsb3coY29uY3VycmVuY3kgKiAwLjIpXG4gICAgICAgICAgICBcbiAgICAgICAgICBkb25lIGVyclxuXG4gICAgaXQgJ3Nob3VsZCBub3QgdXNlIHJlZGlzIG1vcmUgdGhhbiBuZWNlc3NhcnknLCAoZG9uZSkgLT5cbiAgICAgIHRhc2tzTnVtYmVyUGVyV29ya2VyID0gMjAwXG4gICAgICBjb25jdXJyZW5jeSAgPSA1XG4gICAgICB3b3JrZXJzQ291bnQgPSAzXG5cbiAgICAgIHdvcmtlcnMgPSBbXVxuICAgICAgYXN5bmMubWFwIFsxLi53b3JrZXJzQ291bnRdLCAoaWR4LCBuZXh0KSAtPlxuICAgICAgICB3b3JrZXIgPSBjcmVhdGVXb3JrZXIgXCJ0ZXN0MV93b3JrZXIje2lkeH1cIiwgY29uY3VycmVuY3lcblxuICAgICAgICAjIFNldHVwIHJlZGlzIGNhbGwgc3B5LlxuICAgICAgICBzaW5vbi5zcHkgd29ya2VyLCAncG9wSm9iRnJvbVF1ZXVlJ1xuXG4gICAgICAgICMgUHJlcGFyZSB3b3JrZXIuXG4gICAgICAgIGNsZWFuV29ya2VyIHdvcmtlciwgKGVycikgLT5cbiAgICAgICAgICByZXR1cm4gbmV4dCBlcnIgaWYgZXJyXG5cbiAgICAgICAgICB3b3JrZXIud2FpdEZvclRhc2tzIChlcnIpIC0+XG4gICAgICAgICAgICBuZXh0IGVyciwgd29ya2VyXG4gICAgICAsIChlcnIsIHdvcmtlcnMpIC0+XG4gICAgICAgIGF1dG9maW5pc2hKb2JJbjUwbXNGYWN0b3J5ID0gKHdvcmtlcikgLT5cbiAgICAgICAgICAoaWQpIC0+XG4gICAgICAgICAgICBzZXRUaW1lb3V0ICgpIC0+XG4gICAgICAgICAgICAgIHdvcmtlci5maW5pc2hUYXNrKGlkKVxuICAgICAgICAgICAgLCAoNDAgKyBNYXRoLnJhbmRvbSgpICogNDApXG5cbiAgICAgICAgZm9yIHdvcmtlciBpbiB3b3JrZXJzXG4gICAgICAgICAgd29ya2VyLmF1dG9maW5pc2hKb2JJbjUwbXMgPSBhdXRvZmluaXNoSm9iSW41MG1zRmFjdG9yeSh3b3JrZXIpXG4gICAgICAgICAgd29ya2VyLmVtaXR0ZXIub24gJ3J1bm5pbmcnLCB3b3JrZXIuYXV0b2ZpbmlzaEpvYkluNTBtc1xuXG4gICAgICAgIGNvdW50QWxsRG9uZVRhc2tzID0gKCkgLT4gXy5yZWR1Y2Ugd29ya2VycywgKChzdW0sIHdvcmtlcikgLT4gc3VtICsgd29ya2VyLmRvbmVUYXNrcy5sZW5ndGgpLCAwXG5cbiAgICAgICAgYXN5bmMuc2VyaWVzIFtcbiAgICAgICAgICAobmV4dCkgLT5cbiAgICAgICAgICAgICMgQWRkICd0YXNrc051bWJlclBlcldvcmtlcicgdGFza3MgZm9yIGVhY2ggb2YgdGhlIChzZXBhcmF0ZSEpIHdvcmtlcnNcbiAgICAgICAgICAgIGFzeW5jLmVhY2ggd29ya2VycywgKHdvcmtlciwgaW5uZXJOZXh0KSAtPlxuICAgICAgICAgICAgICBhc3luYy5lYWNoIFsxLi50YXNrc051bWJlclBlcldvcmtlcl0sIChpZCwgaW5uZXJJbm5lck5leHQpIC0+XG4gICAgICAgICAgICAgICAgd29ya2VyLnB1c2hKb2IgeyBpZDogXCJBI3tpZH1cIiB9LCBpbm5lcklubmVyTmV4dFxuICAgICAgICAgICAgICAsIGlubmVyTmV4dFxuICAgICAgICAgICAgLCBuZXh0XG4gICAgICAgICAgKG5leHQpIC0+XG4gICAgICAgICAgICAjIFdhaXQgdGlsbCB0aGV5IGZpbmlzaC5cbiAgICAgICAgICAgIHdhaXRVbnRpbCAoKSAtPlxuICAgICAgICAgICAgICBjb3VudEFsbERvbmVUYXNrcygpID09IHRhc2tzTnVtYmVyUGVyV29ya2VyICogd29ya2Vyc0NvdW50XG4gICAgICAgICAgICAsIG5leHQsXG4gICAgICAgICAgKG5leHQpIC0+XG4gICAgICAgICAgICAjIEFkZCAndGFza3NOdW1iZXJQZXJXb3JrZXInIHRhc2tzIGZvciBvbmx5IG9uZSBvZiB0aGUgd29ya2Vyc1xuICAgICAgICAgICAgYXN5bmMuZWFjaCBbMS4udGFza3NOdW1iZXJQZXJXb3JrZXJdLCAoaWQsIGlubmVyTmV4dCkgLT5cbiAgICAgICAgICAgICAgd29ya2Vyc1swXS5wdXNoSm9iIHsgaWQ6IFwiQiN7aWR9XCIgfSwgaW5uZXJOZXh0XG4gICAgICAgICAgICAsIG5leHRcbiAgICAgICAgICAgICMgQWRkICd0YXNrc051bWJlclBlcldvcmtlcicgdGFza3MgZm9yIG9ubHkgb25lIG9mIHRoZSB3b3JrZXJzXG4gICAgICAgICAgICBhc3luYy5lYWNoIFsxLi50YXNrc051bWJlclBlcldvcmtlcl0sIChpZCwgaW5uZXJOZXh0KSAtPlxuICAgICAgICAgICAgICB3b3JrZXJzWzFdLnB1c2hKb2IgeyBpZDogXCJCI3tpZH1cIiB9LCBpbm5lck5leHRcbiAgICAgICAgICAgICwgbmV4dFxuICAgICAgICAgIChuZXh0KSAtPlxuICAgICAgICAgICAgIyBXYWl0IHRpbGwgaXQncyBmaW5pc2hlZC5cbiAgICAgICAgICAgIHdhaXRVbnRpbCAoKSAtPlxuICAgICAgICAgICAgICB3b3JrZXJzWzBdLmRvbmVUYXNrcy5sZW5ndGggPT0gMiAqIHRhc2tzTnVtYmVyUGVyV29ya2VyIGFuZCB3b3JrZXJzWzFdLmRvbmVUYXNrcy5sZW5ndGggPT0gMiAqIHRhc2tzTnVtYmVyUGVyV29ya2VyXG4gICAgICAgICAgICAsIG5leHQsXG4gICAgICAgICAgKG5leHQpIC0+XG4gICAgICAgICAgICAjIEFkZCAndGFza3NOdW1iZXJQZXJXb3JrZXInIHRhc2tzIGZvciBvbmx5IG9uZSBvZiB0aGUgd29ya2Vyc1xuICAgICAgICAgICAgYXN5bmMuZWFjaCBbMS4udGFza3NOdW1iZXJQZXJXb3JrZXJdLCAoaWQsIGlubmVyTmV4dCkgLT5cbiAgICAgICAgICAgICAgd29ya2Vyc1syXS5wdXNoSm9iIHsgaWQ6IFwiQyN7aWR9XCIgfSwgaW5uZXJOZXh0XG4gICAgICAgICAgICAsIG5leHRcbiAgICAgICAgICAobmV4dCkgLT5cbiAgICAgICAgICAgICMgV2FpdCB0aWxsIGl0J3MgZmluaXNoZWQuXG4gICAgICAgICAgICB3YWl0VW50aWwgKCkgLT5cbiAgICAgICAgICAgICAgd29ya2Vyc1syXS5kb25lVGFza3MubGVuZ3RoID09IDIgKiB0YXNrc051bWJlclBlcldvcmtlclxuICAgICAgICAgICAgLCBuZXh0LFxuICAgICAgICBdLCAoZXJyKSAtPlxuICAgICAgICAgICMgQ2xlYW51cFxuICAgICAgICAgIGZvciB3b3JrZXIgaW4gd29ya2Vyc1xuICAgICAgICAgICAgIyBDb3VudCBudW1iZXIgb2YgdGltZXMgcmVkaXMgd2FzIGNhbGxlZC5cbiAgICAgICAgICAgIGV4cGVjdCh3b3JrZXIucG9wSm9iRnJvbVF1ZXVlLmNhbGxDb3VudCkudG8uYmUuYmVsb3cod29ya2VyLmRvbmVUYXNrcy5sZW5ndGggKiAxLjIpXG5cbiAgICAgICAgICAgIHdvcmtlci5lbWl0dGVyLnJlbW92ZUxpc3RlbmVyICdydW5uaW5nJywgd29ya2VyLmF1dG9maW5pc2hKb2JJbjUwbXNcbiAgICAgICAgICAgIHdvcmtlci5wb3BKb2JGcm9tUXVldWUucmVzdG9yZSgpXG5cbiAgICAgICAgICBkb25lIGVyclxuIl19