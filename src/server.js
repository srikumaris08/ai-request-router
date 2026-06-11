/**
 * @file server.js  (src/)
 * @description Express + Socket.io bootstrap.
 *
 * Boot order:
 *  1. Load .env
 *  2. Connect MongoDB
 *  3. Build Express app (middleware stack)
 *  4. Create raw http.Server so Socket.io can share the port
 *  5. Init Socket.io
 *  6. Mount API routes
 *  7. Mount central error handler (last)
 *  8. Start listening
 *  9. Start BullMQ worker
 */
import 'dotenv/config';
import http           from 'http';
import express        from 'express';
import cors           from 'cors';
import helmet         from 'helmet';
import morgan         from 'morgan';

import { connectDB }           from './config/db.js';
import { initSocket }          from './config/socket.js';
import errorHandler            from './middlewares/errorHandler.middleware.js';
import apiRoutes               from './routes/index.js';
import { startRequestWorker }  from './jobs/requestWorker.js';
import { sendSuccess }         from './utils/apiResponse.js';

// ── Express app ───────────────────────────────────────────────────────────────
const app  = express();
const PORT = process.env.PORT || 5000;

const allowedOrigins = (process.env.CORS_ORIGINS ?? 'http://localhost:3000')
  .split(',').map((o) => o.trim());

app.use(helmet());
app.use(cors({ origin: allowedOrigins, credentials: true }));
app.use(morgan(process.env.NODE_ENV === 'production' ? 'combined' : 'dev'));
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));

// ── Health check ──────────────────────────────────────────────────────────────
app.get('/health', (_req, res) =>
  sendSuccess(res, 200, 'Service is healthy.', {
    uptime:    process.uptime(),
    timestamp: new Date().toISOString(),
    env:       process.env.NODE_ENV,
  })
);

// ── API routes ────────────────────────────────────────────────────────────────
app.use('/api/v1', apiRoutes);

// ── 404 ───────────────────────────────────────────────────────────────────────
app.use((_req, res) =>
  res.status(404).json({ success: false, message: 'Route not found', data: null, error: null })
);

// ── Central error handler (must be last) ─────────────────────────────────────
app.use(errorHandler);

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

export default app; // for supertest / integration tests
