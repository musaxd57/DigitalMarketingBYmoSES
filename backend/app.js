const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const winston = require('winston');
const config = require('./src/config');
const { pool } = require('./src/models/db');

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

// ─── Demo Data Seed ───────────────────────────────────────────────────────────
const demoRouter = express.Router();

demoRouter.post('/seed', authenticate, async (req, res) => {
  const tenantId = req.user.tenantId;
  const client = await pool.connect();
  try {
    const existing = await client.query(
      `SELECT COUNT(*) FROM ad_accounts WHERE tenant_id = $1 AND account_id LIKE 'DEMO_%'`,
      [tenantId]
    );
    if (parseInt(existing.rows[0].count) > 0) {
      return res.json({ message: 'Demo verisi zaten mevcut', seeded: false });
    }

    await client.query('BEGIN');

    const accountDefs = [
      { platform: 'meta',   account_id: 'DEMO_META_001',   account_name: 'Demo Meta Ads',   baseSpend: 180, baseRoas: 3.5, baseCtr: 0.022 },
      { platform: 'google', account_id: 'DEMO_GOOGLE_001', account_name: 'Demo Google Ads', baseSpend: 250, baseRoas: 5.2, baseCtr: 0.055 },
      { platform: 'tiktok', account_id: 'DEMO_TIKTOK_001', account_name: 'Demo TikTok Ads', baseSpend: 120, baseRoas: 2.8, baseCtr: 0.035 },
    ];

    const accs = {};
    for (const a of accountDefs) {
      const r = await client.query(
        `INSERT INTO ad_accounts (tenant_id, platform, account_id, account_name, is_active)
         VALUES ($1,$2,$3,$4,true) RETURNING id`,
        [tenantId, a.platform, a.account_id, a.account_name]
      );
      accs[a.platform] = { id: r.rows[0].id, ...a };
    }

    const campDefs = [
      { platform: 'meta',   name: 'Yaz Koleksiyonu - Retargeting',       objective: 'CONVERSIONS',    mult: 0.9 },
      { platform: 'meta',   name: 'Marka Bilinirliği - Geniş Kitle',     objective: 'BRAND_AWARENESS', mult: 0.6 },
      { platform: 'meta',   name: 'Sepeti Terk Edenler - Remarketing',   objective: 'CONVERSIONS',    mult: 0.4 },
      { platform: 'google', name: 'Arama Ağı - Ürün Anahtar Kelimeler',  objective: 'SEARCH',         mult: 0.8 },
      { platform: 'google', name: 'YouTube Brand Awareness',             objective: 'VIDEO',          mult: 0.5 },
      { platform: 'tiktok', name: 'TikTok Viral - Gen Z Kitlesi',        objective: 'VIDEO_VIEWS',    mult: 1.0 },
    ];

    const camps = [];
    for (let i = 0; i < campDefs.length; i++) {
      const d = campDefs[i];
      const acc = accs[d.platform];
      const r = await client.query(
        `INSERT INTO campaigns (tenant_id, ad_account_id, external_id, name, platform, status, objective, budget_type, budget_amount, start_date, updated_at)
         VALUES ($1,$2,$3,$4,$5,'active',$6,'daily',$7, CURRENT_DATE - INTERVAL '90 days', NOW()) RETURNING id`,
        [tenantId, acc.id, `DEMO_${d.platform.toUpperCase()}_${i + 1}`, d.name, d.platform, d.objective, (acc.baseSpend * d.mult * 30).toFixed(0)]
      );
      camps.push({ id: r.rows[0].id, acc, mult: d.mult });
    }

    const today = new Date();
    let snapCount = 0;
    for (const camp of camps) {
      const { acc, mult } = camp;
      const baseSpend = acc.baseSpend * mult;
      for (let d = 89; d >= 0; d--) {
        const dt = new Date(today);
        dt.setDate(dt.getDate() - d);
        const dateStr = dt.toISOString().split('T')[0];
        const dow = dt.getDay();
        const trend = 1 + (89 - d) * 0.002;
        const wknd = (dow === 0 || dow === 6) ? 0.8 : 1.05;
        const noise = 0.75 + Math.random() * 0.5;
        const spend = baseSpend * trend * wknd * noise;
        const cpm = 8 + Math.random() * 6;
        const impressions = Math.round((spend / cpm) * 1000);
        const ctr = acc.baseCtr * (0.8 + Math.random() * 0.4);
        const clicks = Math.round(impressions * ctr);
        const conversions = Math.max(0, Math.round(clicks * (0.025 + Math.random() * 0.02)));
        const roas = acc.baseRoas * trend * (0.85 + Math.random() * 0.3);
        const convValue = spend * roas;
        const cpc = clicks > 0 ? spend / clicks : 0;
        const cpa = conversions > 0 ? spend / conversions : 0;
        const aov = conversions > 0 ? convValue / conversions : 0;
        await client.query(
          `INSERT INTO analytics_snapshots
             (tenant_id, ad_account_id, campaign_id, snapshot_date, platform, granularity,
              impressions, clicks, spend, conversions, conversion_value, roas, ctr, cpc, cpm, cpa, aov)
           VALUES ($1,$2,$3,$4,$5,'daily',$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`,
          [tenantId, acc.id, camp.id, dateStr, acc.platform,
           impressions, clicks, spend.toFixed(4), conversions, convValue.toFixed(4),
           roas.toFixed(4), ctr.toFixed(6), cpc.toFixed(4), cpm.toFixed(4), cpa.toFixed(4), aov.toFixed(4)]
        );
        snapCount++;
      }
    }

    await client.query('COMMIT');
    logger.info(`[Demo] Seeded tenant ${tenantId}: ${camps.length} campaigns, ${snapCount} snapshots`);
    return res.json({ message: 'Demo verisi yüklendi!', seeded: true, campaigns: camps.length, snapshots: snapCount });
  } catch (err) {
    await client.query('ROLLBACK');
    logger.error('[Demo] Seed error:', err.message);
    return res.status(500).json({ error: 'Demo veri yüklenemedi: ' + err.message });
  } finally {
    client.release();
  }
});

demoRouter.delete('/clear', authenticate, async (req, res) => {
  try {
    await pool.query(
      `DELETE FROM ad_accounts WHERE tenant_id = $1 AND account_id LIKE 'DEMO_%'`,
      [req.user.tenantId]
    );
    return res.json({ message: 'Demo verisi temizlendi' });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

app.use('/api/demo', demoRouter);

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
