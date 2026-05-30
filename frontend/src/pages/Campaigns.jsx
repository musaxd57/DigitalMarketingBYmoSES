import { useState, useEffect } from 'react';
import { campaignsAPI, accountsAPI } from '../services/api';

const PLATFORM_COLORS = { meta: '#1877f2', google: '#4285f4', tiktok: '#ff0050' };

function StatusBadge({ status }) {
  const styles = {
    active: 'bg-[#00ff88]/10 text-[#00ff88] border-[#00ff88]/20',
    paused: 'bg-yellow-500/10 text-yellow-400 border-yellow-500/20',
    draft: 'bg-white/5 text-[#666] border-white/10',
    deleted: 'bg-red-500/10 text-red-400 border-red-500/20',
    archived: 'bg-white/5 text-[#555] border-white/10',
  };
  return (
    <span className={`inline-flex items-center gap-1 text-xs font-mono px-2 py-0.5 rounded border ${styles[status] || styles.draft}`}>
      {status === 'active' && <span className="w-1.5 h-1.5 rounded-full bg-[#00ff88] animate-pulse" />}
      {status?.toUpperCase()}
    </span>
  );
}

const OBJECTIVES = {
  meta: ['TRAFFIC', 'CONVERSIONS', 'BRAND_AWARENESS', 'ENGAGEMENT', 'LEAD_GENERATION', 'VIDEO_VIEWS'],
  google: ['TRAFFIC', 'CONVERSIONS', 'BRAND_AWARENESS', 'LEAD_GENERATION'],
  tiktok: ['TRAFFIC', 'CONVERSIONS', 'BRAND_AWARENESS', 'VIDEO_VIEWS'],
};

function CreateCampaignModal({ onClose, onCreated, accounts }) {
  const [form, setForm] = useState({
    name: '',
    platform: '',
    adAccountId: '',
    objective: 'TRAFFIC',
    budgetType: 'daily',
    budgetAmount: '150',
    startDate: new Date().toISOString().split('T')[0],
    endDate: '',
    publishToMeta: false,
    ageMin: '18',
    ageMax: '65',
  });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const filteredAccounts = accounts.filter(
    (a) => !form.platform || a.platform === form.platform
  );

  const set = (key, val) => setForm((f) => ({ ...f, [key]: val }));

  const handlePlatformChange = (val) => {
    setForm((f) => ({ ...f, platform: val, adAccountId: '', objective: 'TRAFFIC', publishToMeta: false }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setSuccess('');
    if (!form.name || !form.platform || !form.adAccountId) {
      setError('Kampanya adı, platform ve hesap zorunludur.');
      return;
    }
    setSubmitting(true);
    try {
      if (form.publishToMeta && form.platform === 'meta') {
        const targeting = {
          geo_locations: { countries: ['TR'] },
          age_min: parseInt(form.ageMin) || 18,
          age_max: parseInt(form.ageMax) || 65,
        };
        const res = await campaignsAPI.publishMeta({
          adAccountId: form.adAccountId,
          name: form.name,
          objective: form.objective || 'TRAFFIC',
          dailyBudget: parseFloat(form.budgetAmount) || 150,
          targeting,
          startDate: form.startDate || null,
        });
        setSuccess(res.data.message || 'Meta Ads\'te oluşturuldu!');
        setTimeout(() => { onCreated(); }, 1500);
      } else {
        await campaignsAPI.create({
          adAccountId: form.adAccountId,
          name: form.name,
          platform: form.platform,
          objective: form.objective || null,
          budgetType: form.budgetType,
          budgetAmount: form.budgetAmount ? parseFloat(form.budgetAmount) : null,
          startDate: form.startDate || null,
          endDate: form.endDate || null,
        });
        onCreated();
      }
    } catch (err) {
      setError(err.response?.data?.error || err.message);
    } finally {
      setSubmitting(false);
    }
  };

  const inputCls = 'w-full bg-[#0d0d14] border border-white/10 text-white text-sm rounded-lg px-3 py-2.5 focus:outline-none focus:border-[#00ff88]/50 placeholder-[#444]';
  const labelCls = 'block text-[#888] text-xs font-mono mb-1.5';

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-[#111118] border border-white/10 rounded-2xl w-full max-w-lg shadow-2xl max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between px-6 py-4 border-b border-white/5">
          <h2 className="text-white font-semibold">Yeni Kampanya Oluştur</h2>
          <button onClick={onClose} className="text-[#555] hover:text-white transition-colors text-xl leading-none">×</button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {error && (
            <div className="bg-red-500/10 border border-red-500/20 rounded-lg px-4 py-3 text-red-400 text-sm">{error}</div>
          )}
          {success && (
            <div className="bg-[#00ff88]/10 border border-[#00ff88]/20 rounded-lg px-4 py-3 text-[#00ff88] text-sm flex items-center gap-2">
              <span>✓</span> {success}
            </div>
          )}

          <div>
            <label className={labelCls}>Kampanya Adı *</label>
            <input className={inputCls} placeholder="örn. İlliyyun Ambalaj - Web Trafiği" required
              value={form.name} onChange={(e) => set('name', e.target.value)} />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelCls}>Platform *</label>
              <select className={inputCls} value={form.platform} onChange={(e) => handlePlatformChange(e.target.value)} required>
                <option value="">Seç</option>
                <option value="meta">Meta Ads</option>
                <option value="google">Google Ads</option>
                <option value="tiktok">TikTok Ads</option>
              </select>
            </div>
            <div>
              <label className={labelCls}>Reklam Hesabı *</label>
              <select className={inputCls} value={form.adAccountId} onChange={(e) => set('adAccountId', e.target.value)} required>
                <option value="">Seç</option>
                {filteredAccounts.map((a) => (
                  <option key={a.id} value={a.id}>{a.account_name}</option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <label className={labelCls}>Hedef</label>
            <select className={inputCls} value={form.objective} onChange={(e) => set('objective', e.target.value)}>
              {(OBJECTIVES[form.platform] || ['TRAFFIC', 'CONVERSIONS', 'BRAND_AWARENESS']).map((o) => (
                <option key={o} value={o}>{o.replace(/_/g, ' ')}</option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelCls}>Günlük Bütçe (TRY)</label>
              <input type="number" className={inputCls} placeholder="150" min="50"
                value={form.budgetAmount} onChange={(e) => set('budgetAmount', e.target.value)} />
            </div>
            <div>
              <label className={labelCls}>Başlangıç Tarihi</label>
              <input type="date" className={inputCls}
                value={form.startDate} onChange={(e) => set('startDate', e.target.value)} />
            </div>
          </div>

          {/* Meta Publish Toggle */}
          {form.platform === 'meta' && (
            <div className="border border-[#00ff88]/20 rounded-xl p-4 bg-[#00ff88]/5">
              <label className="flex items-center gap-3 cursor-pointer">
                <input type="checkbox" checked={form.publishToMeta}
                  onChange={(e) => set('publishToMeta', e.target.checked)}
                  className="w-4 h-4 accent-[#00ff88]" />
                <div>
                  <p className="text-[#00ff88] text-sm font-medium">Meta Ads'te Yayınla</p>
                  <p className="text-[#666] text-xs">Kampanya doğrudan Facebook Ads Manager'a gönderilir (duraklatılmış)</p>
                </div>
              </label>

              {form.publishToMeta && (
                <div className="mt-4 space-y-3">
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className={labelCls}>Min. Yaş</label>
                      <input type="number" className={inputCls} min="18" max="65"
                        value={form.ageMin} onChange={(e) => set('ageMin', e.target.value)} />
                    </div>
                    <div>
                      <label className={labelCls}>Max. Yaş</label>
                      <input type="number" className={inputCls} min="18" max="65"
                        value={form.ageMax} onChange={(e) => set('ageMax', e.target.value)} />
                    </div>
                  </div>
                  <p className="text-[#555] text-xs">Konum: Türkiye (varsayılan)</p>
                </div>
              )}
            </div>
          )}

          <div className="flex gap-3 pt-2">
            <button type="button" onClick={onClose}
              className="flex-1 py-2.5 rounded-xl border border-white/10 text-[#888] text-sm hover:text-white hover:border-white/20 transition-all">
              İptal
            </button>
            <button type="submit" disabled={submitting}
              className="flex-1 py-2.5 rounded-xl bg-[#00ff88]/10 border border-[#00ff88]/30 text-[#00ff88] font-semibold text-sm hover:bg-[#00ff88]/20 transition-all disabled:opacity-50 flex items-center justify-center gap-2">
              {submitting ? (
                <div className="w-4 h-4 border-2 border-[#00ff88] border-t-transparent rounded-full animate-spin" />
              ) : form.publishToMeta ? '🚀 Meta\'ya Yayınla' : 'Kaydet'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default function Campaigns() {
  const [campaigns, setCampaigns] = useState([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [filter, setFilter] = useState({ platform: '', status: '' });
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [adAccounts, setAdAccounts] = useState([]);
  const [activeTab, setActiveTab] = useState('campaigns');
  const LIMIT = 25;

  // Optimization state
  const [optimizing, setOptimizing] = useState(false);
  const [optResult, setOptResult] = useState(null);
  const [applyingId, setApplyingId] = useState(null);
  const [appliedIds, setAppliedIds] = useState({});
  const [reportEmail, setReportEmail] = useState('');
  const [sendingReport, setSendingReport] = useState(false);
  const [reportSent, setReportSent] = useState(false);

  useEffect(() => {
    accountsAPI.list().then((res) => setAdAccounts(res.data.accounts || [])).catch(() => {});
  }, []);

  const fetchCampaigns = async () => {
    setLoading(true);
    try {
      const res = await campaignsAPI.list({
        page,
        limit: LIMIT,
        ...(filter.platform ? { platform: filter.platform } : {}),
        ...(filter.status ? { status: filter.status } : {}),
      });
      setCampaigns(res.data.campaigns || []);
      setTotal(res.data.total || 0);
    } catch (err) {
      console.error('[Campaigns] Fetch error:', err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchCampaigns(); }, [page, filter]);

  const handleSync = async () => {
    setSyncing(true);
    try {
      const res = await campaignsAPI.sync({});
      const synced = res.data.syncResults?.reduce((acc, r) => acc + (r.campaignsSynced || 0), 0) || 0;
      await fetchCampaigns();
      alert(`Sync complete. ${synced} campaigns updated.`);
    } catch (err) {
      alert(`Sync failed: ${err.response?.data?.error || err.message}`);
    } finally {
      setSyncing(false);
    }
  };

  const totalPages = Math.ceil(total / LIMIT);

  const handleOptimize = async () => {
    setOptimizing(true);
    setOptResult(null);
    try {
      const res = await campaignsAPI.optimize({ days: 14 });
      setOptResult(res.data);
    } catch (err) {
      alert(err.response?.data?.error || err.message);
    } finally {
      setOptimizing(false);
    }
  };

  const handleApply = async (rec) => {
    setApplyingId(rec.campaignId);
    try {
      const res = await campaignsAPI.applyOptimization({
        campaignId: rec.campaignId,
        action: rec.action,
        newBudget: rec.newBudget,
        adAccountId: rec.adAccountId,
        externalId: rec.externalId,
      });
      setAppliedIds((prev) => ({ ...prev, [rec.campaignId]: res.data.message }));
      fetchCampaigns();
    } catch (err) {
      setAppliedIds((prev) => ({ ...prev, [rec.campaignId]: `Hata: ${err.response?.data?.error || err.message}` }));
    } finally {
      setApplyingId(null);
    }
  };

  const handleSendReport = async () => {
    setSendingReport(true);
    setReportSent(false);
    try {
      await campaignsAPI.weeklyReport({ email: reportEmail });
      setReportSent(true);
    } catch (err) {
      alert(err.response?.data?.error || err.message);
    } finally {
      setSendingReport(false);
    }
  };

  const ACTION_LABEL = {
    increase_budget: { label: 'Bütçe Artır', color: '#00ff88' },
    decrease_budget: { label: 'Bütçe Düşür', color: '#facc15' },
    pause: { label: 'Durdur', color: '#f87171' },
    refresh_creative: { label: 'Kreatif Yenile', color: '#a78bfa' },
    keep: { label: 'Koru', color: '#475569' },
  };

  return (
    <div className="p-6 space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-white text-xl font-semibold">Kampanyalar</h1>
          <p className="text-[#555] text-sm">{total} kampanya · tüm platformlar</p>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={() => setShowCreateModal(true)}
            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-white/5 border border-white/10 text-white text-sm font-medium hover:bg-white/10 transition-all"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            Yeni Kampanya
          </button>
          <button
            onClick={handleSync}
            disabled={syncing}
            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-[#00ff88]/10 border border-[#00ff88]/30 text-[#00ff88] text-sm font-medium hover:bg-[#00ff88]/20 transition-all disabled:opacity-50"
          >
            {syncing ? (
              <div className="w-4 h-4 border-2 border-[#00ff88] border-t-transparent rounded-full animate-spin" />
            ) : (
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
            )}
            {syncing ? 'Syncing...' : 'Sync Now'}
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-[#0d0d14] rounded-xl p-1 border border-white/5 w-fit">
        {[['campaigns', 'Kampanyalar'], ['optimize', '⚡ Optimizasyon']].map(([key, label]) => (
          <button key={key} onClick={() => setActiveTab(key)}
            className={`py-2 px-4 rounded-lg text-sm font-medium transition-all
              ${activeTab === key ? 'bg-[#00ff88]/10 text-[#00ff88] border border-[#00ff88]/20' : 'text-[#555] hover:text-[#888]'}`}>
            {label}
          </button>
        ))}
      </div>

      {/* Optimization Tab */}
      {activeTab === 'optimize' && (
        <div className="space-y-4">
          <div className="flex items-center gap-3">
            <button
              onClick={handleOptimize}
              disabled={optimizing}
              className="flex items-center gap-2 px-5 py-2.5 rounded-lg bg-[#00ff88]/10 border border-[#00ff88]/30 text-[#00ff88] text-sm font-medium hover:bg-[#00ff88]/20 transition-all disabled:opacity-50"
            >
              {optimizing ? <div className="w-4 h-4 border-2 border-[#00ff88] border-t-transparent rounded-full animate-spin" /> : '⚡'}
              {optimizing ? 'Analiz ediliyor...' : 'AI ile Analiz Et (Son 14 Gün)'}
            </button>
            {optResult && (
              <span className="text-[#555] text-xs font-mono">{optResult.campaignCount} kampanya · {optResult.analyzedDays} gün</span>
            )}
          </div>

          {optResult && (
            <>
              {optResult.summary && (
                <div className="bg-[#111118] border border-[#00ff88]/10 rounded-xl p-4">
                  <p className="text-[#555] text-xs font-mono uppercase tracking-wider mb-2">AI Özeti</p>
                  <p className="text-[#94a3b8] text-sm leading-relaxed">{optResult.summary}</p>
                </div>
              )}

              <div className="space-y-3">
                {optResult.recommendations.map((rec) => {
                  const act = ACTION_LABEL[rec.action] || ACTION_LABEL.keep;
                  const applied = appliedIds[rec.campaignId];
                  return (
                    <div key={rec.campaignId}
                      className={`bg-[#111118] rounded-xl border p-4 ${rec.priority === 'high' ? 'border-red-500/20' : rec.priority === 'medium' ? 'border-yellow-500/20' : 'border-white/5'}`}>
                      <div className="flex items-start justify-between gap-4">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-1 flex-wrap">
                            <span className="text-white text-sm font-medium truncate">{rec.campaignName}</span>
                            <span className="text-xs px-1.5 py-0.5 rounded font-mono capitalize"
                              style={{ background: `${PLATFORM_COLORS[rec.platform]}22`, color: PLATFORM_COLORS[rec.platform] }}>
                              {rec.platform}
                            </span>
                            <span className="text-xs px-1.5 py-0.5 rounded font-mono"
                              style={{ background: `${act.color}18`, color: act.color }}>
                              {act.label}
                            </span>
                            {rec.priority === 'high' && (
                              <span className="text-xs px-1.5 py-0.5 rounded font-mono bg-red-500/10 text-red-400">KRİTİK</span>
                            )}
                          </div>
                          <p className="text-[#666] text-xs mb-2">{rec.reason}</p>
                          <div className="flex items-center gap-4 text-xs font-mono">
                            <span className="text-[#555]">Harcama: <span className="text-[#888]">{rec.metrics.spend} TRY</span></span>
                            <span className="text-[#555]">ROAS: <span style={{ color: rec.metrics.roas >= 2 ? '#00ff88' : rec.metrics.roas >= 1 ? '#facc15' : '#f87171' }}>{rec.metrics.roas}x</span></span>
                            <span className="text-[#555]">CTR: <span className="text-[#888]">{rec.metrics.ctr}%</span></span>
                            {rec.currentBudget > 0 && (
                              <span className="text-[#555]">Bütçe: <span className="text-[#888]">{rec.currentBudget} TRY</span>
                                {rec.newBudget && <span style={{ color: act.color }}> → {rec.newBudget} TRY</span>}
                              </span>
                            )}
                          </div>
                        </div>
                        <div className="flex-shrink-0">
                          {applied ? (
                            <span className="text-xs text-[#00ff88] bg-[#00ff88]/10 px-3 py-1.5 rounded-lg">{applied}</span>
                          ) : rec.action !== 'keep' && rec.action !== 'refresh_creative' ? (
                            <button
                              onClick={() => handleApply(rec)}
                              disabled={applyingId === rec.campaignId}
                              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border transition-all disabled:opacity-50"
                              style={{ background: `${act.color}18`, color: act.color, borderColor: `${act.color}40` }}
                            >
                              {applyingId === rec.campaignId ? <div className="w-3 h-3 border border-current border-t-transparent rounded-full animate-spin" /> : null}
                              Uygula
                            </button>
                          ) : null}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Weekly report section */}
              <div className="bg-[#111118] border border-white/5 rounded-xl p-4 mt-2">
                <p className="text-white text-sm font-medium mb-3">Haftalık Rapor Gönder</p>
                <div className="flex gap-3 items-center">
                  <input
                    type="email"
                    placeholder="E-posta adresi"
                    value={reportEmail}
                    onChange={(e) => setReportEmail(e.target.value)}
                    className="flex-1 bg-[#0d0d14] border border-white/10 text-white text-sm rounded-lg px-3 py-2 focus:outline-none focus:border-[#00ff88]/40"
                  />
                  <button
                    onClick={handleSendReport}
                    disabled={sendingReport || !reportEmail}
                    className="px-4 py-2 rounded-lg bg-[#00ff88]/10 border border-[#00ff88]/30 text-[#00ff88] text-sm hover:bg-[#00ff88]/20 transition-all disabled:opacity-50 whitespace-nowrap"
                  >
                    {sendingReport ? 'Gönderiliyor...' : '📧 Rapor Gönder'}
                  </button>
                </div>
                {reportSent && <p className="text-[#00ff88] text-xs mt-2">✓ Rapor gönderildi!</p>}
                <p className="text-[#333] text-xs mt-1.5">SMTP yapılandırılmamışsa rapor indirme olarak döner.</p>
              </div>
            </>
          )}

          {!optResult && !optimizing && (
            <div className="bg-[#111118] border border-white/5 rounded-xl p-12 flex flex-col items-center gap-3">
              <span className="text-4xl">⚡</span>
              <p className="text-[#444] text-sm">Kampanyalarını analiz et, AI önerileri al</p>
              <p className="text-[#333] text-xs">Son 14 günün ROAS, CTR ve dönüşüm verilerine göre bütçe optimizasyonu</p>
            </div>
          )}
        </div>
      )}

      {/* Filters — only shown on campaigns tab */}
      {activeTab === 'campaigns' && <div className="flex items-center gap-3">
        <select
          value={filter.platform}
          onChange={(e) => { setFilter((f) => ({ ...f, platform: e.target.value })); setPage(1); }}
          className="bg-[#111118] border border-white/5 text-[#888] text-sm rounded-lg px-3 py-2 focus:outline-none focus:border-[#00ff88]/30"
        >
          <option value="">All Platforms</option>
          <option value="meta">Meta</option>
          <option value="google">Google</option>
          <option value="tiktok">TikTok</option>
        </select>
        <select
          value={filter.status}
          onChange={(e) => { setFilter((f) => ({ ...f, status: e.target.value })); setPage(1); }}
          className="bg-[#111118] border border-white/5 text-[#888] text-sm rounded-lg px-3 py-2 focus:outline-none focus:border-[#00ff88]/30"
        >
          <option value="">All Statuses</option>
          <option value="active">Active</option>
          <option value="paused">Paused</option>
          <option value="draft">Draft</option>
          <option value="archived">Archived</option>
        </select>
      </div>}

      {activeTab === 'campaigns' && (
      <>{/* Table */}
      <div className="bg-[#111118] rounded-xl border border-white/5 overflow-hidden">
        <div className="overflow-x-auto">
          {loading ? (
            <div className="p-5 space-y-3">
              {[...Array(8)].map((_, i) => (
                <div key={i} className="h-12 bg-white/3 animate-pulse rounded" />
              ))}
            </div>
          ) : campaigns.length === 0 ? (
            <div className="p-16 text-center">
              <div className="w-16 h-16 rounded-full bg-white/3 flex items-center justify-center mx-auto mb-4">
                <svg className="w-8 h-8 text-[#333]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                    d="M11 3.055A9.001 9.001 0 1020.945 13H11V3.055z" />
                </svg>
              </div>
              <p className="text-[#444] text-sm">No campaigns found</p>
              <p className="text-[#333] text-xs mt-1">Connect an ad account or adjust filters</p>
            </div>
          ) : (
            <table className="w-full">
              <thead>
                <tr className="border-b border-white/5">
                  {['Campaign', 'Platform', 'Status', 'Budget', 'Spend', 'ROAS', 'CTR', 'CPA', 'Conversions', 'Last Synced'].map((h) => (
                    <th key={h} className="px-4 py-3 text-left text-[#444] text-xs font-mono whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-white/3">
                {campaigns.map((c) => (
                  <tr key={c.id} className="hover:bg-white/2 transition-colors">
                    <td className="px-4 py-3 min-w-[200px]">
                      <div className="text-white text-sm font-medium truncate max-w-[250px]">{c.name}</div>
                      <div className="text-[#444] text-xs font-mono mt-0.5">{c.account_name || c.external_id}</div>
                    </td>
                    <td className="px-4 py-3">
                      <span className="text-xs font-mono font-semibold"
                        style={{ color: PLATFORM_COLORS[c.platform] || '#888' }}>
                        {c.platform?.toUpperCase()}
                      </span>
                    </td>
                    <td className="px-4 py-3"><StatusBadge status={c.status} /></td>
                    <td className="px-4 py-3 text-[#888] text-sm font-mono whitespace-nowrap">
                      {c.budget_amount
                        ? `$${parseFloat(c.budget_amount).toFixed(0)}/${c.budget_type === 'daily' ? 'd' : 'lt'}`
                        : '—'}
                    </td>
                    <td className="px-4 py-3 text-[#888] text-sm font-mono">${parseFloat(c.spend || 0).toFixed(2)}</td>
                    <td className="px-4 py-3">
                      <span className={`text-sm font-bold font-mono ${parseFloat(c.roas) >= 2 ? 'text-[#00ff88]' : parseFloat(c.roas) >= 1 ? 'text-[#ffd700]' : 'text-[#666]'}`}>
                        {parseFloat(c.roas || 0).toFixed(2)}x
                      </span>
                    </td>
                    <td className="px-4 py-3 text-[#888] text-sm font-mono">{(parseFloat(c.ctr || 0) * 100).toFixed(2)}%</td>
                    <td className="px-4 py-3 text-[#888] text-sm font-mono">${parseFloat(c.cpa || 0).toFixed(2)}</td>
                    <td className="px-4 py-3 text-[#888] text-sm font-mono">{parseInt(c.conversions || 0).toLocaleString()}</td>
                    <td className="px-4 py-3 text-[#444] text-xs font-mono">
                      {c.last_synced_at
                        ? new Date(c.last_synced_at).toLocaleDateString()
                        : 'Never'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between px-5 py-3 border-t border-white/5">
            <span className="text-[#555] text-xs font-mono">
              {(page - 1) * LIMIT + 1}–{Math.min(page * LIMIT, total)} of {total}
            </span>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page === 1}
                className="px-3 py-1.5 rounded text-xs text-[#666] border border-white/5 disabled:opacity-30 hover:text-white hover:border-white/10 transition-all"
              >
                ← Prev
              </button>
              <span className="text-[#555] text-xs font-mono">{page}/{totalPages}</span>
              <button
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={page === totalPages}
                className="px-3 py-1.5 rounded text-xs text-[#666] border border-white/5 disabled:opacity-30 hover:text-white hover:border-white/10 transition-all"
              >
                Next →
              </button>
            </div>
          </div>
        )}
      </div>
      </>)}

      {showCreateModal && (
        <CreateCampaignModal
          onClose={() => setShowCreateModal(false)}
          onCreated={() => { setShowCreateModal(false); fetchCampaigns(); }}
          accounts={adAccounts}
        />
      )}
    </div>
  );
}
