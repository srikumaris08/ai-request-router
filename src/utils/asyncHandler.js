/**
 * @file asyncHandler.js  (src/utils)
 * @description Higher-order function that wraps an async Express handler and
 *   forwards any thrown error to Express's next() so the central error handler
 *   picks it up — eliminating repetitive try/catch blocks in every controller.
 *
 * Usage:
 *   router.get('/path', asyncHandler(async (req, res) => {
 *     const data = await SomeService.fetch();
 *     res.json({ success: true, data });
 *   }));
 */

/**
 * @param {(req: import('express').Request, res: import('express').Response, next: import('express').NextFunction) => Promise<void>} fn
 * @returns {import('express').RequestHandler}
 */
const asyncHandler = (fn) => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};

export default asyncHandler;
