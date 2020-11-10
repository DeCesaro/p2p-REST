import dgram from 'dgram';
import { createInterface } from 'readline';

import { sendMessage, sendFile } from './network';
import { calculateHash, getFile, createFile } from './fileReader';
import EventHandler from './EventHandler';

const { argv } = require('yargs');

const client = dgram.createSocket('udp4');

const server = {
  registered: false,
  refreshTries: 0,
  address: argv.address || 'localhost',
  port: argv.port || 7000,
  resources: []
};

const requestFile = {
  name: null,
  hash: null,
  address: null,
  port: null,
  data: []
};

const readLine = createInterface({
  input: process.stdin,
  output: process.stdout,
  prompt: 'CLIENT> '
});

const togglePrompt = (message) => {
  if (message) console.log(message);
  readLine.prompt();
};

const handleRegisterResponse = () => {
  server.registered = true;
  togglePrompt(
    'Successfully registered to server.\nType /help to see the command list.'
  );
  handleRefresh(5);
};

const handleRefreshResponse = () => {
  server.refreshTries = 0;
};

// Saves the resource list sent by the server and displays it to the user.
const handleFetchResourcesResponse = (message) => {
  server.resources = message.payload;
  console.log(`\nReceived ${server.resources.length} items:`);
  const resources = server.resources.map((resource) => {
    const size = `${(resource.size / 1000).toString()}KB`;
    return {
      filename: resource.fileName,
      size
    };
  });
  if (resources.length > 0) console.table(resources);
  console.log('');
  togglePrompt();
};

// Saves the file information and sends a message to the owner of the file
// asking for a file transfer.
const handleResourceRequest = (message) => {
  const { fileName, hash, address, port } = message.payload;
  requestFile.name = fileName;
  requestFile.hash = hash;
  requestFile.address = address;
  requestFile.port = port;
  requestFile.data = [];
  const msg = {
    type: 'FILE_REQUEST',
    payload: { fileName, hash }
  };

  sendMessage(client, msg, port, address, () =>
    console.log(`Request sent to ${address}:${port}`)
  );
};

// Sends the requested file to the peer who requested it.
const handleFileRequest = async (message, info) => {
  const { fileName, hash } = message.payload;
  const { address, port } = info;
  sendFile(client, fileName, port, address);
  togglePrompt(`\nSending ${fileName} to ${address}:${port}.`);
};

// Saves the file section received and sends a confirmation message
// to the other peer.
const handleFileSection = async (message, info) => {
  const { offset, total, data } = message.payload;
  const { address, port } = info;
  const dataBuffer = Buffer.from(data, 'base64');

  requestFile.data.push(dataBuffer);

  const msg = {
    type: 'FILE_SECTION_RECEIVED',
    payload: offset
  };

  sendMessage(client, msg, port, address);
  if (offset === total - 1) {
    const fileData = Buffer.concat(requestFile.data);
    const sameFile = await createFile(
      requestFile.name,
      fileData,
      requestFile.hash
    );

    const same = sameFile
      ? '\nDownload successfull.'
      : '\nDownloaded file has different hash.';
    togglePrompt(same);
  }
};

// Emits a 'received' event to the EventHandler, so that
// the file transfer can continue.
const handleFileSectionReceived = (message, info) => {
  const offset = message.payload;
  EventHandler.emit('received', offset);
};

// Types of messages a client can receive.
const types = {
  REGISTER_RESPONSE: handleRegisterResponse,
  REFRESH_RESPONSE: handleRefreshResponse,
  FETCH_RESOURCES_RESPONSE: handleFetchResourcesResponse,
  RESOURCE_REQUEST_RESPONSE: handleResourceRequest,
  FILE_REQUEST: handleFileRequest,
  FILE_SECTION: handleFileSection,
  FILE_SECTION_RECEIVED: handleFileSectionReceived
};

// Calls the function represented by the message's type attribute.
const handleMessageReceived = (msg, info) => {
  const message = JSON.parse(msg);
  if (types[message.type]) types[message.type](message, info);
};

// Sends a list with the file names, hashes and sizes to the server.
const sendFileList = async () => {
  try {
    const files = await calculateHash();

    const message = {
      type: 'REGISTER',
      payload: files
    };

    sendMessage(client, message, server.port, server.address, () =>
      console.log('Waiting for server response.')
    );

    let connectionTries = 1;
    const interval = setInterval(() => {
      if (!server.registered) {
        if (connectionTries < 3) {
          sendMessage(client, message, server.port, server.address, () =>
            console.log(
              `\nThe server did not respond (${
                connectionTries - 1
              }). Trying again...`
            )
          );
          connectionTries += 1;
        } else {
          console.log(
            `\nCouldn't connect to the server after 3 tries. Exiting...`
          );
          process.exit();
        }
      } else clearInterval(interval);
    }, 10000);
  } catch (error) {
    process.exit();
  }
};

client.on('message', (msg, info) => handleMessageReceived(msg, info));

// Asks for the resource list from the server.
const fetchResourceList = () => {
  const message = {
    type: 'FETCH_RESOURCES'
  };
  sendMessage(client, message, server.port, server.address, () =>
    console.log('Fetching resource list.')
  );
};

// Asks for the information about the owner of a file.
const requestResourceAddress = (args) => {
  if (!args[1]) return togglePrompt('No file name informed.');
  const fileName = args[1];
  const file = server.resources.find(
    (resource) => resource.fileName === fileName
  );

  if (!file) return togglePrompt('File not found.');
  const message = {
    type: 'RESOURCE_REQUEST',
    payload: file
  };
  return sendMessage(client, message, server.port, server.address, () =>
    console.log(`Requesting info for "${file.fileName}" from the server.`)
  );
};

// Sends a REFRESH message to the server every X seconds.
const handleRefresh = (seconds) => {
  const message = {
    type: 'REFRESH'
  };
  setInterval(() => {
    sendMessage(client, message, server.port, server.address);
    server.refreshTries += 1;
  }, seconds * 1000);
};

// Prints the command list.
const handleHelp = () => {
  console.log(
    '\nCommand list [ /<command> (<shortcut>) <arguments> ]:',
    ' \n  /help (/h): \n    Show command list',
    ' \n  /resources (/r): \n    Request resouce list from the server',
    ' \n  /download (/d) <filename>: \n    Download a file from the resource list.',
    ' \n'
  );
  togglePrompt();
};

// Available commands.
const commands = {
  HELP: handleHelp,
  H: handleHelp,

  RESOURCES: fetchResourceList,
  R: fetchResourceList,

  DOWNLOAD: requestResourceAddress,
  D: requestResourceAddress
};

// Handle user input
const handleCommand = (input) => {
  if (input.startsWith('/')) {
    const parsedInput = input.split(' ');
    parsedInput[0] = parsedInput[0].replace('/', '').trim().toUpperCase();
    if (commands[parsedInput[0]]) return commands[parsedInput[0]](parsedInput);
    togglePrompt(`"${parsedInput[0]}" is not a command.`);
  }
};

readLine.on('line', (input) => {
  handleCommand(input);
});

sendFileList();
