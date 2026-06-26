const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const db = require('../models');

// POST /submit - submit KYC data (name, dob, address, documentHash)
router.post('/submit', async (req, res) => {
  try {
    const { walletAddress, fullName, dateOfBirth, address, documentHash, shieldedIntent } = req.body;

    if (!walletAddress || !fullName || !dateOfBirth || !documentHash) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: walletAddress, fullName, dateOfBirth, documentHash'
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

    const existingKyc = await db.KycStatus.findOne({
      where: { userId: user.id, status: ['Pending', 'Verified'] }
    });

    if (existingKyc) {
      if (existingKyc.status === 'Verified') {
        return res.status(400).json({
          success: false,
          error: 'KYC already verified for this wallet'
        });
      }
      if (existingKyc.status === 'Pending') {
        return res.status(400).json({
          success: false,
          error: 'KYC submission already pending review'
        });
      }
    }

    const kycRecord = await db.KycStatus.create({
      id: uuidv4(),
      userId: user.id,
      walletAddress: walletAddress.toLowerCase(),
      fullName: fullName,
      dateOfBirth: dateOfBirth,
      address: address || '',
      documentHash: documentHash,
      status: 'Pending',
      shieldedIntent: shieldedIntent === true || shieldedIntent === 'true',
      submittedAt: new Date(),
      verifiedAt: null
    });

    return res.json({
      success: true,
      data: {
        id: kycRecord.id,
        walletAddress: walletAddress.toLowerCase(),
        status: 'Pending',
        shieldedIntent: kycRecord.shieldedIntent,
        submittedAt: kycRecord.submittedAt,
        message: 'KYC submission received. Review typically takes 24-48 hours.',
        privacy: kycRecord.shieldedIntent
          ? 'Shielded Intent enabled: Your KYC data is encrypted and only revealed to verified counterparties.'
          : 'Standard KYC: Your verification status is publicly queryable.'
      }
    });
  } catch (error) {
    console.error('[KYC] POST /submit error:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
});

// POST /approve/:address - admin approves KYC
router.post('/approve/:address', async (req, res) => {
  try {
    const { address } = req.params;

    const kycRecord = await db.KycStatus.findOne({
      where: { walletAddress: address.toLowerCase(), status: 'Pending' },
      order: [['submittedAt', 'DESC']]
    });

    if (!kycRecord) {
      return res.status(404).json({
        success: false,
        error: 'No pending KYC submission found for this address'
      });
    }

    await kycRecord.update({
      status: 'Verified',
      verifiedAt: new Date()
    });

    return res.json({
      success: true,
      data: {
        id: kycRecord.id,
        walletAddress: address.toLowerCase(),
        fullName: kycRecord.fullName,
        status: 'Verified',
        verifiedAt: kycRecord.verifiedAt,
        shieldedIntent: kycRecord.shieldedIntent,
        message: 'KYC approved. User now has full platform access.'
      }
    });
  } catch (error) {
    console.error('[KYC] POST /approve/:address error:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
});

// POST /reject/:address - admin rejects KYC
router.post('/reject/:address', async (req, res) => {
  try {
    const { address } = req.params;
    const { reason } = req.body;

    const kycRecord = await db.KycStatus.findOne({
      where: { walletAddress: address.toLowerCase(), status: 'Pending' },
      order: [['submittedAt', 'DESC']]
    });

    if (!kycRecord) {
      return res.status(404).json({
        success: false,
        error: 'No pending KYC submission found for this address'
      });
    }

    await kycRecord.update({ status: 'Rejected' });

    return res.json({
      success: true,
      data: {
        id: kycRecord.id,
        walletAddress: address.toLowerCase(),
        status: 'Rejected',
        reason: reason || 'Insufficient or invalid documentation',
        message: 'KYC rejected. User may resubmit with corrected documents.'
      }
    });
  } catch (error) {
    console.error('[KYC] POST /reject/:address error:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
});

// GET /status/:address - get KYC status + shielded intent
router.get('/status/:address', async (req, res) => {
  try {
    const { address } = req.params;

    const kycRecord = await db.KycStatus.findOne({
      where: { walletAddress: address.toLowerCase() },
      order: [['submittedAt', 'DESC']]
    });

    if (!kycRecord) {
      return res.json({
        success: true,
        data: {
          walletAddress: address.toLowerCase(),
          status: 'None',
          shieldedIntent: false,
          message: 'No KYC submission found. Submit KYC to access full platform features.'
        }
      });
    }

    return res.json({
      success: true,
      data: {
        id: kycRecord.id,
        walletAddress: kycRecord.walletAddress,
        status: kycRecord.status,
        shieldedIntent: kycRecord.shieldedIntent,
        submittedAt: kycRecord.submittedAt,
        verifiedAt: kycRecord.verifiedAt,
        fullName: kycRecord.status === 'Verified' ? kycRecord.fullName : '[REDACTED]',
        documentHash: kycRecord.documentHash,
        accessLevel: kycRecord.status === 'Verified' ? 'Full' : 'Limited',
        features: {
          trading: true,
          leverageTrading: kycRecord.status === 'Verified',
          hiddenOrders: kycRecord.status === 'Verified',
          lending: kycRecord.status === 'Verified',
          withdrawal: kycRecord.status === 'Verified'
        }
      }
    });
  } catch (error) {
    console.error('[KYC] GET /status/:address error:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
});

module.exports = router;
