import fs from 'fs';
import path from 'path';

import EventHandler from './EventHandler';

const { argv } = require('yargs');

const sendMessage = (socket, msg, port, address, callback) => {
  const data = Buffer.from(JSON.stringify(msg));
  socket.send(data, port, address, (error) => {
    if (error) {
      console.log(error);
      console.log('Error sending data.');
      socket.close();
    } else if (callback) callback();
  });
};

// Sends the file to the specified peer.
// The file is fragmented in parts of 44KB.
// Each fragment is sent only after the peer receives the previous one.
const sendFile = (socket, filename, port, address) => {
  const rootFolder = process.cwd();
  const filesPath = path.resolve(rootFolder, argv.files);

  const filePath = path.resolve(filesPath, filename);
  const stats = fs.statSync(filePath);
  const fileSizeInBytes = stats.size;

  const packetSize = 44 * 1024;

  const fileStream = fs.createReadStream(filePath, {
    highWaterMark: packetSize
  });

  const fileData = {
    count: 0,
    total: Math.ceil(fileSizeInBytes / packetSize),
    fileSizeInBytes
  };

  const currentStatus = {
    waiting: false
  };

  const sendCurrent = () => {
    sendMessage(socket, currentStatus.msg, port, address);
    currentStatus.waiting = true;
    setTimeout(() => {
      if (currentStatus.waiting) {
        console.log('sent again');
        sendMessage(socket, currentStatus.msg, port, address);
      }
    }, 10000);
  };

  fileStream.on('data', (data) => {
    const b64Data = data.toString('base64');
    const { count: offset, total } = fileData;
    const packet = {
      offset,
      total,
      data: b64Data
    };

    currentStatus.msg = {
      type: 'FILE_SECTION',
      payload: packet
    };
    sendCurrent();
    fileStream.pause();
  });

  EventHandler.on('received', (offset) => {
    if (offset === fileData.count) {
      // If the other client received the last part
      if (offset === fileData.total - 1) {
        currentStatus.waiting = false;
        console.log('abx');
        EventHandler.removeAllListeners();
        fileStream.close();
      } else {
        fileData.count += 1;
        currentStatus.waiting = false;
        fileStream.resume();
      }
    }
  });
};

module.exports = {
  sendMessage,
  sendFile
};
