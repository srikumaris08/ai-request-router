/**
 * @file customerRequest.validator.js  (src/validators)
 */
import { z }              from 'zod';
import { SOURCE_CHANNELS, REQUEST_STATUS } from '../models/index.js';

export const ingestRequestSchema = z.object({
  originalMessage: z.string().min(1, 'originalMessage is required').max(5000),
  sourceChannel:   z.enum(Object.values(SOURCE_CHANNELS), {
    errorMap: () => ({ message: `sourceChannel must be one of: ${Object.values(SOURCE_CHANNELS).join(', ')}` }),
  }),
  customer: z.object({
    name:       z.string().trim().optional(),
    email:      z.string().email().optional(),
    phone:      z.string().optional(),
    externalId: z.string().optional(),
  }).optional(),
  metadata: z.record(z.unknown()).optional(),
});

export const updateStatusSchema = z.object({
  status: z.enum(Object.values(REQUEST_STATUS), {
    errorMap: () => ({ message: `status must be one of: ${Object.values(REQUEST_STATUS).join(', ')}` }),
  }),
});

export const addNoteSchema = z.object({
  noteBody: z.string().min(1, 'noteBody is required').max(10000),
  metadata: z.record(z.unknown()).optional(),
});
