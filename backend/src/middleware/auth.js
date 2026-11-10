const jwt = require('jsonwebtoken');
const env = require('../config/env');

function optionalAuth(req, _res, next) {
  const header = req.get('authorization');
  const token = req.cookies?.weeware_token || (header?.startsWith('Bearer ') ? header.slice(7) : null);
  if (token) {
    try {
      const claims = jwt.verify(token, env.jwtSecret);
      req.user = {
        ...claims,
        sub: claims.sub || claims.id,
        role: claims.role === 'user' ? 'farmer' : claims.role,
      };
    } catch { /* treated as anonymous */ }
  }
  next();
}

function requireAuth(req, res, next) {
  optionalAuth(req, res, () => req.user ? next() : res.status(401).json({ success: false, message: 'Please sign in to continue.' }));
}

function requireAdmin(req, res, next) {
  if (req.user?.role !== 'admin') return res.status(403).json({ success: false, message: 'Administrator access is required.' });
  next();
}

function requireRoles(...roles) {
  return (req, res, next) => {
    if (!roles.includes(req.user?.role)) return res.status(403).json({ success: false, message: 'You do not have access to this dashboard.' });
    next();
  };
}

module.exports = { optionalAuth, requireAuth, requireAdmin, requireRoles };

