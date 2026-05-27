-- Digital Marketing AI Platform - PostgreSQL Schema
-- Version: 1.0.0

-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ============================================================
-- TENANTS (multi-tenant support)
-- ============================================================
CREATE TABLE IF NOT EXISTS tenants (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name VARCHAR(255) NOT NULL,
  slug VARCHAR(100) UNIQUE NOT NULL,
  plan VARCHAR(50) NOT NULL DEFAULT 'starter' CHECK (plan IN ('starter', 'growth', 'scale', 'enterprise')),
  settings JSONB NOT NULL DEFAULT '{}',
  is_active BOOLEAN NOT NULL DEFAULT true,
  trial_ends_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_tenants_slug ON tenants(slug);

-- ============================================================
-- USERS
-- ============================================================
CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  email VARCHAR(255) UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  first_name VARCHAR(100),
  last_name VARCHAR(100),
  role VARCHAR(50) NOT NULL DEFAULT 'member' CHECK (role IN ('owner', 'admin', 'member', 'viewer')),
  is_active BOOLEAN NOT NULL DEFAULT true,
  last_login_at TIMESTAMPTZ,
  email_verified_at TIMESTAMPTZ,
  avatar_url TEXT,
  preferences JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_users_tenant_id ON users(tenant_id);
CREATE INDEX idx_users_email ON users(email);

-- ============================================================
-- AD ACCOUNTS (connected platform accounts)
-- ============================================================
CREATE TABLE IF NOT EXISTS ad_accounts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  platform VARCHAR(50) NOT NULL CHECK (platform IN ('meta', 'google', 'tiktok')),
  account_id VARCHAR(255) NOT NULL,
  account_name VARCHAR(255),
  currency VARCHAR(10) DEFAULT 'USD',
  timezone VARCHAR(100),
  -- Tokens stored encrypted using pgcrypto
  encrypted_access_token TEXT,
  encrypted_refresh_token TEXT,
  token_expires_at TIMESTAMPTZ,
  scopes TEXT[],
  is_active BOOLEAN NOT NULL DEFAULT true,
  last_sync_at TIMESTAMPTZ,
  sync_error TEXT,
  metadata JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(tenant_id, platform, account_id)
);

CREATE INDEX idx_ad_accounts_tenant_id ON ad_accounts(tenant_id);
CREATE INDEX idx_ad_accounts_platform ON ad_accounts(platform);
CREATE INDEX idx_ad_accounts_token_expires ON ad_accounts(token_expires_at);

-- ============================================================
-- CAMPAIGNS
-- ============================================================
CREATE TABLE IF NOT EXISTS campaigns (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  ad_account_id UUID NOT NULL REFERENCES ad_accounts(id) ON DELETE CASCADE,
  external_id VARCHAR(255) NOT NULL,
  name VARCHAR(500) NOT NULL,
  platform VARCHAR(50) NOT NULL CHECK (platform IN ('meta', 'google', 'tiktok')),
  status VARCHAR(50) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'paused', 'deleted', 'archived', 'draft')),
  objective VARCHAR(100),
  budget_type VARCHAR(50) CHECK (budget_type IN ('daily', 'lifetime', 'monthly')),
  budget_amount DECIMAL(15, 4),
  start_date DATE,
  end_date DATE,
  targeting JSONB NOT NULL DEFAULT '{}',
  platform_data JSONB NOT NULL DEFAULT '{}',
  last_synced_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(tenant_id, platform, external_id)
);

CREATE INDEX idx_campaigns_tenant_id ON campaigns(tenant_id);
CREATE INDEX idx_campaigns_ad_account_id ON campaigns(ad_account_id);
CREATE INDEX idx_campaigns_platform ON campaigns(platform);
CREATE INDEX idx_campaigns_status ON campaigns(status);

-- ============================================================
-- AD CREATIVES
-- ============================================================
CREATE TABLE IF NOT EXISTS ad_creatives (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  campaign_id UUID REFERENCES campaigns(id) ON DELETE SET NULL,
  name VARCHAR(500) NOT NULL,
  type VARCHAR(50) NOT NULL CHECK (type IN ('image', 'video', 'carousel', 'text', 'collection')),
  format VARCHAR(100),
  -- AI-generated content
  headline TEXT,
  primary_text TEXT,
  description TEXT,
  call_to_action VARCHAR(100),
  -- Asset references
  asset_url TEXT,
  thumbnail_url TEXT,
  -- AI Scoring (0-100)
  creative_score DECIMAL(5, 2),
  hook_score DECIMAL(5, 2),
  retention_score DECIMAL(5, 2),
  cta_score DECIMAL(5, 2),
  emotional_score DECIMAL(5, 2),
  score_breakdown JSONB,
  score_reasoning TEXT,
  -- AI generation metadata
  generated_by_ai BOOLEAN DEFAULT false,
  ai_generation_id UUID,
  generation_prompt TEXT,
  -- Performance correlation
  avg_roas DECIMAL(10, 4),
  avg_ctr DECIMAL(10, 6),
  total_spend DECIMAL(15, 4),
  total_impressions BIGINT DEFAULT 0,
  total_conversions INTEGER DEFAULT 0,
  platform_data JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_ad_creatives_tenant_id ON ad_creatives(tenant_id);
CREATE INDEX idx_ad_creatives_campaign_id ON ad_creatives(campaign_id);
CREATE INDEX idx_ad_creatives_creative_score ON ad_creatives(creative_score DESC);
CREATE INDEX idx_ad_creatives_type ON ad_creatives(type);

-- ============================================================
-- ANALYTICS SNAPSHOTS (time-series performance data)
-- ============================================================
CREATE TABLE IF NOT EXISTS analytics_snapshots (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  ad_account_id UUID REFERENCES ad_accounts(id) ON DELETE SET NULL,
  campaign_id UUID REFERENCES campaigns(id) ON DELETE SET NULL,
  creative_id UUID REFERENCES ad_creatives(id) ON DELETE SET NULL,
  snapshot_date DATE NOT NULL,
  platform VARCHAR(50) NOT NULL,
  granularity VARCHAR(20) NOT NULL DEFAULT 'daily' CHECK (granularity IN ('hourly', 'daily', 'weekly', 'monthly')),
  -- Core Metrics
  impressions BIGINT NOT NULL DEFAULT 0,
  clicks BIGINT NOT NULL DEFAULT 0,
  spend DECIMAL(15, 4) NOT NULL DEFAULT 0,
  conversions INTEGER NOT NULL DEFAULT 0,
  conversion_value DECIMAL(15, 4) DEFAULT 0,
  -- Derived Metrics (stored for fast retrieval)
  roas DECIMAL(10, 4),        -- Return on Ad Spend = revenue / spend
  ctr DECIMAL(10, 6),          -- Click Through Rate = clicks / impressions
  cpc DECIMAL(10, 4),          -- Cost Per Click = spend / clicks
  cpm DECIMAL(10, 4),          -- Cost Per Mille = spend / impressions * 1000
  cpa DECIMAL(10, 4),          -- Cost Per Acquisition = spend / conversions
  cac DECIMAL(10, 4),          -- Customer Acquisition Cost (unique new customers)
  aov DECIMAL(10, 4),          -- Average Order Value = conversion_value / conversions
  -- Additional funnel metrics
  reach BIGINT DEFAULT 0,
  frequency DECIMAL(8, 4),
  video_views BIGINT DEFAULT 0,
  video_completions BIGINT DEFAULT 0,
  engagement_rate DECIMAL(10, 6),
  -- Platform-specific raw data
  raw_data JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(tenant_id, platform, campaign_id, creative_id, snapshot_date, granularity)
);

CREATE INDEX idx_analytics_tenant_date ON analytics_snapshots(tenant_id, snapshot_date DESC);
CREATE INDEX idx_analytics_campaign ON analytics_snapshots(campaign_id, snapshot_date DESC);
CREATE INDEX idx_analytics_platform ON analytics_snapshots(platform, snapshot_date DESC);
CREATE INDEX idx_analytics_account ON analytics_snapshots(ad_account_id, snapshot_date DESC);

-- ============================================================
-- TREND REPORTS
-- ============================================================
CREATE TABLE IF NOT EXISTS trend_reports (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  report_date DATE NOT NULL,
  platform VARCHAR(50) NOT NULL CHECK (platform IN ('tiktok', 'instagram', 'youtube', 'all')),
  niche VARCHAR(255),
  -- Trend data
  trending_hashtags JSONB NOT NULL DEFAULT '[]',
  trending_sounds JSONB NOT NULL DEFAULT '[]',
  trending_formats JSONB NOT NULL DEFAULT '[]',
  viral_hooks JSONB NOT NULL DEFAULT '[]',
  -- AI Analysis
  summary TEXT,
  recommendations JSONB NOT NULL DEFAULT '[]',
  opportunity_score DECIMAL(5, 2),
  raw_scraped_data JSONB DEFAULT '{}',
  ai_analysis JSONB DEFAULT '{}',
  status VARCHAR(50) DEFAULT 'completed' CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_trend_reports_tenant_date ON trend_reports(tenant_id, report_date DESC);
CREATE INDEX idx_trend_reports_platform ON trend_reports(platform);

-- ============================================================
-- AI GENERATIONS (log of all AI-generated content)
-- ============================================================
CREATE TABLE IF NOT EXISTS ai_generations (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  type VARCHAR(100) NOT NULL CHECK (type IN ('ad_copy', 'video_script', 'video', 'voiceover', 'image', 'analysis', 'trend_report')),
  status VARCHAR(50) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
  -- Request
  prompt TEXT,
  input_data JSONB NOT NULL DEFAULT '{}',
  model_used VARCHAR(100),
  -- Response
  output_text TEXT,
  output_data JSONB DEFAULT '{}',
  asset_url TEXT,
  -- Cost tracking
  tokens_used INTEGER DEFAULT 0,
  cost_usd DECIMAL(10, 6) DEFAULT 0,
  -- n8n job tracking
  n8n_execution_id VARCHAR(255),
  n8n_workflow_id VARCHAR(255),
  job_started_at TIMESTAMPTZ,
  job_completed_at TIMESTAMPTZ,
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_ai_generations_tenant_id ON ai_generations(tenant_id);
CREATE INDEX idx_ai_generations_user_id ON ai_generations(user_id);
CREATE INDEX idx_ai_generations_status ON ai_generations(status);
CREATE INDEX idx_ai_generations_type ON ai_generations(type);

-- ============================================================
-- REFRESH TOKEN STORE
-- ============================================================
CREATE TABLE IF NOT EXISTS refresh_tokens (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash VARCHAR(255) NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  is_revoked BOOLEAN NOT NULL DEFAULT false,
  ip_address INET,
  user_agent TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_refresh_tokens_user_id ON refresh_tokens(user_id);
CREATE INDEX idx_refresh_tokens_hash ON refresh_tokens(token_hash);

-- ============================================================
-- AUDIT LOG
-- ============================================================
CREATE TABLE IF NOT EXISTS audit_logs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID REFERENCES tenants(id) ON DELETE SET NULL,
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  action VARCHAR(255) NOT NULL,
  resource_type VARCHAR(100),
  resource_id UUID,
  old_data JSONB,
  new_data JSONB,
  ip_address INET,
  user_agent TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_audit_logs_tenant_id ON audit_logs(tenant_id, created_at DESC);
CREATE INDEX idx_audit_logs_user_id ON audit_logs(user_id);

-- ============================================================
-- TRIGGERS: auto-update updated_at
-- ============================================================
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_tenants_updated_at BEFORE UPDATE ON tenants FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_users_updated_at BEFORE UPDATE ON users FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_ad_accounts_updated_at BEFORE UPDATE ON ad_accounts FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_campaigns_updated_at BEFORE UPDATE ON campaigns FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_ad_creatives_updated_at BEFORE UPDATE ON ad_creatives FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_trend_reports_updated_at BEFORE UPDATE ON trend_reports FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_ai_generations_updated_at BEFORE UPDATE ON ai_generations FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
