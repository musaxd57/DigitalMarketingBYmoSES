const axios = require('axios');
const config = require('../config');
const { pool } = require('../models/db');

/**
 * Video Production Pipeline
 * Orchestrates the n8n workflow for AI video generation:
 * Brief -> OpenAI Script -> PiAPI Flux images -> PiAPI Kling video -> ElevenLabs VO -> Creatomate render
 */
class VideoPipeline {
  constructor() {
    this.n8nWebhookUrl = config.n8n.videoPipelineWebhook || `${config.n8n.webhookUrl}/webhook/video-pipeline`;
    this.n8nApiKey = config.n8n.apiKey;
    this.callbackBaseUrl = config.cors.origin.replace(':3000', ':3001');
  }

  /**
   * Trigger the video generation n8n workflow
   * @param {Object} brief - Video production brief
   * @returns {Object} Job info with generationId
   */
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

    // Create generation record
    const genRes = await pool.query(
      `INSERT INTO ai_generations
         (tenant_id, user_id, type, status, input_data, model_used, job_started_at)
       VALUES ($1, $2, 'video', 'processing', $3, 'n8n-pipeline', NOW())
       RETURNING id`,
      [
        tenantId,
        userId,
        JSON.stringify({ brandName, productDescription, targetAudience, videoStyle, duration, platform, scriptDirection }),
      ]
    );
    const generationId = genRes.rows[0].id;

    try {
      // Build the webhook payload for n8n
      const payload = {
        generationId,
        tenantId,
        brand: {
          name: brandName,
          productDescription,
          targetAudience: targetAudience || 'general consumers aged 18-45',
        },
        video: {
          style: videoStyle || 'ugc',
          duration: duration || 30,
          platform: platform || 'tiktok',
          aspectRatio: this._getAspectRatio(platform),
          resolution: this._getResolution(platform),
        },
        script: {
          direction: scriptDirection || null,
          tone: this._getToneForStyle(videoStyle),
          includeHook: true,
          includeCTA: true,
        },
        production: {
          generateImages: true,
          generateVoiceover: true,
          finalRender: true,
          publishTargets: [],
        },
        callbacks: {
          statusUrl: `${this.callbackBaseUrl}/api/ai/webhook/video-status`,
          completionUrl: `${this.callbackBaseUrl}/api/ai/webhook/video-complete`,
        },
      };

      // Fire n8n webhook (non-blocking)
      const n8nRes = await axios.post(this.n8nWebhookUrl, payload, {
        headers: {
          'Content-Type': 'application/json',
          ...(this.n8nApiKey ? { 'X-N8N-API-KEY': this.n8nApiKey } : {}),
        },
        timeout: 10000,
      });

      const executionId = n8nRes.data?.executionId || n8nRes.data?.id || 'triggered';

      await pool.query(
        `UPDATE ai_generations
         SET n8n_execution_id = $1, updated_at = NOW()
         WHERE id = $2`,
        [executionId, generationId]
      );

      return { generationId, executionId, status: 'processing' };
    } catch (err) {
      console.error('[VideoPipeline] Trigger error:', err.response?.data || err.message);

      // If n8n is unavailable, still keep the record but mark the error
      await pool.query(
        `UPDATE ai_generations
         SET status = 'failed',
             error_message = $1,
             updated_at = NOW()
         WHERE id = $2`,
        [`n8n webhook error: ${err.message}`, generationId]
      );

      throw new Error(`Video pipeline trigger failed: ${err.message}`);
    }
  }

  /**
   * Poll n8n execution status
   */
  async checkJobStatus(generationId, tenantId) {
    const genRes = await pool.query(
      `SELECT id, status, n8n_execution_id, output_data, asset_url, error_message,
              job_started_at, job_completed_at
       FROM ai_generations
       WHERE id = $1 AND tenant_id = $2 AND type = 'video'`,
      [generationId, tenantId]
    );

    if (genRes.rows.length === 0) {
      throw new Error('Generation job not found');
    }

    const gen = genRes.rows[0];

    // If we have an n8n execution ID, check its status
    if (gen.n8n_execution_id && gen.status === 'processing' && this.n8nApiKey) {
      try {
        const execRes = await axios.get(
          `${config.n8n.webhookUrl}/api/v1/executions/${gen.n8n_execution_id}`,
          {
            headers: { 'X-N8N-API-KEY': this.n8nApiKey },
            timeout: 5000,
          }
        );

        const execStatus = execRes.data?.status;

        if (execStatus === 'success') {
          const outputData = execRes.data?.data?.resultData?.runData || {};
          const videoUrl = this._extractVideoUrl(outputData);

          await pool.query(
            `UPDATE ai_generations
             SET status = 'completed',
                 output_data = $1,
                 asset_url = $2,
                 job_completed_at = NOW(),
                 updated_at = NOW()
             WHERE id = $3`,
            [JSON.stringify(outputData), videoUrl, generationId]
          );

          return { ...gen, status: 'completed', assetUrl: videoUrl };
        } else if (execStatus === 'error') {
          await pool.query(
            `UPDATE ai_generations
             SET status = 'failed',
                 error_message = 'n8n workflow execution failed',
                 updated_at = NOW()
             WHERE id = $1`,
            [generationId]
          );
          return { ...gen, status: 'failed' };
        }
      } catch (pollErr) {
        console.warn('[VideoPipeline] Status poll failed:', pollErr.message);
      }
    }

    return gen;
  }

  /**
   * Handle webhook callback from n8n when video is complete
   */
  async handleCompletionCallback(payload) {
    const { generationId, status, videoUrl, thumbnailUrl, error, metadata } = payload;

    if (!generationId) {
      throw new Error('generationId required in callback payload');
    }

    if (status === 'completed' && videoUrl) {
      await pool.query(
        `UPDATE ai_generations
         SET status = 'completed',
             asset_url = $1,
             output_data = $2,
             job_completed_at = NOW(),
             updated_at = NOW()
         WHERE id = $3`,
        [videoUrl, JSON.stringify({ videoUrl, thumbnailUrl, ...metadata }), generationId]
      );

      // Create a creative record for the generated video
      const gen = await pool.query(
        'SELECT tenant_id, input_data FROM ai_generations WHERE id = $1',
        [generationId]
      );
      if (gen.rows.length > 0) {
        const inputData = gen.rows[0].input_data;
        await pool.query(
          `INSERT INTO ad_creatives
             (tenant_id, name, type, asset_url, thumbnail_url, generated_by_ai, ai_generation_id)
           VALUES ($1, $2, 'video', $3, $4, true, $5)`,
          [
            gen.rows[0].tenant_id,
            `AI Video - ${inputData?.brandName || 'Generated'} - ${new Date().toLocaleDateString()}`,
            videoUrl,
            thumbnailUrl || null,
            generationId,
          ]
        );
      }
    } else {
      await pool.query(
        `UPDATE ai_generations
         SET status = 'failed',
             error_message = $1,
             updated_at = NOW()
         WHERE id = $2`,
        [error || 'Video generation failed', generationId]
      );
    }
  }

  _getAspectRatio(platform) {
    const ratios = { tiktok: '9:16', instagram: '9:16', facebook: '4:5', youtube: '16:9' };
    return ratios[platform] || '9:16';
  }

  _getResolution(platform) {
    return platform === 'youtube' ? '1920x1080' : '1080x1920';
  }

  _getToneForStyle(style) {
    const tones = {
      ugc: 'authentic and conversational',
      testimonial: 'genuine and personal',
      educational: 'informative and clear',
      entertainment: 'funny and engaging',
      product_demo: 'enthusiastic and feature-focused',
    };
    return tones[style] || 'engaging and persuasive';
  }

  _extractVideoUrl(runData) {
    // Navigate n8n execution data structure to find video URL
    for (const nodeName of Object.keys(runData)) {
      const nodeData = runData[nodeName];
      if (Array.isArray(nodeData)) {
        for (const batch of nodeData) {
          if (Array.isArray(batch)) {
            for (const item of batch) {
              const url = item?.json?.video_url || item?.json?.url || item?.json?.asset_url;
              if (url) return url;
            }
          }
        }
      }
    }
    return null;
  }
}

module.exports = VideoPipeline;
