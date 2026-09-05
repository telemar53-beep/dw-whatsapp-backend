const { Server } = require('socket.io');
const { verifyToken } = require('../auth/auth.service');
const { getAllowedOrigins } = require('../config/cors-origins');

let io;

function initSocketServer(httpServer) {
  io = new Server(httpServer, { cors: { origin: getAllowedOrigins() } });
  io.use((socket, next) => {
    try {
      const payload = verifyToken(socket.handshake.auth && socket.handshake.auth.token);
      socket.agent = payload;
      next();
    } catch (err) {
      next(new Error('Unauthorized'));
    }
  });
  io.on('connection', (socket) => {
    socket.join(`agent:${socket.agent.agentId}`);
  });
  return io;
}

function getSocketServer() {
  if (!io) {
    throw new Error('Socket server not initialized');
  }
  return io;
}

function emitToAgent(agentId, event, payload) {
  if (!io) return;
  io.to(`agent:${agentId}`).emit(event, payload);
}

function broadcast(event, payload) {
  if (!io) return;
  io.emit(event, payload);
}

function closeSocketServer() {
  if (io) {
    const closing = io.close();
    io = undefined;
    return closing;
  }
  return Promise.resolve();
}

module.exports = { initSocketServer, getSocketServer, emitToAgent, broadcast, closeSocketServer };
