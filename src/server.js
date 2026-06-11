/**
 * @file server.js  (src/)
 * @description Process entry-point — boots the HTTP server, DB, and worker.
 *
 * Boot order:
 *  1. Load .env
 *  2. Connect MongoDB
 *  3. Wrap configured Express app (from app.js) in http.createServer
 *  4. Init Socket.io on the raw httpServer
 *  5. Start listening
 *  6. Start BullMQ worker
 *
 * The Express app configuration (middleware, routes, error handler) lives in
 * app.js so integration tests can import it without triggering any I/O.
 */
import 'dotenv/config';
import http from 'http';

import app                     from './app.js';
import { connectDB }           from './config/db.js';
import { initSocket }          from './config/socket.js';
import { startRequestWorker }  from './jobs/requestWorker.js';

const PORT = process.env.PORT || 5000;

// ── Boot ──────────────────────────────────────────────────────────────────────
const boot = async () => {
  try {
    await connectDB();

    // Wrap Express in a raw http.Server so Socket.io and Express share one port
    const httpServer = http.createServer(app);

    // Init Socket.io BEFORE listen so the upgrade handler is registered in time
    initSocket(httpServer);

    httpServer.listen(PORT, () => {
      console.info(`[Server] Listening on port ${PORT} (${process.env.NODE_ENV ?? 'development'})`);
      console.info(`[Server] WebSocket endpoint: ws://localhost:${PORT}`);
    });

    // Start BullMQ worker in same process
    // Scale-out: run separately with RUN_WORKER_STANDALONE=true
    startRequestWorker();

    // ── Graceful shutdown ───────────────────────────────────────────────────
    const shutdown = (signal) => {
      console.info(`[Server] ${signal} — shutting down gracefully`);
      httpServer.close(() => console.info('[Server] HTTP server closed.'));
    };
    process.on('SIGINT',  () => shutdown('SIGINT'));
    process.on('SIGTERM', () => shutdown('SIGTERM'));

    process.on('unhandledRejection', (reason) => {
      console.error('[Process] Unhandled rejection:', reason);
    });
  } catch (err) {
    console.error('[Server] Boot failed:', err.message);
    process.exit(1);
  }
};

boot();
