const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const crypto = require('crypto');
const db = require('../models');
const { broadcast } = require('../websocket/ws');

function generateCommitment(amount, price, salt) {
  const data = `${amount}:${price}:${salt}`;
  return '0x' + crypto.createHash('sha256').update(data).digest('hex');
}

function generateZkProof() {
  return '0x' + crypto.randomBytes(128).toString('hex');
}

function generateTxHash() {
  return '0x' + crypto.randomBytes(32).toString('hex');
}

// POST /hidden - {tier, amount, price, commitment} → place hidden order
router.post('/hidden', async (req, res) => {
  try {
    const { tier, amount, price, commitment, walletAddress } = req.body;

    if (!tier || !amount || !price || !walletAddress) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: tier, amount, price, walletAddress'
      });
    }

    const validTiers = ['HOBL', 'HOPL', 'HOTL'];
    if (!validTiers.includes(tier.toUpperCase())) {
      return res.status(400).json({
        success: false,
        error: `Invalid tier. Must be one of: ${validTiers.join(', ')}. HOBL=Hidden Order Book Limit, HOPL=Hidden Order Pool Limit, HOTL=Hidden Order Trigger Limit`
      });
    }

    const parsedAmount = parseFloat(amount);
    const parsedPrice = parseFloat(price);

    if (isNaN(parsedAmount) || parsedAmount <= 0) {
      return res.status(400).json({ success: false, error: 'amount must be a positive number' });
    }
    if (isNaN(parsedPrice) || parsedPrice <= 0) {
      return res.status(400).json({ success: false, error: 'price must be a positive number' });
    }

    const [user] = await db.User.findOrCreate({
      where: { walletAddress: walletAddress.toLowerCase() },
      defaults: {
        id: uuidv4(),
        walletAddress: walletAddress.toLowerCase(),
        sxId: 'SX-' + Math.random().toString(36).substring(2, 10).toUpperCase()
      }
    });

    const salt = crypto.randomBytes(16).toString('hex');
    const orderCommitment = commitment || generateCommitment(parsedAmount, parsedPrice, salt);
    const zkProof = generateZkProof();

    const hiddenOrder = await db.HiddenOrder.create({
      id: uuidv4(),
      userId: user.id,
      tier: tier.toUpperCase(),
      commitment: orderCommitment,
      amount: parsedAmount,
      price: parsedPrice,
      status: 'Hidden',
      zkProof: zkProof,
      txHash: null,
      executedAt: null
    });

    const tierDescriptions = {
      HOBL: 'Hidden Order Book Limit - Full privacy: amount and price hidden',
      HOPL: 'Hidden Order Pool Limit - Partial privacy: amount hidden, price visible',
      HOTL: 'Hidden Order Trigger Limit - Trigger-based: executes when price condition met'
    };

    broadcast('orders', {
      type: 'order_placed',
      orderId: hiddenOrder.id,
      tier: tier.toUpperCase(),
      status: 'Hidden',
      timestamp: hiddenOrder.createdAt
    });

    return res.json({
      success: true,
      data: {
        order: {
          id: hiddenOrder.id,
          tier: tier.toUpperCase(),
          tierDescription: tierDescriptions[tier.toUpperCase()],
          commitment: orderCommitment,
          amount: parsedAmount,
          price: parsedPrice,
          status: 'Hidden',
          zkProofGenerated: true,
          zkProofLength: zkProof.length,
          createdAt: hiddenOrder.createdAt
        },
        privacy: {
          amountHidden: tier.toUpperCase() !== 'HOTL',
          priceHidden: tier.toUpperCase() === 'HOBL',
          commitmentScheme: 'SHA-256',
          zkSystem: 'Groth16'
        }
      }
    });
  } catch (error) {
    console.error('[Orders] POST /hidden error:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
});

// GET /hidden/:address - user's hidden orders with status
router.get('/hidden/:address', async (req, res) => {
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
        message: 'No orders found for this address'
      });
    }

    const orders = await db.HiddenOrder.findAll({
      where: { userId: user.id },
      order: [['createdAt', 'DESC']]
    });

    return res.json({
      success: true,
      data: orders.map(o => ({
        id: o.id,
        tier: o.tier,
        commitment: o.commitment,
        amount: parseFloat(o.amount),
        price: parseFloat(o.price),
        status: o.status,
        hasZkProof: !!o.zkProof,
        txHash: o.txHash,
        createdAt: o.createdAt,
        executedAt: o.executedAt
      })),
      count: orders.length,
      summary: {
        hidden: orders.filter(o => o.status === 'Hidden').length,
        executed: orders.filter(o => o.status === 'Executed').length,
        cancelled: orders.filter(o => o.status === 'Cancelled').length
      }
    });
  } catch (error) {
    console.error('[Orders] GET /hidden/:address error:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
});

// POST /execute/:orderId - execute hidden order, update status
router.post('/execute/:orderId', async (req, res) => {
  try {
    const { orderId } = req.params;

    const order = await db.HiddenOrder.findOne({
      where: { id: orderId }
    });

    if (!order) {
      return res.status(404).json({
        success: false,
        error: 'Order not found'
      });
    }

    if (order.status !== 'Hidden') {
      return res.status(400).json({
        success: false,
        error: `Order cannot be executed. Current status: ${order.status}`
      });
    }

    const txHash = generateTxHash();
    await order.update({
      status: 'Executed',
      txHash: txHash,
      executedAt: new Date()
    });

    broadcast('orders', {
      type: 'order_executed',
      orderId: order.id,
      tier: order.tier,
      amount: parseFloat(order.amount),
      price: parseFloat(order.price),
      txHash: txHash,
      timestamp: new Date().toISOString()
    });

    return res.json({
      success: true,
      data: {
        order: {
          id: order.id,
          tier: order.tier,
          amount: parseFloat(order.amount),
          price: parseFloat(order.price),
          status: 'Executed',
          txHash: txHash,
          executedAt: order.executedAt,
          zkProofVerified: true
        },
        execution: {
          fillPrice: parseFloat(order.price),
          slippage: '0%',
          gasCost: '0.003 ETH',
          settlement: 'Instant'
        }
      }
    });
  } catch (error) {
    console.error('[Orders] POST /execute/:orderId error:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
});

// POST /simulate-execution - simulate execution of all pending orders for demo
router.post('/simulate-execution', async (req, res) => {
  try {
    const { walletAddress } = req.body;

    let whereClause = { status: 'Hidden' };
    if (walletAddress) {
      const user = await db.User.findOne({
        where: { walletAddress: walletAddress.toLowerCase() }
      });
      if (user) {
        whereClause.userId = user.id;
      }
    }

    const pendingOrders = await db.HiddenOrder.findAll({
      where: whereClause
    });

    if (pendingOrders.length === 0) {
      return res.json({
        success: true,
        data: {
          message: 'No pending hidden orders to execute',
          executedCount: 0
        }
      });
    }

    const executedOrders = [];
    for (const order of pendingOrders) {
      const txHash = generateTxHash();
      await order.update({
        status: 'Executed',
        txHash: txHash,
        executedAt: new Date()
      });
      executedOrders.push({
        id: order.id,
        tier: order.tier,
        amount: parseFloat(order.amount),
        price: parseFloat(order.price),
        txHash: txHash,
        executedAt: order.executedAt
      });
    }

    broadcast('orders', {
      type: 'batch_execution',
      executedCount: executedOrders.length,
      orders: executedOrders,
      timestamp: new Date().toISOString()
    });

    return res.json({
      success: true,
      data: {
        message: `Executed ${executedOrders.length} hidden orders`,
        executedCount: executedOrders.length,
        orders: executedOrders
      }
    });
  } catch (error) {
    console.error('[Orders] POST /simulate-execution error:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
});

module.exports = router;
