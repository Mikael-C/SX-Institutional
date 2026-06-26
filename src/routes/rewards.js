const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const db = require('../models');

// GET /:address - total SXR earned, history
router.get('/:address', async (req, res) => {
  try {
    const { address } = req.params;
    const user = await db.User.findOne({
      where: { walletAddress: address.toLowerCase() }
    });

    if (!user) {
      return res.json({
        success: true,
        data: {
          walletAddress: address,
          totalSxrEarned: 0,
          rewards: [],
          count: 0
        }
      });
    }

    const rewards = await db.Reward.findAll({
      where: { userId: user.id },
      order: [['createdAt', 'DESC']],
      limit: 100
    });

    const totalSxr = rewards.reduce((sum, r) => sum + parseFloat(r.amount), 0);
    const totalVolume = rewards.reduce((sum, r) => sum + parseFloat(r.tradeVolume), 0);

    const sourceBreakdown = {};
    for (const r of rewards) {
      const src = r.source;
      if (!sourceBreakdown[src]) {
        sourceBreakdown[src] = { count: 0, totalSxr: 0, totalVolume: 0 };
      }
      sourceBreakdown[src].count++;
      sourceBreakdown[src].totalSxr += parseFloat(r.amount);
      sourceBreakdown[src].totalVolume += parseFloat(r.tradeVolume);
    }

    return res.json({
      success: true,
      data: {
        walletAddress: address,
        sxId: user.sxId,
        totalSxrEarned: parseFloat(totalSxr.toFixed(2)),
        totalTradeVolume: parseFloat(totalVolume.toFixed(2)),
        rewardCount: rewards.length,
        sourceBreakdown: sourceBreakdown,
        rewards: rewards.map(r => ({
          id: r.id,
          amount: parseFloat(r.amount),
          tradeVolume: parseFloat(r.tradeVolume),
          source: r.source,
          txHash: r.txHash,
          timestamp: r.createdAt
        }))
      }
    });
  } catch (error) {
    console.error('[Rewards] GET /:address error:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
});

// GET /rate - current rate (1 SXR per $1)
router.get('/rate', async (req, res) => {
  try {
    return res.json({
      success: true,
      data: {
        rate: 1,
        description: '1 SXR per $1 trade volume',
        unit: 'SXR/$',
        minTradeVolume: 0,
        maxRewardPerTrade: null,
        bonusMultiplier: 1.0,
        conversionRate: {
          sxrToEth: 0.000143,
          sxrToUsd: 0.50,
          sxrApyIfStaked: '44%'
        }
      }
    });
  } catch (error) {
    console.error('[Rewards] GET /rate error:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
});

// POST /credit - credit rewards (called internally)
router.post('/credit', async (req, res) => {
  try {
    const { walletAddress, amount, tradeVolume, source, txHash } = req.body;

    if (!walletAddress || !amount) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: walletAddress, amount'
      });
    }

    const parsedAmount = parseFloat(amount);
    if (isNaN(parsedAmount) || parsedAmount <= 0) {
      return res.status(400).json({
        success: false,
        error: 'amount must be a positive number'
      });
    }

    const [user] = await db.User.findOrCreate({
      where: { walletAddress: walletAddress.toLowerCase() },
      defaults: {
        id: uuidv4(),
        walletAddress: walletAddress.toLowerCase(),
        sxId: 'SX-' + Math.random().toString(36).substring(2, 10).toUpperCase()
      }
    });

    const reward = await db.Reward.create({
      id: uuidv4(),
      userId: user.id,
      amount: parsedAmount,
      tradeVolume: parseFloat(tradeVolume || 0),
      source: source || 'manual',
      txHash: txHash || null
    });

    return res.json({
      success: true,
      data: {
        id: reward.id,
        amount: parsedAmount,
        tradeVolume: parseFloat(tradeVolume || 0),
        source: source || 'manual',
        timestamp: reward.createdAt
      }
    });
  } catch (error) {
    console.error('[Rewards] POST /credit error:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
});

module.exports = router;
