const axios = require('axios');
const config = require('../config');
const { pool } = require('../models/db');

/**
 * Video Production Pipeline
 * Step 1: OpenAI GPT-4o-mini → video script + image prompt + motion prompt
 * Step 2: OpenAI DALL-E 3     → starting frame image
 * Step 3: Runway ML Gen-3      → image-to-video generation
 */
class VideoPipeline {
  constructor() {
    this.openaiKey = config.openai.apiKey;
    this.runwayKey = config.runway.apiKey;
    this.runwayBase = 'https://api.runwayml.com/v1';
  }

  async triggerVideoGeneration(brief) {
    const {
      tenantId,
      userId,
      brandName,
      productDescription,
      targetAudience,
      videoStyle,
      duration,
      platform,
      scriptDirection,
    } = brief;

    if (!this.runwayKey) {
      throw new Error('RUNWAY_API_KEY is not configured. Please add it to your environment variables.');
    }

    const genRes = await pool.query(
      `INSERT INTO ai_generations
         (tenant_id, user_id, type, status, input_data, model_used, job_started_at)
       VALUES ($1, $2, 'video', 'processing', $3, 'runway-gen3', NOW())
       RETURNING id`,
      [
        tenantId,
        userId,
        JSON.stringify({ brandName, productDescription, targetAudience, videoStyle, duration, platform, scriptDirection }),
      ]
    );
    const generationId = genRes.rows[0].id;

    // Fire-and-forget background execution
    this._runPipeline(generationId, tenantId, {
      brandName, productDescription, targetAudience,
      videoStyle, duration, platform, scriptDirection,
    }).catch((err) => {
      console.error('[VideoPipeline] Background error:', err.message);
    });

    return { generationId, status: 'processing' };
  }

  async _runPipeline(generationId, tenantId, brief) {
    const { brandName, productDescription, targetAudience, videoStyle, platform, duration, scriptDirection } = brief;

    try {
      // ── Step 1: Generate prompts via OpenAI ───────────────────────────────────
      const aspectRatio = (platform === 'youtube') ? '16:9' : '9:16';
      const styleMap = {
        ugc: 'authentic user-generated content style, natural lighting, handheld camera feel',
        testimonial: 'clean interview style, soft lighting, professional but personal',
        educational: 'clean modern style with text overlays, bright and informative',
        entertainment: 'dynamic fast-paced, vibrant colors, trendy social media aesthetic',
        product_demo: 'sleek product showcase, studio lighting, professional close-ups',
      };
      const styleDesc = styleMap[videoStyle] || styleMap.ugc;

      const promptRes = await axios.post(
        'https://api.openai.com/v1/chat/completions',
        {
          model: 'gpt-4o-mini',
          messages: [
            {
              role: 'system',
              content: 'You are an expert video ad creative director. Respond ONLY with valid JSON.',
            },
            {
              role: 'user',
              content: `Create a video ad brief for:
Brand: ${brandName}
Product: ${productDescription}
Target Audience: ${targetAudience || 'General consumers 18-35'}
Style: ${styleDesc}
Platform: ${platform}
Duration: ${duration}s
${scriptDirection ? `Direction: ${scriptDirection}` : ''}

Respond with this exact JSON:
{
  "imagePrompt": "detailed DALL-E 3 prompt for the opening scene (max 200 chars)",
  "motionPrompt": "Runway ML camera motion description (max 100 chars, describe camera movement and scene action)",
  "headline": "short punchy ad headline"
}`,
            },
          ],
          max_tokens: 300,
          temperature: 0.7,
        },
        {
          headers: { Authorization: `Bearer ${this.openaiKey}`, 'Content-Type': 'application/json' },
          timeout: 30000,
        }
      );

      let prompts;
      try {
        const raw = promptRes.data.choices[0].message.content.trim();
        const jsonStr = raw.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
        prompts = JSON.parse(jsonStr);
      } catch {
        prompts = {
          imagePrompt: `${brandName} product advertisement, ${styleDesc}, ${platform} ad`,
          motionPrompt: 'slow zoom in, product comes into focus',
          headline: brandName,
        };
      }

      // ── Step 2: Generate image with DALL-E 3 ─────────────────────────────────
      const dalleRes = await axios.post(
        'https://api.openai.com/v1/images/generate',
        {
          model: 'dall-e-3',
          prompt: `${prompts.imagePrompt}. Professional advertising photography, high quality, 4K.`,
          n: 1,
          size: aspectRatio === '9:16' ? '1024x1792' : '1792x1024',
          quality: 'standard',
          response_format: 'url',
        },
        {
          headers: { Authorization: `Bearer ${this.openaiKey}`, 'Content-Type': 'application/json' },
          timeout: 60000,
        }
      );

      const imageUrl = dalleRes.data.data[0].url;

      // ── Step 3: Runway ML image-to-video ─────────────────────────────────────
      const runwayPayload = {
        model: 'gen3a_turbo',
        promptImage: imageUrl,
        promptText: prompts.motionPrompt,
        duration: duration <= 5 ? 5 : 10,
        ratio: aspectRatio === '9:16' ? '768:1280' : '1280:768',
        watermark: false,
      };

      const runwayRes = await axios.post(
        `${this.runwayBase}/image_to_video`,
        runwayPayload,
        {
          headers: {
            Authorization: `Bearer ${this.runwayKey}`,
            'Content-Type': 'application/json',
            'X-Runway-Version': '2024-11-06',
          },
          timeout: 30000,
        }
      );

      const taskId = runwayRes.data.id;

      await pool.query(
        `UPDATE ai_generations SET n8n_execution_id = $1, updated_at = NOW() WHERE id = $2`,
        [taskId, generationId]
      );

      // ── Step 4: Poll Runway task until done ───────────────────────────────────
      const videoUrl = await this._pollRunwayTask(taskId);

      await pool.query(
        `UPDATE ai_generations
         SET status = 'completed',
             asset_url = $1,
             output_data = $2,
             job_completed_at = NOW(),
             updated_at = NOW()
         WHERE id = $3`,
        [
          videoUrl,
          JSON.stringify({ videoUrl, imageUrl, headline: prompts.headline, motionPrompt: prompts.motionPrompt }),
          generationId,
        ]
      );

      // Save as creative asset
      await pool.query(
        `INSERT INTO ad_creatives
           (tenant_id, name, type, asset_url, thumbnail_url, generated_by_ai, ai_generation_id)
         VALUES ($1, $2, 'video', $3, $4, true, $5)`,
        [tenantId, `AI Video - ${brief.brandName}`, videoUrl, imageUrl, generationId]
      );
    } catch (err) {
      console.error('[VideoPipeline] Pipeline failed:', err.response?.data || err.message);
      const errMsg = err.response?.data?.error || err.message;
      await pool.query(
        `UPDATE ai_generations SET status = 'failed', error_message = $1, updated_at = NOW() WHERE id = $2`,
        [errMsg, generationId]
      );
    }
  }

  async _pollRunwayTask(taskId, maxWaitMs = 600000) {
    const start = Date.now();
    const interval = 8000;

    while (Date.now() - start < maxWaitMs) {
      await new Promise((r) => setTimeout(r, interval));

      const res = await axios.get(`${this.runwayBase}/tasks/${taskId}`, {
        headers: {
          Authorization: `Bearer ${this.runwayKey}`,
          'X-Runway-Version': '2024-11-06',
        },
        timeout: 10000,
      });

      const { status, output, failure } = res.data;

      if (status === 'SUCCEEDED' && output?.length > 0) {
        return output[0];
      }
      if (status === 'FAILED') {
        throw new Error(`Runway task failed: ${failure || 'unknown reason'}`);
      }
    }

    throw new Error('Video generation timed out after 10 minutes');
  }

  async checkJobStatus(generationId, tenantId) {
    const result = await pool.query(
      `SELECT id, status, output_data, asset_url, error_message, job_started_at, job_completed_at
       FROM ai_generations
       WHERE id = $1 AND tenant_id = $2 AND type = 'video'`,
      [generationId, tenantId]
    );

    if (result.rows.length === 0) throw new Error('Generation job not found');
    return result.rows[0];
  }

  async handleCompletionCallback(payload) {
    const { generationId, status, videoUrl, thumbnailUrl, error, metadata } = payload;
    if (!generationId) throw new Error('generationId required');

    if (status === 'completed' && videoUrl) {
      await pool.query(
        `UPDATE ai_generations
         SET status = 'completed', asset_url = $1, output_data = $2, job_completed_at = NOW(), updated_at = NOW()
         WHERE id = $3`,
        [videoUrl, JSON.stringify({ videoUrl, thumbnailUrl, ...metadata }), generationId]
      );
    } else {
      await pool.query(
        `UPDATE ai_generations SET status = 'failed', error_message = $1, updated_at = NOW() WHERE id = $2`,
        [error || 'Video generation failed', generationId]
      );
    }
  }
}

module.exports = VideoPipeline;
