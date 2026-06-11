/**
 * @file rbac.middleware.js  (src/middlewares)
 * @description Role-gate factory. Use after protect middleware.
 *
 * Usage:
 *   router.delete('/x', protect, requireRole('admin'), handler);
 *   router.get('/x',    protect, requireRole('admin', 'agent'), handler);
 */
import { sendError } from '../utils/apiResponse.js';

/**
 * @param {...string} roles - Allowed role values (e.g. 'admin', 'agent')
 * @returns {import('express').RequestHandler}
 */
const requireRole = (...roles) => (req, res, next) => {
  if (!req.user)
    return sendError(res, 401, 'Not authenticated.');
  if (!roles.includes(req.user.role))
    return sendError(res, 403, `Access denied. Required role(s): ${roles.join(', ')}.`);
  next();
};

export default requireRole;
