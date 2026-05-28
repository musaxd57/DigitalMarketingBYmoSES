const axios = require('axios');
const config = require('../config');
const { pool } = require('../models/db');

class VideoPipeline {
  constructor() {
    this.openaiKey = config.openai.apiKey;
    this.runwayKey = config.runway.apiKey;
    this.runwayBase = config.runway.baseUrl || 'https://api.dev.runwayml.com/v1';
  }

  async runPipeline(brief) {
    const { brandName, productDescription, videoStyle, platform, duration, tenantId } = brief;

    if (!this.runwayKey) {
      throw new Error('RUNWAY_API_KEY is not configured. Please add it to your environment variables.');
    }

    try {
      // ── Step 1: Generate prompts via GPT-4o ───────────────────────────────────
      const aspectRatio = (platform === 'youtube') ? '16:9' : '9:16';
      const styleMap = {
        ugc: 'authentic user-generated content, natural daylight, handheld camera, real person feel',
        testimonial: 'clean talking-head interview, soft bokeh background, warm professional lighting',
        educational: 'bright clean modern aesthetic, crisp text overlays, informative and engaging',
        entertainment: 'dynamic fast cuts, vibrant saturated colors, trendy Gen-Z social aesthetic',
        product_demo: 'premium product showcase, studio lighting, dramatic shadows, Apple-style minimalism',
      };
      const styleDesc = styleMap[videoStyle] || styleMap.ugc;

      // DALL-E 3 size must match aspect ratio
      const dalleSize = aspectRatio === '9:16' ? '1024x1792' : '1792x1024';
      const runwayRatio = aspectRatio === '9:16' ? '720:1280' : '1280:720';

      console.log('[VideoPipeline] Step 1: GPT-4o prompt generation...');
      let prompts = {
        imagePrompt: `${brandName} ${productDescription}, professional product photography, ${styleDesc}`,
        motionPrompt: `${styleDesc}, smooth cinematic camera movement, professional ad`,
        headline: brandName,
      };

      try {
        const promptRes = await axios.post(
          'https://api.openai.com/v1/chat/completions',
          {
            model: 'gpt-4o',
            messages: [
              {
                role: 'system',
                content: `You are a world-class advertising creative director. Generate precise, vivid prompts for AI video generation. Always write imagePrompt and motionPrompt in ENGLISH regardless of input language. Respond ONLY with valid JSON, no markdown.`,
              },
              {
                role: 'user',
                content: `Create prompts for a ${platform} video ad.
Brand: ${brandName}
Product: ${productDescription}
Style: ${styleDesc}

Return JSON with exactly these keys:
{
  "imagePrompt": "ENGLISH ONLY - highly detailed DALL-E prompt describing the product visually: exact colors, materials, textures, lighting, setting. Must clearly depict the actual product. Example: 'A beige linen shirt hanging on a wooden hanger, soft natural light, minimal white background, premium quality fabric texture visible'",
  "motionPrompt": "ENGLISH ONLY - Runway ML camera motion: slow push-in, gentle rotation, subtle zoom. Cinematic and smooth. Max 2 sentences.",
  "headline": "Short punchy ad headline in the same language as the product description (max 6 words)"
}`,
              },
            ],
            max_tokens: 400,
            temperature: 0.7,
          },
          {
            headers: { Authorization: `Bearer ${this.openaiKey}`, 'Content-Type': 'application/json' },
            timeout: 30000,
          }
        );
        const raw = promptRes.data.choices[0].message.content.trim();
        const jsonStr = raw.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
        const parsed = JSON.parse(jsonStr);
        prompts = { ...prompts, ...parsed };
      } catch (gptErr) {
        console.warn('[VideoPipeline] GPT prompt generation failed, using defaults:', gptErr.message);
      }
      console.log('[VideoPipeline] Step 1 done. Image prompt:', prompts.imagePrompt);

      // ── Step 2: Generate image with DALL-E 3 HD ───────────────────────────────
      console.log('[VideoPipeline] Step 2: Generating DALL-E 3 HD image...');
      let promptImage;
      try {
        const dalleRes = await axios.post(
          'https://api.openai.com/v1/images/generations',
          {
            model: 'dall-e-3',
            prompt: `${prompts.imagePrompt}. Ultra high quality advertising photograph, sharp focus, professional studio lighting, 8K resolution.`,
            n: 1,
            size: dalleSize,
            quality: 'hd',
          },
          {
            headers: { Authorization: `Bearer ${this.openaiKey}`, 'Content-Type': 'application/json' },
            timeout: 90000,
          }
        );
        promptImage = dalleRes.data.data[0].url;
        console.log('[VideoPipeline] Step 2 done. DALL-E HD image obtained.');
      } catch (dalleErr) {
        console.warn('[VideoPipeline] DALL-E failed, using placeholder:', dalleErr.response?.data?.error?.message || dalleErr.message);
        const seed = Math.floor(Math.random() * 1000);
        const [pw, ph] = dalleSize.split('x').map(Number);
        const imgRes = await axios.get(
          `https://picsum.photos/seed/${seed}/${pw}/${ph}`,
          { responseType: 'arraybuffer', timeout: 15000 }
        );
        promptImage = `data:image/jpeg;base64,${Buffer.from(imgRes.data).toString('base64')}`;
      }

      // ── Step 3: Runway ML Gen-3 Alpha image-to-video ─────────────────────────
      console.log('[VideoPipeline] Step 3: Sending to Runway ML Gen-3 Alpha...');
      let runwayRes;
      try {
        runwayRes = await axios.post(
          `${this.runwayBase}/image_to_video`,
          {
            model: 'gen4_turbo',
            promptImage,
            promptText: `${prompts.motionPrompt}. Photorealistic, cinematic quality, smooth motion, professional advertisement.`,
            duration: [5, 10].includes(duration) ? duration : 5,
            ratio: runwayRatio,
          },
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
      const videoUrl = await this._pollRunwayTask(runwayRes.data.id);

      if (tenantId) {
        pool.query(
          `INSERT INTO ad_creatives (tenant_id, name, type, asset_url, thumbnail_url, generated_by_ai)
           VALUES ($1, $2, 'video', $3, $4, true)`,
          [tenantId, `AI Video - ${brandName}`, videoUrl, null]
        ).catch((e) => console.warn('[VideoPipeline] Creative save skipped:', e.message));
      }

      return { videoUrl, imageUrl: promptImage, headline: prompts.headline };
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
