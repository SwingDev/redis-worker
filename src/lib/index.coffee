domain = require('domain')
async   = require('async')

RedisConnectionManager = require("redis-connection-manager").RedisConnectionManager
errors = require('./errors')

createError = errors.createError
WorkerError = errors.WorkerError
ERR_DRY_POOL = errors.ERR_DRY_POOL


class Worker

  gracefulShutdownTimeout: 15000
  tasksRunning: 0

  incRunningTasks: () =>
    @tasksRunning += 1

  decRunningTasks: () =>
    @tasksRunning -= 1
    unless @tasksRunning
      @drainCallback() if @drainCallback?

  constructor: (@url, @taskLimit) ->
    throw new Error('You must create Worker with Redis Url') unless @url
    @taskLimit ?= 2
    @taskNo = 1
    @redisQueueEmpty = false
    @shuttingDown = false

    @workerDomain = domain.create()

    @workerDomain.on 'error', (err) =>
      @handleTaskDomainError err

    @queue = async.queue((task, callback) =>
      # console.log '\n>>>>> QUEUE'
      # console.log '>>>>> tasklimit', @taskLimit
      # console.log '>>>>> concurency val', @queue.concurrency
      # console.log '>>>>> number of tasks in queue', @queue.length()
      # console.log '>>>>> number of tasks running', @queue.running(), '\n'

      @workerDomain.enter()
      process.nextTick () =>
        @checkAndRunTask (err) =>
          console.error err if err

          callback null
          @_fetchJobFromRedisToQueue()
      @workerDomain.exit()

    , @taskLimit)

  name: () ->
    throw new Error('You must overwrite Worker#name in subclass')

  # Redis
  listKey:    () -> "worker:list:#{@name()}"
  channelKey: () -> "worker:channel:#{@name()}"

  obtainListClient:    (done) -> RedisConnectionManager.obtainClient @url, 'list', done
  obtainChannelClient: (done) -> RedisConnectionManager.obtainClient @url, 'channel', done

  # Internal
  popJobFromQueue: (cb) ->
    # console.log '>> POPJOB'
    @obtainListClient (err, client) =>
      return cb createError(err, 'LISTNOTFOUND') if err
      client.lpop @listKey(), cb

  checkAndRunTask: (cb) ->
    # console.log '> CHECKRUN'
    @popJobFromQueue (err,task) =>
      return cb createError(err, 'POPJOB') if err
      unless task
        # console.log '>>> NO MORE TASKS'
        @redisQueueEmpty = true
        return cb()

      @redisQueueEmpty = false
      # console.log '>>> TASK START JOB'

      @incRunningTasks()
      @work task, (err) =>
        @decRunningTasks()

        return cb() unless err
        @error err, task, (err) ->
          return cb createError(err, 'RUNTASK') if err
          cb null

  # Subclass API
  work: () ->
    throw new Error('You must overwrite Worker#work in subclass')

  error: () ->
    throw new Error('You must overwrite Worker#error in subclass')

  handleTaskDomainError: (err) =>
    console.error "Detected an unknown error <#{err}>, shutting down after this cycle or in #{@gracefulShutdownTimeout/1000.0} seconds."
    console.error err.stack

    unless @shuttingDown
      @shuttingDown = true

      postWorkHook = () =>
        # Flag used in testing, where we mock 'process.exit'.
        # Under normal circumstancess process.exit will kill this worker immediately.
        unless @shutDown
          console.warn "Post work, shutting down."
          @workerDomain.dispose()
          process.exit -1

        @shutDown = true

      @drainCallback = postWorkHook
      setTimeout postWorkHook, @gracefulShutdownTimeout

    @decRunningTasks()

  # API
  waitForTasks: (cb) ->
    @obtainChannelClient (err, channel_client) =>
      return cb createError(err, 'CHANNELNOTFOUND') if err

      @obtainListClient (err, list_client) => # @TODO: Why is this necessary?
        list_client.llen @listKey(), (err, length) =>
          prequeuedTasksNo = Math.max(1, Math.min(length, @taskLimit))

          @_fetchJobFromRedisToQueue() for idx in [1..prequeuedTasksNo] if length

      # @TODO: Why doesn't this alone work?
      # @_fetchJobFromRedisToQueue() for idx in [1..2]

      channel_client.on 'message', (channel, message) =>
        # console.log '\n>>>>> MSG', message.substr(38,70), '\n'
        if channel == @channelKey()
          return unless @_canTakeNewTasks()
          @_fetchJobFromRedisToQueue(true)

      channel_client.subscribe(@channelKey())

      cb()

  pushJob: (jobDict, cb) ->
    # console.log 'PUSHJOB'
    payload = JSON.stringify(jobDict)
    async.series [
      (callback) =>
        @obtainListClient (err,client) =>
          return callback createError(err, 'LISTNOTFOUND') if err
          client.rpush(@listKey(), payload, callback)
      (callback) =>
        @obtainListClient (err,client) =>
          return callback createError(err, 'LISTNOTFOUND') if err
          client.publish(@channelKey(), payload, callback)
    ], (err) ->
      return cb createError(err, 'PUSHJOB') if err
      cb null

  _canTakeNewTasks: () ->
    return @queue.running()+@queue.length() < @taskLimit

  _fetchJobFromRedisToQueue: (force) ->
    if (not @redisQueueEmpty or force) and not @shuttingDown
      tmpTaskNo = @taskNo
      @queue.push @taskNo, (err) ->
        # console.log '\n>>>> FINISHED TASK', tmpTaskNo, '\n'
        return
      # console.log '>>>>> FETCHED job and added to QUEUE'
      # console.log 'taskNo', @taskNo
      # console.log 'taskLimit', @taskLimit
      # console.log 'can take new tasks', @_canTakeNewTasks()
      @taskNo++
 

### ###
# EXPORTS
exports.Worker = Worker
exports.WorkerError = WorkerError
