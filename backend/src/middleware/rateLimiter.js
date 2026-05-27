const rateLimit = require('express-rate-limit');
const config = require('../config');

/**
 * Standard API rate limiter - 100 requests per 15 minutes
 */
const apiLimiter = rateLimit({
  windowMs: config.rateLimiting.windowMs,
  max: config.rateLimiting.max,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => {
    // Use user ID if authenticated, otherwise IP
    return req.user ? `user:${req.user.id}` : req.ip;
  },
  handler: (req, res) => {
    res.status(429).json({
      error: 'Too many requests',
      message: `Rate limit exceeded. Try again in ${Math.ceil(config.rateLimiting.windowMs / 60000)} minutes.`,
      retryAfter: res.getHeader('Retry-After'),
    });
  },
});

/**
 * Strict limiter for auth endpoints - 10 requests per 15 minutes per IP
 */
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => req.ip,
  skipSuccessfulRequests: false,
  handler: (req, res) => {
    res.status(429).json({
      error: 'Too many authentication attempts',
      message: 'Please wait 15 minutes before trying again.',
    });
  },
});

/**
 * AI endpoint limiter - 20 requests per hour per user
 */
const aiLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => {
    return req.user ? `ai:${req.user.id}` : req.ip;
  },
  handler: (req, res) => {
    res.status(429).json({
      error: 'AI rate limit exceeded',
      message: 'You have exceeded the AI generation limit of 20 requests per hour.',
      retryAfter: res.getHeader('Retry-After'),
    });
  },
});

/**
 * Analytics sync limiter - 5 syncs per minute per account
 */
const syncLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => {
    return req.user ? `sync:${req.user.tenantId}` : req.ip;
  },
  handler: (req, res) => {
    res.status(429).json({
      error: 'Sync rate limit exceeded',
      message: 'Maximum 5 sync operations per minute allowed.',
    });
  },
});

module.exports = { apiLimiter, authLimiter, aiLimiter, syncLimiter };
