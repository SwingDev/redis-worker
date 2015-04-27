_         = require('lodash')
async     = require('async')
redis     = require('redis')
fakeredis = require('fakeredis')
chai      = require('chai')
expect    = require('chai').expect
sinon     = require('sinon')

RedisWorker = require('../lib/index.js')
Worker      = RedisWorker.Worker

EventEmitter = require('events').EventEmitter

class TestWorker extends Worker
  constructor: (options) ->
    {@url, @taskLimit, @retryTasks} = options
    super url: @url, taskLimit: @taskLimit, retryTasks: @retryTasks

    @emitter        = new EventEmitter()
    @reset()

  name: () -> "Test#{@workerID}"

  reset: () ->
    @pendingTasks   = []
    @runningTasks   = []
    @doneTasks      = []
    @failedTasks    = []
    @tasksCallbacks = {}

    @maxRunningAtOnce = 0

  errorTask: (id) ->
    expect(@runningTasks).to.contain id
    expect(@doneTasks).to.not.contain id
    expect(@failedTasks).to.not.contain id

    @failedTasks.push id
    @runningTasks = _.reject @runningTasks, (runningItemID) -> runningItemID == id

    @emitter.emit 'failed', id

    @tasksCallbacks[id] new Error("error")

  finishSomeTask: () ->
    @finishTask @runningTasks[0]

  finishTask: (id) ->
    expect(@runningTasks).to.contain id
    expect(@doneTasks).to.not.contain id
    expect(@failedTasks).to.not.contain id

    @doneTasks.push id
    @runningTasks = _.reject @runningTasks, (runningItemID) -> runningItemID == id

    @emitter.emit 'done', id

    @tasksCallbacks[id]()

  pushJob: (payload, cb) ->
    super
    @pendingTasks.push payload.id

  work: (payload, done) ->
    payload = JSON.parse(payload)

    id = payload.id

    @tasksCallbacks[id] = done

    @runningTasks.push id
    @pendingTasks = _.reject @pendingTasks, (pendingItemID) -> pendingItemID == id

    @emitter.emit 'running', id

    @maxRunningAtOnce = Math.max(@maxRunningAtOnce, @runningTasks.length)

  error: (err, task, done) ->
    #console.log '[Error]', err if err
    done()


createWorker = (workerID, taskLimit) ->
  worker = new TestWorker url: "redis://localhost:6379/32", taskLimit: taskLimit
  worker.workerID = workerID

  worker

cleanWorker = (worker, callback) ->
  worker.reset()
  worker.obtainListClient (err, client) ->
    return callback err if err

    async.parallel [
      (next) -> client.del worker.listKey(), next,
      (next) -> client.del worker.channelKey(), next
    ], callback


concurrency1Worker = null
concurrency2Worker = null

before (done) ->
  sinon.stub(redis, 'createClient', fakeredis.createClient)

  concurrency1Worker = createWorker("concurrency1Worker", 1)
  concurrency2Worker = createWorker("concurrency2Worker", 2)

  async.each [concurrency1Worker, concurrency2Worker]
  , (worker, next) ->
    async.series [
      (innerNext) -> worker.waitForTasks innerNext
    ], next
  , done

after (done) ->
  concurrency2Worker = null
  concurrency1Worker = null

  redis.createClient.restore()

  done()

beforeEach (done) ->
  async.each [concurrency1Worker, concurrency2Worker], cleanWorker, done

# Helpers
waitUntil = (testFunc, callback) ->
  if testFunc()
    callback()
  else
    setTimeout () ->
      waitUntil(testFunc, callback)
    , 100

Math.mean = (array) -> (_.reduce array, (a, b) -> a+b) / array.length

Math.stDev = (array) ->
  mean = Math.mean array
  dev  = _.map array, (itm) -> (itm-mean) * (itm-mean)

  return Math.sqrt Math.mean(dev)

describe 'redis-worker tests', () ->
  describe 'normal tests', () ->    
    it 'should exit process on unhandled exc. letting all running tasks finish', (done) ->
      concurrency = 5
      excThrowingTaskId = null

      processExit = (code) ->
        try
          expect(worker.runningTasks).to.eql [excThrowingTaskId]
          expect(worker.doneTasks.length).to.equal (concurrency - 1)
          expect(worker.failedTasks.length).to.equal 0

          done()
        catch err
          done err  
        finally
          process.exit.restore()

      sinon.stub(process, 'exit', processExit)

      worker = createWorker "exit_test_1", concurrency
      autofinishJob = (id) ->
        if worker.runningTasks.length > (concurrency - 1)
          excThrowingTaskId = id
          throw new Error "Unhandled exception mock."

        setTimeout () ->
          worker.finishTask(id)
        , (1000 + Math.random() * 500)

      worker.emitter.on 'running', autofinishJob

      async.series [
        (next) -> cleanWorker worker, next,
        (next) -> worker.waitForTasks next,
        (next) -> 
          async.each [1..concurrency], (id, innerNext) ->
            worker.pushJob { id: id }, innerNext
          , next
      ], (err) ->
        return done err if err

    it 'should exit process on two unhandled exc. letting all running tasks finish', (done) ->
      concurrency = 5
      excThrowingTaskIds = []

      processExit = (code) ->
        try
          expect(worker.runningTasks).to.eql excThrowingTaskIds
          expect(worker.doneTasks.length).to.equal (concurrency - 2)
          expect(worker.failedTasks.length).to.equal 0

          done()
        catch err
          done err  
        finally
          process.exit.restore()

      sinon.stub(process, 'exit', processExit)

      worker = createWorker "exit_test_1", concurrency
      autofinishJob = (id) ->
        if worker.runningTasks.length > (concurrency - 2)
          excThrowingTaskIds.push id
          throw new Error "Unhandled exception mock."

        setTimeout () ->
          worker.finishTask(id)
        , (1000 + Math.random() * 500)

      worker.emitter.on 'running', autofinishJob

      async.series [
        (next) -> cleanWorker worker, next,
        (next) -> worker.waitForTasks next,
        (next) -> 
          async.each [1..concurrency], (id, innerNext) ->
            worker.pushJob { id: id }, innerNext
          , next
      ], (err) ->
        return done err if err

    it 'should exit process on unhandled exc. killing all running tasks if they don\'t manage to finish on time', (done) ->
      concurrency = 5
      excThrowingTaskId = null

      processExit = (code) ->
        try
          expect(worker.runningTasks).to.eql [1..concurrency]
          expect(worker.doneTasks.length).to.equal 0
          expect(worker.failedTasks.length).to.equal 0

          done()
        catch err
          done err  
        finally
          process.exit.restore()

      sinon.stub(process, 'exit', processExit)

      worker = createWorker "exit_test_1", concurrency
      worker.gracefulShutdownTimeout = 1000
      autofinishJob = (id) ->
        if worker.runningTasks.length > (concurrency - 1)
          excThrowingTaskId = id
          throw new Error "Unhandled exception mock."

        setTimeout () ->
          worker.finishTask(id)
        , (150000 + Math.random() * 500)

      worker.emitter.on 'running', autofinishJob

      async.series [
        (next) -> cleanWorker worker, next,
        (next) -> worker.waitForTasks next,
        (next) -> 
          async.each [1..concurrency], (id, innerNext) ->
            worker.pushJob { id: id }, innerNext
          , next
      ], (err) ->
        return done err if err

    it 'should queue up a job and do it', (done) ->
      async.series [
        (next) -> concurrency1Worker.pushJob { id: "1" }, next,
        (next) ->
          waitUntil () ->
            "1" in concurrency1Worker.runningTasks
          , next,
        (next) ->
          concurrency1Worker.finishTask "1"
          waitUntil () ->
            "1" in concurrency1Worker.doneTasks
          , next
      ], (err) ->
        expect(concurrency1Worker.doneTasks).to.contain "1"
        done err

    it 'should queue up a job and do it in order', (done) ->
      async.series [
        (next) -> concurrency1Worker.pushJob { id: "1" }, next,
        (next) -> concurrency1Worker.pushJob { id: "2" }, next,
        (next) ->
          waitUntil () ->
            "1" in concurrency1Worker.runningTasks
          , next,
        (next) ->
          concurrency1Worker.finishSomeTask()
          waitUntil () ->
            "2" in concurrency1Worker.runningTasks
          , next,
        (next) ->
          concurrency1Worker.finishSomeTask()
          waitUntil () ->
            "2" in concurrency1Worker.doneTasks
          , next
      ], (err) ->
        expect(concurrency1Worker.doneTasks).to.contain "1"
        expect(concurrency1Worker.doneTasks).to.contain "2"
        expect(concurrency1Worker.maxRunningAtOnce).to.equal 1

        done err

# @TODO: Test if error is called out when @work returns an error.

  describe 'concurrency tests', () ->
    it 'should run up to <taskLimit> jobs at once', (done) ->
      worker      = concurrency2Worker
      tasksNumber = 20

      autofinishJobIn50ms = (id) ->
        setTimeout () ->
          worker.finishTask(id)
        , 50

      worker.emitter.on 'running', autofinishJobIn50ms

      async.series [
        (next) ->
          async.each [1..tasksNumber], (id, innerNext) ->
            worker.pushJob { id: id }, innerNext
          , next
        (next) ->
          waitUntil () ->
            worker.pendingTasks.length == 0
          , next,
        (next) ->
          waitUntil () ->
            worker.doneTasks.length == tasksNumber
          , next,
      ], (err) ->
        expect(worker.maxRunningAtOnce).to.equal worker.taskLimit

        worker.emitter.removeListener 'running', autofinishJobIn50ms
        done err

    it 'should not starve other queues if running side by side', (done) ->
      tasksNumber  = 2000
      concurrency  = 20
      workersCount = 5

      workers = []
      async.map [1..workersCount], (idx, next) ->
        worker = createWorker "same_id", concurrency
        cleanWorker worker, (err) ->
          return next err if err

          worker.waitForTasks (err) ->
            next err, worker
      , (err, workers) ->
        autofinishJobIn50msFactory = (worker) ->
          (id) ->
            setTimeout () ->
              worker.finishTask(id)
            , (80 + Math.random() * 40)

        for worker in workers
          worker.autofinishJobIn50ms = autofinishJobIn50msFactory(worker)
          worker.emitter.on 'running', worker.autofinishJobIn50ms

        countAllDoneTasks = () -> _.reduce workers, ((sum, worker) -> sum + worker.doneTasks.length), 0

        async.series [
          (next) ->
            async.each [1..tasksNumber], (id, innerNext) ->
              workers[0].pushJob { id: "A#{id}" }, innerNext
            , next
          (next) ->
            waitUntil () ->
              countAllDoneTasks() == tasksNumber
            , next,
        ], (err) ->
          for worker in workers
            worker.emitter.removeListener 'running', worker.autofinishJobIn50ms

          doneTasks = _.map workers, (worker) -> worker.doneTasks.length
          expect(Math.stDev doneTasks).to.be.below(tasksNumber / 100.0)

          done err

    it 'should not starve other queues if starting with pushed tasks', (done) ->
      tasksNumber  = 400
      concurrency  = 20
      workersCount = 5

      workers = []
      async.map [1..workersCount], (idx, next) ->
        worker = createWorker "same_id2", concurrency
        cleanWorker worker, (err) ->
          next err, worker
      , (err, workers) ->
        autofinishJobIn50msFactory = (worker) ->
          (id) ->
            setTimeout () ->
              worker.finishTask(id)
            , (80 + Math.random() * 40)

        for worker in workers
          worker.autofinishJobIn50ms = autofinishJobIn50msFactory(worker)
          worker.emitter.on 'running', worker.autofinishJobIn50ms

        countAllDoneTasks = () -> _.reduce workers, ((sum, worker) -> sum + worker.doneTasks.length), 0

        async.series [
          (next) ->
            async.each [1..tasksNumber], (id, innerNext) ->
              workers[0].pushJob { id: "B#{id}" }, innerNext
            , next
          (next) ->
            async.eachSeries workers, (worker, innerNext) ->
              worker.waitForTasks innerNext
            , next
          (next) ->
            waitUntil () ->
              countAllDoneTasks() == tasksNumber
            , next,
        ], (err) ->
          for worker in workers
            worker.emitter.removeListener 'running', worker.autofinishJobIn50ms

          doneTasks = _.map workers, (worker) -> worker.doneTasks.length
          expect(Math.stDev doneTasks).to.be.below(tasksNumber / 100.0)

          done err

    it 'should use all concurrency slots at all times', (done) ->
      tasksNumber  = 2000
      concurrency  = 10
      workersCount = 5

      workers = []
      async.map [1..workersCount], (idx, next) ->
        worker = createWorker "same_id3", concurrency
        cleanWorker worker, (err) ->
          next err, worker
      , (err, workers) ->
        autofinishJobIn50msFactory = (worker) ->
          (id) ->
            setTimeout () ->
              worker.finishTask(id)
            , (40 + Math.random() * 40)

        for worker in workers
          worker.autofinishJobIn50ms = autofinishJobIn50msFactory(worker)
          worker.emitter.on 'running', worker.autofinishJobIn50ms

        countAllDoneTasks    = () -> _.reduce workers, ((sum, worker) -> sum + worker.doneTasks.length), 0
        summarizeAllRunningTasks = () -> _.map workers, (worker) -> worker.runningTasks.length

        workersRunningTasksProfile  = []
        profilerTimerJob = setInterval () ->
          workersRunningTasksProfile.push summarizeAllRunningTasks()
        , 10

        async.series [
          (next) ->
            async.each [1..tasksNumber], (id, innerNext) ->
              workers[0].pushJob { id: "B#{id}" }, innerNext
            , next
          (next) ->
            async.each workers, (worker, innerNext) ->
              worker.waitForTasks innerNext
            , next
          (next) ->
            waitUntil () ->
              countAllDoneTasks() == tasksNumber
            , next,
        ], (err) ->
          for worker in workers
            worker.emitter.removeListener 'running', worker.autofinishJobIn50ms
          clearInterval profilerTimerJob

          runningTasksMeanPerWorker  = []
          runningTasksStDevPerWorker = []
          for workerIdx in [0...workers.length]
            workerRunningTasksProfile = _.map workersRunningTasksProfile, (runningTasksProfile) -> runningTasksProfile[workerIdx]
            workerRunningTasksProfileOnlyMidPoints = workerRunningTasksProfile[10..-20]

            runningTasksMeanPerWorker.push  Math.mean(workerRunningTasksProfileOnlyMidPoints)
            runningTasksStDevPerWorker.push Math.stDev(workerRunningTasksProfileOnlyMidPoints)

          # 0.9 , 0.2
          expect(_.min runningTasksMeanPerWorker).to.be.above(concurrency * 0.6)
          expect(_.max runningTasksStDevPerWorker).to.be.below(concurrency * 0.3)
            
          done err

    it 'should not use redis more than necessary', (done) ->
      tasksNumberPerWorker = 200
      concurrency  = 5
      workersCount = 3

      workers = []
      async.map [1..workersCount], (idx, next) ->
        worker = createWorker "test1_worker#{idx}", concurrency

        # Setup redis call spy.
        sinon.spy worker, 'popJobFromQueue'

        # Prepare worker.
        cleanWorker worker, (err) ->
          return next err if err

          worker.waitForTasks (err) ->
            next err, worker
      , (err, workers) ->
        autofinishJobIn50msFactory = (worker) ->
          (id) ->
            setTimeout () ->
              worker.finishTask(id)
            , (40 + Math.random() * 40)

        for worker in workers
          worker.autofinishJobIn50ms = autofinishJobIn50msFactory(worker)
          worker.emitter.on 'running', worker.autofinishJobIn50ms

        countAllDoneTasks = () -> _.reduce workers, ((sum, worker) -> sum + worker.doneTasks.length), 0

        async.series [
          (next) ->
            # Add 'tasksNumberPerWorker' tasks for each of the (separate!) workers
            async.each workers, (worker, innerNext) ->
              async.each [1..tasksNumberPerWorker], (id, innerInnerNext) ->
                worker.pushJob { id: "A#{id}" }, innerInnerNext
              , innerNext
            , next
          (next) ->
            # Wait till they finish.
            waitUntil () ->
              countAllDoneTasks() == tasksNumberPerWorker * workersCount
            , next,
          (next) ->
            # Add 'tasksNumberPerWorker' tasks for only one of the workers
            async.each [1..tasksNumberPerWorker], (id, innerNext) ->
              workers[0].pushJob { id: "B#{id}" }, innerNext
            , next
            # Add 'tasksNumberPerWorker' tasks for only one of the workers
            async.each [1..tasksNumberPerWorker], (id, innerNext) ->
              workers[1].pushJob { id: "B#{id}" }, innerNext
            , next
          (next) ->
            # Wait till it's finished.
            waitUntil () ->
              workers[0].doneTasks.length == 2 * tasksNumberPerWorker and workers[1].doneTasks.length == 2 * tasksNumberPerWorker
            , next,
          (next) ->
            # Add 'tasksNumberPerWorker' tasks for only one of the workers
            async.each [1..tasksNumberPerWorker], (id, innerNext) ->
              workers[2].pushJob { id: "C#{id}" }, innerNext
            , next
          (next) ->
            # Wait till it's finished.
            waitUntil () ->
              workers[2].doneTasks.length == 2 * tasksNumberPerWorker
            , next,
        ], (err) ->
          # Cleanup
          for worker in workers
            # Count number of times redis was called.
            expect(worker.popJobFromQueue.callCount).to.be.below(worker.doneTasks.length * 1.2)

            worker.emitter.removeListener 'running', worker.autofinishJobIn50ms
            worker.popJobFromQueue.restore()

          done err
