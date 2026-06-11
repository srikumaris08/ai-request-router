/**
 * @file apiResponse.js  (src/utils)
 * @description Utility functions for sending standardized JSON responses.
 *
 * Every API response follows the same envelope:
 * {
 *   success: boolean,
 *   message: string,
 *   data:    any | null,
 *   error:   string | null,
 * }
 *
 * Usage:
 *   import { sendSuccess, sendError } from '../utils/apiResponse.js';
 *   sendSuccess(res, 201, 'Request created', { id: doc._id });
 *   sendError(res, 400, 'Validation failed', err.message);
 */

/**
 * Send a successful response.
 * @param {import('express').Response} res
 * @param {number} statusCode
 * @param {string} message
 * @param {*} [data=null]
 */
export const sendSuccess = (res, statusCode = 200, message = 'OK', data = null) => {
  return res.status(statusCode).json({
    success: true,
    message,
    data,
    error: null,
  });
};

/**
 * Send an error response.
 * @param {import('express').Response} res
 * @param {number} statusCode
 * @param {string} message
 * @param {string|null} [errorDetail=null]
 */
export const sendError = (res, statusCode = 500, message = 'An error occurred', errorDetail = null) => {
  return res.status(statusCode).json({
    success: false,
    message,
    data: null,
    error: errorDetail,
  });
};
