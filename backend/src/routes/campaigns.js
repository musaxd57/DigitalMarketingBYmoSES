const express = require('express');
const axios = require('axios');
const router = express.Router();
const { pool } = require('../models/db');
const { authenticate } = require('../middleware/auth');
const { syncLimiter } = require('../middleware/rateLimiter');
const MetaAdsService = require('../services/metaAds');
const GoogleAdsService = require('../services/googleAds');
const TikTokAdsService = require('../services/tiktokAds');
const config = require('../config');

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

// POST /api/campaigns/upload-image - upload image URL to Meta ad library
router.post('/upload-image', authenticate, async (req, res) => {
  const { adAccountId, imageUrl } = req.body;
  if (!adAccountId || !imageUrl) {
    return res.status(400).json({ error: 'adAccountId and imageUrl are required' });
  }
  try {
    const accountResult = await pool.query(
      `SELECT * FROM ad_accounts WHERE id = $1 AND tenant_id = $2 AND platform = 'meta' AND is_active = true`,
      [adAccountId, req.user.tenantId]
    );
    if (accountResult.rows.length === 0) {
      return res.status(404).json({ error: 'Meta ad account not found' });
    }
    const metaService = new MetaAdsService(accountResult.rows[0]);
    const result = await metaService.uploadAdImage(imageUrl);
    return res.json({
      hash: result.hash,
      url: result.url,
      message: 'Görsel Meta Ads kitaplığına yüklendi',
    });
  } catch (err) {
    console.error('[Campaigns] Image upload error:', err.message);
    return res.status(500).json({ error: err.message || 'Failed to upload image to Meta' });
  }
});

// POST /api/campaigns/meta-pages - get FB pages for an ad account
router.post('/meta-pages', authenticate, async (req, res) => {
  const { adAccountId } = req.body;
  if (!adAccountId) return res.status(400).json({ error: 'adAccountId required' });
  try {
    const accountResult = await pool.query(
      `SELECT * FROM ad_accounts WHERE id = $1 AND tenant_id = $2 AND platform = 'meta' AND is_active = true`,
      [adAccountId, req.user.tenantId]
    );
    if (accountResult.rows.length === 0) {
      return res.status(404).json({ error: 'Meta ad account not found' });
    }
    const metaService = new MetaAdsService(accountResult.rows[0]);
    const pages = await metaService.getConnectedPages();
    return res.json({ pages });
  } catch (err) {
    console.error('[Campaigns] Meta pages error:', err.message);
    return res.status(500).json({ error: err.message });
  }
});

// POST /api/campaigns/publish-meta - create real campaign on Meta Ads
router.post('/publish-meta', authenticate, async (req, res) => {
  const { adAccountId, name, objective, dailyBudget, targeting, startDate,
          imageUrl, pageId, adText, destinationUrl } = req.body;

  if (!adAccountId || !name || !objective || !dailyBudget) {
    return res.status(400).json({ error: 'adAccountId, name, objective, dailyBudget are required' });
  }

  try {
    const accountResult = await pool.query(
      `SELECT * FROM ad_accounts WHERE id = $1 AND tenant_id = $2 AND platform = 'meta' AND is_active = true`,
      [adAccountId, req.user.tenantId]
    );
    if (accountResult.rows.length === 0) {
      return res.status(404).json({ error: 'Meta ad account not found' });
    }

    const MetaAdsService = require('../services/metaAds');
    const metaService = new MetaAdsService(accountResult.rows[0]);

    // Map our objective to Meta API objective
    const objectiveMap = {
      TRAFFIC: 'OUTCOME_TRAFFIC',
      CONVERSIONS: 'OUTCOME_SALES',
      BRAND_AWARENESS: 'OUTCOME_AWARENESS',
      ENGAGEMENT: 'OUTCOME_ENGAGEMENT',
      LEAD_GENERATION: 'OUTCOME_LEADS',
      VIDEO_VIEWS: 'OUTCOME_AWARENESS',
    };
    const metaObjective = objectiveMap[objective] || 'OUTCOME_TRAFFIC';

    // Create campaign on Meta
    const metaCampaign = await metaService.createCampaign({
      name,
      objective: metaObjective,
      status: 'PAUSED',
    });

    // Default targeting if not provided
    const targetingData = targeting || {
      geo_locations: { countries: ['TR'] },
      age_min: 18,
      age_max: 65,
    };

    // Create ad set on Meta
    const metaAdSet = await metaService.createAdSet({
      campaignId: metaCampaign.id,
      name: `${name} - Reklam Seti`,
      dailyBudget: parseFloat(dailyBudget),
      targeting: targetingData,
      startTime: startDate ? new Date(startDate).toISOString() : undefined,
    });

    let imageHash = null;
    let creativeId = null;
    let adId = null;

    // If imageUrl provided, upload to Meta and create full ad
    if (imageUrl && pageId && destinationUrl) {
      const uploaded = await metaService.uploadAdImage(imageUrl);
      imageHash = uploaded.hash;

      const creative = await metaService.createAdCreative({
        name: `${name} - Kreatif`,
        pageId,
        imageHash,
        linkUrl: destinationUrl,
        message: adText || name,
        headline: name,
      });
      creativeId = creative.id;

      const ad = await metaService.createAd({
        name: `${name} - Reklam`,
        adSetId: metaAdSet.id,
        creativeId,
      });
      adId = ad.id;
    } else if (imageUrl) {
      // Just upload image, no creative (page_id missing)
      const uploaded = await metaService.uploadAdImage(imageUrl);
      imageHash = uploaded.hash;
    }

    // Save to local DB
    const dbResult = await pool.query(
      `INSERT INTO campaigns
         (tenant_id, ad_account_id, external_id, name, platform, status, objective,
          budget_type, budget_amount, start_date)
       VALUES ($1, $2, $3, $4, 'meta', 'paused', $5, 'daily', $6, $7)
       RETURNING *`,
      [
        req.user.tenantId,
        adAccountId,
        metaCampaign.id,
        name,
        objective,
        parseFloat(dailyBudget),
        startDate || new Date().toISOString().split('T')[0],
      ]
    );

    const fullAd = !!(imageHash && creativeId && adId);
    return res.status(201).json({
      campaign: dbResult.rows[0],
      meta: {
        campaignId: metaCampaign.id,
        adSetId: metaAdSet.id,
        imageHash: imageHash || undefined,
        creativeId: creativeId || undefined,
        adId: adId || undefined,
      },
      message: fullAd
        ? 'Kampanya + Reklam Seti + Görsel + Reklam Meta Ads\'te oluşturuldu (duraklatılmış)'
        : imageHash
          ? 'Kampanya oluşturuldu, görsel kitaplığa yüklendi (duraklatılmış)'
          : 'Kampanya Meta Ads\'te oluşturuldu (duraklatılmış)',
    });
  } catch (err) {
    console.error('[Campaigns] Meta publish error:', err.message);
    return res.status(500).json({ error: err.message || 'Failed to publish campaign to Meta' });
  }
});

// POST /api/campaigns/optimize — analyze campaigns, return AI recommendations
router.post('/optimize', authenticate, async (req, res) => {
  const { days = 14 } = req.body;
  try {
    // Fetch campaigns with aggregated analytics
    const result = await pool.query(
      `SELECT
         c.id, c.external_id, c.name, c.platform, c.status,
         c.budget_amount, c.budget_type,
         aa.id AS ad_account_id, aa.account_name,
         COALESCE(SUM(s.spend), 0) AS total_spend,
         COALESCE(SUM(s.impressions), 0) AS total_impressions,
         COALESCE(SUM(s.clicks), 0) AS total_clicks,
         COALESCE(SUM(s.conversions), 0) AS total_conversions,
         COALESCE(SUM(s.conversion_value), 0) AS total_conversion_value,
         CASE WHEN SUM(s.spend) > 0 THEN SUM(s.conversion_value) / SUM(s.spend) ELSE 0 END AS roas,
         CASE WHEN SUM(s.impressions) > 0 THEN SUM(s.clicks)::decimal / SUM(s.impressions) ELSE 0 END AS ctr,
         CASE WHEN SUM(s.conversions) > 0 THEN SUM(s.spend) / SUM(s.conversions) ELSE 0 END AS cpa
       FROM campaigns c
       JOIN ad_accounts aa ON c.ad_account_id = aa.id
       LEFT JOIN analytics_snapshots s ON s.campaign_id = c.id
         AND s.snapshot_date >= NOW() - ($2 || ' days')::INTERVAL
       WHERE c.tenant_id = $1 AND c.status NOT IN ('deleted','archived')
       GROUP BY c.id, c.external_id, c.name, c.platform, c.status,
                c.budget_amount, c.budget_type, aa.id, aa.account_name
       HAVING COALESCE(SUM(s.spend), 0) > 0
       ORDER BY roas DESC`,
      [req.user.tenantId, days]
    );

    const campaigns = result.rows;

    if (campaigns.length === 0) {
      return res.json({
        recommendations: [],
        summary: 'Yeterli veri yok. Kampanya harcaması başladıktan sonra tekrar kontrol et.',
      });
    }

    // Rule-based scoring (works without GPT)
    const avgRoas = campaigns.reduce((s, c) => s + parseFloat(c.roas), 0) / campaigns.length;
    const avgCtr = campaigns.reduce((s, c) => s + parseFloat(c.ctr), 0) / campaigns.length;

    const recommendations = campaigns.map((c) => {
      const roas = parseFloat(c.roas);
      const ctr = parseFloat(c.ctr);
      const budget = parseFloat(c.budget_amount) || 0;
      const spend = parseFloat(c.total_spend);

      let action = 'keep';
      let newBudget = null;
      let reason = '';
      let priority = 'low';

      if (roas >= avgRoas * 1.5 && ctr >= avgCtr) {
        // Top performer — increase budget
        newBudget = Math.round(budget * 1.3);
        action = 'increase_budget';
        reason = `ROAS ${roas.toFixed(2)}x ortalamanın %50 üzerinde. Bütçeyi %30 artır.`;
        priority = 'high';
      } else if (roas < 0.8 && spend > 50) {
        // Losing money — pause
        action = 'pause';
        reason = `ROAS ${roas.toFixed(2)}x — harcama karşılıksız. Durdur veya optimize et.`;
        priority = 'high';
      } else if (roas < avgRoas * 0.7 && budget > 100) {
        // Underperformer — cut budget
        newBudget = Math.round(budget * 0.6);
        action = 'decrease_budget';
        reason = `ROAS ortalamanın %30 altında. Bütçeyi %40 düşür.`;
        priority = 'medium';
      } else if (roas >= avgRoas && ctr < avgCtr * 0.5) {
        // Good ROAS but low CTR — creative issue
        action = 'refresh_creative';
        reason = `CTR düşük (${(ctr * 100).toFixed(2)}%). Yeni kreatif dene.`;
        priority = 'medium';
      } else {
        action = 'keep';
        reason = `Performans ortalama seviyede. Mevcut bütçeyi koru.`;
        priority = 'low';
      }

      return {
        campaignId: c.id,
        externalId: c.external_id,
        campaignName: c.name,
        platform: c.platform,
        adAccountId: c.ad_account_id,
        currentBudget: budget,
        newBudget,
        action,
        reason,
        priority,
        metrics: {
          spend: parseFloat(spend.toFixed(2)),
          roas: parseFloat(roas.toFixed(3)),
          ctr: parseFloat((ctr * 100).toFixed(3)),
          conversions: parseInt(c.total_conversions),
          clicks: parseInt(c.total_clicks),
        },
      };
    });

    // Sort: high priority first
    recommendations.sort((a, b) => {
      const p = { high: 0, medium: 1, low: 2 };
      return p[a.priority] - p[b.priority];
    });

    // GPT summary if available
    let aiSummary = null;
    if (config.openai.apiKey) {
      try {
        const topRecs = recommendations.slice(0, 5);
        const prompt = `Dijital reklam kampanyası optimizasyon uzmanısın. Aşağıdaki ${days} günlük kampanya verileri için kısa bir Türkçe özet yaz (3-4 cümle). Hangi kampanyalara öncelik ver, genel bütçe stratejisi ne olmalı:\n\n${topRecs.map(r => `- ${r.campaignName}: ROAS ${r.metrics.roas}x, CTR ${r.metrics.ctr}%, Harcama ${r.metrics.spend} TRY → Öneri: ${r.reason}`).join('\n')}`;
        const gptRes = await axios.post(
          'https://api.openai.com/v1/chat/completions',
          {
            model: config.openai.model,
            messages: [{ role: 'user', content: prompt }],
            max_tokens: 300,
            temperature: 0.7,
          },
          { headers: { Authorization: `Bearer ${config.openai.apiKey}` }, timeout: 20000 }
        );
        aiSummary = gptRes.data.choices[0].message.content;
      } catch { /* optional */ }
    }

    return res.json({
      recommendations,
      summary: aiSummary || `${recommendations.filter(r => r.priority === 'high').length} kritik, ${recommendations.filter(r => r.priority === 'medium').length} orta öncelikli öneri. Toplam ${campaigns.length} kampanya analiz edildi.`,
      analyzedDays: days,
      campaignCount: campaigns.length,
    });
  } catch (err) {
    console.error('[Campaigns] Optimize error:', err.message);
    return res.status(500).json({ error: err.message || 'Optimization failed' });
  }
});

// POST /api/campaigns/apply-optimization — apply a single recommendation
router.post('/apply-optimization', authenticate, async (req, res) => {
  const { campaignId, action, newBudget, adAccountId, externalId } = req.body;

  if (!campaignId || !action) {
    return res.status(400).json({ error: 'campaignId and action are required' });
  }

  try {
    // Get campaign + account details
    const campResult = await pool.query(
      `SELECT c.*, aa.platform, aa.encrypted_access_token, aa.account_id AS meta_account_id,
              aa.encrypted_refresh_token, aa.token_expires_at, aa.metadata
       FROM campaigns c
       JOIN ad_accounts aa ON c.ad_account_id = aa.id
       WHERE c.id = $1 AND c.tenant_id = $2`,
      [campaignId, req.user.tenantId]
    );

    if (campResult.rows.length === 0) {
      return res.status(404).json({ error: 'Campaign not found' });
    }

    const campaign = campResult.rows[0];
    let applied = false;
    let message = '';

    if (campaign.platform === 'meta' && campaign.encrypted_access_token) {
      const metaService = new MetaAdsService(campaign);

      // For budget changes we need the ad set ID — fetch it from Meta
      if (action === 'increase_budget' || action === 'decrease_budget') {
        if (!newBudget) return res.status(400).json({ error: 'newBudget required for budget changes' });

        // Get ad sets for this campaign
        const adSets = await metaService.request(`/${externalId}/adsets`, { fields: 'id,name,daily_budget', limit: 10 });
        if (adSets.data?.length > 0) {
          for (const adSet of adSets.data) {
            await metaService.updateAdSetBudget(adSet.id, newBudget);
          }
          applied = true;
          message = `Bütçe ${newBudget} TRY olarak güncellendi (${adSets.data.length} reklam seti)`;
        } else {
          message = 'Reklam seti bulunamadı — Meta Ads Manager\'dan manuel güncelle';
        }
      } else if (action === 'pause') {
        const adSets = await metaService.request(`/${externalId}/adsets`, { fields: 'id,name', limit: 10 });
        if (adSets.data?.length > 0) {
          for (const adSet of adSets.data) {
            await metaService.setAdSetStatus(adSet.id, 'PAUSED');
          }
          applied = true;
          message = `Kampanya duraklatıldı (${adSets.data.length} reklam seti)`;
        }
      }
    } else {
      message = `${campaign.platform} platformu için manuel uygula — API desteği aktif değil`;
    }

    // Update local DB budget
    if (applied && newBudget) {
      await pool.query(
        'UPDATE campaigns SET budget_amount = $1, updated_at = NOW() WHERE id = $2',
        [newBudget, campaignId]
      );
    }
    if (applied && action === 'pause') {
      await pool.query(
        "UPDATE campaigns SET status = 'paused', updated_at = NOW() WHERE id = $1",
        [campaignId]
      );
    }

    // Log the action
    await pool.query(
      `INSERT INTO ai_generations (tenant_id, user_id, type, status, input_data, model_used, output_data, tokens_used, job_completed_at)
       VALUES ($1, $2, 'optimization', 'completed', $3, 'rule-based', $4, 0, NOW())`,
      [
        req.user.tenantId,
        req.user.id,
        JSON.stringify({ campaignId, action, newBudget }),
        JSON.stringify({ applied, message }),
      ]
    ).catch(() => {});

    return res.json({ applied, message, action });
  } catch (err) {
    console.error('[Campaigns] Apply optimization error:', err.message);
    return res.status(500).json({ error: err.message || 'Failed to apply optimization' });
  }
});

// POST /api/campaigns/weekly-report — generate + optionally email weekly performance report
router.post('/weekly-report', authenticate, async (req, res) => {
  const { email } = req.body;
  try {
    const result = await pool.query(
      `SELECT
         c.name, c.platform, c.status,
         COALESCE(SUM(s.spend), 0) AS spend,
         COALESCE(SUM(s.impressions), 0) AS impressions,
         COALESCE(SUM(s.clicks), 0) AS clicks,
         COALESCE(SUM(s.conversions), 0) AS conversions,
         CASE WHEN SUM(s.spend) > 0 THEN SUM(s.conversion_value) / SUM(s.spend) ELSE 0 END AS roas,
         CASE WHEN SUM(s.impressions) > 0 THEN SUM(s.clicks)::decimal / SUM(s.impressions) * 100 ELSE 0 END AS ctr_pct
       FROM campaigns c
       LEFT JOIN analytics_snapshots s ON s.campaign_id = c.id
         AND s.snapshot_date >= NOW() - INTERVAL '7 days'
       WHERE c.tenant_id = $1 AND c.status NOT IN ('deleted','archived')
       GROUP BY c.id, c.name, c.platform, c.status
       ORDER BY spend DESC
       LIMIT 20`,
      [req.user.tenantId]
    );

    const rows = result.rows;
    const totalSpend = rows.reduce((s, r) => s + parseFloat(r.spend), 0);
    const totalConversions = rows.reduce((s, r) => s + parseInt(r.conversions), 0);
    const avgRoas = rows.length ? rows.reduce((s, r) => s + parseFloat(r.roas), 0) / rows.filter(r => parseFloat(r.spend) > 0).length : 0;

    const reportData = {
      period: 'Son 7 Gün',
      generatedAt: new Date().toISOString(),
      summary: { totalSpend: totalSpend.toFixed(2), totalConversions, avgRoas: avgRoas.toFixed(2), campaignCount: rows.length },
      campaigns: rows.map(r => ({
        name: r.name, platform: r.platform, status: r.status,
        spend: parseFloat(r.spend).toFixed(2),
        roas: parseFloat(r.roas).toFixed(2),
        ctr: parseFloat(r.ctr_pct).toFixed(2),
        conversions: parseInt(r.conversions),
      })),
    };

    // Send email if SMTP configured and email provided
    let emailSent = false;
    const smtpUser = process.env.SMTP_USER;
    const smtpPass = process.env.SMTP_PASS;
    if (email && smtpUser && smtpPass) {
      try {
        const nodemailer = require('nodemailer');
        const transporter = nodemailer.createTransport({
          host: process.env.SMTP_HOST || 'smtp.gmail.com',
          port: parseInt(process.env.SMTP_PORT || '587'),
          secure: false,
          auth: { user: smtpUser, pass: smtpPass },
        });

        const topCampaigns = reportData.campaigns.slice(0, 5)
          .map(c => `<tr><td style="padding:8px;border-bottom:1px solid #222">${c.name}</td><td style="padding:8px;border-bottom:1px solid #222;text-align:center">${c.platform}</td><td style="padding:8px;border-bottom:1px solid #222;text-align:center">${c.spend} TRY</td><td style="padding:8px;border-bottom:1px solid #222;text-align:center;color:${parseFloat(c.roas) >= 2 ? '#00ff88' : parseFloat(c.roas) >= 1 ? '#facc15' : '#f87171'}">${c.roas}x</td><td style="padding:8px;border-bottom:1px solid #222;text-align:center">${c.ctr}%</td></tr>`)
          .join('');

        await transporter.sendMail({
          from: `Digital Marketing by Moses <${smtpUser}>`,
          to: email,
          subject: `📊 Haftalık Reklam Raporu — ${new Date().toLocaleDateString('tr-TR')}`,
          html: `
<div style="background:#0a0e1f;color:#f1f5f9;font-family:Inter,sans-serif;padding:32px;max-width:600px;margin:0 auto;border-radius:12px">
  <h1 style="color:#00ff88;font-size:20px;margin:0 0 4px">Digital Marketing by Moses</h1>
  <p style="color:#475569;font-size:13px;margin:0 0 24px">Haftalık Performans Raporu — Son 7 Gün</p>

  <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px;margin-bottom:24px">
    <div style="background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.06);border-radius:8px;padding:16px;text-align:center">
      <p style="color:#475569;font-size:11px;font-family:monospace;margin:0 0 4px">TOPLAM HARCAMA</p>
      <p style="color:#f1f5f9;font-size:22px;font-weight:600;margin:0">${reportData.summary.totalSpend} TRY</p>
    </div>
    <div style="background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.06);border-radius:8px;padding:16px;text-align:center">
      <p style="color:#475569;font-size:11px;font-family:monospace;margin:0 0 4px">ORT. ROAS</p>
      <p style="color:#00ff88;font-size:22px;font-weight:600;margin:0">${reportData.summary.avgRoas}x</p>
    </div>
    <div style="background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.06);border-radius:8px;padding:16px;text-align:center">
      <p style="color:#475569;font-size:11px;font-family:monospace;margin:0 0 4px">DÖNÜŞÜMLER</p>
      <p style="color:#f1f5f9;font-size:22px;font-weight:600;margin:0">${reportData.summary.totalConversions}</p>
    </div>
  </div>

  <h2 style="color:#94a3b8;font-size:13px;font-family:monospace;text-transform:uppercase;letter-spacing:.05em;margin:0 0 12px">Kampanyalar</h2>
  <table style="width:100%;border-collapse:collapse;font-size:13px">
    <thead><tr style="color:#475569">
      <th style="padding:8px;text-align:left;border-bottom:1px solid rgba(255,255,255,0.06)">Kampanya</th>
      <th style="padding:8px;text-align:center;border-bottom:1px solid rgba(255,255,255,0.06)">Platform</th>
      <th style="padding:8px;text-align:center;border-bottom:1px solid rgba(255,255,255,0.06)">Harcama</th>
      <th style="padding:8px;text-align:center;border-bottom:1px solid rgba(255,255,255,0.06)">ROAS</th>
      <th style="padding:8px;text-align:center;border-bottom:1px solid rgba(255,255,255,0.06)">CTR</th>
    </tr></thead>
    <tbody>${topCampaigns}</tbody>
  </table>

  <p style="color:#1e293b;font-size:11px;margin:24px 0 0;text-align:center">Digital Marketing by Moses — Otomatik Rapor</p>
</div>`,
        });
        emailSent = true;
      } catch (emailErr) {
        console.error('[Campaigns] Report email error:', emailErr.message);
      }
    }

    return res.json({ report: reportData, emailSent });
  } catch (err) {
    console.error('[Campaigns] Weekly report error:', err.message);
    return res.status(500).json({ error: err.message || 'Report generation failed' });
  }
});

module.exports = router;
