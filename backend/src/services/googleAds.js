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

const GOOGLE_ADS_API_VERSION = 'v15';
const GOOGLE_ADS_BASE_URL = `https://googleads.googleapis.com/${GOOGLE_ADS_API_VERSION}`;

class GoogleAdsService {
  constructor(adAccount) {
    this.account = adAccount;
    this.accessToken = decryptToken(adAccount.encrypted_access_token);
    this.refreshTokenValue = adAccount.encrypted_refresh_token
      ? decryptToken(adAccount.encrypted_refresh_token)
      : null;
    this.customerId = adAccount.account_id.replace(/-/g, '');
    this.developerToken = config.google.developerToken;
    this.managerId = config.google.managerId;
  }

  /**
   * Build headers for Google Ads API requests
   */
  _headers() {
    return {
      Authorization: `Bearer ${this.accessToken}`,
      'developer-token': this.developerToken,
      'Content-Type': 'application/json',
      ...(this.managerId ? { 'login-customer-id': this.managerId } : {}),
    };
  }

  /**
   * Execute Google Ads Query Language (GAQL) query
   */
  async gaql(query) {
    try {
      const res = await axios.post(
        `${GOOGLE_ADS_BASE_URL}/customers/${this.customerId}/googleAds:searchStream`,
        { query },
        { headers: this._headers(), timeout: 30000 }
      );
      return res.data;
    } catch (err) {
      if (err.response?.status === 401) {
        const refreshed = await this.refreshToken();
        if (refreshed) {
          const retryRes = await axios.post(
            `${GOOGLE_ADS_BASE_URL}/customers/${this.customerId}/googleAds:searchStream`,
            { query },
            { headers: this._headers(), timeout: 30000 }
          );
          return retryRes.data;
        }
      }
      const errDetails = err.response?.data?.[0]?.error?.details || err.message;
      throw new Error(`Google Ads API error: ${JSON.stringify(errDetails)}`);
    }
  }

  /**
   * Refresh OAuth2 access token using refresh token
   */
  async refreshToken() {
    if (!this.refreshTokenValue) {
      console.warn('[GoogleAds] No refresh token available');
      return false;
    }

    try {
      const res = await axios.post('https://oauth2.googleapis.com/token', {
        client_id: config.google.clientId,
        client_secret: config.google.clientSecret,
        refresh_token: this.refreshTokenValue,
        grant_type: 'refresh_token',
      });

      const { access_token, expires_in } = res.data;

      // Encrypt and store new access token
      const iv = crypto.randomBytes(16);
      const cipher = crypto.createCipheriv(ALGORITHM, ENCRYPTION_KEY, iv);
      let enc = cipher.update(access_token, 'utf8', 'hex');
      enc += cipher.final('hex');
      const authTag = cipher.getAuthTag();
      const encryptedToken = `${iv.toString('hex')}:${authTag.toString('hex')}:${enc}`;

      await pool.query(
        `UPDATE ad_accounts
         SET encrypted_access_token = $1,
             token_expires_at = $2,
             updated_at = NOW()
         WHERE id = $3`,
        [encryptedToken, new Date(Date.now() + (expires_in || 3600) * 1000), this.account.id]
      );

      this.accessToken = access_token;
      return true;
    } catch (err) {
      console.error('[GoogleAds] Token refresh failed:', err.message);
      return false;
    }
  }

  /**
   * Fetch campaigns for the customer account
   */
  async fetchCampaigns() {
    const query = `
      SELECT
        campaign.id,
        campaign.name,
        campaign.status,
        campaign.advertising_channel_type,
        campaign.bidding_strategy_type,
        campaign.campaign_budget,
        campaign_budget.amount_micros,
        campaign_budget.type,
        campaign.start_date,
        campaign.end_date
      FROM campaign
      WHERE campaign.status != 'REMOVED'
      ORDER BY campaign.name
    `;

    const response = await this.gaql(query);
    const campaigns = [];

    for (const batch of response) {
      for (const result of (batch.results || [])) {
        const c = result.campaign;
        const budget = result.campaign_budget;
        campaigns.push({
          id: c.id,
          name: c.name,
          status: c.status?.toLowerCase() === 'enabled' ? 'active' : (c.status?.toLowerCase() || 'paused'),
          objective: c.advertising_channel_type,
          budget_type: budget?.type === 'DAILY' ? 'daily' : 'lifetime',
          daily_budget: budget?.amount_micros ? parseInt(budget.amount_micros) / 1000000 : null,
          start_time: c.start_date,
          stop_time: c.end_date,
          bidding_strategy: c.bidding_strategy_type,
        });
      }
    }

    return campaigns;
  }

  /**
   * Fetch campaign metrics for a date range
   * @param {string} startDate - YYYY-MM-DD
   * @param {string} endDate - YYYY-MM-DD
   */
  async fetchMetrics(startDate, endDate) {
    const query = `
      SELECT
        campaign.id,
        campaign.name,
        segments.date,
        metrics.impressions,
        metrics.clicks,
        metrics.cost_micros,
        metrics.conversions,
        metrics.conversions_value,
        metrics.average_cpc,
        metrics.average_cpm,
        metrics.ctr,
        metrics.all_conversions,
        metrics.view_through_conversions
      FROM campaign
      WHERE segments.date BETWEEN '${startDate}' AND '${endDate}'
        AND campaign.status != 'REMOVED'
      ORDER BY segments.date
    `;

    const response = await this.gaql(query);
    const metrics = [];

    for (const batch of response) {
      for (const result of (batch.results || [])) {
        const m = result.metrics;
        const spend = parseInt(m.cost_micros || 0) / 1000000;
        const conversions = parseFloat(m.conversions || 0);
        const conversionValue = parseFloat(m.conversions_value || 0);

        metrics.push({
          campaignId: result.campaign.id,
          campaignName: result.campaign.name,
          date: result.segments.date,
          impressions: parseInt(m.impressions || 0),
          clicks: parseInt(m.clicks || 0),
          spend,
          conversions,
          conversionValue,
          ctr: parseFloat(m.ctr || 0),
          avgCpc: parseInt(m.average_cpc || 0) / 1000000,
          avgCpm: parseInt(m.average_cpm || 0) / 1000000,
          roas: spend > 0 ? conversionValue / spend : 0,
          cpa: conversions > 0 ? spend / conversions : 0,
        });
      }
    }

    return metrics;
  }

  /**
   * Fetch ad group performance
   */
  async fetchAdGroups(campaignId) {
    const query = `
      SELECT
        ad_group.id,
        ad_group.name,
        ad_group.status,
        ad_group.type,
        metrics.impressions,
        metrics.clicks,
        metrics.cost_micros,
        metrics.conversions,
        metrics.ctr
      FROM ad_group
      WHERE campaign.id = ${campaignId}
        AND ad_group.status != 'REMOVED'
    `;

    const response = await this.gaql(query);
    const adGroups = [];

    for (const batch of response) {
      for (const result of (batch.results || [])) {
        const ag = result.ad_group;
        const m = result.metrics;
        adGroups.push({
          id: ag.id,
          name: ag.name,
          status: ag.status,
          type: ag.type,
          spend: parseInt(m.cost_micros || 0) / 1000000,
          impressions: parseInt(m.impressions || 0),
          clicks: parseInt(m.clicks || 0),
          conversions: parseFloat(m.conversions || 0),
          ctr: parseFloat(m.ctr || 0),
        });
      }
    }

    return adGroups;
  }

  /**
   * Fetch keyword performance
   */
  async fetchKeywords(campaignId) {
    const query = `
      SELECT
        keyword_view.resource_name,
        ad_group_criterion.keyword.text,
        ad_group_criterion.keyword.match_type,
        ad_group_criterion.quality_info.quality_score,
        metrics.impressions,
        metrics.clicks,
        metrics.cost_micros,
        metrics.conversions,
        metrics.average_cpc
      FROM keyword_view
      WHERE campaign.id = ${campaignId}
        AND ad_group_criterion.status != 'REMOVED'
      ORDER BY metrics.impressions DESC
      LIMIT 100
    `;

    const response = await this.gaql(query);
    const keywords = [];

    for (const batch of response) {
      for (const result of (batch.results || [])) {
        const kw = result.ad_group_criterion?.keyword || {};
        const m = result.metrics;
        keywords.push({
          text: kw.text,
          matchType: kw.match_type,
          qualityScore: result.ad_group_criterion?.quality_info?.quality_score,
          impressions: parseInt(m.impressions || 0),
          clicks: parseInt(m.clicks || 0),
          spend: parseInt(m.cost_micros || 0) / 1000000,
          conversions: parseFloat(m.conversions || 0),
          avgCpc: parseInt(m.average_cpc || 0) / 1000000,
        });
      }
    }

    return keywords;
  }
}

module.exports = GoogleAdsService;
