import { useState, useEffect } from 'react';
import { campaignsAPI, accountsAPI } from '../services/api';

const PLATFORM_COLORS = { meta: '#1877f2', google: '#4285f4', tiktok: '#ff0050' };

const OBJECTIVES = {
  meta: ['CONVERSIONS', 'BRAND_AWARENESS', 'TRAFFIC', 'ENGAGEMENT', 'LEAD_GENERATION', 'VIDEO_VIEWS', 'APP_INSTALLS'],
  google: ['SEARCH', 'DISPLAY', 'VIDEO', 'SHOPPING', 'PERFORMANCE_MAX'],
  tiktok: ['VIDEO_VIEWS', 'TRAFFIC', 'CONVERSIONS', 'APP_INSTALLS', 'LEAD_GENERATION'],
};

function getCampaignAlerts(c) {
  const alerts = [];
  const roas = parseFloat(c.roas || 0);
  const ctr = parseFloat(c.ctr || 0);
  const cpa = parseFloat(c.cpa || 0);
  const spend = parseFloat(c.spend || 0);
  const budget = parseFloat(c.budget_amount || 0);
  const impressions = parseInt(c.impressions || 0);
  if (c.status === 'active' && impressions > 500 && ctr < 0.005)
    alerts.push({ label: 'Düşük CTR', color: '#ffd700' });
  if (c.status === 'active' && roas > 0 && roas < 1)
    alerts.push({ label: 'ROAS < 1', color: '#ff4444' });
  if (c.status === 'active' && budget > 0 && spend > budget * 1.05)
    alerts.push({ label: 'Bütçe Aşımı', color: '#ff4444' });
  if (c.status === 'active' && cpa > 75 && parseInt(c.conversions || 0) > 0)
    alerts.push({ label: 'Yüksek CPA', color: '#ff8c00' });
  if (c.status === 'paused' && roas >= 3 && spend > 0)
    alerts.push({ label: 'Aktif et?', color: '#00ff88' });
  return alerts;
}

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

function CreateCampaignModal({ onClose, onCreated, accounts }) {
  const [form, setForm] = useState({
    name: '',
    platform: '',
    adAccountId: '',
    objective: '',
    budgetType: 'daily',
    budgetAmount: '',
    startDate: new Date().toISOString().split('T')[0],
    endDate: '',
  });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const filteredAccounts = accounts.filter(
    (a) => !form.platform || a.platform === form.platform
  );

  const set = (key, val) => setForm((f) => ({ ...f, [key]: val }));

  const handlePlatformChange = (val) => {
    setForm((f) => ({ ...f, platform: val, adAccountId: '', objective: '' }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    if (!form.name || !form.platform || !form.adAccountId) {
      setError('Kampanya adı, platform ve hesap zorunludur.');
      return;
    }
    setSubmitting(true);
    try {
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
      <div className="bg-[#111118] border border-white/10 rounded-2xl w-full max-w-lg shadow-2xl">
        <div className="flex items-center justify-between px-6 py-4 border-b border-white/5">
          <h2 className="text-white font-semibold">Yeni Kampanya Oluştur</h2>
          <button onClick={onClose} className="text-[#555] hover:text-white transition-colors text-xl leading-none">×</button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {error && (
            <div className="bg-red-500/10 border border-red-500/20 rounded-lg px-4 py-3 text-red-400 text-sm">{error}</div>
          )}

          <div>
            <label className={labelCls}>Kampanya Adı *</label>
            <input
              className={inputCls}
              placeholder="örn. Yaz Kampanyası 2025"
              value={form.name}
              onChange={(e) => set('name', e.target.value)}
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelCls}>Platform *</label>
              <select className={inputCls} value={form.platform} onChange={(e) => handlePlatformChange(e.target.value)}>
                <option value="">Seç...</option>
                <option value="meta">Meta (Facebook/Instagram)</option>
                <option value="google">Google Ads</option>
                <option value="tiktok">TikTok Ads</option>
              </select>
            </div>
            <div>
              <label className={labelCls}>Reklam Hesabı *</label>
              <select
                className={inputCls}
                value={form.adAccountId}
                onChange={(e) => set('adAccountId', e.target.value)}
                disabled={!form.platform}
              >
                <option value="">Seç...</option>
                {filteredAccounts.map((a) => (
                  <option key={a.id} value={a.id}>{a.account_name}</option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <label className={labelCls}>Hedef</label>
            <select
              className={inputCls}
              value={form.objective}
              onChange={(e) => set('objective', e.target.value)}
              disabled={!form.platform}
            >
              <option value="">Seç...</option>
              {(OBJECTIVES[form.platform] || []).map((o) => (
                <option key={o} value={o}>{o.replace(/_/g, ' ')}</option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelCls}>Bütçe Türü</label>
              <select className={inputCls} value={form.budgetType} onChange={(e) => set('budgetType', e.target.value)}>
                <option value="daily">Günlük</option>
                <option value="lifetime">Toplam</option>
              </select>
            </div>
            <div>
              <label className={labelCls}>Bütçe ($)</label>
              <input
                type="number"
                min="1"
                step="0.01"
                className={inputCls}
                placeholder="örn. 50"
                value={form.budgetAmount}
                onChange={(e) => set('budgetAmount', e.target.value)}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelCls}>Başlangıç Tarihi</label>
              <input type="date" className={inputCls} value={form.startDate} onChange={(e) => set('startDate', e.target.value)} />
            </div>
            <div>
              <label className={labelCls}>Bitiş Tarihi</label>
              <input type="date" className={inputCls} value={form.endDate} onChange={(e) => set('endDate', e.target.value)} />
            </div>
          </div>

          <div className="flex items-center gap-3 pt-2">
            <button
              type="submit"
              disabled={submitting}
              className="flex-1 py-2.5 bg-[#00ff88]/10 border border-[#00ff88]/30 text-[#00ff88] text-sm font-semibold rounded-lg hover:bg-[#00ff88]/20 transition-all disabled:opacity-50"
            >
              {submitting ? 'Oluşturuluyor...' : 'Kampanya Oluştur'}
            </button>
            <button
              type="button"
              onClick={onClose}
              className="px-5 py-2.5 border border-white/10 text-[#666] text-sm rounded-lg hover:text-white hover:border-white/20 transition-all"
            >
              İptal
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default function Campaigns() {
  const [campaigns, setCampaigns] = useState([]);
  const [accounts, setAccounts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [filter, setFilter] = useState({ platform: '', status: '' });
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const LIMIT = 25;

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

  useEffect(() => {
    accountsAPI.list().then((r) => setAccounts(r.data.accounts || [])).catch(() => {});
  }, []);

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

  const handleCreated = async () => {
    setShowCreate(false);
    await fetchCampaigns();
  };

  const realAccounts = accounts.filter((a) => !a.account_id?.startsWith('DEMO_'));
  const totalPages = Math.ceil(total / LIMIT);

  return (
    <div className="p-6 space-y-5">
      {showCreate && (
        <CreateCampaignModal
          onClose={() => setShowCreate(false)}
          onCreated={handleCreated}
          accounts={realAccounts}
        />
      )}

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-white text-xl font-semibold">Kampanyalar</h1>
          <p className="text-[#555] text-sm">{total} kampanya tüm platformlarda</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowCreate(true)}
            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-[#00ff88]/10 border border-[#00ff88]/30 text-[#00ff88] text-sm font-medium hover:bg-[#00ff88]/20 transition-all"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            Yeni Kampanya
          </button>
          <button
            onClick={handleSync}
            disabled={syncing}
            className="flex items-center gap-2 px-4 py-2 rounded-lg border border-white/10 text-[#666] text-sm hover:text-white hover:border-white/20 transition-all disabled:opacity-50"
          >
            {syncing ? (
              <div className="w-4 h-4 border-2 border-[#666] border-t-transparent rounded-full animate-spin" />
            ) : (
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
            )}
            {syncing ? 'Syncing...' : 'Sync'}
          </button>
        </div>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3">
        <select
          value={filter.platform}
          onChange={(e) => { setFilter((f) => ({ ...f, platform: e.target.value })); setPage(1); }}
          className="bg-[#111118] border border-white/5 text-[#888] text-sm rounded-lg px-3 py-2 focus:outline-none focus:border-[#00ff88]/30"
        >
          <option value="">Tüm Platformlar</option>
          <option value="meta">Meta</option>
          <option value="google">Google</option>
          <option value="tiktok">TikTok</option>
        </select>
        <select
          value={filter.status}
          onChange={(e) => { setFilter((f) => ({ ...f, status: e.target.value })); setPage(1); }}
          className="bg-[#111118] border border-white/5 text-[#888] text-sm rounded-lg px-3 py-2 focus:outline-none focus:border-[#00ff88]/30"
        >
          <option value="">Tüm Durumlar</option>
          <option value="active">Aktif</option>
          <option value="paused">Duraklatıldı</option>
          <option value="draft">Taslak</option>
          <option value="archived">Arşivlendi</option>
        </select>
      </div>

      {/* Table */}
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
              <p className="text-[#444] text-sm">Kampanya bulunamadı</p>
              <p className="text-[#333] text-xs mt-1">Yeni kampanya oluşturmak için butona tıkla</p>
              <button
                onClick={() => setShowCreate(true)}
                className="mt-4 px-4 py-2 bg-[#00ff88]/10 border border-[#00ff88]/30 text-[#00ff88] text-sm rounded-lg hover:bg-[#00ff88]/20 transition-all"
              >
                + Yeni Kampanya
              </button>
            </div>
          ) : (
            <table className="w-full">
              <thead>
                <tr className="border-b border-white/5">
                  {['Kampanya', 'Platform', 'Durum', 'Bütçe', 'Harcama', 'ROAS', 'CTR', 'CPA', 'Dönüşüm', 'Son Sync'].map((h) => (
                    <th key={h} className="px-4 py-3 text-left text-[#444] text-xs font-mono whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-white/3">
                {campaigns.map((c) => (
                  <tr key={c.id} className="hover:bg-white/2 transition-colors">
                    <td className="px-4 py-3 min-w-[200px]">
                      <div className="text-white text-sm font-medium truncate max-w-[250px]">{c.name}</div>
                      <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                        <span className="text-[#444] text-xs font-mono">{c.account_name || c.external_id}</span>
                        {getCampaignAlerts(c).map((a, i) => (
                          <span key={i} className="text-xs font-mono px-1.5 py-0.5 rounded"
                            style={{ color: a.color, backgroundColor: `${a.color}18`, border: `1px solid ${a.color}30` }}>
                            {a.label}
                          </span>
                        ))}
                      </div>
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
                        ? `$${parseFloat(c.budget_amount).toFixed(0)}/${c.budget_type === 'daily' ? 'gün' : 'toplam'}`
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
                      {c.last_synced_at ? new Date(c.last_synced_at).toLocaleDateString() : 'Hiç'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {totalPages > 1 && (
          <div className="flex items-center justify-between px-5 py-3 border-t border-white/5">
            <span className="text-[#555] text-xs font-mono">
              {(page - 1) * LIMIT + 1}–{Math.min(page * LIMIT, total)} / {total}
            </span>
            <div className="flex items-center gap-2">
              <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page === 1}
                className="px-3 py-1.5 rounded text-xs text-[#666] border border-white/5 disabled:opacity-30 hover:text-white hover:border-white/10 transition-all">
                ← Önceki
              </button>
              <span className="text-[#555] text-xs font-mono">{page}/{totalPages}</span>
              <button onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={page === totalPages}
                className="px-3 py-1.5 rounded text-xs text-[#666] border border-white/5 disabled:opacity-30 hover:text-white hover:border-white/10 transition-all">
                Sonraki →
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
