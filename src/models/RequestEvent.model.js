/**
 * @file RequestEvent.model.js
 * @description Append-only audit log for every state transition on a CustomerRequest.
 *
 * Design notes:
 *  - Documents in this collection are IMMUTABLE once written. Never update or
 *    delete them. They are the historical ground truth.
 *  - `actor` is null for system-generated events (queue ingestion, AI processing).
 *  - `oldValue` / `newValue` record the before/after of the changed field.
 *    Both are Schema.Types.Mixed so they can hold strings, objects, or arrays
 *    depending on which field changed.
 *  - `metadata` is a free-form bag for event-specific context
 *    (e.g., { reason: "SLA breach", classificationId: "..." }).
 *  - A sparse TTL index is NOT applied here by default because compliance
 *    regulations often require audit logs to be retained indefinitely.
 *    Uncomment the TTL index below if your retention policy allows it.
 */

import mongoose from 'mongoose';

const { Schema, model } = mongoose;

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
export const EVENT_TYPES = Object.freeze({
  // Lifecycle transitions
  REQUEST_CREATED:       'request_created',
  STATUS_CHANGED:        'status_changed',
  PRIORITY_CHANGED:      'priority_changed',
  CATEGORY_CHANGED:      'category_changed',

  // Assignment
  AGENT_ASSIGNED:        'agent_assigned',
  AGENT_UNASSIGNED:      'agent_unassigned',
  AGENT_REASSIGNED:      'agent_reassigned',

  // AI pipeline
  AI_CLASSIFICATION_STARTED:   'ai_classification_started',
  AI_CLASSIFICATION_COMPLETED: 'ai_classification_completed',
  AI_CLASSIFICATION_FAILED:    'ai_classification_failed',
  AI_CLASSIFICATION_RETRIED:   'ai_classification_retried',

  // Notes & communication
  NOTE_ADDED:            'note_added',

  // Misc
  METADATA_UPDATED:      'metadata_updated',
  REQUEST_RESOLVED:      'request_resolved',
  REQUEST_REOPENED:      'request_reopened',
});

export const ACTOR_TYPES = Object.freeze({
  USER:   'user',   // a human admin or agent
  SYSTEM: 'system', // automated queue/AI pipeline
  API:    'api',    // external API call with a service key
});

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------
const requestEventSchema = new Schema(
  {
    /** The CustomerRequest this event belongs to */
    requestId: {
      type: Schema.Types.ObjectId,
      ref: 'CustomerRequest',
      required: [true, 'requestId is required'],
      index: true,
    },

    eventType: {
      type: String,
      required: [true, 'eventType is required'],
      enum: {
        values: Object.values(EVENT_TYPES),
        message: `eventType must be one of the defined EVENT_TYPES`,
      },
      index: true,
    },

    /** State of the changed field BEFORE this event */
    oldValue: {
      type: Schema.Types.Mixed,
      default: null,
    },

    /** State of the changed field AFTER this event */
    newValue: {
      type: Schema.Types.Mixed,
      default: null,
    },

    /** Who or what triggered this event */
    actor: {
      /** ObjectId ref to User; null for system/api actors */
      userId: {
        type: Schema.Types.ObjectId,
        ref: 'User',
        default: null,
      },

      actorType: {
        type: String,
        enum: {
          values: Object.values(ACTOR_TYPES),
          message: `actorType must be one of: ${Object.values(ACTOR_TYPES).join(', ')}`,
        },
        required: [true, 'actor.actorType is required'],
        default: ACTOR_TYPES.SYSTEM,
      },

      /** Human-readable identifier: username, service name, etc. */
      label: {
        type: String,
        trim: true,
        default: null,
      },
    },

    /** Event-specific context bag (kept flexible for diverse event types) */
    metadata: {
      type: Schema.Types.Mixed,
      default: {},
    },
  },
  {
    /**
     * We use `timestamps: true` so Mongoose sets `createdAt` automatically.
     * `updatedAt` will exist in the schema but should never change — enforce
     * this in your service layer (never call .save() on an event doc twice).
     */
    timestamps: true,
    collection: 'request_events',
    versionKey: false,
    toJSON:   { virtuals: true },
    toObject: { virtuals: true },
  }
);

// ---------------------------------------------------------------------------
// Compound Indexes
// ---------------------------------------------------------------------------
// Timeline view for a single request, ordered chronologically
requestEventSchema.index({ requestId: 1, createdAt: 1 });

// Filter events by type across all requests (e.g., all agent assignments today)
requestEventSchema.index({ eventType: 1, createdAt: -1 });

// Audit events attributed to a specific user
requestEventSchema.index({ 'actor.userId': 1, createdAt: -1 });

// ------------------- OPTIONAL TTL -------------------------------------------
// Uncomment ONLY if your data-retention policy allows event expiry.
// This will automatically delete events older than 365 days.
//
// requestEventSchema.index(
//   { createdAt: 1 },
//   { expireAfterSeconds: 60 * 60 * 24 * 365, name: 'event_ttl_365d' }
// );
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Model
// ---------------------------------------------------------------------------
const RequestEvent = model('RequestEvent', requestEventSchema);
export default RequestEvent;
