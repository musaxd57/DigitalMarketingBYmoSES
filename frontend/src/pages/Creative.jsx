import { useState, useEffect, useRef, useCallback } from 'react';
import { aiAPI, creativeAPI } from '../services/api';
import CreativeScoreCard from '../components/CreativeScoreCard';
import { useSocket } from '../App';

const TABS = ['Ad Copy', 'Video Pipeline', 'Voiceover', 'Score Library'];

export default function Creative() {
  const [activeTab, setActiveTab] = useState(0);
  const [creatives, setCreatives] = useState([]);
  const socket = useSocket();

  // Ad Copy state
  const [copyForm, setCopyForm] = useState({
    brandName: '', productDescription: '', targetAudience: '',
    tone: 'persuasive', platform: 'meta', variants: 3, language: 'tr',
  });
  const [generatingCopy, setGeneratingCopy] = useState(false);
  const [copyResults, setCopyResults] = useState(null);

  // Video state
  const [videoForm, setVideoForm] = useState({
    brandName: '', productDescription: '', targetAudience: '',
    videoStyle: 'ugc', duration: 30, platform: 'tiktok',
  });
  const [generatingVideo, setGeneratingVideo] = useState(false);
  const [videoJob, setVideoJob] = useState(null);
  const pollRef = useRef(null);
  const copyPollRef = useRef(null);

  // Voiceover state
  const [voiceForm, setVoiceForm] = useState({ text: '', voiceId: '21m00Tcm4TlvDq8ikWAM' });
  const [generatingVoice, setGeneratingVoice] = useState(false);
  const [audioResult, setAudioResult] = useState(null);
  const voicePollRef = useRef(null);

  // Score library state
  const [loadingCreatives, setLoadingCreatives] = useState(false);
  const [selectedCreative, setSelectedCreative] = useState(null);
  const [scoring, setScoring] = useState(false);

  useEffect(() => {
    if (activeTab === 3) fetchCreatives();
  }, [activeTab]);

  useEffect(() => {
    if (socket && videoJob?.jobId) {
      socket.emit('subscribe:job', { jobId: videoJob.jobId });
      socket.on('job:completed', (data) => {
        setVideoJob((j) => ({ ...j, status: 'completed', assetUrl: data.assetUrl }));
        if (pollRef.current) clearInterval(pollRef.current);
      });
      socket.on('job:failed', (data) => {
        setVideoJob((j) => ({ ...j, status: 'failed', error: data.error }));
        if (pollRef.current) clearInterval(pollRef.current);
      });
    }
    return () => {
      if (socket) {
        socket.off('job:completed');
        socket.off('job:failed');
      }
      if (copyPollRef.current) clearInterval(copyPollRef.current);
      if (voicePollRef.current) clearInterval(voicePollRef.current);
    };
  }, [socket, videoJob?.jobId]);

  const fetchCreatives = async () => {
    setLoadingCreatives(true);
    try {
      const res = await creativeAPI.list({ limit: 20 });
      setCreatives(res.data.creatives || []);
    } finally {
      setLoadingCreatives(false);
    }
  };

  const handleGenerateCopy = async () => {
    if (!copyForm.brandName || !copyForm.productDescription) return;
    setGeneratingCopy(true);
    setCopyResults(null);
    if (copyPollRef.current) clearInterval(copyPollRef.current);

    try {
      const res = await aiAPI.generateAdCopy(copyForm);
      const { generationId } = res.data;

      // Poll every 3 seconds for result
      copyPollRef.current = setInterval(async () => {
        try {
          const statusRes = await aiAPI.getAdCopyStatus(generationId);
          const { status, variants, error } = statusRes.data;
          if (status === 'completed') {
            clearInterval(copyPollRef.current);
            setCopyResults({ variants });
            setGeneratingCopy(false);
          } else if (status === 'failed') {
            clearInterval(copyPollRef.current);
            alert(`Generation failed: ${error || 'Unknown error'}`);
            setGeneratingCopy(false);
          }
        } catch {
          // ignore poll errors, keep trying
        }
      }, 3000);
    } catch (err) {
      alert(`Failed: ${err.response?.data?.error || err.message}`);
      setGeneratingCopy(false);
    }
  };

  const handleGenerateVideo = async () => {
    if (!videoForm.brandName || !videoForm.productDescription) return;
    setGeneratingVideo(true);
    setVideoJob(null);
    try {
      const res = await aiAPI.generateVideo(videoForm);
      setVideoJob({ jobId: res.data.jobId, status: 'processing' });

      // Poll for status
      pollRef.current = setInterval(async () => {
        try {
          const statusRes = await aiAPI.getVideoStatus(res.data.jobId);
          const { status, assetUrl, error } = statusRes.data;
          setVideoJob((j) => ({ ...j, status, assetUrl, error }));
          if (status === 'completed' || status === 'failed') {
            clearInterval(pollRef.current);
          }
        } catch {
          // ignore poll errors
        }
      }, 5000);
    } catch (err) {
      alert(`Failed: ${err.response?.data?.error || err.message}`);
    } finally {
      setGeneratingVideo(false);
    }
  };

  const handleGenerateVoice = async () => {
    if (!voiceForm.text) return;
    setGeneratingVoice(true);
    setAudioResult(null);
    if (voicePollRef.current) clearInterval(voicePollRef.current);

    try {
      const res = await aiAPI.generateVoiceover(voiceForm);
      const { generationId } = res.data;

      // Poll every 4 seconds for result
      voicePollRef.current = setInterval(async () => {
        try {
          const statusRes = await aiAPI.getVoiceoverStatus(generationId);
          const { status, audioBase64, characterCount, error } = statusRes.data;
          if (status === 'completed') {
            clearInterval(voicePollRef.current);
            setAudioResult({ audioBase64, characterCount });
            setGeneratingVoice(false);
          } else if (status === 'failed') {
            clearInterval(voicePollRef.current);
            alert(`Voiceover failed: ${error || 'Unknown error'}`);
            setGeneratingVoice(false);
          }
        } catch {
          // ignore poll errors, keep trying
        }
      }, 4000);

      // Stop polling after 3 minutes
      setTimeout(() => {
        if (voicePollRef.current) {
          clearInterval(voicePollRef.current);
          setGeneratingVoice(false);
        }
      }, 180000);
    } catch (err) {
      alert(`Failed: ${err.response?.data?.error || err.message}`);
      setGeneratingVoice(false);
    }
  };

  const handleScoreCreative = async (id) => {
    setScoring(true);
    try {
      const res = await creativeAPI.score(id);
      setCreatives((prev) => prev.map((c) => c.id === id ? res.data.creative : c));
      setSelectedCreative(res.data.creative);
    } catch (err) {
      alert(`Scoring failed: ${err.response?.data?.error || err.message}`);
    } finally {
      setScoring(false);
    }
  };

  const inputClass = "w-full bg-[#0d0d14] border border-white/5 text-white text-sm rounded-lg px-3 py-2.5 focus:outline-none focus:border-[#00ff88]/40 placeholder-[#333] transition-all";
  const labelClass = "block text-[#666] text-xs font-mono mb-1.5";

  return (
    <div className="p-6 space-y-5">
      <div>
        <h1 className="text-white text-xl font-semibold">Creative Studio</h1>
        <p className="text-[#555] text-sm">AI-powered ad creative generation and analysis</p>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-[#0d0d14] rounded-xl p-1 border border-white/5">
        {TABS.map((tab, i) => (
          <button
            key={tab}
            onClick={() => setActiveTab(i)}
            className={`flex-1 py-2 px-3 rounded-lg text-sm font-medium transition-all
              ${activeTab === i ? 'bg-[#00ff88]/10 text-[#00ff88] border border-[#00ff88]/20' : 'text-[#555] hover:text-[#888]'}`}
          >
            {tab}
          </button>
        ))}
      </div>

      {/* AD COPY TAB */}
      {activeTab === 0 && (
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">
          <div className="bg-[#111118] rounded-xl border border-white/5 p-5 space-y-4">
            <h2 className="text-white font-semibold text-sm">Reklam Metni Oluştur</h2>
            <div className="grid grid-cols-2 gap-4">
              <div className="col-span-2">
                <label className={labelClass}>Marka Adı *</label>
                <input className={inputClass} placeholder="örn. Briva" value={copyForm.brandName}
                  onChange={(e) => setCopyForm((f) => ({ ...f, brandName: e.target.value }))} />
              </div>
              <div className="col-span-2">
                <label className={labelClass}>Ürün / Hizmet Açıklaması *</label>
                <textarea rows={3} className={inputClass} placeholder="Ne reklamını yapıyorsunuz?"
                  value={copyForm.productDescription}
                  onChange={(e) => setCopyForm((f) => ({ ...f, productDescription: e.target.value }))} />
              </div>
              <div className="col-span-2">
                <label className={labelClass}>Hedef Kitle</label>
                <input className={inputClass} placeholder="örn. 25-40 yaş toptan satıcılar"
                  value={copyForm.targetAudience}
                  onChange={(e) => setCopyForm((f) => ({ ...f, targetAudience: e.target.value }))} />
              </div>
              <div>
                <label className={labelClass}>Platform</label>
                <select className={inputClass} value={copyForm.platform}
                  onChange={(e) => setCopyForm((f) => ({ ...f, platform: e.target.value }))}>
                  <option value="meta">Meta (Facebook/Instagram)</option>
                  <option value="google">Google Ads</option>
                  <option value="tiktok">TikTok</option>
                </select>
              </div>
              <div>
                <label className={labelClass}>Ton</label>
                <select className={inputClass} value={copyForm.tone}
                  onChange={(e) => setCopyForm((f) => ({ ...f, tone: e.target.value }))}>
                  <option value="persuasive">İkna Edici</option>
                  <option value="urgent">Aciliyet</option>
                  <option value="casual">Samimi</option>
                  <option value="professional">Profesyonel</option>
                  <option value="funny">Esprili</option>
                </select>
              </div>
              <div>
                <label className={labelClass}>Varyant Sayısı</label>
                <select className={inputClass} value={copyForm.variants}
                  onChange={(e) => setCopyForm((f) => ({ ...f, variants: parseInt(e.target.value) }))}>
                  {[2, 3, 4, 5].map((n) => <option key={n} value={n}>{n} varyant</option>)}
                </select>
              </div>
              <div>
                <label className={labelClass}>Dil / Language</label>
                <select className={inputClass} value={copyForm.language}
                  onChange={(e) => setCopyForm((f) => ({ ...f, language: e.target.value }))}>
                  <option value="tr">Türkçe</option>
                  <option value="en">English</option>
                </select>
              </div>
            </div>
            <button
              onClick={handleGenerateCopy}
              disabled={generatingCopy || !copyForm.brandName || !copyForm.productDescription}
              className="w-full py-2.5 rounded-lg bg-[#00ff88]/10 border border-[#00ff88]/30 text-[#00ff88] font-medium text-sm hover:bg-[#00ff88]/20 transition-all disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {generatingCopy ? (
                <><div className="w-4 h-4 border-2 border-[#00ff88] border-t-transparent rounded-full animate-spin" /> Oluşturuluyor...</>
              ) : '⚡ Reklam Metni Oluştur'}
            </button>
          </div>

          {/* Results */}
          <div className="space-y-3">
            {generatingCopy && (
              <div className="bg-[#111118] rounded-xl border border-white/5 p-10 flex flex-col items-center gap-3">
                <div className="w-10 h-10 border-2 border-[#00ff88] border-t-transparent rounded-full animate-spin" />
                <p className="text-[#555] text-sm">Reklam metni hazırlanıyor...</p>
              </div>
            )}
            {copyResults?.variants?.map((v) => (
              <div key={v.variant} className="bg-[#111118] rounded-xl border border-white/5 p-5 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-[#00ff88] text-xs font-mono">VARYANT {v.variant}</span>
                  {v.uniqueAngle && (
                    <span className="text-[#555] text-xs bg-white/5 px-2 py-0.5 rounded">{v.uniqueAngle}</span>
                  )}
                </div>
                {v.headline && (
                  <div>
                    <p className="text-[#444] text-xs font-mono mb-1">BAŞLIK</p>
                    <p className="text-white font-semibold">{v.headline}</p>
                  </div>
                )}
                {v.hook && (
                  <div>
                    <p className="text-[#444] text-xs font-mono mb-1">KANCA (3sn)</p>
                    <p className="text-[#00ff88] text-sm italic">"{v.hook}"</p>
                  </div>
                )}
                {v.primaryText && (
                  <div>
                    <p className="text-[#444] text-xs font-mono mb-1">ANA METİN</p>
                    <p className="text-[#888] text-sm leading-relaxed">{v.primaryText}</p>
                  </div>
                )}
                {v.callToAction && (
                  <div className="flex items-center gap-2">
                    <span className="text-[#444] text-xs font-mono">EYLEM:</span>
                    <span className="bg-[#00ff88]/10 text-[#00ff88] text-xs px-2 py-0.5 rounded border border-[#00ff88]/20">
                      {v.callToAction}
                    </span>
                  </div>
                )}
                <button
                  onClick={() => navigator.clipboard?.writeText(
                    `${v.headline}\n\n${v.primaryText}\n\nCTA: ${v.callToAction}`
                  )}
                  className="text-[#444] text-xs hover:text-[#888] transition-colors"
                >
                  Kopyala
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* VIDEO PIPELINE TAB */}
      {activeTab === 1 && (
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">
          <div className="bg-[#111118] rounded-xl border border-white/5 p-5 space-y-4">
            <h2 className="text-white font-semibold text-sm">AI Video Production Pipeline</h2>
            <p className="text-[#555] text-xs leading-relaxed">
              Brief → GPT-4 Script → PiAPI Flux Images → PiAPI Kling Video → ElevenLabs VO → Creatomate Render
            </p>
            <div className="grid grid-cols-2 gap-4">
              <div className="col-span-2">
                <label className={labelClass}>Brand Name *</label>
                <input className={inputClass} value={videoForm.brandName}
                  onChange={(e) => setVideoForm((f) => ({ ...f, brandName: e.target.value }))} />
              </div>
              <div className="col-span-2">
                <label className={labelClass}>Product Description *</label>
                <textarea rows={2} className={inputClass} value={videoForm.productDescription}
                  onChange={(e) => setVideoForm((f) => ({ ...f, productDescription: e.target.value }))} />
              </div>
              <div>
                <label className={labelClass}>Platform</label>
                <select className={inputClass} value={videoForm.platform}
                  onChange={(e) => setVideoForm((f) => ({ ...f, platform: e.target.value }))}>
                  <option value="tiktok">TikTok (9:16)</option>
                  <option value="instagram">Instagram (9:16)</option>
                  <option value="facebook">Facebook (4:5)</option>
                  <option value="youtube">YouTube (16:9)</option>
                </select>
              </div>
              <div>
                <label className={labelClass}>Video Style</label>
                <select className={inputClass} value={videoForm.videoStyle}
                  onChange={(e) => setVideoForm((f) => ({ ...f, videoStyle: e.target.value }))}>
                  <option value="ugc">UGC Style</option>
                  <option value="testimonial">Testimonial</option>
                  <option value="product_demo">Product Demo</option>
                  <option value="educational">Educational</option>
                  <option value="entertainment">Entertainment</option>
                </select>
              </div>
              <div>
                <label className={labelClass}>Duration (seconds)</label>
                <select className={inputClass} value={videoForm.duration}
                  onChange={(e) => setVideoForm((f) => ({ ...f, duration: parseInt(e.target.value) }))}>
                  {[15, 30, 45, 60].map((d) => <option key={d} value={d}>{d}s</option>)}
                </select>
              </div>
            </div>
            <button
              onClick={handleGenerateVideo}
              disabled={generatingVideo || !!videoJob?.status === 'processing' || !videoForm.brandName || !videoForm.productDescription}
              className="w-full py-2.5 rounded-lg bg-purple-500/10 border border-purple-500/30 text-purple-400 font-medium text-sm hover:bg-purple-500/20 transition-all disabled:opacity-50 flex items-center justify-center gap-2"
            >
              🎬 Trigger Video Pipeline
            </button>
          </div>

          {/* Video job status */}
          <div className="bg-[#111118] rounded-xl border border-white/5 p-5">
            <h2 className="text-white font-semibold text-sm mb-4">Pipeline Status</h2>
            {!videoJob ? (
              <div className="flex flex-col items-center justify-center py-12 gap-3">
                <div className="w-16 h-16 rounded-full bg-purple-500/5 flex items-center justify-center">
                  <span className="text-3xl">🎬</span>
                </div>
                <p className="text-[#444] text-sm">No active pipeline</p>
                <p className="text-[#333] text-xs">Fill in the form and trigger the video generation</p>
              </div>
            ) : (
              <div className="space-y-4">
                <div className="flex items-center gap-3">
                  {videoJob.status === 'processing' && (
                    <div className="w-5 h-5 border-2 border-purple-400 border-t-transparent rounded-full animate-spin" />
                  )}
                  {videoJob.status === 'completed' && <span className="text-[#00ff88] text-xl">✓</span>}
                  {videoJob.status === 'failed' && <span className="text-red-400 text-xl">✗</span>}
                  <div>
                    <p className="text-white text-sm font-medium capitalize">{videoJob.status}</p>
                    <p className="text-[#555] text-xs font-mono">Job: {videoJob.jobId?.substring(0, 8)}...</p>
                  </div>
                </div>

                {videoJob.status === 'processing' && (
                  <div className="space-y-2">
                    {['Script generation', 'Image generation', 'Video clips', 'Voiceover', 'Final render'].map((step, i) => (
                      <div key={step} className="flex items-center gap-2 text-xs">
                        <div className="w-4 h-4 rounded-full bg-white/5 flex items-center justify-center">
                          <div className="w-1.5 h-1.5 rounded-full bg-purple-400 animate-pulse" />
                        </div>
                        <span className="text-[#555]">{step}</span>
                      </div>
                    ))}
                  </div>
                )}

                {videoJob.status === 'completed' && videoJob.assetUrl && (
                  <a href={videoJob.assetUrl} target="_blank" rel="noreferrer"
                    className="block px-4 py-2 rounded-lg bg-[#00ff88]/10 border border-[#00ff88]/30 text-[#00ff88] text-sm text-center hover:bg-[#00ff88]/20 transition-all">
                    Download Video
                  </a>
                )}

                {videoJob.status === 'failed' && (
                  <p className="text-red-400 text-xs">{videoJob.error || 'Generation failed'}</p>
                )}

                <p className="text-[#333] text-xs">Estimated time: 6-10 minutes</p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* VOICEOVER TAB */}
      {activeTab === 2 && (
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">
          <div className="bg-[#111118] rounded-xl border border-white/5 p-5 space-y-4">
            <h2 className="text-white font-semibold text-sm">Generate Voiceover</h2>
            <p className="text-[#555] text-xs">Powered by ElevenLabs — high-quality, natural-sounding speech</p>
            <div>
              <label className={labelClass}>Script Text *</label>
              <textarea rows={6} className={inputClass}
                placeholder="Enter the voiceover script here... (max 5000 chars)"
                value={voiceForm.text}
                onChange={(e) => setVoiceForm((f) => ({ ...f, text: e.target.value }))} />
              <p className="text-[#333] text-xs mt-1">{voiceForm.text.length}/5000</p>
            </div>
            <div>
              <label className={labelClass}>Voice</label>
              <select className={inputClass} value={voiceForm.voiceId}
                onChange={(e) => setVoiceForm((f) => ({ ...f, voiceId: e.target.value }))}>
                <option value="21m00Tcm4TlvDq8ikWAM">Rachel (Female, American)</option>
                <option value="AZnzlk1XvdvUeBnXmlld">Domi (Female, American)</option>
                <option value="EXAVITQu4vr4xnSDxMaL">Bella (Female, American)</option>
                <option value="ErXwobaYiN019PkySvjV">Antoni (Male, American)</option>
                <option value="VR6AewLTigWG4xSOukaG">Arnold (Male, American)</option>
                <option value="pNInz6obpgDQGcFmaJgB">Adam (Male, American)</option>
              </select>
            </div>
            <button
              onClick={handleGenerateVoice}
              disabled={generatingVoice || !voiceForm.text}
              className="w-full py-2.5 rounded-lg bg-blue-500/10 border border-blue-500/30 text-blue-400 font-medium text-sm hover:bg-blue-500/20 transition-all disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {generatingVoice ? (
                <><div className="w-4 h-4 border-2 border-blue-400 border-t-transparent rounded-full animate-spin" /> Generating...</>
              ) : '🎙️ Generate Voiceover'}
            </button>
          </div>

          <div className="bg-[#111118] rounded-xl border border-white/5 p-5">
            <h2 className="text-white font-semibold text-sm mb-4">Audio Output</h2>
            {audioResult ? (
              <div className="space-y-4">
                <div className="p-4 bg-[#0d0d14] rounded-lg border border-white/5">
                  <audio controls className="w-full" src={audioResult.audioBase64} />
                </div>
                <div className="text-xs text-[#555] font-mono space-y-1">
                  <p>Characters: {audioResult.characterCount}</p>
                  <p>Format: MP3</p>
                </div>
                <a
                  href={audioResult.audioBase64}
                  download="voiceover.mp3"
                  className="block px-4 py-2 rounded-lg bg-blue-500/10 border border-blue-500/30 text-blue-400 text-sm text-center hover:bg-blue-500/20 transition-all"
                >
                  Download MP3
                </a>
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center py-12 gap-3">
                <span className="text-4xl">🎙️</span>
                <p className="text-[#444] text-sm">No audio generated yet</p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* SCORE LIBRARY TAB */}
      {activeTab === 3 && (
        <div className="grid grid-cols-1 xl:grid-cols-3 gap-5">
          {/* Creative list */}
          <div className="xl:col-span-1 bg-[#111118] rounded-xl border border-white/5 overflow-hidden">
            <div className="px-4 py-3 border-b border-white/5 flex items-center justify-between">
              <h2 className="text-white text-sm font-semibold">Creatives</h2>
              <button onClick={fetchCreatives} className="text-[#00ff88] text-xs hover:underline">Refresh</button>
            </div>
            <div className="divide-y divide-white/3 overflow-y-auto max-h-[calc(100vh-280px)]">
              {loadingCreatives ? (
                <div className="p-5 space-y-3">
                  {[...Array(5)].map((_, i) => <div key={i} className="h-14 bg-white/3 animate-pulse rounded" />)}
                </div>
              ) : creatives.length === 0 ? (
                <div className="p-8 text-center text-[#444] text-sm">No creatives yet</div>
              ) : (
                creatives.map((c) => (
                  <button
                    key={c.id}
                    onClick={() => setSelectedCreative(c)}
                    className={`w-full text-left px-4 py-3 hover:bg-white/3 transition-colors
                      ${selectedCreative?.id === c.id ? 'bg-[#00ff88]/5 border-l-2 border-[#00ff88]' : ''}`}
                  >
                    <p className="text-white text-xs font-medium truncate">{c.name}</p>
                    <div className="flex items-center gap-2 mt-1">
                      <span className="text-[#555] text-xs capitalize">{c.type}</span>
                      {c.creative_score !== null && c.creative_score !== undefined && (
                        <span className="text-[#00ff88] text-xs font-mono">
                          ★ {parseFloat(c.creative_score).toFixed(0)}
                        </span>
                      )}
                    </div>
                  </button>
                ))
              )}
            </div>
          </div>

          {/* Score details */}
          <div className="xl:col-span-2">
            {selectedCreative ? (
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <h2 className="text-white font-semibold text-sm">{selectedCreative.name}</h2>
                  <button
                    onClick={() => handleScoreCreative(selectedCreative.id)}
                    disabled={scoring}
                    className="flex items-center gap-2 px-4 py-2 rounded-lg bg-[#00ff88]/10 border border-[#00ff88]/30 text-[#00ff88] text-sm hover:bg-[#00ff88]/20 transition-all disabled:opacity-50"
                  >
                    {scoring ? <div className="w-4 h-4 border-2 border-[#00ff88] border-t-transparent rounded-full animate-spin" /> : null}
                    {scoring ? 'Scoring...' : '⚡ Score with AI'}
                  </button>
                </div>
                <CreativeScoreCard creative={selectedCreative} />
              </div>
            ) : (
              <div className="bg-[#111118] rounded-xl border border-white/5 flex flex-col items-center justify-center p-16 gap-3">
                <span className="text-4xl">📊</span>
                <p className="text-[#444] text-sm">Select a creative to view scores</p>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
