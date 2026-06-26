const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const db = require('../models');
const { broadcast } = require('../websocket/ws');

const REALISTIC_PRICES = {
  BTC: { base: 65000, variance: 500 },
  ETH: { base: 3500, variance: 50 },
  SOL: { base: 145, variance: 5 },
  LINK: { base: 14.5, variance: 0.5 },
  AVAX: { base: 35, variance: 2 },
  MATIC: { base: 0.72, variance: 0.05 },
  ARB: { base: 1.15, variance: 0.08 },
  OP: { base: 2.45, variance: 0.15 }
};

const FEED_SOURCES = ['Chainlink', 'Pyth', 'SX Internal'];
const CHAINS = ['Hoodi', 'Base Sepolia'];

function generateRealisticPrice(asset) {
  const config = REALISTIC_PRICES[asset];
  if (!config) return { base: 1.0, variance: 0.1 };
  const variation = (Math.random() - 0.5) * 2 * config.variance;
  return parseFloat((config.base + variation).toFixed(6));
}

function generateFeedId(asset, source) {
  return `${asset.toLowerCase()}_${source.toLowerCase().replace(/\s+/g, '_')}_${Date.now().toString(36)}`;
}

async function seedOraclePrices() {
  try {
    const count = await db.OraclePrice.count();
    if (count > 0) {
      console.log('[Oracle] Prices already seeded, updating...');
      await updateAllPrices();
      return;
    }

    console.log('[Oracle] Seeding initial oracle prices...');
    const records = [];

    for (const asset of Object.keys(REALISTIC_PRICES)) {
      for (const source of FEED_SOURCES) {
        for (const chain of CHAINS) {
          const price = generateRealisticPrice(asset);
          records.push({
            id: uuidv4(),
            asset: asset,
            feedId: generateFeedId(asset, source),
            price: price,
            chain: chain,
            timestamp: new Date(),
            isDisputed: false
          });
        }
      }
    }

    await db.OraclePrice.bulkCreate(records);
    console.log(`[Oracle] Seeded ${records.length} price feeds`);
  } catch (error) {
    console.error('[Oracle] Error seeding prices:', error.message);
  }
}

async function updateAllPrices() {
  try {
    const prices = await db.OraclePrice.findAll();
    for (const priceRecord of prices) {
      if (!priceRecord.isDisputed) {
        const newPrice = generateRealisticPrice(priceRecord.asset);
        await priceRecord.update({ price: newPrice, timestamp: new Date() });
      }
    }
    const latestPrices = await getAggregatedPrices();
    broadcast('prices', latestPrices);
  } catch (error) {
    console.error('[Oracle] Error updating prices:', error.message);
  }
}

async function getAggregatedPrices() {
  const prices = await db.OraclePrice.findAll({
    order: [['asset', 'ASC'], ['timestamp', 'DESC']]
  });

  const aggregated = {};
  for (const p of prices) {
    if (!aggregated[p.asset]) {
      aggregated[p.asset] = {
        asset: p.asset,
        feeds: [],
        medianPrice: 0,
        isDisputed: false,
        lastUpdated: p.timestamp
      };
    }
    aggregated[p.asset].feeds.push({
      feedId: p.feedId,
      price: parseFloat(p.price),
      chain: p.chain,
      isDisputed: p.isDisputed,
      timestamp: p.timestamp
    });
    if (p.isDisputed) aggregated[p.asset].isDisputed = true;
  }

  for (const asset of Object.keys(aggregated)) {
    const validPrices = aggregated[asset].feeds
      .filter(f => !f.isDisputed)
      .map(f => f.price)
      .sort((a, b) => a - b);

    if (validPrices.length > 0) {
      const mid = Math.floor(validPrices.length / 2);
      aggregated[asset].medianPrice = validPrices.length % 2 !== 0
        ? validPrices[mid]
        : parseFloat(((validPrices[mid - 1] + validPrices[mid]) / 2).toFixed(6));
    }
  }

  return aggregated;
}

function calculateTWAP(prices) {
  if (!prices || prices.length === 0) return 0;
  const sum = prices.reduce((acc, p) => acc + parseFloat(p), 0);
  return parseFloat((sum / prices.length).toFixed(6));
}

// GET /prices - return all current prices with feed sources and chain labels
router.get('/prices', async (req, res) => {
  try {
    const aggregated = await getAggregatedPrices();
    return res.json({
      success: true,
      data: aggregated,
      totalAssets: Object.keys(aggregated).length,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('[Oracle] GET /prices error:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
});

// GET /prices/:asset - specific asset with dispute status
router.get('/prices/:asset', async (req, res) => {
  try {
    const { asset } = req.params;
    const upperAsset = asset.toUpperCase();

    const prices = await db.OraclePrice.findAll({
      where: { asset: upperAsset },
      order: [['timestamp', 'DESC']]
    });

    if (prices.length === 0) {
      return res.status(404).json({
        success: false,
        error: `No price data found for asset: ${upperAsset}`
      });
    }

    const validPrices = prices.filter(p => !p.isDisputed).map(p => parseFloat(p.price));
    const disputedFeeds = prices.filter(p => p.isDisputed);

    const sortedPrices = [...validPrices].sort((a, b) => a - b);
    const mid = Math.floor(sortedPrices.length / 2);
    const medianPrice = sortedPrices.length % 2 !== 0
      ? sortedPrices[mid]
      : parseFloat(((sortedPrices[mid - 1] + sortedPrices[mid]) / 2).toFixed(6));

    return res.json({
      success: true,
      data: {
        asset: upperAsset,
        medianPrice: medianPrice,
        twapPrice: calculateTWAP(validPrices),
        feeds: prices.map(p => ({
          feedId: p.feedId,
          price: parseFloat(p.price),
          chain: p.chain,
          isDisputed: p.isDisputed,
          timestamp: p.timestamp
        })),
        isDisputed: disputedFeeds.length > 0,
        disputedFeeds: disputedFeeds.length,
        totalFeeds: prices.length,
        lastUpdated: prices[0].timestamp
      }
    });
  } catch (error) {
    console.error('[Oracle] GET /prices/:asset error:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
});

// GET /disputes - all active disputes
router.get('/disputes', async (req, res) => {
  try {
    const disputes = await db.Dispute.findAll({
      where: { status: 'Active' },
      order: [['createdAt', 'DESC']]
    });

    return res.json({
      success: true,
      data: disputes,
      count: disputes.length
    });
  } catch (error) {
    console.error('[Oracle] GET /disputes error:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
});

// POST /simulate-dispute - set one feed to bad value, trigger dispute detection
router.post('/simulate-dispute', async (req, res) => {
  try {
    const { asset } = req.body;
    const targetAsset = (asset || 'ETH').toUpperCase();

    const feed = await db.OraclePrice.findOne({
      where: { asset: targetAsset, isDisputed: false },
      order: [['timestamp', 'DESC']]
    });

    if (!feed) {
      return res.status(404).json({
        success: false,
        error: `No undisputed feed found for ${targetAsset}`
      });
    }

    const originalPrice = parseFloat(feed.price);
    const badPrice = originalPrice * 1.15;
    const deviation = parseFloat((((badPrice - originalPrice) / originalPrice) * 100).toFixed(4));

    await feed.update({ price: badPrice, isDisputed: true });

    const dispute = await db.Dispute.create({
      id: uuidv4(),
      asset: targetAsset,
      feedId: feed.feedId,
      deviation: deviation,
      chain: feed.chain,
      status: 'Active'
    });

    broadcast('prices', {
      type: 'dispute',
      asset: targetAsset,
      feedId: feed.feedId,
      originalPrice: originalPrice,
      badPrice: badPrice,
      deviation: deviation,
      dispute: dispute
    });

    return res.json({
      success: true,
      data: {
        message: `Dispute triggered for ${targetAsset}`,
        feedId: feed.feedId,
        originalPrice: originalPrice,
        badPrice: badPrice,
        deviation: `${deviation}%`,
        dispute: dispute,
        chain: feed.chain
      }
    });
  } catch (error) {
    console.error('[Oracle] POST /simulate-dispute error:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
});

// POST /simulate-twap - mark all feeds as failed, return TWAP
router.post('/simulate-twap', async (req, res) => {
  try {
    const { asset } = req.body;
    const targetAsset = (asset || 'ETH').toUpperCase();

    const feeds = await db.OraclePrice.findAll({
      where: { asset: targetAsset }
    });

    if (feeds.length === 0) {
      return res.status(404).json({
        success: false,
        error: `No feeds found for ${targetAsset}`
      });
    }

    const allPrices = feeds.map(f => parseFloat(f.price));
    const twapPrice = calculateTWAP(allPrices);

    for (const feed of feeds) {
      await feed.update({ isDisputed: true });
    }

    const recentPrices = [];
    const config = REALISTIC_PRICES[targetAsset] || { base: 100, variance: 5 };
    for (let i = 0; i < 24; i++) {
      const hourlyVariation = (Math.random() - 0.5) * 2 * config.variance * 0.5;
      recentPrices.push(parseFloat((config.base + hourlyVariation).toFixed(6)));
    }
    const historicalTwap = calculateTWAP(recentPrices);

    broadcast('prices', {
      type: 'twap_fallback',
      asset: targetAsset,
      twapPrice: historicalTwap,
      allFeedsFailed: true
    });

    return res.json({
      success: true,
      data: {
        message: `All ${feeds.length} feeds marked as failed for ${targetAsset}. Using TWAP fallback.`,
        asset: targetAsset,
        currentTwap: twapPrice,
        historicalTwap24h: historicalTwap,
        failedFeeds: feeds.length,
        twapSources: recentPrices.length,
        fallbackActive: true
      }
    });
  } catch (error) {
    console.error('[Oracle] POST /simulate-twap error:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
});

let priceUpdateInterval = null;

function startPriceUpdates() {
  seedOraclePrices();
  priceUpdateInterval = setInterval(updateAllPrices, 30000);
  console.log('[Oracle] Price updates started (every 30s)');
}

function stopPriceUpdates() {
  if (priceUpdateInterval) {
    clearInterval(priceUpdateInterval);
    priceUpdateInterval = null;
  }
}

module.exports = router;
module.exports.startPriceUpdates = startPriceUpdates;
module.exports.stopPriceUpdates = stopPriceUpdates;
module.exports.seedOraclePrices = seedOraclePrices;
