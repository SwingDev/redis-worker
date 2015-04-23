var ErrorHandler, SError, WorkerError, createError, errCodes,
  extend = function(child, parent) { for (var key in parent) { if (hasProp.call(parent, key)) child[key] = parent[key]; } function ctor() { this.constructor = child; } ctor.prototype = parent.prototype; child.prototype = new ctor(); child.__super__ = parent.prototype; return child; },
  hasProp = {}.hasOwnProperty;

ErrorHandler = require('error-handler');

SError = ErrorHandler.SError;

errCodes = ['CHANNELNOTFOUND', 'LISTNOTFOUND', 'RUNTASK', 'POPJOB', 'PUSHJOB'];

createError = function(err, errCode) {
  if (!err) {
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

WorkerError = (function(superClass) {
  extend(WorkerError, superClass);

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

//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbImxpYi9lcnJvcnMuY29mZmVlIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiJBQUFBLElBQUEsd0RBQUE7RUFBQTs2QkFBQTs7QUFBQSxZQUFBLEdBQWdCLE9BQUEsQ0FBUSxlQUFSLENBQWhCLENBQUE7O0FBQUEsTUFDQSxHQUFnQixZQUFZLENBQUMsTUFEN0IsQ0FBQTs7QUFBQSxRQUdBLEdBQVcsQ0FBQyxpQkFBRCxFQUFvQixjQUFwQixFQUFvQyxTQUFwQyxFQUErQyxRQUEvQyxFQUF5RCxTQUF6RCxDQUhYLENBQUE7O0FBQUEsV0FLQSxHQUFjLFNBQUMsR0FBRCxFQUFNLE9BQU4sR0FBQTtBQUNaLEVBQUEsSUFBQSxDQUFBLEdBQUE7QUFBQSxXQUFPLElBQVAsQ0FBQTtHQUFBO0FBRUEsRUFBQSxJQUFHLE9BQUg7QUFDRSxZQUFPLE9BQVA7QUFBQSxXQUNPLGlCQURQO0FBRUksZUFBVyxJQUFBLFdBQUEsQ0FBWSwwQkFBWixFQUF3QyxHQUF4QyxDQUFYLENBRko7QUFBQSxXQUdPLGNBSFA7QUFJSSxlQUFXLElBQUEsV0FBQSxDQUFZLHVCQUFaLEVBQXFDLEdBQXJDLENBQVgsQ0FKSjtBQUFBLFdBS08sUUFMUDtBQU1JLGVBQVcsSUFBQSxXQUFBLENBQVkscUNBQVosRUFBbUQsR0FBbkQsQ0FBWCxDQU5KO0FBQUEsV0FPTyxTQVBQO0FBUUksZUFBVyxJQUFBLFdBQUEsQ0FBWSw2Q0FBWixFQUEyRCxHQUEzRCxDQUFYLENBUko7QUFBQSxXQVNPLFNBVFA7QUFVSSxlQUFXLElBQUEsV0FBQSxDQUFZLG9DQUFaLEVBQWtELEdBQWxELENBQVgsQ0FWSjtBQUFBO0FBWUksZUFBVyxJQUFBLFdBQUEsQ0FBWSxPQUFaLEVBQXFCLEdBQXJCLENBQVgsQ0FaSjtBQUFBLEtBREY7R0FBQSxNQUFBO0FBZUUsV0FBVyxJQUFBLFdBQUEsQ0FBWSxJQUFaLEVBQWtCLEdBQWxCLENBQVgsQ0FmRjtHQUhZO0FBQUEsQ0FMZCxDQUFBOztBQTBCQTtBQUFBLEtBMUJBOztBQUFBO0FBOEJFLGlDQUFBLENBQUE7Ozs7R0FBQTs7QUFBQSx3QkFBQSxJQUFBLEdBQU0sYUFBTixDQUFBOztxQkFBQTs7R0FGd0IsT0E1QjFCLENBQUE7O0FBaUNBO0FBQUEsS0FqQ0E7O0FBQUEsT0FtQ08sQ0FBQyxXQUFSLEdBQXNCLFdBbkN0QixDQUFBOztBQUFBLE9Bb0NPLENBQUMsV0FBUixHQUFzQixXQXBDdEIsQ0FBQTs7QUFBQSxPQXFDTyxDQUFDLFlBQVIsR0FBdUIsVUFyQ3ZCLENBQUEiLCJmaWxlIjoibGliL2Vycm9ycy5qcyIsInNvdXJjZVJvb3QiOiIvc291cmNlLyIsInNvdXJjZXNDb250ZW50IjpbIkVycm9ySGFuZGxlciAgPSByZXF1aXJlKCdlcnJvci1oYW5kbGVyJylcblNFcnJvciAgICAgICAgPSBFcnJvckhhbmRsZXIuU0Vycm9yXG5cbmVyckNvZGVzID0gWydDSEFOTkVMTk9URk9VTkQnLCAnTElTVE5PVEZPVU5EJywgJ1JVTlRBU0snLCAnUE9QSk9CJywgJ1BVU0hKT0InXVxuXG5jcmVhdGVFcnJvciA9IChlcnIsIGVyckNvZGUpIC0+XG4gIHJldHVybiBudWxsIHVubGVzcyBlcnJcblxuICBpZiBlcnJDb2RlXG4gICAgc3dpdGNoIGVyckNvZGVcbiAgICAgIHdoZW4gJ0NIQU5ORUxOT1RGT1VORCdcbiAgICAgICAgcmV0dXJuIG5ldyBXb3JrZXJFcnJvcignQ2xpZW50IGNoYW5uZWwgbm90IGZvdW5kJywgZXJyKVxuICAgICAgd2hlbiAnTElTVE5PVEZPVU5EJ1xuICAgICAgICByZXR1cm4gbmV3IFdvcmtlckVycm9yKCdDbGllbnQgbGlzdCBub3QgZm91bmQnLCBlcnIpXG4gICAgICB3aGVuICdQT1BKT0InXG4gICAgICAgIHJldHVybiBuZXcgV29ya2VyRXJyb3IoJ1BvcCBqb2IgZnJvbSBxdWV1ZSB3YXMgdW5zdWNjZXNzZnVsJywgZXJyKVxuICAgICAgd2hlbiAnUlVOVEFTSydcbiAgICAgICAgcmV0dXJuIG5ldyBXb3JrZXJFcnJvcignRXhlY3V0aW5nIHRhc2sgZnJvbSBxdWV1ZSB3YXMgdW5zdWNjZXNzZnVsICcsIGVycilcbiAgICAgIHdoZW4gJ1BVU0hKT0InXG4gICAgICAgIHJldHVybiBuZXcgV29ya2VyRXJyb3IoJ1B1c2ggam9iIHRvIHF1ZXVlIHdhcyB1bnN1Y2Nlc3NmdWwnLCBlcnIpXG4gICAgICBlbHNlXG4gICAgICAgIHJldHVybiBuZXcgV29ya2VyRXJyb3IoZXJyQ29kZSwgZXJyKVxuICBlbHNlXG4gICAgcmV0dXJuIG5ldyBXb3JrZXJFcnJvcihudWxsLCBlcnIpXG5cblxuIyMjICMjI1xuIyBXb3JrZXJFcnJvciAtIFdvcmtlciBlcnJvcidzXG5jbGFzcyBXb3JrZXJFcnJvciBleHRlbmRzIFNFcnJvclxuXG4gIG5hbWU6ICdXb3JrZXJFcnJvcidcblxuXG4jIyMgIyMjXG4jIEVYUE9SVFNcbmV4cG9ydHMuY3JlYXRlRXJyb3IgPSBjcmVhdGVFcnJvclxuZXhwb3J0cy5Xb3JrZXJFcnJvciA9IFdvcmtlckVycm9yXG5leHBvcnRzLkVSUl9EUllfUE9PTCA9ICdEUllfUE9PTCciXX0=