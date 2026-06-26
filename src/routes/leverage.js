const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const db = require('../models');
const { broadcast } = require('../websocket/ws');

const ASSET_PRICES = {
  ETH: 3500,
  BTC: 65000,
  SOL: 145,
  LINK: 14.5,
  AVAX: 35,
  MATIC: 0.72,
  ARB: 1.15,
  OP: 2.45
};

function calculateLiquidationPrice(entryPrice, leverage, margin, amount) {
  const maintenanceMarginRatio = 0.05;
  const liquidationPrice = entryPrice * (1 - (1 / leverage) + maintenanceMarginRatio);
  return parseFloat(Math.max(0, liquidationPrice).toFixed(6));
}

function generateTxHash() {
  return '0x' + Array.from({ length: 64 }, () => Math.floor(Math.random() * 16).toString(16)).join('');
}

// POST /open - {leverage, amount, protection, asset} → open position
router.post('/open', async (req, res) => {
  try {
    const { leverage, amount, protection, asset, walletAddress, chain } = req.body;

    if (!leverage || !amount || !walletAddress) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: leverage, amount, walletAddress'
      });
    }

    const parsedLeverage = parseInt(leverage);
    const parsedAmount = parseFloat(amount);

    if (isNaN(parsedLeverage) || parsedLeverage < 1 || parsedLeverage > 100) {
      return res.status(400).json({
        success: false,
        error: 'Leverage must be between 1 and 100'
      });
    }

    if (isNaN(parsedAmount) || parsedAmount <= 0) {
      return res.status(400).json({
        success: false,
        error: 'Amount must be a positive number'
      });
    }

    const targetAsset = (asset || 'ETH').toUpperCase();
    const entryPrice = ASSET_PRICES[targetAsset];
    if (!entryPrice) {
      return res.status(400).json({
        success: false,
        error: `Unsupported asset: ${targetAsset}. Supported: ${Object.keys(ASSET_PRICES).join(', ')}`
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

    const margin = parseFloat((parsedAmount * entryPrice / parsedLeverage).toFixed(6));
    const liquidationPrice = calculateLiquidationPrice(entryPrice, parsedLeverage, margin, parsedAmount);
    const posChain = chain || 'Hoodi';
    const useProtection = protection === true || protection === 'true';

    const position = await db.LeveragedPosition.create({
      id: uuidv4(),
      userId: user.id,
      asset: targetAsset,
      leverage: parsedLeverage,
      amount: parsedAmount,
      entryPrice: entryPrice,
      currentPrice: entryPrice,
      liquidationPrice: liquidationPrice,
      margin: margin,
      protection: useProtection,
      protectionActive: false,
      status: 'Open',
      chain: posChain
    });

    const protectionCost = useProtection ? parseFloat((margin * 0.02).toFixed(6)) : 0;

    broadcast('positions', {
      type: 'position_opened',
      positionId: position.id,
      asset: targetAsset,
      leverage: parsedLeverage,
      amount: parsedAmount,
      entryPrice: entryPrice,
      chain: posChain
    });

    return res.json({
      success: true,
      data: {
        position: {
          id: position.id,
          asset: targetAsset,
          leverage: parsedLeverage,
          amount: parsedAmount,
          entryPrice: entryPrice,
          currentPrice: entryPrice,
          liquidationPrice: liquidationPrice,
          margin: margin,
          protection: useProtection,
          protectionCost: protectionCost,
          chain: posChain,
          status: 'Open',
          createdAt: position.createdAt
        },
        riskWarning: parsedLeverage > 10
          ? `High leverage (${parsedLeverage}x). Liquidation at $${liquidationPrice.toFixed(2)}`
          : null
      }
    });
  } catch (error) {
    console.error('[Leverage] POST /open error:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
});

// GET /positions/:address - user's leveraged positions
router.get('/positions/:address', async (req, res) => {
  try {
    const { address } = req.params;
    const { status } = req.query;

    const user = await db.User.findOne({
      where: { walletAddress: address.toLowerCase() }
    });

    if (!user) {
      return res.json({
        success: true,
        data: [],
        count: 0,
        message: 'No positions found for this address'
      });
    }

    const whereClause = { userId: user.id };
    if (status) {
      whereClause.status = status;
    }

    const positions = await db.LeveragedPosition.findAll({
      where: whereClause,
      order: [['createdAt', 'DESC']]
    });

    return res.json({
      success: true,
      data: positions.map(p => {
        const entryPrice = parseFloat(p.entryPrice);
        const currentPrice = parseFloat(p.currentPrice);
        const amount = parseFloat(p.amount);
        const pnl = (currentPrice - entryPrice) * amount;
        const pnlPercent = ((currentPrice - entryPrice) / entryPrice * 100 * p.leverage);

        return {
          id: p.id,
          asset: p.asset,
          leverage: p.leverage,
          amount: amount,
          entryPrice: entryPrice,
          currentPrice: currentPrice,
          liquidationPrice: parseFloat(p.liquidationPrice),
          margin: parseFloat(p.margin),
          pnl: parseFloat(pnl.toFixed(2)),
          pnlPercent: parseFloat(pnlPercent.toFixed(4)),
          protection: p.protection,
          protectionActive: p.protectionActive,
          status: p.status,
          chain: p.chain,
          createdAt: p.createdAt
        };
      }),
      count: positions.length,
      summary: {
        open: positions.filter(p => p.status === 'Open').length,
        closed: positions.filter(p => p.status === 'Closed').length,
        liquidated: positions.filter(p => p.status === 'Liquidated').length
      }
    });
  } catch (error) {
    console.error('[Leverage] GET /positions/:address error:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
});

// POST /close/:positionId - close position
router.post('/close/:positionId', async (req, res) => {
  try {
    const { positionId } = req.params;

    const position = await db.LeveragedPosition.findOne({
      where: { id: positionId }
    });

    if (!position) {
      return res.status(404).json({
        success: false,
        error: 'Position not found'
      });
    }

    if (position.status !== 'Open') {
      return res.status(400).json({
        success: false,
        error: `Position is already ${position.status}`
      });
    }

    const entryPrice = parseFloat(position.entryPrice);
    const currentPrice = parseFloat(position.currentPrice);
    const amount = parseFloat(position.amount);
    const pnl = (currentPrice - entryPrice) * amount;
    const pnlPercent = ((currentPrice - entryPrice) / entryPrice * 100 * position.leverage);

    await position.update({ status: 'Closed' });

    const txHash = generateTxHash();

    broadcast('positions', {
      type: 'position_closed',
      positionId: position.id,
      asset: position.asset,
      pnl: parseFloat(pnl.toFixed(2)),
      chain: position.chain
    });

    return res.json({
      success: true,
      data: {
        position: {
          id: position.id,
          asset: position.asset,
          leverage: position.leverage,
          amount: amount,
          entryPrice: entryPrice,
          exitPrice: currentPrice,
          pnl: parseFloat(pnl.toFixed(2)),
          pnlPercent: parseFloat(pnlPercent.toFixed(4)),
          margin: parseFloat(position.margin),
          status: 'Closed',
          chain: position.chain,
          txHash: txHash
        }
      }
    });
  } catch (error) {
    console.error('[Leverage] POST /close/:positionId error:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
});

// POST /simulate-price/:positionId - simulate price move for protection demo
router.post('/simulate-price/:positionId', async (req, res) => {
  try {
    const { positionId } = req.params;
    const { newPrice, priceChangePercent } = req.body;

    const position = await db.LeveragedPosition.findOne({
      where: { id: positionId }
    });

    if (!position) {
      return res.status(404).json({
        success: false,
        error: 'Position not found'
      });
    }

    if (position.status !== 'Open') {
      return res.status(400).json({
        success: false,
        error: `Position is not open. Status: ${position.status}`
      });
    }

    const currentPrice = parseFloat(position.currentPrice);
    let simulatedPrice;

    if (newPrice) {
      simulatedPrice = parseFloat(newPrice);
    } else if (priceChangePercent) {
      const change = parseFloat(priceChangePercent) / 100;
      simulatedPrice = parseFloat((currentPrice * (1 + change)).toFixed(6));
    } else {
      simulatedPrice = parseFloat((currentPrice * 0.9).toFixed(6));
    }

    const liquidationPrice = parseFloat(position.liquidationPrice);
    const isLiquidated = simulatedPrice <= liquidationPrice;

    let protectionActivated = false;
    if (position.protection && !isLiquidated) {
      const dropPercent = ((currentPrice - simulatedPrice) / currentPrice) * 100;
      if (dropPercent > 5) {
        protectionActivated = true;
      }
    }

    const updateData = {
      currentPrice: simulatedPrice,
      protectionActive: protectionActivated
    };

    if (isLiquidated && !position.protection) {
      updateData.status = 'Liquidated';
    } else if (isLiquidated && position.protection) {
      updateData.status = 'Closed';
      protectionActivated = true;
      updateData.protectionActive = true;
    }

    await position.update(updateData);

    const entryPrice = parseFloat(position.entryPrice);
    const amount = parseFloat(position.amount);
    const pnl = (simulatedPrice - entryPrice) * amount;
    const pnlPercent = ((simulatedPrice - entryPrice) / entryPrice * 100 * position.leverage);

    broadcast('positions', {
      type: 'price_simulated',
      positionId: position.id,
      asset: position.asset,
      previousPrice: currentPrice,
      newPrice: simulatedPrice,
      protectionActivated: protectionActivated,
      isLiquidated: isLiquidated && !position.protection
    });

    return res.json({
      success: true,
      data: {
        position: {
          id: position.id,
          asset: position.asset,
          leverage: position.leverage,
          amount: amount,
          entryPrice: entryPrice,
          previousPrice: currentPrice,
          simulatedPrice: simulatedPrice,
          liquidationPrice: liquidationPrice,
          pnl: parseFloat(pnl.toFixed(2)),
          pnlPercent: parseFloat(pnlPercent.toFixed(4)),
          status: position.status
        },
        protection: {
          enabled: position.protection,
          activated: protectionActivated,
          wouldHaveLiquidated: isLiquidated,
          savedByProtection: isLiquidated && position.protection,
          message: protectionActivated
            ? 'Protection activated! Position was closed to prevent liquidation loss.'
            : isLiquidated && !position.protection
              ? 'LIQUIDATED! No protection enabled.'
              : 'Position safe. Price within acceptable range.'
        }
      }
    });
  } catch (error) {
    console.error('[Leverage] POST /simulate-price/:positionId error:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
});

module.exports = router;
