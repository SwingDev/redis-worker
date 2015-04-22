var ErrorHandler, SError, WorkerError, createError, errCodes,
  __hasProp = {}.hasOwnProperty,
  __extends = function(child, parent) { for (var key in parent) { if (__hasProp.call(parent, key)) child[key] = parent[key]; } function ctor() { this.constructor = child; } ctor.prototype = parent.prototype; child.prototype = new ctor(); child.__super__ = parent.prototype; return child; };

ErrorHandler = require('error-handler');

SError = ErrorHandler.SError;

errCodes = ['CHANNELNOTFOUND', 'LISTNOTFOUND', 'RUNTASK', 'POPJOB', 'PUSHJOB'];

createError = function(err, errCode) {
  if (!(err || errCode)) {
    return null;
  }
  if (errCode) {
    switch (errCode) {
      case 'CHANNELNOTFOUND':
        return new WorkerError('Client channel not found', err);
      case 'LISTNOTFOUND':
        return new WorkerError('Client list not found', err);
      case 'POPJOB':
        return new WorkerError('Pop job from queue was unsuccessful', err);
      case 'RUNTASK':
        return new WorkerError('Executing task from queue was unsuccessful ', err);
      case 'PUSHJOB':
        return new WorkerError('Push job to queue was unsuccessful', err);
      default:
        return new WorkerError(errCode, err);
    }
  } else {
    return new WorkerError(null, err);
  }
};


/* */

WorkerError = (function(_super) {
  __extends(WorkerError, _super);

  function WorkerError() {
    return WorkerError.__super__.constructor.apply(this, arguments);
  }

  WorkerError.prototype.name = 'WorkerError';

  return WorkerError;

})(SError);


/* */

exports.createError = createError;

exports.WorkerError = WorkerError;

exports.ERR_DRY_POOL = 'DRY_POOL';

//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbImxpYi9lcnJvcnMuY29mZmVlIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiJBQUFBLElBQUEsd0RBQUE7RUFBQTtpU0FBQTs7QUFBQSxZQUFBLEdBQWdCLE9BQUEsQ0FBUSxlQUFSLENBQWhCLENBQUE7O0FBQUEsTUFDQSxHQUFnQixZQUFZLENBQUMsTUFEN0IsQ0FBQTs7QUFBQSxRQUdBLEdBQVcsQ0FBQyxpQkFBRCxFQUFvQixjQUFwQixFQUFvQyxTQUFwQyxFQUErQyxRQUEvQyxFQUF5RCxTQUF6RCxDQUhYLENBQUE7O0FBQUEsV0FLQSxHQUFjLFNBQUMsR0FBRCxFQUFNLE9BQU4sR0FBQTtBQUNaLEVBQUEsSUFBQSxDQUFBLENBQW1CLEdBQUEsSUFBTyxPQUExQixDQUFBO0FBQUEsV0FBTyxJQUFQLENBQUE7R0FBQTtBQUVBLEVBQUEsSUFBRyxPQUFIO0FBQ0UsWUFBTyxPQUFQO0FBQUEsV0FDTyxpQkFEUDtBQUVJLGVBQVcsSUFBQSxXQUFBLENBQVksMEJBQVosRUFBd0MsR0FBeEMsQ0FBWCxDQUZKO0FBQUEsV0FHTyxjQUhQO0FBSUksZUFBVyxJQUFBLFdBQUEsQ0FBWSx1QkFBWixFQUFxQyxHQUFyQyxDQUFYLENBSko7QUFBQSxXQUtPLFFBTFA7QUFNSSxlQUFXLElBQUEsV0FBQSxDQUFZLHFDQUFaLEVBQW1ELEdBQW5ELENBQVgsQ0FOSjtBQUFBLFdBT08sU0FQUDtBQVFJLGVBQVcsSUFBQSxXQUFBLENBQVksNkNBQVosRUFBMkQsR0FBM0QsQ0FBWCxDQVJKO0FBQUEsV0FTTyxTQVRQO0FBVUksZUFBVyxJQUFBLFdBQUEsQ0FBWSxvQ0FBWixFQUFrRCxHQUFsRCxDQUFYLENBVko7QUFBQTtBQVlJLGVBQVcsSUFBQSxXQUFBLENBQVksT0FBWixFQUFxQixHQUFyQixDQUFYLENBWko7QUFBQSxLQURGO0dBQUEsTUFBQTtBQWVFLFdBQVcsSUFBQSxXQUFBLENBQVksSUFBWixFQUFrQixHQUFsQixDQUFYLENBZkY7R0FIWTtBQUFBLENBTGQsQ0FBQTs7QUEwQkE7QUFBQSxLQTFCQTs7QUFBQTtBQThCRSxnQ0FBQSxDQUFBOzs7O0dBQUE7O0FBQUEsd0JBQUEsSUFBQSxHQUFNLGFBQU4sQ0FBQTs7cUJBQUE7O0dBRndCLE9BNUIxQixDQUFBOztBQWlDQTtBQUFBLEtBakNBOztBQUFBLE9BbUNPLENBQUMsV0FBUixHQUFzQixXQW5DdEIsQ0FBQTs7QUFBQSxPQW9DTyxDQUFDLFdBQVIsR0FBc0IsV0FwQ3RCLENBQUE7O0FBQUEsT0FxQ08sQ0FBQyxZQUFSLEdBQXVCLFVBckN2QixDQUFBIiwiZmlsZSI6ImxpYi9lcnJvcnMuanMiLCJzb3VyY2VSb290IjoiL3NvdXJjZS8iLCJzb3VyY2VzQ29udGVudCI6WyJFcnJvckhhbmRsZXIgID0gcmVxdWlyZSgnZXJyb3ItaGFuZGxlcicpXG5TRXJyb3IgICAgICAgID0gRXJyb3JIYW5kbGVyLlNFcnJvclxuXG5lcnJDb2RlcyA9IFsnQ0hBTk5FTE5PVEZPVU5EJywgJ0xJU1ROT1RGT1VORCcsICdSVU5UQVNLJywgJ1BPUEpPQicsICdQVVNISk9CJ11cblxuY3JlYXRlRXJyb3IgPSAoZXJyLCBlcnJDb2RlKSAtPlxuICByZXR1cm4gbnVsbCB1bmxlc3MgZXJyIG9yIGVyckNvZGVcblxuICBpZiBlcnJDb2RlXG4gICAgc3dpdGNoIGVyckNvZGVcbiAgICAgIHdoZW4gJ0NIQU5ORUxOT1RGT1VORCdcbiAgICAgICAgcmV0dXJuIG5ldyBXb3JrZXJFcnJvcignQ2xpZW50IGNoYW5uZWwgbm90IGZvdW5kJywgZXJyKVxuICAgICAgd2hlbiAnTElTVE5PVEZPVU5EJ1xuICAgICAgICByZXR1cm4gbmV3IFdvcmtlckVycm9yKCdDbGllbnQgbGlzdCBub3QgZm91bmQnLCBlcnIpXG4gICAgICB3aGVuICdQT1BKT0InXG4gICAgICAgIHJldHVybiBuZXcgV29ya2VyRXJyb3IoJ1BvcCBqb2IgZnJvbSBxdWV1ZSB3YXMgdW5zdWNjZXNzZnVsJywgZXJyKVxuICAgICAgd2hlbiAnUlVOVEFTSydcbiAgICAgICAgcmV0dXJuIG5ldyBXb3JrZXJFcnJvcignRXhlY3V0aW5nIHRhc2sgZnJvbSBxdWV1ZSB3YXMgdW5zdWNjZXNzZnVsICcsIGVycilcbiAgICAgIHdoZW4gJ1BVU0hKT0InXG4gICAgICAgIHJldHVybiBuZXcgV29ya2VyRXJyb3IoJ1B1c2ggam9iIHRvIHF1ZXVlIHdhcyB1bnN1Y2Nlc3NmdWwnLCBlcnIpXG4gICAgICBlbHNlXG4gICAgICAgIHJldHVybiBuZXcgV29ya2VyRXJyb3IoZXJyQ29kZSwgZXJyKVxuICBlbHNlXG4gICAgcmV0dXJuIG5ldyBXb3JrZXJFcnJvcihudWxsLCBlcnIpXG5cblxuIyMjICMjI1xuIyBXb3JrZXJFcnJvciAtIFdvcmtlciBlcnJvcidzXG5jbGFzcyBXb3JrZXJFcnJvciBleHRlbmRzIFNFcnJvclxuXG4gIG5hbWU6ICdXb3JrZXJFcnJvcidcblxuXG4jIyMgIyMjXG4jIEVYUE9SVFNcbmV4cG9ydHMuY3JlYXRlRXJyb3IgPSBjcmVhdGVFcnJvclxuZXhwb3J0cy5Xb3JrZXJFcnJvciA9IFdvcmtlckVycm9yXG5leHBvcnRzLkVSUl9EUllfUE9PTCA9ICdEUllfUE9PTCciXX0=