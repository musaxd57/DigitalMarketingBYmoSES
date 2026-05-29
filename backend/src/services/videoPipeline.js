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
      throw new Error('RUNWAY_API_KEY is not configured.');
    }

    try {
      const aspectRatio = platform === 'youtube' ? '16:9' : '9:16';
      const runwayRatio = aspectRatio === '9:16' ? '720:1280' : '1280:720';
      const dalleSize = aspectRatio === '9:16' ? '1024x1792' : '1792x1024';
      const videoDuration = [5, 10].includes(duration) ? duration : 5;

      const styleGuide = {
        ugc: {
          visual: 'authentic lifestyle photography, natural window light, real environment, candid feel, shallow depth of field, shot on iPhone pro',
          motion: 'handheld subtle camera shake, slow drift push-in, natural organic movement',
          negative: 'studio, artificial, staged, stock photo look',
        },
        testimonial: {
          visual: 'clean portrait photography, soft diffused backlight, professional bokeh background, warm color grade, interview style',
          motion: 'slow gentle zoom-in, slight rack focus, breathing camera movement',
          negative: 'chaotic, dark, low quality, blurry',
        },
        educational: {
          visual: 'bright clean modern product shot, white or gradient background, crisp sharp focus, flat lay or 3/4 angle, professional lighting',
          motion: 'smooth slow orbit around product, gentle elevation change, reveal motion',
          negative: 'dark, cluttered, noisy, people',
        },
        entertainment: {
          visual: 'vibrant high-contrast commercial photography, dynamic angle, trendy aesthetic, Gen-Z color palette, bold composition',
          motion: 'dynamic fast push-in, energetic camera movement, parallax effect',
          negative: 'boring, static, dull, corporate',
        },
        product_demo: {
          visual: 'premium luxury product photography, dramatic studio lighting, dark or gradient background, sharp focus, specular highlights, Apple-style minimalism, hyperrealistic',
          motion: 'ultra-slow cinematic dolly push, dramatic reveal from shadow, 3D rotation effect',
          negative: 'cheap, cluttered, busy background, amateur',
        },
      };

      const style = styleGuide[videoStyle] || styleGuide.ugc;
      const platformContext = platform === 'tiktok' ? 'vertical TikTok ad, Gen-Z audience'
        : platform === 'instagram' ? 'Instagram Reels ad, lifestyle audience'
        : platform === 'youtube' ? 'YouTube pre-roll ad, wide audience'
        : 'social media video ad';

      // ── Step 1: GPT-4o Premium Prompt Generation ─────────────────────────────
      console.log('[VideoPipeline] Step 1: GPT-4o premium prompt generation...');

      let prompts = {
        imagePrompt: `${productDescription} product, ${style.visual}, professional commercial photography, 8K resolution`,
        motionPrompt: style.motion,
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
                content: `You are a senior creative director at a top-tier advertising agency (think Wieden+Kennedy, BBDO). You craft world-class video ad prompts for AI generation tools. You write all image and motion prompts in ENGLISH regardless of input language. Your prompts are specific, vivid, and technically precise.`,
              },
              {
                role: 'user',
                content: `Create premium AI video ad prompts for:
Brand: ${brandName}
Product: ${productDescription}
Platform: ${platformContext}
Visual Style: ${style.visual}
Motion Style: ${style.motion}

Return ONLY valid JSON with these exact keys:
{
  "imagePrompt": "ENGLISH ONLY. Photorealistic DALL-E 3 prompt. Describe: (1) the exact product with precise colors/materials/textures, (2) lighting setup, (3) background/setting, (4) camera angle, (5) mood/atmosphere. Include terms like: 'shot on Phase One camera', 'commercial advertising photography', specific color names, material descriptors. Min 60 words.",
  "motionPrompt": "ENGLISH ONLY. Runway Gen-4 cinematic motion prompt. Describe camera movement precisely: direction, speed, focal shift. Reference film techniques. Max 3 sentences. Example: 'Ultra-smooth slow dolly push-in toward the product, subtle rack focus from background to foreground, gentle lens breathing effect creating a premium cinematic feel.'",
  "negativePrompt": "ENGLISH ONLY. Elements to avoid in the video. List unwanted qualities: blurry, amateur, stock photo, watermark, text overlays, distorted, low quality.",
  "headline": "Punchy ad headline in the language of the product description. Max 6 words. No punctuation."
}`,
              },
            ],
            max_tokens: 600,
            temperature: 0.8,
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
        console.warn('[VideoPipeline] GPT-4o failed, using defaults:', gptErr.message);
      }

      console.log('[VideoPipeline] Step 1 done.');
      console.log('[VideoPipeline] imagePrompt:', prompts.imagePrompt);
      console.log('[VideoPipeline] motionPrompt:', prompts.motionPrompt);

      // ── Step 2: GPT Image 1 (GPT Image 2) Starting Frame ─────────────────────
      console.log('[VideoPipeline] Step 2: GPT Image generation...');
      let promptImage;

      try {
        const enhancedImagePrompt = `${prompts.imagePrompt}. Clean minimal background, isolated product shot, no busy environments, seamless studio backdrop, commercial advertising photography, ultra-high resolution, sharp focus, professional color grading, no text, no watermarks, photorealistic.`;

        const imageRes = await axios.post(
          'https://api.openai.com/v1/images/generations',
          {
            model: 'gpt-image-1',
            prompt: enhancedImagePrompt,
            n: 1,
            size: aspectRatio === '9:16' ? '1024x1536' : '1536x1024',
            quality: 'high',
          },
          {
            headers: { Authorization: `Bearer ${this.openaiKey}`, 'Content-Type': 'application/json' },
            timeout: 120000,
          }
        );

        const b64 = imageRes.data.data[0].b64_json;
        promptImage = `data:image/png;base64,${b64}`;
        console.log('[VideoPipeline] Step 2 done. GPT Image 1 generated.');
      } catch (imgErr) {
        const errMsg = imgErr.response?.data?.error?.message || imgErr.message;
        console.error('[VideoPipeline] Image generation failed:', errMsg);
        throw new Error(`Image generation failed: ${errMsg}`);
      }

      // ── Step 3: Runway Gen-4 Turbo Image-to-Video ────────────────────────────
      console.log('[VideoPipeline] Step 3: Runway Gen-4 Turbo video generation...');
        const enhancedMotionPrompt = `${prompts.motionPrompt} Focus only on the product, do not animate or change the background, keep background static and clean, smooth professional camera movement only, photorealistic, cinematic quality, no artifacts, no flickering, no AI-looking distortions.`;

      let runwayRes;
      try {
        const runwayPayload = {
          model: 'gen4_turbo',
          promptImage,
          promptText: enhancedMotionPrompt,
          duration: videoDuration,
          ratio: runwayRatio,
        };

        const baseNegative = 'AI-looking, CGI, unrealistic, busy background, cluttered environment, distorted, morphing, melting, glitching, artifacts, flickering, watermark, text overlay, multiple products';
        runwayPayload.negativePrompt = prompts.negativePrompt
          ? `${baseNegative}, ${prompts.negativePrompt}`
          : baseNegative;

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
      console.log('[VideoPipeline] Step 3 submitted. Task ID:', runwayRes.data.id);

      // ── Step 4: Poll until complete ───────────────────────────────────────────
      const videoUrl = await this._pollRunwayTask(runwayRes.data.id);
      console.log('[VideoPipeline] Pipeline complete. Video URL:', videoUrl);

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

      let res;
      try {
        res = await axios.get(`${this.runwayBase}/tasks/${taskId}`, {
          headers: {
            Authorization: `Bearer ${this.runwayKey}`,
            'X-Runway-Version': '2024-11-06',
          },
          timeout: 10000,
        });
      } catch (pollErr) {
        console.warn('[VideoPipeline] Poll request failed, retrying:', pollErr.message);
        continue;
      }

      const { status, output, failure, progress } = res.data;
      console.log(`[VideoPipeline] Task ${taskId} status: ${status}${progress ? ` (${Math.round(progress * 100)}%)` : ''}`);

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
