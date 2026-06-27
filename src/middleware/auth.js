const { ethers } = require('ethers');

/**
 * FIX #6: Auth middleware with EIP-191 wallet signature verification.
 *
 * Previously the middleware blindly trusted the x-wallet-address header,
 * allowing anyone to impersonate any wallet address.
 *
 * Now, when a wallet-signed request arrives, it verifies that:
 *   recovered_address(signature, message) === x-wallet-address header
 *
 * Frontend should sign a timestamped message (e.g. "SX Auth: <timestamp>")
 * and send all three headers:
 *   x-wallet-address   : "0xAbc..."
 *   x-wallet-message   : "SX Auth: 1719443114"
 *   x-wallet-signature : "0x..."
 *
 * If only x-wallet-address is provided (no signature), the address is
 * attached as unverified (read-only operations that don't require auth).
 */
async function authMiddleware(req, res, next) {
  const walletAddress = req.headers['x-wallet-address'] || null;
  const signature     = req.headers['x-wallet-signature'] || null;
  const message       = req.headers['x-wallet-message']   || null;

  // If all three headers are present, verify the signature cryptographically
  if (walletAddress && signature && message) {
    try {
      const recovered = ethers.verifyMessage(message, signature);
      if (recovered.toLowerCase() !== walletAddress.toLowerCase()) {
        return res.status(401).json({
          success: false,
          error:   'Wallet signature verification failed: address mismatch.'
        });
      }
      req.walletAddress  = walletAddress;
      req.walletVerified = true;
    } catch (err) {
      return res.status(401).json({
        success: false,
        error:   'Wallet signature verification failed: ' + err.message
      });
    }
  } else {
    // Unauthenticated / read-only path — address is NOT verified
    req.walletAddress  = walletAddress;
    req.walletVerified = false;
  }

  next();
}

module.exports = authMiddleware;
