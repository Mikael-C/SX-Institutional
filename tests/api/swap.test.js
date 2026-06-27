/**
 * Integration Tests: Swap Route
 * Mocks DB and WebSocket to test all swap route logic
 */

// ─── Mock Setup ───────────────────────────────────────────────────────────────
const mockSwapCreate  = jest.fn();
const mockRewardCreate = jest.fn();
const mockUserFindOrCreate = jest.fn();
const mockUserFindOne  = jest.fn();
const mockSwapFindAll  = jest.fn();
const mockBroadcast    = jest.fn();

jest.mock('../../src/models', () => ({
  User:   { findOrCreate: (...args) => mockUserFindOrCreate(...args), findOne: (...args) => mockUserFindOne(...args) },
  Swap:   { create: (...args) => mockSwapCreate(...args), findAll: (...args) => mockSwapFindAll(...args) },
  Reward: { create: (...args) => mockRewardCreate(...args) }
}));

jest.mock('../../src/websocket/ws', () => ({ broadcast: (...args) => mockBroadcast(...args) }));

const request = require('supertest');
const express = require('express');

let swapRoutes;

// Helper: mock user
const MOCK_USER = { id: 'user-1', walletAddress: '0xabc' };
// Helper: mock swap record
const makeMockSwap = (overrides = {}) => ({
  id: 'swap-1', userId: 'user-1', tokenIn: 'ETH', tokenOut: 'USDC',
  amountIn: 1, amountOut: 3489.5, source: 'SX Internal Pool - Hoodi',
  txHash: '0xabc', chain: 'Hoodi', createdAt: new Date().toISOString(),
  ...overrides
});

beforeEach(() => {
  jest.clearAllMocks();
  jest.resetModules();

  // Re-mock after resetModules
  jest.mock('../../src/models', () => ({
    User:   { findOrCreate: (...args) => mockUserFindOrCreate(...args), findOne: (...args) => mockUserFindOne(...args) },
    Swap:   { create: (...args) => mockSwapCreate(...args), findAll: (...args) => mockSwapFindAll(...args) },
    Reward: { create: (...args) => mockRewardCreate(...args) }
  }));
  jest.mock('../../src/websocket/ws', () => ({ broadcast: (...args) => mockBroadcast(...args) }));
});

// Build the express app fresh for each suite
function buildApp() {
  const r = require('../../src/routes/swap');
  const a = express();
  a.use(express.json());
  a.use('/api/swap', r);
  return a;
}

// ─── POST /api/swap/quote ─────────────────────────────────────────────────────

describe('POST /api/swap/quote', () => {
  let app;
  beforeAll(() => {
    mockUserFindOrCreate.mockResolvedValue([MOCK_USER]);
    mockSwapCreate.mockResolvedValue(makeMockSwap());
    mockRewardCreate.mockResolvedValue({});
    swapRoutes = require('../../src/routes/swap');
    app = express();
    app.use(express.json());
    app.use('/api/swap', swapRoutes);
  });

  test('returns valid quote for ETH→USDC', async () => {
    const res = await request(app)
      .post('/api/swap/quote')
      .send({ tokenIn: 'ETH', tokenOut: 'USDC', amountIn: 1 });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.tokenIn).toBe('ETH');
    expect(res.body.data.tokenOut).toBe('USDC');
    expect(res.body.data.amountOut).toBeGreaterThan(0);
    expect(res.body.data.rate).toBeGreaterThan(0);
  });

  test('applies 0.3% slippage', async () => {
    const res = await request(app)
      .post('/api/swap/quote')
      .send({ tokenIn: 'ETH', tokenOut: 'USDC', amountIn: 1 });

    expect(res.body.data.slippage).toBe('0.3%');
  });

  test('returns 400 for missing tokenIn', async () => {
    const res = await request(app)
      .post('/api/swap/quote')
      .send({ tokenOut: 'USDC', amountIn: 1 });

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });

  test('returns 400 for missing tokenOut', async () => {
    const res = await request(app)
      .post('/api/swap/quote')
      .send({ tokenIn: 'ETH', amountIn: 1 });

    expect(res.status).toBe(400);
  });

  test('returns 400 for missing amountIn', async () => {
    const res = await request(app)
      .post('/api/swap/quote')
      .send({ tokenIn: 'ETH', tokenOut: 'USDC' });

    expect(res.status).toBe(400);
  });

  test('returns 400 for unsupported tokenIn', async () => {
    const res = await request(app)
      .post('/api/swap/quote')
      .send({ tokenIn: 'FAKE', tokenOut: 'USDC', amountIn: 1 });

    expect(res.status).toBe(400);
    expect(res.body.error).toContain('Unsupported token');
  });

  test('returns 400 for unsupported tokenOut', async () => {
    const res = await request(app)
      .post('/api/swap/quote')
      .send({ tokenIn: 'ETH', tokenOut: 'MOON', amountIn: 1 });

    expect(res.status).toBe(400);
  });

  test('returns 400 for zero amountIn', async () => {
    const res = await request(app)
      .post('/api/swap/quote')
      .send({ tokenIn: 'ETH', tokenOut: 'USDC', amountIn: 0 });

    expect(res.status).toBe(400);
    expect(res.body.error).toContain('positive number');
  });

  test('returns 400 for negative amountIn', async () => {
    const res = await request(app)
      .post('/api/swap/quote')
      .send({ tokenIn: 'ETH', tokenOut: 'USDC', amountIn: -1 });

    expect(res.status).toBe(400);
  });

  test('response includes sxrReward', async () => {
    const res = await request(app)
      .post('/api/swap/quote')
      .send({ tokenIn: 'ETH', tokenOut: 'USDC', amountIn: 1 });

    expect(res.body.data).toHaveProperty('sxrReward');
    expect(res.body.data.sxrReward).toBeGreaterThan(0);
  });

  test('response includes estimatedGas', async () => {
    const res = await request(app)
      .post('/api/swap/quote')
      .send({ tokenIn: 'ETH', tokenOut: 'USDC', amountIn: 1 });

    expect(res.body.data.estimatedGas).toBe('0.0025 ETH');
  });

  test('response includes expiresIn', async () => {
    const res = await request(app)
      .post('/api/swap/quote')
      .send({ tokenIn: 'ETH', tokenOut: 'USDC', amountIn: 1 });

    expect(res.body.data.expiresIn).toBe('30 seconds');
  });

  test('handles lowercase token symbols', async () => {
    const res = await request(app)
      .post('/api/swap/quote')
      .send({ tokenIn: 'eth', tokenOut: 'usdc', amountIn: 1 });

    expect(res.status).toBe(200);
    expect(res.body.data.tokenIn).toBe('ETH');
  });

  test('large trade has higher price impact', async () => {
    const small = await request(app)
      .post('/api/swap/quote')
      .send({ tokenIn: 'ETH', tokenOut: 'USDC', amountIn: 1 });
    const large = await request(app)
      .post('/api/swap/quote')
      .send({ tokenIn: 'ETH', tokenOut: 'USDC', amountIn: 100 });

    const smallImpact = parseFloat(small.body.data.priceImpact);
    const largeImpact = parseFloat(large.body.data.priceImpact);
    expect(largeImpact).toBeGreaterThanOrEqual(smallImpact);
  });
});

// ─── GET /api/swap/history/:address ─────────────────────────────────────────

describe('GET /api/swap/history/:address', () => {
  let app;
  beforeAll(() => {
    swapRoutes = require('../../src/routes/swap');
    app = express();
    app.use(express.json());
    app.use('/api/swap', swapRoutes);
  });

  test('returns empty array for unknown wallet', async () => {
    mockUserFindOne.mockResolvedValueOnce(null);

    const res = await request(app)
      .get('/api/swap/history/0xunknown');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toEqual([]);
    expect(res.body.count).toBe(0);
  });

  test('returns swap history for known wallet', async () => {
    mockUserFindOne.mockResolvedValueOnce(MOCK_USER);
    mockSwapFindAll.mockResolvedValueOnce([makeMockSwap()]);

    const res = await request(app)
      .get('/api/swap/history/0xabc');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.count).toBe(1);
  });

  test('returned swap has correct fields', async () => {
    mockUserFindOne.mockResolvedValueOnce(MOCK_USER);
    mockSwapFindAll.mockResolvedValueOnce([makeMockSwap()]);

    const res = await request(app)
      .get('/api/swap/history/0xabc');

    const swap = res.body.data[0];
    expect(swap).toHaveProperty('id');
    expect(swap).toHaveProperty('tokenIn');
    expect(swap).toHaveProperty('tokenOut');
    expect(swap).toHaveProperty('amountIn');
    expect(swap).toHaveProperty('amountOut');
    expect(swap).toHaveProperty('txHash');
    expect(swap).toHaveProperty('chain');
    expect(swap).toHaveProperty('timestamp');
  });

  test('returns 500 on DB error', async () => {
    mockUserFindOne.mockRejectedValueOnce(new Error('DB connection failed'));

    const res = await request(app)
      .get('/api/swap/history/0xabc');

    expect(res.status).toBe(500);
    expect(res.body.success).toBe(false);
  });
});
