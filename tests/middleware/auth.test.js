/**
 * Integration Tests: Auth Middleware
 * Tests the EIP-191 wallet signature verification middleware.
 */

// Mock ethers to avoid crypto dependency
const mockVerifyMessage = jest.fn();
jest.mock('ethers', () => ({
  ethers: { verifyMessage: (...args) => mockVerifyMessage(...args) }
}));

const request = require('supertest');
const express = require('express');
const authMiddleware = require('../../src/middleware/auth');

// Build a minimal test app
const app = express();
app.use(express.json());
app.use(authMiddleware);

// A simple endpoint to inspect req.walletAddress / req.walletVerified
app.get('/test', (req, res) => {
  res.json({
    walletAddress: req.walletAddress,
    walletVerified: req.walletVerified
  });
});

beforeEach(() => {
  jest.clearAllMocks();
});

describe('Auth Middleware', () => {
  test('sets walletVerified=false for unauthenticated request', async () => {
    const res = await request(app).get('/test');

    expect(res.status).toBe(200);
    expect(res.body.walletAddress).toBeNull();
    expect(res.body.walletVerified).toBe(false);
  });

  test('sets walletAddress from header (unverified)', async () => {
    const res = await request(app)
      .get('/test')
      .set('x-wallet-address', '0xAlice');

    expect(res.status).toBe(200);
    expect(res.body.walletAddress).toBe('0xAlice');
    expect(res.body.walletVerified).toBe(false);
  });

  test('verifies valid wallet signature and sets walletVerified=true', async () => {
    mockVerifyMessage.mockReturnValue('0xAlice');

    const res = await request(app)
      .get('/test')
      .set('x-wallet-address', '0xAlice')
      .set('x-wallet-message', 'SX Auth: 1234567890')
      .set('x-wallet-signature', '0xsig');

    expect(res.status).toBe(200);
    expect(res.body.walletVerified).toBe(true);
    expect(res.body.walletAddress).toBe('0xAlice');
  });

  test('returns 401 when recovered address does not match header', async () => {
    mockVerifyMessage.mockReturnValue('0xBob'); // Different address

    const res = await request(app)
      .get('/test')
      .set('x-wallet-address', '0xAlice')
      .set('x-wallet-message', 'SX Auth: 1234567890')
      .set('x-wallet-signature', '0xwrongsig');

    expect(res.status).toBe(401);
    expect(res.body.success).toBe(false);
    expect(res.body.error).toContain('address mismatch');
  });

  test('returns 401 when ethers.verifyMessage throws', async () => {
    mockVerifyMessage.mockImplementation(() => {
      throw new Error('invalid signature');
    });

    const res = await request(app)
      .get('/test')
      .set('x-wallet-address', '0xAlice')
      .set('x-wallet-message', 'SX Auth: 1234567890')
      .set('x-wallet-signature', '0xinvalid');

    expect(res.status).toBe(401);
    expect(res.body.error).toContain('invalid signature');
  });

  test('verifies address in case-insensitive manner', async () => {
    mockVerifyMessage.mockReturnValue('0xalice'); // lowercase

    const res = await request(app)
      .get('/test')
      .set('x-wallet-address', '0xALICE') // uppercase
      .set('x-wallet-message', 'SX Auth: 1234567890')
      .set('x-wallet-signature', '0xsig');

    expect(res.status).toBe(200);
    expect(res.body.walletVerified).toBe(true);
  });

  test('does not verify if only address and message (no signature)', async () => {
    const res = await request(app)
      .get('/test')
      .set('x-wallet-address', '0xAlice')
      .set('x-wallet-message', 'SX Auth: 1234567890');
    // No x-wallet-signature

    expect(res.status).toBe(200);
    expect(res.body.walletVerified).toBe(false);
    expect(mockVerifyMessage).not.toHaveBeenCalled();
  });

  test('does not verify if only address and signature (no message)', async () => {
    const res = await request(app)
      .get('/test')
      .set('x-wallet-address', '0xAlice')
      .set('x-wallet-signature', '0xsig');
    // No x-wallet-message

    expect(res.status).toBe(200);
    expect(res.body.walletVerified).toBe(false);
    expect(mockVerifyMessage).not.toHaveBeenCalled();
  });
});
