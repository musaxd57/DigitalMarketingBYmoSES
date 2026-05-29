const express = require('express');
const axios = require('axios');
const crypto = require('crypto');
const router = express.Router();
const { pool } = require('../models/db');
const config = require('../config');
const { authenticate } = require('../middleware/auth');

// ─── Encryption helpers for token storage ───────────────────────────────────
const ALGORITHM = 'aes-256-gcm';
const ENCRYPTION_KEY = Buffer.from(
  config.encryption.key.padEnd(32, '0').substring(0, 32)
);

function encryptToken(plaintext) {
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv(ALGORITHM, ENCRYPTION_KEY, iv);
  let encrypted = cipher.update(plaintext, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  const authTag = cipher.getAuthTag();
  return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted}`;
}

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

// ─── GET /api/accounts ───────────────────────────────────────────────────────
router.get('/', authenticate, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, platform, account_id, account_name, currency, timezone,
              is_active, last_sync_at, sync_error, token_expires_at, scopes, created_at
       FROM ad_accounts
       WHERE tenant_id = $1
       ORDER BY platform, account_name`,
      [req.user.tenantId]
    );
    return res.json({ accounts: result.rows });
  } catch (err) {
    console.error('[Accounts] List error:', err.message);
    return res.status(500).json({ error: 'Failed to fetch accounts' });
  }
});

// ─── DELETE /api/accounts/:id ────────────────────────────────────────────────
router.delete('/:id', authenticate, async (req, res) => {
  try {
    const result = await pool.query(
      `DELETE FROM ad_accounts WHERE id = $1 AND tenant_id = $2 RETURNING id, platform`,
      [req.params.id, req.user.tenantId]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Account not found' });
    }
    return res.json({ message: 'Account disconnected', account: result.rows[0] });
  } catch (err) {
    console.error('[Accounts] Delete error:', err.message);
    return res.status(500).json({ error: 'Failed to disconnect account' });
  }
});

// ════════════════════════════════════════════════════════════════════════════
// META ADS OAUTH
// ════════════════════════════════════════════════════════════════════════════

// GET /api/accounts/meta/connect - initiate OAuth
router.get('/meta/connect', authenticate, (req, res) => {
  const state = Buffer.from(JSON.stringify({
    tenantId: req.user.tenantId,
    userId: req.user.id,
    nonce: crypto.randomBytes(16).toString('hex'),
  })).toString('base64url');

  const params = new URLSearchParams({
    client_id: config.meta.appId,
    redirect_uri: config.meta.redirectUri,
    scope: config.meta.scope,
    response_type: 'code',
    state,
  });

  const authUrl = `https://www.facebook.com/${config.meta.apiVersion}/dialog/oauth?${params.toString()}`;
  return res.json({ authUrl });
});

// GET /api/accounts/meta/callback - OAuth callback
router.get('/meta/callback', async (req, res) => {
  const { code, state, error: oauthError } = req.query;

  if (oauthError) {
    return res.redirect(`${config.cors.origin}/settings?error=meta_denied`);
  }

  let stateData;
  try {
    stateData = JSON.parse(Buffer.from(state, 'base64url').toString());
  } catch {
    return res.redirect(`${config.cors.origin}/settings?error=invalid_state`);
  }

  try {
    // Exchange code for token
    const tokenRes = await axios.get(
      `https://graph.facebook.com/${config.meta.apiVersion}/oauth/access_token`,
      {
        params: {
          client_id: config.meta.appId,
          client_secret: config.meta.appSecret,
          redirect_uri: config.meta.redirectUri,
          code,
        },
      }
    );

    const { access_token, expires_in } = tokenRes.data;

    // Exchange for long-lived token
    const longLivedRes = await axios.get(
      `https://graph.facebook.com/${config.meta.apiVersion}/oauth/access_token`,
      {
        params: {
          grant_type: 'fb_exchange_token',
          client_id: config.meta.appId,
          client_secret: config.meta.appSecret,
          fb_exchange_token: access_token,
        },
      }
    );

    const longLivedToken = longLivedRes.data.access_token;
    const longLivedExpiry = longLivedRes.data.expires_in || 5184000; // 60 days

    // Fetch ad accounts
    const adAccountsRes = await axios.get(
      `https://graph.facebook.com/${config.meta.apiVersion}/me/adaccounts`,
      {
        params: {
          fields: 'id,name,account_id,currency,timezone_name',
          access_token: longLivedToken,
          limit: 50,
        },
      }
    );

    const adAccounts = adAccountsRes.data.data || [];
    const encryptedToken = encryptToken(longLivedToken);
    const expiresAt = new Date(Date.now() + longLivedExpiry * 1000);

    // Upsert all ad accounts
    for (const account of adAccounts) {
      await pool.query(
        `INSERT INTO ad_accounts
           (tenant_id, platform, account_id, account_name, currency, timezone,
            encrypted_access_token, token_expires_at, scopes, is_active)
         VALUES ($1, 'meta', $2, $3, $4, $5, $6, $7, $8, true)
         ON CONFLICT (tenant_id, platform, account_id)
         DO UPDATE SET
           account_name = EXCLUDED.account_name,
           encrypted_access_token = EXCLUDED.encrypted_access_token,
           token_expires_at = EXCLUDED.token_expires_at,
           is_active = true,
           updated_at = NOW()`,
        [
          stateData.tenantId,
          account.account_id || account.id.replace('act_', ''),
          account.name,
          account.currency,
          account.timezone_name,
          encryptedToken,
          expiresAt,
          config.meta.scope.split(','),
        ]
      );
    }

    return res.redirect(`${config.cors.origin}/settings?success=meta_connected&accounts=${adAccounts.length}`);
  } catch (err) {
    console.error('[Accounts] Meta OAuth error:', err.response?.data || err.message);
    return res.redirect(`${config.cors.origin}/settings?error=meta_oauth_failed`);
  }
});

// ════════════════════════════════════════════════════════════════════════════
// GOOGLE ADS OAUTH
// ════════════════════════════════════════════════════════════════════════════

// GET /api/accounts/google/connect
router.get('/google/connect', authenticate, (req, res) => {
  const state = Buffer.from(JSON.stringify({
    tenantId: req.user.tenantId,
    userId: req.user.id,
    nonce: crypto.randomBytes(16).toString('hex'),
  })).toString('base64url');

  const params = new URLSearchParams({
    client_id: config.google.clientId,
    redirect_uri: config.google.redirectUri,
    scope: config.google.scope.join(' '),
    response_type: 'code',
    access_type: 'offline',
    prompt: 'consent',
    state,
  });

  const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
  return res.json({ authUrl });
});

// GET /api/accounts/google/callback
router.get('/google/callback', async (req, res) => {
  const { code, state, error: oauthError } = req.query;

  if (oauthError) {
    return res.redirect(`${config.cors.origin}/settings?error=google_denied`);
  }

  let stateData;
  try {
    stateData = JSON.parse(Buffer.from(state, 'base64url').toString());
  } catch {
    return res.redirect(`${config.cors.origin}/settings?error=invalid_state`);
  }

  try {
    const tokenRes = await axios.post('https://oauth2.googleapis.com/token', {
      code,
      client_id: config.google.clientId,
      client_secret: config.google.clientSecret,
      redirect_uri: config.google.redirectUri,
      grant_type: 'authorization_code',
    });

    const { access_token, refresh_token, expires_in } = tokenRes.data;

    // Get user profile
    const profileRes = await axios.get('https://www.googleapis.com/oauth2/v2/userinfo', {
      headers: { Authorization: `Bearer ${access_token}` },
    });
    const email = profileRes.data.email;

    const encryptedAccess = encryptToken(access_token);
    const encryptedRefresh = refresh_token ? encryptToken(refresh_token) : null;
    const expiresAt = new Date(Date.now() + (expires_in || 3600) * 1000);

    // Fetch Google Ads customer IDs (optional — requires developer token + Google Ads account)
    let resourceNames = [];
    if (config.google.developerToken) {
      try {
        const customersRes = await axios.get(
          'https://googleads.googleapis.com/v15/customers:listAccessibleCustomers',
          {
            headers: {
              Authorization: `Bearer ${access_token}`,
              'developer-token': config.google.developerToken,
            },
          }
        );
        resourceNames = customersRes.data.resourceNames || [];
      } catch (adsErr) {
        console.warn('[Accounts] Google Ads customer fetch skipped:', adsErr.response?.data?.error?.message || adsErr.message);
      }
    }

    if (resourceNames.length > 0) {
      for (const resourceName of resourceNames) {
        const customerId = resourceName.replace('customers/', '');

        await pool.query(
          `INSERT INTO ad_accounts
             (tenant_id, platform, account_id, account_name, encrypted_access_token,
              encrypted_refresh_token, token_expires_at, scopes, is_active, metadata)
           VALUES ($1, 'google', $2, $3, $4, $5, $6, $7, true, $8)
           ON CONFLICT (tenant_id, platform, account_id)
           DO UPDATE SET
             encrypted_access_token = EXCLUDED.encrypted_access_token,
             encrypted_refresh_token = COALESCE(EXCLUDED.encrypted_refresh_token, ad_accounts.encrypted_refresh_token),
             token_expires_at = EXCLUDED.token_expires_at,
             is_active = true,
             updated_at = NOW()`,
          [
            stateData.tenantId,
            customerId,
            `Google Ads - ${email}`,
            encryptedAccess,
            encryptedRefresh,
            expiresAt,
            config.google.scope,
            JSON.stringify({ email }),
          ]
        );
      }
    } else {
      // Save as a generic Google connection without a specific Ads account ID
      await pool.query(
        `INSERT INTO ad_accounts
           (tenant_id, platform, account_id, account_name, encrypted_access_token,
            encrypted_refresh_token, token_expires_at, scopes, is_active, metadata)
         VALUES ($1, 'google', $2, $3, $4, $5, $6, $7, true, $8)
         ON CONFLICT (tenant_id, platform, account_id)
         DO UPDATE SET
           encrypted_access_token = EXCLUDED.encrypted_access_token,
           encrypted_refresh_token = COALESCE(EXCLUDED.encrypted_refresh_token, ad_accounts.encrypted_refresh_token),
           token_expires_at = EXCLUDED.token_expires_at,
           is_active = true,
           updated_at = NOW()`,
        [
          stateData.tenantId,
          `google_${email}`,
          `Google - ${email}`,
          encryptedAccess,
          encryptedRefresh,
          expiresAt,
          config.google.scope,
          JSON.stringify({ email }),
        ]
      );
    }

    return res.redirect(
      `${config.cors.origin}/settings?success=google_connected&accounts=${resourceNames.length || 1}`
    );
  } catch (err) {
    console.error('[Accounts] Google OAuth error:', err.response?.data || err.message);
    return res.redirect(`${config.cors.origin}/settings?error=google_oauth_failed`);
  }
});

// ════════════════════════════════════════════════════════════════════════════
// TIKTOK ADS OAUTH
// ════════════════════════════════════════════════════════════════════════════

// GET /api/accounts/tiktok/connect
router.get('/tiktok/connect', authenticate, (req, res) => {
  const state = Buffer.from(JSON.stringify({
    tenantId: req.user.tenantId,
    userId: req.user.id,
    nonce: crypto.randomBytes(16).toString('hex'),
  })).toString('base64url');

  const params = new URLSearchParams({
    app_id: config.tiktok.appId,
    redirect_uri: config.tiktok.redirectUri,
    state,
    scope: config.tiktok.scope,
    response_type: 'code',
  });

  const authUrl = `https://ads.tiktok.com/marketing_api/auth?${params.toString()}`;
  return res.json({ authUrl });
});

// GET /api/accounts/tiktok/callback
router.get('/tiktok/callback', async (req, res) => {
  const { code, state, error: oauthError } = req.query;

  if (oauthError) {
    return res.redirect(`${config.cors.origin}/settings?error=tiktok_denied`);
  }

  let stateData;
  try {
    stateData = JSON.parse(Buffer.from(state, 'base64url').toString());
  } catch {
    return res.redirect(`${config.cors.origin}/settings?error=invalid_state`);
  }

  try {
    const tokenRes = await axios.post(
      `${config.tiktok.apiBaseUrl}/oauth2/access_token/`,
      {
        app_id: config.tiktok.appId,
        secret: config.tiktok.appSecret,
        auth_code: code,
        grant_type: 'authorization_code',
      }
    );

    const { access_token, advertiser_ids } = tokenRes.data.data;

    const encryptedToken = encryptToken(access_token);

    // Fetch advertiser info for each account
    for (const advertiserId of (advertiser_ids || [])) {
      const infoRes = await axios.get(
        `${config.tiktok.apiBaseUrl}/advertiser/info/`,
        {
          params: {
            advertiser_ids: JSON.stringify([advertiserId]),
          },
          headers: {
            'Access-Token': access_token,
          },
        }
      );

      const advertiserInfo = infoRes.data.data?.list?.[0] || {};

      await pool.query(
        `INSERT INTO ad_accounts
           (tenant_id, platform, account_id, account_name, currency, timezone,
            encrypted_access_token, scopes, is_active)
         VALUES ($1, 'tiktok', $2, $3, $4, $5, $6, $7, true)
         ON CONFLICT (tenant_id, platform, account_id)
         DO UPDATE SET
           account_name = EXCLUDED.account_name,
           encrypted_access_token = EXCLUDED.encrypted_access_token,
           is_active = true,
           updated_at = NOW()`,
        [
          stateData.tenantId,
          advertiserId,
          advertiserInfo.advertiser_name || `TikTok Account ${advertiserId}`,
          advertiserInfo.currency || 'USD',
          advertiserInfo.timezone || 'UTC',
          encryptedToken,
          config.tiktok.scope.split(','),
        ]
      );
    }

    return res.redirect(
      `${config.cors.origin}/settings?success=tiktok_connected&accounts=${(advertiser_ids || []).length}`
    );
  } catch (err) {
    console.error('[Accounts] TikTok OAuth error:', err.response?.data || err.message);
    return res.redirect(`${config.cors.origin}/settings?error=tiktok_oauth_failed`);
  }
});

module.exports = router;
module.exports.decryptToken = decryptToken;
