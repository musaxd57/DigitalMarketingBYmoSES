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

  async runPipeline(brief) {
    const { brandName, productDescription, targetAudience, videoStyle, platform, duration, scriptDirection, tenantId } = brief;

    if (!this.runwayKey) {
      throw new Error('RUNWAY_API_KEY is not configured. Please add it to your environment variables.');
    }

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

      console.log('[VideoPipeline] Step 1: GPT-4o prompt generation...');
      let promptRes;
      try {
        promptRes = await axios.post(
          'https://api.openai.com/v1/chat/completions',
          {
            model: 'gpt-4o-mini',
            messages: [
              { role: 'system', content: 'You are an expert video ad creative director. Respond ONLY with valid JSON.' },
              { role: 'user', content: `Brand: ${brandName}, Product: ${productDescription}, Style: ${styleDesc}. Return JSON: {"imagePrompt":"...","motionPrompt":"...","headline":"..."}` },
            ],
            max_tokens: 300,
          temperature: 0.7,
        },
        {
          headers: { Authorization: `Bearer ${this.openaiKey}`, 'Content-Type': 'application/json' },
          timeout: 30000,
          }
        );
      } catch (gptErr) {
        const detail = JSON.stringify(gptErr.response?.data || gptErr.message);
        console.error('[VideoPipeline] GPT error:', gptErr.response?.status, detail);
        throw new Error(`GPT step failed (${gptErr.response?.status}): ${detail}`);
      }

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
      console.log('[VideoPipeline] Step 2: Generating DALL-E 3 image...');
      let dalleRes;
      try {
        dalleRes = await axios.post(
          'https://api.openai.com/v1/images/generate',
          {
            model: 'dall-e-3',
            prompt: `${prompts.imagePrompt}. Professional advertising photography, high quality.`,
            n: 1,
            size: '1024x1024',
            quality: 'standard',
            response_format: 'b64_json',
          },
          {
            headers: { Authorization: `Bearer ${this.openaiKey}`, 'Content-Type': 'application/json' },
            timeout: 60000,
          }
        );
      } catch (dalleErr) {
        const detail = JSON.stringify(dalleErr.response?.data || dalleErr.message);
        console.error('[VideoPipeline] DALL-E error:', dalleErr.response?.status, detail);
        throw new Error(`DALL-E step failed (${dalleErr.response?.status}): ${detail}`);
      }

      const imgBase64 = `data:image/png;base64,${dalleRes.data.data[0].b64_json}`;
      const imageUrl = 'dalle-generated';
      console.log('[VideoPipeline] Step 2 done. Image size (base64 chars):', imgBase64.length);

      // ── Step 3: Runway ML image-to-video ─────────────────────────────────────
      console.log('[VideoPipeline] Step 3: Sending to Runway ML...');
      const runwayPayload = {
        model: 'gen3a_turbo',
        promptImage: imgBase64,
        promptText: prompts.motionPrompt,
        duration: 5,
        ratio: aspectRatio === '9:16' ? '768:1280' : '1280:768',
      };

      let runwayRes;
      try {
        runwayRes = await axios.post(
          `${this.runwayBase}/image_to_video`,
          runwayPayload,
          {
            headers: {
              Authorization: `Bearer ${this.runwayKey}`,
              'Content-Type': 'application/json',
              'X-Runway-Version': '2024-11-06',
            },
            timeout: 60000,
            maxContentLength: 50 * 1024 * 1024,
            maxBodyLength: 50 * 1024 * 1024,
          }
        );
      } catch (runwayErr) {
        const detail = JSON.stringify(runwayErr.response?.data || runwayErr.message);
        console.error('[VideoPipeline] Runway error:', runwayErr.response?.status, detail);
        throw new Error(`Runway API ${runwayErr.response?.status || 'network'}: ${detail}`);
      }
      console.log('[VideoPipeline] Step 3 done. Task ID:', runwayRes.data.id);

      // ── Step 4: Poll Runway task until done ───────────────────────────────────
      const videoUrl = await this._pollRunwayTask(taskId);

      // Optionally save creative to DB (non-blocking)
      if (tenantId) {
        pool.query(
          `INSERT INTO ad_creatives (tenant_id, name, type, asset_url, thumbnail_url, generated_by_ai)
           VALUES ($1, $2, 'video', $3, $4, true)`,
          [tenantId, `AI Video - ${brandName}`, videoUrl, imageUrl]
        ).catch((e) => console.warn('[VideoPipeline] Creative save skipped:', e.message));
      }

      return { videoUrl, imageUrl, headline: prompts.headline };
    } catch (err) {
      const errMsg = err.response?.data?.error || err.response?.data?.message || err.message;
      console.error('[VideoPipeline] Pipeline failed:', errMsg);
      throw new Error(errMsg);
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
