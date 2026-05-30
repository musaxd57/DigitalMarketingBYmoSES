import { useState } from 'react';
import { Link } from 'react-router-dom';
import { authAPI } from '../services/api';

export default function ForgotPassword() {
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await authAPI.forgotPassword(email);
      setSubmitted(true);
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to send reset email');
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
          <p className="text-sm" style={{ color: 'var(--text-muted)' }}>Şifre sıfırlama bağlantısı al</p>
        </div>

        {/* Card */}
        <div
          className="rounded-2xl border p-6 shadow-2xl"
          style={{ background: 'var(--bg-card)', borderColor: 'var(--border-color)' }}
        >
          {submitted ? (
            <div className="text-center space-y-4">
              <div className="w-12 h-12 rounded-full bg-[#00ff88]/10 border border-[#00ff88]/30 flex items-center justify-center mx-auto">
                <svg className="w-6 h-6 text-[#00ff88]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M5 13l4 4L19 7" />
                </svg>
              </div>
              <p className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
                E-posta gönderildi
              </p>
              <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                Eğer bu e-posta adresine kayıtlı bir hesap varsa, şifre sıfırlama bağlantısı gönderildi. Gelen kutunuzu kontrol edin.
              </p>
              <Link
                to="/login"
                className="block w-full py-3 rounded-xl text-center text-sm font-semibold text-[#00ff88] bg-[#00ff88]/10 border border-[#00ff88]/30 hover:bg-[#00ff88]/20 transition-all mt-2"
              >
                Giriş sayfasına dön
              </Link>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="block text-[#666] text-xs font-mono mb-1.5">E-POSTA ADRESİ</label>
                <input
                  type="email"
                  className={inputClass}
                  placeholder="siz@sirket.com"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
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
                  'Sıfırlama Bağlantısı Gönder'
                )}
              </button>
            </form>
          )}
        </div>

        {!submitted && (
          <div className="mt-4 text-center">
            <Link to="/login" className="text-sm" style={{ color: 'var(--text-muted)' }}>
              ← <span className="hover:text-[#00ff88] transition-colors">Giriş sayfasına dön</span>
            </Link>
          </div>
        )}

        <p className="text-center text-[#333] text-xs mt-6">
          Digital Marketing AI Platform — All data encrypted at rest
        </p>
      </div>
    </div>
  );
}
