/**
 * @file socket.js  (src/config)
 * @description Socket.io singleton — init once, import getIO/tryEmit anywhere.
 */
import { Server } from 'socket.io';

/** @type {import('socket.io').Server|null} */
let _io = null;

/**
 * Attach Socket.io to the raw HTTP server. Call once in server.js boot sequence.
 * @param {import('http').Server} httpServer
 * @returns {import('socket.io').Server}
 */
export const initSocket = (httpServer) => {
  const origins = (process.env.CORS_ORIGINS ?? 'http://localhost:3000')
    .split(',').map((o) => o.trim());

  _io = new Server(httpServer, {
    cors: { origin: origins, credentials: true },
    transports: ['websocket', 'polling'],
  });

  _io.on('connection', (socket) => {
    console.info(`[Socket.io] Connected: ${socket.id}`);

    // Clients can subscribe to a specific request room for targeted updates
    socket.on('subscribe:request', (requestId) => socket.join(`request:${requestId}`));
    socket.on('unsubscribe:request', (requestId) => socket.leave(`request:${requestId}`));
    socket.on('disconnect', (reason) =>
      console.debug(`[Socket.io] Disconnected: ${socket.id} (${reason})`)
    );
  });

  console.info('[Socket.io] Initialized');
  return _io;
};

/** Returns the Socket.io server instance. Throws if not yet initialized. */
export const getIO = () => {
  if (!_io) throw new Error('[Socket.io] Not initialized. Call initSocket(httpServer) first.');
  return _io;
};

/**
 * Fire-and-forget emit — safe to call from the worker process where
 * Socket.io may not be initialized (standalone mode).
 */
export const tryEmit = (event, data) => {
  try {
    getIO().emit(event, data);
  } catch {
    // Not initialized — standalone worker mode, silently skip
  }
};
