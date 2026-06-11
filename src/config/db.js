/**
 * @file db.js  (src/config)
 * @description MongoDB connection factory using Mongoose.
 *
 * Responsibilities:
 *  - Single connection lifecycle for the process.
 *  - Retry logic with exponential back-off on initial connect.
 *  - Graceful shutdown on SIGINT / SIGTERM.
 */

import mongoose from 'mongoose';

const MAX_RETRIES    = 5;
const RETRY_DELAY_MS = 2000;

let retryCount = 0;

const mongoOptions = {
  serverSelectionTimeoutMS: 5000,  // fail fast if no primary is reachable
  socketTimeoutMS: 45000,
  maxPoolSize: 10,
};

/**
 * Connects to MongoDB. Retries up to MAX_RETRIES times before exiting.
 * @returns {Promise<void>}
 */
export const connectDB = async () => {
  const uri = process.env.MONGO_URI;
  if (!uri) throw new Error('MONGO_URI environment variable is not set');

  try {
    await mongoose.connect(uri, mongoOptions);
    console.info(`[MongoDB] Connected: ${mongoose.connection.host}`);
    retryCount = 0;
  } catch (err) {
    retryCount += 1;
    console.error(`[MongoDB] Connection attempt ${retryCount}/${MAX_RETRIES} failed: ${err.message}`);

    if (retryCount >= MAX_RETRIES) {
      console.error('[MongoDB] Max retries reached. Exiting.');
      process.exit(1);
    }

    const delay = RETRY_DELAY_MS * retryCount;
    console.info(`[MongoDB] Retrying in ${delay}ms…`);
    await new Promise((r) => setTimeout(r, delay));
    return connectDB();
  }
};

// ── Graceful shutdown ────────────────────────────────────────────────────────
const gracefulShutdown = async (signal) => {
  console.info(`[MongoDB] ${signal} received — closing connection`);
  await mongoose.connection.close();
  console.info('[MongoDB] Connection closed. Goodbye.');
  process.exit(0);
};

process.on('SIGINT',  () => gracefulShutdown('SIGINT'));
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));

// ── Connection event listeners ───────────────────────────────────────────────
mongoose.connection.on('disconnected', () =>
  console.warn('[MongoDB] Disconnected from database')
);
mongoose.connection.on('reconnected', () =>
  console.info('[MongoDB] Reconnected to database')
);
