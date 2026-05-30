const axios = require('axios');
const crypto = require('crypto');
const config = require('../config');
const { pool } = require('../models/db');

const ALGORITHM = 'aes-256-gcm';
const ENCRYPTION_KEY = Buffer.from(
  config.encryption.key.padEnd(32, '0').substring(0, 32)
);

function decryptToken(ciphertext) {
  const [ivHex, authTagHex, encrypted] = ciphertext.split(':');
  const iv = Buffer.from(ivHex, 'hex');
  const authTag = Buffer.from(authTagHex, 'hex');
  const decipher = crypto.createDecipheriv(ALGORITHM, ENCRYPTION_KEY, iv);
  decipher.setAuthTag(authTag);
  let decrypted = decipher.update(encrypted, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}

class MetaAdsService {
  constructor(adAccount) {
    this.account = adAccount;
    this.accessToken = decryptToken(adAccount.encrypted_access_token);
    this.accountId = adAccount.account_id;
    this.apiVersion = config.meta.apiVersion;
    this.baseUrl = `https://graph.facebook.com/${this.apiVersion}`;
  }

  /**
   * Make authenticated request to Meta Graph API
   */
  async request(endpoint, params = {}) {
    try {
      const response = await axios.get(`${this.baseUrl}${endpoint}`, {
        params: {
          access_token: this.accessToken,
          ...params,
        },
        timeout: 30000,
      });
      return response.data;
    } catch (err) {
      const errData = err.response?.data?.error;
      if (errData?.code === 190) {
        // Token expired - attempt refresh
        const refreshed = await this.refreshToken();
        if (refreshed) {
          const retryRes = await axios.get(`${this.baseUrl}${endpoint}`, {
            params: { access_token: this.accessToken, ...params },
            timeout: 30000,
          });
          return retryRes.data;
        }
      }
      throw new Error(`Meta API error: ${errData?.message || err.message}`);
    }
  }

  /**
   * Refresh Meta long-lived token
   */
  async refreshToken() {
    try {
      const res = await axios.get(
        `${this.baseUrl}/oauth/access_token`,
        {
          params: {
            grant_type: 'fb_exchange_token',
            client_id: config.meta.appId,
            client_secret: config.meta.appSecret,
            fb_exchange_token: this.accessToken,
          },
        }
      );

      const newToken = res.data.access_token;
      const expiresIn = res.data.expires_in || 5184000;

      // Encrypt and store new token
      const iv = crypto.randomBytes(16);
      const cipher = crypto.createCipheriv(ALGORITHM, ENCRYPTION_KEY, iv);
      let encrypted = cipher.update(newToken, 'utf8', 'hex');
      encrypted += cipher.final('hex');
      const authTag = cipher.getAuthTag();
      const encryptedToken = `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted}`;

      await pool.query(
        `UPDATE ad_accounts
         SET encrypted_access_token = $1,
             token_expires_at = $2,
             updated_at = NOW()
         WHERE id = $3`,
        [encryptedToken, new Date(Date.now() + expiresIn * 1000), this.account.id]
      );

      this.accessToken = newToken;
      return true;
    } catch (err) {
      console.error('[MetaAds] Token refresh failed:', err.message);
      return false;
    }
  }

  /**
   * Fetch all campaigns for the ad account
   */
  async fetchCampaigns() {
    const fields = 'id,name,status,objective,daily_budget,lifetime_budget,start_time,stop_time,budget_remaining,buying_type';
    const data = [];
    let url = `/act_${this.accountId}/campaigns`;
    let after = null;

    do {
      const params = { fields, limit: 100 };
      if (after) params.after = after;

      const res = await this.request(url, params);
      data.push(...(res.data || []));
      after = res.paging?.cursors?.after;
    } while (after);

    return data.map((campaign) => ({
      id: campaign.id,
      name: campaign.name,
      status: campaign.status.toLowerCase(),
      objective: campaign.objective,
      daily_budget: campaign.daily_budget ? parseInt(campaign.daily_budget) / 100 : null,
      lifetime_budget: campaign.lifetime_budget ? parseInt(campaign.lifetime_budget) / 100 : null,
      start_time: campaign.start_time,
      stop_time: campaign.stop_time,
      budget_remaining: campaign.budget_remaining ? parseInt(campaign.budget_remaining) / 100 : null,
      buying_type: campaign.buying_type,
    }));
  }

  /**
   * Fetch campaign insights/analytics
   * @param {string} campaignId - Meta campaign ID
   * @param {string} datePreset - 'last_30d', 'last_7d', 'last_90d', etc.
   * @param {string} timeIncrement - 1 (daily), 7 (weekly), 30 (monthly)
   */
  async fetchInsights(campaignId, datePreset = 'last_30d', timeIncrement = 1) {
    const fields = [
      'date_start', 'date_stop',
      'impressions', 'clicks', 'spend',
      'actions', 'action_values',
      'reach', 'frequency',
      'ctr', 'cpc', 'cpm',
      'video_play_curve_actions',
      'video_30_sec_watched_actions',
      'video_p100_watched_actions',
    ].join(',');

    const data = [];
    let after = null;

    do {
      const params = {
        fields,
        date_preset: datePreset,
        time_increment: timeIncrement,
        limit: 100,
      };
      if (after) params.after = after;

      const res = await this.request(`/${campaignId}/insights`, params);
      data.push(...(res.data || []));
      after = res.paging?.cursors?.after;
    } while (after);

    return data.map((insight) => this._parseInsight(insight));
  }

  /**
   * Fetch insights for all campaigns in the account
   */
  async fetchAccountInsights(datePreset = 'last_30d') {
    const fields = [
      'campaign_id', 'campaign_name', 'date_start', 'date_stop',
      'impressions', 'clicks', 'spend', 'actions', 'action_values',
      'reach', 'frequency', 'ctr', 'cpc', 'cpm',
    ].join(',');

    const data = [];
    let after = null;

    do {
      const params = {
        fields,
        level: 'campaign',
        date_preset: datePreset,
        time_increment: 1,
        limit: 100,
      };
      if (after) params.after = after;

      const res = await this.request(`/act_${this.accountId}/insights`, params);
      data.push(...(res.data || []));
      after = res.paging?.cursors?.after;
    } while (after);

    return data.map((insight) => this._parseInsight(insight));
  }

  /**
   * Fetch ad creative details
   */
  async fetchCreatives(adSetId) {
    const fields = 'id,name,status,creative{id,title,body,call_to_action_type,thumbnail_url,video_id,image_url}';

    const res = await this.request(`/${adSetId}/ads`, { fields, limit: 100 });
    return res.data || [];
  }

  /**
   * Upload an image URL to Meta Ad Images library — returns hash for use in creatives
   */
  async uploadAdImage(imageUrl) {
    try {
      const res = await axios.post(
        `${this.baseUrl}/act_${this.accountId}/adimages`,
        {
          url: imageUrl,
          access_token: this.accessToken,
        }
      );
      const images = res.data.images;
      const imageData = Object.values(images)[0];
      return { hash: imageData.hash, url: imageData.url || imageUrl };
    } catch (err) {
      const errData = err.response?.data?.error;
      throw new Error(`Meta Image Upload: ${errData?.message || err.message}`);
    }
  }

  /**
   * Create an ad creative (requires page_id + image_hash + link)
   */
  async createAdCreative({ name, pageId, imageHash, linkUrl, message, callToAction = 'LEARN_MORE', headline }) {
    try {
      const res = await axios.post(
        `${this.baseUrl}/act_${this.accountId}/adcreatives`,
        {
          name,
          object_story_spec: {
            page_id: pageId,
            link_data: {
              image_hash: imageHash,
              link: linkUrl,
              message,
              name: headline || name,
              call_to_action: {
                type: callToAction,
                value: { link: linkUrl },
              },
            },
          },
          access_token: this.accessToken,
        }
      );
      return res.data;
    } catch (err) {
      const errData = err.response?.data?.error;
      throw new Error(`Meta Creative Create: ${errData?.message || err.message}`);
    }
  }

  /**
   * Create an ad in an ad set
   */
  async createAd({ name, adSetId, creativeId }) {
    try {
      const res = await axios.post(
        `${this.baseUrl}/act_${this.accountId}/ads`,
        {
          name,
          adset_id: adSetId,
          creative: { creative_id: creativeId },
          status: 'PAUSED',
          access_token: this.accessToken,
        }
      );
      return res.data;
    } catch (err) {
      const errData = err.response?.data?.error;
      throw new Error(`Meta Ad Create: ${errData?.message || err.message}`);
    }
  }

  /**
   * Update daily budget of an ad set
   */
  async updateAdSetBudget(adSetId, newDailyBudgetTRY) {
    try {
      const res = await axios.post(
        `${this.baseUrl}/${adSetId}`,
        {
          daily_budget: Math.round(newDailyBudgetTRY * 100),
          access_token: this.accessToken,
        }
      );
      return res.data;
    } catch (err) {
      const errData = err.response?.data?.error;
      throw new Error(`Meta Budget Update: ${errData?.message || err.message}`);
    }
  }

  /**
   * Pause or resume an ad set
   */
  async setAdSetStatus(adSetId, status) {
    try {
      const res = await axios.post(
        `${this.baseUrl}/${adSetId}`,
        { status, access_token: this.accessToken }
      );
      return res.data;
    } catch (err) {
      const errData = err.response?.data?.error;
      throw new Error(`Meta Status Update: ${errData?.message || err.message}`);
    }
  }

  /**
   * Get Facebook pages connected to this ad account's business
   */
  async getConnectedPages() {
    try {
      const res = await this.request(`/act_${this.accountId}`, {
        fields: 'business',
      });
      if (!res.business) return [];
      const pagesRes = await this.request(`/${res.business.id}/owned_pages`, {
        fields: 'id,name',
        limit: 20,
      });
      return pagesRes.data || [];
    } catch {
      return [];
    }
  }

  /**
   * Create a campaign on Meta Ads
   */
  async createCampaign({ name, objective, status = 'PAUSED', specialAdCategories = [] }) {
    try {
      const res = await axios.post(
        `${this.baseUrl}/act_${this.accountId}/campaigns`,
        {
          name,
          objective,
          status,
          special_ad_categories: specialAdCategories,
          access_token: this.accessToken,
        }
      );
      return res.data;
    } catch (err) {
      const errData = err.response?.data?.error;
      throw new Error(`Meta Campaign Create: ${errData?.message || err.message}`);
    }
  }

  /**
   * Create an ad set on Meta Ads
   */
  async createAdSet({ campaignId, name, dailyBudget, targeting, optimizationGoal = 'LANDING_PAGE_VIEWS', billingEvent = 'IMPRESSIONS', startTime }) {
    try {
      const params = {
        name,
        campaign_id: campaignId,
        daily_budget: Math.round(dailyBudget * 100),
        billing_event: billingEvent,
        optimization_goal: optimizationGoal,
        targeting: JSON.stringify(targeting),
        status: 'PAUSED',
        access_token: this.accessToken,
      };
      if (startTime) params.start_time = startTime;

      const res = await axios.post(
        `${this.baseUrl}/act_${this.accountId}/adsets`,
        params
      );
      return res.data;
    } catch (err) {
      const errData = err.response?.data?.error;
      throw new Error(`Meta AdSet Create: ${errData?.message || err.message}`);
    }
  }

  /**
   * Parse Meta insights row to standardized format
   */
  _parseInsight(insight) {
    // Extract conversions from actions array
    const actions = insight.actions || [];
    const actionValues = insight.action_values || [];

    const purchases = actions.find((a) => a.action_type === 'purchase');
    const purchaseValue = actionValues.find((a) => a.action_type === 'purchase');
    const addToCart = actions.find((a) => a.action_type === 'add_to_cart');
    const leads = actions.find((a) => a.action_type === 'lead');

    const conversions = parseInt(purchases?.value || leads?.value || 0);
    const conversionValue = parseFloat(purchaseValue?.value || 0);
    const spend = parseFloat(insight.spend || 0);

    return {
      date: insight.date_start,
      campaignId: insight.campaign_id,
      campaignName: insight.campaign_name,
      impressions: parseInt(insight.impressions || 0),
      clicks: parseInt(insight.clicks || 0),
      spend,
      conversions,
      conversionValue,
      reach: parseInt(insight.reach || 0),
      frequency: parseFloat(insight.frequency || 0),
      ctr: parseFloat(insight.ctr || 0) / 100, // Meta returns as percentage
      cpc: parseFloat(insight.cpc || 0),
      cpm: parseFloat(insight.cpm || 0),
      roas: spend > 0 ? conversionValue / spend : 0,
      cpa: conversions > 0 ? spend / conversions : 0,
      addToCart: parseInt(addToCart?.value || 0),
    };
  }
}

module.exports = MetaAdsService;
