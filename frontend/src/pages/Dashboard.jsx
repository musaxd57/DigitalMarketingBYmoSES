import { useState, useEffect } from 'react';
import {
  LineChart, Line, AreaChart, Area, BarChart, Bar,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from 'recharts';
import { analyticsAPI, campaignsAPI, demoAPI } from '../services/api';
import KPICard from '../components/KPICard';
import { format, subDays } from 'date-fns';

const PLATFORM_COLORS = { meta: '#1877f2', google: '#4285f4', tiktok: '#ff0050' };
const PLATFORM_LABELS = { meta: 'Meta', google: 'Google', tiktok: 'TikTok' };

function StatusBadge({ status }) {
  const colors = {
    active: 'bg-[#00ff88]/10 text-[#00ff88] border-[#00ff88]/20',
    paused: 'bg-yellow-500/10 text-yellow-400 border-yellow-500/20',
    draft: 'bg-white/5 text-[#666] border-white/10',
    deleted: 'bg-red-500/10 text-red-400 border-red-500/20',
    archived: 'bg-white/5 text-[#555] border-white/10',
  };
  return (
    <span className={`text-xs font-mono px-2 py-0.5 rounded border ${colors[status] || colors.draft}`}>
      {status?.toUpperCase()}
    </span>
  );
}

const CustomTooltip = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-[#1a1a24] border border-white/10 rounded-lg p-3 text-xs shadow-xl">
      <p className="text-[#888] mb-2 font-mono">{label}</p>
      {payload.map((entry) => (
        <div key={entry.dataKey} className="flex items-center gap-2">
          <div className="w-2 h-2 rounded-full" style={{ background: entry.color }} />
          <span className="text-[#888]">{entry.name}:</span>
          <span className="font-bold" style={{ color: entry.color }}>
            {entry.dataKey === 'spend' ? `$${parseFloat(entry.value).toFixed(2)}` :
             entry.dataKey === 'roas' ? `${parseFloat(entry.value).toFixed(2)}x` :
             entry.dataKey === 'ctr' ? `${(parseFloat(entry.value) * 100).toFixed(2)}%` :
             entry.value}
          </span>
        </div>
      ))}
    </div>
  );
};

export default function Dashboard() {
  const [overview, setOverview] = useState(null);
  const [timeseries, setTimeseries] = useState([]);
  const [campaigns, setCampaigns] = useState([]);
  const [platformBreakdown, setPlatformBreakdown] = useState([]);
  const [loading, setLoading] = useState(true);
  const [dateRange, setDateRange] = useState('30d');
  const [seeding, setSeeding] = useState(false);

  const getDateRange = () => {
    const end = format(new Date(), 'yyyy-MM-dd');
    const days = dateRange === '7d' ? 7 : dateRange === '14d' ? 14 : dateRange === '90d' ? 90 : 30;
    const start = format(subDays(new Date(), days), 'yyyy-MM-dd');
    return { startDate: start, endDate: end };
  };

  const fetchData = async () => {
    setLoading(true);
    const { startDate, endDate } = getDateRange();
    try {
      const [overviewRes, timeseriesRes, campaignsRes, platformRes] = await Promise.allSettled([
        analyticsAPI.overview({ startDate, endDate }),
        analyticsAPI.timeseries({ startDate, endDate }),
        campaignsAPI.list({ limit: 5 }),
        analyticsAPI.byPlatform({ startDate, endDate }),
      ]);
      if (overviewRes.status === 'fulfilled') setOverview(overviewRes.value.data);
      if (timeseriesRes.status === 'fulfilled') setTimeseries(timeseriesRes.value.data.data || []);
      if (campaignsRes.status === 'fulfilled') setCampaigns(campaignsRes.value.data.campaigns || []);
      if (platformRes.status === 'fulfilled') setPlatformBreakdown(platformRes.value.data.breakdown || []);
    } catch (err) {
      console.error('[Dashboard] Fetch error:', err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleSeedDemo = async () => {
    setSeeding(true);
    try {
      await demoAPI.seed();
      await fetchData();
    } catch (err) {
      alert('Demo veri yüklenemedi: ' + (err.response?.data?.error || err.message));
    } finally {
      setSeeding(false);
    }
  };

  useEffect(() => { fetchData(); }, [dateRange]);

  const metrics = overview?.metrics || {};
  const changes = overview?.changes || {};

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-white text-xl font-semibold">Ana Sayfa</h1>
          <p className="text-[#555] text-sm mt-0.5">Gerçek zamanlı performans özeti</p>
        </div>
        <div className="flex items-center gap-2">
          {['7d', '14d', '30d', '90d'].map((r) => (
            <button
              key={r}
              onClick={() => setDateRange(r)}
              className={`px-3 py-1.5 rounded-lg text-xs font-mono transition-all
                ${dateRange === r
                  ? 'bg-[#00ff88]/10 text-[#00ff88] border border-[#00ff88]/30'
                  : 'text-[#555] border border-white/5 hover:border-white/10 hover:text-[#888]'
                }`}
            >
              {r}
            </button>
          ))}
          <button
            onClick={handleSeedDemo}
            disabled={seeding}
            className="px-3 py-1.5 rounded-lg text-xs font-mono transition-all text-[#ffd700] border border-[#ffd700]/20 hover:bg-[#ffd700]/10 disabled:opacity-50 flex items-center gap-1.5"
          >
            {seeding ? <span className="w-3 h-3 border border-[#ffd700] border-t-transparent rounded-full animate-spin inline-block" /> : '✦'}
            {seeding ? 'Yükleniyor...' : 'Demo Veri'}
          </button>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4">
        <KPICard
          title="ROAS"
          value={metrics.roas}
          change={changes.roas}
          format="multiplier"
          loading={loading}
          accentColor="#00ff88"
        />
        <KPICard
          title="Toplam Harcama"
          value={metrics.totalSpend}
          change={changes.spend}
          format="currency"
          loading={loading}
          accentColor="#00aaff"
        />
        <KPICard
          title="Gelir"
          value={metrics.totalRevenue}
          format="currency"
          loading={loading}
          accentColor="#9d4edd"
        />
        <KPICard
          title="CTR"
          value={metrics.ctr}
          change={changes.ctr}
          format="percent"
          loading={loading}
          accentColor="#ffd700"
        />
        <KPICard
          title="CPA"
          value={metrics.cpa}
          change={changes.cpa}
          format="currency"
          loading={loading}
          accentColor="#ff8c00"
        />
        <KPICard
          title="Dönüşümler"
          value={metrics.totalConversions}
          change={changes.conversions}
          format="integer"
          loading={loading}
          accentColor="#00ff88"
        />
      </div>

      {/* Charts Row */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        {/* Main chart - Spend & ROAS over time */}
        <div className="xl:col-span-2 bg-[#111118] rounded-xl border border-white/5 p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-white font-semibold text-sm">Harcama & ROAS Trendi</h2>
            <div className="flex items-center gap-3 text-xs">
              <div className="flex items-center gap-1.5">
                <div className="w-3 h-0.5 bg-[#00aaff]" />
                <span className="text-[#666]">Harcama</span>
              </div>
              <div className="flex items-center gap-1.5">
                <div className="w-3 h-0.5 bg-[#00ff88]" />
                <span className="text-[#666]">ROAS</span>
              </div>
            </div>
          </div>
          {loading ? (
            <div className="h-48 bg-white/3 animate-pulse rounded-lg" />
          ) : (
            <ResponsiveContainer width="100%" height={200}>
              <AreaChart data={timeseries} margin={{ top: 5, right: 5, bottom: 0, left: 0 }}>
                <defs>
                  <linearGradient id="spendGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#00aaff" stopOpacity={0.2} />
                    <stop offset="95%" stopColor="#00aaff" stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="roasGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#00ff88" stopOpacity={0.15} />
                    <stop offset="95%" stopColor="#00ff88" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid stroke="rgba(255,255,255,0.03)" vertical={false} />
                <XAxis
                  dataKey="date"
                  tickFormatter={(d) => {
                    try { return format(new Date(d), 'MMM d'); } catch { return d; }
                  }}
                  tick={{ fill: '#444', fontSize: 10, fontFamily: 'monospace' }}
                  axisLine={false}
                  tickLine={false}
                />
                <YAxis
                  yAxisId="spend"
                  tickFormatter={(v) => `$${v >= 1000 ? `${(v/1000).toFixed(0)}k` : v}`}
                  tick={{ fill: '#444', fontSize: 10, fontFamily: 'monospace' }}
                  axisLine={false}
                  tickLine={false}
                  orientation="left"
                />
                <YAxis
                  yAxisId="roas"
                  tickFormatter={(v) => `${v.toFixed(1)}x`}
                  tick={{ fill: '#444', fontSize: 10, fontFamily: 'monospace' }}
                  axisLine={false}
                  tickLine={false}
                  orientation="right"
                />
                <Tooltip content={<CustomTooltip />} />
                <Area yAxisId="spend" type="monotone" dataKey="spend" stroke="#00aaff" strokeWidth={2}
                  fill="url(#spendGrad)" name="Spend" dot={false} />
                <Area yAxisId="roas" type="monotone" dataKey="roas" stroke="#00ff88" strokeWidth={2}
                  fill="url(#roasGrad)" name="ROAS" dot={false} />
              </AreaChart>
            </ResponsiveContainer>
          )}
        </div>

        {/* Platform breakdown */}
        <div className="bg-[#111118] rounded-xl border border-white/5 p-5">
          <h2 className="text-white font-semibold text-sm mb-4">Platforma Göre Harcama</h2>
          {loading ? (
            <div className="h-48 bg-white/3 animate-pulse rounded-lg" />
          ) : platformBreakdown.length === 0 ? (
            <div className="h-48 flex items-center justify-center text-[#444] text-sm">
              Veri yok
            </div>
          ) : (
            <>
              <ResponsiveContainer width="100%" height={140}>
                <BarChart data={platformBreakdown} margin={{ top: 5, right: 5, bottom: 0, left: 0 }}>
                  <CartesianGrid stroke="rgba(255,255,255,0.03)" vertical={false} />
                  <XAxis
                    dataKey="platform"
                    tickFormatter={(v) => PLATFORM_LABELS[v] || v}
                    tick={{ fill: '#444', fontSize: 10, fontFamily: 'monospace' }}
                    axisLine={false}
                    tickLine={false}
                  />
                  <YAxis
                    tickFormatter={(v) => `$${v >= 1000 ? `${(v/1000).toFixed(0)}k` : v}`}
                    tick={{ fill: '#444', fontSize: 10, fontFamily: 'monospace' }}
                    axisLine={false}
                    tickLine={false}
                  />
                  <Tooltip content={<CustomTooltip />} />
                  <Bar dataKey="spend" name="Spend" fill="#00aaff" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
              <div className="mt-4 space-y-2">
                {platformBreakdown.map((p) => (
                  <div key={p.platform} className="flex items-center justify-between text-xs">
                    <div className="flex items-center gap-2">
                      <div className="w-2 h-2 rounded-full" style={{ background: PLATFORM_COLORS[p.platform] }} />
                      <span className="text-[#666]">{PLATFORM_LABELS[p.platform] || p.platform}</span>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="text-[#888] font-mono">${parseFloat(p.spend || 0).toFixed(0)}</span>
                      <span className="text-[#555] font-mono">{parseFloat(p.roas || 0).toFixed(2)}x</span>
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      </div>

      {/* CTR + Conversions chart */}
      <div className="bg-[#111118] rounded-xl border border-white/5 p-5">
        <h2 className="text-white font-semibold text-sm mb-4">CTR & Dönüşümler (Son {dateRange})</h2>
        {loading ? (
          <div className="h-32 bg-white/3 animate-pulse rounded-lg" />
        ) : (
          <ResponsiveContainer width="100%" height={150}>
            <LineChart data={timeseries} margin={{ top: 5, right: 5, bottom: 0, left: 0 }}>
              <CartesianGrid stroke="rgba(255,255,255,0.03)" vertical={false} />
              <XAxis
                dataKey="date"
                tickFormatter={(d) => { try { return format(new Date(d), 'MMM d'); } catch { return d; } }}
                tick={{ fill: '#444', fontSize: 10, fontFamily: 'monospace' }}
                axisLine={false}
                tickLine={false}
              />
              <YAxis yAxisId="ctr"
                tickFormatter={(v) => `${(v * 100).toFixed(1)}%`}
                tick={{ fill: '#444', fontSize: 10 }}
                axisLine={false}
                tickLine={false}
              />
              <YAxis yAxisId="conv" orientation="right"
                tick={{ fill: '#444', fontSize: 10 }}
                axisLine={false}
                tickLine={false}
              />
              <Tooltip content={<CustomTooltip />} />
              <Line yAxisId="ctr" type="monotone" dataKey="ctr" stroke="#ffd700" strokeWidth={2}
                dot={false} name="CTR" />
              <Line yAxisId="conv" type="monotone" dataKey="conversions" stroke="#9d4edd" strokeWidth={2}
                dot={false} name="Conversions" />
            </LineChart>
          </ResponsiveContainer>
        )}
      </div>

      {/* Recent Campaigns Table */}
      <div className="bg-[#111118] rounded-xl border border-white/5 overflow-hidden">
        <div className="px-5 py-4 border-b border-white/5 flex items-center justify-between">
          <h2 className="text-white font-semibold text-sm">Son Kampanyalar</h2>
          <a href="/campaigns" className="text-[#00ff88] text-xs hover:underline font-mono">
            Tümünü gör →
          </a>
        </div>
        <div className="overflow-x-auto">
          {loading ? (
            <div className="p-5 space-y-3">
              {[...Array(3)].map((_, i) => (
                <div key={i} className="h-10 bg-white/3 animate-pulse rounded" />
              ))}
            </div>
          ) : campaigns.length === 0 ? (
            <div className="p-10 text-center">
              <p className="text-[#444] text-sm">Henüz kampanya yok</p>
              <p className="text-[#333] text-xs mt-1">Kampanyaları görmek için bir reklam hesabı bağla</p>
            </div>
          ) : (
            <table className="w-full">
              <thead>
                <tr className="border-b border-white/5">
                  {['Kampanya', 'Platform', 'Durum', 'Harcama', 'ROAS', 'CTR', 'Dönüşüm'].map((h) => (
                    <th key={h} className="px-4 py-3 text-left text-[#444] text-xs font-mono">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-white/3">
                {campaigns.map((c) => (
                  <tr key={c.id} className="hover:bg-white/2 transition-colors">
                    <td className="px-4 py-3">
                      <span className="text-white text-sm truncate max-w-xs block">{c.name}</span>
                      <span className="text-[#444] text-xs font-mono">{c.account_name}</span>
                    </td>
                    <td className="px-4 py-3">
                      <span className="text-xs font-mono" style={{ color: PLATFORM_COLORS[c.platform] || '#888' }}>
                        {PLATFORM_LABELS[c.platform] || c.platform}
                      </span>
                    </td>
                    <td className="px-4 py-3"><StatusBadge status={c.status} /></td>
                    <td className="px-4 py-3 text-[#888] text-sm font-mono">${parseFloat(c.spend || 0).toFixed(2)}</td>
                    <td className="px-4 py-3 text-[#00ff88] text-sm font-mono">{parseFloat(c.roas || 0).toFixed(2)}x</td>
                    <td className="px-4 py-3 text-[#888] text-sm font-mono">{(parseFloat(c.ctr || 0) * 100).toFixed(2)}%</td>
                    <td className="px-4 py-3 text-[#888] text-sm font-mono">{parseInt(c.conversions || 0).toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
