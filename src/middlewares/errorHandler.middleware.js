/**
 * @file errorHandler.middleware.js  (src/middlewares)
 * @description Central Express error-handling middleware.
 *
 * Must be registered LAST in server.js (after all routes) so Express routes
 * errors here via next(err).
 *
 * Handles:
 *  - Mongoose CastError        → 400 Bad Request
 *  - Mongoose ValidationError  → 422 Unprocessable Entity
 *  - Mongoose duplicate key    → 409 Conflict
 *  - JWT errors                → 401 Unauthorized
 *  - Generic operational errors with a statusCode property
 *  - Unhandled programmer errors → 500 Internal Server Error
 */

import { sendError } from '../utils/apiResponse.js';

// eslint-disable-next-line no-unused-vars
const errorHandler = (err, req, res, _next) => {
  // Log the full error in non-production environments for easier debugging
  if (process.env.NODE_ENV !== 'production') {
    console.error('[ErrorHandler]', err);
  }

  // ── Mongoose: invalid ObjectId ────────────────────────────────────────────
  if (err.name === 'CastError') {
    return sendError(res, 400, `Invalid value for field '${err.path}'`);
  }

  // ── Mongoose: validation failed ───────────────────────────────────────────
  if (err.name === 'ValidationError') {
    const messages = Object.values(err.errors).map((e) => e.message);
    return sendError(res, 422, 'Validation failed', messages.join('; '));
  }

  // ── MongoDB: duplicate key (E11000) ───────────────────────────────────────
  if (err.code === 11000) {
    const field = Object.keys(err.keyValue || {})[0] || 'field';
    return sendError(res, 409, `Duplicate value for '${field}'`);
  }

  // ── JWT: token errors ─────────────────────────────────────────────────────
  if (err.name === 'JsonWebTokenError') {
    return sendError(res, 401, 'Invalid token. Please log in again.');
  }
  if (err.name === 'TokenExpiredError') {
    return sendError(res, 401, 'Token expired. Please log in again.');
  }

  // ── Operational errors with an explicit HTTP status ───────────────────────
  if (err.statusCode && err.isOperational) {
    return sendError(res, err.statusCode, err.message);
  }

  // ── Fallback: unknown / programmer error ──────────────────────────────────
  return sendError(
    res,
    500,
    'Internal server error',
    process.env.NODE_ENV === 'production' ? null : err.message
  );
};

export default errorHandler;
