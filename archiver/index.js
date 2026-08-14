var archiver = require('archiver');
var fs = require('fs');

module.exports = (file, io, data) => {
  if (!fs.existsSync('./public/sites')) {
    fs.mkdirSync('./public/sites', { recursive: true });
  }

  var zipPath = "./public/sites/" + file + '.zip';
  var output = fs.createWriteStream(zipPath);
  var archive = archiver('zip', {
    zlib: { level: 9 }
  });

  output.on('close', function() {
    console.log(archive.pointer() + ' total bytes written to ' + zipPath);
    io.emit(data.token, { progress: "Completed", file: file });
  });

  archive.on('warning', function(err) {
    if (err.code === 'ENOENT') {
      console.warn("Archiver warning:", err);
    } else {
      throw err;
    }
  });

  archive.on('error', function(err) {
    console.error("Archiver error:", err);
    io.emit(data.token, { progress: `Archiving error: ${err.message}` });
  });

  archive.pipe(output);

  var sourceDir = './' + file;
  if (fs.existsSync(sourceDir)) {
    archive.directory(sourceDir, false);
  }

  archive.finalize();
};

