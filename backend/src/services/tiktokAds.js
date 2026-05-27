const axios = require('axios');
const crypto = require('crypto');
const config = require('../config');

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

class TikTokAdsService {
  constructor(adAccount) {
    this.account = adAccount;
    this.accessToken = decryptToken(adAccount.encrypted_access_token);
    this.advertiserId = adAccount.account_id;
    this.baseUrl = config.tiktok.apiBaseUrl;
  }

  /**
   * Make authenticated request to TikTok Business API
   */
  async request(method, endpoint, params = {}, data = null) {
    try {
      const response = await axios({
        method,
        url: `${this.baseUrl}${endpoint}`,
        headers: {
          'Access-Token': this.accessToken,
          'Content-Type': 'application/json',
        },
        params: method === 'GET' ? { advertiser_id: this.advertiserId, ...params } : undefined,
        data: method !== 'GET' ? { advertiser_id: this.advertiserId, ...data } : undefined,
        timeout: 30000,
      });

      if (response.data.code !== 0) {
        throw new Error(`TikTok API error ${response.data.code}: ${response.data.message}`);
      }

      return response.data.data;
    } catch (err) {
      if (err.response?.data?.code === 40001) {
        throw new Error('TikTok access token expired. Please reconnect your account.');
      }
      throw err;
    }
  }

  /**
   * Fetch campaigns for the advertiser
   */
  async fetchCampaigns(page = 1, pageSize = 100) {
    const data = await this.request('GET', '/campaign/get/', {
      page,
      page_size: pageSize,
      fields: JSON.stringify([
        'campaign_id', 'campaign_name', 'status', 'objective_type',
        'budget', 'budget_mode', 'create_time', 'modify_time',
      ]),
    });

    const campaigns = (data?.list || []).map((campaign) => ({
      id: campaign.campaign_id,
      name: campaign.campaign_name,
      status: this._normalizeStatus(campaign.status),
      objective: campaign.objective_type,
      budget_type: campaign.budget_mode === 'BUDGET_MODE_DAY' ? 'daily' : 'lifetime',
      daily_budget: campaign.budget_mode === 'BUDGET_MODE_DAY' ? parseFloat(campaign.budget) : null,
      lifetime_budget: campaign.budget_mode === 'BUDGET_MODE_TOTAL' ? parseFloat(campaign.budget) : null,
      start_time: null,
      stop_time: null,
    }));

    return campaigns;
  }

  /**
   * Fetch campaign insights
   * @param {string[]} campaignIds - Array of campaign IDs
   * @param {string} startDate - YYYY-MM-DD
   * @param {string} endDate - YYYY-MM-DD
   * @param {string} granularity - 'STAT_TIME_DAY', 'STAT_TIME_WEEK', 'STAT_TIME_MONTH'
   */
  async fetchInsights(campaignIds, startDate, endDate, granularity = 'STAT_TIME_DAY') {
    const data = await this.request('GET', '/report/integrated/get/', {
      report_type: 'CAMPAIGN',
      data_level: 'AUCTION_CAMPAIGN',
      dimensions: JSON.stringify(['campaign_id', 'stat_time_day']),
      metrics: JSON.stringify([
        'campaign_name',
        'impressions', 'clicks', 'spend',
        'conversion', 'real_time_conversion', 'complete_payment',
        'complete_payment_roas',
        'ctr', 'cpc', 'cpm', 'cost_per_result',
        'video_play_actions', 'video_watched_2s', 'video_watched_6s',
        'average_video_play', 'average_video_play_per_user',
        'reach', 'frequency',
      ]),
      start_date: startDate,
      end_date: endDate,
      page_size: 1000,
      ...(campaignIds?.length ? { filtering: JSON.stringify([{
        field_name: 'campaign_id',
        filter_type: 'IN',
        filter_value: JSON.stringify(campaignIds),
      }]) } : {}),
    });

    return (data?.list || []).map((row) => {
      const m = row.metrics || {};
      const dims = row.dimensions || {};
      const spend = parseFloat(m.spend || 0);
      const conversions = parseInt(m.complete_payment || m.conversion || 0);
      const conversionValue = spend * parseFloat(m.complete_payment_roas || 0);

      return {
        campaignId: dims.campaign_id,
        date: dims.stat_time_day?.split(' ')[0],
        campaignName: m.campaign_name,
        impressions: parseInt(m.impressions || 0),
        clicks: parseInt(m.clicks || 0),
        spend,
        conversions,
        conversionValue,
        reach: parseInt(m.reach || 0),
        frequency: parseFloat(m.frequency || 0),
        ctr: parseFloat(m.ctr || 0) / 100,
        cpc: parseFloat(m.cpc || 0),
        cpm: parseFloat(m.cpm || 0),
        roas: parseFloat(m.complete_payment_roas || 0),
        cpa: parseFloat(m.cost_per_result || 0),
        videoPlays: parseInt(m.video_play_actions || 0),
        videoWatched2s: parseInt(m.video_watched_2s || 0),
        videoWatched6s: parseInt(m.video_watched_6s || 0),
        avgVideoPlay: parseFloat(m.average_video_play || 0),
      };
    });
  }

  /**
   * Fetch trending content from TikTok Creative Center
   * Note: Requires TikTok Creative Center API access
   */
  async fetchTrendingContent(industry, period = '7') {
    try {
      const res = await axios.get('https://ads.tiktok.com/creative_center/feed/v1/top_ads/pc/query', {
        params: {
          industry_id: industry || '25020102',
          period,
          country_code: 'US',
          material_type: 'video',
          order_by: 'CTR',
          limit: 20,
        },
        headers: {
          'Access-Token': this.accessToken,
        },
        timeout: 15000,
      });

      return res.data?.data?.materials || [];
    } catch (err) {
      console.warn('[TikTokAds] Trending content fetch failed:', err.message);
      return [];
    }
  }

  /**
   * Fetch trending hashtags
   */
  async fetchTrendingHashtags(region = 'US') {
    try {
      const data = await this.request('GET', '/commerce/trending_hashtag/list/', {
        region_code: region,
      });
      return data?.hashtags || [];
    } catch (err) {
      console.warn('[TikTokAds] Trending hashtags fetch failed:', err.message);
      return [];
    }
  }

  /**
   * Fetch ad group performance
   */
  async fetchAdGroups(campaignId, startDate, endDate) {
    const data = await this.request('GET', '/adgroup/get/', {
      campaign_id: campaignId,
      fields: JSON.stringify([
        'adgroup_id', 'adgroup_name', 'status', 'budget', 'budget_mode',
        'bid_type', 'bid_price', 'optimization_goal',
      ]),
    });

    return (data?.list || []).map((ag) => ({
      id: ag.adgroup_id,
      name: ag.adgroup_name,
      status: this._normalizeStatus(ag.status),
      budget: parseFloat(ag.budget || 0),
      budgetMode: ag.budget_mode,
      bidType: ag.bid_type,
      bidPrice: parseFloat(ag.bid_price || 0),
      optimizationGoal: ag.optimization_goal,
    }));
  }

  _normalizeStatus(status) {
    const map = {
      'CAMPAIGN_STATUS_ENABLE': 'active',
      'CAMPAIGN_STATUS_DISABLE': 'paused',
      'CAMPAIGN_STATUS_DELETE': 'deleted',
      'STATUS_ENABLE': 'active',
      'STATUS_DISABLE': 'paused',
      'STATUS_DELETE': 'deleted',
    };
    return map[status] || status?.toLowerCase() || 'unknown';
  }
}

module.exports = TikTokAdsService;
