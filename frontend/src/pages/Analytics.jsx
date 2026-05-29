import { useState, useEffect } from 'react';
import {
  LineChart, Line, AreaChart, Area, BarChart, Bar,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from 'recharts';
import { analyticsAPI, reportsAPI } from '../services/api';
import KPICard from '../components/KPICard';
import { format, subDays } from 'date-fns';

const CustomTooltip = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-[#1a1a24] border border-white/10 rounded-lg p-3 shadow-xl">
      <p className="text-[#888] text-xs mb-2 font-mono">{label}</p>
      {payload.map((entry) => (
        <div key={entry.dataKey} className="flex items-center gap-2 text-xs">
          <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: entry.color }} />
          <span className="text-[#666]">{entry.name}:</span>
          <span className="font-bold font-mono" style={{ color: entry.color }}>{String(entry.value)}</span>
        </div>
      ))}
    </div>
  );
};

const METRICS_CONFIG = [
  { key: 'spend', label: 'Spend', color: '#00aaff', format: (v) => `$${parseFloat(v).toFixed(2)}` },
  { key: 'roas', label: 'ROAS', color: '#00ff88', format: (v) => `${parseFloat(v).toFixed(2)}x` },
  { key: 'ctr', label: 'CTR', color: '#ffd700', format: (v) => `${(parseFloat(v) * 100).toFixed(2)}%` },
  { key: 'cpa', label: 'CPA', color: '#ff8c00', format: (v) => `$${parseFloat(v).toFixed(2)}` },
  { key: 'conversions', label: 'Conversions', color: '#9d4edd', format: (v) => parseInt(v).toLocaleString() },
  { key: 'impressions', label: 'Impressions', color: '#36cfc9', format: (v) => parseInt(v).toLocaleString() },
];

export default function Analytics() {
  const [overview, setOverview] = useState(null);
  const [timeseries, setTimeseries] = useState([]);
  const [topCampaigns, setTopCampaigns] = useState([]);
  const [ltv, setLtv] = useState(null);
  const [loading, setLoading] = useState(true);
  const [dateRange, setDateRange] = useState('30d');
  const [selectedMetrics, setSelectedMetrics] = useState(['spend', 'roas', 'ctr']);
  const [chartType, setChartType] = useState('area');
  const [sendingReport, setSendingReport] = useState(false);

  const downloadCSV = () => {
    if (!timeseries.length) return;
    const headers = ['Tarih', 'Harcama', 'Gelir', 'ROAS', 'CTR%', 'CPC', 'CPA', 'Tiklama', 'Gösterim', 'Dönüşüm'];
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
    a.download = `analytics-${dateRange}-${format(new Date(), 'yyyy-MM-dd')}.csv`;
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
    const days = { '7d': 7, '14d': 14, '30d': 30, '90d': 90 }[range] || 30;
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

  const ChartComponent = chartType === 'area' ? AreaChart : chartType === 'bar' ? BarChart : LineChart;

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-white text-xl font-semibold">Analytics</h1>
          <p className="text-[#555] text-sm">Detailed performance analysis</p>
        </div>
        <div className="flex items-center gap-2">
          {['7d', '14d', '30d', '90d'].map((r) => (
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
          { title: 'Total Spend', value: m.totalSpend, format: 'currency', change: overview?.changes?.spend },
          { title: 'Revenue', value: m.totalRevenue, format: 'currency' },
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
          <KPICard title="Avg. Order Value" value={ltv.aov} format="currency" loading={loading} accentColor="#9d4edd" />
          <KPICard title="Avg. CAC" value={ltv.avgCac} format="currency" loading={loading} accentColor="#ff8c00" />
          <KPICard title="Est. LTV" value={ltv.estimatedLtv} format="currency" loading={loading} accentColor="#00ff88" />
          <KPICard title="LTV:CAC Ratio" value={ltv.ltvCacRatio} format="multiplier" loading={loading} accentColor="#ffd700" />
        </div>
      )}

      {/* Timeseries Chart */}
      <div className="bg-[#111118] rounded-xl border border-white/5 p-5">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-5">
          <h2 className="text-white font-semibold text-sm">Performance Over Time</h2>
          <div className="flex flex-wrap items-center gap-2">
            {/* Metric toggles */}
            {METRICS_CONFIG.map((mc) => (
              <button
                key={mc.key}
                onClick={() => toggleMetric(mc.key)}
                className={`px-2.5 py-1 rounded text-xs font-mono transition-all border
                  ${selectedMetrics.includes(mc.key)
                    ? 'border-opacity-30 bg-opacity-10'
                    : 'border-white/5 text-[#444] hover:text-[#666]'
                  }`}
                style={selectedMetrics.includes(mc.key) ? {
                  borderColor: `${mc.color}44`,
                  backgroundColor: `${mc.color}15`,
                  color: mc.color,
                } : {}}
              >
                {mc.label}
              </button>
            ))}
            {/* Chart type selector */}
            <div className="flex items-center border border-white/5 rounded overflow-hidden">
              {[['area', '~'], ['bar', '▌'], ['line', '—']].map(([type, symbol]) => (
                <button
                  key={type}
                  onClick={() => setChartType(type)}
                  className={`px-2.5 py-1 text-xs transition-all ${chartType === type ? 'bg-white/10 text-white' : 'text-[#444]'}`}
                >
                  {symbol}
                </button>
              ))}
            </div>
          </div>
        </div>

        {loading ? (
          <div className="h-64 bg-white/3 animate-pulse rounded-lg" />
        ) : (
          <ResponsiveContainer width="100%" height={280}>
            <LineChart data={timeseries} margin={{ top: 5, right: 5, bottom: 5, left: 5 }}>
              <defs>
                {METRICS_CONFIG.filter((mc) => selectedMetrics.includes(mc.key)).map((mc) => (
                  <linearGradient key={mc.key} id={`grad-${mc.key}`} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor={mc.color} stopOpacity={0.2} />
                    <stop offset="95%" stopColor={mc.color} stopOpacity={0} />
                  </linearGradient>
                ))}
              </defs>
              <CartesianGrid stroke="rgba(255,255,255,0.03)" vertical={false} />
              <XAxis
                dataKey="date"
                tickFormatter={(d) => { try { return format(new Date(d), 'MMM d'); } catch { return d; } }}
                tick={{ fill: '#444', fontSize: 10, fontFamily: 'monospace' }}
                axisLine={false}
                tickLine={false}
              />
              <YAxis tick={{ fill: '#444', fontSize: 10 }} axisLine={false} tickLine={false} />
              <Tooltip content={<CustomTooltip />} />
              <Legend
                formatter={(value) => <span style={{ color: '#666', fontSize: 11 }}>{value}</span>}
              />
              {METRICS_CONFIG
                .filter((mc) => selectedMetrics.includes(mc.key))
                .map((mc) => (
                  <Line
                    key={mc.key}
                    type="monotone"
                    dataKey={mc.key}
                    stroke={mc.color}
                    strokeWidth={2}
                    dot={false}
                    name={mc.label}
                  />
                ))}
            </LineChart>
          </ResponsiveContainer>
        )}
      </div>

      {/* Top Campaigns Table */}
      <div className="bg-[#111118] rounded-xl border border-white/5 overflow-hidden">
        <div className="px-5 py-4 border-b border-white/5">
          <h2 className="text-white font-semibold text-sm">Top Campaigns by ROAS</h2>
        </div>
        {loading ? (
          <div className="p-5 space-y-3">
            {[...Array(5)].map((_, i) => <div key={i} className="h-10 bg-white/3 animate-pulse rounded" />)}
          </div>
        ) : topCampaigns.length === 0 ? (
          <div className="p-10 text-center text-[#444] text-sm">No campaign data available</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-white/5">
                  {['Rank', 'Campaign', 'Platform', 'Spend', 'Revenue', 'ROAS', 'CTR', 'CPA', 'Conv.'].map((h) => (
                    <th key={h} className="px-4 py-3 text-left text-[#444] text-xs font-mono">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-white/3">
                {topCampaigns.map((c, idx) => (
                  <tr key={c.id} className="hover:bg-white/2 transition-colors">
                    <td className="px-4 py-3 text-[#444] text-xs font-mono">#{idx + 1}</td>
                    <td className="px-4 py-3 text-white text-sm max-w-[200px] truncate">{c.name}</td>
                    <td className="px-4 py-3 text-[#888] text-xs font-mono capitalize">{c.platform}</td>
                    <td className="px-4 py-3 text-[#888] text-sm font-mono">${parseFloat(c.spend || 0).toFixed(0)}</td>
                    <td className="px-4 py-3 text-[#888] text-sm font-mono">${parseFloat(c.revenue || 0).toFixed(0)}</td>
                    <td className="px-4 py-3">
                      <span className={`text-sm font-bold font-mono ${parseFloat(c.roas) >= 2 ? 'text-[#00ff88]' : 'text-[#ffd700]'}`}>
                        {parseFloat(c.roas || 0).toFixed(2)}x
                      </span>
                    </td>
                    <td className="px-4 py-3 text-[#888] text-sm font-mono">{(parseFloat(c.ctr || 0) * 100).toFixed(2)}%</td>
                    <td className="px-4 py-3 text-[#888] text-sm font-mono">${parseFloat(c.cpa || 0).toFixed(2)}</td>
                    <td className="px-4 py-3 text-[#888] text-sm font-mono">{parseInt(c.conversions || 0)}</td>
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
