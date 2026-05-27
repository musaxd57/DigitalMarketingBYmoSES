import { useState, useEffect } from 'react';
import { trendsAPI } from '../services/api';

function OpportunityScore({ score }) {
  const s = parseFloat(score) || 0;
  const color = s >= 75 ? '#00ff88' : s >= 50 ? '#ffd700' : '#ff8c00';
  return (
    <div className="flex items-center gap-3">
      <div className="relative w-16 h-16">
        <svg className="w-full h-full -rotate-90" viewBox="0 0 60 60">
          <circle cx="30" cy="30" r="25" fill="none" stroke="rgba(255,255,255,0.05)" strokeWidth="5" />
          <circle
            cx="30" cy="30" r="25"
            fill="none"
            stroke={color}
            strokeWidth="5"
            strokeDasharray={`${2 * Math.PI * 25}`}
            strokeDashoffset={`${2 * Math.PI * 25 * (1 - s / 100)}`}
            strokeLinecap="round"
            style={{ filter: `drop-shadow(0 0 4px ${color}66)` }}
          />
        </svg>
        <div className="absolute inset-0 flex items-center justify-center">
          <span className="font-bold font-mono text-sm" style={{ color }}>{s.toFixed(0)}</span>
        </div>
      </div>
      <div>
        <p className="text-white text-sm font-semibold">Opportunity Score</p>
        <p className="text-[#555] text-xs">{s >= 75 ? 'High opportunity' : s >= 50 ? 'Moderate' : 'Low opportunity'}</p>
      </div>
    </div>
  );
}

function HashtagCard({ tag }) {
  return (
    <div className="bg-[#0d0d14] rounded-lg border border-white/5 p-3 hover:border-[#00ff88]/20 transition-all">
      <div className="flex items-start justify-between gap-2 mb-2">
        <span className="text-[#00ff88] font-mono text-sm font-bold">{tag.tag}</span>
        <span className="text-[#00ff88] text-xs font-mono bg-[#00ff88]/10 px-1.5 py-0.5 rounded flex-shrink-0">
          {tag.growth}
        </span>
      </div>
      <div className="flex items-center justify-between text-xs text-[#555]">
        <span className="font-mono">{tag.volume}</span>
        <span className="capitalize">{tag.platform}</span>
      </div>
      {tag.bestUseCase && (
        <p className="text-[#444] text-xs mt-2 leading-relaxed">{tag.bestUseCase}</p>
      )}
    </div>
  );
}

function FormatCard({ format }) {
  const difficultyColor = { easy: '#00ff88', medium: '#ffd700', hard: '#ff8c00' };
  return (
    <div className="bg-[#0d0d14] rounded-lg border border-white/5 p-4 space-y-2">
      <div className="flex items-start justify-between">
        <h4 className="text-white text-sm font-semibold">{format.format}</h4>
        <span className="text-xs font-mono px-2 py-0.5 rounded"
          style={{ color: difficultyColor[format.difficulty], backgroundColor: `${difficultyColor[format.difficulty]}15` }}>
          {format.difficulty}
        </span>
      </div>
      <p className="text-[#666] text-xs leading-relaxed">{format.description}</p>
      {format.avgEngagementBoost && (
        <p className="text-[#00ff88] text-xs font-mono">Engagement: {format.avgEngagementBoost}</p>
      )}
      {format.example && (
        <p className="text-[#444] text-xs italic">"{format.example}"</p>
      )}
    </div>
  );
}

function HookCard({ hook }) {
  return (
    <div className="bg-[#0d0d14] rounded-lg border border-white/5 p-3 space-y-2">
      <p className="text-white text-sm font-medium">"{hook.hook}"</p>
      <div className="flex items-center justify-between">
        <span className="text-[#555] text-xs font-mono">{hook.pattern}</span>
        {hook.avgRetentionBoost && (
          <span className="text-[#00ff88] text-xs font-mono">{hook.avgRetentionBoost} retention</span>
        )}
      </div>
    </div>
  );
}

export default function TrendEngine() {
  const [report, setReport] = useState(null);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [platform, setPlatform] = useState('tiktok');
  const [niche, setNiche] = useState('');
  const [activeSection, setActiveSection] = useState('hashtags');

  useEffect(() => {
    fetchLatest();
  }, []);

  const fetchLatest = async () => {
    setLoading(true);
    try {
      const res = await trendsAPI.latest();
      setReport(res.data.report);
    } catch (err) {
      if (err.response?.status !== 404) console.error('[Trends] Fetch error:', err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleGenerate = async () => {
    setGenerating(true);
    try {
      await trendsAPI.generate({ platform, niche: niche || undefined });
      // Poll for completion
      const pollInterval = setInterval(async () => {
        try {
          const res = await trendsAPI.latest({ platform });
          if (res.data.report?.status === 'completed') {
            setReport(res.data.report);
            setGenerating(false);
            clearInterval(pollInterval);
          }
        } catch {
          // ignore
        }
      }, 3000);
      // Stop polling after 3 minutes
      setTimeout(() => {
        clearInterval(pollInterval);
        setGenerating(false);
      }, 180000);
    } catch (err) {
      alert(`Failed: ${err.response?.data?.error || err.message}`);
      setGenerating(false);
    }
  };

  const sections = [
    { key: 'hashtags', label: 'Hashtags', count: report?.trending_hashtags?.length || 0 },
    { key: 'formats', label: 'Formats', count: report?.trending_formats?.length || 0 },
    { key: 'hooks', label: 'Viral Hooks', count: report?.viral_hooks?.length || 0 },
    { key: 'sounds', label: 'Sounds', count: report?.trending_sounds?.length || 0 },
    { key: 'recommendations', label: 'Actions', count: report?.recommendations?.length || 0 },
  ];

  return (
    <div className="p-6 space-y-5">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-white text-xl font-semibold">Trend Engine</h1>
          <p className="text-[#555] text-sm">AI-powered viral content trend analysis</p>
        </div>
        <div className="flex items-center gap-2">
          <input
            className="bg-[#111118] border border-white/5 text-white text-sm rounded-lg px-3 py-2 w-36 focus:outline-none focus:border-[#00ff88]/30 placeholder-[#333]"
            placeholder="Niche (optional)"
            value={niche}
            onChange={(e) => setNiche(e.target.value)}
          />
          <select
            value={platform}
            onChange={(e) => setPlatform(e.target.value)}
            className="bg-[#111118] border border-white/5 text-[#888] text-sm rounded-lg px-3 py-2 focus:outline-none"
          >
            <option value="tiktok">TikTok</option>
            <option value="instagram">Instagram</option>
            <option value="all">All Platforms</option>
          </select>
          <button
            onClick={handleGenerate}
            disabled={generating}
            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-[#00ff88]/10 border border-[#00ff88]/30 text-[#00ff88] text-sm font-medium hover:bg-[#00ff88]/20 transition-all disabled:opacity-50"
          >
            {generating ? (
              <div className="w-4 h-4 border-2 border-[#00ff88] border-t-transparent rounded-full animate-spin" />
            ) : '⚡'}
            {generating ? 'Analyzing...' : 'Run Analysis'}
          </button>
        </div>
      </div>

      {loading ? (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="h-32 bg-[#111118] rounded-xl border border-white/5 animate-pulse" />
          ))}
        </div>
      ) : !report ? (
        <div className="flex flex-col items-center justify-center py-24 gap-4">
          <div className="w-20 h-20 rounded-full bg-[#00ff88]/5 border border-[#00ff88]/10 flex items-center justify-center">
            <span className="text-4xl">📈</span>
          </div>
          <h3 className="text-white text-lg font-semibold">No Trend Reports Yet</h3>
          <p className="text-[#555] text-sm text-center max-w-sm">
            Click "Run Analysis" to generate your first AI-powered trend report. Analysis takes about 2 minutes.
          </p>
        </div>
      ) : (
        <>
          {/* Report header */}
          <div className="bg-[#111118] rounded-xl border border-white/5 p-5">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="flex-1">
                <div className="flex items-center gap-3 mb-2">
                  <span className="text-[#555] text-xs font-mono">
                    {new Date(report.report_date).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}
                  </span>
                  <span className="text-xs font-mono px-2 py-0.5 rounded bg-[#00ff88]/10 text-[#00ff88] border border-[#00ff88]/20 capitalize">
                    {report.platform}
                  </span>
                  {report.niche && (
                    <span className="text-xs text-[#555] font-mono">#{report.niche}</span>
                  )}
                </div>
                <p className="text-[#888] text-sm leading-relaxed max-w-2xl">{report.summary}</p>
              </div>
              {report.opportunity_score && <OpportunityScore score={report.opportunity_score} />}
            </div>
          </div>

          {/* Section tabs */}
          <div className="flex gap-2 overflow-x-auto">
            {sections.map((s) => (
              <button
                key={s.key}
                onClick={() => setActiveSection(s.key)}
                className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium whitespace-nowrap transition-all
                  ${activeSection === s.key
                    ? 'bg-[#00ff88]/10 text-[#00ff88] border border-[#00ff88]/30'
                    : 'text-[#555] border border-white/5 hover:text-[#888]'
                  }`}
              >
                {s.label}
                {s.count > 0 && (
                  <span className={`text-xs px-1.5 py-0.5 rounded font-mono
                    ${activeSection === s.key ? 'bg-[#00ff88]/20' : 'bg-white/5'}`}>
                    {s.count}
                  </span>
                )}
              </button>
            ))}
          </div>

          {/* Content sections */}
          {activeSection === 'hashtags' && (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
              {(report.trending_hashtags || []).map((tag, i) => (
                <HashtagCard key={i} tag={tag} />
              ))}
            </div>
          )}

          {activeSection === 'formats' && (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
              {(report.trending_formats || []).map((format, i) => (
                <FormatCard key={i} format={format} />
              ))}
            </div>
          )}

          {activeSection === 'hooks' && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {(report.viral_hooks || []).map((hook, i) => (
                <HookCard key={i} hook={hook} />
              ))}
            </div>
          )}

          {activeSection === 'sounds' && (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {(report.trending_sounds || []).length === 0 ? (
                <p className="text-[#444] text-sm col-span-full">No trending sounds in this report</p>
              ) : (
                (report.trending_sounds || []).map((sound, i) => (
                  <div key={i} className="bg-[#0d0d14] rounded-lg border border-white/5 p-4 space-y-2">
                    <div className="flex items-start justify-between">
                      <h4 className="text-white text-sm font-semibold">{sound.name}</h4>
                      <span className="text-xs text-[#555] font-mono capitalize">{sound.mood}</span>
                    </div>
                    {sound.usageCount && <p className="text-[#555] text-xs font-mono">{sound.usageCount} videos</p>}
                    {sound.bestFor && <p className="text-[#444] text-xs">Best for: {sound.bestFor}</p>}
                  </div>
                ))
              )}
            </div>
          )}

          {activeSection === 'recommendations' && (
            <div className="space-y-3">
              {(report.recommendations || [])
                .sort((a, b) => (a.priority || 99) - (b.priority || 99))
                .map((rec, i) => (
                  <div key={i} className="bg-[#111118] rounded-xl border border-white/5 p-5 flex items-start gap-4">
                    <div className="w-8 h-8 rounded-lg bg-[#00ff88]/10 border border-[#00ff88]/20 flex items-center justify-center flex-shrink-0">
                      <span className="text-[#00ff88] font-bold font-mono text-sm">{i + 1}</span>
                    </div>
                    <div className="flex-1 space-y-1">
                      <h4 className="text-white font-semibold text-sm">{rec.title}</h4>
                      <p className="text-[#666] text-sm leading-relaxed">{rec.action}</p>
                      <div className="flex flex-wrap items-center gap-3 mt-2">
                        {rec.expectedImpact && (
                          <span className="text-[#00ff88] text-xs font-mono">Impact: {rec.expectedImpact}</span>
                        )}
                        {rec.timeToImplement && (
                          <span className="text-[#555] text-xs font-mono">⏱ {rec.timeToImplement}</span>
                        )}
                        {rec.effort && (
                          <span className={`text-xs font-mono capitalize ${
                            rec.effort === 'low' ? 'text-[#00ff88]' :
                            rec.effort === 'medium' ? 'text-[#ffd700]' : 'text-[#ff8c00]'
                          }`}>
                            {rec.effort} effort
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
