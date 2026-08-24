var wget = require('../wget');
var shopify = require('../wget/shopify');
var archiver = require('../archiver');

module.exports = (io) => {
  io.on('connection', function (socket) {
    socket.on('request', function (data) {
      console.log("Request connection received %s (type: %s)", data.token, data.downloaderType);
      data.userAgent = socket.handshake.headers['user-agent'];
      if (data.downloaderType === 'shopify') {
        shopify(io, data);
      } else {
        wget(io, data);
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
