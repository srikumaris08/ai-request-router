/**
 * @file CustomerRequest.model.js
 * @description Core entity representing a single inbound customer request.
 *
 * Design notes:
 *  - `categorySnapshot` / `prioritySnapshot` are intentional denormalizations.
 *    They capture the AI classification values AT THE TIME the request was
 *    processed, so re-running the AI never silently changes historical routing
 *    decisions. The canonical AI data lives in AIClassification.
 *  - `assignedAgent` is a nullable ref, null while status === 'queued'.
 *  - Indexes are chosen to cover the three most common query patterns:
 *      1. Agent's inbox  : { assignedAgent, status }
 *      2. Admin dashboard: { status, createdAt }
 *      3. Channel report : { sourceChannel, createdAt }
 */

import mongoose from 'mongoose';

const { Schema, model } = mongoose;

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
export const REQUEST_STATUS = Object.freeze({
  QUEUED:     'queued',
  PROCESSING: 'processing',
  COMPLETED:  'completed',
  FAILED:     'failed',
});

export const SOURCE_CHANNELS = Object.freeze({
  EMAIL:    'email',
  CHAT:     'chat',
  PHONE:    'phone',
  PORTAL:   'portal',
  API:      'api',
});

export const PRIORITY_LEVELS = Object.freeze({
  LOW:      'low',
  MEDIUM:   'medium',
  HIGH:     'high',
  CRITICAL: 'critical',
});

// ---------------------------------------------------------------------------
// Sub-schemas
// ---------------------------------------------------------------------------

/**
 * Embeds basic identifying info about the customer who submitted the request.
 * Kept as a sub-document so we don't need a separate Customer collection for
 * this assessment scope, while still keeping the data structured.
 */
const customerInfoSchema = new Schema(
  {
    name:  { type: String, trim: true, default: null },
    email: { type: String, trim: true, lowercase: true, default: null },
    phone: { type: String, trim: true, default: null },

    /** Free-form external identifier (CRM ID, ticket ID, etc.) */
    externalId: { type: String, trim: true, default: null },
  },
  { _id: false } // no separate _id needed for embedded doc
);

// ---------------------------------------------------------------------------
// Main Schema
// ---------------------------------------------------------------------------
const customerRequestSchema = new Schema(
  {
    /** The raw, unmodified message as received from the customer */
    originalMessage: {
      type: String,
      required: [true, 'originalMessage is required'],
      trim: true,
    },

    sourceChannel: {
      type: String,
      required: [true, 'sourceChannel is required'],
      enum: {
        values: Object.values(SOURCE_CHANNELS),
        message: `sourceChannel must be one of: ${Object.values(SOURCE_CHANNELS).join(', ')}`,
      },
      index: true,
    },

    status: {
      type: String,
      enum: {
        values: Object.values(REQUEST_STATUS),
        message: `status must be one of: ${Object.values(REQUEST_STATUS).join(', ')}`,
      },
      default: REQUEST_STATUS.QUEUED,
      index: true,
    },

    /**
     * Denormalized snapshot of the category assigned by AI classification.
     * Populated once AIClassification is created; null until then.
     */
    categorySnapshot: {
      type: String,
      default: null,
      trim: true,
    },

    /**
     * Denormalized snapshot of the priority assigned by AI classification.
     * Populated once AIClassification is created; null until then.
     */
    prioritySnapshot: {
      type: String,
      enum: {
        values: [...Object.values(PRIORITY_LEVELS), null],
        message: `prioritySnapshot must be one of: ${Object.values(PRIORITY_LEVELS).join(', ')}`,
      },
      default: null,
    },

    customer: {
      type: customerInfoSchema,
      default: () => ({}),
    },

    /** Agent this request is routed to; null = unassigned / in queue */
    assignedAgent: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      default: null,
      index: true,
    },

    /** Links back to the definitive AIClassification document */
    classificationId: {
      type: Schema.Types.ObjectId,
      ref: 'AIClassification',
      default: null,
    },

    /** ISO timestamp when the request was resolved (status → completed/failed) */
    resolvedAt: {
      type: Date,
      default: null,
    },

    /** Arbitrary key-value bag for channel-specific metadata (e.g., email headers) */
    metadata: {
      type: Schema.Types.Mixed,
      default: {},
    },
  },
  {
    timestamps: true,
    collection: 'customer_requests',
    versionKey: false,
    toJSON:   { virtuals: true },
    toObject: { virtuals: true },
  }
);

// ---------------------------------------------------------------------------
// Compound Indexes
// ---------------------------------------------------------------------------
// Agent inbox query: all open requests assigned to me, newest first
customerRequestSchema.index({ assignedAgent: 1, status: 1, createdAt: -1 });

// Admin dashboard: filter by status, sort newest first
customerRequestSchema.index({ status: 1, createdAt: -1 });

// Channel analytics: all requests from a channel in a date range
customerRequestSchema.index({ sourceChannel: 1, createdAt: -1 });

// Priority queue: fetch high-priority unassigned items quickly
customerRequestSchema.index({ prioritySnapshot: 1, status: 1 });

// ---------------------------------------------------------------------------
// Virtuals
// ---------------------------------------------------------------------------
/** Elapsed time (ms) since the request was created */
customerRequestSchema.virtual('ageMs').get(function () {
  return Date.now() - this.createdAt.getTime();
});

// ---------------------------------------------------------------------------
// Model
// ---------------------------------------------------------------------------
const CustomerRequest = model('CustomerRequest', customerRequestSchema);
export default CustomerRequest;
