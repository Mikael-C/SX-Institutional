const db = require('../models');

const JAILBREAK_PATTERNS = [
  'ignore',
  'pretend',
  'bypass',
  'jailbreak',
  'forget',
  'show credentials',
  'admin password',
  'system prompt',
  'override',
  'inject',
  'drop table',
  'delete from',
  'truncate table',
  'exec(',
  'eval(',
  'script>',
  'union select',
  'or 1=1',
  '-- ',
  'xss',
  'passwd',
  'etc/shadow'
];

const violationTracker = new Map();
const VIOLATION_WINDOW = 10 * 60 * 1000;
const LOCKOUT_DURATION = 30 * 60 * 1000;
const MAX_VIOLATIONS = 5;
const RATE_LIMIT_WINDOW = 60 * 1000;
const RATE_LIMIT_MAX = 100;

const rateLimitTracker = new Map();

function cleanupOldEntries(tracker, windowMs) {
  const now = Date.now();
  for (const [key, data] of tracker.entries()) {
    if (data.timestamps) {
      data.timestamps = data.timestamps.filter(t => now - t < windowMs);
      if (data.timestamps.length === 0 && (!data.lockoutUntil || now > data.lockoutUntil)) {
        tracker.delete(key);
      }
    }
  }
}

function getClientIp(req) {
  return req.headers['x-forwarded-for'] || req.connection.remoteAddress || req.ip || '0.0.0.0';
}

function checkRateLimit(ip) {
  const now = Date.now();
  if (!rateLimitTracker.has(ip)) {
    rateLimitTracker.set(ip, { timestamps: [now] });
    return true;
  }
  const data = rateLimitTracker.get(ip);
  data.timestamps = data.timestamps.filter(t => now - t < RATE_LIMIT_WINDOW);
  data.timestamps.push(now);
  rateLimitTracker.set(ip, data);
  return data.timestamps.length <= RATE_LIMIT_MAX;
}

function checkLockout(ip) {
  const now = Date.now();
  if (!violationTracker.has(ip)) return false;
  const data = violationTracker.get(ip);
  if (data.lockoutUntil && now < data.lockoutUntil) {
    return data.lockoutUntil;
  }
  if (data.lockoutUntil && now >= data.lockoutUntil) {
    violationTracker.delete(ip);
    return false;
  }
  return false;
}

function recordViolation(ip) {
  const now = Date.now();
  if (!violationTracker.has(ip)) {
    violationTracker.set(ip, { timestamps: [now], lockoutUntil: null });
  } else {
    const data = violationTracker.get(ip);
    data.timestamps = data.timestamps.filter(t => now - t < VIOLATION_WINDOW);
    data.timestamps.push(now);
    if (data.timestamps.length >= MAX_VIOLATIONS) {
      data.lockoutUntil = now + LOCKOUT_DURATION;
    }
    violationTracker.set(ip, data);
  }
  return violationTracker.get(ip);
}

function detectJailbreak(text) {
  if (!text || typeof text !== 'string') return null;
  const lower = text.toLowerCase();
  for (const pattern of JAILBREAK_PATTERNS) {
    if (lower.includes(pattern.toLowerCase())) {
      return pattern;
    }
  }
  return null;
}

function extractAllText(obj) {
  if (!obj) return '';
  if (typeof obj === 'string') return obj;
  if (typeof obj === 'number' || typeof obj === 'boolean') return String(obj);
  if (Array.isArray(obj)) return obj.map(extractAllText).join(' ');
  if (typeof obj === 'object') {
    return Object.values(obj).map(extractAllText).join(' ');
  }
  return '';
}

async function jailbreakDetector(req, res, next) {
  const ip = getClientIp(req);

  const lockoutUntil = checkLockout(ip);
  if (lockoutUntil) {
    const remainingMs = lockoutUntil - Date.now();
    const remainingMin = Math.ceil(remainingMs / 60000);
    return res.status(429).json({
      success: false,
      error: `Account locked out due to repeated violations. Try again in ${remainingMin} minutes.`,
      lockoutUntil: new Date(lockoutUntil).toISOString(),
      remainingMinutes: remainingMin
    });
  }

  if (!checkRateLimit(ip)) {
    return res.status(429).json({
      success: false,
      error: 'Rate limit exceeded. Maximum 100 requests per minute.'
    });
  }

  const bodyText = extractAllText(req.body);
  const queryText = extractAllText(req.query);
  const combinedText = `${bodyText} ${queryText}`;

  const matchedPattern = detectJailbreak(combinedText);
  if (matchedPattern) {
    const walletAddress = req.headers['x-wallet-address'] || null;
    const violationData = recordViolation(ip);

    try {
      await db.JailbreakLog.create({
        ipAddress: ip,
        walletAddress: walletAddress,
        pattern: matchedPattern,
        input: combinedText.substring(0, 2000),
        blocked: true,
        lockoutUntil: violationData.lockoutUntil ? new Date(violationData.lockoutUntil) : null
      });
    } catch (logError) {
      console.error('Failed to log jailbreak attempt:', logError.message);
    }

    const isLockedOut = violationData.lockoutUntil && Date.now() < violationData.lockoutUntil;
    return res.status(403).json({
      success: false,
      error: 'Request blocked: Potentially malicious input detected.',
      pattern: matchedPattern,
      violations: violationData.timestamps.length,
      lockedOut: isLockedOut,
      lockoutUntil: isLockedOut ? new Date(violationData.lockoutUntil).toISOString() : null
    });
  }

  next();
}

setInterval(() => {
  cleanupOldEntries(violationTracker, VIOLATION_WINDOW);
  cleanupOldEntries(rateLimitTracker, RATE_LIMIT_WINDOW);
}, 5 * 60 * 1000);

module.exports = jailbreakDetector;
module.exports.violationTracker = violationTracker;
module.exports.JAILBREAK_PATTERNS = JAILBREAK_PATTERNS;
