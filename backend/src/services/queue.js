const Bull = require('bull');
const config = require('../config');

const redisOptions = config.redis.url
  ? { url: config.redis.url }
  : {
      host: config.redis.host,
      port: config.redis.port,
      password: config.redis.password,
    };

// ─── Queue Instances ─────────────────────────────────────────────────────────

const videoQueue = new Bull('video-generation', { redis: redisOptions });
const analyticsQueue = new Bull('analytics-sync', { redis: redisOptions });
const trendQueue = new Bull('trend-analysis', { redis: redisOptions });
const scoringQueue = new Bull('creative-scoring', { redis: redisOptions });
const emailQueue = new Bull('email-notifications', { redis: redisOptions });

// ─── Default Job Options ─────────────────────────────────────────────────────

const defaultJobOptions = {
  attempts: 3,
  backoff: {
    type: 'exponential',
    delay: 5000,
  },
  removeOnComplete: 100,
  removeOnFail: 200,
};

// ─── Video Generation Queue ───────────────────────────────────────────────────

videoQueue.process('generate-video', 2, async (job) => {
  const { tenantId, userId, brief } = job.data;
  const VideoPipeline = require('./videoPipeline');
  const pipeline = new VideoPipeline();

  job.progress(10);
  console.log(`[VideoQueue] Processing video job for tenant ${tenantId}`);

  const result = await pipeline.triggerVideoGeneration({ tenantId, userId, ...brief });
  job.progress(100);

  return result;
});

videoQueue.on('completed', (job, result) => {
  console.log(`[VideoQueue] Job ${job.id} completed:`, result?.generationId);
});

videoQueue.on('failed', (job, err) => {
  console.error(`[VideoQueue] Job ${job.id} failed:`, err.message);
});

// ─── Analytics Sync Queue ────────────────────────────────────────────────────

analyticsQueue.process('sync-account', 5, async (job) => {
  const { tenantId, accountId, platform, dateRange } = job.data;
  const { pool } = require('../models/db');
  const MetaAdsService = require('./metaAds');
  const GoogleAdsService = require('./googleAds');
  const TikTokAdsService = require('./tiktokAds');

  job.progress(10);

  const accountRes = await pool.query(
    'SELECT * FROM ad_accounts WHERE id = $1 AND tenant_id = $2',
    [accountId, tenantId]
  );

  if (accountRes.rows.length === 0) {
    throw new Error('Account not found');
  }

  const account = accountRes.rows[0];
  let service;

  if (platform === 'meta') service = new MetaAdsService(account);
  else if (platform === 'google') service = new GoogleAdsService(account);
  else if (platform === 'tiktok') service = new TikTokAdsService(account);
  else throw new Error(`Unknown platform: ${platform}`);

  job.progress(30);

  const endDate = dateRange?.endDate || new Date().toISOString().split('T')[0];
  const startDate = dateRange?.startDate || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

  let insights = [];
  if (platform === 'meta') {
    insights = await service.fetchAccountInsights('last_30d');
  } else if (platform === 'google') {
    insights = await service.fetchMetrics(startDate, endDate);
  } else if (platform === 'tiktok') {
    // Get all campaign IDs for this account
    const campaignsRes = await pool.query(
      'SELECT external_id FROM campaigns WHERE ad_account_id = $1',
      [accountId]
    );
    const campaignIds = campaignsRes.rows.map((r) => r.external_id);
    if (campaignIds.length > 0) {
      insights = await service.fetchInsights(campaignIds, startDate, endDate);
    }
  }

  job.progress(60);

  // Store analytics snapshots
  let stored = 0;
  for (const insight of insights) {
    // Find campaign ID from external_id
    const campaignRes = await pool.query(
      'SELECT id FROM campaigns WHERE tenant_id = $1 AND external_id = $2',
      [tenantId, insight.campaignId]
    );

    if (campaignRes.rows.length === 0) continue;

    const campaignId = campaignRes.rows[0].id;
    const spend = insight.spend || 0;
    const conversions = insight.conversions || 0;
    const conversionValue = insight.conversionValue || 0;
    const impressions = insight.impressions || 0;
    const clicks = insight.clicks || 0;

    await pool.query(
      `INSERT INTO analytics_snapshots
         (tenant_id, ad_account_id, campaign_id, snapshot_date, platform, granularity,
          impressions, clicks, spend, conversions, conversion_value,
          roas, ctr, cpc, cpm, cpa, reach, frequency, raw_data)
       VALUES ($1, $2, $3, $4, $5, 'daily', $6, $7, $8, $9, $10,
               $11, $12, $13, $14, $15, $16, $17, $18)
       ON CONFLICT (tenant_id, platform, campaign_id, creative_id, snapshot_date, granularity)
       DO UPDATE SET
         impressions = EXCLUDED.impressions,
         clicks = EXCLUDED.clicks,
         spend = EXCLUDED.spend,
         conversions = EXCLUDED.conversions,
         conversion_value = EXCLUDED.conversion_value,
         roas = EXCLUDED.roas,
         ctr = EXCLUDED.ctr,
         cpc = EXCLUDED.cpc,
         cpm = EXCLUDED.cpm,
         cpa = EXCLUDED.cpa,
         raw_data = EXCLUDED.raw_data`,
      [
        tenantId,
        accountId,
        campaignId,
        insight.date,
        platform,
        impressions,
        clicks,
        spend,
        conversions,
        conversionValue,
        spend > 0 ? conversionValue / spend : 0,
        impressions > 0 ? clicks / impressions : 0,
        clicks > 0 ? spend / clicks : 0,
        impressions > 0 ? (spend / impressions) * 1000 : 0,
        conversions > 0 ? spend / conversions : 0,
        insight.reach || 0,
        insight.frequency || 0,
        JSON.stringify(insight),
      ]
    );
    stored++;
  }

  job.progress(90);

  await pool.query(
    'UPDATE ad_accounts SET last_sync_at = NOW(), sync_error = NULL WHERE id = $1',
    [accountId]
  );

  job.progress(100);
  return { accountId, platform, insightsSynced: stored };
});

analyticsQueue.on('failed', (job, err) => {
  console.error(`[AnalyticsQueue] Job ${job.id} failed:`, err.message);
});

// ─── Trend Analysis Queue ────────────────────────────────────────────────────

trendQueue.process('analyze-trends', 2, async (job) => {
  const { tenantId, platform, niche } = job.data;
  const TrendEngine = require('./trendEngine');
  const engine = new TrendEngine();

  job.progress(20);
  const result = await engine.generateTrendReport(tenantId, platform, niche);
  job.progress(100);

  return result;
});

trendQueue.on('failed', (job, err) => {
  console.error(`[TrendQueue] Job ${job.id} failed:`, err.message);
});

// ─── Creative Scoring Queue ───────────────────────────────────────────────────

scoringQueue.process('score-creative', 3, async (job) => {
  const { creativeId, tenantId } = job.data;
  const { pool } = require('../models/db');
  const CreativeScorer = require('./creativeScorer');

  const creativeRes = await pool.query(
    'SELECT * FROM ad_creatives WHERE id = $1 AND tenant_id = $2',
    [creativeId, tenantId]
  );

  if (creativeRes.rows.length === 0) {
    throw new Error('Creative not found');
  }

  const scorer = new CreativeScorer();
  const scores = await scorer.scoreCreative(creativeRes.rows[0]);

  await pool.query(
    `UPDATE ad_creatives
     SET creative_score = $1, hook_score = $2, retention_score = $3,
         cta_score = $4, emotional_score = $5, score_breakdown = $6,
         score_reasoning = $7, updated_at = NOW()
     WHERE id = $8`,
    [
      scores.overallScore, scores.hookScore, scores.retentionScore,
      scores.ctaScore, scores.emotionalScore,
      JSON.stringify(scores.breakdown), scores.reasoning, creativeId,
    ]
  );

  return scores;
});

// ─── Helper: Schedule recurring jobs ─────────────────────────────────────────

const scheduleRecurringJobs = async () => {
  // Daily analytics sync for all active accounts - runs at 3 AM UTC
  await analyticsQueue.add(
    'daily-sync-trigger',
    { type: 'all_accounts' },
    {
      repeat: { cron: '0 3 * * *' },
      removeOnComplete: true,
    }
  );

  // Daily trend analysis - runs at 6 AM UTC
  await trendQueue.add(
    'daily-trend-analysis',
    { type: 'scheduled' },
    {
      repeat: { cron: '0 6 * * *' },
      removeOnComplete: true,
    }
  );

  console.log('[Queue] Recurring jobs scheduled');
};

// ─── Queue health check ───────────────────────────────────────────────────────

const getQueueStats = async () => {
  const [videoStats, analyticsStats, trendStats, scoringStats] = await Promise.all([
    videoQueue.getJobCounts(),
    analyticsQueue.getJobCounts(),
    trendQueue.getJobCounts(),
    scoringQueue.getJobCounts(),
  ]);

  return {
    video: videoStats,
    analytics: analyticsStats,
    trends: trendStats,
    scoring: scoringStats,
  };
};

module.exports = {
  videoQueue,
  analyticsQueue,
  trendQueue,
  scoringQueue,
  emailQueue,
  defaultJobOptions,
  scheduleRecurringJobs,
  getQueueStats,
};
