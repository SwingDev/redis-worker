var ErrorHandler, RedisConnectionManager, RedisError, SError, WorkerError, createError, errCodes,
  __hasProp = {}.hasOwnProperty,
  __extends = function(child, parent) { for (var key in parent) { if (__hasProp.call(parent, key)) child[key] = parent[key]; } function ctor() { this.constructor = child; } ctor.prototype = parent.prototype; child.prototype = new ctor(); child.__super__ = parent.prototype; return child; };

ErrorHandler = require('error-handler');

RedisConnectionManager = require("redis-connection-manager");

SError = ErrorHandler.SError;

RedisError = RedisConnectionManager.RedisError;

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

exports.createError = createError;

exports.WorkerError = WorkerError;

exports.ERR_DRY_POOL = 'DRY_POOL';

//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbImVycm9ycy5jb2ZmZWUiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IkFBQ0EsSUFBQSw0RkFBQTtFQUFBO2lTQUFBOztBQUFBLFlBQUEsR0FBZSxPQUFBLENBQVEsZUFBUixDQUFmLENBQUE7O0FBQUEsc0JBQ0EsR0FBeUIsT0FBQSxDQUFRLDBCQUFSLENBRHpCLENBQUE7O0FBQUEsTUFHQSxHQUFTLFlBQVksQ0FBQyxNQUh0QixDQUFBOztBQUFBLFVBSUEsR0FBYSxzQkFBc0IsQ0FBQyxVQUpwQyxDQUFBOztBQUFBLFFBTUEsR0FBVyxDQUFDLGlCQUFELEVBQW9CLGNBQXBCLEVBQW9DLFNBQXBDLEVBQStDLFFBQS9DLEVBQXlELFNBQXpELENBTlgsQ0FBQTs7QUFBQSxXQVFBLEdBQWMsU0FBQyxHQUFELEVBQU0sT0FBTixHQUFBO0FBQ1osRUFBQSxJQUFBLENBQUEsR0FBQTtBQUFBLFdBQU8sSUFBUCxDQUFBO0dBQUE7QUFFQSxFQUFBLElBQUcsT0FBSDtBQUNFLFlBQU8sT0FBUDtBQUFBLFdBQ08saUJBRFA7QUFFSSxlQUFXLElBQUEsV0FBQSxDQUFZLDBCQUFaLEVBQXdDLEdBQXhDLENBQVgsQ0FGSjtBQUFBLFdBR08sY0FIUDtBQUlJLGVBQVcsSUFBQSxXQUFBLENBQVksdUJBQVosRUFBcUMsR0FBckMsQ0FBWCxDQUpKO0FBQUEsV0FLTyxRQUxQO0FBTUksZUFBVyxJQUFBLFdBQUEsQ0FBWSxxQ0FBWixFQUFtRCxHQUFuRCxDQUFYLENBTko7QUFBQSxXQU9PLFNBUFA7QUFRSSxlQUFXLElBQUEsV0FBQSxDQUFZLDZDQUFaLEVBQTJELEdBQTNELENBQVgsQ0FSSjtBQUFBLFdBU08sU0FUUDtBQVVJLGVBQVcsSUFBQSxXQUFBLENBQVksb0NBQVosRUFBa0QsR0FBbEQsQ0FBWCxDQVZKO0FBQUE7QUFZSSxlQUFXLElBQUEsV0FBQSxDQUFZLElBQVosRUFBa0IsR0FBbEIsQ0FBWCxDQVpKO0FBQUEsS0FERjtHQUFBLE1BQUE7QUFlRSxXQUFXLElBQUEsV0FBQSxDQUFZLElBQVosRUFBa0IsR0FBbEIsQ0FBWCxDQWZGO0dBSFk7QUFBQSxDQVJkLENBQUE7O0FBNkJBO0FBQUEsS0E3QkE7O0FBQUE7QUFpQ0UsZ0NBQUEsQ0FBQTs7OztHQUFBOztBQUFBLHdCQUFBLElBQUEsR0FBTSxhQUFOLENBQUE7O3FCQUFBOztHQUZ3QixPQS9CMUIsQ0FBQTs7QUFBQSxPQW9DTyxDQUFDLFdBQVIsR0FBc0IsV0FwQ3RCLENBQUE7O0FBQUEsT0FxQ08sQ0FBQyxXQUFSLEdBQXNCLFdBckN0QixDQUFBOztBQUFBLE9Bc0NPLENBQUMsWUFBUixHQUF1QixVQXRDdkIsQ0FBQSIsImZpbGUiOiJlcnJvcnMuanMiLCJzb3VyY2VSb290IjoiL3NvdXJjZS8iLCJzb3VyY2VzQ29udGVudCI6WyIjXyA9IHJlcXVpcmUoJ2xvZGFzaCcpXG5FcnJvckhhbmRsZXIgPSByZXF1aXJlKCdlcnJvci1oYW5kbGVyJylcblJlZGlzQ29ubmVjdGlvbk1hbmFnZXIgPSByZXF1aXJlKFwicmVkaXMtY29ubmVjdGlvbi1tYW5hZ2VyXCIpXG5cblNFcnJvciA9IEVycm9ySGFuZGxlci5TRXJyb3JcblJlZGlzRXJyb3IgPSBSZWRpc0Nvbm5lY3Rpb25NYW5hZ2VyLlJlZGlzRXJyb3JcblxuZXJyQ29kZXMgPSBbJ0NIQU5ORUxOT1RGT1VORCcsICdMSVNUTk9URk9VTkQnLCAnUlVOVEFTSycsICdQT1BKT0InLCAnUFVTSEpPQiddXG5cbmNyZWF0ZUVycm9yID0gKGVyciwgZXJyQ29kZSkgLT5cbiAgcmV0dXJuIG51bGwgdW5sZXNzIGVyclxuXG4gIGlmIGVyckNvZGVcbiAgICBzd2l0Y2ggZXJyQ29kZVxuICAgICAgd2hlbiAnQ0hBTk5FTE5PVEZPVU5EJ1xuICAgICAgICByZXR1cm4gbmV3IFdvcmtlckVycm9yKCdDbGllbnQgY2hhbm5lbCBub3QgZm91bmQnLCBlcnIpXG4gICAgICB3aGVuICdMSVNUTk9URk9VTkQnXG4gICAgICAgIHJldHVybiBuZXcgV29ya2VyRXJyb3IoJ0NsaWVudCBsaXN0IG5vdCBmb3VuZCcsIGVycilcbiAgICAgIHdoZW4gJ1BPUEpPQidcbiAgICAgICAgcmV0dXJuIG5ldyBXb3JrZXJFcnJvcignUG9wIGpvYiBmcm9tIHF1ZXVlIHdhcyB1bnN1Y2Nlc3NmdWwnLCBlcnIpXG4gICAgICB3aGVuICdSVU5UQVNLJ1xuICAgICAgICByZXR1cm4gbmV3IFdvcmtlckVycm9yKCdFeGVjdXRpbmcgdGFzayBmcm9tIHF1ZXVlIHdhcyB1bnN1Y2Nlc3NmdWwgJywgZXJyKVxuICAgICAgd2hlbiAnUFVTSEpPQidcbiAgICAgICAgcmV0dXJuIG5ldyBXb3JrZXJFcnJvcignUHVzaCBqb2IgdG8gcXVldWUgd2FzIHVuc3VjY2Vzc2Z1bCcsIGVycilcbiAgICAgIGVsc2VcbiAgICAgICAgcmV0dXJuIG5ldyBXb3JrZXJFcnJvcihudWxsLCBlcnIpXG4gIGVsc2VcbiAgICByZXR1cm4gbmV3IFdvcmtlckVycm9yKG51bGwsIGVycilcblxuXG4jIyMgIyMjXG4jIFdvcmtlckVycm9yIC0gV29ya2VyIGVycm9yJ3NcbmNsYXNzIFdvcmtlckVycm9yIGV4dGVuZHMgU0Vycm9yXG5cbiAgbmFtZTogJ1dvcmtlckVycm9yJ1xuXG5cbmV4cG9ydHMuY3JlYXRlRXJyb3IgPSBjcmVhdGVFcnJvclxuZXhwb3J0cy5Xb3JrZXJFcnJvciA9IFdvcmtlckVycm9yXG5leHBvcnRzLkVSUl9EUllfUE9PTCA9ICdEUllfUE9PTCciXX0=