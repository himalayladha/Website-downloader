var wget = require('../wget');
var archiver = require('../archiver');

let activeConnections = 0;
let hasConnected = false;
let shutdownTimeout = null;

module.exports = (io) => {
  io.on('connection', function (socket) {
    activeConnections++;
    hasConnected = true;
    
    // Clear shutdown timeout if a new tab is opened or reloaded
    if (shutdownTimeout) {
      clearTimeout(shutdownTimeout);
      shutdownTimeout = null;
      console.log("Active connection restored. Auto-shutdown cancelled.");
    }
    
    console.log("New tab connected. Active connections:", activeConnections);

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
      activeConnections--;
      console.log("Tab disconnected. Active connections:", activeConnections);
      
      // Stop the wget process and remove partially downloaded files
      if (socket.wgetProcess) {
        socket.wgetProcess.kill();
      }
      // Stop the archiving process if the user disconnects
      if (socket.archiverProcess) {
        socket.archiverProcess.abort();
      }

      // If all tabs are closed, auto-shutdown after 5 seconds grace period
      if (hasConnected && activeConnections <= 0) {
        console.log("All tabs closed. Initiating auto-shutdown in 5 seconds...");
        shutdownTimeout = setTimeout(() => {
          console.log("No active connection. Shutting down server...");
          process.exit(0);
        }, 5000);
      }
    });
  });
};
