const jwt = require('jsonwebtoken');
const config = require('../config');
const { pool } = require('../models/db');

/**
 * Verify JWT token and attach user + tenant to request
 */
const authenticate = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Authorization header missing or malformed' });
    }

    const token = authHeader.split(' ')[1];
    if (!token) {
      return res.status(401).json({ error: 'Token not provided' });
    }

    let decoded;
    try {
      decoded = jwt.verify(token, config.jwt.secret);
    } catch (jwtErr) {
      if (jwtErr.name === 'TokenExpiredError') {
        return res.status(401).json({ error: 'Token expired', code: 'TOKEN_EXPIRED' });
      }
      return res.status(401).json({ error: 'Invalid token' });
    }

    // Fetch user from DB to ensure they still exist and are active
    const result = await pool.query(
      `SELECT u.id, u.email, u.first_name, u.last_name, u.role, u.tenant_id,
              t.id as t_id, t.name as tenant_name, t.slug as tenant_slug, t.plan, t.is_active as tenant_active
       FROM users u
       JOIN tenants t ON u.tenant_id = t.id
       WHERE u.id = $1 AND u.is_active = true`,
      [decoded.userId]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({ error: 'User not found or inactive' });
    }

    const user = result.rows[0];
    if (!user.tenant_active) {
      return res.status(403).json({ error: 'Tenant account is suspended' });
    }

    req.user = {
      id: user.id,
      email: user.email,
      firstName: user.first_name,
      lastName: user.last_name,
      role: user.role,
      tenantId: user.tenant_id,
    };

    req.tenant = {
      id: user.t_id,
      name: user.tenant_name,
      slug: user.tenant_slug,
      plan: user.plan,
    };

    next();
  } catch (err) {
    console.error('[Auth Middleware] Error:', err.message);
    return res.status(500).json({ error: 'Authentication service error' });
  }
};

/**
 * Role-based access control middleware factory
 * @param {...string} roles - Allowed roles
 */
const requireRole = (...roles) => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ error: 'Not authenticated' });
    }
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({
        error: 'Insufficient permissions',
        required: roles,
        current: req.user.role,
      });
    }
    next();
  };
};

/**
 * Optional auth - attaches user if token present but doesn't fail if absent
 */
const optionalAuth = async (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return next();
  }
  return authenticate(req, res, next);
};

module.exports = { authenticate, requireRole, optionalAuth };
