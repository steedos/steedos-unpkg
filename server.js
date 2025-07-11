require('dotenv-flow').config({});

const createServer = require('./createServer.js');

const server = createServer();

const port = process.env.PORT || '8080';

server.listen(port, () => {
  console.log('Server listening on port %s, Ctrl+C to quit', port);
});
