const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const db = require('../models');

const POOL_STATE = {
  totalDeposited: 1000000,
  totalBorrowed: 350000,
  utilizationRate: 35,
  lendingApy: 5.0,
  borrowingFee: 1.0
};

const ASSET_PRICES = {
  ETH: 3500,
  BTC: 65000,
  SOL: 145,
  LINK: 14.5,
  AVAX: 35
};

// POST /lend - deposit to pool, 5% APY
router.post('/lend', async (req, res) => {
  try {
    const { walletAddress, amount, asset } = req.body;

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

    const loan = await db.Loan.create({
      id: uuidv4(),
      userId: user.id,
      type: 'Lend',
      amount: parsedAmount,
      interestRate: POOL_STATE.lendingApy,
      yieldEarned: 0,
      status: 'Active'
    });

    POOL_STATE.totalDeposited += parsedAmount;
    POOL_STATE.utilizationRate = parseFloat(((POOL_STATE.totalBorrowed / POOL_STATE.totalDeposited) * 100).toFixed(2));

    const estimatedYieldPerYear = parseFloat((parsedAmount * POOL_STATE.lendingApy / 100).toFixed(4));
    const estimatedYieldPerDay = parseFloat((estimatedYieldPerYear / 365).toFixed(6));

    return res.json({
      success: true,
      data: {
        position: {
          id: loan.id,
          type: 'Lend',
          amount: parsedAmount,
          asset: asset || 'USDC',
          apy: `${POOL_STATE.lendingApy}%`,
          interestRate: POOL_STATE.lendingApy,
          status: 'Active',
          createdAt: loan.createdAt
        },
        projections: {
          dailyYield: estimatedYieldPerDay,
          monthlyYield: parseFloat((estimatedYieldPerDay * 30).toFixed(4)),
          annualYield: estimatedYieldPerYear
        },
        pool: {
          totalDeposited: POOL_STATE.totalDeposited,
          utilizationRate: `${POOL_STATE.utilizationRate}%`
        }
      }
    });
  } catch (error) {
    console.error('[Lending] POST /lend error:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
});

// POST /withdraw - withdraw with yield
router.post('/withdraw', async (req, res) => {
  try {
    const { walletAddress, loanId } = req.body;

    if (!walletAddress || !loanId) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: walletAddress, loanId'
      });
    }

    const user = await db.User.findOne({
      where: { walletAddress: walletAddress.toLowerCase() }
    });

    if (!user) {
      return res.status(404).json({ success: false, error: 'User not found' });
    }

    const loan = await db.Loan.findOne({
      where: { id: loanId, userId: user.id, type: 'Lend', status: 'Active' }
    });

    if (!loan) {
      return res.status(404).json({
        success: false,
        error: 'Active lending position not found'
      });
    }

    const depositAmount = parseFloat(loan.amount);
    const daysActive = Math.max(1, Math.ceil((Date.now() - new Date(loan.createdAt).getTime()) / (1000 * 60 * 60 * 24)));
    const yieldEarned = parseFloat((depositAmount * (POOL_STATE.lendingApy / 100) * (daysActive / 365)).toFixed(6));
    const totalWithdrawal = parseFloat((depositAmount + yieldEarned).toFixed(6));

    await loan.update({
      status: 'Closed',
      yieldEarned: yieldEarned
    });

    POOL_STATE.totalDeposited -= depositAmount;
    POOL_STATE.utilizationRate = POOL_STATE.totalDeposited > 0
      ? parseFloat(((POOL_STATE.totalBorrowed / POOL_STATE.totalDeposited) * 100).toFixed(2))
      : 0;

    return res.json({
      success: true,
      data: {
        withdrawal: {
          loanId: loan.id,
          depositAmount: depositAmount,
          yieldEarned: yieldEarned,
          totalWithdrawal: totalWithdrawal,
          daysActive: daysActive,
          effectiveApy: `${POOL_STATE.lendingApy}%`,
          status: 'Closed'
        }
      }
    });
  } catch (error) {
    console.error('[Lending] POST /withdraw error:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
});

// POST /borrow - borrow from pool, 1% fee
router.post('/borrow', async (req, res) => {
  try {
    const { walletAddress, amount, asset } = req.body;

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

    const availableLiquidity = POOL_STATE.totalDeposited - POOL_STATE.totalBorrowed;
    if (parsedAmount > availableLiquidity) {
      return res.status(400).json({
        success: false,
        error: `Insufficient liquidity. Available: ${availableLiquidity.toFixed(2)}, Requested: ${parsedAmount}`
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

    const borrowingFee = parseFloat((parsedAmount * POOL_STATE.borrowingFee / 100).toFixed(6));

    const loan = await db.Loan.create({
      id: uuidv4(),
      userId: user.id,
      type: 'Borrow',
      amount: parsedAmount,
      interestRate: POOL_STATE.borrowingFee,
      yieldEarned: 0,
      status: 'Active'
    });

    POOL_STATE.totalBorrowed += parsedAmount;
    POOL_STATE.utilizationRate = parseFloat(((POOL_STATE.totalBorrowed / POOL_STATE.totalDeposited) * 100).toFixed(2));

    return res.json({
      success: true,
      data: {
        position: {
          id: loan.id,
          type: 'Borrow',
          amount: parsedAmount,
          asset: asset || 'USDC',
          borrowingFee: borrowingFee,
          feeRate: `${POOL_STATE.borrowingFee}%`,
          status: 'Active',
          createdAt: loan.createdAt
        },
        repayment: {
          principal: parsedAmount,
          fee: borrowingFee,
          totalOwed: parseFloat((parsedAmount + borrowingFee).toFixed(6))
        },
        pool: {
          totalBorrowed: POOL_STATE.totalBorrowed,
          utilizationRate: `${POOL_STATE.utilizationRate}%`,
          availableLiquidity: parseFloat((POOL_STATE.totalDeposited - POOL_STATE.totalBorrowed).toFixed(2))
        }
      }
    });
  } catch (error) {
    console.error('[Lending] POST /borrow error:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
});

// POST /short/open - open short position with borrowed assets
router.post('/short/open', async (req, res) => {
  try {
    const { walletAddress, asset, amount } = req.body;

    if (!walletAddress || !asset || !amount) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: walletAddress, asset, amount'
      });
    }

    const upperAsset = asset.toUpperCase();
    const entryPrice = ASSET_PRICES[upperAsset];
    if (!entryPrice) {
      return res.status(400).json({
        success: false,
        error: `Unsupported asset: ${upperAsset}. Supported: ${Object.keys(ASSET_PRICES).join(', ')}`
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

    const borrowValue = parsedAmount * entryPrice;

    const loan = await db.Loan.create({
      id: uuidv4(),
      userId: user.id,
      type: 'Borrow',
      amount: borrowValue,
      interestRate: POOL_STATE.borrowingFee,
      yieldEarned: 0,
      status: 'Active'
    });

    const shortPosition = await db.ShortPosition.create({
      id: uuidv4(),
      userId: user.id,
      asset: upperAsset,
      amount: parsedAmount,
      entryPrice: entryPrice,
      currentPrice: entryPrice,
      profit: 0,
      status: 'Open',
      loanId: loan.id
    });

    return res.json({
      success: true,
      data: {
        shortPosition: {
          id: shortPosition.id,
          asset: upperAsset,
          amount: parsedAmount,
          entryPrice: entryPrice,
          currentPrice: entryPrice,
          profit: 0,
          status: 'Open',
          createdAt: shortPosition.createdAt
        },
        loan: {
          id: loan.id,
          borrowedValue: borrowValue,
          fee: parseFloat((borrowValue * POOL_STATE.borrowingFee / 100).toFixed(6)),
          feeRate: `${POOL_STATE.borrowingFee}%`
        },
        mechanics: {
          description: `Borrowed ${parsedAmount} ${upperAsset} at $${entryPrice}, immediately sold. Will buy back at market price to close.`,
          profitIf: 'Price decreases',
          lossIf: 'Price increases'
        }
      }
    });
  } catch (error) {
    console.error('[Lending] POST /short/open error:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
});

// POST /short/close - close short, return borrowed, keep profit
router.post('/short/close', async (req, res) => {
  try {
    const { walletAddress, shortPositionId } = req.body;

    if (!walletAddress || !shortPositionId) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: walletAddress, shortPositionId'
      });
    }

    const user = await db.User.findOne({
      where: { walletAddress: walletAddress.toLowerCase() }
    });

    if (!user) {
      return res.status(404).json({ success: false, error: 'User not found' });
    }

    const shortPos = await db.ShortPosition.findOne({
      where: { id: shortPositionId, userId: user.id, status: 'Open' }
    });

    if (!shortPos) {
      return res.status(404).json({
        success: false,
        error: 'Open short position not found'
      });
    }

    const entryPrice = parseFloat(shortPos.entryPrice);
    const currentMarketPrice = ASSET_PRICES[shortPos.asset] || entryPrice;
    const simulatedPrice = currentMarketPrice * (0.85 + Math.random() * 0.3);
    const amount = parseFloat(shortPos.amount);
    const profit = (entryPrice - simulatedPrice) * amount;

    await shortPos.update({
      status: 'Closed',
      currentPrice: simulatedPrice,
      profit: profit
    });

    if (shortPos.loanId) {
      const loan = await db.Loan.findOne({ where: { id: shortPos.loanId } });
      if (loan) {
        await loan.update({ status: 'Closed' });
      }
    }

    const borrowingFee = parseFloat(shortPos.amount) * entryPrice * POOL_STATE.borrowingFee / 100;
    const netProfit = parseFloat((profit - borrowingFee).toFixed(6));

    return res.json({
      success: true,
      data: {
        shortPosition: {
          id: shortPos.id,
          asset: shortPos.asset,
          amount: amount,
          entryPrice: entryPrice,
          closePrice: parseFloat(simulatedPrice.toFixed(6)),
          grossProfit: parseFloat(profit.toFixed(6)),
          borrowingFee: parseFloat(borrowingFee.toFixed(6)),
          netProfit: netProfit,
          status: 'Closed'
        },
        result: netProfit > 0 ? 'Profitable' : 'Loss'
      }
    });
  } catch (error) {
    console.error('[Lending] POST /short/close error:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
});

// GET /portfolio/:address - all lending/borrowing positions
router.get('/portfolio/:address', async (req, res) => {
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
          lending: [],
          borrowing: [],
          shorts: [],
          summary: {
            totalLent: 0,
            totalBorrowed: 0,
            totalYieldEarned: 0,
            activeShorts: 0
          }
        }
      });
    }

    const loans = await db.Loan.findAll({
      where: { userId: user.id },
      order: [['createdAt', 'DESC']]
    });

    const shorts = await db.ShortPosition.findAll({
      where: { userId: user.id },
      order: [['createdAt', 'DESC']]
    });

    const lending = loans.filter(l => l.type === 'Lend');
    const borrowing = loans.filter(l => l.type === 'Borrow');

    const totalLent = lending.filter(l => l.status === 'Active').reduce((s, l) => s + parseFloat(l.amount), 0);
    const totalBorrowed = borrowing.filter(l => l.status === 'Active').reduce((s, l) => s + parseFloat(l.amount), 0);
    const totalYieldEarned = lending.reduce((s, l) => s + parseFloat(l.yieldEarned), 0);

    return res.json({
      success: true,
      data: {
        walletAddress: address,
        lending: lending.map(l => ({
          id: l.id,
          amount: parseFloat(l.amount),
          interestRate: parseFloat(l.interestRate),
          yieldEarned: parseFloat(l.yieldEarned),
          status: l.status,
          createdAt: l.createdAt
        })),
        borrowing: borrowing.map(l => ({
          id: l.id,
          amount: parseFloat(l.amount),
          interestRate: parseFloat(l.interestRate),
          fee: parseFloat((parseFloat(l.amount) * parseFloat(l.interestRate) / 100).toFixed(6)),
          status: l.status,
          createdAt: l.createdAt
        })),
        shorts: shorts.map(s => ({
          id: s.id,
          asset: s.asset,
          amount: parseFloat(s.amount),
          entryPrice: parseFloat(s.entryPrice),
          currentPrice: parseFloat(s.currentPrice),
          profit: parseFloat(s.profit),
          status: s.status,
          loanId: s.loanId,
          createdAt: s.createdAt
        })),
        summary: {
          totalLent: parseFloat(totalLent.toFixed(2)),
          totalBorrowed: parseFloat(totalBorrowed.toFixed(2)),
          totalYieldEarned: parseFloat(totalYieldEarned.toFixed(6)),
          activeLendingPositions: lending.filter(l => l.status === 'Active').length,
          activeBorrowPositions: borrowing.filter(l => l.status === 'Active').length,
          activeShorts: shorts.filter(s => s.status === 'Open').length
        },
        pool: {
          totalPoolDeposited: POOL_STATE.totalDeposited,
          totalPoolBorrowed: POOL_STATE.totalBorrowed,
          utilizationRate: `${POOL_STATE.utilizationRate}%`,
          lendingApy: `${POOL_STATE.lendingApy}%`,
          borrowingFee: `${POOL_STATE.borrowingFee}%`
        }
      }
    });
  } catch (error) {
    console.error('[Lending] GET /portfolio/:address error:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
});

module.exports = router;
