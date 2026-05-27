const express = require('express');
const router = express.Router();
const { pool } = require('../models/db');
const { authenticate } = require('../middleware/auth');
const { syncLimiter } = require('../middleware/rateLimiter');
const MetaAdsService = require('../services/metaAds');
const GoogleAdsService = require('../services/googleAds');
const TikTokAdsService = require('../services/tiktokAds');

// GET /api/campaigns - list all campaigns with latest metrics
router.get('/', authenticate, async (req, res) => {
  try {
    const { platform, status, page = 1, limit = 50 } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(limit);

    let query = `
      SELECT
        c.id, c.external_id, c.name, c.platform, c.status,
        c.objective, c.budget_type, c.budget_amount,
        c.start_date, c.end_date, c.last_synced_at,
        aa.account_name,
        COALESCE(agg.impressions, 0) AS impressions,
        COALESCE(agg.clicks, 0) AS clicks,
        COALESCE(agg.spend, 0) AS spend,
        COALESCE(agg.conversions, 0) AS conversions,
        COALESCE(agg.roas, 0) AS roas,
        COALESCE(agg.ctr, 0) AS ctr,
        COALESCE(agg.cpa, 0) AS cpa
      FROM campaigns c
      JOIN ad_accounts aa ON c.ad_account_id = aa.id
      LEFT JOIN LATERAL (
        SELECT
          SUM(impressions) AS impressions,
          SUM(clicks) AS clicks,
          SUM(spend) AS spend,
          SUM(conversions) AS conversions,
          CASE WHEN SUM(spend) > 0 THEN SUM(conversion_value) / SUM(spend) ELSE 0 END AS roas,
          CASE WHEN SUM(impressions) > 0 THEN SUM(clicks)::decimal / SUM(impressions) ELSE 0 END AS ctr,
          CASE WHEN SUM(conversions) > 0 THEN SUM(spend) / SUM(conversions) ELSE 0 END AS cpa
        FROM analytics_snapshots
        WHERE campaign_id = c.id
          AND snapshot_date >= NOW() - INTERVAL '30 days'
      ) agg ON true
      WHERE c.tenant_id = $1
    `;

    const params = [req.user.tenantId];
    let paramIdx = 2;

    if (platform) {
      query += ` AND c.platform = $${paramIdx++}`;
      params.push(platform);
    }
    if (status) {
      query += ` AND c.status = $${paramIdx++}`;
      params.push(status);
    }

    query += ` ORDER BY c.updated_at DESC LIMIT $${paramIdx++} OFFSET $${paramIdx++}`;
    params.push(parseInt(limit), offset);

    const result = await pool.query(query, params);

    const countResult = await pool.query(
      `SELECT COUNT(*) FROM campaigns WHERE tenant_id = $1
       ${platform ? ' AND platform = $2' : ''}`,
      platform ? [req.user.tenantId, platform] : [req.user.tenantId]
    );

    return res.json({
      campaigns: result.rows,
      total: parseInt(countResult.rows[0].count),
      page: parseInt(page),
      limit: parseInt(limit),
    });
  } catch (err) {
    console.error('[Campaigns] List error:', err.message);
    return res.status(500).json({ error: 'Failed to fetch campaigns' });
  }
});

// GET /api/campaigns/:id - get single campaign with full details
router.get('/:id', authenticate, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT c.*, aa.account_name, aa.platform as account_platform
       FROM campaigns c
       JOIN ad_accounts aa ON c.ad_account_id = aa.id
       WHERE c.id = $1 AND c.tenant_id = $2`,
      [req.params.id, req.user.tenantId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Campaign not found' });
    }

    const analyticsResult = await pool.query(
      `SELECT snapshot_date, impressions, clicks, spend, conversions,
              conversion_value, roas, ctr, cpc, cpm, cpa
       FROM analytics_snapshots
       WHERE campaign_id = $1
       ORDER BY snapshot_date DESC
       LIMIT 90`,
      [req.params.id]
    );

    return res.json({
      campaign: result.rows[0],
      analytics: analyticsResult.rows,
    });
  } catch (err) {
    console.error('[Campaigns] Get error:', err.message);
    return res.status(500).json({ error: 'Failed to fetch campaign' });
  }
});

// POST /api/campaigns - create campaign record manually
router.post('/', authenticate, async (req, res) => {
  const { adAccountId, name, platform, objective, budgetType, budgetAmount, startDate, endDate } = req.body;

  if (!adAccountId || !name || !platform) {
    return res.status(400).json({ error: 'adAccountId, name, and platform are required' });
  }

  try {
    const accountCheck = await pool.query(
      'SELECT id FROM ad_accounts WHERE id = $1 AND tenant_id = $2',
      [adAccountId, req.user.tenantId]
    );
    if (accountCheck.rows.length === 0) {
      return res.status(404).json({ error: 'Ad account not found' });
    }

    const result = await pool.query(
      `INSERT INTO campaigns
         (tenant_id, ad_account_id, external_id, name, platform, status, objective,
          budget_type, budget_amount, start_date, end_date)
       VALUES ($1, $2, $3, $4, $5, 'draft', $6, $7, $8, $9, $10)
       RETURNING *`,
      [
        req.user.tenantId,
        adAccountId,
        `manual-${Date.now()}`,
        name,
        platform,
        objective,
        budgetType,
        budgetAmount,
        startDate || null,
        endDate || null,
      ]
    );

    return res.status(201).json({ campaign: result.rows[0] });
  } catch (err) {
    console.error('[Campaigns] Create error:', err.message);
    return res.status(500).json({ error: 'Failed to create campaign' });
  }
});

// PUT /api/campaigns/:id - update campaign
router.put('/:id', authenticate, async (req, res) => {
  const { name, status, budgetAmount, endDate } = req.body;

  try {
    const result = await pool.query(
      `UPDATE campaigns
       SET name = COALESCE($1, name),
           status = COALESCE($2, status),
           budget_amount = COALESCE($3, budget_amount),
           end_date = COALESCE($4, end_date),
           updated_at = NOW()
       WHERE id = $5 AND tenant_id = $6
       RETURNING *`,
      [name, status, budgetAmount, endDate, req.params.id, req.user.tenantId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Campaign not found' });
    }

    return res.json({ campaign: result.rows[0] });
  } catch (err) {
    console.error('[Campaigns] Update error:', err.message);
    return res.status(500).json({ error: 'Failed to update campaign' });
  }
});

// POST /api/campaigns/sync - sync campaigns from all connected ad platforms
router.post('/sync', authenticate, syncLimiter, async (req, res) => {
  const { platform, accountId } = req.body;

  try {
    let accountsQuery = `
      SELECT id, platform, account_id, encrypted_access_token, encrypted_refresh_token,
             token_expires_at, metadata
      FROM ad_accounts
      WHERE tenant_id = $1 AND is_active = true
    `;
    const params = [req.user.tenantId];

    if (platform) {
      accountsQuery += ' AND platform = $2';
      params.push(platform);
    }
    if (accountId) {
      accountsQuery += ` AND id = $${params.length + 1}`;
      params.push(accountId);
    }

    const accounts = await pool.query(accountsQuery, params);

    const syncResults = [];

    for (const account of accounts.rows) {
      try {
        let campaigns = [];

        if (account.platform === 'meta') {
          const service = new MetaAdsService(account);
          campaigns = await service.fetchCampaigns();
        } else if (account.platform === 'google') {
          const service = new GoogleAdsService(account);
          campaigns = await service.fetchCampaigns();
        } else if (account.platform === 'tiktok') {
          const service = new TikTokAdsService(account);
          campaigns = await service.fetchCampaigns();
        }

        let upserted = 0;
        for (const campaign of campaigns) {
          await pool.query(
            `INSERT INTO campaigns
               (tenant_id, ad_account_id, external_id, name, platform, status,
                objective, budget_type, budget_amount, start_date, end_date,
                platform_data, last_synced_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, NOW())
             ON CONFLICT (tenant_id, platform, external_id)
             DO UPDATE SET
               name = EXCLUDED.name,
               status = EXCLUDED.status,
               budget_amount = EXCLUDED.budget_amount,
               platform_data = EXCLUDED.platform_data,
               last_synced_at = NOW(),
               updated_at = NOW()`,
            [
              req.user.tenantId,
              account.id,
              campaign.id,
              campaign.name,
              account.platform,
              campaign.status,
              campaign.objective,
              campaign.budget_type || 'daily',
              campaign.daily_budget || campaign.lifetime_budget || 0,
              campaign.start_time ? new Date(campaign.start_time) : null,
              campaign.stop_time ? new Date(campaign.stop_time) : null,
              JSON.stringify(campaign),
            ]
          );
          upserted++;
        }

        await pool.query(
          'UPDATE ad_accounts SET last_sync_at = NOW(), sync_error = NULL WHERE id = $1',
          [account.id]
        );

        syncResults.push({
          accountId: account.id,
          platform: account.platform,
          campaignsSynced: upserted,
          status: 'success',
        });
      } catch (syncErr) {
        console.error(`[Campaigns] Sync error for ${account.platform} ${account.account_id}:`, syncErr.message);
        await pool.query(
          'UPDATE ad_accounts SET sync_error = $1 WHERE id = $2',
          [syncErr.message, account.id]
        );
        syncResults.push({
          accountId: account.id,
          platform: account.platform,
          status: 'error',
          error: syncErr.message,
        });
      }
    }

    return res.json({ syncResults });
  } catch (err) {
    console.error('[Campaigns] Sync error:', err.message);
    return res.status(500).json({ error: 'Sync failed' });
  }
});

module.exports = router;
