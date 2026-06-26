const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const db = require('../models');
const { broadcast } = require('../websocket/ws');

const FUNDING_RATES = {
  ETH: { rate: 0.0001, direction: 'long_pays_short' },
  BTC: { rate: 0.00008, direction: 'long_pays_short' },
  SOL: { rate: 0.00015, direction: 'long_pays_short' },
  LINK: { rate: 0.00012, direction: 'short_pays_long' },
  AVAX: { rate: 0.00009, direction: 'long_pays_short' },
  MATIC: { rate: 0.00011, direction: 'short_pays_long' },
  ARB: { rate: 0.00013, direction: 'long_pays_short' },
  OP: { rate: 0.00010, direction: 'long_pays_short' }
};

const DEDUCTION_INTERVAL_MS = 8 * 60 * 60 * 1000;
let lastDeductionTime = Date.now();

function getNextDeductionTime() {
  const timeSinceLast = Date.now() - lastDeductionTime;
  const remaining = DEDUCTION_INTERVAL_MS - (timeSinceLast % DEDUCTION_INTERVAL_MS);
  return {
    nextDeductionAt: new Date(Date.now() + remaining).toISOString(),
    remainingMs: remaining,
    remainingMinutes: Math.ceil(remaining / 60000),
    remainingHours: parseFloat((remaining / 3600000).toFixed(2)),
    intervalHours: 8
  };
}

// GET / - unified funding data for the dashboard/funding page
router.get('/', async (req, res) => {
  try {
    const nextDed = getNextDeductionTime();
    return res.json({
      success: true,
      currentRate: '+0.0100%',
      totalPaid: 245.8,
      nextDeduction: Math.floor(nextDed.remainingMs / 1000),
      history: [
        { id: 1, date: '2024-06-24 19:00', amount: -12.5, marginAfter: 48750 },
        { id: 2, date: '2024-06-24 11:00', amount: -11.8, marginAfter: 48762.5 },
        { id: 3, date: '2024-06-24 03:00', amount: -13.2, marginAfter: 48774.3 },
        { id: 4, date: '2024-06-23 19:00', amount: -10.9, marginAfter: 48787.5 },
        { id: 5, date: '2024-06-23 11:00', amount: -14.1, marginAfter: 48798.4 }
      ]
    });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
});

// GET /rate/:asset - current funding rate
router.get('/rate/:asset', async (req, res) => {
  try {
    const { asset } = req.params;
    const upperAsset = asset.toUpperCase();

    const fundingInfo = FUNDING_RATES[upperAsset];
    if (!fundingInfo) {
      return res.status(404).json({
        success: false,
        error: `No funding rate for asset: ${upperAsset}. Supported: ${Object.keys(FUNDING_RATES).join(', ')}`
      });
    }

    const annualizedRate = parseFloat((fundingInfo.rate * 3 * 365 * 100).toFixed(4));

    return res.json({
      success: true,
      data: {
        asset: upperAsset,
        currentRate: fundingInfo.rate,
        ratePercent: `${(fundingInfo.rate * 100).toFixed(4)}%`,
        annualizedRate: `${annualizedRate}%`,
        direction: fundingInfo.direction,
        deductionInterval: '8 hours',
        nextDeduction: getNextDeductionTime()
      }
    });
  } catch (error) {
    console.error('[Funding] GET /rate/:asset error:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
});

// GET /next-deduction - countdown to next 8hr deduction
router.get('/next-deduction', async (req, res) => {
  try {
    const countdown = getNextDeductionTime();

    return res.json({
      success: true,
      data: {
        ...countdown,
        allRates: Object.entries(FUNDING_RATES).map(([asset, info]) => ({
          asset,
          rate: info.rate,
          ratePercent: `${(info.rate * 100).toFixed(4)}%`,
          direction: info.direction
        }))
      }
    });
  } catch (error) {
    console.error('[Funding] GET /next-deduction error:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
});

// GET /history/:positionId - deduction history
router.get('/history/:positionId', async (req, res) => {
  try {
    const { positionId } = req.params;

    const history = await db.FundingHistory.findAll({
      where: { positionId: positionId },
      order: [['createdAt', 'DESC']],
      limit: 50
    });

    const totalDeducted = history.reduce((sum, h) => sum + parseFloat(h.amount), 0);

    return res.json({
      success: true,
      data: {
        positionId: positionId,
        deductions: history.map(h => ({
          id: h.id,
          amount: parseFloat(h.amount),
          rate: parseFloat(h.rate),
          marginAfter: parseFloat(h.marginAfter),
          timestamp: h.createdAt
        })),
        totalDeducted: parseFloat(totalDeducted.toFixed(6)),
        deductionCount: history.length
      }
    });
  } catch (error) {
    console.error('[Funding] GET /history/:positionId error:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
});

// POST /apply - manually trigger funding deduction for demo
router.post('/apply', async (req, res) => {
  try {
    const { walletAddress, positionId } = req.body;

    let positions;
    if (positionId) {
      const pos = await db.LeveragedPosition.findOne({
        where: { id: positionId, status: 'Open' }
      });
      positions = pos ? [pos] : [];
    } else if (walletAddress) {
      const user = await db.User.findOne({
        where: { walletAddress: walletAddress.toLowerCase() }
      });
      if (!user) {
        return res.status(404).json({ success: false, error: 'User not found' });
      }
      positions = await db.LeveragedPosition.findAll({
        where: { userId: user.id, status: 'Open' }
      });
    } else {
      return res.status(400).json({
        success: false,
        error: 'Provide walletAddress or positionId'
      });
    }

    if (positions.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'No open positions found'
      });
    }

    const deductions = [];

    for (const pos of positions) {
      const asset = pos.asset;
      const fundingInfo = FUNDING_RATES[asset] || { rate: 0.0001 };
      const margin = parseFloat(pos.margin);
      const notionalValue = parseFloat(pos.amount) * parseFloat(pos.currentPrice);
      const deductionAmount = parseFloat((notionalValue * fundingInfo.rate).toFixed(6));
      const newMargin = parseFloat((margin - deductionAmount).toFixed(6));

      if (newMargin <= 0) {
        await pos.update({ status: 'Liquidated', margin: 0 });
        deductions.push({
          positionId: pos.id,
          asset: asset,
          deducted: deductionAmount,
          marginBefore: margin,
          marginAfter: 0,
          liquidated: true
        });
        continue;
      }

      await pos.update({ margin: newMargin });

      const fundingRecord = await db.FundingHistory.create({
        id: uuidv4(),
        positionId: pos.id,
        amount: deductionAmount,
        rate: fundingInfo.rate,
        marginAfter: newMargin
      });

      deductions.push({
        positionId: pos.id,
        asset: asset,
        deducted: deductionAmount,
        rate: fundingInfo.rate,
        marginBefore: margin,
        marginAfter: newMargin,
        liquidated: false,
        recordId: fundingRecord.id
      });
    }

    lastDeductionTime = Date.now();

    broadcast('funding', {
      type: 'funding_deducted',
      deductions: deductions,
      timestamp: new Date().toISOString()
    });

    return res.json({
      success: true,
      data: {
        message: `Funding deducted from ${positions.length} position(s)`,
        deductions: deductions,
        nextDeduction: getNextDeductionTime()
      }
    });
  } catch (error) {
    console.error('[Funding] POST /apply error:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
});

module.exports = router;
