const axios = require('axios');
const config = require('../config');

/**
 * Creative Scorer - AI-powered scoring of ad creatives
 * Analyzes hook strength, retention potential, CTA effectiveness, and emotional resonance
 */
class CreativeScorer {
  constructor() {
    this.model = config.openai.model;
    this.apiKey = config.openai.apiKey;
  }

  /**
   * Score a creative using GPT-4 analysis
   * @param {Object} creative - Creative record from database
   * @returns {Object} Scores and reasoning
   */
  async scoreCreative(creative) {
    const prompt = this._buildScoringPrompt(creative);

    const response = await axios.post(
      'https://api.openai.com/v1/chat/completions',
      {
        model: this.model,
        messages: [
          {
            role: 'system',
            content: `You are a world-class digital advertising creative analyst with deep expertise in:
- Direct response advertising psychology
- Video hook analysis and retention optimization
- Conversion rate optimization
- Emotional targeting and persuasion frameworks
- Platform-specific creative best practices (Meta, TikTok, Google)

You score ad creatives on a 0-100 scale across five dimensions.
Always return valid JSON.`,
          },
          {
            role: 'user',
            content: prompt,
          },
        ],
        max_tokens: 1500,
        temperature: 0.2,
        response_format: { type: 'json_object' },
      },
      {
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
        timeout: 30000,
      }
    );

    const content = JSON.parse(response.data.choices[0].message.content);
    return this._parseScores(content);
  }

  /**
   * Score multiple creatives in a single API call (more efficient)
   */
  async scoreBatch(creatives) {
    const results = [];
    // Process in parallel with rate limiting (max 3 concurrent)
    const chunkSize = 3;
    for (let i = 0; i < creatives.length; i += chunkSize) {
      const chunk = creatives.slice(i, i + chunkSize);
      const scores = await Promise.all(chunk.map((c) => this.scoreCreative(c).catch((err) => ({
        error: err.message,
        overallScore: 0,
        hookScore: 0,
        retentionScore: 0,
        ctaScore: 0,
        emotionalScore: 0,
      }))));
      results.push(...scores);
    }
    return results;
  }

  /**
   * Build the scoring prompt from creative data
   */
  _buildScoringPrompt(creative) {
    const parts = ['Score this advertising creative across five dimensions (0-100 each).\n'];

    if (creative.type) parts.push(`Ad Type: ${creative.type}`);
    if (creative.format) parts.push(`Format: ${creative.format}`);
    if (creative.headline) parts.push(`Headline: "${creative.headline}"`);
    if (creative.primary_text) parts.push(`Primary Text: "${creative.primary_text}"`);
    if (creative.description) parts.push(`Description: "${creative.description}"`);
    if (creative.call_to_action) parts.push(`Call to Action: "${creative.call_to_action}"`);
    if (creative.generation_prompt) parts.push(`Creative Brief: "${creative.generation_prompt}"`);

    // Include performance data if available for calibration
    if (creative.avg_ctr && parseFloat(creative.avg_ctr) > 0) {
      parts.push(`\nHistorical Performance:`);
      parts.push(`- CTR: ${(parseFloat(creative.avg_ctr) * 100).toFixed(2)}%`);
      if (creative.avg_roas) parts.push(`- ROAS: ${parseFloat(creative.avg_roas).toFixed(2)}x`);
      if (creative.total_impressions) parts.push(`- Total Impressions: ${creative.total_impressions}`);
    }

    parts.push(`
Return a JSON object with this exact structure:
{
  "hookScore": <0-100>,
  "retentionScore": <0-100>,
  "ctaScore": <0-100>,
  "emotionalScore": <0-100>,
  "overallScore": <0-100 weighted average>,
  "breakdown": {
    "hook": {
      "score": <0-100>,
      "strengths": ["..."],
      "weaknesses": ["..."],
      "improvements": ["..."]
    },
    "retention": {
      "score": <0-100>,
      "strengths": ["..."],
      "weaknesses": ["..."],
      "improvements": ["..."]
    },
    "cta": {
      "score": <0-100>,
      "strengths": ["..."],
      "weaknesses": ["..."],
      "improvements": ["..."]
    },
    "emotional": {
      "score": <0-100>,
      "primaryEmotion": "...",
      "strengths": ["..."],
      "weaknesses": ["..."],
      "improvements": ["..."]
    }
  },
  "reasoning": "2-3 sentence overall assessment",
  "topRecommendation": "Single most impactful change",
  "predictedPerformance": "high|medium|low",
  "platformFit": {
    "meta": <0-100>,
    "tiktok": <0-100>,
    "google": <0-100>
  }
}`);

    return parts.join('\n');
  }

  /**
   * Parse and validate AI response into standardized score object
   */
  _parseScores(content) {
    const hookScore = this._clamp(parseFloat(content.hookScore || content.hook_score || 50));
    const retentionScore = this._clamp(parseFloat(content.retentionScore || content.retention_score || 50));
    const ctaScore = this._clamp(parseFloat(content.ctaScore || content.cta_score || 50));
    const emotionalScore = this._clamp(parseFloat(content.emotionalScore || content.emotional_score || 50));

    // Weighted overall: hook 35%, retention 25%, cta 25%, emotional 15%
    const weightedScore = (
      hookScore * 0.35 +
      retentionScore * 0.25 +
      ctaScore * 0.25 +
      emotionalScore * 0.15
    );

    const overallScore = this._clamp(
      parseFloat(content.overallScore || content.overall_score || weightedScore)
    );

    return {
      hookScore,
      retentionScore,
      ctaScore,
      emotionalScore,
      overallScore,
      breakdown: content.breakdown || {},
      reasoning: content.reasoning || '',
      topRecommendation: content.topRecommendation || '',
      predictedPerformance: content.predictedPerformance || 'medium',
      platformFit: content.platformFit || {},
    };
  }

  _clamp(value, min = 0, max = 100) {
    if (isNaN(value)) return 50;
    return Math.min(max, Math.max(min, value));
  }

  /**
   * Get scoring criteria explanation
   */
  static getScoringCriteria() {
    return {
      hookScore: {
        name: 'Hook Score',
        description: 'First impression effectiveness - how well the creative captures attention in the first 3 seconds',
        weight: 0.35,
        factors: [
          'Pattern interrupt effectiveness',
          'Curiosity gap creation',
          'Visual/textual shock value',
          'Relevance to target audience',
          'Platform-native hook style',
        ],
      },
      retentionScore: {
        name: 'Retention Score',
        description: 'Ability to maintain viewer/reader engagement throughout the creative',
        weight: 0.25,
        factors: [
          'Narrative flow and story arc',
          'Information pacing',
          'Visual variety (video) or scan-ability (static)',
          'Open loop / curiosity maintenance',
          'Value delivery progression',
        ],
      },
      ctaScore: {
        name: 'CTA Score',
        description: 'Call-to-action clarity, urgency, and conversion potential',
        weight: 0.25,
        factors: [
          'CTA clarity and specificity',
          'Urgency and scarcity elements',
          'Value proposition alignment',
          'Friction reduction',
          'Benefit-focused vs action-focused balance',
        ],
      },
      emotionalScore: {
        name: 'Emotional Score',
        description: 'Emotional resonance and psychological trigger effectiveness',
        weight: 0.15,
        factors: [
          'Primary emotion triggered (fear, desire, hope, anger, joy)',
          'Social proof and FOMO elements',
          'Identity and self-image appeals',
          'Pain point acknowledgment',
          'Aspirational positioning',
        ],
      },
    };
  }
}

module.exports = CreativeScorer;
