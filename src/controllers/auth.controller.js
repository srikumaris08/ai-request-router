/**
 * @file auth.controller.js  (src/controllers)
 */
import bcrypt        from 'bcryptjs';
import jwt           from 'jsonwebtoken';
import { User }      from '../models/index.js';
import { sendSuccess, sendError } from '../utils/apiResponse.js';
import asyncHandler  from '../utils/asyncHandler.js';
import { registerSchema, loginSchema } from '../validators/auth.validator.js';

const signToken = (userId) =>
  jwt.sign({ id: userId }, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRES_IN ?? '7d',
  });

// POST /api/v1/auth/register
export const register = asyncHandler(async (req, res) => {
  const parsed = registerSchema.safeParse(req.body);
  if (!parsed.success)
    return sendError(res, 422, 'Validation failed', parsed.error.errors.map((e) => e.message).join('; '));

  const { email, password, role } = parsed.data;

  if (await User.findOne({ email }))
    return sendError(res, 409, 'An account with this email already exists.');

  const hashed = await bcrypt.hash(password, 12);
  const user   = await User.create({ email, password: hashed, role });
  const token  = signToken(user._id);

  return sendSuccess(res, 201, 'Account created successfully.', {
    token,
    user: { id: user._id, email: user.email, role: user.role },
  });
});

// POST /api/v1/auth/login
export const login = asyncHandler(async (req, res) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success)
    return sendError(res, 422, 'Validation failed', parsed.error.errors.map((e) => e.message).join('; '));

  const { email, password } = parsed.data;

  const user = await User.findOne({ email }).select('+password');
  if (!user || !(await bcrypt.compare(password, user.password)))
    return sendError(res, 401, 'Invalid email or password.');

  if (!user.isActive)
    return sendError(res, 403, 'This account has been disabled.');

  user.lastLoginAt = new Date();
  await user.save({ validateBeforeSave: false });

  const token = signToken(user._id);
  return sendSuccess(res, 200, 'Login successful.', {
    token,
    user: { id: user._id, email: user.email, role: user.role },
  });
});

// GET /api/v1/auth/me  (protected)
export const getMe = asyncHandler(async (req, res) =>
  sendSuccess(res, 200, 'Authenticated user.', {
    user: { id: req.user._id, email: req.user.email, role: req.user.role },
  })
);
