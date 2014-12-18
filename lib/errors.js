var ErrorHandler, SError, WorkerError, createError, errCodes,
  __hasProp = {}.hasOwnProperty,
  __extends = function(child, parent) { for (var key in parent) { if (__hasProp.call(parent, key)) child[key] = parent[key]; } function ctor() { this.constructor = child; } ctor.prototype = parent.prototype; child.prototype = new ctor(); child.__super__ = parent.prototype; return child; };

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
        return new WorkerError(null, err);
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

//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbImVycm9ycy5jb2ZmZWUiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IkFBQUEsSUFBQSx3REFBQTtFQUFBO2lTQUFBOztBQUFBLFlBQUEsR0FBZ0IsT0FBQSxDQUFRLGVBQVIsQ0FBaEIsQ0FBQTs7QUFBQSxNQUNBLEdBQWdCLFlBQVksQ0FBQyxNQUQ3QixDQUFBOztBQUFBLFFBR0EsR0FBVyxDQUFDLGlCQUFELEVBQW9CLGNBQXBCLEVBQW9DLFNBQXBDLEVBQStDLFFBQS9DLEVBQXlELFNBQXpELENBSFgsQ0FBQTs7QUFBQSxXQUtBLEdBQWMsU0FBQyxHQUFELEVBQU0sT0FBTixHQUFBO0FBQ1osRUFBQSxJQUFBLENBQUEsR0FBQTtBQUFBLFdBQU8sSUFBUCxDQUFBO0dBQUE7QUFFQSxFQUFBLElBQUcsT0FBSDtBQUNFLFlBQU8sT0FBUDtBQUFBLFdBQ08saUJBRFA7QUFFSSxlQUFXLElBQUEsV0FBQSxDQUFZLDBCQUFaLEVBQXdDLEdBQXhDLENBQVgsQ0FGSjtBQUFBLFdBR08sY0FIUDtBQUlJLGVBQVcsSUFBQSxXQUFBLENBQVksdUJBQVosRUFBcUMsR0FBckMsQ0FBWCxDQUpKO0FBQUEsV0FLTyxRQUxQO0FBTUksZUFBVyxJQUFBLFdBQUEsQ0FBWSxxQ0FBWixFQUFtRCxHQUFuRCxDQUFYLENBTko7QUFBQSxXQU9PLFNBUFA7QUFRSSxlQUFXLElBQUEsV0FBQSxDQUFZLDZDQUFaLEVBQTJELEdBQTNELENBQVgsQ0FSSjtBQUFBLFdBU08sU0FUUDtBQVVJLGVBQVcsSUFBQSxXQUFBLENBQVksb0NBQVosRUFBa0QsR0FBbEQsQ0FBWCxDQVZKO0FBQUE7QUFZSSxlQUFXLElBQUEsV0FBQSxDQUFZLElBQVosRUFBa0IsR0FBbEIsQ0FBWCxDQVpKO0FBQUEsS0FERjtHQUFBLE1BQUE7QUFlRSxXQUFXLElBQUEsV0FBQSxDQUFZLElBQVosRUFBa0IsR0FBbEIsQ0FBWCxDQWZGO0dBSFk7QUFBQSxDQUxkLENBQUE7O0FBMEJBO0FBQUEsS0ExQkE7O0FBQUE7QUE4QkUsZ0NBQUEsQ0FBQTs7OztHQUFBOztBQUFBLHdCQUFBLElBQUEsR0FBTSxhQUFOLENBQUE7O3FCQUFBOztHQUZ3QixPQTVCMUIsQ0FBQTs7QUFpQ0E7QUFBQSxLQWpDQTs7QUFBQSxPQW1DTyxDQUFDLFdBQVIsR0FBc0IsV0FuQ3RCLENBQUE7O0FBQUEsT0FvQ08sQ0FBQyxXQUFSLEdBQXNCLFdBcEN0QixDQUFBOztBQUFBLE9BcUNPLENBQUMsWUFBUixHQUF1QixVQXJDdkIsQ0FBQSIsImZpbGUiOiJlcnJvcnMuanMiLCJzb3VyY2VSb290IjoiL3NvdXJjZS8iLCJzb3VyY2VzQ29udGVudCI6WyJFcnJvckhhbmRsZXIgID0gcmVxdWlyZSgnZXJyb3ItaGFuZGxlcicpXG5TRXJyb3IgICAgICAgID0gRXJyb3JIYW5kbGVyLlNFcnJvclxuXG5lcnJDb2RlcyA9IFsnQ0hBTk5FTE5PVEZPVU5EJywgJ0xJU1ROT1RGT1VORCcsICdSVU5UQVNLJywgJ1BPUEpPQicsICdQVVNISk9CJ11cblxuY3JlYXRlRXJyb3IgPSAoZXJyLCBlcnJDb2RlKSAtPlxuICByZXR1cm4gbnVsbCB1bmxlc3MgZXJyXG5cbiAgaWYgZXJyQ29kZVxuICAgIHN3aXRjaCBlcnJDb2RlXG4gICAgICB3aGVuICdDSEFOTkVMTk9URk9VTkQnXG4gICAgICAgIHJldHVybiBuZXcgV29ya2VyRXJyb3IoJ0NsaWVudCBjaGFubmVsIG5vdCBmb3VuZCcsIGVycilcbiAgICAgIHdoZW4gJ0xJU1ROT1RGT1VORCdcbiAgICAgICAgcmV0dXJuIG5ldyBXb3JrZXJFcnJvcignQ2xpZW50IGxpc3Qgbm90IGZvdW5kJywgZXJyKVxuICAgICAgd2hlbiAnUE9QSk9CJ1xuICAgICAgICByZXR1cm4gbmV3IFdvcmtlckVycm9yKCdQb3Agam9iIGZyb20gcXVldWUgd2FzIHVuc3VjY2Vzc2Z1bCcsIGVycilcbiAgICAgIHdoZW4gJ1JVTlRBU0snXG4gICAgICAgIHJldHVybiBuZXcgV29ya2VyRXJyb3IoJ0V4ZWN1dGluZyB0YXNrIGZyb20gcXVldWUgd2FzIHVuc3VjY2Vzc2Z1bCAnLCBlcnIpXG4gICAgICB3aGVuICdQVVNISk9CJ1xuICAgICAgICByZXR1cm4gbmV3IFdvcmtlckVycm9yKCdQdXNoIGpvYiB0byBxdWV1ZSB3YXMgdW5zdWNjZXNzZnVsJywgZXJyKVxuICAgICAgZWxzZVxuICAgICAgICByZXR1cm4gbmV3IFdvcmtlckVycm9yKG51bGwsIGVycilcbiAgZWxzZVxuICAgIHJldHVybiBuZXcgV29ya2VyRXJyb3IobnVsbCwgZXJyKVxuXG5cbiMjIyAjIyNcbiMgV29ya2VyRXJyb3IgLSBXb3JrZXIgZXJyb3Inc1xuY2xhc3MgV29ya2VyRXJyb3IgZXh0ZW5kcyBTRXJyb3JcblxuICBuYW1lOiAnV29ya2VyRXJyb3InXG5cblxuIyMjICMjI1xuIyBFWFBPUlRTXG5leHBvcnRzLmNyZWF0ZUVycm9yID0gY3JlYXRlRXJyb3JcbmV4cG9ydHMuV29ya2VyRXJyb3IgPSBXb3JrZXJFcnJvclxuZXhwb3J0cy5FUlJfRFJZX1BPT0wgPSAnRFJZX1BPT0wnIl19