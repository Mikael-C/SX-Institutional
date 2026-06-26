const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const db = require('../models');
const { broadcast } = require('../websocket/ws');

let platformState = {
  paused: false,
  killSwitchActive: false,
  killSwitchActivatedAt: null,
  killSwitchDeactivationProposalId: null,
  requiredApprovals: 3
};

// POST /register-device - register Master Device
router.post('/register-device', async (req, res) => {
  try {
    const { adminAddress, deviceId } = req.body;

    if (!adminAddress || !deviceId) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: adminAddress, deviceId'
      });
    }

    const existing = await db.Device.findOne({
      where: { deviceId: deviceId }
    });

    if (existing) {
      return res.status(400).json({
        success: false,
        error: 'Device already registered'
      });
    }

    const device = await db.Device.create({
      id: uuidv4(),
      adminAddress: adminAddress.toLowerCase(),
      deviceId: deviceId,
      registeredAt: new Date(),
      isActive: true
    });

    broadcast('admin', {
      type: 'device_registered',
      deviceId: deviceId,
      adminAddress: adminAddress.toLowerCase(),
      timestamp: device.registeredAt
    });

    return res.json({
      success: true,
      data: {
        device: {
          id: device.id,
          adminAddress: adminAddress.toLowerCase(),
          deviceId: deviceId,
          registeredAt: device.registeredAt,
          isActive: true,
          message: 'Master Device registered successfully. This device is now authorized for admin operations.'
        }
      }
    });
  } catch (error) {
    console.error('[Admin] POST /register-device error:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
});

// POST /proposal - create proposal
router.post('/proposal', async (req, res) => {
  try {
    const { description, data, createdBy } = req.body;

    if (!description || !createdBy) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: description, createdBy'
      });
    }

    const proposal = await db.Proposal.create({
      id: uuidv4(),
      description: description,
      data: data || {},
      status: 'Pending',
      approvals: [],
      createdBy: createdBy.toLowerCase(),
      executedAt: null
    });

    broadcast('admin', {
      type: 'proposal_created',
      proposalId: proposal.id,
      description: description,
      createdBy: createdBy.toLowerCase(),
      timestamp: proposal.createdAt
    });

    return res.json({
      success: true,
      data: {
        proposal: {
          id: proposal.id,
          description: description,
          data: data || {},
          status: 'Pending',
          approvals: [],
          approvalsNeeded: platformState.requiredApprovals,
          createdBy: createdBy.toLowerCase(),
          createdAt: proposal.createdAt
        }
      }
    });
  } catch (error) {
    console.error('[Admin] POST /proposal error:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
});

// POST /approve/:proposalId - approve (track 3-of-3)
router.post('/approve/:proposalId', async (req, res) => {
  try {
    const { proposalId } = req.params;
    const { approverAddress } = req.body;

    if (!approverAddress) {
      return res.status(400).json({
        success: false,
        error: 'Missing required field: approverAddress'
      });
    }

    const proposal = await db.Proposal.findOne({
      where: { id: proposalId }
    });

    if (!proposal) {
      return res.status(404).json({
        success: false,
        error: 'Proposal not found'
      });
    }

    if (proposal.status !== 'Pending') {
      return res.status(400).json({
        success: false,
        error: `Proposal is already ${proposal.status}`
      });
    }

    const currentApprovals = proposal.approvals || [];
    const normalizedApprover = approverAddress.toLowerCase();

    if (currentApprovals.some(a => a.address === normalizedApprover)) {
      return res.status(400).json({
        success: false,
        error: 'This address has already approved this proposal'
      });
    }

    currentApprovals.push({
      address: normalizedApprover,
      timestamp: new Date().toISOString()
    });

    const newStatus = currentApprovals.length >= platformState.requiredApprovals ? 'Approved' : 'Pending';
    const executedAt = newStatus === 'Approved' ? new Date() : null;

    if (newStatus === 'Approved') {
      await proposal.update({
        approvals: currentApprovals,
        status: 'Executed',
        executedAt: executedAt
      });
    } else {
      await proposal.update({
        approvals: currentApprovals,
        status: newStatus
      });
    }

    broadcast('admin', {
      type: 'proposal_approved',
      proposalId: proposal.id,
      approver: normalizedApprover,
      totalApprovals: currentApprovals.length,
      required: platformState.requiredApprovals,
      fullyApproved: newStatus === 'Approved' || currentApprovals.length >= platformState.requiredApprovals
    });

    return res.json({
      success: true,
      data: {
        proposalId: proposal.id,
        description: proposal.description,
        approvals: currentApprovals,
        approvalsCount: currentApprovals.length,
        approvalsRequired: platformState.requiredApprovals,
        remaining: Math.max(0, platformState.requiredApprovals - currentApprovals.length),
        status: currentApprovals.length >= platformState.requiredApprovals ? 'Executed' : 'Pending',
        executedAt: executedAt,
        message: currentApprovals.length >= platformState.requiredApprovals
          ? 'Proposal fully approved and executed!'
          : `Approval recorded. ${platformState.requiredApprovals - currentApprovals.length} more needed.`
      }
    });
  } catch (error) {
    console.error('[Admin] POST /approve/:proposalId error:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
});

// POST /kill-switch/activate - activate kill switch
router.post('/kill-switch/activate', async (req, res) => {
  try {
    const { activatedBy } = req.body;

    if (!activatedBy) {
      return res.status(400).json({
        success: false,
        error: 'Missing required field: activatedBy'
      });
    }

    if (platformState.killSwitchActive) {
      return res.status(400).json({
        success: false,
        error: 'Kill switch is already active'
      });
    }

    platformState.paused = true;
    platformState.killSwitchActive = true;
    platformState.killSwitchActivatedAt = new Date();

    const proposal = await db.Proposal.create({
      id: uuidv4(),
      description: 'Kill Switch Deactivation - Requires 3-of-3 approval',
      data: {
        type: 'kill_switch_deactivation',
        activatedBy: activatedBy.toLowerCase(),
        activatedAt: platformState.killSwitchActivatedAt
      },
      status: 'Pending',
      approvals: [],
      createdBy: activatedBy.toLowerCase()
    });

    platformState.killSwitchDeactivationProposalId = proposal.id;

    broadcast('admin', {
      type: 'kill_switch_activated',
      activatedBy: activatedBy.toLowerCase(),
      timestamp: platformState.killSwitchActivatedAt,
      deactivationProposalId: proposal.id
    });

    return res.json({
      success: true,
      data: {
        message: 'KILL SWITCH ACTIVATED. All trading operations paused.',
        killSwitchActive: true,
        activatedAt: platformState.killSwitchActivatedAt,
        activatedBy: activatedBy.toLowerCase(),
        deactivation: {
          proposalId: proposal.id,
          requiredApprovals: platformState.requiredApprovals,
          message: 'Deactivation requires 3-of-3 multi-sig approval. Use POST /admin/approve/:proposalId to approve.'
        }
      }
    });
  } catch (error) {
    console.error('[Admin] POST /kill-switch/activate error:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
});

// POST /kill-switch/deactivate - deactivate (requires 3 approvals)
router.post('/kill-switch/deactivate', async (req, res) => {
  try {
    if (!platformState.killSwitchActive) {
      return res.status(400).json({
        success: false,
        error: 'Kill switch is not currently active'
      });
    }

    if (!platformState.killSwitchDeactivationProposalId) {
      return res.status(400).json({
        success: false,
        error: 'No deactivation proposal found. This should not happen.'
      });
    }

    const proposal = await db.Proposal.findOne({
      where: { id: platformState.killSwitchDeactivationProposalId }
    });

    if (!proposal) {
      return res.status(404).json({
        success: false,
        error: 'Deactivation proposal not found'
      });
    }

    const approvals = proposal.approvals || [];
    if (approvals.length < platformState.requiredApprovals) {
      return res.status(403).json({
        success: false,
        error: `Insufficient approvals for deactivation. Have ${approvals.length}/${platformState.requiredApprovals}.`,
        data: {
          proposalId: proposal.id,
          currentApprovals: approvals.length,
          requiredApprovals: platformState.requiredApprovals,
          remaining: platformState.requiredApprovals - approvals.length,
          approvers: approvals.map(a => a.address)
        }
      });
    }

    platformState.paused = false;
    platformState.killSwitchActive = false;
    platformState.killSwitchActivatedAt = null;
    platformState.killSwitchDeactivationProposalId = null;

    await proposal.update({
      status: 'Executed',
      executedAt: new Date()
    });

    broadcast('admin', {
      type: 'kill_switch_deactivated',
      timestamp: new Date().toISOString()
    });

    return res.json({
      success: true,
      data: {
        message: 'Kill switch deactivated. Trading operations resumed.',
        killSwitchActive: false,
        platformStatus: 'Active',
        deactivatedAt: new Date().toISOString()
      }
    });
  } catch (error) {
    console.error('[Admin] POST /kill-switch/deactivate error:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
});

// GET /proposals - all proposals
router.get('/proposals', async (req, res) => {
  try {
    const { status } = req.query;
    const whereClause = {};
    if (status) whereClause.status = status;

    const proposals = await db.Proposal.findAll({
      where: whereClause,
      order: [['createdAt', 'DESC']]
    });

    return res.json({
      success: true,
      data: proposals.map(p => ({
        id: p.id,
        description: p.description,
        data: p.data,
        status: p.status,
        approvals: p.approvals,
        approvalsCount: (p.approvals || []).length,
        approvalsRequired: platformState.requiredApprovals,
        createdBy: p.createdBy,
        createdAt: p.createdAt,
        executedAt: p.executedAt
      })),
      count: proposals.length
    });
  } catch (error) {
    console.error('[Admin] GET /proposals error:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
});

// GET /devices - registered devices
router.get('/devices', async (req, res) => {
  try {
    const devices = await db.Device.findAll({
      order: [['registeredAt', 'DESC']]
    });

    return res.json({
      success: true,
      data: devices.map(d => ({
        id: d.id,
        adminAddress: d.adminAddress,
        deviceId: d.deviceId,
        registeredAt: d.registeredAt,
        isActive: d.isActive
      })),
      count: devices.length
    });
  } catch (error) {
    console.error('[Admin] GET /devices error:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
});

// GET / - Unified dashboard data for Admin.jsx
router.get('/', async (req, res) => {
  try {
    const devices = await db.Device.findAll();
    const proposals = await db.Proposal.findAll({ order: [['createdAt', 'DESC']] });
    const jailbreakLogs = await db.JailbreakLog.findAll({ order: [['createdAt', 'DESC']], limit: 50 });
    
    return res.json({
      success: true,
      platformActive: !platformState.paused,
      killSwitchActive: platformState.killSwitchActive,
      devices: devices.map(d => ({ id: d.deviceId, name: d.deviceName, status: d.isActive ? 'Active' : 'Inactive', lastSeen: d.updatedAt, owner: d.walletAddress })),
      proposals: proposals.map(p => ({ id: p.id, title: p.description, type: p.data?.type || 'Update', status: p.status, timestamp: p.createdAt, approvals: p.approvals.length, required: platformState.requiredApprovals })),
      jailbreakLogs: jailbreakLogs.map(l => ({ id: l.id, user: l.walletAddress || 'Unknown', ip: l.ipAddress, pattern: l.pattern, input: l.input, timestamp: l.createdAt })),
      lockedUsers: [] 
    });
  } catch (error) {
    console.error('[Admin] GET / error:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
});

// GET /status - platform status (paused/active)
router.get('/status', async (req, res) => {
  try {
    const deviceCount = await db.Device.count({ where: { isActive: true } });
    const pendingProposals = await db.Proposal.count({ where: { status: 'Pending' } });

    return res.json({
      success: true,
      data: {
        platformStatus: platformState.paused ? 'Paused' : 'Active',
        killSwitch: {
          active: platformState.killSwitchActive,
          activatedAt: platformState.killSwitchActivatedAt,
          deactivationProposalId: platformState.killSwitchDeactivationProposalId
        },
        multiSig: {
          requiredApprovals: platformState.requiredApprovals,
          scheme: '3-of-3'
        },
        stats: {
          registeredDevices: deviceCount,
          pendingProposals: pendingProposals
        },
        chains: [
          { name: 'Hoodi Testnet', chainId: 560048, status: 'Connected' },
          { name: 'Base Sepolia', chainId: 84532, status: 'Connected' }
        ]
      }
    });
  } catch (error) {
    console.error('[Admin] GET /status error:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
});

module.exports = router;
module.exports.platformState = platformState;
