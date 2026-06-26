const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const db = require('../models');
const { broadcast } = require('../websocket/ws');

const DEMO_POSITIONS = [
  { asset: 'ETH', amount: 5.0, entryPrice: 3200, currentPrice: 3500, chain: 'Hoodi', type: 'Long', leverage: 3 },
  { asset: 'BTC', amount: 0.5, entryPrice: 61000, currentPrice: 65000, chain: 'Hoodi', type: 'Long', leverage: 2 },
  { asset: 'SOL', amount: 100, entryPrice: 130, currentPrice: 145, chain: 'Base Sepolia', type: 'Long', leverage: 5 },
  { asset: 'LINK', amount: 500, entryPrice: 13.0, currentPrice: 14.5, chain: 'Base Sepolia', type: 'Long', leverage: 2 },
  { asset: 'ETH', amount: 2.0, entryPrice: 3600, currentPrice: 3500, chain: 'Base Sepolia', type: 'Short', leverage: 1 },
  { asset: 'AVAX', amount: 200, entryPrice: 32, currentPrice: 35, chain: 'Hoodi', type: 'Long', leverage: 3 }
];

async function seedDemoPositions(userId) {
  const existingCount = await db.LeveragedPosition.count({ where: { userId: userId } });
  if (existingCount > 0) return;

  for (const pos of DEMO_POSITIONS) {
    const margin = parseFloat((pos.amount * pos.entryPrice / pos.leverage).toFixed(6));
    const liquidationPrice = parseFloat((pos.entryPrice * (1 - 1 / pos.leverage * 0.9)).toFixed(6));

    await db.LeveragedPosition.create({
      id: uuidv4(),
      userId: userId,
      asset: pos.asset,
      leverage: pos.leverage,
      amount: pos.amount,
      entryPrice: pos.entryPrice,
      currentPrice: pos.currentPrice,
      liquidationPrice: liquidationPrice,
      margin: margin,
      protection: pos.leverage > 2,
      protectionActive: false,
      status: 'Open',
      chain: pos.chain
    });
  }
}

function calculatePnL(entryPrice, currentPrice, amount, leverage, type) {
  const priceDiff = currentPrice - entryPrice;
  const direction = type === 'Short' ? -1 : 1;
  const pnl = priceDiff * amount * direction;
  const pnlPercent = ((priceDiff / entryPrice) * 100 * leverage * direction);
  return {
    pnl: parseFloat(pnl.toFixed(6)),
    pnlPercent: parseFloat(pnlPercent.toFixed(4))
  };
}

// GET / - portfolio for current user (from header or demo)
router.get('/', async (req, res) => {
  const address = req.walletAddress || '0xdemo';
  req.params.address = address;
  // Forward to /:address handler below
  try {
    const [user] = await db.User.findOrCreate({
      where: { walletAddress: address.toLowerCase() },
      defaults: {
        id: uuidv4(),
        walletAddress: address.toLowerCase(),
        sxId: 'SX-' + Math.random().toString(36).substring(2, 10).toUpperCase()
      }
    });
    await seedDemoPositions(user.id);
    const positions = await db.LeveragedPosition.findAll({ where: { userId: user.id, status: 'Open' } });
    const portfolio = positions.map(p => {
      const { pnl, pnlPercent } = calculatePnL(parseFloat(p.entryPrice), parseFloat(p.currentPrice), parseFloat(p.amount), p.leverage, p.asset === 'ETH' && parseFloat(p.entryPrice) > parseFloat(p.currentPrice) ? 'Short' : 'Long');
      return {
        id: p.id, asset: p.asset, amount: parseFloat(p.amount),
        entryPrice: parseFloat(p.entryPrice), currentPrice: parseFloat(p.currentPrice),
        value: parseFloat(p.amount) * parseFloat(p.currentPrice),
        chain: p.chain, leverage: p.leverage, pnl, pnlPercent, status: p.status
      };
    });
    const totalValue = portfolio.reduce((sum, p) => sum + p.value, 0);
    return res.json({ success: true, data: { walletAddress: address, totalValue, positionCount: portfolio.length, positions: portfolio, chains: { Hoodi: portfolio.filter(p => p.chain === 'Hoodi'), 'Base Sepolia': portfolio.filter(p => p.chain === 'Base Sepolia') } } });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
});

// GET /balances - token balances for swap page
router.get('/balances', async (req, res) => {
  try {
    const address = req.walletAddress || '0xdemo';
    return res.json({
      success: true,
      data: {
        walletAddress: address,
        balances: {
          ETH: { balance: 10.0, symbol: 'ETH', name: 'Ethereum', decimals: 18 },
          USDC: { balance: 25000, symbol: 'USDC', name: 'USD Coin', decimals: 6 },
          SXSDQ: { balance: 5000, symbol: 'SXSDQ', name: 'SXSDQ Token', decimals: 18 },
          SXR: { balance: 1250, symbol: 'SXR', name: 'SX Rewards', decimals: 18 },
          BTC: { balance: 0.5, symbol: 'BTC', name: 'Bitcoin', decimals: 8 },
          SOL: { balance: 100, symbol: 'SOL', name: 'Solana', decimals: 9 },
          LINK: { balance: 500, symbol: 'LINK', name: 'Chainlink', decimals: 18 }
        }
      }
    });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
});

// GET /:address - unified portfolio across both chains with chain badges
router.get('/:address', async (req, res) => {
  try {
    const { address } = req.params;
    const [user] = await db.User.findOrCreate({
      where: { walletAddress: address.toLowerCase() },
      defaults: {
        id: uuidv4(),
        walletAddress: address.toLowerCase(),
        sxId: 'SX-' + Math.random().toString(36).substring(2, 10).toUpperCase()
      }
    });

    await seedDemoPositions(user.id);

    const positions = await db.LeveragedPosition.findAll({
      where: { userId: user.id, status: 'Open' },
      order: [['createdAt', 'DESC']]
    });

    const loans = await db.Loan.findAll({
      where: { userId: user.id, status: 'Active' }
    });

    const rewards = await db.Reward.findAll({
      where: { userId: user.id }
    });

    const shortPositions = await db.ShortPosition.findAll({
      where: { userId: user.id, status: 'Open' }
    });

    let totalValue = 0;
    let totalPnL = 0;
    const hoodiPositions = [];
    const baseSepoliaPositions = [];

    for (const pos of positions) {
      const entryPrice = parseFloat(pos.entryPrice);
      const currentPrice = parseFloat(pos.currentPrice);
      const amount = parseFloat(pos.amount);
      const posType = entryPrice > currentPrice && pos.asset === 'ETH' ? 'Short' : 'Long';
      const { pnl, pnlPercent } = calculatePnL(entryPrice, currentPrice, amount, pos.leverage, posType);

      const posData = {
        id: pos.id,
        asset: pos.asset,
        type: posType,
        leverage: pos.leverage,
        amount: amount,
        entryPrice: entryPrice,
        currentPrice: currentPrice,
        liquidationPrice: parseFloat(pos.liquidationPrice),
        margin: parseFloat(pos.margin),
        pnl: pnl,
        pnlPercent: pnlPercent,
        protection: pos.protection,
        protectionActive: pos.protectionActive,
        chain: pos.chain,
        value: amount * currentPrice
      };

      totalValue += posData.value;
      totalPnL += pnl;

      if (pos.chain === 'Hoodi') {
        hoodiPositions.push(posData);
      } else {
        baseSepoliaPositions.push(posData);
      }
    }

    const totalSxr = rewards.reduce((sum, r) => sum + parseFloat(r.amount), 0);
    const totalLent = loans.filter(l => l.type === 'Lend').reduce((sum, l) => sum + parseFloat(l.amount), 0);
    const totalBorrowed = loans.filter(l => l.type === 'Borrow').reduce((sum, l) => sum + parseFloat(l.amount), 0);

    return res.json({
      success: true,
      data: {
        walletAddress: address,
        sxId: user.sxId,
        summary: {
          totalPortfolioValue: parseFloat(totalValue.toFixed(2)),
          totalPnL: parseFloat(totalPnL.toFixed(2)),
          totalPnLPercent: totalValue > 0 ? parseFloat(((totalPnL / totalValue) * 100).toFixed(4)) : 0,
          totalSxrEarned: parseFloat(totalSxr.toFixed(2)),
          totalLent: parseFloat(totalLent.toFixed(2)),
          totalBorrowed: parseFloat(totalBorrowed.toFixed(2)),
          activePositions: positions.length,
          activeLoans: loans.length,
          activeShorts: shortPositions.length
        },
        chains: {
          hoodi: {
            name: 'Hoodi Testnet',
            chainId: 560048,
            badge: '🟢',
            positions: hoodiPositions,
            positionCount: hoodiPositions.length,
            totalValue: hoodiPositions.reduce((s, p) => s + p.value, 0)
          },
          baseSepolia: {
            name: 'Base Sepolia',
            chainId: 84532,
            badge: '🔵',
            positions: baseSepoliaPositions,
            positionCount: baseSepoliaPositions.length,
            totalValue: baseSepoliaPositions.reduce((s, p) => s + p.value, 0)
          }
        }
      }
    });
  } catch (error) {
    console.error('[Portfolio] GET /:address error:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
});

// POST /settlement/preview - {positionIds, targetChain} → {netValue, summary}
router.post('/settlement/preview', async (req, res) => {
  try {
    const { positionIds, targetChain, walletAddress } = req.body;

    if (!positionIds || !Array.isArray(positionIds) || positionIds.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'positionIds must be a non-empty array'
      });
    }
    if (!targetChain) {
      return res.status(400).json({
        success: false,
        error: 'targetChain is required'
      });
    }

    const positions = await db.LeveragedPosition.findAll({
      where: { id: positionIds, status: 'Open' }
    });

    if (positions.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'No open positions found with the given IDs'
      });
    }

    let netValue = 0;
    const positionSummaries = [];

    for (const pos of positions) {
      const entryPrice = parseFloat(pos.entryPrice);
      const currentPrice = parseFloat(pos.currentPrice);
      const amount = parseFloat(pos.amount);
      const pnl = (currentPrice - entryPrice) * amount;
      const posValue = amount * currentPrice;
      netValue += posValue;

      positionSummaries.push({
        id: pos.id,
        asset: pos.asset,
        amount: amount,
        entryPrice: entryPrice,
        currentPrice: currentPrice,
        pnl: parseFloat(pnl.toFixed(2)),
        value: parseFloat(posValue.toFixed(2)),
        fromChain: pos.chain
      });
    }

    const bridgeFee = parseFloat((netValue * 0.001).toFixed(2));
    const gasCost = 0.005;

    return res.json({
      success: true,
      data: {
        targetChain: targetChain,
        positionCount: positions.length,
        grossValue: parseFloat(netValue.toFixed(2)),
        bridgeFee: bridgeFee,
        estimatedGas: gasCost,
        netValue: parseFloat((netValue - bridgeFee).toFixed(2)),
        positions: positionSummaries,
        estimatedTime: '2-5 minutes'
      }
    });
  } catch (error) {
    console.error('[Portfolio] POST /settlement/preview error:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
});

// POST /settlement/execute - close positions, deliver to target chain
router.post('/settlement/execute', async (req, res) => {
  try {
    const { positionIds, targetChain, walletAddress } = req.body;

    if (!positionIds || !targetChain || !walletAddress) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: positionIds, targetChain, walletAddress'
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

    const positions = await db.LeveragedPosition.findAll({
      where: { id: positionIds, status: 'Open', userId: user.id }
    });

    if (positions.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'No open positions found for this user with the given IDs'
      });
    }

    let netValue = 0;
    for (const pos of positions) {
      const posValue = parseFloat(pos.amount) * parseFloat(pos.currentPrice);
      netValue += posValue;
      await pos.update({ status: 'Closed' });
    }

    const bridgeFee = netValue * 0.001;
    const finalValue = parseFloat((netValue - bridgeFee).toFixed(2));
    const txHash = '0x' + Array.from({ length: 64 }, () => Math.floor(Math.random() * 16).toString(16)).join('');

    const settlement = await db.Settlement.create({
      id: uuidv4(),
      userId: user.id,
      positionIds: positionIds,
      targetChain: targetChain,
      netValue: finalValue,
      txHash: txHash,
      status: 'Settled'
    });

    broadcast('positions', {
      type: 'settlement_executed',
      settlementId: settlement.id,
      targetChain: targetChain,
      netValue: finalValue,
      positionsClosed: positions.length
    });

    return res.json({
      success: true,
      data: {
        settlement: {
          id: settlement.id,
          targetChain: targetChain,
          positionsClosed: positions.length,
          grossValue: parseFloat(netValue.toFixed(2)),
          bridgeFee: parseFloat(bridgeFee.toFixed(2)),
          netValue: finalValue,
          txHash: txHash,
          status: 'Settled',
          timestamp: settlement.createdAt
        }
      }
    });
  } catch (error) {
    console.error('[Portfolio] POST /settlement/execute error:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
});

module.exports = router;
