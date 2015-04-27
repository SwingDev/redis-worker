_       = require('lodash')
domain  = require('domain')
async   = require('async')
moment  = require('moment')

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

  constructor: (options) ->
    {@url, @taskLimit, @retryTasks, @retryPopTasksInterval, @backoffInterval, @maxRetries} = options
    throw new Error('You must create Worker with Redis Url') unless @url
    @taskLimit  ?= 2
    @retryTasks ?= false
    @retryPopTasksInterval ?= 10*1000
    @backoffInterval ?= 30*1000
    @maxRetries ?= 3
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
  listKey:      () -> "worker:list:#{@name()}"
  errorsSetKey: () -> "worker:errors:#{@name()}"
  channelKey:   () -> "worker:channel:#{@name()}"

  obtainListClient:       (done) -> RedisConnectionManager.obtainClient @url, 'list', done
  obtainChannelClient:    (done) -> RedisConnectionManager.obtainClient @url, 'channel', done
  obtainErrorsSetClient:  (done) -> RedisConnectionManager.obtainClient @url, 'errors', done

  # Internal
  popErrJobFromQueue: (cb) ->
    @obtainErrorsSetClient (err, client) =>
      return cb createError(err, 'ERRSETNOTFOUND') if err
      timestamp = moment.utc().unix()
      client.zrangebyscore @errorsSetKey(), 0, timestamp, (err, tasks) =>
        return cb createError(err) if err
        return cb null unless tasks or tasks.length
        client.zremrangebyscore @errorsSetKey(), 0, timestamp, (err) =>
          return cb createError(err) if err
          asyncTasks = _.map tasks, (task) => (next) => @pushJob JSON.parse(task), next
          async.parallel asyncTasks, cb

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
      @work task, (taskErr) =>
        @decRunningTasks()
        return cb() unless taskErr

        @error taskErr, task, (taskErr) =>
          return cb null unless taskErr
          @pushErrorJob task, (err) ->
            return cb err if err
            return cb createError(taskErr, 'RUNTASK') if taskErr
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

      setInterval @handleErrorTasks, @retryPopTasksInterval if @retryTasks

      channel_client.on 'message', (channel, message) =>
        # console.log '\n>>>>> MSG', message.substr(38,70), '\n'
        if channel == @channelKey()
          return unless @_canTakeNewTasks()
          @_fetchJobFromRedisToQueue(true)

      channel_client.subscribe(@channelKey())

      cb()

  handleErrorTasks: () =>
    @popErrJobFromQueue (err) -> console.error err if err

  pushErrorJob: (payload, cb) ->
    return cb null unless @retryTasks
    jobDict = JSON.parse(payload)
    jobDict['times_retried'] = -1 unless jobDict.times_retried?
    jobDict.times_retried++
    return cb null if jobDict.times_retried >= @maxRetries
    payload = JSON.stringify(jobDict)
    async.series [
      (next) =>
        @obtainErrorsSetClient (err, client) =>
          return next createError(err, 'ERRSETNOTFOUND') if err
          client.zadd @errorsSetKey(), moment.utc().add(@_calculateBackoff(jobDict.times_retried),'ms').unix(), payload, next
      (next) =>
        @obtainErrorsSetClient (err, client) =>
          return next createError(err, 'ERRSETNOTFOUND') if err
          client.publish @channelKey, payload, next
    ], (err) ->
      return cb createError(err, 'PUSHERRJOB') if err
      cb null

  pushJob: (jobDict, cb) ->
    # console.log 'PUSHJOB'
    payload = JSON.stringify(jobDict)
    async.series [
      (callback) =>
        @obtainListClient (err,client) =>
          return callback createError(err, 'LISTNOTFOUND') if err
          client.rpush @listKey(), payload, callback
      (callback) =>
        @obtainListClient (err,client) =>
          return callback createError(err, 'LISTNOTFOUND') if err
          client.publish @channelKey(), payload, callback
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

  _calculateBackoff: (numRetries) ->
    # randMultiplier = Math.ceil(Math.random() * (2 ** (numRetries + 2) - 1))
    randMultiplier = Math.random() * (2 ** (numRetries + 2) - 1)
    randMultiplier = 1 if numRetries is 0
    (@backoffInterval * randMultiplier).toFixed(2)
 

### ###
# EXPORTS
exports.Worker = Worker
exports.WorkerError = WorkerError
