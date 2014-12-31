async   = require('async')
RedisConnectionManager = require("redis-connection-manager").RedisConnectionManager
errors = require('./errors')

createError = errors.createError
WorkerError = errors.WorkerError
ERR_DRY_POOL = errors.ERR_DRY_POOL


class Worker
  constructor: (@url, @taskLimit) ->
    throw new Error('You must create Worker with Redis Url') unless @url
    @taskLimit = 5 unless @taskLimit
    @taskNo = 0
    @taskClean = false

    @queue = async.queue((task, callback) =>
      # console.log '\n\n\ntaskNo' + task
      # console.log 'tasklimit', @taskLimit
      # console.log 'concurency val', @queue.concurrency
      # console.log 'number of tasks in queue', @queue.length()
      # console.log 'number of tasks running', @queue.running()
      @checkAndRunTask (err) ->
        return callback(err) if err
        callback()
    , @taskLimit);

    @queue.drain = () =>
      unless @taskClean
        @taskNo++
        @queue.push @taskNo, (err) ->
          cb(err) if err
          return

  name: () ->
    throw new Error('You must overwrite Worker#name in subclass')

  # Redis
  listKey:    () -> "worker:list:#{@name()}"
  channelKey: () -> "worker:channel:#{@name()}"

  obtainListClient:    (done) -> RedisConnectionManager.obtainClient @url, 'list', done
  obtainChannelClient: (done) -> RedisConnectionManager.obtainClient @url, 'channel', done

  # Internal
  popJobFromQueue: (cb) ->
    @obtainListClient (err, client) =>
      return cb createError(err, 'LISTNOTFOUND') if err
      client.lpop @listKey(), cb

  checkAndRunTask: (cb) ->
    @popJobFromQueue (err,task) =>
      return cb(createError(err, 'POPJOB')) if err
      unless task
        @taskClean = true
        return cb() 
      @work task, (err) =>
        if err
          @error err, task, (err) -> cb(createError(err, 'RUNTASK'))
        else
          cb()


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
        if length > 0
          for count in [length..1]
            @taskNo++
            @queue.push @taskNo, (err) ->
              cb(err) if err
              return

      client.on 'message', (channel, message) =>
        if channel == @channelKey()
          @taskClean = false
          @taskNo++
          @queue.push @taskNo, (err) ->
            cb(err) if err
            return

      client.subscribe(@channelKey())

      cb()

  pushJob: (jobDict, cb) ->
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


### ###
# EXPORTS
exports.Worker = Worker
exports.WorkerError = WorkerError
