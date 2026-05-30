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
      const videoDuration = [5, 10].includes(duration) ? duration : 5;

      // ── Style guides: rich, style-specific visual and motion language ─────────
      const styleGuide = {
        ugc: {
          visual: 'authentic user-generated content style. Natural window light from the side, warm 5500K color temperature, real home or café environment with lived-in background details. Shallow depth of field f/1.8, shot on iPhone 15 Pro, slight lens distortion, subtle film grain. The scene feels honest, unscripted and candid — like a friend genuinely recommending the product.',
          imageEnhancement: 'authentic real-life environment with natural details, warm side window light, relatable lived-in setting, honest unstaged composition, no studio or artificial lighting setup',
          motion: 'Subtle organic handheld micro-movements with gentle natural drift toward the product, a slow breathing rhythm in the camera as if held by a person leaning in with genuine curiosity. The camera moves like a human hand discovering something interesting — not a machine on a track.',
          motionEnhancement: 'Keep the organic handheld soul — let the camera breathe naturally. Avoid any tripod-perfect mechanical movement. The imperfection is the authenticity.',
          negative: 'studio lighting, tripod-perfect framing, artificial backdrop, stock photo aesthetic, overly perfect composition, commercial stiffness, posed or staged appearance, sterile environment',
        },
        testimonial: {
          visual: 'clean interview-style portrait photography. Soft large-source backlight creating professional rim separation and depth. Professional bokeh background at f/2.8 with warm amber-gold color grade. Documentary-feel framing with proper headroom, interview-standard three-point lighting setup. The image commands trust and credibility.',
          imageEnhancement: 'clean neutral background with warm depth, professional soft backlight rim separation, interview-standard portrait framing, premium documentary photography',
          motion: 'Slow deliberate zoom-in beginning wide and gently closing to a medium-close frame, a subtle rack focus shifting from background bokeh to sharp subject/product focus at the mid-point. The movement is calm, measured and authoritative — like a documentary filmmaker who knows exactly what they are doing.',
          motionEnhancement: 'Slow and composed movement only. Every frame should feel trustworthy and authoritative. No fast or jarring motion.',
          negative: 'chaotic or fast movement, harsh unflattering shadows, cold blue tones, low quality or blurry focus, shaky amateur footage, dark or underexposed',
        },
        educational: {
          visual: 'crisp clean product demonstration photography. Bright even professional lighting with large soft boxes, pure white or light neutral gradient background, sharp 100% focus throughout. Flat lay or precise 45-degree hero angle showing every product feature and detail with absolute clarity. Every element of the product is legible and inviting.',
          imageEnhancement: 'white or soft neutral gradient background, bright even shadowless studio lighting, every product detail perfectly sharp and visible, clean infographic-ready composition',
          motion: 'Smooth mechanical 360-degree orbit around the product at constant height, beginning from the front angle and rotating clockwise at a pace slow enough to appreciate every surface detail. Camera height holds perfectly level throughout — precision machine movement that reveals the product with systematic elegance.',
          motionEnhancement: 'Smooth mechanical precision only. Product must remain perfectly sharp throughout the entire motion. The orbit should feel like premium product visualization — thorough and confident.',
          negative: 'dark or moody atmosphere, busy distracting backgrounds, people, faces, motion blur, any element that obscures product details',
        },
        entertainment: {
          visual: 'vibrant high-energy commercial photography. Neon or bold saturated colors with punchy high-contrast color grading. Dynamic Dutch-tilt or low-angle composition with Gen-Z aesthetic graphic energy. Bold visual tension, immediate eye contact with the product. The image should make someone stop scrolling instantly.',
          imageEnhancement: 'bold vibrant saturated color palette, dramatic high-contrast composition, Gen-Z aesthetic energy, eye-catching and attention-demanding atmosphere',
          motion: 'High-energy fast push-in that builds momentum from a wide shot toward the product with increasing speed, reaches a dramatic hold at the peak reveal moment, then a confident slight pullback settle. The movement arc feels like a burst of electricity — fast approach, striking pause, assured resolution.',
          motionEnhancement: 'High energy, punchy and decisive movement. Build momentum dramatically. The camera should feel like it has personality and attitude.',
          negative: 'boring or static composition, muted or desaturated colors, corporate stiffness, slow or sleepy pacing, flat uninspiring visual energy',
        },
        product_demo: {
          visual: 'ultra-premium luxury product photography. Dramatic single-source key light carving deep controlled shadows that reveal material textures and craftsmanship. Rich dark charcoal or deep gradient background. Specular highlights catching the product surface precisely. Apple campaign or Louis Vuitton editorial aesthetic. Shot on Hasselblad medium format. Absolute hyperrealism — every texture, every material, every surface reflection rendered with surgical precision.',
          imageEnhancement: 'premium dark or deep gradient studio background, dramatic single-source sculptural lighting with precise shadow control, luxury brand visual language, surface textures and materials rendered with perfect fidelity',
          motion: 'Ultra-cinematic slow-motion dolly push-in beginning in near-darkness and gliding forward as the light gradually reveals the product in full — the camera approaches as if magnetically drawn, at a pace so slow it creates palpable tension. An almost imperceptible rack focus shift from the leading edge to the deepest detail at the exact moment the product is fully revealed. Every second should feel like it costs a million dollars.',
          motionEnhancement: 'Ultra-slow luxury movement. Restraint is the point. Less is infinitely more. Every single frame should feel like a still from a $2M commercial.',
          negative: 'cheap or budget aesthetic, cluttered or distracting backgrounds, amateur lighting, fast or jerky movement, anything that compromises the premium luxury impression',
        },
      };

      const style = styleGuide[videoStyle] || styleGuide.ugc;

      const platformContext = {
        tiktok: 'vertical 9:16 TikTok video ad targeting a mobile-first Gen-Z and millennial audience. The first 2 seconds are the entire battle — hook must be immediate and visceral. Authentic, fast, native to the platform. No text overlays needed.',
        instagram: 'vertical 9:16 Instagram Reels ad. Aesthetic-first, aspirational, must look native to a curated Instagram feed. Visual quality and mood are paramount. Clean, pleasing and shareable.',
        facebook: 'vertical or square Facebook video ad. Broader 25-55 demographic. Clear, trustworthy, value-driven. Must communicate the offer even without sound. Professional and credible.',
        youtube: '16:9 YouTube pre-roll ad. The viewer can skip after 5 seconds — the opening must be undeniable. High production value signals brand credibility. Clear brand identity and strong hook.',
      };
      const platformCtx = platformContext[platform] || platformContext.tiktok;

      // ── Step 1: GPT-4o — Premium prompt generation ───────────────────────────
      console.log('[VideoPipeline] Step 1: GPT-4o premium prompt generation...');

      // Rich, style-aware fallback used only if GPT-4o fails
      const fallbackPrompts = {
        imagePrompt: `A professional advertising photograph of ${productDescription} for the brand ${brandName}. ${style.visual} Shot on Phase One camera, commercial advertising photography, ultra-high resolution, no text, no watermarks, no logos. ${style.imageEnhancement}.`,
        motionPrompt: style.motion,
        negativePrompt: style.negative,
        headline: brandName,
      };

      let prompts = { ...fallbackPrompts };

      try {
        const promptRes = await axios.post(
          'https://api.openai.com/v1/chat/completions',
          {
            model: 'gpt-4o',
            messages: [
              {
                role: 'system',
                content: `You are the world's most awarded creative director for performance advertising — Cannes Lions winner, former ECD at Wieden+Kennedy and TBWA\\CHIAT\\DAY, with a decade crafting campaigns for Nike, Apple, Hermès and Samsung. You know exactly what makes someone stop scrolling AND what makes them convert. You understand light, composition, emotion and desire at a technical and artistic level.

You write ALL image and motion prompts in ENGLISH ONLY, regardless of input language. Your prompts are technically precise, cinematically specific, and commercially ruthless. You never write generic descriptions — you write the specific, sensory, evocative detail that separates a $20 prompt from a $20,000 one.`,
              },
              {
                role: 'user',
                content: `Create world-class AI video ad prompts for this brand and product.

BRAND: ${brandName}
PRODUCT: ${productDescription}
PLATFORM: ${platformCtx}
VISUAL STYLE DIRECTION: ${style.visual}
MOTION STYLE DIRECTION: ${style.motion}

Think deeply: What specific details, textures, colors and surfaces make this product visually irresistible? What exact lighting setup makes it desirable? What camera movement creates emotional pull and desire? What single frame would make someone stop scrolling?

Return ONLY valid JSON with exactly these four keys — no extra text, no markdown fences:
{
  "imagePrompt": "ENGLISH ONLY. A surgically precise gpt-image-1 prompt for the perfect starting frame. Include: (1) the product described with exact real-world colors, surface materials, textures and finish as they appear in person — specific, not generic, (2) the complete lighting setup: key light source, size, position, color temperature, fill light details, rim or backlight if present, (3) the exact background environment matching the visual style direction, (4) precise camera angle, lens focal length and depth of field, (5) overall mood, color grade and emotional atmosphere. Write like you are briefing the world's best product photographer with a $50,000 budget. No text overlays, no watermarks, no logos anywhere in the frame. Minimum 90 words.",
  "motionPrompt": "ENGLISH ONLY. A precise Runway Gen-4 Turbo cinematic motion prompt for image-to-video. Describe: the exact starting frame position, the precise direction and speed of camera movement, any depth-of-field shifts during motion, and the ending frame position. Use specific cinematography vocabulary. Maximum 3 sentences. Must feel like direction from a DOP on a premium commercial set. Example: 'Beginning from 1.5 meters — a slow ultra-smooth dolly push-in glides toward the product, closing to 25cm over 8 seconds with imperceptible deceleration. At the 4-second mark a subtle rack focus draws the sharp plane from background detail to the product surface edge. The camera movement stops with the product filling 80% of frame, a gentle lens breath completing the approach.'",
  "negativePrompt": "ENGLISH ONLY. Specific visual elements to explicitly avoid that would ruin this particular ad. Make it specific to this product and style — not a generic list.",
  "headline": "A short punchy headline written in the SAME LANGUAGE as the product description text above. Maximum 6 words. No punctuation. Should make a person stop scrolling immediately."
}`,
              },
            ],
            max_tokens: 800,
            temperature: 0.75,
          },
          {
            headers: { Authorization: `Bearer ${this.openaiKey}`, 'Content-Type': 'application/json' },
            timeout: 35000,
          }
        );

        const raw = promptRes.data.choices[0].message.content.trim();
        const jsonStr = raw.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
        const parsed = JSON.parse(jsonStr);
        prompts = { ...fallbackPrompts, ...parsed };
        console.log('[VideoPipeline] Step 1 done. GPT-4o prompts generated.');
      } catch (gptErr) {
        console.warn('[VideoPipeline] GPT-4o failed, using rich fallback prompts:', gptErr.message);
      }

      console.log('[VideoPipeline] imagePrompt:', prompts.imagePrompt?.substring(0, 120) + '...');
      console.log('[VideoPipeline] motionPrompt:', prompts.motionPrompt?.substring(0, 120) + '...');

      // ── Step 2: gpt-image-1 — Starting frame generation ──────────────────────
      console.log('[VideoPipeline] Step 2: gpt-image-1 starting frame generation...');
      let promptImage;

      try {
        // Style-aware image enhancement — avoids the studio suffix on lifestyle styles
        const styleImageSuffix = style.imageEnhancement;
        const finalImagePrompt = `${prompts.imagePrompt} ${styleImageSuffix}. Ultra-high resolution, perfect sharp focus, professional commercial photography color grading. Absolutely no text, no watermarks, no logos, no typography of any kind anywhere in the image.`;

        const imageRes = await axios.post(
          'https://api.openai.com/v1/images/generations',
          {
            model: 'gpt-image-1',
            prompt: finalImagePrompt,
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
        console.log('[VideoPipeline] Step 2 done. Starting frame generated.');
      } catch (imgErr) {
        const errMsg = imgErr.response?.data?.error?.message || imgErr.message;
        console.error('[VideoPipeline] Image generation failed:', errMsg);
        throw new Error(`Image generation failed: ${errMsg}`);
      }

      // ── Step 3: Runway Gen-4 Turbo — Image-to-Video ──────────────────────────
      console.log('[VideoPipeline] Step 3: Runway Gen-4 Turbo video generation...');

      // Style-aware motion enhancement
      const finalMotionPrompt = `${prompts.motionPrompt} ${style.motionEnhancement} Photorealistic, cinematic quality. No artifacts, no flickering, no AI distortions. No text or graphics appear on screen at any point.`;

      // Comprehensive base negative prompt + style-specific + GPT-generated
      const baseNegative = 'blurry, out of focus, low resolution, compressed video artifacts, AI morphing distortions, melting geometry, flickering, ghosting, glitching, watermark, text overlay, subtitle, caption, logo, multiple products, wrong product, jump cut, scene change, abrupt transition, amateur look, overexposed blown-out highlights, underexposed muddy shadows';
      const finalNegative = prompts.negativePrompt
        ? `${baseNegative}, ${style.negative}, ${prompts.negativePrompt}`
        : `${baseNegative}, ${style.negative}`;

      let runwayRes;
      try {
        runwayRes = await axios.post(
          `${this.runwayBase}/image_to_video`,
          {
            model: 'gen4_turbo',
            promptImage,
            promptText: finalMotionPrompt,
            negativePrompt: finalNegative,
            duration: videoDuration,
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
      console.log(`[VideoPipeline] Task ${taskId}: ${status}${progress ? ` (${Math.round(progress * 100)}%)` : ''}`);

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
