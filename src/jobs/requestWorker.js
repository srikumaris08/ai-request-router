/**
 * @file requestWorker.js  (src/jobs)
 * @description BullMQ Worker that consumes jobs from the 'request-processing' queue.
 *
 * Lifecycle for each job:
 *  1. Mark CustomerRequest.status → 'processing'  (with DB-level optimistic lock)
 *  2. Append a 'status_changed' event to RequestEvent collection
 *  3. [PLACEHOLDER] Execute AI classification logic
 *  4. On success  → status transitions to 'completed' (handled in classifier)
 *     On failure  → BullMQ retries per queue policy; exhausted → 'failed'
 *
 * Worker is started as a standalone process by server.js so the Express event
 * loop is never blocked by heavy AI API calls.
 *
 * Expected job.data shape:
 * {
 *   requestId:       string,   // CustomerRequest._id (hex string)
 *   originalMessage: string,   // raw customer text
 *   sourceChannel:   string,   // e.g. 'email'
 * }
 */

import { Worker } from 'bullmq';
import mongoose from 'mongoose';

import { redisConnection, closeRedis } from '../config/redis.js';
import { connectDB }                  from '../config/db.js';
import { CustomerRequest, RequestEvent, REQUEST_STATUS, EVENT_TYPES, ACTOR_TYPES } from '../models/index.js';
import { QUEUE_NAMES }                from './queues.js';

// ── Helper: append an immutable event to RequestEvent ───────────────────────
/**
 * Writes a single audit event. Called before and after any state mutation.
 *
 * @param {object} params
 * @param {mongoose.Types.ObjectId|string} params.requestId
 * @param {string}  params.eventType  - one of EVENT_TYPES
 * @param {*}       params.oldValue
 * @param {*}       params.newValue
 * @param {object}  [params.metadata]
 */
const appendEvent = async ({ requestId, eventType, oldValue, newValue, metadata = {} }) => {
  await RequestEvent.create({
    requestId,
    eventType,
    oldValue,
    newValue,
    actor: {
      actorType: ACTOR_TYPES.SYSTEM,
      label: 'request-processing-worker',
    },
    metadata,
  });
};

// ── Core job processor ───────────────────────────────────────────────────────
/**
 * Processes a single job from the queue.
 * BullMQ will call this function; any thrown error triggers a retry.
 *
 * @param {import('bullmq').Job} job
 */
const processJob = async (job) => {
  const { requestId, originalMessage, sourceChannel } = job.data;

  console.info(`[Worker] Job ${job.id} picked up | requestId=${requestId}`);

  // ── Step 1: Load the CustomerRequest ────────────────────────────────────
  const request = await CustomerRequest.findById(requestId);

  if (!request) {
    // Throw so BullMQ marks the job as failed immediately (no retry useful here)
    throw new Error(`CustomerRequest not found: ${requestId}`);
  }

  // Guard against double-processing if the job is somehow enqueued twice
  if (request.status !== REQUEST_STATUS.QUEUED) {
    console.warn(
      `[Worker] Job ${job.id} skipped — request ${requestId} is already '${request.status}'`
    );
    return { skipped: true, reason: 'not_in_queued_state' };
  }

  // ── Step 2: Transition status → 'processing' ────────────────────────────
  const previousStatus = request.status;

  request.status = REQUEST_STATUS.PROCESSING;
  await request.save();

  // ── Step 3: Append status_changed event to the audit log ────────────────
  await appendEvent({
    requestId: request._id,
    eventType: EVENT_TYPES.STATUS_CHANGED,
    oldValue:  previousStatus,
    newValue:  REQUEST_STATUS.PROCESSING,
    metadata:  { jobId: job.id, attemptsMade: job.attemptsMade },
  });

  console.info(`[Worker] Request ${requestId} → status: '${REQUEST_STATUS.PROCESSING}'`);

  // Update BullMQ's internal job progress so dashboards can track it
  await job.updateProgress(25);

  // ── Step 4: AI Classification — PLACEHOLDER ─────────────────────────────
  /**
   * ┌─────────────────────────────────────────────────────────────────────────┐
   * │  AI CLASSIFICATION PLACEHOLDER                                          │
   * │─────────────────────────────────────────────────────────────────────────│
   * │  Replace this block in Sprint 3 with the real AI service call.          │
   * │                                                                         │
   * │  What to implement here:                                                │
   * │  1. Import classifierService from '../services/ai/classifier.service'   │
   * │  2. Call:                                                               │
   * │       const result = await classifierService.classify({                 │
   * │         requestId: request._id,                                         │
   * │         message:   originalMessage,                                     │
   * │         channel:   sourceChannel,                                       │
   * │       });                                                               │
   * │                                                                         │
   * │  3. The classifier service should:                                      │
   * │       a. Call the chosen AI provider (OpenAI / Gemini / etc.)           │
   * │       b. Persist an AIClassification document with the full rawOutput   │
   * │       c. Return { category, priority, summary, confidence }             │
   * │                                                                         │
   * │  4. Denormalize the snapshot back onto CustomerRequest:                 │
   * │       request.categorySnapshot = result.category;                       │
   * │       request.prioritySnapshot = result.priority;                       │
   * │       request.classificationId = result.classificationDoc._id;          │
   * │       request.status           = REQUEST_STATUS.COMPLETED;              │
   * │       await request.save();                                             │
   * │                                                                         │
   * │  5. Append the following events via appendEvent():                      │
   * │       • AI_CLASSIFICATION_COMPLETED  (or AI_CLASSIFICATION_FAILED)      │
   * │       • STATUS_CHANGED (processing → completed / failed)               │
   * │       • PRIORITY_CHANGED (if prioritySnapshot changed)                  │
   * │       • CATEGORY_CHANGED (new categorization)                           │
   * │       • AGENT_ASSIGNED (once routing logic assigns an agent)            │
   * │                                                                         │
   * │  6. On AI provider error, throw the error so BullMQ retries.           │
   * │     After exhausting retries, the 'failed' event below will fire.       │
   * └─────────────────────────────────────────────────────────────────────────┘
   */

  // Temporary: mark progress at 50% until classifier is wired in
  await job.updateProgress(50);

  // ── Step 5: Return a result object (stored by BullMQ in job.returnvalue) ──
  return {
    requestId,
    finalStatus: request.status,
    processedAt: new Date().toISOString(),
  };
};

// ── Worker instantiation ─────────────────────────────────────────────────────
/**
 * Creates and starts the BullMQ worker.
 * Called once from server.js after MongoDB connects.
 */
export const startRequestWorker = () => {
  const worker = new Worker(QUEUE_NAMES.REQUEST_PROCESSING, processJob, {
    connection: redisConnection,
    concurrency: parseInt(process.env.WORKER_CONCURRENCY ?? '5', 10),
    limiter: {
      // Global rate limit: at most 50 jobs per second to stay under AI API quotas
      max:      50,
      duration: 1000,
    },
  });

  // ── Worker event hooks ──────────────────────────────────────────────────
  worker.on('completed', (job, result) => {
    console.info(
      `[Worker] Job ${job.id} COMPLETED | requestId=${job.data.requestId} | result=${JSON.stringify(result)}`
    );
  });

  worker.on('failed', async (job, err) => {
    console.error(
      `[Worker] Job ${job?.id} FAILED (attempt ${job?.attemptsMade}/${job?.opts?.attempts}) | ${err.message}`
    );

    // If this was the final attempt, transition request to 'failed'
    const isLastAttempt = job?.attemptsMade >= (job?.opts?.attempts ?? 1);
    if (isLastAttempt && job?.data?.requestId) {
      try {
        await CustomerRequest.findByIdAndUpdate(job.data.requestId, {
          status: REQUEST_STATUS.FAILED,
        });

        await appendEvent({
          requestId: job.data.requestId,
          eventType: EVENT_TYPES.STATUS_CHANGED,
          oldValue:  REQUEST_STATUS.PROCESSING,
          newValue:  REQUEST_STATUS.FAILED,
          metadata:  {
            jobId:        job.id,
            errorMessage: err.message,
            attemptsMade: job.attemptsMade,
          },
        });

        console.warn(`[Worker] Request ${job.data.requestId} marked as 'failed' after all retries.`);
      } catch (updateErr) {
        console.error('[Worker] Could not update request to failed state:', updateErr.message);
      }
    }
  });

  worker.on('error',   (err) => console.error('[Worker] Worker error:', err));
  worker.on('stalled', (jobId) => console.warn(`[Worker] Job ${jobId} stalled — will be re-queued`));

  console.info(
    `[Worker] Listening on queue '${QUEUE_NAMES.REQUEST_PROCESSING}' | concurrency=${worker.opts.concurrency}`
  );

  return worker;
};

// ── Standalone entrypoint ────────────────────────────────────────────────────
// Allows running this file directly:  node src/jobs/requestWorker.js
// This is useful for horizontally scaling workers as separate processes.
if (process.env.RUN_WORKER_STANDALONE === 'true') {
  (async () => {
    await connectDB();
    startRequestWorker();

    const graceful = async (signal) => {
      console.info(`[Worker] ${signal} — shutting down`);
      await closeRedis();
      process.exit(0);
    };
    process.on('SIGINT',  () => graceful('SIGINT'));
    process.on('SIGTERM', () => graceful('SIGTERM'));
  })();
}
