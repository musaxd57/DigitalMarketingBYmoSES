const express = require('express');
const router = express.Router();
const { pool } = require('../models/db');
const { authenticate } = require('../middleware/auth');
const { aiLimiter } = require('../middleware/rateLimiter');
const CreativeScorer = require('../services/creativeScorer');

// GET /api/creative - list creatives with scores
router.get('/', authenticate, async (req, res) => {
  try {
    const { campaignId, type, minScore, page = 1, limit = 20 } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(limit);

    let query = `
      SELECT id, name, type, format, headline, primary_text, description,
             call_to_action, asset_url, thumbnail_url,
             creative_score, hook_score, retention_score, cta_score, emotional_score,
             score_breakdown, score_reasoning, generated_by_ai,
             avg_roas, avg_ctr, total_spend, total_impressions, total_conversions,
             created_at
      FROM ad_creatives
      WHERE tenant_id = $1
    `;
    const params = [req.user.tenantId];
    let idx = 2;

    if (campaignId) {
      query += ` AND campaign_id = $${idx++}`;
      params.push(campaignId);
    }
    if (type) {
      query += ` AND type = $${idx++}`;
      params.push(type);
    }
    if (minScore) {
      query += ` AND creative_score >= $${idx++}`;
      params.push(parseFloat(minScore));
    }

    query += ` ORDER BY creative_score DESC NULLS LAST, created_at DESC LIMIT $${idx++} OFFSET $${idx++}`;
    params.push(parseInt(limit), offset);

    const result = await pool.query(query, params);
    return res.json({ creatives: result.rows });
  } catch (err) {
    console.error('[Creative] List error:', err.message);
    return res.status(500).json({ error: 'Failed to fetch creatives' });
  }
});

// GET /api/creative/:id - get single creative
router.get('/:id', authenticate, async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM ad_creatives WHERE id = $1 AND tenant_id = $2',
      [req.params.id, req.user.tenantId]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Creative not found' });
    }
    return res.json({ creative: result.rows[0] });
  } catch (err) {
    console.error('[Creative] Get error:', err.message);
    return res.status(500).json({ error: 'Failed to fetch creative' });
  }
});

// POST /api/creative - create new creative record
router.post('/', authenticate, async (req, res) => {
  const {
    campaignId, name, type, format, headline, primaryText,
    description, callToAction, assetUrl, thumbnailUrl,
  } = req.body;

  if (!name || !type) {
    return res.status(400).json({ error: 'name and type are required' });
  }

  try {
    const result = await pool.query(
      `INSERT INTO ad_creatives
         (tenant_id, campaign_id, name, type, format, headline, primary_text,
          description, call_to_action, asset_url, thumbnail_url)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       RETURNING *`,
      [
        req.user.tenantId,
        campaignId || null,
        name,
        type,
        format,
        headline,
        primaryText,
        description,
        callToAction,
        assetUrl,
        thumbnailUrl,
      ]
    );
    return res.status(201).json({ creative: result.rows[0] });
  } catch (err) {
    console.error('[Creative] Create error:', err.message);
    return res.status(500).json({ error: 'Failed to create creative' });
  }
});

// POST /api/creative/:id/score - score a creative using AI
router.post('/:id/score', authenticate, aiLimiter, async (req, res) => {
  try {
    const creativeResult = await pool.query(
      'SELECT * FROM ad_creatives WHERE id = $1 AND tenant_id = $2',
      [req.params.id, req.user.tenantId]
    );

    if (creativeResult.rows.length === 0) {
      return res.status(404).json({ error: 'Creative not found' });
    }

    const creative = creativeResult.rows[0];
    const scorer = new CreativeScorer();
    const scores = await scorer.scoreCreative(creative);

    const updated = await pool.query(
      `UPDATE ad_creatives
       SET creative_score = $1,
           hook_score = $2,
           retention_score = $3,
           cta_score = $4,
           emotional_score = $5,
           score_breakdown = $6,
           score_reasoning = $7,
           updated_at = NOW()
       WHERE id = $8
       RETURNING *`,
      [
        scores.overallScore,
        scores.hookScore,
        scores.retentionScore,
        scores.ctaScore,
        scores.emotionalScore,
        JSON.stringify(scores.breakdown),
        scores.reasoning,
        req.params.id,
      ]
    );

    return res.json({ creative: updated.rows[0], scores });
  } catch (err) {
    console.error('[Creative] Score error:', err.message);
    return res.status(500).json({ error: 'Failed to score creative' });
  }
});

// POST /api/creative/score-batch - score multiple creatives
router.post('/score-batch', authenticate, aiLimiter, async (req, res) => {
  const { creativeIds } = req.body;

  if (!Array.isArray(creativeIds) || creativeIds.length === 0) {
    return res.status(400).json({ error: 'creativeIds array required' });
  }
  if (creativeIds.length > 10) {
    return res.status(400).json({ error: 'Maximum 10 creatives per batch' });
  }

  try {
    const creativesResult = await pool.query(
      `SELECT * FROM ad_creatives
       WHERE id = ANY($1) AND tenant_id = $2`,
      [creativeIds, req.user.tenantId]
    );

    const scorer = new CreativeScorer();
    const results = [];

    for (const creative of creativesResult.rows) {
      try {
        const scores = await scorer.scoreCreative(creative);
        await pool.query(
          `UPDATE ad_creatives
           SET creative_score = $1, hook_score = $2, retention_score = $3,
               cta_score = $4, emotional_score = $5, score_breakdown = $6,
               score_reasoning = $7, updated_at = NOW()
           WHERE id = $8`,
          [
            scores.overallScore, scores.hookScore, scores.retentionScore,
            scores.ctaScore, scores.emotionalScore,
            JSON.stringify(scores.breakdown), scores.reasoning, creative.id,
          ]
        );
        results.push({ id: creative.id, scores, status: 'scored' });
      } catch (scoreErr) {
        results.push({ id: creative.id, status: 'error', error: scoreErr.message });
      }
    }

    return res.json({ results });
  } catch (err) {
    console.error('[Creative] Batch score error:', err.message);
    return res.status(500).json({ error: 'Failed to score creatives' });
  }
});

module.exports = router;
