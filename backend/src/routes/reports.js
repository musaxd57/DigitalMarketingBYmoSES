const express = require('express');
const nodemailer = require('nodemailer');
const router = express.Router();
const { pool } = require('../models/db');
const { authenticate } = require('../middleware/auth');
const config = require('../config');

function createTransporter() {
  return nodemailer.createTransport({
    host: config.email.host,
    port: config.email.port,
    secure: config.email.port === 465,
    auth: { user: config.email.user, pass: config.email.pass },
  });
}

function buildReportHtml({ period, metrics, topCampaigns, recipientName }) {
  const fmt = (n, type) => {
    if (type === 'currency') return `$${parseFloat(n || 0).toFixed(2)}`;
    if (type === 'pct') return `${(parseFloat(n || 0) * 100).toFixed(2)}%`;
    if (type === 'x') return `${parseFloat(n || 0).toFixed(2)}x`;
    return String(parseInt(n || 0));
  };

  const kpis = [
    { label: 'ROAS', value: fmt(metrics.roas, 'x'), color: '#00ff88' },
    { label: 'Toplam Harcama', value: fmt(metrics.totalSpend, 'currency'), color: '#00aaff' },
    { label: 'Gelir', value: fmt(metrics.totalRevenue, 'currency'), color: '#9d4edd' },
    { label: 'CTR', value: fmt(metrics.ctr, 'pct'), color: '#ffd700' },
    { label: 'CPA', value: fmt(metrics.cpa, 'currency'), color: '#ff8c00' },
    { label: 'Dönüşümler', value: fmt(metrics.totalConversions, 'int'), color: '#00ff88' },
  ];

  const campaignRows = (topCampaigns || []).slice(0, 5).map(c => `
    <tr>
      <td style="padding:8px 12px;border-bottom:1px solid #222;color:#fff;font-size:13px;">${c.name}</td>
      <td style="padding:8px 12px;border-bottom:1px solid #222;color:#888;font-size:12px;font-family:monospace;">${c.platform?.toUpperCase()}</td>
      <td style="padding:8px 12px;border-bottom:1px solid #222;color:#00ff88;font-size:12px;font-family:monospace;">${fmt(c.roas, 'x')}</td>
      <td style="padding:8px 12px;border-bottom:1px solid #222;color:#888;font-size:12px;font-family:monospace;">${fmt(c.spend, 'currency')}</td>
    </tr>
  `).join('');

  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;background:#08080f;font-family:'Segoe UI',sans-serif;">
  <div style="max-width:600px;margin:0 auto;padding:32px 24px;">
    <div style="background:#111118;border:1px solid rgba(255,255,255,0.08);border-radius:16px;overflow:hidden;">
      <div style="background:linear-gradient(135deg,#00ff8820,#00aaff10);padding:28px 28px 20px;border-bottom:1px solid rgba(255,255,255,0.05);">
        <p style="margin:0;color:#00ff88;font-size:11px;font-family:monospace;letter-spacing:2px;">PERFORMANS RAPORU</p>
        <h1 style="margin:8px 0 4px;color:#fff;font-size:22px;font-weight:700;">Digital Marketing by Moses</h1>
        <p style="margin:0;color:#555;font-size:13px;">${period.start} — ${period.end}</p>
      </div>
      <div style="padding:24px 28px;">
        <p style="margin:0 0 20px;color:#666;font-size:14px;">Merhaba ${recipientName || ''},</p>
        <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px;margin-bottom:28px;">
          ${kpis.map(k => `
            <div style="background:#0d0d14;border:1px solid rgba(255,255,255,0.05);border-radius:10px;padding:14px;">
              <p style="margin:0 0 6px;color:#444;font-size:10px;font-family:monospace;">${k.label}</p>
              <p style="margin:0;color:${k.color};font-size:18px;font-weight:700;font-family:monospace;">${k.value}</p>
            </div>
          `).join('')}
        </div>
        ${topCampaigns?.length ? `
        <h3 style="margin:0 0 12px;color:#888;font-size:11px;font-family:monospace;letter-spacing:1px;">EN İYİ KAMPANYALAR</h3>
        <table style="width:100%;border-collapse:collapse;background:#0d0d14;border-radius:10px;overflow:hidden;">
          <thead><tr>
            <th style="padding:8px 12px;text-align:left;color:#444;font-size:10px;font-family:monospace;">KAMPANYA</th>
            <th style="padding:8px 12px;text-align:left;color:#444;font-size:10px;font-family:monospace;">PLATFORM</th>
            <th style="padding:8px 12px;text-align:left;color:#444;font-size:10px;font-family:monospace;">ROAS</th>
            <th style="padding:8px 12px;text-align:left;color:#444;font-size:10px;font-family:monospace;">HARCAMA</th>
          </tr></thead>
          <tbody>${campaignRows}</tbody>
        </table>` : ''}
        <div style="margin-top:28px;text-align:center;">
          <a href="${config.cors.origin}/analytics"
            style="display:inline-block;padding:12px 28px;background:#00ff8820;border:1px solid #00ff8840;border-radius:10px;color:#00ff88;text-decoration:none;font-size:13px;font-weight:600;">
            Detaylı Analiz →
          </a>
        </div>
      </div>
    </div>
    <p style="text-align:center;color:#333;font-size:11px;margin-top:20px;">Digital Marketing by Moses · Otomatik rapor</p>
  </div>
</body></html>`;
}

// POST /api/reports/send — send performance report to user's email
router.post('/send', authenticate, async (req, res) => {
  if (!config.email.user || !config.email.pass) {
    return res.status(503).json({ error: 'Email not configured. Set SMTP_USER and SMTP_PASS in environment.' });
  }

  try {
    const end = new Date().toISOString().split('T')[0];
    const start = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

    const [overviewRes, topRes, userRes] = await Promise.all([
      pool.query(`
        SELECT
          SUM(impressions) AS total_impressions, SUM(clicks) AS total_clicks,
          SUM(spend) AS total_spend, SUM(conversions) AS total_conversions,
          SUM(conversion_value) AS total_revenue,
          CASE WHEN SUM(spend) > 0 THEN SUM(conversion_value) / SUM(spend) ELSE 0 END AS roas,
          CASE WHEN SUM(impressions) > 0 THEN SUM(clicks)::decimal / SUM(impressions) ELSE 0 END AS ctr,
          CASE WHEN SUM(conversions) > 0 THEN SUM(spend) / SUM(conversions) ELSE 0 END AS cpa
        FROM analytics_snapshots ans
        JOIN campaigns c ON ans.campaign_id = c.id
        WHERE ans.tenant_id = $1 AND ans.snapshot_date BETWEEN $2 AND $3
          AND ans.granularity = 'daily' AND c.external_id NOT LIKE 'DEMO_%'`,
        [req.user.tenantId, start, end]
      ),
      pool.query(`
        SELECT c.name, c.platform,
          SUM(a.spend) AS spend,
          CASE WHEN SUM(a.spend) > 0 THEN SUM(a.conversion_value) / SUM(a.spend) ELSE 0 END AS roas
        FROM campaigns c
        JOIN analytics_snapshots a ON a.campaign_id = c.id
        WHERE c.tenant_id = $1 AND a.snapshot_date BETWEEN $2 AND $3
          AND a.granularity = 'daily' AND c.external_id NOT LIKE 'DEMO_%'
        GROUP BY c.id, c.name, c.platform
        ORDER BY roas DESC LIMIT 5`,
        [req.user.tenantId, start, end]
      ),
      pool.query(`SELECT first_name, last_name, email FROM users WHERE id = $1`, [req.user.id]),
    ]);

    const metrics = {
      roas: overviewRes.rows[0]?.roas || 0,
      totalSpend: overviewRes.rows[0]?.total_spend || 0,
      totalRevenue: overviewRes.rows[0]?.total_revenue || 0,
      ctr: overviewRes.rows[0]?.ctr || 0,
      cpa: overviewRes.rows[0]?.cpa || 0,
      totalConversions: overviewRes.rows[0]?.total_conversions || 0,
    };

    const user = userRes.rows[0];
    const recipientEmail = req.body.email || user?.email;
    if (!recipientEmail) return res.status(400).json({ error: 'No recipient email' });

    const html = buildReportHtml({
      period: { start, end },
      metrics,
      topCampaigns: topRes.rows,
      recipientName: user?.first_name || '',
    });

    const transporter = createTransporter();
    await transporter.sendMail({
      from: `"Digital Marketing by Moses" <${config.email.from}>`,
      to: recipientEmail,
      subject: `Performans Raporu (Son 30 Gün) — ${new Date().toLocaleDateString('tr-TR')}`,
      html,
    });

    return res.json({ message: 'Rapor gönderildi', to: recipientEmail });
  } catch (err) {
    console.error('[Reports] Send error:', err.message);
    return res.status(500).json({ error: 'Email gönderilemedi: ' + err.message });
  }
});

module.exports = router;
