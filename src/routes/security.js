const express = require('express');
const router = express.Router();
const { Op } = require('sequelize');
const db = require('../models');
const jailbreakDetector = require('../middleware/jailbreakDetector');

const AI_RESPONSES = {
  greeting: [
    "Welcome to SX Omni Chain! I'm your AI trading assistant. How can I help you today?",
    "Hello! I can help you with trading, portfolio management, risk analysis, and more. What would you like to know?",
    "Hi there! I'm the SX AI assistant. Ask me about oracle prices, swaps, leverage, or any platform feature."
  ],
  trading: [
    "For swaps, use the /api/swap/quote endpoint to get a quote, then /api/swap/execute to execute. We support ETH, BTC, SOL, LINK, AVAX, and more.",
    "Our swap engine aggregates across SX Internal Pools on both Hoodi and Base Sepolia, plus External DEX sources. You earn 1 SXR per $1 traded!",
    "To open a leveraged position, use /api/leverage/open with your desired leverage (1-100x), amount, and asset. Protection is available for added safety."
  ],
  oracle: [
    "Our oracle system uses 3 independent feeds (Chainlink, Pyth, SX Internal) per asset. If feeds deviate >5%, a dispute is triggered automatically.",
    "Price feeds are available for BTC, ETH, SOL, LINK, AVAX, MATIC, ARB, and OP. Each has real-time median pricing across both chains.",
    "If all feeds fail, we fall back to TWAP (Time-Weighted Average Price) calculated from 24h historical data."
  ],
  risk: [
    "Your risk score (0-100) is calculated from leverage exposure, concentration, volatility, and correlation. Lower is better.",
    "To improve your risk score: inject equity, diversify across assets, or reduce leverage. Use /api/risk/inject-equity to add collateral.",
    "The FROG score (0-200) measures market-wide sentiment using funding rates, open interest, and spot premium."
  ],
  hidden_orders: [
    "Hidden orders use zero-knowledge proofs for privacy. Three tiers: HOBL (full privacy), HOPL (amount hidden), HOTL (trigger-based).",
    "Place a hidden order with /api/orders/hidden. Your commitment is hashed with SHA-256, and a Groth16 ZK proof is generated.",
    "Hidden orders prevent front-running and MEV extraction. Your order details are only revealed upon execution."
  ],
  default: [
    "I can help with: trading, swaps, leverage, oracle prices, risk scores, FROG scores, hidden orders, lending, KYC, and more. What interests you?",
    "Try asking about specific features like 'How do swaps work?' or 'What is my risk score?'",
    "For a full overview, check /api/admin/status for platform status, or /api/oracle/prices for current market data."
  ]
};

function getAIResponse(message) {
  const lower = (message || '').toLowerCase();

  if (lower.includes('hello') || lower.includes('hi') || lower.includes('hey') || lower.includes('welcome')) {
    return AI_RESPONSES.greeting[Math.floor(Math.random() * AI_RESPONSES.greeting.length)];
  }
  if (lower.includes('trade') || lower.includes('swap') || lower.includes('exchange') || lower.includes('buy') || lower.includes('sell')) {
    return AI_RESPONSES.trading[Math.floor(Math.random() * AI_RESPONSES.trading.length)];
  }
  if (lower.includes('oracle') || lower.includes('price') || lower.includes('feed') || lower.includes('twap')) {
    return AI_RESPONSES.oracle[Math.floor(Math.random() * AI_RESPONSES.oracle.length)];
  }
  if (lower.includes('risk') || lower.includes('score') || lower.includes('frog') || lower.includes('leverage') || lower.includes('liquidat')) {
    return AI_RESPONSES.risk[Math.floor(Math.random() * AI_RESPONSES.risk.length)];
  }
  if (lower.includes('hidden') || lower.includes('privacy') || lower.includes('zk') || lower.includes('zero knowledge') || lower.includes('mev')) {
    return AI_RESPONSES.hidden_orders[Math.floor(Math.random() * AI_RESPONSES.hidden_orders.length)];
  }

  return AI_RESPONSES.default[Math.floor(Math.random() * AI_RESPONSES.default.length)];
}

// POST /chat - AI chat endpoint with jailbreak detection
router.post('/chat', jailbreakDetector, async (req, res) => {
  try {
    const { message, walletAddress } = req.body;

    if (!message) {
      return res.status(400).json({
        success: false,
        error: 'Missing required field: message'
      });
    }

    const response = getAIResponse(message);

    return res.json({
      success: true,
      data: {
        message: message,
        response: response,
        model: 'SX-AI-v1',
        securityCheck: 'passed',
        timestamp: new Date().toISOString()
      }
    });
  } catch (error) {
    console.error('[Security] POST /chat error:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
});

// GET /logs - jailbreak attempt logs
router.get('/logs', async (req, res) => {
  try {
    const { limit, offset, blocked } = req.query;

    const whereClause = {};
    if (blocked !== undefined) {
      whereClause.blocked = blocked === 'true';
    }

    const parsedLimit = Math.min(parseInt(limit) || 50, 200);
    const parsedOffset = parseInt(offset) || 0;

    const { rows: logs, count } = await db.JailbreakLog.findAndCountAll({
      where: whereClause,
      order: [['createdAt', 'DESC']],
      limit: parsedLimit,
      offset: parsedOffset
    });

    return res.json({
      success: true,
      data: logs.map(l => ({
        id: l.id,
        ipAddress: l.ipAddress,
        walletAddress: l.walletAddress,
        pattern: l.pattern,
        input: l.input.substring(0, 200) + (l.input.length > 200 ? '...' : ''),
        blocked: l.blocked,
        lockoutUntil: l.lockoutUntil,
        createdAt: l.createdAt
      })),
      pagination: {
        total: count,
        limit: parsedLimit,
        offset: parsedOffset,
        hasMore: parsedOffset + parsedLimit < count
      }
    });
  } catch (error) {
    console.error('[Security] GET /logs error:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
});

// GET /locked - locked out users with countdown
router.get('/locked', async (req, res) => {
  try {
    const now = new Date();

    const lockedLogs = await db.JailbreakLog.findAll({
      where: {
        lockoutUntil: {
          [Op.gt]: now
        }
      },
      order: [['lockoutUntil', 'DESC']]
    });

    const uniqueLocked = new Map();
    for (const log of lockedLogs) {
      const key = log.ipAddress;
      if (!uniqueLocked.has(key) || new Date(log.lockoutUntil) > new Date(uniqueLocked.get(key).lockoutUntil)) {
        uniqueLocked.set(key, log);
      }
    }

    const lockedUsers = Array.from(uniqueLocked.values()).map(l => {
      const lockoutDate = new Date(l.lockoutUntil);
      const remainingMs = lockoutDate.getTime() - now.getTime();
      return {
        ipAddress: l.ipAddress,
        walletAddress: l.walletAddress,
        lockoutUntil: l.lockoutUntil,
        remainingMinutes: Math.ceil(remainingMs / 60000),
        remainingSeconds: Math.ceil(remainingMs / 1000),
        lastPattern: l.pattern,
        lastAttempt: l.createdAt
      };
    });

    return res.json({
      success: true,
      data: lockedUsers,
      count: lockedUsers.length
    });
  } catch (error) {
    console.error('[Security] GET /locked error:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
});

module.exports = router;
