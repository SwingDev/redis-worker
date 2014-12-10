async   = require('async')
RedisConnectionManager = require("redis-connection-manager")


ERR_DRY_POOL = 'DRY_POOL'

class Worker
  constructor: (@url) ->
    throw new Error('You must create Worker with Redis Url') unless @url
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
      return cb(err) if err
      client.lpop @listKey(), cb

  checkAndRunTask: () ->
    return if @busy
    @busy = true
    async.forever((next) =>
      @popJobFromQueue (err,task) =>
        return next(err) if err
        return next(ERR_DRY_POOL) unless task
        @work task, (err) =>
          if err
            @error err, task, () -> next()
          else
            next()
    , (err) =>
      @busy = false
      if (err == ERR_DRY_POOL)
        return
        # console.log 'no more tasks'
      else if (err)
        console.log '[Error]', err
    )

  # Subclass API
  work: () ->
    throw new Error('You must overwrite Worker#work in subclass')

  error: () ->
    throw new Error('You must overwrite Worker#error in subclass')

  # API
  waitForTasks: (cb) ->
    @obtainChannelClient (err, client) =>
      return cb(err) if err
      @checkAndRunTask()

      client.on 'message', (channel, message) =>
        @checkAndRunTask() if channel == @channelKey()

      client.subscribe(@channelKey())

      cb()

  pushJob: (jobDict, cb) ->
    payload = JSON.stringify(jobDict)
    async.series([
      (callback) => @obtainListClient (err,client) =>
        return callback(err) if err
        client.rpush(@listKey(), payload, callback)
      (callback) => @obtainListClient (err,client) =>
        return callback(err) if err
        client.publish(@channelKey(), payload, callback)
    ], (err) -> cb(err))


module.exports = Worker
