function authMiddleware(req, res, next) {
  const walletAddress = req.headers['x-wallet-address'] || null;
  req.walletAddress = walletAddress;
  next();
}

module.exports = authMiddleware;
