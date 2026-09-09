const http = require('http');
const jwt = require('jsonwebtoken');
const { io: ioClient } = require('socket.io-client');
const { initSocketServer, emitToAgent, broadcast, broadcastToDashboard, closeSocketServer } = require('./socket-server');
const { resetPresence } = require('./presence');

describe('socket server', () => {
  let httpServer;
  let port;

  beforeEach((done) => {
    resetPresence();
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

  test('an admin socket joins the dashboard room and receives broadcastToDashboard events; a non-admin socket does not', (done) => {
    const adminToken = jwt.sign({ agentId: 'agent-admin-1', role: 'admin' }, process.env.JWT_SECRET);
    const agentToken = jwt.sign({ agentId: 'agent-plain-1', role: 'agent' }, process.env.JWT_SECRET);
    const adminClient = connect(adminToken);
    const agentClient = connect(agentToken);
    let connectedCount = 0;

    function onBothConnected() {
      connectedCount += 1;
      if (connectedCount !== 2) return;
      const receivedByAgent = jest.fn();
      agentClient.on('dashboard:conversation', receivedByAgent);
      adminClient.on('dashboard:conversation', (payload) => {
        expect(payload).toEqual({ hello: 'dashboard' });
        expect(receivedByAgent).not.toHaveBeenCalled();
        adminClient.close();
        agentClient.close();
        done();
      });
      broadcastToDashboard('dashboard:conversation', { hello: 'dashboard' });
    }

    adminClient.on('connect', onBothConnected);
    agentClient.on('connect', onBothConnected);
  });

  test('connecting broadcasts presence:online to already-connected clients', (done) => {
    const tokenA = jwt.sign({ agentId: 'agent-presence-a', role: 'agent' }, process.env.JWT_SECRET);
    const tokenB = jwt.sign({ agentId: 'agent-presence-b', role: 'agent' }, process.env.JWT_SECRET);
    const clientA = connect(tokenA);
    let clientB;
    clientA.on('connect', () => {
      clientA.on('presence:online', (payload) => {
        expect(payload).toEqual({ agentId: 'agent-presence-b' });
        clientA.close();
        clientB.close();
        done();
      });
      clientB = connect(tokenB);
    });
  });

  test('disconnecting broadcasts presence:offline once the last connection for that agent closes', (done) => {
    const tokenA = jwt.sign({ agentId: 'agent-presence-c', role: 'agent' }, process.env.JWT_SECRET);
    const tokenB = jwt.sign({ agentId: 'agent-presence-d', role: 'agent' }, process.env.JWT_SECRET);
    const clientA = connect(tokenA);
    const clientB = connect(tokenB);
    let connectedCount = 0;

    function onBothConnected() {
      connectedCount += 1;
      if (connectedCount !== 2) return;
      clientA.on('presence:offline', (payload) => {
        expect(payload).toEqual({ agentId: 'agent-presence-d' });
        clientA.close();
        done();
      });
      clientB.close();
    }

    clientA.on('connect', onBothConnected);
    clientB.on('connect', onBothConnected);
  });

  test('a second connection from the same agent does not trigger a duplicate presence:online', (done) => {
    const tokenA = jwt.sign({ agentId: 'agent-presence-e', role: 'agent' }, process.env.JWT_SECRET);
    const tokenSame = jwt.sign({ agentId: 'agent-presence-f', role: 'agent' }, process.env.JWT_SECRET);
    const clientA = connect(tokenA);
    clientA.on('connect', () => {
      const onlineEvents = [];
      clientA.on('presence:online', (payload) => onlineEvents.push(payload));
      const firstTab = connect(tokenSame);
      const firstTabOwnEvents = [];
      firstTab.on('presence:online', (payload) => firstTabOwnEvents.push(payload));
      firstTab.on('connect', () => {
        const secondTab = connect(tokenSame);
        secondTab.on('connect', () => {
          setTimeout(() => {
            expect(onlineEvents).toEqual([{ agentId: 'agent-presence-f' }]);
            expect(firstTabOwnEvents).toEqual([]);
            clientA.close();
            firstTab.close();
            secondTab.close();
            done();
          }, 100);
        });
      });
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

  test('broadcastToDashboard is a no-op before the server is initialized', () => {
    return closeSocketServer().then(() => {
      expect(() => broadcastToDashboard('some-event', {})).not.toThrow();
    });
  });
});
