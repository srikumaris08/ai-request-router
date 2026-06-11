/**
 * @file app.js  (src/)
 * @description Pure Express application factory — no I/O, no listeners.
 *
 * Separated from server.js so integration tests can import the configured
 * app without triggering any database / Redis / BullMQ connections.
 *
 * server.js is the process entry-point; it imports this file, calls connectDB,
 * wraps the app in http.createServer, and starts the BullMQ worker.
 */
import express      from 'express';
import cors         from 'cors';
import helmet       from 'helmet';
import morgan       from 'morgan';

import errorHandler from './middlewares/errorHandler.middleware.js';
import apiRoutes    from './routes/index.js';
import { sendSuccess } from './utils/apiResponse.js';

const app = express();

const allowedOrigins = (process.env.CORS_ORIGINS ?? 'http://localhost:3000')
  .split(',').map((o) => o.trim());

// ── Middleware stack ───────────────────────────────────────────────────────────
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

export default app;
