const express = require('express');
const router = express.Router();

const CONVERSION_RATES = {
  ETH: { rate: 0.000143, name: 'Ethereum', apy: 44 },
  BTC: { rate: 0.0000077, name: 'Bitcoin', apy: 44 },
  SOL: { rate: 0.00345, name: 'Solana', apy: 44 },
  ECUBES: { rate: 2.0, name: 'eCubes', apy: 44 },
  '300M': { rate: 1.5, name: '300M Token', apy: 44 }
};

const SXR_USD_PRICE = 0.50;

// POST /convert - {sxrAmount, targetToken} → convert SXR
router.post('/convert', async (req, res) => {
  try {
    const { sxrAmount, targetToken } = req.body;

    if (!sxrAmount || !targetToken) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: sxrAmount, targetToken'
      });
    }

    const parsedAmount = parseFloat(sxrAmount);
    if (isNaN(parsedAmount) || parsedAmount <= 0) {
      return res.status(400).json({
        success: false,
        error: 'sxrAmount must be a positive number'
      });
    }

    const upperToken = targetToken.toUpperCase();
    const tokenConfig = CONVERSION_RATES[upperToken];
    if (!tokenConfig) {
      return res.status(400).json({
        success: false,
        error: `Unsupported target token: ${targetToken}. Supported: ${Object.keys(CONVERSION_RATES).join(', ')}`
      });
    }

    const outputAmount = parseFloat((parsedAmount * tokenConfig.rate).toFixed(8));
    const usdValue = parseFloat((parsedAmount * SXR_USD_PRICE).toFixed(2));

    const txHash = '0x' + Array.from({ length: 64 }, () => Math.floor(Math.random() * 16).toString(16)).join('');

    return res.json({
      success: true,
      data: {
        conversion: {
          sxrAmount: parsedAmount,
          sxrUsdValue: usdValue,
          targetToken: upperToken,
          targetTokenName: tokenConfig.name,
          outputAmount: outputAmount,
          rate: tokenConfig.rate,
          rateDescription: `1 SXR = ${tokenConfig.rate} ${upperToken}`,
          txHash: txHash,
          timestamp: new Date().toISOString()
        },
        staking: {
          apy: `${tokenConfig.apy}%`,
          description: `Stake your ${upperToken} for ${tokenConfig.apy}% APY`,
          projectedDailyYield: parseFloat((outputAmount * tokenConfig.apy / 100 / 365).toFixed(8)),
          projectedMonthlyYield: parseFloat((outputAmount * tokenConfig.apy / 100 / 12).toFixed(8)),
          projectedAnnualYield: parseFloat((outputAmount * tokenConfig.apy / 100).toFixed(8))
        }
      }
    });
  } catch (error) {
    console.error('[Conversion] POST /convert error:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
});

// GET /rates - all conversion rates + 44% APY
router.get('/rates', async (req, res) => {
  try {
    const rates = Object.entries(CONVERSION_RATES).map(([token, config]) => ({
      token: token,
      name: config.name,
      sxrToTokenRate: config.rate,
      rateDescription: `1 SXR = ${config.rate} ${token}`,
      stakingApy: `${config.apy}%`,
      example: {
        sxrIn: 1000,
        tokenOut: parseFloat((1000 * config.rate).toFixed(8)),
        annualYield: parseFloat((1000 * config.rate * config.apy / 100).toFixed(8))
      }
    }));

    return res.json({
      success: true,
      data: {
        sxrUsdPrice: SXR_USD_PRICE,
        globalApy: '44%',
        apyDescription: 'All converted tokens earn 44% APY when staked in the SX ecosystem',
        rates: rates,
        lastUpdated: new Date().toISOString()
      }
    });
  } catch (error) {
    console.error('[Conversion] GET /rates error:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
});

module.exports = router;
