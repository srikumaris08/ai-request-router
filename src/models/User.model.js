/**
 * @file User.model.js
 * @description Mongoose schema for system users (admins and agents).
 *
 * Design notes:
 *  - Passwords are stored as bcrypt hashes; plaintext is never persisted.
 *  - `role` drives all RBAC decisions across the system.
 *  - Unique index on `email` enforces integrity at the DB layer.
 *  - `isActive` allows soft-disable without deletion (preserves audit refs).
 */

import mongoose from 'mongoose';

const { Schema, model } = mongoose;

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
export const USER_ROLES = Object.freeze({
  ADMIN: 'admin',
  AGENT: 'agent',
});

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------
const userSchema = new Schema(
  {
    email: {
      type: String,
      required: [true, 'Email is required'],
      unique: true,
      lowercase: true,
      trim: true,
      match: [/^\S+@\S+\.\S+$/, 'Please provide a valid email address'],
      index: true,
    },

    password: {
      type: String,
      required: [true, 'Password is required'],
      minlength: [8, 'Password must be at least 8 characters'],
      /**
       * Never return the hashed password in query results by default.
       * Call .select('+password') only when you explicitly need it (e.g., login).
       */
      select: false,
    },

    role: {
      type: String,
      enum: {
        values: Object.values(USER_ROLES),
        message: `Role must be one of: ${Object.values(USER_ROLES).join(', ')}`,
      },
      default: USER_ROLES.AGENT,
    },

    /** Soft-disable a user without breaking foreign-key references in audit logs */
    isActive: {
      type: Boolean,
      default: true,
      index: true,
    },

    /** Track when the user last successfully authenticated */
    lastLoginAt: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: true, // adds createdAt, updatedAt
    collection: 'users',

    // Strip __v from API responses
    versionKey: false,

    // Transform output to remove sensitive fields
    toJSON: {
      virtuals: true,
      transform(_doc, ret) {
        delete ret.password;
        return ret;
      },
    },
    toObject: { virtuals: true },
  }
);

// ---------------------------------------------------------------------------
// Compound Indexes
// ---------------------------------------------------------------------------
// Speeds up admin dashboards that filter by role + active status
userSchema.index({ role: 1, isActive: 1 });

// ---------------------------------------------------------------------------
// Model
// ---------------------------------------------------------------------------
const User = model('User', userSchema);
export default User;
