const express = require('express');
const axios = require('axios');
const router = express.Router();
const { pool } = require('../models/db');
const { authenticate } = require('../middleware/auth');
const { aiLimiter } = require('../middleware/rateLimiter');
const config = require('../config');
const VideoPipeline = require('../services/videoPipeline');
const TrendEngine = require('../services/trendEngine');

// ─── POST /api/ai/ad-copy ─────────────────────────────────────────────────────
// Starts async ad copy generation — returns generationId immediately
router.post('/ad-copy', authenticate, aiLimiter, async (req, res) => {
  const {
    brandName,
    productDescription,
    targetAudience,
    tone = 'persuasive',
    platform = 'meta',
    variants = 3,
    campaignId,
  } = req.body;

  if (!brandName || !productDescription) {
    return res.status(400).json({ error: 'brandName and productDescription are required' });
  }

  let generationId;
  try {
    const genRes = await pool.query(
      `INSERT INTO ai_generations
         (tenant_id, user_id, type, status, input_data, model_used)
       VALUES ($1, $2, 'ad_copy', 'processing', $3, $4)
       RETURNING id`,
      [
        req.user.tenantId,
        req.user.id,
        JSON.stringify({ brandName, productDescription, targetAudience, tone, platform, variants }),
        config.openai.model,
      ]
    );
    generationId = genRes.rows[0].id;
  } catch (dbErr) {
    console.error('[AI] DB insert error:', dbErr.message);
    return res.status(500).json({ error: 'Database error', details: dbErr.message });
  }

  // Respond immediately — client will poll for results
  res.status(202).json({ generationId, status: 'processing' });

  // Run OpenAI in background
  setImmediate(async () => {
    try {
      const platformGuidance = {
        meta: 'Facebook/Instagram ad. Primary text up to 125 chars, headline 40 chars, description 30 chars.',
        google: 'Google Search ad. Headline 30 chars, description 90 chars, call to action.',
        tiktok: 'TikTok ad. Hook in first 3 seconds, energetic, conversational, include trending language.',
      };

      const systemPrompt = `You are an expert digital advertising copywriter with 10+ years creating high-converting ad copy.
Generate ${variants} distinct ad copy variants for ${platform} ads.
Platform specs: ${platformGuidance[platform] || platformGuidance.meta}
Tone: ${tone}
Return a JSON object with key "variants" containing exactly ${variants} objects, each having:
{ "variant": number, "headline": "...", "primaryText": "...", "description": "...", "callToAction": "...", "hook": "...", "uniqueAngle": "..." }`;

      const userPrompt = `Brand: ${brandName}
Product/Service: ${productDescription}
Target Audience: ${targetAudience || 'general consumers'}
Generate ${variants} high-converting ad copy variants.`;

      const openaiRes = await axios.post(
        'https://api.openai.com/v1/chat/completions',
        {
          model: config.openai.model,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt },
          ],
          max_tokens: config.openai.maxTokens,
          temperature: 0.8,
          response_format: { type: 'json_object' },
        },
        {
          headers: {
            Authorization: `Bearer ${config.openai.apiKey}`,
            'Content-Type': 'application/json',
          },
          timeout: 90000,
        }
      );

      const usage = openaiRes.data.usage;
      const raw = openaiRes.data.choices[0].message.content;
      const parsedContent = JSON.parse(raw);
      const adCopyVariants = Array.isArray(parsedContent)
        ? parsedContent
        : (parsedContent.variants || parsedContent.ad_copy || Object.values(parsedContent)[0]);

      const costUsd = (usage.prompt_tokens / 1000) * 0.00015 + (usage.completion_tokens / 1000) * 0.0006;

      await pool.query(
        `UPDATE ai_generations
         SET status = 'completed', output_data = $1, tokens_used = $2, cost_usd = $3,
             job_completed_at = NOW(), updated_at = NOW()
         WHERE id = $4`,
        [JSON.stringify({ variants: adCopyVariants }), usage.total_tokens, costUsd, generationId]
      );

      if (campaignId) {
        for (const variant of adCopyVariants) {
          await pool.query(
            `INSERT INTO ad_creatives
               (tenant_id, campaign_id, name, type, headline, primary_text, description,
                call_to_action, generated_by_ai, ai_generation_id)
             VALUES ($1, $2, $3, 'text', $4, $5, $6, $7, true, $8)`,
            [
              req.user.tenantId, campaignId,
              `${brandName} - ${platform} Ad Variant ${variant.variant}`,
              variant.headline, variant.primaryText,
              variant.description, variant.callToAction, generationId,
            ]
          );
        }
      }
    } catch (err) {
      console.error('[AI] Background ad copy error:', err.response?.data || err.message);
      await pool.query(
        `UPDATE ai_generations SET status = 'failed', error_message = $1, updated_at = NOW() WHERE id = $2`,
        [err.message, generationId]
      ).catch(() => {});
    }
  });
});

// ─── GET /api/ai/ad-copy/status/:id ──────────────────────────────────────────
// Poll for ad copy generation result
router.get('/ad-copy/status/:id', authenticate, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, status, output_data, error_message, tokens_used, cost_usd
       FROM ai_generations
       WHERE id = $1 AND tenant_id = $2 AND type = 'ad_copy'`,
      [req.params.id, req.user.tenantId]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Job not found' });
    const row = result.rows[0];
    if (row.status === 'completed') {
      return res.json({
        status: 'completed',
        generationId: row.id,
        variants: row.output_data?.variants || [],
        usage: { tokens: row.tokens_used, costUsd: row.cost_usd },
      });
    }
    if (row.status === 'failed') {
      return res.json({ status: 'failed', error: row.error_message });
    }
    return res.json({ status: 'processing' });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to get status' });
  }
});

// ─── POST /api/ai/video ───────────────────────────────────────────────────────
// Trigger n8n video production pipeline
router.post('/video', authenticate, aiLimiter, async (req, res) => {
  const {
    brandName,
    productDescription,
    targetAudience,
    videoStyle = 'ugc',
    duration = 30,
    platform = 'tiktok',
    scriptDirection,
  } = req.body;

  if (!brandName || !productDescription) {
    return res.status(400).json({ error: 'brandName and productDescription are required' });
  }

  try {
    const pipeline = new VideoPipeline();
    const job = await pipeline.triggerVideoGeneration({
      tenantId: req.user.tenantId,
      userId: req.user.id,
      brandName,
      productDescription,
      targetAudience,
      videoStyle,
      duration,
      platform,
      scriptDirection,
    });

    return res.status(202).json({
      message: 'Video generation pipeline triggered',
      jobId: job.generationId,
      estimatedMinutes: 8,
      statusUrl: `/api/ai/video/status/${job.generationId}`,
    });
  } catch (err) {
    console.error('[AI] Video trigger error:', err.message);
    return res.status(500).json({ error: 'Failed to trigger video generation', details: err.message });
  }
});

// GET /api/ai/video/status/:jobId - poll video generation status
router.get('/video/status/:jobId', authenticate, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, status, output_data, asset_url, error_message, job_started_at, job_completed_at
       FROM ai_generations
       WHERE id = $1 AND tenant_id = $2 AND type = 'video'`,
      [req.params.jobId, req.user.tenantId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Job not found' });
    }

    const job = result.rows[0];
    return res.json({
      jobId: job.id,
      status: job.status,
      assetUrl: job.asset_url,
      outputData: job.output_data,
      error: job.error_message,
      startedAt: job.job_started_at,
      completedAt: job.job_completed_at,
    });
  } catch (err) {
    console.error('[AI] Video status error:', err.message);
    return res.status(500).json({ error: 'Failed to get job status' });
  }
});

// ─── POST /api/ai/voiceover ───────────────────────────────────────────────────
// Generate voiceover using ElevenLabs
router.post('/voiceover', authenticate, aiLimiter, async (req, res) => {
  const {
    text,
    voiceId = config.elevenlabs.defaultVoiceId,
    modelId = 'eleven_multilingual_v2',
    stability = 0.5,
    similarityBoost = 0.75,
    style = 0.0,
    useSpeakerBoost = true,
  } = req.body;

  if (!text || text.length < 10) {
    return res.status(400).json({ error: 'text is required (min 10 characters)' });
  }
  if (text.length > 5000) {
    return res.status(400).json({ error: 'text exceeds 5000 character limit' });
  }

  const genRes = await pool.query(
    `INSERT INTO ai_generations
       (tenant_id, user_id, type, status, input_data, model_used, job_started_at)
     VALUES ($1, $2, 'voiceover', 'processing', $3, 'elevenlabs', NOW())
     RETURNING id`,
    [req.user.tenantId, req.user.id, JSON.stringify({ text, voiceId, modelId })]
  );
  const generationId = genRes.rows[0].id;

  try {
    const elevenRes = await axios.post(
      `${config.elevenlabs.baseUrl}/text-to-speech/${voiceId}`,
      {
        text,
        model_id: modelId,
        voice_settings: {
          stability,
          similarity_boost: similarityBoost,
          style,
          use_speaker_boost: useSpeakerBoost,
        },
      },
      {
        headers: {
          'xi-api-key': config.elevenlabs.apiKey,
          'Content-Type': 'application/json',
          Accept: 'audio/mpeg',
        },
        responseType: 'arraybuffer',
      }
    );

    // Convert audio to base64 for response
    const audioBase64 = Buffer.from(elevenRes.data).toString('base64');
    const audioDataUrl = `data:audio/mpeg;base64,${audioBase64}`;

    await pool.query(
      `UPDATE ai_generations
       SET status = 'completed', output_text = $1, job_completed_at = NOW(), updated_at = NOW()
       WHERE id = $2`,
      [`Audio generated - ${text.substring(0, 100)}...`, generationId]
    );

    return res.json({
      generationId,
      audioBase64: audioDataUrl,
      contentType: 'audio/mpeg',
      characterCount: text.length,
    });
  } catch (err) {
    console.error('[AI] Voiceover error:', err.response?.data || err.message);
    await pool.query(
      `UPDATE ai_generations SET status = 'failed', error_message = $1, updated_at = NOW() WHERE id = $2`,
      [err.message, generationId]
    );
    return res.status(500).json({ error: 'Failed to generate voiceover', details: err.message });
  }
});

// ─── POST /api/ai/analyze ─────────────────────────────────────────────────────
// Analyze campaign performance with GPT-4
router.post('/analyze', authenticate, aiLimiter, async (req, res) => {
  const { campaignId, metricsData, question } = req.body;

  if (!metricsData && !campaignId) {
    return res.status(400).json({ error: 'campaignId or metricsData required' });
  }

  let metrics = metricsData;

  if (campaignId && !metricsData) {
    const analyticsResult = await pool.query(
      `SELECT snapshot_date, impressions, clicks, spend, conversions, roas, ctr, cpa
       FROM analytics_snapshots
       WHERE campaign_id = $1
       ORDER BY snapshot_date DESC LIMIT 30`,
      [campaignId]
    );
    metrics = analyticsResult.rows;
  }

  const genRes = await pool.query(
    `INSERT INTO ai_generations
       (tenant_id, user_id, type, status, input_data, model_used, job_started_at)
     VALUES ($1, $2, 'analysis', 'processing', $3, $4, NOW())
     RETURNING id`,
    [req.user.tenantId, req.user.id, JSON.stringify({ campaignId, question }), config.openai.model]
  );
  const generationId = genRes.rows[0].id;

  try {
    const analysisPrompt = question ||
      'Analyze this campaign performance data. Identify top insights, anomalies, and provide 3 specific optimization recommendations.';

    const openaiRes = await axios.post(
      'https://api.openai.com/v1/chat/completions',
      {
        model: config.openai.model,
        messages: [
          {
            role: 'system',
            content: `You are a senior digital marketing analyst specializing in paid media optimization.
Analyze ad campaign data and provide actionable insights in JSON format with:
{
  "summary": "2-3 sentence overview",
  "keyInsights": [{ "insight": "...", "impact": "high|medium|low", "metric": "..." }],
  "recommendations": [{ "action": "...", "expectedImpact": "...", "priority": 1-5 }],
  "alerts": [{ "type": "warning|opportunity", "message": "..." }]
}`,
          },
          {
            role: 'user',
            content: `${analysisPrompt}\n\nMetrics data:\n${JSON.stringify(metrics, null, 2)}`,
          },
        ],
        max_tokens: 1500,
        temperature: 0.3,
        response_format: { type: 'json_object' },
      },
      {
        headers: {
          Authorization: `Bearer ${config.openai.apiKey}`,
          'Content-Type': 'application/json',
        },
        timeout: 90000,
      }
    );

    const analysis = JSON.parse(openaiRes.data.choices[0].message.content);
    const usage = openaiRes.data.usage;
    const costUsd = (usage.prompt_tokens / 1000) * 0.01 + (usage.completion_tokens / 1000) * 0.03;

    await pool.query(
      `UPDATE ai_generations
       SET status = 'completed', output_data = $1, tokens_used = $2, cost_usd = $3,
           job_completed_at = NOW(), updated_at = NOW()
       WHERE id = $4`,
      [JSON.stringify(analysis), usage.total_tokens, costUsd, generationId]
    );

    return res.json({ generationId, analysis, usage: { tokens: usage.total_tokens, costUsd } });
  } catch (err) {
    console.error('[AI] Analysis error:', err.response?.data || err.message);
    await pool.query(
      `UPDATE ai_generations SET status = 'failed', error_message = $1, updated_at = NOW() WHERE id = $2`,
      [err.message, generationId]
    );
    return res.status(500).json({ error: 'Analysis failed', details: err.message });
  }
});

// GET /api/ai/generations - list AI generation history
router.get('/generations', authenticate, async (req, res) => {
  try {
    const { type, status, page = 1, limit = 20 } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(limit);

    let query = `
      SELECT id, type, status, model_used, tokens_used, cost_usd,
             job_started_at, job_completed_at, error_message, created_at,
             LEFT(output_text, 200) as output_preview
      FROM ai_generations
      WHERE tenant_id = $1
    `;
    const params = [req.user.tenantId];
    let idx = 2;

    if (type) { query += ` AND type = $${idx++}`; params.push(type); }
    if (status) { query += ` AND status = $${idx++}`; params.push(status); }

    query += ` ORDER BY created_at DESC LIMIT $${idx++} OFFSET $${idx++}`;
    params.push(parseInt(limit), offset);

    const result = await pool.query(query, params);
    return res.json({ generations: result.rows });
  } catch (err) {
    console.error('[AI] Generations list error:', err.message);
    return res.status(500).json({ error: 'Failed to fetch generations' });
  }
});

module.exports = router;
