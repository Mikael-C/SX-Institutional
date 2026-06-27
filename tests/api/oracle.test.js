/**
 * Integration Tests: Oracle Route
 * Tests oracle price, TWAP, and dispute endpoints.
 */

// ─── Mock Setup ───────────────────────────────────────────────────────────────
const mockOracleFindAll  = jest.fn();
const mockOracleFindOne  = jest.fn();
const mockOracleCount    = jest.fn();
const mockOracleBulkCreate = jest.fn();
const mockDisputeFindAll = jest.fn();
const mockDisputeCreate  = jest.fn();
const mockPriceUpdate    = jest.fn();
const mockBroadcast      = jest.fn();

jest.mock('../../src/models', () => ({
  OraclePrice: {
    findAll:    (...args) => mockOracleFindAll(...args),
    findOne:    (...args) => mockOracleFindOne(...args),
    count:      (...args) => mockOracleCount(...args),
    bulkCreate: (...args) => mockOracleBulkCreate(...args)
  },
  Dispute: {
    findAll: (...args) => mockDisputeFindAll(...args),
    create:  (...args) => mockDisputeCreate(...args)
  }
}));
jest.mock('../../src/websocket/ws', () => ({ broadcast: (...args) => mockBroadcast(...args) }));

const request = require('supertest');
const express = require('express');
const oracleRoutes = require('../../src/routes/oracle');

const app = express();
app.use(express.json());
app.use('/api/oracle', oracleRoutes);

// Helper: build mock price records for a given asset
function makePriceRecords(asset, prices = [3500]) {
  return prices.map((price, i) => ({
    id: `price-${i}`,
    asset,
    feedId: `${asset.toLowerCase()}_chainlink_abc${i}`,
    price: price.toString(),
    chain: i % 2 === 0 ? 'Hoodi' : 'Base Sepolia',
    isDisputed: false,
    timestamp: new Date(),
    update: mockPriceUpdate
  }));
}

beforeEach(() => {
  jest.clearAllMocks();
  mockPriceUpdate.mockResolvedValue({});
  mockOracleBulkCreate.mockResolvedValue([]);
  mockDisputeCreate.mockResolvedValue({ id: 'dispute-1', asset: 'ETH', status: 'Active', deviation: 15 });
});

// ─── GET /api/oracle/prices ────────────────────────────────────────────────────

describe('GET /api/oracle/prices', () => {
  test('returns aggregated prices object', async () => {
    const ethPrices = makePriceRecords('ETH', [3490, 3500, 3510]);
    const btcPrices = makePriceRecords('BTC', [64900, 65000, 65100]);
    mockOracleFindAll.mockResolvedValue([...ethPrices, ...btcPrices]);

    const res = await request(app).get('/api/oracle/prices');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toBeDefined();
    expect(res.body.totalAssets).toBeGreaterThan(0);
    expect(res.body.timestamp).toBeDefined();
  });

  test('includes ETH in aggregated data', async () => {
    mockOracleFindAll.mockResolvedValue(makePriceRecords('ETH', [3490, 3500, 3510]));

    const res = await request(app).get('/api/oracle/prices');

    expect(res.body.data).toHaveProperty('ETH');
    expect(res.body.data.ETH).toHaveProperty('medianPrice');
  });

  test('returns 500 on DB error', async () => {
    mockOracleFindAll.mockRejectedValue(new Error('DB Error'));

    const res = await request(app).get('/api/oracle/prices');

    expect(res.status).toBe(500);
    expect(res.body.success).toBe(false);
  });
});

// ─── GET /api/oracle/prices/:asset ────────────────────────────────────────────

describe('GET /api/oracle/prices/:asset', () => {
  test('returns specific asset price data', async () => {
    mockOracleFindAll.mockResolvedValue(makePriceRecords('ETH', [3490, 3500, 3510]));

    const res = await request(app).get('/api/oracle/prices/ETH');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.asset).toBe('ETH');
    expect(res.body.data.medianPrice).toBeGreaterThan(0);
    expect(res.body.data.feeds).toBeInstanceOf(Array);
  });

  test('calculates correct median for odd number of feeds', async () => {
    mockOracleFindAll.mockResolvedValue(makePriceRecords('ETH', [3400, 3500, 3600]));

    const res = await request(app).get('/api/oracle/prices/ETH');

    expect(res.body.data.medianPrice).toBe(3500);
  });

  test('calculates correct median for even number of feeds', async () => {
    mockOracleFindAll.mockResolvedValue(makePriceRecords('ETH', [3400, 3500, 3600, 3700]));

    const res = await request(app).get('/api/oracle/prices/ETH');

    expect(res.body.data.medianPrice).toBeCloseTo(3550, 1);
  });

  test('handles case-insensitive asset symbol', async () => {
    mockOracleFindAll.mockResolvedValue(makePriceRecords('ETH', [3500]));

    const res = await request(app).get('/api/oracle/prices/eth');

    expect(res.status).toBe(200);
    expect(res.body.data.asset).toBe('ETH');
  });

  test('returns 404 for unknown asset', async () => {
    mockOracleFindAll.mockResolvedValue([]); // No records

    const res = await request(app).get('/api/oracle/prices/UNKNOWN');

    expect(res.status).toBe(404);
    expect(res.body.success).toBe(false);
    expect(res.body.error).toContain('No price data found');
  });

  test('includes twapPrice in response', async () => {
    mockOracleFindAll.mockResolvedValue(makePriceRecords('ETH', [3490, 3500, 3510]));

    const res = await request(app).get('/api/oracle/prices/ETH');

    expect(res.body.data).toHaveProperty('twapPrice');
  });

  test('includes isDisputed flag', async () => {
    mockOracleFindAll.mockResolvedValue(makePriceRecords('ETH', [3500]));

    const res = await request(app).get('/api/oracle/prices/ETH');

    expect(res.body.data).toHaveProperty('isDisputed');
  });
});

// ─── GET /api/oracle/disputes ─────────────────────────────────────────────────

describe('GET /api/oracle/disputes', () => {
  test('returns active disputes list', async () => {
    mockDisputeFindAll.mockResolvedValue([
      { id: 'dispute-1', asset: 'ETH', status: 'Active', deviation: 15 },
      { id: 'dispute-2', asset: 'BTC', status: 'Active', deviation: 12 }
    ]);

    const res = await request(app).get('/api/oracle/disputes');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toHaveLength(2);
    expect(res.body.count).toBe(2);
  });

  test('returns empty list when no disputes', async () => {
    mockDisputeFindAll.mockResolvedValue([]);

    const res = await request(app).get('/api/oracle/disputes');

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(0);
    expect(res.body.count).toBe(0);
  });

  test('returns 500 on DB error', async () => {
    mockDisputeFindAll.mockRejectedValue(new Error('DB Error'));

    const res = await request(app).get('/api/oracle/disputes');

    expect(res.status).toBe(500);
  });
});

// ─── POST /api/oracle/simulate-dispute ────────────────────────────────────────

describe('POST /api/oracle/simulate-dispute', () => {
  test('triggers dispute for ETH by default', async () => {
    const feed = makePriceRecords('ETH', [3500])[0];
    feed.update = jest.fn().mockResolvedValue({});
    mockOracleFindOne.mockResolvedValue(feed);

    const res = await request(app)
      .post('/api/oracle/simulate-dispute')
      .send({});

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.message).toContain('ETH');
    expect(res.body.data.deviation).toContain('%');
  });

  test('triggers dispute for specified asset', async () => {
    const feed = makePriceRecords('BTC', [65000])[0];
    feed.update = jest.fn().mockResolvedValue({});
    mockOracleFindOne.mockResolvedValue(feed);

    const res = await request(app)
      .post('/api/oracle/simulate-dispute')
      .send({ asset: 'BTC' });

    expect(res.status).toBe(200);
    expect(res.body.data.message).toContain('BTC');
  });

  test('bad price is 15% above original', async () => {
    const feed = makePriceRecords('ETH', [3500])[0];
    feed.update = jest.fn().mockResolvedValue({});
    mockOracleFindOne.mockResolvedValue(feed);

    const res = await request(app)
      .post('/api/oracle/simulate-dispute')
      .send({ asset: 'ETH' });

    expect(res.body.data.originalPrice).toBe(3500);
    expect(res.body.data.badPrice).toBeCloseTo(3500 * 1.15, 1);
  });

  test('returns 404 when no undisputed feed found', async () => {
    mockOracleFindOne.mockResolvedValue(null);

    const res = await request(app)
      .post('/api/oracle/simulate-dispute')
      .send({ asset: 'ETH' });

    expect(res.status).toBe(404);
    expect(res.body.error).toContain('No undisputed feed');
  });

  test('broadcasts dispute event', async () => {
    const feed = makePriceRecords('ETH', [3500])[0];
    feed.update = jest.fn().mockResolvedValue({});
    mockOracleFindOne.mockResolvedValue(feed);

    await request(app).post('/api/oracle/simulate-dispute').send({});

    expect(mockBroadcast).toHaveBeenCalledWith('prices', expect.objectContaining({
      type: 'dispute'
    }));
  });
});

// ─── POST /api/oracle/simulate-twap ──────────────────────────────────────────

describe('POST /api/oracle/simulate-twap', () => {
  test('returns TWAP fallback data for ETH', async () => {
    const feeds = makePriceRecords('ETH', [3490, 3500, 3510]);
    feeds.forEach(f => { f.update = jest.fn().mockResolvedValue({}); });
    mockOracleFindAll.mockResolvedValue(feeds);

    const res = await request(app)
      .post('/api/oracle/simulate-twap')
      .send({ asset: 'ETH' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.fallbackActive).toBe(true);
    expect(res.body.data.failedFeeds).toBe(3);
  });

  test('returns 404 when no feeds found', async () => {
    mockOracleFindAll.mockResolvedValue([]);

    const res = await request(app)
      .post('/api/oracle/simulate-twap')
      .send({ asset: 'UNKNOWN' });

    expect(res.status).toBe(404);
    expect(res.body.error).toContain('No feeds found');
  });

  test('broadcasts TWAP fallback event', async () => {
    const feeds = makePriceRecords('ETH', [3500]);
    feeds.forEach(f => { f.update = jest.fn().mockResolvedValue({}); });
    mockOracleFindAll.mockResolvedValue(feeds);

    await request(app).post('/api/oracle/simulate-twap').send({ asset: 'ETH' });

    expect(mockBroadcast).toHaveBeenCalledWith('prices', expect.objectContaining({
      type: 'twap_fallback'
    }));
  });

  test('defaults to ETH when no asset provided', async () => {
    const feeds = makePriceRecords('ETH', [3500]);
    feeds.forEach(f => { f.update = jest.fn().mockResolvedValue({}); });
    mockOracleFindAll.mockResolvedValue(feeds);

    const res = await request(app)
      .post('/api/oracle/simulate-twap')
      .send({});

    expect(res.status).toBe(200);
    expect(res.body.data.asset).toBe('ETH');
  });
});
