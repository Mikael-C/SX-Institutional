const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const { Op } = require('sequelize');
const db = require('../models');

// GET / - all events (filterable by eventName, chain, address)
router.get('/', async (req, res) => {
  try {
    const { eventName, chain, address, limit, offset } = req.query;

    const whereClause = {};
    if (eventName) whereClause.eventName = eventName;
    if (chain) whereClause.chain = chain;
    if (address) whereClause.contractAddress = { [Op.iLike]: `%${address}%` };

    const parsedLimit = Math.min(parseInt(limit) || 50, 200);
    const parsedOffset = parseInt(offset) || 0;

    const { rows: events, count } = await db.Event.findAndCountAll({
      where: whereClause,
      order: [['timestamp', 'DESC']],
      limit: parsedLimit,
      offset: parsedOffset
    });

    return res.json({
      success: true,
      data: events.map(e => ({
        id: e.id,
        chain: e.chain,
        contractAddress: e.contractAddress,
        eventName: e.eventName,
        args: e.args,
        blockNumber: e.blockNumber,
        txHash: e.txHash,
        timestamp: e.timestamp
      })),
      pagination: {
        total: count,
        limit: parsedLimit,
        offset: parsedOffset,
        hasMore: parsedOffset + parsedLimit < count
      }
    });
  } catch (error) {
    console.error('[Events] GET / error:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
});

// GET /stats - event counts by type
router.get('/stats', async (req, res) => {
  try {
    const totalEvents = await db.Event.count();

    const eventsByChain = {};
    for (const chain of ['Hoodi', 'Base Sepolia']) {
      eventsByChain[chain] = await db.Event.count({ where: { chain } });
    }

    const eventNames = await db.Event.findAll({
      attributes: ['eventName'],
      group: ['eventName'],
      raw: true
    });

    const eventsByType = {};
    for (const e of eventNames) {
      eventsByType[e.eventName] = await db.Event.count({ where: { eventName: e.eventName } });
    }

    const latestEvent = await db.Event.findOne({
      order: [['timestamp', 'DESC']]
    });

    return res.json({
      success: true,
      data: {
        totalEvents: totalEvents,
        byChain: eventsByChain,
        byType: eventsByType,
        latestEvent: latestEvent ? {
          eventName: latestEvent.eventName,
          chain: latestEvent.chain,
          blockNumber: latestEvent.blockNumber,
          timestamp: latestEvent.timestamp
        } : null
      }
    });
  } catch (error) {
    console.error('[Events] GET /stats error:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
});

// POST /index - manually trigger event indexing
router.post('/index', async (req, res) => {
  try {
    const sampleEvents = [
      {
        chain: 'Hoodi',
        contractAddress: '0x' + 'a'.repeat(40),
        eventName: 'SwapExecuted',
        args: { tokenIn: 'ETH', tokenOut: 'USDC', amountIn: '1.5', amountOut: '5250' },
        blockNumber: Math.floor(Math.random() * 1000000) + 1000000,
        txHash: '0x' + Array.from({ length: 64 }, () => Math.floor(Math.random() * 16).toString(16)).join('')
      },
      {
        chain: 'Base Sepolia',
        contractAddress: '0x' + 'b'.repeat(40),
        eventName: 'PositionOpened',
        args: { user: '0x' + 'c'.repeat(40), leverage: 5, amount: '2.0', asset: 'ETH' },
        blockNumber: Math.floor(Math.random() * 1000000) + 2000000,
        txHash: '0x' + Array.from({ length: 64 }, () => Math.floor(Math.random() * 16).toString(16)).join('')
      },
      {
        chain: 'Hoodi',
        contractAddress: '0x' + 'd'.repeat(40),
        eventName: 'OraclePriceUpdated',
        args: { asset: 'ETH', price: '3500.50', source: 'Chainlink' },
        blockNumber: Math.floor(Math.random() * 1000000) + 1000000,
        txHash: '0x' + Array.from({ length: 64 }, () => Math.floor(Math.random() * 16).toString(16)).join('')
      },
      {
        chain: 'Base Sepolia',
        contractAddress: '0x' + 'e'.repeat(40),
        eventName: 'RewardDistributed',
        args: { user: '0x' + 'f'.repeat(40), amount: '1000', source: 'swap' },
        blockNumber: Math.floor(Math.random() * 1000000) + 2000000,
        txHash: '0x' + Array.from({ length: 64 }, () => Math.floor(Math.random() * 16).toString(16)).join('')
      },
      {
        chain: 'Hoodi',
        contractAddress: '0x' + '1'.repeat(40),
        eventName: 'HiddenOrderPlaced',
        args: { tier: 'HOBL', commitment: '0x' + 'abc'.repeat(20) },
        blockNumber: Math.floor(Math.random() * 1000000) + 1000000,
        txHash: '0x' + Array.from({ length: 64 }, () => Math.floor(Math.random() * 16).toString(16)).join('')
      },
      {
        chain: 'Base Sepolia',
        contractAddress: '0x' + '2'.repeat(40),
        eventName: 'SettlementCompleted',
        args: { targetChain: 'Hoodi', netValue: '15000.50', positionsClosed: 3 },
        blockNumber: Math.floor(Math.random() * 1000000) + 2000000,
        txHash: '0x' + Array.from({ length: 64 }, () => Math.floor(Math.random() * 16).toString(16)).join('')
      }
    ];

    const createdEvents = [];
    for (const evt of sampleEvents) {
      const event = await db.Event.create({
        id: uuidv4(),
        chain: evt.chain,
        contractAddress: evt.contractAddress,
        eventName: evt.eventName,
        args: evt.args,
        blockNumber: evt.blockNumber,
        txHash: evt.txHash,
        timestamp: new Date()
      });
      createdEvents.push(event);
    }

    return res.json({
      success: true,
      data: {
        message: `Indexed ${createdEvents.length} events`,
        events: createdEvents.map(e => ({
          id: e.id,
          eventName: e.eventName,
          chain: e.chain,
          blockNumber: e.blockNumber,
          txHash: e.txHash
        })),
        indexedAt: new Date().toISOString()
      }
    });
  } catch (error) {
    console.error('[Events] POST /index error:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
});

module.exports = router;
