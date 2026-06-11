/**
 * @file redis.js  (src/config)
 * @description Shared ioredis connection used by BullMQ queues and workers.
 *
 * Design notes:
 *  - BullMQ requires ioredis (not the default 'redis' package).
 *  - `maxRetriesPerRequest: null` is REQUIRED by BullMQ workers; without it
 *    the worker will throw "maxRetriesPerRequest must be null" on startup.
 *  - `enableReadyCheck: false` prevents ioredis from blocking until Redis
 *    responds to INFO — necessary inside BullMQ's internal connection logic.
 *  - A single export is shared across all queues and workers in this process
 *    to avoid multiplying Redis connections.
 */

import IORedis from 'ioredis';

const redisUrl = process.env.REDIS_URL || 'redis://127.0.0.1:6379';

export const redisConnection = new IORedis(redisUrl, {
  maxRetriesPerRequest: null,   // ← mandatory for BullMQ
  enableReadyCheck: false,       // ← mandatory for BullMQ workers
  lazyConnect: true,             // don't connect until first command
});

redisConnection.on('connect',   () => console.info('[Redis] Connected'));
redisConnection.on('error',     (err) => console.error('[Redis] Error:', err.message));
redisConnection.on('reconnecting', () => console.warn('[Redis] Reconnecting…'));

// Graceful shutdown — called after queue/worker close() finishes
export const closeRedis = async () => {
  await redisConnection.quit();
  console.info('[Redis] Connection closed.');
};
