import { useState } from 'react';

export default function KPICard({
  title,
  value,
  change,
  changeLabel,
  prefix = '',
  suffix = '',
  format = 'number',
  icon,
  accentColor = '#00ff88',
  loading = false,
}) {
  const [hovered, setHovered] = useState(false);
  const formatValue = (val) => {
    if (val === null || val === undefined) return '--';
    const num = parseFloat(val);
    if (isNaN(num)) return val;

    switch (format) {
      case 'currency':
        return num >= 1000000
          ? `$${(num / 1000000).toFixed(2)}M`
          : num >= 1000
          ? `$${(num / 1000).toFixed(1)}K`
          : `$${num.toFixed(2)}`;
      case 'percent':
        return `${(num * 100).toFixed(2)}%`;
      case 'multiplier':
        return `${num.toFixed(2)}x`;
      case 'integer':
        return num >= 1000000
          ? `${(num / 1000000).toFixed(1)}M`
          : num >= 1000
          ? `${(num / 1000).toFixed(1)}K`
          : num.toLocaleString();
      default:
        return num >= 1000 ? num.toLocaleString() : num.toFixed(2);
    }
  };

  const isPositiveChange = change !== null && change !== undefined && parseFloat(change) > 0;
  const isNegativeChange = change !== null && change !== undefined && parseFloat(change) < 0;
  const changeAbs = change !== null && change !== undefined ? Math.abs(parseFloat(change)).toFixed(1) : null;

  // For CPA/CAC, lower is better
  const invertedMetrics = ['CPA', 'CAC', 'CPC', 'CPM'];
  const isInverted = invertedMetrics.some((m) => title?.toUpperCase().includes(m));
  const showPositive = isInverted ? isNegativeChange : isPositiveChange;
  const showNegative = isInverted ? isPositiveChange : isNegativeChange;

  return (
    <div
      className="relative rounded-xl border bg-[#111118] p-5 overflow-hidden transition-all duration-300 hover:-translate-y-1 hover:shadow-lg hover:shadow-black/30 group"
      style={{ borderColor: hovered ? `${accentColor}4d` : 'rgba(255,255,255,0.05)' }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {/* Subtle glow accent */}
      <div
        className="absolute top-0 right-0 w-20 h-20 rounded-full blur-2xl opacity-5 pointer-events-none"
        style={{ background: accentColor }}
      />

      {/* Header */}
      <div className="flex items-start justify-between mb-3">
        <span className="text-[#666] text-xs font-mono uppercase tracking-wider">{title}</span>
        {icon && (
          <div
            className="w-8 h-8 rounded-lg flex items-center justify-center"
            style={{ backgroundColor: `${accentColor}15`, border: `1px solid ${accentColor}25` }}
          >
            <span style={{ color: accentColor }}>{icon}</span>
          </div>
        )}
      </div>

      {/* Value */}
      {loading ? (
        <div className="skeleton h-8 w-32 mb-2" />
      ) : (
        <div className="flex items-baseline gap-1 mb-2">
          {prefix && <span className="text-[#888] text-lg">{prefix}</span>}
          <span
            className="text-2xl font-bold font-mono tracking-tight"
            style={{ color: '#e0e0e0' }}
          >
            {formatValue(value)}
          </span>
          {suffix && <span className="text-[#888] text-sm">{suffix}</span>}
        </div>
      )}

      {/* Change indicator */}
      {changeAbs !== null && !loading && (
        <div className="flex items-center gap-1.5">
          <span
            className={`flex items-center gap-0.5 text-xs font-semibold font-mono
              ${showPositive ? 'text-[#00ff88]' : showNegative ? 'text-red-400' : 'text-[#666]'}
            `}
          >
            {showPositive && (
              <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 10l7-7m0 0l7 7m-7-7v18" />
              </svg>
            )}
            {showNegative && (
              <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M19 14l-7 7m0 0l-7-7m7 7V3" />
              </svg>
            )}
            {changeAbs}%
          </span>
          <span className="text-[#444] text-xs">{changeLabel || 'vs last period'}</span>
        </div>
      )}

      {/* Bottom border accent */}
      <div
        className="absolute bottom-0 left-0 h-[1.5px] w-full opacity-30"
        style={{ background: `linear-gradient(to right, transparent, ${accentColor}, transparent)` }}
      />
    </div>
  );
}
