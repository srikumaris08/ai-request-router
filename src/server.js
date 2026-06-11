/**
 * @file server.js  (src/)
 * @description Express application bootstrap.
 *
 * Startup sequence (order is important):
 *  1. Load environment variables (.env)
 *  2. Connect to MongoDB — abort if it fails
 *  3. Mount Express middleware (security, logging, body parsers, CORS)
 *  4. Mount API routes
 *  5. Mount the central error handler (MUST be last)
 *  6. Start the HTTP server
 *  7. Start the BullMQ worker in the same process
 *     (move to a separate process / container for true horizontal scaling)
 */

// ── 1. Environment variables ─────────────────────────────────────────────────
import 'dotenv/config';

import express        from 'express';
import cors           from 'cors';
import helmet         from 'helmet';
import morgan         from 'morgan';
import { connectDB }  from './config/db.js';
import errorHandler   from './middlewares/errorHandler.middleware.js';
import { startRequestWorker } from './jobs/requestWorker.js';
import { sendSuccess } from './utils/apiResponse.js';

// ── App factory ──────────────────────────────────────────────────────────────
const app  = express();
const PORT = process.env.PORT || 5000;

// ── 2. Security headers ──────────────────────────────────────────────────────
app.use(helmet());

// ── 3. CORS ──────────────────────────────────────────────────────────────────
const allowedOrigins = (process.env.CORS_ORIGINS ?? 'http://localhost:3000')
  .split(',')
  .map((o) => o.trim());

app.use(
  cors({
    origin: (origin, callback) => {
      // Allow requests with no origin (e.g. mobile apps, curl, Postman)
      if (!origin || allowedOrigins.includes(origin)) return callback(null, true);
      callback(new Error(`CORS: Origin '${origin}' is not allowed`));
    },
    credentials: true,
  })
);

// ── 4. HTTP request logger ────────────────────────────────────────────────────
// 'dev' format in development, 'combined' (Apache-style) in production
app.use(morgan(process.env.NODE_ENV === 'production' ? 'combined' : 'dev'));

// ── 5. Body parsers ───────────────────────────────────────────────────────────
app.use(express.json({ limit: '1mb' }));         // parse application/json
app.use(express.urlencoded({ extended: true, limit: '1mb' })); // parse form data

// ── 6. Health check (no auth required) ───────────────────────────────────────
app.get('/health', (_req, res) =>
  sendSuccess(res, 200, 'Service is healthy', {
    uptime:    process.uptime(),
    timestamp: new Date().toISOString(),
    env:       process.env.NODE_ENV,
  })
);

// ── 7. API Routes ─────────────────────────────────────────────────────────────
/**
 * Routes are intentionally commented out until their respective router files
 * are created in Sprint 3. Uncomment each line as you build the routers.
 *
 * import authRoutes            from './routes/auth.routes.js';
 * import customerRequestRoutes from './routes/customerRequest.routes.js';
 * import internalNoteRoutes    from './routes/internalNote.routes.js';
 *
 * app.use('/api/v1/auth',             authRoutes);
 * app.use('/api/v1/requests',         customerRequestRoutes);
 * app.use('/api/v1/requests',         internalNoteRoutes);
 */

// ── 8. 404 handler ────────────────────────────────────────────────────────────
app.use((_req, res) => {
  res.status(404).json({
    success: false,
    message: 'Route not found',
    data:    null,
    error:   null,
  });
});

// ── 9. Central error handler (MUST be last) ───────────────────────────────────
app.use(errorHandler);

// ── Boot sequence ─────────────────────────────────────────────────────────────
const boot = async () => {
  try {
    // Connect to MongoDB first — nothing runs without a DB
    await connectDB();

    // Start HTTP server
    const server = app.listen(PORT, () => {
      console.info(`[Server] Running on port ${PORT} in ${process.env.NODE_ENV} mode`);
    });

    // Start the BullMQ worker in this same process.
    // For production horizontal scaling, move this to a dedicated worker process
    // by running:  RUN_WORKER_STANDALONE=true node src/jobs/requestWorker.js
    startRequestWorker();

    // ── Graceful HTTP shutdown ────────────────────────────────────────────
    const shutdown = (signal) => {
      console.info(`[Server] ${signal} received — shutting down gracefully`);
      server.close(async () => {
        console.info('[Server] HTTP server closed.');
        // DB + Redis connections have their own SIGINT/SIGTERM listeners
        // registered in db.js and redis.js respectively.
      });
    };

    process.on('SIGINT',  () => shutdown('SIGINT'));
    process.on('SIGTERM', () => shutdown('SIGTERM'));

    // Handle unhandled promise rejections at the process level
    process.on('unhandledRejection', (reason) => {
      console.error('[Process] Unhandled rejection:', reason);
      // In production you may want to exit and let a process manager restart
      // process.exit(1);
    });

  } catch (err) {
    console.error('[Server] Failed to start:', err.message);
    process.exit(1);
  }
};

boot();

export default app; // exported for integration tests (supertest etc.)
