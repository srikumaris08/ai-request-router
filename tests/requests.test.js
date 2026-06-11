/**
 * @file tests/requests.test.js
 * @description Integration tests for the customer request endpoints:
 *   POST /api/v1/requests        (public — ingest)
 *   GET  /api/v1/requests        (protected — admin/agent list)
 *
 * Mocking strategy: identical to auth.test.js — all external I/O is
 * intercepted via vi.mock() before the app module is imported.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';

// ── 1. Mock all external I/O BEFORE importing the app ────────────────────────

vi.mock('../src/config/db.js', () => ({
  connectDB: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../src/config/redis.js', () => ({
  redisConnection: {
    on:         vi.fn(),
    quit:       vi.fn().mockResolvedValue('OK'),
    disconnect: vi.fn(),
  },
  closeRedis: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../src/jobs/queues.js', () => ({
  requestProcessingQueue: {
    add:   vi.fn().mockResolvedValue({ id: 'mock-job-id-abc' }),
    close: vi.fn().mockResolvedValue(undefined),
  },
  QUEUE_NAMES: { REQUEST_PROCESSING: 'request-processing' },
}));

vi.mock('../src/config/socket.js', () => ({
  initSocket: vi.fn(),
  tryEmit:    vi.fn(),
}));

// ── 2. Mock Mongoose models ───────────────────────────────────────────────────

vi.mock('../src/models/index.js', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    User: {
      findOne:    vi.fn(),
      findById:   vi.fn(),
      create:     vi.fn(),
    },
    CustomerRequest: {
      find:           vi.fn(),
      findById:       vi.fn(),
      create:         vi.fn(),
      countDocuments: vi.fn(),
    },
    RequestEvent: {
      find:   vi.fn(),
      create: vi.fn().mockResolvedValue({}),
    },
    InternalNote: {
      find:   vi.fn(),
      create: vi.fn(),
    },
  };
});

// ── 3. Import app + mocked modules AFTER mocks are registered ─────────────────
const { default: app }                 = await import('../src/app.js');
const { User, CustomerRequest }        = await import('../src/models/index.js');
const { requestProcessingQueue }       = await import('../src/jobs/queues.js');

// ── Helpers ───────────────────────────────────────────────────────────────────
const INGEST_URL = '/api/v1/requests';
const LIST_URL   = '/api/v1/requests';

/** Signs a JWT using the same secret the app uses in tests (set by setup.js) */
const signTestToken = (userId = '6507f1f77bcf86cd799439aa', role = 'admin') =>
  jwt.sign({ id: userId }, process.env.JWT_SECRET, { expiresIn: '1h' });

const validIngestBody = {
  originalMessage: 'My internet connection keeps dropping every few hours.',
  sourceChannel:   'email',
  customer: {
    name:  'Jane Doe',
    email: 'jane@example.com',
  },
};

// Fake Mongoose document returned by CustomerRequest.create
const fakeSavedRequest = {
  _id:             '6507f1f77bcf86cd799439cc',
  originalMessage: validIngestBody.originalMessage,
  sourceChannel:   'email',
  status:          'queued',
  categorySnapshot: null,
  prioritySnapshot: null,
  customer:        validIngestBody.customer,
  metadata:        {},
  createdAt:       new Date().toISOString(),
  updatedAt:       new Date().toISOString(),
  toJSON() { return { ...this }; },
};

// ─────────────────────────────────────────────────────────────────────────────
describe('POST /api/v1/requests  (public ingest endpoint)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset default mock so each test starts fresh
    requestProcessingQueue.add.mockResolvedValue({ id: 'mock-job-id-abc' });
  });

  // ── Test 1 ──────────────────────────────────────────────────────────────────
  it('should accept a valid request, return 202 and indicate job was queued', async () => {
    CustomerRequest.create.mockResolvedValue(fakeSavedRequest);

    const res = await request(app).post(INGEST_URL).send(validIngestBody);

    expect(res.status).toBe(202);
    expect(res.body.success).toBe(true);
    expect(res.body.data.jobQueued).toBe(true);
    expect(res.body.data.request).toHaveProperty('_id');

    // Verify the queue was actually called once with the right requestId
    expect(requestProcessingQueue.add).toHaveBeenCalledTimes(1);
    expect(requestProcessingQueue.add).toHaveBeenCalledWith(
      expect.stringContaining('classify-'),
      expect.objectContaining({ requestId: fakeSavedRequest._id }),
      expect.objectContaining({ jobId: fakeSavedRequest._id }),
    );
  });

  // ── Test 2 ──────────────────────────────────────────────────────────────────
  it('should return 422 when originalMessage is missing', async () => {
    const res = await request(app).post(INGEST_URL).send({
      sourceChannel: 'email',
      // originalMessage intentionally omitted
    });

    expect(res.status).toBe(422);
    expect(res.body.success).toBe(false);
    // Queue must NOT have been called
    expect(requestProcessingQueue.add).not.toHaveBeenCalled();
  });

  // ── Test 3 ──────────────────────────────────────────────────────────────────
  it('should return 422 for an invalid sourceChannel value', async () => {
    const res = await request(app).post(INGEST_URL).send({
      originalMessage: 'Test message',
      sourceChannel:   'fax', // not in the allowed enum
    });

    expect(res.status).toBe(422);
    expect(res.body.success).toBe(false);
    expect(requestProcessingQueue.add).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('GET /api/v1/requests  (protected admin/agent list)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ── Test 4 ──────────────────────────────────────────────────────────────────
  it('should return 401 when no Authorization header is sent', async () => {
    const res = await request(app).get(LIST_URL);

    expect(res.status).toBe(401);
    expect(res.body.success).toBe(false);
  });

  // ── Test 5 ──────────────────────────────────────────────────────────────────
  it('should return 401 when a fake/invalid token is sent', async () => {
    const res = await request(app)
      .get(LIST_URL)
      .set('Authorization', 'Bearer this.is.not.a.real.token');

    expect(res.status).toBe(401);
    expect(res.body.success).toBe(false);
  });

  // ── Test 6 ──────────────────────────────────────────────────────────────────
  it('should return 200 with paginated results when a valid JWT is provided', async () => {
    const userId = '6507f1f77bcf86cd799439aa';
    const token  = signTestToken(userId, 'admin');

    // protect middleware calls User.findById(decoded.id)
    User.findById.mockResolvedValue({
      _id:      userId,
      email:    'admin@example.com',
      role:     'admin',
      isActive: true,
    });

    // listRequests controller calls CustomerRequest.find(...).sort().skip().limit().populate()
    const mockQueryChain = {
      sort:     vi.fn().mockReturnThis(),
      skip:     vi.fn().mockReturnThis(),
      limit:    vi.fn().mockReturnThis(),
      populate: vi.fn().mockResolvedValue([]), // resolves to empty array
    };
    CustomerRequest.find.mockReturnValue(mockQueryChain);
    CustomerRequest.countDocuments.mockResolvedValue(0);

    const res = await request(app)
      .get(LIST_URL)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toHaveProperty('requests');
    expect(res.body.data).toHaveProperty('pagination');
    expect(Array.isArray(res.body.data.requests)).toBe(true);
    expect(res.body.data.pagination).toMatchObject({
      total: 0,
      page:  1,
    });
  });
});
