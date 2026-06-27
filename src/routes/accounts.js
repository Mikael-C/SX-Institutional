const express = require('express');
const router = express.Router();
const db = require('../models');

/**
 * Generate a unique SXUA account ID
 * Format: SXUA-XXXXXX (6 uppercase alphanumeric chars)
 */
function generateSXUAId() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // exclude confusing chars like 0/O, 1/I
  let id = 'SXUA-';
  for (let i = 0; i < 6; i++) {
    id += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return id;
}

/**
 * POST /api/accounts/create
 * Creates a new SXUA account for a wallet address
 * Body: { walletAddress, username, referralCode? }
 */
router.post('/create', async (req, res) => {
  const { walletAddress, username, referralCode } = req.body;

  if (!walletAddress) {
    return res.status(400).json({ success: false, error: 'walletAddress is required' });
  }
  if (!username || username.trim().length < 3) {
    return res.status(400).json({ success: false, error: 'username must be at least 3 characters' });
  }
  if (username.trim().length > 30) {
    return res.status(400).json({ success: false, error: 'username must be 30 characters or less' });
  }
  if (!/^[a-zA-Z0-9_-]+$/.test(username.trim())) {
    return res.status(400).json({ success: false, error: 'username may only contain letters, numbers, underscores, and hyphens' });
  }

  try {
    // Check if account already exists for this wallet
    const existing = await db.User.findOne({ where: { walletAddress: walletAddress.toLowerCase() } });
    if (existing) {
      return res.status(409).json({
        success: false,
        error: 'An account already exists for this wallet address',
        data: {
          sxuaId: existing.sxId,
          username: existing.username,
          walletAddress: existing.walletAddress,
          createdAt: existing.createdAt,
        }
      });
    }

    // Generate a unique SXUA ID (retry if collision)
    let sxuaId;
    let attempts = 0;
    do {
      sxuaId = generateSXUAId();
      const collision = await db.User.findOne({ where: { sxId: sxuaId } });
      if (!collision) break;
      attempts++;
    } while (attempts < 10);

    if (attempts >= 10) {
      return res.status(500).json({ success: false, error: 'Failed to generate unique SXUA ID. Please try again.' });
    }

    // Create the account
    const user = await db.User.create({
      walletAddress: walletAddress.toLowerCase(),
      sxId: sxuaId,
      username: username.trim(),
      referralCode: referralCode || null,
      accountTier: 'Standard',
      createdAt: new Date(),
    });

    return res.status(201).json({
      success: true,
      data: {
        sxuaId: user.sxId,
        username: user.username,
        walletAddress: user.walletAddress,
        accountTier: user.accountTier,
        createdAt: user.createdAt,
      }
    });
  } catch (error) {
    console.error('[Accounts] Error creating account:', error);
    if (error.name === 'SequelizeUniqueConstraintError') {
      return res.status(409).json({ success: false, error: 'Username or wallet address is already taken.' });
    }
    return res.status(500).json({ success: false, error: 'Failed to create account' });
  }
});

/**
 * GET /api/accounts/:walletAddress
 * Returns account info for a given wallet address
 */
router.get('/:walletAddress', async (req, res) => {
  const { walletAddress } = req.params;
  if (!walletAddress) {
    return res.status(400).json({ success: false, error: 'walletAddress is required' });
  }

  try {
    const user = await db.User.findOne({ where: { walletAddress: walletAddress.toLowerCase() } });
    if (!user) {
      return res.status(404).json({ success: false, error: 'No account found for this wallet address' });
    }

    return res.json({
      success: true,
      data: {
        sxuaId: user.sxId,
        username: user.username,
        walletAddress: user.walletAddress,
        accountTier: user.accountTier,
        createdAt: user.createdAt,
      }
    });
  } catch (error) {
    console.error('[Accounts] Error fetching account:', error);
    return res.status(500).json({ success: false, error: 'Failed to fetch account' });
  }
});

/**
 * GET /api/accounts/check-username/:username
 * Checks if a username is available
 */
router.get('/check-username/:username', async (req, res) => {
  const { username } = req.params;
  try {
    const existing = await db.User.findOne({ where: { username: username.trim() } });
    return res.json({
      success: true,
      data: { available: !existing }
    });
  } catch (error) {
    return res.status(500).json({ success: false, error: 'Failed to check username' });
  }
});

module.exports = router;
