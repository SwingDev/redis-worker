var ErrorHandler, SError, WorkerError, createError, errCodes,
  __hasProp = {}.hasOwnProperty,
  __extends = function(child, parent) { for (var key in parent) { if (__hasProp.call(parent, key)) child[key] = parent[key]; } function ctor() { this.constructor = child; } ctor.prototype = parent.prototype; child.prototype = new ctor(); child.__super__ = parent.prototype; return child; };

ErrorHandler = require.main.require('error-handler');

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

//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbImxpYi9lcnJvcnMuY29mZmVlIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiJBQUFBLElBQUEsd0RBQUE7RUFBQTtpU0FBQTs7QUFBQSxZQUFBLEdBQWdCLE9BQU8sQ0FBQyxJQUFJLENBQUMsT0FBYixDQUFxQixlQUFyQixDQUFoQixDQUFBOztBQUFBLE1BQ0EsR0FBZ0IsWUFBWSxDQUFDLE1BRDdCLENBQUE7O0FBQUEsUUFHQSxHQUFXLENBQUMsaUJBQUQsRUFBb0IsY0FBcEIsRUFBb0MsU0FBcEMsRUFBK0MsUUFBL0MsRUFBeUQsU0FBekQsQ0FIWCxDQUFBOztBQUFBLFdBS0EsR0FBYyxTQUFDLEdBQUQsRUFBTSxPQUFOLEdBQUE7QUFDWixFQUFBLElBQUEsQ0FBQSxHQUFBO0FBQUEsV0FBTyxJQUFQLENBQUE7R0FBQTtBQUVBLEVBQUEsSUFBRyxPQUFIO0FBQ0UsWUFBTyxPQUFQO0FBQUEsV0FDTyxpQkFEUDtBQUVJLGVBQVcsSUFBQSxXQUFBLENBQVksMEJBQVosRUFBd0MsR0FBeEMsQ0FBWCxDQUZKO0FBQUEsV0FHTyxjQUhQO0FBSUksZUFBVyxJQUFBLFdBQUEsQ0FBWSx1QkFBWixFQUFxQyxHQUFyQyxDQUFYLENBSko7QUFBQSxXQUtPLFFBTFA7QUFNSSxlQUFXLElBQUEsV0FBQSxDQUFZLHFDQUFaLEVBQW1ELEdBQW5ELENBQVgsQ0FOSjtBQUFBLFdBT08sU0FQUDtBQVFJLGVBQVcsSUFBQSxXQUFBLENBQVksNkNBQVosRUFBMkQsR0FBM0QsQ0FBWCxDQVJKO0FBQUEsV0FTTyxTQVRQO0FBVUksZUFBVyxJQUFBLFdBQUEsQ0FBWSxvQ0FBWixFQUFrRCxHQUFsRCxDQUFYLENBVko7QUFBQTtBQVlJLGVBQVcsSUFBQSxXQUFBLENBQVksSUFBWixFQUFrQixHQUFsQixDQUFYLENBWko7QUFBQSxLQURGO0dBQUEsTUFBQTtBQWVFLFdBQVcsSUFBQSxXQUFBLENBQVksSUFBWixFQUFrQixHQUFsQixDQUFYLENBZkY7R0FIWTtBQUFBLENBTGQsQ0FBQTs7QUEwQkE7QUFBQSxLQTFCQTs7QUFBQTtBQThCRSxnQ0FBQSxDQUFBOzs7O0dBQUE7O0FBQUEsd0JBQUEsSUFBQSxHQUFNLGFBQU4sQ0FBQTs7cUJBQUE7O0dBRndCLE9BNUIxQixDQUFBOztBQWlDQTtBQUFBLEtBakNBOztBQUFBLE9BbUNPLENBQUMsV0FBUixHQUFzQixXQW5DdEIsQ0FBQTs7QUFBQSxPQW9DTyxDQUFDLFdBQVIsR0FBc0IsV0FwQ3RCLENBQUE7O0FBQUEsT0FxQ08sQ0FBQyxZQUFSLEdBQXVCLFVBckN2QixDQUFBIiwiZmlsZSI6ImxpYi9lcnJvcnMuanMiLCJzb3VyY2VSb290IjoiL3NvdXJjZS8iLCJzb3VyY2VzQ29udGVudCI6WyJFcnJvckhhbmRsZXIgID0gcmVxdWlyZS5tYWluLnJlcXVpcmUoJ2Vycm9yLWhhbmRsZXInKVxuU0Vycm9yICAgICAgICA9IEVycm9ySGFuZGxlci5TRXJyb3JcblxuZXJyQ29kZXMgPSBbJ0NIQU5ORUxOT1RGT1VORCcsICdMSVNUTk9URk9VTkQnLCAnUlVOVEFTSycsICdQT1BKT0InLCAnUFVTSEpPQiddXG5cbmNyZWF0ZUVycm9yID0gKGVyciwgZXJyQ29kZSkgLT5cbiAgcmV0dXJuIG51bGwgdW5sZXNzIGVyclxuXG4gIGlmIGVyckNvZGVcbiAgICBzd2l0Y2ggZXJyQ29kZVxuICAgICAgd2hlbiAnQ0hBTk5FTE5PVEZPVU5EJ1xuICAgICAgICByZXR1cm4gbmV3IFdvcmtlckVycm9yKCdDbGllbnQgY2hhbm5lbCBub3QgZm91bmQnLCBlcnIpXG4gICAgICB3aGVuICdMSVNUTk9URk9VTkQnXG4gICAgICAgIHJldHVybiBuZXcgV29ya2VyRXJyb3IoJ0NsaWVudCBsaXN0IG5vdCBmb3VuZCcsIGVycilcbiAgICAgIHdoZW4gJ1BPUEpPQidcbiAgICAgICAgcmV0dXJuIG5ldyBXb3JrZXJFcnJvcignUG9wIGpvYiBmcm9tIHF1ZXVlIHdhcyB1bnN1Y2Nlc3NmdWwnLCBlcnIpXG4gICAgICB3aGVuICdSVU5UQVNLJ1xuICAgICAgICByZXR1cm4gbmV3IFdvcmtlckVycm9yKCdFeGVjdXRpbmcgdGFzayBmcm9tIHF1ZXVlIHdhcyB1bnN1Y2Nlc3NmdWwgJywgZXJyKVxuICAgICAgd2hlbiAnUFVTSEpPQidcbiAgICAgICAgcmV0dXJuIG5ldyBXb3JrZXJFcnJvcignUHVzaCBqb2IgdG8gcXVldWUgd2FzIHVuc3VjY2Vzc2Z1bCcsIGVycilcbiAgICAgIGVsc2VcbiAgICAgICAgcmV0dXJuIG5ldyBXb3JrZXJFcnJvcihudWxsLCBlcnIpXG4gIGVsc2VcbiAgICByZXR1cm4gbmV3IFdvcmtlckVycm9yKG51bGwsIGVycilcblxuXG4jIyMgIyMjXG4jIFdvcmtlckVycm9yIC0gV29ya2VyIGVycm9yJ3NcbmNsYXNzIFdvcmtlckVycm9yIGV4dGVuZHMgU0Vycm9yXG5cbiAgbmFtZTogJ1dvcmtlckVycm9yJ1xuXG5cbiMjIyAjIyNcbiMgRVhQT1JUU1xuZXhwb3J0cy5jcmVhdGVFcnJvciA9IGNyZWF0ZUVycm9yXG5leHBvcnRzLldvcmtlckVycm9yID0gV29ya2VyRXJyb3JcbmV4cG9ydHMuRVJSX0RSWV9QT09MID0gJ0RSWV9QT09MJyJdfQ==