const express = require('express');
const createServer = require('./createServer.js');

const baseUrl = process.env.UNPKG_BASE_URL || '/';

const server = createServer();
const serverWithBaseUrl = express();
serverWithBaseUrl.use(baseUrl, server);

const port = process.env.PORT || '8080';

serverWithBaseUrl.listen(port, () => {
  console.log('Server listening on port %s, Ctrl+C to quit', port);
});
