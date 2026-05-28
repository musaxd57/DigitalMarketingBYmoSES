const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const winston = require('winston');
const config = require('./src/config');

// ─── Logger Setup ─────────────────────────────────────────────────────────────
const logger = winston.createLogger({
  level: config.logging.level,
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.errors({ stack: true }),
    config.env === 'production'
      ? winston.format.json()
      : winston.format.colorize({ all: true }),
    winston.format.printf(({ timestamp, level, message, ...meta }) => {
      const metaStr = Object.keys(meta).length ? ` ${JSON.stringify(meta)}` : '';
      return `${timestamp} [${level}]: ${message}${metaStr}`;
    })
  ),
  transports: [
    new winston.transports.Console(),
    ...(config.env === 'production'
      ? [new winston.transports.File({ filename: 'logs/error.log', level: 'error' }),
         new winston.transports.File({ filename: 'logs/combined.log' })]
      : []),
  ],
});

const app = express();

// ─── Security Middleware ──────────────────────────────────────────────────────
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      scriptSrc: ["'self'"],
      imgSrc: ["'self'", 'data:', 'https:'],
    },
  },
  crossOriginEmbedderPolicy: false,
}));

// ─── CORS ─────────────────────────────────────────────────────────────────────
app.use(cors({
  origin: (origin, callback) => {
    if (!origin) return callback(null, true);
    if (
      origin.endsWith('.netlify.app') ||
      origin.endsWith('.onrender.com') ||
      origin === 'http://localhost:3000' ||
      origin === 'http://localhost:5173'
    ) {
      return callback(null, true);
    }
    const allowed = Array.isArray(config.cors.origin)
      ? config.cors.origin
      : [config.cors.origin];
    if (allowed.includes(origin) || config.env === 'development') {
      return callback(null, true);
    }
    return callback(new Error(`CORS policy: origin ${origin} not allowed`));
  },
  credentials: config.cors.credentials,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Tenant-ID'],
}));

// ─── Body Parsing ─────────────────────────────────────────────────────────────
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// ─── HTTP Logging ─────────────────────────────────────────────────────────────
if (config.env !== 'test') {
  app.use(morgan(config.env === 'production' ? 'combined' : 'dev', {
    stream: { write: (msg) => logger.http(msg.trim()) },
  }));
}

// ─── Health Check ─────────────────────────────────────────────────────────────
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    version: process.env.npm_package_version || '1.0.0',
    env: config.env,
  });
});

// ─── API Routes ───────────────────────────────────────────────────────────────
const { apiLimiter } = require('./src/middleware/rateLimiter');
app.use('/api', apiLimiter);

app.use('/api/auth', require('./src/routes/auth'));
app.use('/api/accounts', require('./src/routes/accounts'));
app.use('/api/campaigns', require('./src/routes/campaigns'));
app.use('/api/analytics', require('./src/routes/analytics'));
app.use('/api/creative', require('./src/routes/creative'));
app.use('/api/ai', require('./src/routes/ai'));

// ─── Trend Engine Routes (inline) ────────────────────────────────────────────
const trendRouter = express.Router();
const { authenticate } = require('./src/middleware/auth');
const { apiLimiter: trendLimiter } = require('./src/middleware/rateLimiter');
const TrendEngine = require('./src/services/trendEngine');

trendRouter.get('/', authenticate, async (req, res) => {
  try {
    const engine = new TrendEngine();
    const reports = await engine.getReportHistory(req.user.tenantId);
    return res.json({ reports });
  } catch (err) {
    if (err.message?.includes('does not exist')) {
      return res.json({ reports: [] });
    }
    return res.status(500).json({ error: 'Failed to fetch trend reports' });
  }
});

trendRouter.get('/latest', authenticate, async (req, res) => {
  try {
    const { platform } = req.query;
    const engine = new TrendEngine();
    const report = await engine.getLatestReport(req.user.tenantId, platform);
    if (!report) {
      return res.status(404).json({ error: 'No trend reports found', message: 'Trigger a new analysis to get started' });
    }
    return res.json({ report });
  } catch (err) {
    if (err.message?.includes('does not exist')) {
      return res.status(404).json({ error: 'No trend reports found', message: 'Trigger a new analysis to get started' });
    }
    return res.status(500).json({ error: 'Failed to fetch trend report' });
  }
});

trendRouter.post('/generate', authenticate, trendLimiter, async (req, res) => {
  const { platform = 'tiktok', niche, language = 'tr' } = req.body;

  // Respond immediately, run analysis in background
  const fakeJobId = `job_${Date.now()}`;
  res.status(202).json({
    message: 'Trend analysis started',
    jobId: fakeJobId,
    estimatedMinutes: 2,
  });

  // Run async without blocking response
  setImmediate(async () => {
    try {
      const engine = new TrendEngine();
      await engine.generateTrendReport(req.user.tenantId, platform, niche, language);
      logger.info(`[Trends] Report generated for tenant ${req.user.tenantId}`);
    } catch (err) {
      logger.error(`[Trends] Background generation failed: ${err.message}`);
    }
  });
});

app.use('/api/trends', trendRouter);

// ─── n8n Webhook Callbacks ────────────────────────────────────────────────────
const webhookRouter = express.Router();
const VideoPipeline = require('./src/services/videoPipeline');

webhookRouter.post('/video-complete', async (req, res) => {
  try {
    const pipeline = new VideoPipeline();
    await pipeline.handleCompletionCallback(req.body);
    return res.json({ received: true });
  } catch (err) {
    console.error('[Webhook] Video complete error:', err.message);
    return res.status(500).json({ error: err.message });
  }
});

app.use('/api/webhooks', webhookRouter);

// ─── Queue Stats Route ────────────────────────────────────────────────────────
app.get('/api/admin/queues', authenticate, async (req, res) => {
  if (req.user.role !== 'owner' && req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Admin access required' });
  }
  const { getQueueStats } = require('./src/services/queue');
  const stats = await getQueueStats();
  return res.json(stats);
});

// ─── 404 Handler ──────────────────────────────────────────────────────────────
app.use((req, res) => {
  res.status(404).json({ error: 'Route not found', path: req.path });
});

// ─── Global Error Handler ─────────────────────────────────────────────────────
app.use((err, req, res, next) => {
  logger.error('Unhandled error:', { message: err.message, stack: err.stack, path: req.path });

  if (err.message?.includes('CORS')) {
    return res.status(403).json({ error: 'CORS error', message: err.message });
  }

  if (err.type === 'entity.parse.failed') {
    return res.status(400).json({ error: 'Invalid JSON in request body' });
  }

  const status = err.status || err.statusCode || 500;
  return res.status(status).json({
    error: config.env === 'production' ? 'Internal server error' : err.message,
  });
});

module.exports = { app, logger };
