import { useState, useEffect } from 'react';
import {
  LineChart, Line, AreaChart, Area, BarChart, Bar,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from 'recharts';
import { analyticsAPI, reportsAPI } from '../services/api';
import KPICard from '../components/KPICard';
import { format, subDays } from 'date-fns';

const fmt = {
  currency: (v) => `$${parseFloat(v || 0).toFixed(2)}`,
  pct: (v) => `${(parseFloat(v || 0) * 100).toFixed(2)}%`,
  x: (v) => `${parseFloat(v || 0).toFixed(2)}x`,
  int: (v) => parseInt(v || 0).toLocaleString('tr-TR'),
};

const CustomTooltip = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null;
  const formatVal = (dataKey, val) => {
    if (dataKey === 'spend' || dataKey === 'cpa' || dataKey === 'cpc') return fmt.currency(val);
    if (dataKey === 'roas') return fmt.x(val);
    if (dataKey === 'ctr') return fmt.pct(val);
    return fmt.int(val);
  };
  return (
    <div className="bg-[#1a1a24] border border-white/10 rounded-xl p-3 shadow-2xl min-w-[140px]">
      <p className="text-[#666] text-xs mb-2 font-mono border-b border-white/5 pb-1.5">{label}</p>
      {payload.map((entry) => (
        <div key={entry.dataKey} className="flex items-center justify-between gap-4 text-xs py-0.5">
          <div className="flex items-center gap-1.5">
            <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: entry.color }} />
            <span className="text-[#666]">{entry.name}</span>
          </div>
          <span className="font-bold font-mono" style={{ color: entry.color }}>
            {formatVal(entry.dataKey, entry.value)}
          </span>
        </div>
      ))}
    </div>
  );
};

const METRICS_CONFIG = [
  { key: 'spend', label: 'Harcama', color: '#00aaff', fmt: fmt.currency },
  { key: 'roas', label: 'ROAS', color: '#00ff88', fmt: fmt.x },
  { key: 'ctr', label: 'CTR', color: '#ffd700', fmt: fmt.pct },
  { key: 'cpa', label: 'CPA', color: '#ff8c00', fmt: fmt.currency },
  { key: 'conversions', label: 'Dönüşüm', color: '#9d4edd', fmt: fmt.int },
  { key: 'impressions', label: 'Gösterim', color: '#36cfc9', fmt: fmt.int },
];

export default function Analytics() {
  const [overview, setOverview] = useState(null);
  const [timeseries, setTimeseries] = useState([]);
  const [topCampaigns, setTopCampaigns] = useState([]);
  const [ltv, setLtv] = useState(null);
  const [loading, setLoading] = useState(true);
  const [dateRange, setDateRange] = useState('30g');
  const [selectedMetrics, setSelectedMetrics] = useState(['spend', 'roas', 'ctr']);
  const [chartType, setChartType] = useState('area');
  const [sendingReport, setSendingReport] = useState(false);

  const downloadCSV = () => {
    if (!timeseries.length) return;
    const headers = ['Tarih', 'Harcama', 'Gelir', 'ROAS', 'CTR%', 'CPC', 'CPA', 'Tıklama', 'Gösterim', 'Dönüşüm'];
    const rows = timeseries.map(r => [
      r.date,
      parseFloat(r.spend || 0).toFixed(2),
      parseFloat(r.revenue || 0).toFixed(2),
      parseFloat(r.roas || 0).toFixed(2),
      (parseFloat(r.ctr || 0) * 100).toFixed(2),
      parseFloat(r.cpc || 0).toFixed(2),
      parseFloat(r.cpa || 0).toFixed(2),
      parseInt(r.clicks || 0),
      parseInt(r.impressions || 0),
      parseInt(r.conversions || 0),
    ]);
    const csv = [headers, ...rows].map(r => r.join(',')).join('\n');
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `analitik-${dateRange}-${format(new Date(), 'yyyy-MM-dd')}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleSendReport = async () => {
    setSendingReport(true);
    try {
      await reportsAPI.send({});
      alert('Rapor email adresinize gönderildi!');
    } catch (err) {
      alert('Hata: ' + (err.response?.data?.error || err.message));
    } finally {
      setSendingReport(false);
    }
  };

  const getDateRange = (range) => {
    const end = format(new Date(), 'yyyy-MM-dd');
    const days = { '7g': 7, '14g': 14, '30g': 30, '90g': 90 }[range] || 30;
    return { startDate: format(subDays(new Date(), days), 'yyyy-MM-dd'), endDate: end };
  };

  useEffect(() => {
    const fetchAll = async () => {
      setLoading(true);
      const { startDate, endDate } = getDateRange(dateRange);
      try {
        const [oRes, tRes, topRes, ltvRes] = await Promise.allSettled([
          analyticsAPI.overview({ startDate, endDate }),
          analyticsAPI.timeseries({ startDate, endDate }),
          analyticsAPI.topCampaigns({ startDate, endDate, metric: 'roas', limit: 10 }),
          analyticsAPI.ltv({ startDate, endDate }),
        ]);
        if (oRes.status === 'fulfilled') setOverview(oRes.value.data);
        if (tRes.status === 'fulfilled') setTimeseries(tRes.value.data.data || []);
        if (topRes.status === 'fulfilled') setTopCampaigns(topRes.value.data.campaigns || []);
        if (ltvRes.status === 'fulfilled') setLtv(ltvRes.value.data.metrics);
      } finally {
        setLoading(false);
      }
    };
    fetchAll();
  }, [dateRange]);

  const m = overview?.metrics || {};

  const toggleMetric = (key) => {
    setSelectedMetrics((prev) =>
      prev.includes(key) ? (prev.length > 1 ? prev.filter((k) => k !== key) : prev) : [...prev, key]
    );
  };

  const activeMetrics = METRICS_CONFIG.filter((mc) => selectedMetrics.includes(mc.key));

  const renderChartSeries = (mc) => {
    const commonProps = { key: mc.key, type: 'monotone', dataKey: mc.key, stroke: mc.color, strokeWidth: 2, dot: false, name: mc.label };
    if (chartType === 'area') {
      return (
        <Area {...commonProps} fill={`url(#grad-${mc.key})`} fillOpacity={1} />
      );
    }
    if (chartType === 'bar') {
      return <Bar key={mc.key} dataKey={mc.key} fill={mc.color} name={mc.label} radius={[3, 3, 0, 0]} />;
    }
    return <Line {...commonProps} />;
  };

  const ChartWrapper = chartType === 'area' ? AreaChart : chartType === 'bar' ? BarChart : LineChart;

  return (
    <div className="p-6 space-y-6 page-enter" key="analytics-page">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-white text-xl font-semibold">Analitik</h1>
          <p className="text-[#555] text-sm">Detaylı performans analizi</p>
        </div>
        <div className="flex items-center gap-2">
          {['7g', '14g', '30g', '90g'].map((r) => (
            <button key={r} onClick={() => setDateRange(r)}
              className={`px-3 py-1.5 rounded text-xs font-mono transition-all
                ${dateRange === r ? 'bg-[#00ff88]/10 text-[#00ff88] border border-[#00ff88]/30'
                  : 'text-[#555] border border-white/5 hover:text-[#888]'}`}>
              {r}
            </button>
          ))}
          <button
            onClick={downloadCSV}
            disabled={!timeseries.length}
            className="px-3 py-1.5 rounded text-xs font-mono border border-white/10 text-[#888] hover:text-white hover:border-white/20 transition-all disabled:opacity-30"
          >
            ↓ CSV
          </button>
          <button
            onClick={handleSendReport}
            disabled={sendingReport}
            className="px-3 py-1.5 rounded text-xs font-mono border border-[#9d4edd]/30 text-[#9d4edd] hover:bg-[#9d4edd]/10 transition-all disabled:opacity-50"
          >
            {sendingReport ? '...' : '✉ Rapor Gönder'}
          </button>
        </div>
      </div>

      {/* KPI Grid */}
      <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-7 gap-4">
        {[
          { title: 'ROAS', value: m.roas, format: 'multiplier', change: overview?.changes?.roas },
          { title: 'Toplam Harcama', value: m.totalSpend, format: 'currency', change: overview?.changes?.spend },
          { title: 'Gelir', value: m.totalRevenue, format: 'currency' },
          { title: 'CTR', value: m.ctr, format: 'percent', change: overview?.changes?.ctr },
          { title: 'CPA', value: m.cpa, format: 'currency', change: overview?.changes?.cpa },
          { title: 'CPC', value: m.cpc, format: 'currency' },
          { title: 'CPM', value: m.cpm, format: 'currency' },
        ].map((kpi) => (
          <KPICard key={kpi.title} {...kpi} loading={loading} />
        ))}
      </div>

      {/* LTV Metrics */}
      {ltv && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <KPICard title="Ort. Sipariş Değeri" value={ltv.aov} format="currency" loading={loading} accentColor="#9d4edd" />
          <KPICard title="Ort. Müşteri Edinim" value={ltv.avgCac} format="currency" loading={loading} accentColor="#ff8c00" />
          <KPICard title="Tahmini LTV" value={ltv.estimatedLtv} format="currency" loading={loading} accentColor="#00ff88" />
          <KPICard title="LTV:CAC Oranı" value={ltv.ltvCacRatio} format="multiplier" loading={loading} accentColor="#ffd700" />
        </div>
      )}

      {/* Timeseries Chart */}
      <div className="bg-[#111118] rounded-xl border border-white/5 p-5">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-5">
          <h2 className="text-white font-semibold text-sm">Zamana Göre Performans</h2>
          <div className="flex flex-wrap items-center gap-2">
            {METRICS_CONFIG.map((mc) => (
              <button
                key={mc.key}
                onClick={() => toggleMetric(mc.key)}
                className={`px-2.5 py-1 rounded text-xs font-mono transition-all border`}
                style={selectedMetrics.includes(mc.key) ? {
                  borderColor: `${mc.color}44`,
                  backgroundColor: `${mc.color}15`,
                  color: mc.color,
                } : { borderColor: 'rgba(255,255,255,0.05)', color: '#444' }}
              >
                {mc.label}
              </button>
            ))}
            <div className="flex items-center border border-white/5 rounded overflow-hidden">
              {[['area', '~'], ['bar', '▌'], ['line', '—']].map(([type, symbol]) => (
                <button
                  key={type}
                  onClick={() => setChartType(type)}
                  className={`px-2.5 py-1 text-xs transition-all ${chartType === type ? 'bg-white/10 text-white' : 'text-[#444] hover:text-[#666]'}`}
                >
                  {symbol}
                </button>
              ))}
            </div>
          </div>
        </div>

        {loading ? (
          <div className="skeleton h-64" />
        ) : timeseries.length === 0 ? (
          <div className="h-64 flex flex-col items-center justify-center gap-4 text-center">
            <div className="w-16 h-16 rounded-2xl bg-[#111118] border border-white/5 flex items-center justify-center mb-2">
              <svg className="w-8 h-8 text-[#333]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 12l3-3 3 3 4-4M8 21l4-4 4 4M3 4h18M4 4h16v12a1 1 0 01-1 1H5a1 1 0 01-1-1V4z" />
              </svg>
            </div>
            <h3 className="text-white text-base font-semibold">Grafik verisi yok</h3>
            <p className="text-[#555] text-sm max-w-xs leading-relaxed">Bu dönem için harcama kaydı bulunmuyor</p>
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={280}>
            <ChartWrapper data={timeseries} margin={{ top: 5, right: 5, bottom: 5, left: 5 }}>
              <defs>
                {activeMetrics.map((mc) => (
                  <linearGradient key={mc.key} id={`grad-${mc.key}`} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor={mc.color} stopOpacity={0.25} />
                    <stop offset="95%" stopColor={mc.color} stopOpacity={0} />
                  </linearGradient>
                ))}
              </defs>
              <CartesianGrid stroke="rgba(255,255,255,0.03)" vertical={false} />
              <XAxis
                dataKey="date"
                tickFormatter={(d) => { try { return format(new Date(d), 'd MMM'); } catch { return d; } }}
                tick={{ fill: '#444', fontSize: 10, fontFamily: 'monospace' }}
                axisLine={false} tickLine={false}
              />
              <YAxis tick={{ fill: '#444', fontSize: 10 }} axisLine={false} tickLine={false} width={45} />
              <Tooltip content={<CustomTooltip />} />
              <Legend formatter={(value) => <span style={{ color: '#666', fontSize: 11 }}>{value}</span>} />
              {activeMetrics.map((mc) => renderChartSeries(mc))}
            </ChartWrapper>
          </ResponsiveContainer>
        )}
      </div>

      {/* Summary stats row */}
      {timeseries.length > 0 && !loading && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {[
            { label: 'Toplam Tıklama', value: fmt.int(timeseries.reduce((s, r) => s + (parseInt(r.clicks) || 0), 0)), color: '#00aaff' },
            { label: 'Toplam Gösterim', value: fmt.int(timeseries.reduce((s, r) => s + (parseInt(r.impressions) || 0), 0)), color: '#36cfc9' },
            { label: 'Toplam Dönüşüm', value: fmt.int(timeseries.reduce((s, r) => s + (parseInt(r.conversions) || 0), 0)), color: '#9d4edd' },
            { label: 'Ort. Günlük Harcama', value: fmt.currency(timeseries.reduce((s, r) => s + parseFloat(r.spend || 0), 0) / (timeseries.length || 1)), color: '#ffd700' },
          ].map((stat) => (
            <div key={stat.label} className="bg-[#111118] rounded-xl border border-white/5 p-4">
              <p className="text-[#444] text-xs font-mono mb-1">{stat.label}</p>
              <p className="font-bold font-mono text-lg" style={{ color: stat.color }}>{stat.value}</p>
            </div>
          ))}
        </div>
      )}

      {/* Top Campaigns Table */}
      <div className="bg-[#111118] rounded-xl border border-white/5 overflow-hidden">
        <div className="px-5 py-4 border-b border-white/5">
          <h2 className="text-white font-semibold text-sm">ROAS'a Göre En İyi Kampanyalar</h2>
        </div>
        {loading ? (
          <div className="p-5 space-y-3">
            {[...Array(5)].map((_, i) => <div key={i} className="skeleton h-10" />)}
          </div>
        ) : topCampaigns.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 gap-4 text-center">
            <div className="w-16 h-16 rounded-2xl bg-[#111118] border border-white/5 flex items-center justify-center mb-2">
              <svg className="w-8 h-8 text-[#333]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
              </svg>
            </div>
            <h3 className="text-white text-base font-semibold">Kampanya verisi bulunamadı</h3>
            <p className="text-[#555] text-sm max-w-xs leading-relaxed">Seçilen dönem için analiz edilecek kampanya verisi yok</p>
            <a href="/campaigns" className="mt-2 px-4 py-2 rounded-lg bg-[#00ff88]/10 border border-[#00ff88]/30 text-[#00ff88] text-sm font-medium hover:bg-[#00ff88]/20 transition-all">
              Kampanyalar
            </a>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-white/5">
                  {['#', 'Kampanya', 'Platform', 'Harcama', 'Gelir', 'ROAS', 'CTR', 'CPA', 'Dönüşüm'].map((h) => (
                    <th key={h} className="px-4 py-3 text-left text-[#444] text-xs font-mono">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-white/3">
                {topCampaigns.map((c, idx) => (
                  <tr key={c.id} className="hover:bg-white/2 transition-colors">
                    <td className="px-4 py-3 text-[#444] text-xs font-mono">#{idx + 1}</td>
                    <td className="px-4 py-3 text-white text-sm max-w-[200px] truncate">{c.name}</td>
                    <td className="px-4 py-3 text-xs font-mono capitalize" style={{ color: { meta: '#1877f2', google: '#4285f4', tiktok: '#ff0050' }[c.platform] || '#888' }}>{c.platform?.toUpperCase()}</td>
                    <td className="px-4 py-3 text-[#888] text-sm font-mono">${parseFloat(c.spend || 0).toFixed(0)}</td>
                    <td className="px-4 py-3 text-[#888] text-sm font-mono">${parseFloat(c.revenue || 0).toFixed(0)}</td>
                    <td className="px-4 py-3">
                      <span className={`text-sm font-bold font-mono ${parseFloat(c.roas) >= 2 ? 'text-[#00ff88]' : parseFloat(c.roas) >= 1 ? 'text-[#ffd700]' : 'text-[#888]'}`}>
                        {parseFloat(c.roas || 0).toFixed(2)}x
                      </span>
                    </td>
                    <td className="px-4 py-3 text-[#888] text-sm font-mono">{(parseFloat(c.ctr || 0) * 100).toFixed(2)}%</td>
                    <td className="px-4 py-3 text-[#888] text-sm font-mono">${parseFloat(c.cpa || 0).toFixed(2)}</td>
                    <td className="px-4 py-3 text-[#888] text-sm font-mono">{parseInt(c.conversions || 0).toLocaleString('tr-TR')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
