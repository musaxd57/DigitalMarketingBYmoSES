const express = require('express');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const { body, validationResult } = require('express-validator');
const router = express.Router();
const { pool, transaction } = require('../models/db');
const config = require('../config');
const { authLimiter } = require('../middleware/rateLimiter');

const SALT_ROUNDS = 12;

const generateTokens = (userId, tenantId, role) => {
  const accessToken = jwt.sign(
    { userId, tenantId, role },
    config.jwt.secret,
    { expiresIn: config.jwt.expiresIn }
  );
  const refreshToken = jwt.sign(
    { userId, tenantId, type: 'refresh' },
    config.jwt.refreshSecret,
    { expiresIn: config.jwt.refreshExpiresIn }
  );
  return { accessToken, refreshToken };
};

// POST /api/auth/register
router.post(
  '/register',
  authLimiter,
  [
    body('email').isEmail().normalizeEmail().withMessage('Valid email required'),
    body('password').isLength({ min: 8 }).withMessage('Password must be at least 8 characters'),
    body('firstName').trim().notEmpty().withMessage('First name required'),
    body('lastName').trim().notEmpty().withMessage('Last name required'),
    body('companyName').trim().notEmpty().withMessage('Company name required'),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { email, password, firstName, lastName, companyName } = req.body;

    try {
      const existing = await pool.query('SELECT id FROM users WHERE email = $1', [email]);
      if (existing.rows.length > 0) {
        return res.status(409).json({ error: 'Email already registered' });
      }

      const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);
      const tenantSlug = companyName
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '')
        .substring(0, 50) + '-' + uuidv4().substring(0, 6);

      const result = await transaction(async (client) => {
        const tenantRes = await client.query(
          `INSERT INTO tenants (name, slug, plan)
           VALUES ($1, $2, 'starter')
           RETURNING id`,
          [companyName, tenantSlug]
        );
        const tenantId = tenantRes.rows[0].id;

        const userRes = await client.query(
          `INSERT INTO users (tenant_id, email, password_hash, first_name, last_name, role)
           VALUES ($1, $2, $3, $4, $5, 'owner')
           RETURNING id, email, first_name, last_name, role, tenant_id`,
          [tenantId, email, passwordHash, firstName, lastName]
        );

        return { user: userRes.rows[0], tenantId };
      });

      const { accessToken, refreshToken } = generateTokens(
        result.user.id,
        result.tenantId,
        result.user.role
      );

      const refreshHash = await bcrypt.hash(refreshToken, 10);
      await pool.query(
        `INSERT INTO refresh_tokens (user_id, token_hash, expires_at, ip_address, user_agent)
         VALUES ($1, $2, NOW() + INTERVAL '30 days', $3, $4)`,
        [result.user.id, refreshHash, req.ip, req.headers['user-agent']]
      );

      return res.status(201).json({
        message: 'Account created successfully',
        accessToken,
        refreshToken,
        user: {
          id: result.user.id,
          email: result.user.email,
          firstName: result.user.first_name,
          lastName: result.user.last_name,
          role: result.user.role,
        },
      });
    } catch (err) {
      console.error('[Auth] Register error:', err.message);
      return res.status(500).json({ error: 'Registration failed' });
    }
  }
);

// POST /api/auth/login
router.post(
  '/login',
  authLimiter,
  [
    body('email').isEmail().normalizeEmail(),
    body('password').notEmpty(),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { email, password } = req.body;

    try {
      const result = await pool.query(
        `SELECT u.id, u.email, u.password_hash, u.first_name, u.last_name,
                u.role, u.tenant_id, u.is_active,
                t.name as tenant_name, t.plan, t.is_active as tenant_active
         FROM users u
         JOIN tenants t ON u.tenant_id = t.id
         WHERE u.email = $1`,
        [email]
      );

      if (result.rows.length === 0) {
        return res.status(401).json({ error: 'Invalid credentials' });
      }

      const user = result.rows[0];

      if (!user.is_active) {
        return res.status(403).json({ error: 'Account is deactivated' });
      }
      if (!user.tenant_active) {
        return res.status(403).json({ error: 'Organization account is suspended' });
      }

      const passwordMatch = await bcrypt.compare(password, user.password_hash);
      if (!passwordMatch) {
        return res.status(401).json({ error: 'Invalid credentials' });
      }

      const { accessToken, refreshToken } = generateTokens(user.id, user.tenant_id, user.role);

      const refreshHash = await bcrypt.hash(refreshToken, 10);
      await pool.query(
        `INSERT INTO refresh_tokens (user_id, token_hash, expires_at, ip_address, user_agent)
         VALUES ($1, $2, NOW() + INTERVAL '30 days', $3, $4)`,
        [user.id, refreshHash, req.ip, req.headers['user-agent']]
      );

      await pool.query('UPDATE users SET last_login_at = NOW() WHERE id = $1', [user.id]);

      return res.json({
        accessToken,
        refreshToken,
        user: {
          id: user.id,
          email: user.email,
          firstName: user.first_name,
          lastName: user.last_name,
          role: user.role,
          tenantId: user.tenant_id,
          tenantName: user.tenant_name,
          plan: user.plan,
        },
      });
    } catch (err) {
      console.error('[Auth] Login error:', err.message);
      return res.status(500).json({ error: 'Login failed' });
    }
  }
);

// POST /api/auth/refresh
router.post('/refresh', async (req, res) => {
  const { refreshToken } = req.body;
  if (!refreshToken) {
    return res.status(400).json({ error: 'Refresh token required' });
  }

  try {
    let decoded;
    try {
      decoded = jwt.verify(refreshToken, config.jwt.refreshSecret);
    } catch {
      return res.status(401).json({ error: 'Invalid or expired refresh token' });
    }

    if (decoded.type !== 'refresh') {
      return res.status(401).json({ error: 'Invalid token type' });
    }

    const tokens = await pool.query(
      `SELECT rt.id, rt.token_hash, rt.is_revoked, rt.expires_at
       FROM refresh_tokens rt
       WHERE rt.user_id = $1 AND rt.is_revoked = false AND rt.expires_at > NOW()
       ORDER BY rt.created_at DESC
       LIMIT 10`,
      [decoded.userId]
    );

    let validToken = null;
    for (const row of tokens.rows) {
      const match = await bcrypt.compare(refreshToken, row.token_hash);
      if (match) {
        validToken = row;
        break;
      }
    }

    if (!validToken) {
      return res.status(401).json({ error: 'Refresh token not found or expired' });
    }

    await pool.query('UPDATE refresh_tokens SET is_revoked = true WHERE id = $1', [validToken.id]);

    const userRes = await pool.query(
      'SELECT id, role, tenant_id FROM users WHERE id = $1 AND is_active = true',
      [decoded.userId]
    );
    if (userRes.rows.length === 0) {
      return res.status(401).json({ error: 'User not found' });
    }

    const user = userRes.rows[0];
    const { accessToken, refreshToken: newRefreshToken } = generateTokens(user.id, user.tenant_id, user.role);

    const newRefreshHash = await bcrypt.hash(newRefreshToken, 10);
    await pool.query(
      `INSERT INTO refresh_tokens (user_id, token_hash, expires_at, ip_address, user_agent)
       VALUES ($1, $2, NOW() + INTERVAL '30 days', $3, $4)`,
      [user.id, newRefreshHash, req.ip, req.headers['user-agent']]
    );

    return res.json({ accessToken, refreshToken: newRefreshToken });
  } catch (err) {
    console.error('[Auth] Refresh error:', err.message);
    return res.status(500).json({ error: 'Token refresh failed' });
  }
});

// POST /api/auth/logout
router.post('/logout', async (req, res) => {
  const { refreshToken } = req.body;
  if (refreshToken) {
    try {
      const decoded = jwt.decode(refreshToken);
      if (decoded && decoded.userId) {
        const tokens = await pool.query(
          'SELECT id, token_hash FROM refresh_tokens WHERE user_id = $1 AND is_revoked = false',
          [decoded.userId]
        );
        for (const row of tokens.rows) {
          const match = await bcrypt.compare(refreshToken, row.token_hash);
          if (match) {
            await pool.query('UPDATE refresh_tokens SET is_revoked = true WHERE id = $1', [row.id]);
            break;
          }
        }
      }
    } catch {
      // Best effort revocation
    }
  }
  return res.json({ message: 'Logged out successfully' });
});

// GET /api/auth/me
router.get('/me', require('../middleware/auth').authenticate, async (req, res) => {
  return res.json({ user: req.user, tenant: req.tenant });
});

module.exports = router;
