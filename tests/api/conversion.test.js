/**
 * Integration Tests: Conversion Route
 * Tests /api/conversion endpoints (no DB required)
 */

// Mock heavy modules that are NOT needed for conversion routes
jest.mock('../../src/models', () => ({}));
jest.mock('../../src/websocket/ws', () => ({ broadcast: jest.fn() }));

const request = require('supertest');
const express = require('express');
const conversionRoutes = require('../../src/routes/conversion');

const app = express();
app.use(express.json());
app.use('/api/conversion', conversionRoutes);

describe('POST /api/conversion/convert', () => {
  test('converts SXR to ETH successfully', async () => {
    const res = await request(app)
      .post('/api/conversion/convert')
      .send({ sxrAmount: 1000, targetToken: 'ETH' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.conversion.targetToken).toBe('ETH');
    expect(res.body.data.conversion.sxrAmount).toBe(1000);
    expect(res.body.data.conversion.outputAmount).toBeCloseTo(0.143, 3);
    expect(res.body.data.staking.apy).toBe('44%');
  });

  test('converts SXR to BTC', async () => {
    const res = await request(app)
      .post('/api/conversion/convert')
      .send({ sxrAmount: 1000, targetToken: 'BTC' });

    expect(res.status).toBe(200);
    expect(res.body.data.conversion.targetToken).toBe('BTC');
    expect(res.body.data.conversion.outputAmount).toBeCloseTo(0.0077, 4);
  });

  test('converts SXR to ECUBES', async () => {
    const res = await request(app)
      .post('/api/conversion/convert')
      .send({ sxrAmount: 500, targetToken: 'ECUBES' });

    expect(res.status).toBe(200);
    expect(res.body.data.conversion.outputAmount).toBeCloseTo(1000, 0);
  });

  test('handles lowercase token names', async () => {
    const res = await request(app)
      .post('/api/conversion/convert')
      .send({ sxrAmount: 1000, targetToken: 'eth' });

    expect(res.status).toBe(200);
    expect(res.body.data.conversion.targetToken).toBe('ETH');
  });

  test('returns 400 when sxrAmount is missing', async () => {
    const res = await request(app)
      .post('/api/conversion/convert')
      .send({ targetToken: 'ETH' });

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.error).toContain('Missing required fields');
  });

  test('returns 400 when targetToken is missing', async () => {
    const res = await request(app)
      .post('/api/conversion/convert')
      .send({ sxrAmount: 1000 });

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });

  test('returns 400 for negative sxrAmount', async () => {
    const res = await request(app)
      .post('/api/conversion/convert')
      .send({ sxrAmount: -100, targetToken: 'ETH' });

    expect(res.status).toBe(400);
    expect(res.body.error).toContain('positive number');
  });

  test('returns 400 for zero sxrAmount', async () => {
    const res = await request(app)
      .post('/api/conversion/convert')
      .send({ sxrAmount: 0, targetToken: 'ETH' });

    expect(res.status).toBe(400);
  });

  test('returns 400 for unsupported token', async () => {
    const res = await request(app)
      .post('/api/conversion/convert')
      .send({ sxrAmount: 100, targetToken: 'DOGE' });

    expect(res.status).toBe(400);
    expect(res.body.error).toContain('Unsupported target token');
  });

  test('response includes staking projections', async () => {
    const res = await request(app)
      .post('/api/conversion/convert')
      .send({ sxrAmount: 1000, targetToken: 'SOL' });

    expect(res.body.data.staking).toHaveProperty('projectedDailyYield');
    expect(res.body.data.staking).toHaveProperty('projectedMonthlyYield');
    expect(res.body.data.staking).toHaveProperty('projectedAnnualYield');
  });

  test('response includes txHash', async () => {
    const res = await request(app)
      .post('/api/conversion/convert')
      .send({ sxrAmount: 100, targetToken: 'ETH' });

    expect(res.body.data.conversion.txHash).toMatch(/^0x[a-f0-9]{64}$/);
  });
});

describe('GET /api/conversion/rates', () => {
  test('returns all supported conversion rates', async () => {
    const res = await request(app).get('/api/conversion/rates');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.rates).toBeInstanceOf(Array);
    expect(res.body.data.rates.length).toBeGreaterThan(0);
  });

  test('includes SXR USD price', async () => {
    const res = await request(app).get('/api/conversion/rates');
    expect(res.body.data.sxrUsdPrice).toBe(0.5);
  });

  test('includes globalApy of 44%', async () => {
    const res = await request(app).get('/api/conversion/rates');
    expect(res.body.data.globalApy).toBe('44%');
  });

  test('each rate entry includes required fields', async () => {
    const res = await request(app).get('/api/conversion/rates');
    const firstRate = res.body.data.rates[0];
    expect(firstRate).toHaveProperty('token');
    expect(firstRate).toHaveProperty('name');
    expect(firstRate).toHaveProperty('sxrToTokenRate');
    expect(firstRate).toHaveProperty('stakingApy');
    expect(firstRate).toHaveProperty('example');
  });

  test('rate entry includes example with sxrIn=1000', async () => {
    const res = await request(app).get('/api/conversion/rates');
    const ethRate = res.body.data.rates.find(r => r.token === 'ETH');
    expect(ethRate.example.sxrIn).toBe(1000);
  });

  test('includes lastUpdated timestamp', async () => {
    const res = await request(app).get('/api/conversion/rates');
    expect(res.body.data.lastUpdated).toBeTruthy();
  });

  test('ETH token is included in rates', async () => {
    const res = await request(app).get('/api/conversion/rates');
    const tokens = res.body.data.rates.map(r => r.token);
    expect(tokens).toContain('ETH');
  });

  test('BTC token is included in rates', async () => {
    const res = await request(app).get('/api/conversion/rates');
    const tokens = res.body.data.rates.map(r => r.token);
    expect(tokens).toContain('BTC');
  });
});
