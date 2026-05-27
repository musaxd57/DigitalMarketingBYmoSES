import { RadarChart, PolarGrid, PolarAngleAxis, Radar, ResponsiveContainer, Tooltip } from 'recharts';

function ScoreBar({ label, score, color = '#00ff88' }) {
  const pct = Math.min(100, Math.max(0, parseFloat(score) || 0));

  const getColor = (s) => {
    if (s >= 80) return '#00ff88';
    if (s >= 60) return '#ffd700';
    if (s >= 40) return '#ff8c00';
    return '#ff4444';
  };

  const barColor = color || getColor(pct);

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between">
        <span className="text-[#888] text-xs font-mono">{label}</span>
        <span
          className="text-xs font-bold font-mono"
          style={{ color: getColor(pct) }}
        >
          {pct.toFixed(0)}
        </span>
      </div>
      <div className="h-1.5 bg-white/5 rounded-full overflow-hidden">
        <div
          className="h-full rounded-full transition-all duration-700"
          style={{
            width: `${pct}%`,
            background: `linear-gradient(to right, ${getColor(pct)}99, ${getColor(pct)})`,
            boxShadow: `0 0 8px ${getColor(pct)}66`,
          }}
        />
      </div>
    </div>
  );
}

function OverallScoreRing({ score }) {
  const pct = Math.min(100, Math.max(0, parseFloat(score) || 0));
  const r = 36;
  const circ = 2 * Math.PI * r;
  const offset = circ - (pct / 100) * circ;

  const getColor = (s) => {
    if (s >= 80) return '#00ff88';
    if (s >= 60) return '#ffd700';
    if (s >= 40) return '#ff8c00';
    return '#ff4444';
  };

  const color = getColor(pct);

  return (
    <div className="relative w-24 h-24 flex items-center justify-center">
      <svg className="absolute w-full h-full -rotate-90" viewBox="0 0 100 100">
        <circle cx="50" cy="50" r={r} fill="none" stroke="rgba(255,255,255,0.05)" strokeWidth="6" />
        <circle
          cx="50" cy="50" r={r}
          fill="none"
          stroke={color}
          strokeWidth="6"
          strokeDasharray={circ}
          strokeDashoffset={offset}
          strokeLinecap="round"
          style={{ filter: `drop-shadow(0 0 4px ${color}88)`, transition: 'stroke-dashoffset 0.8s ease' }}
        />
      </svg>
      <div className="text-center z-10">
        <span className="font-bold font-mono text-xl" style={{ color }}>{pct.toFixed(0)}</span>
        <p className="text-[#555] text-[10px] font-mono">/100</p>
      </div>
    </div>
  );
}

const CustomTooltip = ({ active, payload }) => {
  if (active && payload?.length) {
    return (
      <div className="bg-[#1a1a24] border border-white/10 rounded-lg px-3 py-2 text-xs">
        <p className="text-[#888]">{payload[0]?.payload?.dimension}</p>
        <p className="text-[#00ff88] font-bold font-mono">{payload[0]?.value?.toFixed(0)}</p>
      </div>
    );
  }
  return null;
};

export default function CreativeScoreCard({ creative, compact = false }) {
  if (!creative) return null;

  const hasScores = creative.creative_score !== null && creative.creative_score !== undefined;

  const radarData = [
    { dimension: 'Hook', value: parseFloat(creative.hook_score || 0) },
    { dimension: 'Retention', value: parseFloat(creative.retention_score || 0) },
    { dimension: 'CTA', value: parseFloat(creative.cta_score || 0) },
    { dimension: 'Emotional', value: parseFloat(creative.emotional_score || 0) },
    { dimension: 'Overall', value: parseFloat(creative.creative_score || 0) },
  ];

  if (compact) {
    return (
      <div className="flex items-center gap-4">
        {hasScores ? (
          <>
            <OverallScoreRing score={creative.creative_score} />
            <div className="flex-1 space-y-2">
              <ScoreBar label="Hook" score={creative.hook_score} />
              <ScoreBar label="Retention" score={creative.retention_score} />
              <ScoreBar label="CTA" score={creative.cta_score} />
              <ScoreBar label="Emotional" score={creative.emotional_score} />
            </div>
          </>
        ) : (
          <div className="text-[#444] text-sm font-mono">Not scored yet</div>
        )}
      </div>
    );
  }

  return (
    <div className="bg-[#111118] rounded-xl border border-white/5 p-5">
      <div className="flex items-start justify-between mb-4">
        <div>
          <h3 className="text-white font-semibold text-sm">{creative.name}</h3>
          <p className="text-[#555] text-xs font-mono mt-0.5 capitalize">{creative.type}</p>
        </div>
        {hasScores && <OverallScoreRing score={creative.creative_score} />}
      </div>

      {hasScores ? (
        <>
          {/* Score bars */}
          <div className="space-y-3 mb-5">
            <ScoreBar label="HOOK SCORE" score={creative.hook_score} />
            <ScoreBar label="RETENTION" score={creative.retention_score} />
            <ScoreBar label="CTA STRENGTH" score={creative.cta_score} />
            <ScoreBar label="EMOTIONAL" score={creative.emotional_score} />
          </div>

          {/* Radar chart */}
          <div className="h-48 -mx-2">
            <ResponsiveContainer width="100%" height="100%">
              <RadarChart data={radarData} margin={{ top: 5, right: 5, bottom: 5, left: 5 }}>
                <PolarGrid stroke="rgba(255,255,255,0.05)" />
                <PolarAngleAxis
                  dataKey="dimension"
                  tick={{ fill: '#555', fontSize: 10, fontFamily: 'monospace' }}
                />
                <Tooltip content={<CustomTooltip />} />
                <Radar
                  name="Score"
                  dataKey="value"
                  stroke="#00ff88"
                  fill="#00ff88"
                  fillOpacity={0.1}
                  strokeWidth={1.5}
                />
              </RadarChart>
            </ResponsiveContainer>
          </div>

          {/* Reasoning */}
          {creative.score_reasoning && (
            <div className="mt-4 p-3 bg-white/3 rounded-lg border border-white/5">
              <p className="text-[#666] text-xs leading-relaxed">{creative.score_reasoning}</p>
            </div>
          )}
        </>
      ) : (
        <div className="flex flex-col items-center justify-center py-8 gap-3">
          <div className="w-12 h-12 rounded-full bg-white/5 flex items-center justify-center">
            <svg className="w-6 h-6 text-[#444]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
            </svg>
          </div>
          <p className="text-[#555] text-sm">Not scored yet</p>
          <p className="text-[#333] text-xs text-center">Click "Score" to get AI-powered creative analysis</p>
        </div>
      )}
    </div>
  );
}
