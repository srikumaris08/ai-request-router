/**
 * @file tests/auth.test.js
 * @description Integration tests for POST /api/v1/auth/register and /login.
 *
 * Mocking strategy:
 *  - MongoDB:   vi.mock on '../src/models/index.js' — no real DB needed.
 *  - Redis:     vi.mock on '../src/config/redis.js'  — prevents IORedis connect.
 *  - BullMQ:    vi.mock on '../src/jobs/queues.js'   — queue never touched here.
 *  - Socket.io: vi.mock on '../src/config/socket.js' — no WS server.
 *  - connectDB: vi.mock on '../src/config/db.js'     — never called.
 *
 * The Express app is imported AFTER all mocks are registered, so every
 * module-level side-effect (new IORedis(), new Queue()) targets the mock.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import bcrypt from 'bcryptjs';

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
    add:   vi.fn().mockResolvedValue({ id: 'mock-job-id' }),
    close: vi.fn().mockResolvedValue(undefined),
  },
  QUEUE_NAMES: { REQUEST_PROCESSING: 'request-processing' },
}));

vi.mock('../src/config/socket.js', () => ({
  initSocket: vi.fn(),
  tryEmit:    vi.fn(),
}));

// ── 2. Mock Mongoose models ───────────────────────────────────────────────────
// We mock each method individually so each test can override them with mockResolvedValue.

const mockUserSave = vi.fn().mockResolvedValue(undefined);

const mockUser = {
  _id:         '6507f1f77bcf86cd799439aa',
  email:       'test@example.com',
  role:        'admin',
  isActive:    true,
  lastLoginAt: null,
  password:    '', // will be set per-test
  save:        mockUserSave,
};

vi.mock('../src/models/index.js', async (importOriginal) => {
  // We still need the real constant exports (REQUEST_STATUS, etc.)
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

// ── 3. Import app AFTER mocks are in place ────────────────────────────────────
// We import the models mock reference too so tests can configure it per-case.
const { default: app }        = await import('../src/app.js');
const { User }                = await import('../src/models/index.js');

// ── Helpers ───────────────────────────────────────────────────────────────────
const REGISTER_URL = '/api/v1/auth/register';
const LOGIN_URL    = '/api/v1/auth/login';

const validRegisterBody = {
  email:    'newuser@example.com',
  password: 'Password123',
  role:     'agent',
};

// ─────────────────────────────────────────────────────────────────────────────
describe('POST /api/v1/auth/register', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ── Test 1 ──────────────────────────────────────────────────────────────────
  it('should register a new user and return 201 with a token', async () => {
    User.findOne.mockResolvedValue(null);   // no duplicate
    User.create.mockResolvedValue({
      _id:   '6507f1f77bcf86cd799439ab',
      email: validRegisterBody.email,
      role:  validRegisterBody.role,
    });

    const res = await request(app).post(REGISTER_URL).send(validRegisterBody);

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toHaveProperty('token');
    expect(res.body.data.user.email).toBe(validRegisterBody.email);
  });

  // ── Test 2 ──────────────────────────────────────────────────────────────────
  it('should return 409 when the email is already registered', async () => {
    User.findOne.mockResolvedValue(mockUser); // duplicate found

    const res = await request(app).post(REGISTER_URL).send(validRegisterBody);

    expect(res.status).toBe(409);
    expect(res.body.success).toBe(false);
  });

  // ── Test 3 ──────────────────────────────────────────────────────────────────
  it('should return 422 for an invalid email format', async () => {
    const res = await request(app).post(REGISTER_URL).send({
      email:    'not-an-email',
      password: 'Password123',
    });

    expect(res.status).toBe(422);
    expect(res.body.success).toBe(false);
  });

  // ── Test 4 ──────────────────────────────────────────────────────────────────
  it('should return 422 when password is too short', async () => {
    const res = await request(app).post(REGISTER_URL).send({
      email:    'user@example.com',
      password: 'short',
    });

    expect(res.status).toBe(422);
    expect(res.body.success).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('POST /api/v1/auth/login', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ── Test 5 ──────────────────────────────────────────────────────────────────
  it('should log in with valid credentials and return 200 with a token', async () => {
    const plainPassword = 'Password123';
    const hashedPassword = await bcrypt.hash(plainPassword, 12);

    const userWithPassword = {
      ...mockUser,
      password: hashedPassword,
    };

    // Simulate Mongoose's .select('+password') chaining
    User.findOne.mockReturnValue({
      select: vi.fn().mockResolvedValue(userWithPassword),
    });
    mockUserSave.mockResolvedValue(undefined);

    const res = await request(app).post(LOGIN_URL).send({
      email:    mockUser.email,
      password: plainPassword,
    });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toHaveProperty('token');
    expect(res.body.data.user.email).toBe(mockUser.email);
  });

  // ── Test 6 ──────────────────────────────────────────────────────────────────
  it('should return 401 for wrong password', async () => {
    const hashedPassword = await bcrypt.hash('correct-password', 12);
    User.findOne.mockReturnValue({
      select: vi.fn().mockResolvedValue({ ...mockUser, password: hashedPassword }),
    });

    const res = await request(app).post(LOGIN_URL).send({
      email:    mockUser.email,
      password: 'wrong-password',
    });

    expect(res.status).toBe(401);
    expect(res.body.success).toBe(false);
  });

  // ── Test 7 ──────────────────────────────────────────────────────────────────
  it('should return 401 when user does not exist', async () => {
    User.findOne.mockReturnValue({
      select: vi.fn().mockResolvedValue(null),
    });

    const res = await request(app).post(LOGIN_URL).send({
      email:    'nobody@example.com',
      password: 'Password123',
    });

    expect(res.status).toBe(401);
    expect(res.body.success).toBe(false);
  });
});
