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
      const res = await demoAPI.seed();
      // If already seeded or sync success
      if (res.data?.status === 'completed' || res.data?.seeded === false) {
        await fetchData();
        setSeeding(false);
        return;
      }
      // 202 async — poll status
      const poll = setInterval(async () => {
        try {
          const statusRes = await demoAPI.status();
          const { status } = statusRes.data;
          if (status === 'completed') {
            clearInterval(poll);
            await fetchData();
            setSeeding(false);
          } else if (status === 'failed') {
            clearInterval(poll);
            alert('Demo veri yüklenemedi: ' + (statusRes.data.error || 'Bilinmeyen hata'));
            setSeeding(false);
          }
        } catch { /* keep polling */ }
      }, 3000);
      // Safety timeout 3 min
      setTimeout(() => { clearInterval(poll); setSeeding(false); }, 180000);
    } catch (err) {
      alert('Demo veri yüklenemedi: ' + (err.response?.data?.error || err.message));
      setSeeding(false);
    }
  };

  useEffect(() => { fetchData(); }, [dateRange]);

  const metrics = overview?.metrics || {};
  const changes = overview?.changes || {};

  return (
    <div className="p-6 space-y-6 page-enter">
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
            className="px-3 py-1.5 rounded-lg text-xs font-mono transition-all text-[#ffd700] border border-[#ffd700]/20 hover:bg-[#ffd700]/10 disabled:opacity-50 flex items-center gap-1.5 hover:scale-105 active:scale-95"
          >
            {seeding ? <span className="w-3 h-3 border border-[#ffd700] border-t-transparent rounded-full animate-spin inline-block" /> : '✦'}
            {seeding ? 'Yükleniyor...' : 'Demo Veri'}
          </button>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4 transition-all">
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
            <div className="skeleton h-48" />
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
            <div className="skeleton h-48" />
          ) : platformBreakdown.length === 0 ? (
            <div className="h-48 flex items-center justify-center">
              <div className="flex flex-col items-center gap-3 text-center">
                <div className="w-12 h-12 rounded-xl bg-[#111118] border border-white/5 flex items-center justify-center">
                  <svg className="w-6 h-6 text-[#333]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                  </svg>
                </div>
                <p className="text-[#444] text-sm">Platform verisi yok</p>
              </div>
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
          <div className="skeleton h-32" />
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

      {/* Smart Insights */}
      {!loading && (() => {
        const insights = [];
        if (!metrics.totalSpend || metrics.totalSpend === 0) {
          insights.push({ color: '#00aaff', icon: '🔗', title: 'Reklam hesabı bağla', desc: 'Verilerini görmek için Meta, Google veya TikTok hesabını bağla.', href: '/settings' });
        } else {
          if ((metrics.ctr || 0) < 0.01 && metrics.totalImpressions > 0) {
            insights.push({ color: '#ffd700', icon: '⚠', title: 'CTR düşük', desc: `CTR ${((metrics.ctr || 0) * 100).toFixed(2)}% — reklam başlık ve metinlerini yenile.`, href: '/creative' });
          }
          if ((metrics.roas || 0) > 0 && (metrics.roas || 0) < 2) {
            insights.push({ color: '#ff8c00', icon: '📉', title: 'ROAS iyileştirilebilir', desc: `Şu anki ROAS ${(metrics.roas || 0).toFixed(2)}x — hedef bütçe dağılımını optimize et.`, href: '/analytics' });
          }
          if ((metrics.roas || 0) >= 4) {
            insights.push({ color: '#00ff88', icon: '🚀', title: 'Harika performans!', desc: `ROAS ${(metrics.roas || 0).toFixed(2)}x — bütçeyi artırarak kazancı ölçeklendir.`, href: '/campaigns' });
          }
          if (platformBreakdown.length === 1) {
            insights.push({ color: '#9d4edd', icon: '📊', title: 'Tek platformdasın', desc: 'Riski azaltmak için Meta, Google veya TikTok\'a da yayıl.', href: '/settings' });
          }
          if ((metrics.cpa || 0) > 50 && metrics.totalConversions > 0) {
            insights.push({ color: '#ff8c00', icon: '💸', title: 'CPA yüksek', desc: `Dönüşüm başına $${(metrics.cpa || 0).toFixed(0)} harcıyorsun — hedeflemeyi daralt.`, href: '/campaigns' });
          }
        }
        if (insights.length === 0) return null;
        return (
          <div className="bg-[#111118] rounded-xl border border-white/5 p-5">
            <h2 className="text-white font-semibold text-sm mb-4">Akıllı Öneriler</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">
              {insights.map((ins, i) => (
                <a key={i} href={ins.href}
                  className="flex items-start gap-3 p-3 rounded-lg border transition-all hover:bg-white/3"
                  style={{ borderColor: `${ins.color}20`, backgroundColor: `${ins.color}08` }}>
                  <span className="text-lg flex-shrink-0">{ins.icon}</span>
                  <div>
                    <p className="text-white text-xs font-semibold">{ins.title}</p>
                    <p className="text-[#666] text-xs mt-0.5 leading-relaxed">{ins.desc}</p>
                  </div>
                </a>
              ))}
            </div>
          </div>
        );
      })()}

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
                <div key={i} className="skeleton h-10" />
              ))}
            </div>
          ) : campaigns.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 gap-4 text-center">
              <div className="w-16 h-16 rounded-2xl bg-[#111118] border border-white/5 flex items-center justify-center mb-2">
                <svg className="w-8 h-8 text-[#333]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M11 3.055A9.001 9.001 0 1020.945 13H11V3.055z" />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M20.488 9H15V3.512A9.025 9.025 0 0120.488 9z" />
                </svg>
              </div>
              <h3 className="text-white text-base font-semibold">Henüz kampanya yok</h3>
              <p className="text-[#555] text-sm max-w-xs leading-relaxed">Reklam hesabı bağlayarak kampanyalarını buraya getir</p>
              <a href="/settings" className="mt-2 px-4 py-2 rounded-lg bg-[#00ff88]/10 border border-[#00ff88]/30 text-[#00ff88] text-sm font-medium hover:bg-[#00ff88]/20 transition-all">
                Hesap Bağla
              </a>
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
                  <tr key={c.id} className="hover:bg-white/[0.03] transition-colors cursor-pointer">
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
