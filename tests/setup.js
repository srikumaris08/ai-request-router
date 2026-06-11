/**
 * @file tests/setup.js
 * @description Global test setup — runs once before any test file.
 * Injects environment variables required by the app so tests are
 * fully self-contained and never depend on a .env file being present.
 */

// Minimal env required by auth middleware and controllers
process.env.NODE_ENV    = 'test';
process.env.JWT_SECRET  = 'test-secret-key-for-vitest-only';
process.env.JWT_EXPIRES_IN = '1h';
process.env.MONGO_URI   = 'mongodb://localhost:27017/test_db'; // never actually connected
process.env.REDIS_URL   = 'redis://localhost:6379';            // never actually connected
process.env.PORT        = '5001';
