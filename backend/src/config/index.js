require('dotenv').config();

const config = {
  env: process.env.NODE_ENV || 'development',
  port: parseInt(process.env.PORT, 10) || 3001,

  db: {
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT, 10) || 5432,
    name: process.env.DB_NAME || 'digital_marketing',
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD || '',
    ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false,
    poolMax: parseInt(process.env.DB_POOL_MAX, 10) || 20,
    poolIdleTimeout: parseInt(process.env.DB_POOL_IDLE_TIMEOUT, 10) || 30000,
  },

  redis: {
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT, 10) || 6379,
    password: process.env.REDIS_PASSWORD || undefined,
    url: process.env.REDIS_URL || undefined,
  },

  jwt: {
    secret: process.env.JWT_SECRET || 'change-this-secret-in-production',
    expiresIn: process.env.JWT_EXPIRES_IN || '7d',
    refreshSecret: process.env.JWT_REFRESH_SECRET || 'change-this-refresh-secret',
    refreshExpiresIn: process.env.JWT_REFRESH_EXPIRES_IN || '30d',
  },

  encryption: {
    key: process.env.ENCRYPTION_KEY || 'change-this-32-char-encryption-key',
  },

  meta: {
    appId: process.env.META_APP_ID || '',
    appSecret: process.env.META_APP_SECRET || '',
    redirectUri: process.env.META_REDIRECT_URI || 'http://localhost:3001/api/accounts/meta/callback',
    apiVersion: process.env.META_API_VERSION || 'v19.0',
    scope: 'ads_management,ads_read,business_management,pages_read_engagement',
  },

  google: {
    clientId: process.env.GOOGLE_CLIENT_ID || '',
    clientSecret: process.env.GOOGLE_CLIENT_SECRET || '',
    redirectUri: process.env.GOOGLE_REDIRECT_URI || 'http://localhost:3001/api/accounts/google/callback',
    scope: [
      'https://www.googleapis.com/auth/adwords',
      'https://www.googleapis.com/auth/userinfo.email',
      'https://www.googleapis.com/auth/userinfo.profile',
    ],
    developerToken: process.env.GOOGLE_ADS_DEVELOPER_TOKEN || '',
    managerId: process.env.GOOGLE_ADS_MANAGER_ID || '',
  },

  tiktok: {
    appId: process.env.TIKTOK_APP_ID || '',
    appSecret: process.env.TIKTOK_APP_SECRET || '',
    redirectUri: process.env.TIKTOK_REDIRECT_URI || 'http://localhost:3001/api/accounts/tiktok/callback',
    scope: 'ad_show,ad_manage',
    apiBaseUrl: 'https://business-api.tiktok.com/open_api/v1.3',
  },

  openai: {
    apiKey: process.env.OPENAI_API_KEY || '',
    model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
    maxTokens: parseInt(process.env.OPENAI_MAX_TOKENS, 10) || 2000,
  },

  elevenlabs: {
    apiKey: process.env.ELEVENLABS_API_KEY || '',
    baseUrl: 'https://api.elevenlabs.io/v1',
    defaultVoiceId: process.env.ELEVENLABS_DEFAULT_VOICE_ID || '21m00Tcm4TlvDq8ikWAM',
  },

  runway: {
    apiKey: process.env.RUNWAY_API_KEY || '',
    baseUrl: 'https://api.runwayml.com/v1',
  },

  n8n: {
    webhookUrl: process.env.N8N_WEBHOOK_URL || 'http://localhost:5678',
    apiKey: process.env.N8N_API_KEY || '',
    videoPipelineWebhook: process.env.N8N_VIDEO_PIPELINE_WEBHOOK || '',
    trendAnalysisWebhook: process.env.N8N_TREND_ANALYSIS_WEBHOOK || '',
    adCopyWebhook: process.env.N8N_AD_COPY_WEBHOOK || '',
  },

  cors: {
    origin: process.env.CORS_ORIGIN || 'http://localhost:3000',
    credentials: true,
  },

  rateLimiting: {
    windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS, 10) || 15 * 60 * 1000,
    max: parseInt(process.env.RATE_LIMIT_MAX, 10) || 100,
  },

  logging: {
    level: process.env.LOG_LEVEL || 'info',
  },
};

// Validate critical config
const validateConfig = () => {
  const warnings = [];

  if (config.jwt.secret === 'change-this-secret-in-production' && config.env === 'production') {
    throw new Error('JWT_SECRET must be set in production');
  }
  if (config.encryption.key === 'change-this-32-char-encryption-key' && config.env === 'production') {
    throw new Error('ENCRYPTION_KEY must be set in production');
  }
  if (!config.openai.apiKey) {
    warnings.push('OPENAI_API_KEY not set - AI features will be disabled');
  }
  if (!config.meta.appId) {
    warnings.push('META_APP_ID not set - Meta integration will be disabled');
  }

  if (warnings.length > 0 && config.env !== 'test') {
    console.warn('[Config] Warnings:', warnings);
  }
};

if (config.env !== 'test') {
  validateConfig();
}

module.exports = config;
