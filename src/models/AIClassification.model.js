/**
 * @file AIClassification.model.js
 * @description Normalized record of every AI classification attempt.
 *
 * Design notes:
 *  - STRICTLY separate from CustomerRequest. This collection is the single
 *    source of truth for what the AI actually decided and why.
 *  - Stores the full `rawOutput` so any future audit can replay/inspect
 *    the exact LLM response, useful for debugging prompt regressions.
 *  - `errorState` captures failure metadata when the AI provider errors out,
 *    without losing the attempt record.
 *  - One CustomerRequest may have multiple AIClassification documents (retries,
 *    multi-provider comparison), hence no unique constraint on requestId alone.
 *  - Compound index { requestId, createdAt } lets you fetch the classification
 *    history for a request in chronological order cheaply.
 */

import mongoose from 'mongoose';

const { Schema, model } = mongoose;

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
export const AI_PROVIDERS = Object.freeze({
  OPENAI:    'openai',
  GEMINI:    'gemini',
  ANTHROPIC: 'anthropic',
  COHERE:    'cohere',
  CUSTOM:    'custom',
});

export const AI_CATEGORIES = Object.freeze({
  BILLING:         'billing',
  TECHNICAL:       'technical',
  GENERAL_INQUIRY: 'general_inquiry',
  COMPLAINT:       'complaint',
  FEATURE_REQUEST: 'feature_request',
  REFUND:          'refund',
  OTHER:           'other',
});

export const AI_PRIORITIES = Object.freeze({
  LOW:      'low',
  MEDIUM:   'medium',
  HIGH:     'high',
  CRITICAL: 'critical',
});

// ---------------------------------------------------------------------------
// Sub-schemas
// ---------------------------------------------------------------------------

/**
 * Captures structured error info when the AI provider returns an error or the
 * classification response fails validation.
 */
const errorStateSchema = new Schema(
  {
    isError:    { type: Boolean, default: false },
    errorCode:  { type: String, default: null },
    errorMessage: { type: String, default: null },
    /** Number of retry attempts made before giving up */
    retryCount: { type: Number, default: 0 },
  },
  { _id: false }
);

// ---------------------------------------------------------------------------
// Main Schema
// ---------------------------------------------------------------------------
const aiClassificationSchema = new Schema(
  {
    /** Reference to the CustomerRequest this classification belongs to */
    requestId: {
      type: Schema.Types.ObjectId,
      ref: 'CustomerRequest',
      required: [true, 'requestId is required'],
      index: true,
    },

    /** AI provider that produced this classification */
    provider: {
      type: String,
      required: [true, 'provider is required'],
      enum: {
        values: Object.values(AI_PROVIDERS),
        message: `provider must be one of: ${Object.values(AI_PROVIDERS).join(', ')}`,
      },
    },

    /** Predicted category for the customer request */
    category: {
      type: String,
      enum: {
        values: [...Object.values(AI_CATEGORIES), null],
        message: `category must be one of: ${Object.values(AI_CATEGORIES).join(', ')}`,
      },
      default: null,
    },

    /** Predicted urgency level */
    priority: {
      type: String,
      enum: {
        values: [...Object.values(AI_PRIORITIES), null],
        message: `priority must be one of: ${Object.values(AI_PRIORITIES).join(', ')}`,
      },
      default: null,
    },

    /** One-to-three sentence AI-generated summary of the customer message */
    summary: {
      type: String,
      trim: true,
      default: null,
    },

    /**
     * Confidence score in range [0, 1].
     * null if the provider doesn't expose confidence.
     */
    confidence: {
      type: Number,
      min: [0, 'confidence must be >= 0'],
      max: [1, 'confidence must be <= 1'],
      default: null,
    },

    /** Human-readable explanation produced by the AI for the classification */
    reason: {
      type: String,
      trim: true,
      default: null,
    },

    /**
     * Complete, unmodified response object from the AI provider.
     * Schema.Types.Mixed lets us store arbitrary JSON without shape constraints.
     * Critical for audit trails and prompt-engineering debugging.
     */
    rawOutput: {
      type: Schema.Types.Mixed,
      default: null,
    },

    /** Model version / identifier used (e.g., "gpt-4o", "gemini-1.5-pro") */
    modelVersion: {
      type: String,
      trim: true,
      default: null,
    },

    /** Latency in milliseconds for the AI API call */
    latencyMs: {
      type: Number,
      min: 0,
      default: null,
    },

    /** Token usage stats (prompt, completion, total) for cost tracking */
    tokenUsage: {
      prompt:     { type: Number, default: null },
      completion: { type: Number, default: null },
      total:      { type: Number, default: null },
    },

    errorState: {
      type: errorStateSchema,
      default: () => ({ isError: false }),
    },
  },
  {
    timestamps: true,
    collection: 'ai_classifications',
    versionKey: false,
    toJSON:   { virtuals: true },
    toObject: { virtuals: true },
  }
);

// ---------------------------------------------------------------------------
// Compound Indexes
// ---------------------------------------------------------------------------
// Fetch classification history for a request in order
aiClassificationSchema.index({ requestId: 1, createdAt: -1 });

// Filter by provider + category for analytics (e.g., accuracy per provider)
aiClassificationSchema.index({ provider: 1, category: 1 });

// Surface all failed classifications for monitoring dashboards
aiClassificationSchema.index({ 'errorState.isError': 1, createdAt: -1 });

// ---------------------------------------------------------------------------
// Model
// ---------------------------------------------------------------------------
const AIClassification = model('AIClassification', aiClassificationSchema);
export default AIClassification;
