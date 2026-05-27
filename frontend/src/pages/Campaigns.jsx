import { useState, useEffect } from 'react';
import { campaignsAPI } from '../services/api';

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

export default function Campaigns() {
  const [campaigns, setCampaigns] = useState([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
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

  return (
    <div className="p-6 space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-white text-xl font-semibold">Campaigns</h1>
          <p className="text-[#555] text-sm">{total} campaigns across all platforms</p>
        </div>
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

      {/* Filters */}
      <div className="flex items-center gap-3">
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
    </div>
  );
}
