async   = require('async')
RedisConnectionManager = require("redis-connection-manager").RedisConnectionManager
errors = require('./errors')

createError = errors.createError
WorkerError = errors.WorkerError
ERR_DRY_POOL = errors.ERR_DRY_POOL


class Worker
  constructor: (@url, @taskLimit) ->
    throw new Error('You must create Worker with Redis Url') unless @url
    @taskLimit = 2 unless @taskLimit
    @taskNo = 1
    @redisQueueEmpty = false
    @errInQueue = false

    @queue = async.queue((task, callback) =>
      # console.log '\n>>>>> QUEUE'
      # console.log '>>>>> tasklimit', @taskLimit
      # console.log '>>>>> concurency val', @queue.concurrency
      # console.log '>>>>> number of tasks in queue', @queue.length()
      # console.log '>>>>> number of tasks running', @queue.running(), '\n'
      @checkAndRunTask (err) =>
        if err
          @errInQueue = true
          console.error 'Error at worker queue', err
          setTimeout(() ->
            process.exit(-1)
          , 15000)
          return callback(err)

        callback()
        @_fetchJobFromRedisToQueue()

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
      return cb(createError(err, 'POPJOB')) if err
      unless task
        # console.log '>>> NO MORE TASKS'
        @redisQueueEmpty = true
        return cb()

      @redisQueueEmpty = false
      # console.log '>>> TASK START JOB'
      @work task, (err) =>
        return cb() unless err
        @error err, task, (err) -> 
          cb(createError(err, 'RUNTASK'))



  # Subclass API
  work: () ->
    throw new Error('You must overwrite Worker#work in subclass')

  error: () ->
    throw new Error('You must overwrite Worker#error in subclass')

  # API
  waitForTasks: (cb) ->
    @obtainChannelClient (err, client) =>
      return cb createError(err, 'CHANNELNOTFOUND') if err

      client.llen @listKey(), (err, length) =>
        @_fetchJobFromRedisToQueue() for idx in [1..(length < @taskLimit) ? length : @taskLimit] if length

      client.on 'message', (channel, message) =>
        # console.log '\n>>>>> MSG', message.substr(38,70), '\n'
        if channel == @channelKey()
          return unless @_canTakeNewTasks()
          @_fetchJobFromRedisToQueue(true)

      client.subscribe(@channelKey())

      cb()

  pushJob: (jobDict, cb) ->
    # console.log 'PUSHJOB'
    payload = JSON.stringify(jobDict)
    async.series [
      (callback) =>
        @obtainListClient (err,client) =>
          return callback(createError(err, 'LISTNOTFOUND')) if err
          client.rpush(@listKey(), payload, callback)
      (callback) =>
        @obtainListClient (err,client) =>
          return callback(createError(err, 'LISTNOTFOUND')) if err
          client.publish(@channelKey(), payload, callback)
    ], (err) ->
      cb(createError(err, 'PUSHJOB'))

  _canTakeNewTasks: () ->
    return @queue.running()+@queue.length() < @taskLimit

  _fetchJobFromRedisToQueue: (force) ->
    if (not @redisQueueEmpty or force) and not @errInQueue 
      tmpTaskNo = @taskNo
      @queue.push @taskNo, (err) =>
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
