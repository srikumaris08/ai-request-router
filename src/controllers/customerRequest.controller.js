/**
 * @file customerRequest.controller.js  (src/controllers)
 * @description Handlers for all /api/v1/requests endpoints.
 */
import {
  CustomerRequest, AIClassification, InternalNote, RequestEvent,
  REQUEST_STATUS, EVENT_TYPES, ACTOR_TYPES,
} from '../models/index.js';
import { requestProcessingQueue }  from '../jobs/queues.js';
import { tryEmit }                 from '../config/socket.js';
import { sendSuccess, sendError }  from '../utils/apiResponse.js';
import asyncHandler                from '../utils/asyncHandler.js';
import {
  ingestRequestSchema,
  updateStatusSchema,
  addNoteSchema,
} from '../validators/customerRequest.validator.js';

// ── Helper ───────────────────────────────────────────────────────────────────
const validate = (schema, body, res) => {
  const result = schema.safeParse(body);
  if (!result.success) {
    sendError(res, 422, 'Validation failed', result.error.errors.map((e) => e.message).join('; '));
    return null;
  }
  return result.data;
};

// ── POST /api/v1/requests  (public) ─────────────────────────────────────────
export const ingestRequest = asyncHandler(async (req, res) => {
  const data = validate(ingestRequestSchema, req.body, res);
  if (!data) return;

  const request = await CustomerRequest.create({
    originalMessage: data.originalMessage,
    sourceChannel:   data.sourceChannel,
    customer:        data.customer ?? {},
    metadata:        data.metadata ?? {},
    status:          REQUEST_STATUS.QUEUED,
  });

  await RequestEvent.create({
    requestId: request._id,
    eventType: EVENT_TYPES.REQUEST_CREATED,
    newValue:  { status: REQUEST_STATUS.QUEUED, sourceChannel: data.sourceChannel },
    actor:     { actorType: ACTOR_TYPES.API, label: 'ingest-endpoint' },
  });

  // Enqueue — use requestId as idempotent jobId to prevent duplicate processing
  await requestProcessingQueue.add(
    `classify-${request._id}`,
    {
      requestId:       request._id.toString(),
      originalMessage: request.originalMessage,
      sourceChannel:   request.sourceChannel,
    },
    { jobId: request._id.toString() }
  );

  // Notify connected clients that a new request entered the queue
  tryEmit('request:new', { requestId: request._id, status: REQUEST_STATUS.QUEUED });

  return sendSuccess(res, 202, 'Request accepted and queued for AI processing.', {
    request: request.toJSON(),
    jobQueued: true,
  });
});

// ── GET /api/v1/requests  (admin | agent) ───────────────────────────────────
export const listRequests = asyncHandler(async (req, res) => {
  const {
    status, priority, category, assignedAgent,
    page = 1, limit = 20, sort = '-createdAt',
  } = req.query;

  const filter = {};
  if (status)        filter.status           = status;
  if (priority)      filter.prioritySnapshot = priority;
  if (category)      filter.categorySnapshot = category;
  if (assignedAgent) filter.assignedAgent    = assignedAgent;

  const skip       = (parseInt(page, 10) - 1) * parseInt(limit, 10);
  const limitParsed = Math.min(parseInt(limit, 10), 100); // cap at 100

  const [requests, total] = await Promise.all([
    CustomerRequest.find(filter)
      .sort(sort)
      .skip(skip)
      .limit(limitParsed)
      .populate('assignedAgent', 'email role'),
    CustomerRequest.countDocuments(filter),
  ]);

  return sendSuccess(res, 200, 'Requests fetched.', {
    requests,
    pagination: {
      total,
      page:  parseInt(page, 10),
      limit: limitParsed,
      pages: Math.ceil(total / limitParsed),
    },
  });
});

// ── GET /api/v1/requests/:id  (admin | agent) ────────────────────────────────
export const getRequestDetail = asyncHandler(async (req, res) => {
  const request = await CustomerRequest.findById(req.params.id)
    .populate('assignedAgent', 'email role')
    .populate('classificationId'); // inline populate of AIClassification ref

  if (!request) return sendError(res, 404, 'Request not found.');

  const [notes, timeline] = await Promise.all([
    InternalNote.find({ requestId: request._id, isDeleted: false })
      .sort('createdAt')
      .populate('author', 'email role'),
    RequestEvent.find({ requestId: request._id }).sort('createdAt'),
  ]);

  return sendSuccess(res, 200, 'Request details fetched.', {
    request,
    classification: request.classificationId ?? null, // already populated
    notes,
    timeline,
  });
});

// ── PATCH /api/v1/requests/:id/status  (admin) ──────────────────────────────
export const updateRequestStatus = asyncHandler(async (req, res) => {
  const data = validate(updateStatusSchema, req.body, res);
  if (!data) return;

  const request = await CustomerRequest.findById(req.params.id);
  if (!request) return sendError(res, 404, 'Request not found.');

  const prevStatus = request.status;
  request.status   = data.status;

  if ([REQUEST_STATUS.COMPLETED, REQUEST_STATUS.FAILED].includes(data.status))
    request.resolvedAt = new Date();

  await request.save();

  await RequestEvent.create({
    requestId: request._id,
    eventType: EVENT_TYPES.STATUS_CHANGED,
    oldValue:  prevStatus,
    newValue:  data.status,
    actor: {
      actorType: ACTOR_TYPES.USER,
      userId:    req.user._id,
      label:     req.user.email,
    },
    metadata: { manual: true },
  });

  tryEmit('request:updated', {
    requestId: request._id.toString(),
    status:    data.status,
    updatedBy: req.user.email,
  });

  return sendSuccess(res, 200, 'Status updated.', { request });
});

// ── POST /api/v1/requests/:id/notes  (admin | agent) ────────────────────────
export const addNote = asyncHandler(async (req, res) => {
  const data = validate(addNoteSchema, req.body, res);
  if (!data) return;

  const request = await CustomerRequest.findById(req.params.id);
  if (!request) return sendError(res, 404, 'Request not found.');

  const note = await InternalNote.create({
    requestId: request._id,
    author:    req.user._id,
    noteBody:  data.noteBody,
    metadata:  data.metadata ?? {},
  });

  await RequestEvent.create({
    requestId: request._id,
    eventType: EVENT_TYPES.NOTE_ADDED,
    newValue:  { noteId: note._id, excerpt: note.noteBody.slice(0, 100) },
    actor: {
      actorType: ACTOR_TYPES.USER,
      userId:    req.user._id,
      label:     req.user.email,
    },
  });

  const populated = await note.populate('author', 'email role');
  return sendSuccess(res, 201, 'Note added.', { note: populated });
});
