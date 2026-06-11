/**
 * @file requestWorker.js  (src/jobs)
 * @description BullMQ Worker — consumes 'request-processing' jobs.
 *
 * Full job lifecycle:
 *  1.  Validate job payload and load CustomerRequest from DB.
 *  2.  Guard against double-processing (status must be 'queued').
 *  3.  Transition status → 'processing'; write STATUS_CHANGED event.
 *  4.  Call AIService.classify() → structured classification result.
 *  5.  Persist AIClassification document (full rawOutput + token usage).
 *  6.  Denormalize category/priority snapshots onto CustomerRequest.
 *  7.  Transition status → 'completed'; write final audit events.
 *  8.  On AI error: write AI_CLASSIFICATION_FAILED event, re-throw so
 *      BullMQ can retry. On final attempt the worker.on('failed') handler
 *      transitions the request to 'failed'.
 *
 * Horizontal scaling note:
 *   Set RUN_WORKER_STANDALONE=true and run this file as a separate process:
 *     node src/jobs/requestWorker.js
 */

import { Worker }    from 'bullmq';
import mongoose      from 'mongoose';

import { redisConnection, closeRedis } from '../config/redis.js';
import { connectDB }                   from '../config/db.js';
import {
  CustomerRequest,
  AIClassification,
  RequestEvent,
  REQUEST_STATUS,
  EVENT_TYPES,
  ACTOR_TYPES,
} from '../models/index.js';
import { QUEUE_NAMES }  from './queues.js';
import aiService        from '../services/aiService.js';

// ── Shared audit-event writer ────────────────────────────────────────────────

/**
 * Appends an immutable event to the RequestEvent collection.
 * This is the only function allowed to create RequestEvent documents in
 * this module — keeps the audit-append pattern centralized.
 *
 * @param {object} params
 * @param {mongoose.Types.ObjectId|string} params.requestId
 * @param {string}  params.eventType   - one of EVENT_TYPES
 * @param {*}       [params.oldValue]
 * @param {*}       [params.newValue]
 * @param {object}  [params.metadata]
 */
const appendEvent = async ({
  requestId,
  eventType,
  oldValue  = null,
  newValue  = null,
  metadata  = {},
}) => {
  await RequestEvent.create({
    requestId,
    eventType,
    oldValue,
    newValue,
    actor: {
      actorType: ACTOR_TYPES.SYSTEM,
      label:     'request-processing-worker',
    },
    metadata,
  });
};

// ── Core job processor ───────────────────────────────────────────────────────

/**
 * @param {import('bullmq').Job} job
 */
const processJob = async (job) => {
  const { requestId, originalMessage, sourceChannel } = job.data;
  console.info(`[Worker] Job ${job.id} received | requestId=${requestId}`);

  // ── Step 1: Load CustomerRequest ─────────────────────────────────────────
  const request = await CustomerRequest.findById(requestId);

  if (!request) {
    // Non-retryable: doc doesn't exist. Throw to move job directly to failed.
    const err = new Error(`CustomerRequest not found: ${requestId}`);
    err.isNonRetryable = true;
    throw err;
  }

  // ── Step 2: Double-processing guard ──────────────────────────────────────
  if (request.status !== REQUEST_STATUS.QUEUED) {
    console.warn(
      `[Worker] Job ${job.id} skipped — request ${requestId} is already '${request.status}'`
    );
    return { skipped: true, reason: 'not_in_queued_state', requestId };
  }

  // ── Step 3: status → 'processing' ────────────────────────────────────────
  const prevStatus = request.status;
  request.status   = REQUEST_STATUS.PROCESSING;
  await request.save();

  await appendEvent({
    requestId: request._id,
    eventType: EVENT_TYPES.STATUS_CHANGED,
    oldValue:  prevStatus,
    newValue:  REQUEST_STATUS.PROCESSING,
    metadata:  { jobId: job.id, attemptsMade: job.attemptsMade },
  });

  await job.updateProgress(25);
  console.info(`[Worker] ${requestId} → '${REQUEST_STATUS.PROCESSING}'`);

  // ── Step 4: AI Classification ─────────────────────────────────────────────
  let classificationResult;

  try {
    classificationResult = await aiService.classify({
      requestId,
      message: originalMessage,
      channel: sourceChannel,
    });

    console.info(
      `[Worker] AI classified ${requestId} as '${classificationResult.category}' / '${classificationResult.priority}' `
      + `(confidence=${classificationResult.confidence}, provider=${classificationResult.provider}, `
      + `latency=${classificationResult.latencyMs}ms)`
    );
  } catch (aiErr) {
    // AI call failed — log the failure event, then re-throw so BullMQ retries.
    console.error(`[Worker] AI classification failed for ${requestId}: ${aiErr.message}`);

    await appendEvent({
      requestId: request._id,
      eventType: EVENT_TYPES.AI_CLASSIFICATION_FAILED,
      oldValue:  null,
      newValue:  null,
      metadata:  {
        jobId:        job.id,
        attemptsMade: job.attemptsMade,
        errorMessage: aiErr.message,
        provider:     aiService.providerName,
      },
    });

    // Re-throw → BullMQ will retry per queue policy.
    // worker.on('failed') will handle the final 'failed' status transition
    // once all attempts are exhausted.
    throw aiErr;
  }

  await job.updateProgress(60);

  // ── Step 5: Persist AIClassification document ─────────────────────────────
  const classificationDoc = await AIClassification.create({
    requestId:    request._id,
    provider:     classificationResult.provider,
    category:     classificationResult.category,
    priority:     classificationResult.priority,
    summary:      classificationResult.summary,
    confidence:   classificationResult.confidence,
    reason:       classificationResult.reason,
    modelVersion: classificationResult.modelVersion,
    latencyMs:    classificationResult.latencyMs,
    /**
     * rawOutput stores whatever the provider returned verbatim.
     * For the mock provider this mirrors the structured result.
     * For real providers you'd pass the full SDK response object here.
     */
    rawOutput: classificationResult,
    errorState: { isError: false },
  });

  await appendEvent({
    requestId: request._id,
    eventType: EVENT_TYPES.AI_CLASSIFICATION_COMPLETED,
    oldValue:  null,
    newValue:  {
      classificationId: classificationDoc._id,
      category:         classificationResult.category,
      priority:         classificationResult.priority,
      confidence:       classificationResult.confidence,
    },
    metadata: {
      jobId:        job.id,
      provider:     classificationResult.provider,
      modelVersion: classificationResult.modelVersion,
      latencyMs:    classificationResult.latencyMs,
    },
  });

  await job.updateProgress(75);

  // ── Step 6: Denormalize snapshots onto CustomerRequest ─────────────────────
  const prevCategory = request.categorySnapshot;
  const prevPriority = request.prioritySnapshot;

  request.categorySnapshot  = classificationResult.category;
  request.prioritySnapshot  = classificationResult.priority;
  request.classificationId  = classificationDoc._id;
  request.status            = REQUEST_STATUS.COMPLETED;
  request.resolvedAt        = new Date();
  await request.save();

  // ── Step 7: Final audit events ────────────────────────────────────────────

  // Category assigned (was null before)
  if (prevCategory !== classificationResult.category) {
    await appendEvent({
      requestId: request._id,
      eventType: EVENT_TYPES.CATEGORY_CHANGED,
      oldValue:  prevCategory,
      newValue:  classificationResult.category,
      metadata:  { classificationId: classificationDoc._id },
    });
  }

  // Priority assigned (was null before)
  if (prevPriority !== classificationResult.priority) {
    await appendEvent({
      requestId: request._id,
      eventType: EVENT_TYPES.PRIORITY_CHANGED,
      oldValue:  prevPriority,
      newValue:  classificationResult.priority,
      metadata:  { classificationId: classificationDoc._id },
    });
  }

  // Final status transition
  await appendEvent({
    requestId: request._id,
    eventType: EVENT_TYPES.STATUS_CHANGED,
    oldValue:  REQUEST_STATUS.PROCESSING,
    newValue:  REQUEST_STATUS.COMPLETED,
    metadata:  {
      jobId:            job.id,
      classificationId: classificationDoc._id,
    },
  });

  await appendEvent({
    requestId: request._id,
    eventType: EVENT_TYPES.REQUEST_RESOLVED,
    metadata:  {
      resolvedAt:       request.resolvedAt,
      categorySnapshot: request.categorySnapshot,
      prioritySnapshot: request.prioritySnapshot,
    },
  });

  await job.updateProgress(100);

  const returnValue = {
    requestId,
    classificationId: classificationDoc._id.toString(),
    category:         classificationResult.category,
    priority:         classificationResult.priority,
    finalStatus:      REQUEST_STATUS.COMPLETED,
    processedAt:      request.resolvedAt.toISOString(),
  };

  console.info(`[Worker] Job ${job.id} DONE | ${JSON.stringify(returnValue)}`);
  return returnValue;
};

// ── Worker factory ───────────────────────────────────────────────────────────

/**
 * Creates, configures, and starts the BullMQ worker.
 * Called once from server.js after MongoDB is connected.
 *
 * @returns {import('bullmq').Worker}
 */
export const startRequestWorker = () => {
  const worker = new Worker(QUEUE_NAMES.REQUEST_PROCESSING, processJob, {
    connection:  redisConnection,
    concurrency: parseInt(process.env.WORKER_CONCURRENCY ?? '5', 10),
    limiter: {
      max:      50,   // max jobs per duration window
      duration: 1000, // window in ms → effectively 50 jobs/sec
    },
  });

  // ── Worker-level event hooks ────────────────────────────────────────────

  worker.on('completed', (job, result) => {
    if (result?.skipped) {
      console.warn(`[Worker] Job ${job.id} skipped: ${result.reason}`);
      return;
    }
    console.info(
      `[Worker] ✓ Job ${job.id} completed | `
      + `requestId=${result?.requestId} | category=${result?.category} | priority=${result?.priority}`
    );
  });

  worker.on('failed', async (job, err) => {
    console.error(
      `[Worker] ✗ Job ${job?.id} failed `
      + `(attempt ${job?.attemptsMade}/${job?.opts?.attempts ?? 1}) | ${err.message}`
    );

    // On final retry attempt → mark the CustomerRequest as 'failed'
    const isLastAttempt =
      job?.attemptsMade >= (job?.opts?.attempts ?? 1) || err?.isNonRetryable;

    if (isLastAttempt && job?.data?.requestId) {
      try {
        // Use updateOne to avoid any pre-save hooks interfering
        await CustomerRequest.findByIdAndUpdate(job.data.requestId, {
          $set: { status: REQUEST_STATUS.FAILED },
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
            isNonRetryable: !!err.isNonRetryable,
          },
        });

        console.warn(
          `[Worker] Request ${job.data.requestId} marked '${REQUEST_STATUS.FAILED}' after exhausted retries.`
        );
      } catch (updateErr) {
        // Log but do NOT throw — crashing the error handler would mask the original error
        console.error(
          '[Worker] Could not persist failed state to DB:',
          updateErr.message
        );
      }
    }
  });

  worker.on('error',   (err)   => console.error('[Worker] Worker-level error:', err));
  worker.on('stalled', (jobId) => console.warn(`[Worker] Job ${jobId} stalled — BullMQ will re-queue`));
  worker.on('progress', (job, progress) =>
    console.debug(`[Worker] Job ${job.id} progress: ${progress}%`)
  );

  console.info(
    `[Worker] Started — queue='${QUEUE_NAMES.REQUEST_PROCESSING}' | `
    + `concurrency=${worker.opts.concurrency} | provider=${aiService.providerName}`
  );

  return worker;
};

// ── Standalone entrypoint ────────────────────────────────────────────────────
// Run as a dedicated process:
//   RUN_WORKER_STANDALONE=true node src/jobs/requestWorker.js

if (process.env.RUN_WORKER_STANDALONE === 'true') {
  (async () => {
    await connectDB();
    startRequestWorker();

    const graceful = async (signal) => {
      console.info(`[Worker] ${signal} — shutting down standalone worker`);
      await closeRedis();
      process.exit(0);
    };

    process.on('SIGINT',  () => graceful('SIGINT'));
    process.on('SIGTERM', () => graceful('SIGTERM'));
  })();
}
