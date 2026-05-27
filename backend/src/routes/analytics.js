const express = require('express');
const router = express.Router();
const { pool } = require('../models/db');
const { authenticate } = require('../middleware/auth');

// GET /api/analytics/overview - aggregate KPIs across all campaigns
router.get('/overview', authenticate, async (req, res) => {
  try {
    const { startDate, endDate, platform, accountId } = req.query;

    const start = startDate || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    const end = endDate || new Date().toISOString().split('T')[0];

    let query = `
      SELECT
        SUM(impressions) AS total_impressions,
        SUM(clicks) AS total_clicks,
        SUM(spend) AS total_spend,
        SUM(conversions) AS total_conversions,
        SUM(conversion_value) AS total_revenue,
        CASE WHEN SUM(spend) > 0 THEN SUM(conversion_value) / SUM(spend) ELSE 0 END AS roas,
        CASE WHEN SUM(impressions) > 0 THEN SUM(clicks)::decimal / SUM(impressions) ELSE 0 END AS ctr,
        CASE WHEN SUM(clicks) > 0 THEN SUM(spend) / SUM(clicks) ELSE 0 END AS cpc,
        CASE WHEN SUM(impressions) > 0 THEN SUM(spend) / SUM(impressions) * 1000 ELSE 0 END AS cpm,
        CASE WHEN SUM(conversions) > 0 THEN SUM(spend) / SUM(conversions) ELSE 0 END AS cpa,
        CASE WHEN SUM(conversions) > 0 THEN SUM(conversion_value) / SUM(conversions) ELSE 0 END AS aov
      FROM analytics_snapshots ans
      JOIN campaigns c ON ans.campaign_id = c.id
      WHERE ans.tenant_id = $1
        AND ans.snapshot_date BETWEEN $2 AND $3
        AND ans.granularity = 'daily'
    `;

    const params = [req.user.tenantId, start, end];
    let idx = 4;

    if (platform) {
      query += ` AND ans.platform = $${idx++}`;
      params.push(platform);
    }
    if (accountId) {
      query += ` AND ans.ad_account_id = $${idx++}`;
      params.push(accountId);
    }

    const result = await pool.query(query, params);
    const metrics = result.rows[0];

    // Previous period for comparison
    const periodDays = Math.ceil((new Date(end) - new Date(start)) / (1000 * 60 * 60 * 24));
    const prevEnd = new Date(new Date(start) - 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    const prevStart = new Date(new Date(start) - periodDays * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

    const prevResult = await pool.query(query.replace('$2', '$2_prev').replace('$3', '$3_prev'),
      [req.user.tenantId, prevStart, prevEnd, ...(platform ? [platform] : []), ...(accountId ? [accountId] : [])]
    );

    // Recalculate with proper placeholders
    const prevQuery = query.split('$2')[0] + `$2 AND $3` + query.split('$3')[1];
    const prevMetricsResult = await pool.query(prevQuery, [req.user.tenantId, prevStart, prevEnd]);
    const prevMetrics = prevMetricsResult.rows[0];

    const calcChange = (current, previous) => {
      if (!previous || parseFloat(previous) === 0) return null;
      return ((parseFloat(current) - parseFloat(previous)) / parseFloat(previous)) * 100;
    };

    return res.json({
      period: { start, end },
      metrics: {
        totalImpressions: parseInt(metrics.total_impressions) || 0,
        totalClicks: parseInt(metrics.total_clicks) || 0,
        totalSpend: parseFloat(metrics.total_spend) || 0,
        totalConversions: parseInt(metrics.total_conversions) || 0,
        totalRevenue: parseFloat(metrics.total_revenue) || 0,
        roas: parseFloat(metrics.roas) || 0,
        ctr: parseFloat(metrics.ctr) || 0,
        cpc: parseFloat(metrics.cpc) || 0,
        cpm: parseFloat(metrics.cpm) || 0,
        cpa: parseFloat(metrics.cpa) || 0,
        aov: parseFloat(metrics.aov) || 0,
      },
      changes: {
        spend: calcChange(metrics.total_spend, prevMetrics.total_spend),
        roas: calcChange(metrics.roas, prevMetrics.roas),
        ctr: calcChange(metrics.ctr, prevMetrics.ctr),
        cpa: calcChange(metrics.cpa, prevMetrics.cpa),
        conversions: calcChange(metrics.total_conversions, prevMetrics.total_conversions),
      },
    });
  } catch (err) {
    console.error('[Analytics] Overview error:', err.message);
    return res.status(500).json({ error: 'Failed to fetch analytics overview' });
  }
});

// GET /api/analytics/timeseries - daily metrics for charts
router.get('/timeseries', authenticate, async (req, res) => {
  try {
    const { startDate, endDate, platform, metric = 'spend,roas,ctr', campaignId } = req.query;

    const start = startDate || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    const end = endDate || new Date().toISOString().split('T')[0];

    let query = `
      SELECT
        snapshot_date,
        SUM(impressions) AS impressions,
        SUM(clicks) AS clicks,
        SUM(spend) AS spend,
        SUM(conversions) AS conversions,
        SUM(conversion_value) AS revenue,
        CASE WHEN SUM(spend) > 0 THEN SUM(conversion_value) / SUM(spend) ELSE 0 END AS roas,
        CASE WHEN SUM(impressions) > 0 THEN SUM(clicks)::decimal / SUM(impressions) ELSE 0 END AS ctr,
        CASE WHEN SUM(clicks) > 0 THEN SUM(spend) / SUM(clicks) ELSE 0 END AS cpc,
        CASE WHEN SUM(impressions) > 0 THEN SUM(spend) / SUM(impressions) * 1000 ELSE 0 END AS cpm,
        CASE WHEN SUM(conversions) > 0 THEN SUM(spend) / SUM(conversions) ELSE 0 END AS cpa
      FROM analytics_snapshots
      WHERE tenant_id = $1
        AND snapshot_date BETWEEN $2 AND $3
        AND granularity = 'daily'
    `;

    const params = [req.user.tenantId, start, end];
    let idx = 4;

    if (platform) {
      query += ` AND platform = $${idx++}`;
      params.push(platform);
    }
    if (campaignId) {
      query += ` AND campaign_id = $${idx++}`;
      params.push(campaignId);
    }

    query += ' GROUP BY snapshot_date ORDER BY snapshot_date ASC';

    const result = await pool.query(query, params);

    return res.json({
      period: { start, end },
      data: result.rows.map((row) => ({
        date: row.snapshot_date,
        impressions: parseInt(row.impressions) || 0,
        clicks: parseInt(row.clicks) || 0,
        spend: parseFloat(row.spend) || 0,
        conversions: parseInt(row.conversions) || 0,
        revenue: parseFloat(row.revenue) || 0,
        roas: parseFloat(row.roas) || 0,
        ctr: parseFloat(row.ctr) || 0,
        cpc: parseFloat(row.cpc) || 0,
        cpm: parseFloat(row.cpm) || 0,
        cpa: parseFloat(row.cpa) || 0,
      })),
    });
  } catch (err) {
    console.error('[Analytics] Timeseries error:', err.message);
    return res.status(500).json({ error: 'Failed to fetch timeseries data' });
  }
});

// GET /api/analytics/by-platform - breakdown by platform
router.get('/by-platform', authenticate, async (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    const start = startDate || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    const end = endDate || new Date().toISOString().split('T')[0];

    const result = await pool.query(
      `SELECT
        platform,
        SUM(impressions) AS impressions,
        SUM(clicks) AS clicks,
        SUM(spend) AS spend,
        SUM(conversions) AS conversions,
        SUM(conversion_value) AS revenue,
        CASE WHEN SUM(spend) > 0 THEN SUM(conversion_value) / SUM(spend) ELSE 0 END AS roas,
        CASE WHEN SUM(impressions) > 0 THEN SUM(clicks)::decimal / SUM(impressions) ELSE 0 END AS ctr,
        CASE WHEN SUM(conversions) > 0 THEN SUM(spend) / SUM(conversions) ELSE 0 END AS cpa
       FROM analytics_snapshots
       WHERE tenant_id = $1
         AND snapshot_date BETWEEN $2 AND $3
         AND granularity = 'daily'
       GROUP BY platform
       ORDER BY SUM(spend) DESC`,
      [req.user.tenantId, start, end]
    );

    return res.json({ breakdown: result.rows });
  } catch (err) {
    console.error('[Analytics] Platform breakdown error:', err.message);
    return res.status(500).json({ error: 'Failed to fetch platform breakdown' });
  }
});

// GET /api/analytics/top-campaigns - top performing campaigns
router.get('/top-campaigns', authenticate, async (req, res) => {
  try {
    const { startDate, endDate, metric = 'roas', limit = 10 } = req.query;
    const start = startDate || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    const end = endDate || new Date().toISOString().split('T')[0];

    const orderColumn = ['roas', 'spend', 'conversions', 'ctr', 'cpa'].includes(metric) ? metric : 'roas';

    const result = await pool.query(
      `SELECT
        c.id, c.name, c.platform, c.status,
        SUM(a.impressions) AS impressions,
        SUM(a.clicks) AS clicks,
        SUM(a.spend) AS spend,
        SUM(a.conversions) AS conversions,
        SUM(a.conversion_value) AS revenue,
        CASE WHEN SUM(a.spend) > 0 THEN SUM(a.conversion_value) / SUM(a.spend) ELSE 0 END AS roas,
        CASE WHEN SUM(a.impressions) > 0 THEN SUM(a.clicks)::decimal / SUM(a.impressions) ELSE 0 END AS ctr,
        CASE WHEN SUM(a.conversions) > 0 THEN SUM(a.spend) / SUM(a.conversions) ELSE 0 END AS cpa
       FROM campaigns c
       JOIN analytics_snapshots a ON a.campaign_id = c.id
       WHERE c.tenant_id = $1
         AND a.snapshot_date BETWEEN $2 AND $3
         AND a.granularity = 'daily'
       GROUP BY c.id, c.name, c.platform, c.status
       ORDER BY roas DESC
       LIMIT $4`,
      [req.user.tenantId, start, end, parseInt(limit)]
    );

    return res.json({ campaigns: result.rows });
  } catch (err) {
    console.error('[Analytics] Top campaigns error:', err.message);
    return res.status(500).json({ error: 'Failed to fetch top campaigns' });
  }
});

// GET /api/analytics/ltv - estimated LTV metrics
router.get('/ltv', authenticate, async (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    const start = startDate || new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    const end = endDate || new Date().toISOString().split('T')[0];

    const result = await pool.query(
      `SELECT
        SUM(conversions) AS total_customers,
        SUM(conversion_value) AS total_revenue,
        CASE WHEN SUM(conversions) > 0 THEN SUM(conversion_value) / SUM(conversions) ELSE 0 END AS aov,
        SUM(spend) AS total_cac_spend,
        CASE WHEN SUM(conversions) > 0 THEN SUM(spend) / SUM(conversions) ELSE 0 END AS avg_cac
       FROM analytics_snapshots
       WHERE tenant_id = $1
         AND snapshot_date BETWEEN $2 AND $3
         AND granularity = 'daily'`,
      [req.user.tenantId, start, end]
    );

    const m = result.rows[0];
    const aov = parseFloat(m.aov) || 0;
    const avgCac = parseFloat(m.avg_cac) || 0;

    // LTV estimation: AOV * avg purchase frequency (assumed 3x/year) * avg retention (2 years)
    const estimatedPurchaseFrequency = 3;
    const estimatedRetentionYears = 2;
    const ltv = aov * estimatedPurchaseFrequency * estimatedRetentionYears;
    const ltvCacRatio = avgCac > 0 ? ltv / avgCac : 0;

    return res.json({
      period: { start, end },
      metrics: {
        totalCustomers: parseInt(m.total_customers) || 0,
        totalRevenue: parseFloat(m.total_revenue) || 0,
        aov,
        avgCac,
        estimatedLtv: ltv,
        ltvCacRatio,
        assumptions: {
          purchaseFrequencyPerYear: estimatedPurchaseFrequency,
          retentionYears: estimatedRetentionYears,
        },
      },
    });
  } catch (err) {
    console.error('[Analytics] LTV error:', err.message);
    return res.status(500).json({ error: 'Failed to calculate LTV metrics' });
  }
});

module.exports = router;
