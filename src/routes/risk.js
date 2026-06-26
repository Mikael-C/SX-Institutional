const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const db = require('../models');

function calculateRiskScore(positions) {
  if (!positions || positions.length === 0) {
    return { score: 0, volatility: 0, correlation: 0, concentration: 0, borrowingPower: 0 };
  }

  let totalValue = 0;
  let weightedLeverage = 0;
  const assetMap = {};

  for (const pos of positions) {
    const value = parseFloat(pos.amount) * parseFloat(pos.currentPrice);
    totalValue += value;
    weightedLeverage += pos.leverage * value;
    assetMap[pos.asset] = (assetMap[pos.asset] || 0) + value;
  }

  const avgLeverage = totalValue > 0 ? weightedLeverage / totalValue : 1;
  const leverageRisk = Math.min(avgLeverage / 10, 1);

  const assetValues = Object.values(assetMap);
  const maxConcentration = assetValues.length > 0
    ? Math.max(...assetValues) / totalValue
    : 1;
  const concentrationRisk = maxConcentration;

  const volatility = parseFloat((0.15 + Math.random() * 0.25).toFixed(4));
  const correlation = parseFloat((0.3 + Math.random() * 0.4).toFixed(4));

  const rawScore = (leverageRisk * 30) + (concentrationRisk * 25) + (volatility * 25) + (correlation * 20);
  const score = Math.min(100, Math.max(0, Math.round(rawScore * 100 / 100)));

  const borrowingPower = parseFloat((totalValue * (1 - score / 100) * 0.7).toFixed(2));

  return {
    score,
    volatility,
    correlation,
    concentration: parseFloat(concentrationRisk.toFixed(4)),
    borrowingPower,
    totalValue,
    avgLeverage: parseFloat(avgLeverage.toFixed(2)),
    positionCount: positions.length
  };
}

// GET /:address - risk score (0-100), borrowing power, volatility, correlation, concentration
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

    const positions = await db.LeveragedPosition.findAll({
      where: { userId: user.id, status: 'Open' }
    });

    const riskMetrics = calculateRiskScore(positions);

    const riskRecord = await db.RiskScore.create({
      id: uuidv4(),
      userId: user.id,
      score: riskMetrics.score,
      borrowingPower: riskMetrics.borrowingPower,
      volatility: riskMetrics.volatility,
      correlation: riskMetrics.correlation,
      concentration: riskMetrics.concentration
    });

    let riskLevel = 'Low';
    if (riskMetrics.score > 70) riskLevel = 'Critical';
    else if (riskMetrics.score > 50) riskLevel = 'High';
    else if (riskMetrics.score > 30) riskLevel = 'Medium';

    return res.json({
      success: true,
      data: {
        walletAddress: address,
        riskScore: riskMetrics.score,
        riskLevel: riskLevel,
        borrowingPower: riskMetrics.borrowingPower,
        volatility: riskMetrics.volatility,
        correlation: riskMetrics.correlation,
        concentration: riskMetrics.concentration,
        totalPortfolioValue: riskMetrics.totalValue || 0,
        averageLeverage: riskMetrics.avgLeverage || 0,
        positionCount: riskMetrics.positionCount || 0,
        breakdown: {
          leverageContribution: `${(riskMetrics.avgLeverage / 10 * 30).toFixed(1)}%`,
          concentrationContribution: `${(riskMetrics.concentration * 25).toFixed(1)}%`,
          volatilityContribution: `${(riskMetrics.volatility * 25).toFixed(1)}%`,
          correlationContribution: `${(riskMetrics.correlation * 20).toFixed(1)}%`
        },
        lastCalculated: riskRecord.createdAt
      }
    });
  } catch (error) {
    console.error('[Risk] GET /:address error:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
});

// POST /inject-equity - add collateral, recalculate borrowing power
router.post('/inject-equity', async (req, res) => {
  try {
    const { walletAddress, amount } = req.body;

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

    const positions = await db.LeveragedPosition.findAll({
      where: { userId: user.id, status: 'Open' }
    });

    for (const pos of positions) {
      const newMargin = parseFloat(pos.margin) + (parsedAmount / positions.length);
      const newLiqPrice = parseFloat(pos.entryPrice) * (1 - (newMargin / (parseFloat(pos.amount) * parseFloat(pos.entryPrice))) * 0.9);
      await pos.update({
        margin: newMargin,
        liquidationPrice: Math.max(0, newLiqPrice)
      });
    }

    const updatedPositions = await db.LeveragedPosition.findAll({
      where: { userId: user.id, status: 'Open' }
    });
    const newRisk = calculateRiskScore(updatedPositions);

    await db.RiskScore.create({
      id: uuidv4(),
      userId: user.id,
      score: newRisk.score,
      borrowingPower: newRisk.borrowingPower,
      volatility: newRisk.volatility,
      correlation: newRisk.correlation,
      concentration: newRisk.concentration
    });

    return res.json({
      success: true,
      data: {
        message: `Injected ${parsedAmount} ETH equity across ${positions.length} positions`,
        equityInjected: parsedAmount,
        newRiskScore: newRisk.score,
        newBorrowingPower: newRisk.borrowingPower,
        positionsUpdated: positions.length
      }
    });
  } catch (error) {
    console.error('[Risk] POST /inject-equity error:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
});

// POST /close-portfolio - close entire portfolio (NO partial)
router.post('/close-portfolio', async (req, res) => {
  try {
    const { walletAddress } = req.body;

    if (!walletAddress) {
      return res.status(400).json({
        success: false,
        error: 'Missing required field: walletAddress'
      });
    }

    const user = await db.User.findOne({
      where: { walletAddress: walletAddress.toLowerCase() }
    });

    if (!user) {
      return res.status(404).json({
        success: false,
        error: 'User not found'
      });
    }

    const openPositions = await db.LeveragedPosition.findAll({
      where: { userId: user.id, status: 'Open' }
    });

    if (openPositions.length === 0) {
      return res.json({
        success: true,
        data: {
          message: 'No open positions to close',
          positionsClosed: 0
        }
      });
    }

    let totalPnL = 0;
    let totalValue = 0;
    const closedPositions = [];

    for (const pos of openPositions) {
      const entryPrice = parseFloat(pos.entryPrice);
      const currentPrice = parseFloat(pos.currentPrice);
      const amount = parseFloat(pos.amount);
      const pnl = (currentPrice - entryPrice) * amount;
      const value = amount * currentPrice;
      totalPnL += pnl;
      totalValue += value;

      await pos.update({ status: 'Closed' });

      closedPositions.push({
        id: pos.id,
        asset: pos.asset,
        pnl: parseFloat(pnl.toFixed(2)),
        value: parseFloat(value.toFixed(2)),
        chain: pos.chain
      });
    }

    await db.RiskScore.create({
      id: uuidv4(),
      userId: user.id,
      score: 0,
      borrowingPower: 0,
      volatility: 0,
      correlation: 0,
      concentration: 0
    });

    return res.json({
      success: true,
      data: {
        message: `Closed entire portfolio: ${openPositions.length} positions`,
        positionsClosed: openPositions.length,
        totalValue: parseFloat(totalValue.toFixed(2)),
        totalPnL: parseFloat(totalPnL.toFixed(2)),
        newRiskScore: 0,
        newBorrowingPower: 0,
        positions: closedPositions
      }
    });
  } catch (error) {
    console.error('[Risk] POST /close-portfolio error:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
});

// POST /simulate-drop - simulate asset price drop for demo
router.post('/simulate-drop', async (req, res) => {
  try {
    const { walletAddress, dropPercent, asset } = req.body;

    if (!walletAddress) {
      return res.status(400).json({
        success: false,
        error: 'Missing required field: walletAddress'
      });
    }

    const drop = parseFloat(dropPercent || 20) / 100;
    const targetAsset = (asset || '').toUpperCase();

    const user = await db.User.findOne({
      where: { walletAddress: walletAddress.toLowerCase() }
    });

    if (!user) {
      return res.status(404).json({
        success: false,
        error: 'User not found'
      });
    }

    const whereClause = { userId: user.id, status: 'Open' };
    if (targetAsset) {
      whereClause.asset = targetAsset;
    }

    const positions = await db.LeveragedPosition.findAll({ where: whereClause });

    if (positions.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'No open positions found'
      });
    }

    const results = [];
    let liquidatedCount = 0;

    for (const pos of positions) {
      const currentPrice = parseFloat(pos.currentPrice);
      const newPrice = parseFloat((currentPrice * (1 - drop)).toFixed(6));
      const liquidationPrice = parseFloat(pos.liquidationPrice);

      const isLiquidated = newPrice <= liquidationPrice;
      if (isLiquidated) liquidatedCount++;

      await pos.update({
        currentPrice: newPrice,
        status: isLiquidated ? 'Liquidated' : 'Open',
        protectionActive: pos.protection && !isLiquidated && newPrice < currentPrice * 0.95
      });

      const pnl = (newPrice - parseFloat(pos.entryPrice)) * parseFloat(pos.amount);

      results.push({
        id: pos.id,
        asset: pos.asset,
        previousPrice: currentPrice,
        newPrice: newPrice,
        liquidationPrice: liquidationPrice,
        isLiquidated: isLiquidated,
        protectionActive: pos.protection && !isLiquidated && newPrice < currentPrice * 0.95,
        pnl: parseFloat(pnl.toFixed(2)),
        chain: pos.chain
      });
    }

    const updatedPositions = await db.LeveragedPosition.findAll({
      where: { userId: user.id, status: 'Open' }
    });
    const newRisk = calculateRiskScore(updatedPositions);

    return res.json({
      success: true,
      data: {
        message: `Simulated ${(drop * 100).toFixed(1)}% price drop${targetAsset ? ` for ${targetAsset}` : ''}`,
        dropPercent: (drop * 100).toFixed(1),
        positionsAffected: positions.length,
        liquidated: liquidatedCount,
        newRiskScore: newRisk.score,
        positions: results
      }
    });
  } catch (error) {
    console.error('[Risk] POST /simulate-drop error:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
});

module.exports = router;
