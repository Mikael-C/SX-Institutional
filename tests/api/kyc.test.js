/**
 * Integration Tests: KYC Route
 * Full mock of DB layer — tests all happy paths and error branches.
 */

// ─── Mock Setup ───────────────────────────────────────────────────────────────
const mockUserFindOrCreate = jest.fn();
const mockKycFindOne       = jest.fn();
const mockKycCreate        = jest.fn();
const mockKycUpdate        = jest.fn();

jest.mock('../../src/models', () => ({
  User: {
    findOrCreate: (...args) => mockUserFindOrCreate(...args)
  },
  KycStatus: {
    findOne:  (...args) => mockKycFindOne(...args),
    create:   (...args) => mockKycCreate(...args)
  }
}));
jest.mock('../../src/websocket/ws', () => ({ broadcast: jest.fn() }));

const request = require('supertest');
const express = require('express');
const kycRoutes = require('../../src/routes/kyc');

const app = express();
app.use(express.json());
app.use('/api/kyc', kycRoutes);

const MOCK_USER = { id: 'user-kyc-1', walletAddress: '0xabcdef' };

const makeKycRecord = (overrides = {}) => ({
  id: 'kyc-1',
  userId: 'user-kyc-1',
  walletAddress: '0xabcdef',
  fullName: 'Alice Smith',
  dateOfBirth: '1990-01-01',
  documentHash: '0xdocHash123',
  status: 'Pending',
  shieldedIntent: false,
  submittedAt: new Date(),
  verifiedAt: null,
  update: mockKycUpdate,
  ...overrides
});

beforeEach(() => {
  jest.clearAllMocks();
});

// ─── POST /api/kyc/submit ─────────────────────────────────────────────────────

describe('POST /api/kyc/submit', () => {
  const validBody = {
    walletAddress: '0xabcdef',
    fullName: 'Alice Smith',
    dateOfBirth: '1990-01-01',
    documentHash: '0xdocHash123'
  };

  test('submits KYC successfully with valid data', async () => {
    mockUserFindOrCreate.mockResolvedValue([MOCK_USER]);
    mockKycFindOne.mockResolvedValue(null); // No existing KYC
    mockKycCreate.mockResolvedValue(makeKycRecord());

    const res = await request(app).post('/api/kyc/submit').send(validBody);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.status).toBe('Pending');
    expect(res.body.data.walletAddress).toBe('0xabcdef');
  });

  test('returns 400 when walletAddress is missing', async () => {
    const res = await request(app)
      .post('/api/kyc/submit')
      .send({ fullName: 'Alice', dateOfBirth: '1990-01-01', documentHash: '0xhash' });

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.error).toContain('Missing required fields');
  });

  test('returns 400 when fullName is missing', async () => {
    const res = await request(app)
      .post('/api/kyc/submit')
      .send({ walletAddress: '0xabc', dateOfBirth: '1990-01-01', documentHash: '0xhash' });

    expect(res.status).toBe(400);
  });

  test('returns 400 when dateOfBirth is missing', async () => {
    const res = await request(app)
      .post('/api/kyc/submit')
      .send({ walletAddress: '0xabc', fullName: 'Alice', documentHash: '0xhash' });

    expect(res.status).toBe(400);
  });

  test('returns 400 when documentHash is missing', async () => {
    const res = await request(app)
      .post('/api/kyc/submit')
      .send({ walletAddress: '0xabc', fullName: 'Alice', dateOfBirth: '1990-01-01' });

    expect(res.status).toBe(400);
  });

  test('returns 400 if KYC already verified', async () => {
    mockUserFindOrCreate.mockResolvedValue([MOCK_USER]);
    mockKycFindOne.mockResolvedValue(makeKycRecord({ status: 'Verified' }));

    const res = await request(app).post('/api/kyc/submit').send(validBody);

    expect(res.status).toBe(400);
    expect(res.body.error).toContain('already verified');
  });

  test('returns 400 if KYC already pending', async () => {
    mockUserFindOrCreate.mockResolvedValue([MOCK_USER]);
    mockKycFindOne.mockResolvedValue(makeKycRecord({ status: 'Pending' }));

    const res = await request(app).post('/api/kyc/submit').send(validBody);

    expect(res.status).toBe(400);
    expect(res.body.error).toContain('already pending');
  });

  test('includes shielded intent message when enabled', async () => {
    mockUserFindOrCreate.mockResolvedValue([MOCK_USER]);
    mockKycFindOne.mockResolvedValue(null);
    mockKycCreate.mockResolvedValue(makeKycRecord({ shieldedIntent: true }));

    const res = await request(app).post('/api/kyc/submit')
      .send({ ...validBody, shieldedIntent: true });

    expect(res.status).toBe(200);
    expect(res.body.data.privacy).toContain('Shielded Intent');
  });

  test('returns 500 on DB error', async () => {
    mockUserFindOrCreate.mockRejectedValue(new Error('DB Error'));

    const res = await request(app).post('/api/kyc/submit').send(validBody);

    expect(res.status).toBe(500);
    expect(res.body.success).toBe(false);
  });
});

// ─── POST /api/kyc/approve/:address ──────────────────────────────────────────

describe('POST /api/kyc/approve/:address', () => {
  test('approves a pending KYC submission', async () => {
    const record = makeKycRecord({ status: 'Pending' });
    record.update = jest.fn().mockImplementation(async (data) => {
      Object.assign(record, data);
      return record;
    });
    mockKycFindOne.mockResolvedValue(record);

    const res = await request(app).post('/api/kyc/approve/0xabcdef');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.status).toBe('Verified');
    expect(res.body.data.walletAddress).toBe('0xabcdef');
  });

  test('returns 404 if no pending KYC found', async () => {
    mockKycFindOne.mockResolvedValue(null);

    const res = await request(app).post('/api/kyc/approve/0xabcdef');

    expect(res.status).toBe(404);
    expect(res.body.success).toBe(false);
    expect(res.body.error).toContain('No pending KYC');
  });

  test('returns 500 on DB error', async () => {
    mockKycFindOne.mockRejectedValue(new Error('DB Error'));

    const res = await request(app).post('/api/kyc/approve/0xabcdef');

    expect(res.status).toBe(500);
  });
});

// ─── POST /api/kyc/reject/:address ────────────────────────────────────────────

describe('POST /api/kyc/reject/:address', () => {
  test('rejects a pending KYC submission', async () => {
    const record = makeKycRecord({ status: 'Pending' });
    record.update = jest.fn().mockResolvedValue({ ...record, status: 'Rejected' });
    mockKycFindOne.mockResolvedValue(record);

    const res = await request(app)
      .post('/api/kyc/reject/0xabcdef')
      .send({ reason: 'Invalid documents' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.status).toBe('Rejected');
    expect(res.body.data.reason).toBe('Invalid documents');
  });

  test('uses default rejection reason when not provided', async () => {
    const record = makeKycRecord();
    record.update = jest.fn().mockResolvedValue(record);
    mockKycFindOne.mockResolvedValue(record);

    const res = await request(app).post('/api/kyc/reject/0xabcdef').send({});

    expect(res.status).toBe(200);
    expect(res.body.data.reason).toBe('Insufficient or invalid documentation');
  });

  test('returns 404 if no pending KYC found', async () => {
    mockKycFindOne.mockResolvedValue(null);

    const res = await request(app).post('/api/kyc/reject/0xabcdef');

    expect(res.status).toBe(404);
  });
});

// ─── GET /api/kyc/status/:address ────────────────────────────────────────────

describe('GET /api/kyc/status/:address', () => {
  test('returns None status for unknown address', async () => {
    mockKycFindOne.mockResolvedValue(null);

    const res = await request(app).get('/api/kyc/status/0xunknown');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.status).toBe('None');
    expect(res.body.data.shieldedIntent).toBe(false);
  });

  test('returns verified status for approved KYC', async () => {
    mockKycFindOne.mockResolvedValue(makeKycRecord({ status: 'Verified' }));

    const res = await request(app).get('/api/kyc/status/0xabcdef');

    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('Verified');
    expect(res.body.data.accessLevel).toBe('Full');
  });

  test('redacts fullName for non-verified KYC', async () => {
    mockKycFindOne.mockResolvedValue(makeKycRecord({ status: 'Pending' }));

    const res = await request(app).get('/api/kyc/status/0xabcdef');

    expect(res.body.data.fullName).toBe('[REDACTED]');
  });

  test('reveals fullName for verified KYC', async () => {
    mockKycFindOne.mockResolvedValue(makeKycRecord({ status: 'Verified', fullName: 'Alice Smith' }));

    const res = await request(app).get('/api/kyc/status/0xabcdef');

    expect(res.body.data.fullName).toBe('Alice Smith');
  });

  test('Verified status enables all features', async () => {
    mockKycFindOne.mockResolvedValue(makeKycRecord({ status: 'Verified' }));

    const res = await request(app).get('/api/kyc/status/0xabcdef');

    expect(res.body.data.features.leverageTrading).toBe(true);
    expect(res.body.data.features.hiddenOrders).toBe(true);
    expect(res.body.data.features.lending).toBe(true);
    expect(res.body.data.features.withdrawal).toBe(true);
  });

  test('Pending status restricts advanced features', async () => {
    mockKycFindOne.mockResolvedValue(makeKycRecord({ status: 'Pending' }));

    const res = await request(app).get('/api/kyc/status/0xabcdef');

    expect(res.body.data.features.leverageTrading).toBe(false);
    expect(res.body.data.features.withdrawal).toBe(false);
  });

  test('returns 500 on DB error', async () => {
    mockKycFindOne.mockRejectedValue(new Error('DB Error'));

    const res = await request(app).get('/api/kyc/status/0xabcdef');

    expect(res.status).toBe(500);
  });
});
