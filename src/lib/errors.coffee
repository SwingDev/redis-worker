ErrorHandler  = require('error-handler')
SError        = ErrorHandler.SError

errCodes = ['CHANNELNOTFOUND', 'LISTNOTFOUND', 'RUNTASK', 'POPJOB', 'PUSHJOB']

createError = (err, errCode) ->
  return null unless err

  if errCode
    switch errCode
      when 'CHANNELNOTFOUND'
        return new WorkerError('Client channel not found', err)
      when 'LISTNOTFOUND'
        return new WorkerError('Client list not found', err)
      when 'POPJOB'
        return new WorkerError('Pop job from queue was unsuccessful', err)
      when 'RUNTASK'
        return new WorkerError('Executing task from queue was unsuccessful ', err)
      when 'PUSHJOB'
        return new WorkerError('Push job to queue was unsuccessful', err)
      else
        return new WorkerError(errCode, err)
  else
    return new WorkerError(null, err)


### ###
# WorkerError - Worker error's
class WorkerError extends SError

  name: 'WorkerError'


### ###
# EXPORTS
exports.createError = createError
exports.WorkerError = WorkerError
exports.ERR_DRY_POOL = 'DRY_POOL'