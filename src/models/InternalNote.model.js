/**
 * @file InternalNote.model.js
 * @description Agent/admin notes attached to a CustomerRequest.
 *
 * Design notes:
 *  - Notes are internal only — never surfaced to the customer.
 *  - `isEdited` + `editHistory` provide a lightweight audit trail for note
 *    edits without needing a separate collection for this scope.
 *  - `isDeleted` implements soft-delete so the audit timeline remains intact.
 *  - `mentions` stores an array of User ObjectIds that were @-mentioned in
 *    the note body, enabling notification fanout in a later sprint.
 *  - Index on { requestId, createdAt } covers the primary read pattern:
 *    "fetch all notes for request X, oldest first."
 */

import mongoose from 'mongoose';

const { Schema, model } = mongoose;

// ---------------------------------------------------------------------------
// Sub-schemas
// ---------------------------------------------------------------------------

/** Snapshot of a previous version of the note body (for edit history) */
const editHistoryEntrySchema = new Schema(
  {
    previousBody: { type: String, required: true },
    editedAt:     { type: Date,   required: true, default: Date.now },
  },
  { _id: false }
);

// ---------------------------------------------------------------------------
// Main Schema
// ---------------------------------------------------------------------------
const internalNoteSchema = new Schema(
  {
    /** The CustomerRequest this note is attached to */
    requestId: {
      type: Schema.Types.ObjectId,
      ref: 'CustomerRequest',
      required: [true, 'requestId is required'],
      index: true,
    },

    /** The User (admin or agent) who authored this note */
    author: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: [true, 'author is required'],
      index: true,
    },

    /** The body of the internal note (supports markdown for rich rendering) */
    noteBody: {
      type: String,
      required: [true, 'noteBody is required'],
      trim: true,
      minlength: [1, 'noteBody cannot be empty'],
      maxlength: [10000, 'noteBody cannot exceed 10 000 characters'],
    },

    /** Set to true when noteBody has been edited at least once */
    isEdited: {
      type: Boolean,
      default: false,
    },

    /**
     * Previous versions of noteBody in chronological order.
     * Append the current noteBody here before overwriting it on edit.
     */
    editHistory: {
      type: [editHistoryEntrySchema],
      default: [],
    },

    /** Soft-delete flag; never hard-delete notes to preserve the audit chain */
    isDeleted: {
      type: Boolean,
      default: false,
      index: true,
    },

    /** Timestamp when the note was soft-deleted, null if still active */
    deletedAt: {
      type: Date,
      default: null,
    },

    /**
     * User IDs @-mentioned in the note body.
     * Parsed and populated by the service layer before saving.
     */
    mentions: [
      {
        type: Schema.Types.ObjectId,
        ref: 'User',
      },
    ],

    /** Arbitrary extra data (e.g., attachment refs, source system) */
    metadata: {
      type: Schema.Types.Mixed,
      default: {},
    },
  },
  {
    timestamps: true,
    collection: 'internal_notes',
    versionKey: false,
    toJSON:   { virtuals: true },
    toObject: { virtuals: true },
  }
);

// ---------------------------------------------------------------------------
// Compound Indexes
// ---------------------------------------------------------------------------
// Primary read: all active notes on a request in chronological order
internalNoteSchema.index({ requestId: 1, isDeleted: 1, createdAt: 1 });

// Author's own notes across all requests (agent activity view)
internalNoteSchema.index({ author: 1, createdAt: -1 });

// ---------------------------------------------------------------------------
// Model
// ---------------------------------------------------------------------------
const InternalNote = model('InternalNote', internalNoteSchema);
export default InternalNote;
