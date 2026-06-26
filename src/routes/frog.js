const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const db = require('../models');
const { broadcast } = require('../websocket/ws');

function calculateFrogScore(fundingRate, openInterest, spotPremium) {
  const fr = parseFloat(fundingRate) || 0;
  const oi = parseFloat(openInterest) || 0;
  const sp = parseFloat(spotPremium) || 0;

  const frScore = Math.min(66, Math.max(0, Math.abs(fr) * 100000 * 33));
  const oiScore = Math.min(67, Math.max(0, oi / 1000000 * 33.5));
  const spScore = Math.min(67, Math.max(0, Math.abs(sp) * 1000 * 33.5));

  const total = Math.min(200, Math.max(0, Math.round(frScore + oiScore + spScore)));
  return total;
}

function getInterpretation(score) {
  if (score >= 160) return 'Extremely Bullish - Strong long bias with high conviction. Market is overheated.';
  if (score >= 120) return 'Bullish - Positive sentiment with elevated funding rates. Long positions dominate.';
  if (score >= 80) return 'Neutral-Bullish - Balanced market with slight long bias. Normal conditions.';
  if (score >= 40) return 'Neutral-Bearish - Slight short bias emerging. Caution advised for longs.';
  if (score >= 20) return 'Bearish - Short sentiment dominates. Funding rates favor shorts.';
  return 'Extremely Bearish - Severe market stress. Potential capitulation event.';
}

async function seedFrogHistory() {
  const count = await db.FrogScore.count();
  if (count >= 30) return;

  console.log('[FROG] Seeding 30-day history...');
  const records = [];
  const now = Date.now();

  for (let i = 29; i >= 0; i--) {
    const date = new Date(now - i * 24 * 60 * 60 * 1000);
    const fundingRate = parseFloat((0.0001 + (Math.random() - 0.3) * 0.0003).toFixed(6));
    const openInterest = parseFloat((500000 + Math.random() * 2000000).toFixed(2));
    const spotPremium = parseFloat(((Math.random() - 0.4) * 0.02).toFixed(6));
    const score = calculateFrogScore(fundingRate, openInterest, spotPremium);

    records.push({
      id: uuidv4(),
      score: score,
      fundingRate: fundingRate,
      openInterest: openInterest,
      spotPremium: spotPremium,
      interpretation: getInterpretation(score),
      createdAt: date,
      updatedAt: date
    });
  }

  await db.FrogScore.bulkCreate(records);
  console.log(`[FROG] Seeded ${records.length} historical scores`);
}

// GET / - Unified endpoint for FrogMeter dashboard
router.get('/', async (req, res) => {
  try {
    await seedFrogHistory();

    const latest = await db.FrogScore.findOne({
      order: [['createdAt', 'DESC']]
    });

    const history = await db.FrogScore.findAll({
      order: [['createdAt', 'ASC']],
      limit: 30
    });

    const currentScore = latest ? latest.score : 128;
    const fr = latest ? parseFloat(latest.fundingRate) : 0.012;
    const oi = latest ? parseFloat(latest.openInterest) : 2450000000;
    const sp = latest ? parseFloat(latest.spotPremium) : -0.35;

    const chartData = history.map(h => ({
      date: new Date(h.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
      oi: parseFloat(h.openInterest),
      fundingRate: parseFloat(h.fundingRate),
      spotPremium: parseFloat(h.spotPremium)
    }));

    const historyData = history.map(h => ({
      date: new Date(h.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
      score: h.score,
      interpretation: h.interpretation
    })).reverse();

    return res.json({
      success: true,
      frogScore: currentScore,
      components: {
        fundingRate: { value: fr, signal: fr > 0 ? 'bullish' : 'bearish' },
        openInterest: { value: oi, signal: oi > 1000000 ? 'bullish' : 'neutral' },
        spotPremium: { value: sp, signal: sp > 0 ? 'bullish' : 'bearish' }
      },
      chartData,
      historyData
    });
  } catch (error) {
    console.error('[FROG] GET / error:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
});

// GET /score - current FROG score (0-200), interpretation, component breakdown
router.get('/score', async (req, res) => {
  try {
    await seedFrogHistory();

    const latest = await db.FrogScore.findOne({
      order: [['createdAt', 'DESC']]
    });

    if (!latest) {
      return res.json({
        success: true,
        data: {
          score: 100,
          interpretation: getInterpretation(100),
          fundingRate: 0.0001,
          openInterest: 1000000,
          spotPremium: 0.005,
          components: {
            fundingRateScore: 33,
            openInterestScore: 33,
            spotPremiumScore: 34
          }
        }
      });
    }

    const fr = parseFloat(latest.fundingRate);
    const oi = parseFloat(latest.openInterest);
    const sp = parseFloat(latest.spotPremium);

    return res.json({
      success: true,
      data: {
        score: latest.score,
        maxScore: 200,
        interpretation: latest.interpretation,
        fundingRate: fr,
        openInterest: oi,
        spotPremium: sp,
        components: {
          fundingRateScore: Math.round(Math.min(66, Math.abs(fr) * 100000 * 33)),
          openInterestScore: Math.round(Math.min(67, oi / 1000000 * 33.5)),
          spotPremiumScore: Math.round(Math.min(67, Math.abs(sp) * 1000 * 33.5))
        },
        lastUpdated: latest.createdAt
      }
    });
  } catch (error) {
    console.error('[FROG] GET /score error:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
});

// GET /history - 30-day historical scores
router.get('/history', async (req, res) => {
  try {
    await seedFrogHistory();

    const history = await db.FrogScore.findAll({
      order: [['createdAt', 'ASC']],
      limit: 30
    });

    return res.json({
      success: true,
      data: history.map(h => ({
        date: h.createdAt,
        score: h.score,
        fundingRate: parseFloat(h.fundingRate),
        openInterest: parseFloat(h.openInterest),
        spotPremium: parseFloat(h.spotPremium),
        interpretation: h.interpretation
      })),
      count: history.length,
      period: '30 days'
    });
  } catch (error) {
    console.error('[FROG] GET /history error:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
});

// GET /metrics - funding rate, OI, spot premium breakdown
router.get('/metrics', async (req, res) => {
  try {
    const latest = await db.FrogScore.findOne({
      order: [['createdAt', 'DESC']]
    });

    const allScores = await db.FrogScore.findAll({
      order: [['createdAt', 'DESC']],
      limit: 30
    });

    const avgScore = allScores.length > 0
      ? Math.round(allScores.reduce((s, r) => s + r.score, 0) / allScores.length)
      : 0;
    const maxScore = allScores.length > 0
      ? Math.max(...allScores.map(r => r.score))
      : 0;
    const minScore = allScores.length > 0
      ? Math.min(...allScores.map(r => r.score))
      : 0;

    return res.json({
      success: true,
      data: {
        current: latest ? {
          fundingRate: parseFloat(latest.fundingRate),
          openInterest: parseFloat(latest.openInterest),
          spotPremium: parseFloat(latest.spotPremium),
          score: latest.score
        } : null,
        statistics: {
          averageScore: avgScore,
          maxScore: maxScore,
          minScore: minScore,
          dataPoints: allScores.length,
          trend: allScores.length >= 2
            ? (allScores[0].score > allScores[allScores.length - 1].score ? 'Improving' : 'Declining')
            : 'Insufficient data'
        },
        thresholds: {
          extremelyBullish: '160-200',
          bullish: '120-159',
          neutralBullish: '80-119',
          neutralBearish: '40-79',
          bearish: '20-39',
          extremelyBearish: '0-19'
        }
      }
    });
  } catch (error) {
    console.error('[FROG] GET /metrics error:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
});

// POST /update - update metrics, recalculate score
router.post('/update', async (req, res) => {
  try {
    const { fundingRate, openInterest, spotPremium } = req.body;

    const fr = parseFloat(fundingRate || 0.0001);
    const oi = parseFloat(openInterest || 1000000);
    const sp = parseFloat(spotPremium || 0.005);

    const score = calculateFrogScore(fr, oi, sp);
    const interpretation = getInterpretation(score);

    const frogScore = await db.FrogScore.create({
      id: uuidv4(),
      score: score,
      fundingRate: fr,
      openInterest: oi,
      spotPremium: sp,
      interpretation: interpretation
    });

    broadcast('frog', {
      type: 'frog_updated',
      score: score,
      interpretation: interpretation,
      fundingRate: fr,
      openInterest: oi,
      spotPremium: sp,
      timestamp: frogScore.createdAt
    });

    return res.json({
      success: true,
      data: {
        id: frogScore.id,
        score: score,
        maxScore: 200,
        interpretation: interpretation,
        fundingRate: fr,
        openInterest: oi,
        spotPremium: sp,
        components: {
          fundingRateScore: Math.round(Math.min(66, Math.abs(fr) * 100000 * 33)),
          openInterestScore: Math.round(Math.min(67, oi / 1000000 * 33.5)),
          spotPremiumScore: Math.round(Math.min(67, Math.abs(sp) * 1000 * 33.5))
        },
        timestamp: frogScore.createdAt
      }
    });
  } catch (error) {
    console.error('[FROG] POST /update error:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
});

module.exports = router;
module.exports.seedFrogHistory = seedFrogHistory;
