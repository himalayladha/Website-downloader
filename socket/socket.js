var wget = require('../wget');
var archiver = require('../archiver');

module.exports = (io) => {
  io.on('connection', function (socket) {
    socket.on('request', function (data) {
      console.log("Request connection received %s", data.token);
      data.userAgent = socket.handshake.headers['user-agent'];
      wget(io, data);
    });

    socket.on('cancel', function (data) {
      if (data.token) {
        global.cancelFlags = global.cancelFlags || {};
        global.cancelFlags[data.token] = true;
        console.log("Cancellation request received for token %s", data.token);
      }
    });

    socket.on('disconnect', function () {
      console.log("User disconnected");
      // Stop the wget process and remove partially downloaded files
      if (socket.wgetProcess) {
        socket.wgetProcess.kill();
        // Add code to remove partially downloaded files
      }
      // Stop the archiving process if the user disconnects
      if (socket.archiverProcess) {
        socket.archiverProcess.abort();
      }
    });
  });
};
