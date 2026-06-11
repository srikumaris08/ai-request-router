/**
 * @file queues.js  (src/jobs)
 * @description Initializes and exports BullMQ Queue instances.
 *
 * Architecture notes:
 *  - A single IORedis connection (ioredis) is reused across all queues and
 *    workers to avoid unnecessary Redis connections.
 *  - Queue definitions are centralized here so every worker imports the same
 *    instance rather than creating duplicates.
 *  - `defaultJobOptions` match a real-world production posture:
 *      • 3 attempts with exponential back-off to survive transient AI API blips.
 *      • Completed jobs are kept for 1 hour (360 s × 10 kept) for debugging;
 *        failed jobs are kept for 24 hours.
 *      • removeOnComplete/removeOnFail accept count limits to cap Redis memory.
 */

import { Queue } from 'bullmq';
import { redisConnection } from '../config/redis.js';

// ── Queue name constants ──────────────────────────────────────────────────────
// Always reference these instead of bare strings so typos cause import errors.
export const QUEUE_NAMES = Object.freeze({
  REQUEST_PROCESSING: 'request-processing',
});

// ── Default job options ───────────────────────────────────────────────────────
const defaultJobOptions = {
  attempts: 3,
  backoff: {
    type: 'exponential',
    delay: 2000, // initial delay 2 s → 4 s → 8 s
  },
  removeOnComplete: { count: 100, age: 3600 },  // keep last 100 or 1 hour
  removeOnFail:     { count: 500, age: 86400 },  // keep last 500 or 24 hours
};

// ── Queue instances ───────────────────────────────────────────────────────────

/**
 * Primary queue for inbound customer request processing.
 * Producers add jobs here; the classification worker consumes them.
 *
 * Job payload shape (defined here for documentation):
 * {
 *   requestId: string,       // CustomerRequest._id (hex string)
 *   sourceChannel: string,   // e.g. 'email'
 *   originalMessage: string, // raw customer text (for quick access in worker)
 * }
 */
export const requestProcessingQueue = new Queue(QUEUE_NAMES.REQUEST_PROCESSING, {
  connection: redisConnection,
  defaultJobOptions,
});

// ── Graceful shutdown ─────────────────────────────────────────────────────────
// Close queue connections on process exit so Redis doesn't see stale clients.
const closeQueues = async () => {
  await requestProcessingQueue.close();
  console.info('[BullMQ] All queues closed.');
};

process.on('SIGINT',  closeQueues);
process.on('SIGTERM', closeQueues);
