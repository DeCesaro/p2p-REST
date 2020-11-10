import dgram from 'dgram';

import { sendMessage } from './network';

const { argv } = require('yargs');

const server = dgram.createSocket('udp4');
const serverPort = argv.port || 7000;

const registeredClients = [];

// Adds the new client and its resource list to the list
// of registered clients and sends a confirmation to the client.
const registerNewClient = (message, clientInfo) => {
  const { address, port } = clientInfo;

  const resources = message.payload.map((file) => {
    return {
      fileName: file.file,
      hash: file.hash,
      size: file.size,
      address,
      port
    };
  });

  const newClient = {
    address,
    port,
    lastRefresh: new Date(),
    resources
  };
  registeredClients.push(newClient);

  const response = {
    type: 'REGISTER_RESPONSE'
  };

  sendMessage(server, response, port, address, () => {
    console.log(`Registered a new client at ${address}:${port}`);
  });
};

// Removes a client from the list.
const removeClient = (client) => {
  const clientIndex = registeredClients.indexOf(client);
  registeredClients.splice(clientIndex, 1);
  console.log(`Removed "${client.address}:${client.port}" due to inactivity.`);
};

// Checks for inactive clients every X seconds.fail
// If a client is inactive, it is removed from the list.
const checkConnectedClients = (seconds) => {
  setInterval(() => {
    const now = new Date();
    registeredClients.forEach((client) => {
      const timeSinceLastRefresh =
        (now.getTime() - client.lastRefresh.getTime()) / 1000;
      if (Math.floor(timeSinceLastRefresh) > 10) {
        removeClient(client);
      }
    });
  }, seconds * 1000);
};

// Get all resources that have a different ip address or port.
const filterResourcesFromClient = (address, port) => {
  const resources = [];
  registeredClients.forEach((client) => {
    if (client.address !== address || client.port !== port) {
      resources.push(...client.resources);
    }
  });
  return resources;
};

// Sends the current resource list to the client.
const sendResourceList = (clientInfo) => {
  const { address, port } = clientInfo;
  const filteredResources = filterResourcesFromClient(address, port);

  const resourceList = filteredResources.map((resource) => {
    return {
      fileName: resource.fileName,
      size: resource.size,
      hash: resource.hash
    };
  });

  const msg = {
    type: 'FETCH_RESOURCES_RESPONSE',
    payload: resourceList
  };

  sendMessage(server, msg, port, address, () => {
    console.log(`Resource list sent to ${address}:${port}.`);
  });
};

// Sends the information about a resource to a client.
const sendResourceInfo = (message, clientInfo) => {
  const { address, port } = clientInfo;
  const requestedFile = message.payload;
  const filteredResources = filterResourcesFromClient(address, port);

  const file = filteredResources.find((resource) => {
    return (
      resource.fileName === requestedFile.fileName &&
      resource.hash === requestedFile.hash
    );
  });

  const msg = {
    type: 'RESOURCE_REQUEST_RESPONSE',
    payload: file
  };
  sendMessage(server, msg, port, address, () =>
    console.log(`Sending info for "${file.fileName}" to ${address}:${port}.`)
  );
};

// Resets the client inactivity timer.
const refreshClient = (message, clientInfo) => {
  const { address, port } = clientInfo;

  registeredClients.forEach((client, index) => {
    if (client.address === address && client.port === port) {
      registeredClients[index].lastRefresh = new Date();
      const msg = {
        type: 'REFRESH_RESPONSE'
      };
      sendMessage(server, msg, port, address);
    }
  });
};

const types = {
  REGISTER: registerNewClient,
  REFRESH: refreshClient,
  FETCH_RESOURCES: sendResourceList,
  RESOURCE_REQUEST: sendResourceInfo
};

const handleMessageReceived = (msg, clientInfo) => {
  const message = JSON.parse(msg);
  if (types[message.type]) types[message.type](message, clientInfo);
};

server.on('error', (err) => {
  console.error(err);
});

server.on('message', (msg, info) => handleMessageReceived(msg, info));

server.on('listening', () => {
  const address = server.address();
  checkConnectedClients(5);
  console.log(`Server listening on ${address.address}:${address.port}`);
});

server.bind(serverPort);
