async   = require('async')
RedisConnectionManager = require("redis-connection-manager").RedisConnectionManager
errors = require('./errors')

createError = errors.createError
WorkerError = errors.WorkerError
ERR_DRY_POOL = errors.ERR_DRY_POOL


class Worker
  constructor: (@url) ->
    throw new Error('You must create Worker with Redis Url') unless @url

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
    return if @busy
    @busy = true
    async.forever (next) =>
      @popJobFromQueue (err,task) =>
        return next(createError(err, 'POPJOB')) if err
        return next(ERR_DRY_POOL) unless task
        @work task, (err) =>
          if err
            @error err, task, (err) -> next(createError(err, 'RUNTASK'))
          else
            next()
    , (err) =>
      @busy = false
      if (err == ERR_DRY_POOL)
        return
      else if (err)
        return cb err

  # Subclass API
  work: () ->
    throw new Error('You must overwrite Worker#work in subclass')

  error: () ->
    throw new Error('You must overwrite Worker#error in subclass')

  # API
  waitForTasks: (cb) ->
    @obtainChannelClient (err, client) =>
      return cb createError(err, 'CHANNELNOTFOUND') if err

      @checkAndRunTask (err) ->
        cb err if err

      client.on 'message', (channel, message) =>
        if channel == @channelKey()
          @checkAndRunTask (err) ->
            cb err if err

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
