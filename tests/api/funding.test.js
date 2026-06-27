/**
 * Integration Tests: Funding Route
 * Tests all funding endpoints with DB mocking.
 */

// ─── Mock Setup ───────────────────────────────────────────────────────────────
const mockUserFindOne         = jest.fn();
const mockPositionFindAll     = jest.fn();
const mockPositionFindOne     = jest.fn();
const mockFundingFindAll      = jest.fn();
const mockFundingCreate       = jest.fn();
const mockBroadcast           = jest.fn();
const mockPositionUpdate      = jest.fn();

jest.mock('../../src/models', () => ({
  User: { findOne: (...args) => mockUserFindOne(...args) },
  LeveragedPosition: {
    findAll: (...args) => mockPositionFindAll(...args),
    findOne: (...args) => mockPositionFindOne(...args)
  },
  FundingHistory: {
    findAll: (...args) => mockFundingFindAll(...args),
    create:  (...args) => mockFundingCreate(...args)
  }
}));
jest.mock('../../src/websocket/ws', () => ({ broadcast: (...args) => mockBroadcast(...args) }));

const request = require('supertest');
const express = require('express');
const fundingRoutes = require('../../src/routes/funding');

const app = express();
app.use(express.json());
app.use('/api/funding', fundingRoutes);

const MOCK_USER = { id: 'user-fund-1', walletAddress: '0xfund' };

const makePosition = (overrides = {}) => ({
  id: 'pos-1',
  userId: 'user-fund-1',
  asset: 'ETH',
  amount: '2',
  currentPrice: '3500',
  entryPrice: '3000',
  margin: '500',
  leverage: 5,
  status: 'Open',
  protection: false,
  liquidationPrice: '2500',
  chain: 'Hoodi',
  update: mockPositionUpdate,
  ...overrides
});

beforeEach(() => {
  jest.clearAllMocks();
  mockPositionUpdate.mockResolvedValue({});
  mockFundingCreate.mockResolvedValue({ id: 'funding-1' });
});

// ─── GET /api/funding/ ────────────────────────────────────────────────────────

describe('GET /api/funding/', () => {
  test('returns funding dashboard data', async () => {
    const res = await request(app).get('/api/funding/');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.currentRate).toBeDefined();
    expect(res.body.totalPaid).toBeDefined();
    expect(res.body.nextDeduction).toBeDefined();
    expect(Array.isArray(res.body.history)).toBe(true);
  });

  test('returns 5 history items', async () => {
    const res = await request(app).get('/api/funding/');
    expect(res.body.history).toHaveLength(5);
  });
});

// ─── GET /api/funding/rate/:asset ─────────────────────────────────────────────

describe('GET /api/funding/rate/:asset', () => {
  test('returns ETH funding rate data', async () => {
    const res = await request(app).get('/api/funding/rate/ETH');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.asset).toBe('ETH');
    expect(res.body.data.currentRate).toBe(0.0001);
    expect(res.body.data.direction).toBe('long_pays_short');
  });

  test('handles lowercase asset symbol', async () => {
    const res = await request(app).get('/api/funding/rate/eth');

    expect(res.status).toBe(200);
    expect(res.body.data.asset).toBe('ETH');
  });

  test('returns BTC funding data', async () => {
    const res = await request(app).get('/api/funding/rate/BTC');

    expect(res.status).toBe(200);
    expect(res.body.data.currentRate).toBe(0.00008);
  });

  test('returns 404 for unsupported asset', async () => {
    const res = await request(app).get('/api/funding/rate/UNKNOWN');

    expect(res.status).toBe(404);
    expect(res.body.success).toBe(false);
    expect(res.body.error).toContain('No funding rate');
  });

  test('includes annualized rate', async () => {
    const res = await request(app).get('/api/funding/rate/ETH');
    expect(res.body.data.annualizedRate).toBeDefined();
  });

  test('includes deductionInterval of 8 hours', async () => {
    const res = await request(app).get('/api/funding/rate/ETH');
    expect(res.body.data.deductionInterval).toBe('8 hours');
  });

  test('includes nextDeduction countdown', async () => {
    const res = await request(app).get('/api/funding/rate/ETH');
    expect(res.body.data.nextDeduction).toHaveProperty('remainingMinutes');
    expect(res.body.data.nextDeduction).toHaveProperty('intervalHours', 8);
  });
});

// ─── GET /api/funding/next-deduction ──────────────────────────────────────────

describe('GET /api/funding/next-deduction', () => {
  test('returns countdown to next deduction', async () => {
    const res = await request(app).get('/api/funding/next-deduction');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.remainingMinutes).toBeGreaterThan(0);
    expect(res.body.data.intervalHours).toBe(8);
  });

  test('includes all rate pairs', async () => {
    const res = await request(app).get('/api/funding/next-deduction');
    const assets = res.body.data.allRates.map(r => r.asset);
    expect(assets).toContain('ETH');
    expect(assets).toContain('BTC');
    expect(assets).toContain('SOL');
  });

  test('each rate entry has required fields', async () => {
    const res = await request(app).get('/api/funding/next-deduction');
    const first = res.body.data.allRates[0];
    expect(first).toHaveProperty('asset');
    expect(first).toHaveProperty('rate');
    expect(first).toHaveProperty('ratePercent');
    expect(first).toHaveProperty('direction');
  });
});

// ─── GET /api/funding/history/:positionId ─────────────────────────────────────

describe('GET /api/funding/history/:positionId', () => {
  test('returns funding history for a position', async () => {
    mockFundingFindAll.mockResolvedValue([
      { id: 'f1', amount: '0.7', rate: '0.0001', marginAfter: '499.3', createdAt: new Date() },
      { id: 'f2', amount: '0.65', rate: '0.0001', marginAfter: '498.65', createdAt: new Date() }
    ]);

    const res = await request(app).get('/api/funding/history/pos-1');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.deductions).toHaveLength(2);
    expect(res.body.data.deductionCount).toBe(2);
    expect(res.body.data.totalDeducted).toBeCloseTo(1.35, 2);
  });

  test('returns empty history for new position', async () => {
    mockFundingFindAll.mockResolvedValue([]);

    const res = await request(app).get('/api/funding/history/new-pos');

    expect(res.status).toBe(200);
    expect(res.body.data.deductions).toHaveLength(0);
    expect(res.body.data.totalDeducted).toBe(0);
  });

  test('returns 500 on DB error', async () => {
    mockFundingFindAll.mockRejectedValue(new Error('DB Error'));

    const res = await request(app).get('/api/funding/history/pos-1');

    expect(res.status).toBe(500);
  });
});

// ─── POST /api/funding/apply ──────────────────────────────────────────────────

describe('POST /api/funding/apply', () => {
  test('applies funding for a specific positionId', async () => {
    const pos = makePosition();
    pos.update = jest.fn().mockResolvedValue({});
    mockPositionFindOne.mockResolvedValue(pos);

    const res = await request(app)
      .post('/api/funding/apply')
      .send({ positionId: 'pos-1' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.deductions).toHaveLength(1);
    expect(res.body.data.deductions[0].positionId).toBe('pos-1');
  });

  test('applies funding by walletAddress', async () => {
    const pos = makePosition();
    pos.update = jest.fn().mockResolvedValue({});
    mockUserFindOne.mockResolvedValue(MOCK_USER);
    mockPositionFindAll.mockResolvedValue([pos]);

    const res = await request(app)
      .post('/api/funding/apply')
      .send({ walletAddress: '0xfund' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  test('returns 400 when neither walletAddress nor positionId provided', async () => {
    const res = await request(app).post('/api/funding/apply').send({});

    expect(res.status).toBe(400);
    expect(res.body.error).toContain('Provide walletAddress or positionId');
  });

  test('returns 404 when user not found by walletAddress', async () => {
    mockUserFindOne.mockResolvedValue(null);

    const res = await request(app)
      .post('/api/funding/apply')
      .send({ walletAddress: '0xunknown' });

    expect(res.status).toBe(404);
    expect(res.body.error).toBe('User not found');
  });

  test('returns 404 when no open positions found', async () => {
    mockPositionFindOne.mockResolvedValue(null);

    const res = await request(app)
      .post('/api/funding/apply')
      .send({ positionId: 'nonexistent' });

    expect(res.status).toBe(404);
    expect(res.body.error).toContain('No open positions');
  });

  test('liquidates position when margin <= deduction', async () => {
    const pos = makePosition({ margin: '0.0001' }); // tiny margin
    pos.update = jest.fn().mockResolvedValue({});
    mockPositionFindOne.mockResolvedValue(pos);

    const res = await request(app)
      .post('/api/funding/apply')
      .send({ positionId: 'pos-1' });

    expect(res.status).toBe(200);
    const deduction = res.body.data.deductions[0];
    expect(deduction.liquidated).toBe(true);
    expect(deduction.marginAfter).toBe(0);
  });

  test('broadcasts funding event after successful deduction', async () => {
    const pos = makePosition();
    pos.update = jest.fn().mockResolvedValue({});
    mockPositionFindOne.mockResolvedValue(pos);

    await request(app).post('/api/funding/apply').send({ positionId: 'pos-1' });

    expect(mockBroadcast).toHaveBeenCalledWith('funding', expect.objectContaining({
      type: 'funding_deducted'
    }));
  });
});
