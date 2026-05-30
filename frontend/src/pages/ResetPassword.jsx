import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { authAPI } from '../services/api';

export default function ResetPassword() {
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token') || '';
  const navigate = useNavigate();

  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');

    if (password !== confirm) {
      setError('Şifreler eşleşmiyor');
      return;
    }
    if (password.length < 8) {
      setError('Şifre en az 8 karakter olmalıdır');
      return;
    }

    setLoading(true);
    try {
      await authAPI.resetPassword(token, password);
      navigate('/login', { replace: true });
    } catch (err) {
      setError(err.response?.data?.error || 'Şifre sıfırlama başarısız');
    } finally {
      setLoading(false);
    }
  };

  const inputClass =
    'w-full border text-sm rounded-lg px-4 py-3 focus:outline-none focus:border-[#00ff88]/40 placeholder-[#333] transition-all' +
    ' bg-[var(--bg-secondary)] border-[var(--border-color)] text-[var(--text-primary)]';

  return (
    <div className="min-h-screen flex items-center justify-center p-4" style={{ background: 'var(--bg-primary)' }}>
      {/* Background grid */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div
          className="absolute inset-0 opacity-[0.02]"
          style={{
            backgroundImage:
              'linear-gradient(rgba(0,255,136,0.5) 1px, transparent 1px), linear-gradient(90deg, rgba(0,255,136,0.5) 1px, transparent 1px)',
            backgroundSize: '40px 40px',
          }}
        />
        <div
          className="absolute inset-0"
          style={{ background: 'radial-gradient(ellipse at top left, rgba(0,120,255,0.04) 0%, transparent 60%)' }}
        />
      </div>

      <div className="w-full max-w-sm relative">
        {/* Logo */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center gap-3 mb-4">
            <div className="w-10 h-10 rounded-xl bg-[#00ff88]/10 border border-[#00ff88]/30 flex items-center justify-center">
              <span className="text-[#00ff88] font-bold text-sm font-mono">AI</span>
            </div>
            <span className="text-xl font-bold" style={{ color: 'var(--text-primary)' }}>
              Digital Marketing by Moses
            </span>
          </div>
          <p className="text-sm" style={{ color: 'var(--text-muted)' }}>Yeni şifrenizi belirleyin</p>
        </div>

        {/* Card */}
        <div
          className="rounded-2xl border p-6 shadow-2xl"
          style={{ background: 'var(--bg-card)', borderColor: 'var(--border-color)' }}
        >
          {!token ? (
            <div className="text-center space-y-4">
              <p className="text-sm text-red-400">Geçersiz sıfırlama bağlantısı. Lütfen tekrar deneyin.</p>
              <Link
                to="/forgot-password"
                className="block w-full py-3 rounded-xl text-center text-sm font-semibold text-[#00ff88] bg-[#00ff88]/10 border border-[#00ff88]/30 hover:bg-[#00ff88]/20 transition-all"
              >
                Yeni bağlantı talep et
              </Link>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="block text-[#666] text-xs font-mono mb-1.5">YENİ ŞİFRE</label>
                <input
                  type="password"
                  className={inputClass}
                  placeholder="••••••••"
                  required
                  minLength={8}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </div>

              <div>
                <label className="block text-[#666] text-xs font-mono mb-1.5">ŞİFREYİ TEKRARLA</label>
                <input
                  type="password"
                  className={inputClass}
                  placeholder="••••••••"
                  required
                  minLength={8}
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                />
              </div>

              {error && (
                <div className="bg-red-500/10 border border-red-500/30 rounded-lg px-4 py-3">
                  <p className="text-red-400 text-sm">{error}</p>
                </div>
              )}

              <button
                type="submit"
                disabled={loading}
                className="w-full py-3 rounded-xl bg-[#00ff88]/10 border border-[#00ff88]/30 text-[#00ff88] font-semibold text-sm hover:bg-[#00ff88]/20 transition-all disabled:opacity-50 flex items-center justify-center gap-2 mt-2"
              >
                {loading ? (
                  <div className="w-4 h-4 border-2 border-[#00ff88] border-t-transparent rounded-full animate-spin" />
                ) : (
                  'Şifreyi Sıfırla'
                )}
              </button>
            </form>
          )}
        </div>

        <div className="mt-4 text-center">
          <Link to="/login" className="text-sm" style={{ color: 'var(--text-muted)' }}>
            ← <span className="hover:text-[#00ff88] transition-colors">Giriş sayfasına dön</span>
          </Link>
        </div>

        <p className="text-center text-[#333] text-xs mt-6">
          Digital Marketing AI Platform — All data encrypted at rest
        </p>
      </div>
    </div>
  );
}
