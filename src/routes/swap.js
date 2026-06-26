const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const db = require('../models');
const { broadcast } = require('../websocket/ws');

const TOKEN_PRICES = {
  ETH: 3500,
  BTC: 65000,
  USDC: 1,
  USDT: 1,
  DAI: 1,
  SOL: 145,
  LINK: 14.5,
  AVAX: 35,
  MATIC: 0.72,
  ARB: 1.15,
  OP: 2.45,
  SXR: 0.5
};

const SOURCES = [
  'SX Internal Pool - Hoodi',
  'SX Internal Pool - Base Sepolia',
  'External DEX - Hoodi'
];

function getOrFindUser(walletAddress) {
  return db.User.findOrCreate({
    where: { walletAddress: walletAddress.toLowerCase() },
    defaults: {
      id: uuidv4(),
      walletAddress: walletAddress.toLowerCase(),
      sxId: 'SX-' + Math.random().toString(36).substring(2, 10).toUpperCase()
    }
  });
}

function calculateSwapRate(tokenIn, tokenOut) {
  const priceIn = TOKEN_PRICES[tokenIn.toUpperCase()];
  const priceOut = TOKEN_PRICES[tokenOut.toUpperCase()];
  if (!priceIn || !priceOut) return null;
  return priceIn / priceOut;
}

function getBestSource(tokenIn, tokenOut, amountIn) {
  const sourceIndex = Math.floor(Math.random() * SOURCES.length);
  return SOURCES[sourceIndex];
}

function generateTxHash() {
  return '0x' + Array.from({ length: 64 }, () => Math.floor(Math.random() * 16).toString(16)).join('');
}

// POST / - handle swap from frontend format {fromToken, toToken, fromAmount, toAmount}
router.post('/', async (req, res) => {
  try {
    const { fromToken, toToken, fromAmount, toAmount } = req.body;
    const tokenIn = (fromToken || '').toUpperCase();
    const tokenOut = (toToken || '').toUpperCase();
    const amountIn = parseFloat(fromAmount) || 0;

    if (!tokenIn || !tokenOut || amountIn <= 0) {
      return res.status(400).json({ success: false, error: 'Missing required fields' });
    }

    const walletAddress = req.walletAddress || req.body.walletAddress || '0xdemo';
    const [user] = await getOrFindUser(walletAddress);

    const rate = calculateSwapRate(tokenIn, tokenOut) || 1;
    const slippage = 0.003;
    const amountOut = parseFloat(toAmount) || parseFloat((amountIn * rate * (1 - slippage)).toFixed(8));
    const source = SOURCES[Math.floor(Math.random() * SOURCES.length)];
    const txHash = generateTxHash();
    const tradeValueUSD = amountIn * (TOKEN_PRICES[tokenIn] || 1);

    const swap = await db.Swap.create({
      id: uuidv4(), userId: user.id, tokenIn, tokenOut,
      amountIn, amountOut, source, txHash, chain: source.includes('Base') ? 'Base Sepolia' : 'Hoodi'
    });

    await db.Reward.create({
      id: uuidv4(), userId: user.id, amount: tradeValueUSD,
      tradeVolume: tradeValueUSD, source: 'swap', txHash
    });

    broadcast('rewards', { userId: user.id, amount: tradeValueUSD, source: 'swap' });

    return res.json({
      success: true,
      txHash,
      data: {
        swapId: swap.id, tokenIn, tokenOut, amountIn, amountOut,
        rate: parseFloat(rate.toFixed(8)), source, txHash,
        sxrReward: parseFloat(tradeValueUSD.toFixed(2))
      }
    });
  } catch (error) {
    console.error('[Swap] POST / error:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
});

// POST /quote - {tokenIn, tokenOut, amountIn} → {amountOut, source, rate}
router.post('/quote', async (req, res) => {
  try {
    const { tokenIn, tokenOut, amountIn } = req.body;

    if (!tokenIn || !tokenOut || !amountIn) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: tokenIn, tokenOut, amountIn'
      });
    }

    const upperIn = tokenIn.toUpperCase();
    const upperOut = tokenOut.toUpperCase();

    if (!TOKEN_PRICES[upperIn]) {
      return res.status(400).json({
        success: false,
        error: `Unsupported token: ${tokenIn}. Supported: ${Object.keys(TOKEN_PRICES).join(', ')}`
      });
    }
    if (!TOKEN_PRICES[upperOut]) {
      return res.status(400).json({
        success: false,
        error: `Unsupported token: ${tokenOut}. Supported: ${Object.keys(TOKEN_PRICES).join(', ')}`
      });
    }

    const rate = calculateSwapRate(upperIn, upperOut);
    const parsedAmount = parseFloat(amountIn);
    if (isNaN(parsedAmount) || parsedAmount <= 0) {
      return res.status(400).json({
        success: false,
        error: 'amountIn must be a positive number'
      });
    }

    const slippage = 0.003;
    const amountOut = parseFloat((parsedAmount * rate * (1 - slippage)).toFixed(8));
    const source = getBestSource(upperIn, upperOut, parsedAmount);
    const priceImpact = parseFloat((parsedAmount * TOKEN_PRICES[upperIn] > 10000 ? 0.15 : 0.05).toFixed(4));

    return res.json({
      success: true,
      data: {
        tokenIn: upperIn,
        tokenOut: upperOut,
        amountIn: parsedAmount,
        amountOut: amountOut,
        rate: parseFloat(rate.toFixed(8)),
        source: source,
        slippage: `${(slippage * 100).toFixed(1)}%`,
        priceImpact: `${priceImpact}%`,
        estimatedGas: '0.0025 ETH',
        expiresIn: '30 seconds',
        sxrReward: parseFloat((parsedAmount * TOKEN_PRICES[upperIn] * 1).toFixed(2))
      }
    });
  } catch (error) {
    console.error('[Swap] POST /quote error:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
});

// POST /execute - execute swap, save to DB, credit SXR rewards, return txHash
router.post('/execute', async (req, res) => {
  try {
    const { tokenIn, tokenOut, amountIn, walletAddress } = req.body;

    if (!tokenIn || !tokenOut || !amountIn || !walletAddress) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: tokenIn, tokenOut, amountIn, walletAddress'
      });
    }

    const upperIn = tokenIn.toUpperCase();
    const upperOut = tokenOut.toUpperCase();
    const parsedAmount = parseFloat(amountIn);

    if (!TOKEN_PRICES[upperIn] || !TOKEN_PRICES[upperOut]) {
      return res.status(400).json({
        success: false,
        error: 'Unsupported token pair'
      });
    }

    if (isNaN(parsedAmount) || parsedAmount <= 0) {
      return res.status(400).json({
        success: false,
        error: 'amountIn must be a positive number'
      });
    }

    const [user] = await getOrFindUser(walletAddress);
    const rate = calculateSwapRate(upperIn, upperOut);
    const slippage = 0.003;
    const amountOut = parseFloat((parsedAmount * rate * (1 - slippage)).toFixed(8));
    const source = getBestSource(upperIn, upperOut, parsedAmount);
    const txHash = generateTxHash();
    const chain = source.includes('Base') ? 'Base Sepolia' : 'Hoodi';

    const swap = await db.Swap.create({
      id: uuidv4(),
      userId: user.id,
      tokenIn: upperIn,
      tokenOut: upperOut,
      amountIn: parsedAmount,
      amountOut: amountOut,
      source: source,
      txHash: txHash,
      chain: chain
    });

    const tradeVolume = parsedAmount * TOKEN_PRICES[upperIn];
    const sxrReward = parseFloat((tradeVolume * 1).toFixed(2));

    const reward = await db.Reward.create({
      id: uuidv4(),
      userId: user.id,
      amount: sxrReward,
      tradeVolume: tradeVolume,
      source: 'swap',
      txHash: txHash
    });

    broadcast('rewards', {
      type: 'reward_credited',
      userId: user.id,
      amount: sxrReward,
      source: 'swap',
      txHash: txHash
    });

    return res.json({
      success: true,
      data: {
        swap: {
          id: swap.id,
          tokenIn: upperIn,
          tokenOut: upperOut,
          amountIn: parsedAmount,
          amountOut: amountOut,
          rate: parseFloat(rate.toFixed(8)),
          source: source,
          txHash: txHash,
          chain: chain,
          timestamp: swap.createdAt
        },
        reward: {
          sxrEarned: sxrReward,
          tradeVolume: tradeVolume,
          rate: '1 SXR per $1 volume'
        }
      }
    });
  } catch (error) {
    console.error('[Swap] POST /execute error:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
});

// GET /history/:address - user's swap history
router.get('/history/:address', async (req, res) => {
  try {
    const { address } = req.params;
    const user = await db.User.findOne({
      where: { walletAddress: address.toLowerCase() }
    });

    if (!user) {
      return res.json({
        success: true,
        data: [],
        count: 0,
        message: 'No swap history found for this address'
      });
    }

    const swaps = await db.Swap.findAll({
      where: { userId: user.id },
      order: [['createdAt', 'DESC']],
      limit: 100
    });

    return res.json({
      success: true,
      data: swaps.map(s => ({
        id: s.id,
        tokenIn: s.tokenIn,
        tokenOut: s.tokenOut,
        amountIn: parseFloat(s.amountIn),
        amountOut: parseFloat(s.amountOut),
        source: s.source,
        txHash: s.txHash,
        chain: s.chain,
        timestamp: s.createdAt
      })),
      count: swaps.length
    });
  } catch (error) {
    console.error('[Swap] GET /history error:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
});

module.exports = router;
