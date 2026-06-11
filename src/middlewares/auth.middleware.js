/**
 * @file auth.middleware.js  (src/middlewares)
 * @description Verifies the Bearer JWT and attaches req.user.
 */
import jwt              from 'jsonwebtoken';
import { User }         from '../models/index.js';
import { sendError }    from '../utils/apiResponse.js';

const protect = async (req, res, next) => {
  try {
    const header = req.headers.authorization;
    if (!header?.startsWith('Bearer '))
      return sendError(res, 401, 'No token provided. Please log in.');

    const token   = header.split(' ')[1];
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    const user = await User.findById(decoded.id);
    if (!user || !user.isActive)
      return sendError(res, 401, 'User no longer exists or account is inactive.');

    req.user = user;
    next();
  } catch (err) {
    next(err); // JsonWebTokenError / TokenExpiredError → errorHandler middleware
  }
};

export default protect;
