const http = require('http');
const jwt = require('jsonwebtoken');
const { io: ioClient } = require('socket.io-client');
const { initSocketServer, emitToAgent, broadcast, closeSocketServer } = require('./socket-server');

describe('socket server', () => {
  let httpServer;
  let port;

  beforeEach((done) => {
    httpServer = http.createServer();
    initSocketServer(httpServer);
    httpServer.listen(0, () => {
      port = httpServer.address().port;
      done();
    });
  });

  afterEach(() => {
    return closeSocketServer().then(() => {
      return new Promise((resolve) => httpServer.close(resolve));
    });
  });

  function connect(token) {
    return ioClient(`http://localhost:${port}`, {
      auth: { token },
      reconnection: false,
      forceNew: true,
      transports: ['websocket'],
    });
  }

  test('rejects a connection without a valid token', (done) => {
    const client = connect('invalid-token');
    client.on('connect_error', (err) => {
      expect(err.message).toBe('Unauthorized');
      client.close();
      done();
    });
  });

  test('emitToAgent only delivers to the connection in that agent room', (done) => {
    const tokenA = jwt.sign({ agentId: 'agent-a', role: 'agent' }, process.env.JWT_SECRET);
    const tokenB = jwt.sign({ agentId: 'agent-b', role: 'agent' }, process.env.JWT_SECRET);
    const clientA = connect(tokenA);
    const clientB = connect(tokenB);
    let connectedCount = 0;

    function onBothConnected() {
      connectedCount += 1;
      if (connectedCount !== 2) return;
      const receivedByB = jest.fn();
      clientB.on('greeting', receivedByB);
      clientA.on('greeting', (payload) => {
        expect(payload).toEqual({ hello: 'a' });
        expect(receivedByB).not.toHaveBeenCalled();
        clientA.close();
        clientB.close();
        done();
      });
      emitToAgent('agent-a', 'greeting', { hello: 'a' });
    }

    clientA.on('connect', onBothConnected);
    clientB.on('connect', onBothConnected);
  });

  test('broadcast delivers to every connected client', (done) => {
    const token = jwt.sign({ agentId: 'agent-c', role: 'agent' }, process.env.JWT_SECRET);
    const client = connect(token);
    client.on('connect', () => {
      client.on('announcement', (payload) => {
        expect(payload).toEqual({ text: 'hi' });
        client.close();
        done();
      });
      broadcast('announcement', { text: 'hi' });
    });
  });
});

describe('socket server module-level guards', () => {
  test('emitToAgent and broadcast are no-ops before the server is initialized', () => {
    // Ensure no server is initialized, regardless of test execution order.
    return closeSocketServer().then(() => {
      expect(() => emitToAgent('agent-x', 'some-event', {})).not.toThrow();
      expect(() => broadcast('some-event', {})).not.toThrow();
    });
  });
});
