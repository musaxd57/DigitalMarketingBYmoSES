import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { authAPI } from '../services/api';
import { useAuth } from '../App';

export default function Login() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [mode, setMode] = useState('login'); // 'login' | 'register'
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const [form, setForm] = useState({
    email: '', password: '', firstName: '', lastName: '', companyName: '',
  });

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      if (mode === 'register') {
        const res = await authAPI.register(form);
        const { user, accessToken, refreshToken } = res.data;
        login(user, null, { accessToken, refreshToken });
      } else {
        const res = await authAPI.login(form.email, form.password);
        const { user, accessToken, refreshToken } = res.data;
        login(user, { id: user.tenantId, name: user.tenantName, plan: user.plan }, { accessToken, refreshToken });
      }
      navigate('/');
    } catch (err) {
      const errMsg = err.response?.data?.error ||
        err.response?.data?.errors?.[0]?.msg ||
        'Authentication failed';
      setError(errMsg);
    } finally {
      setLoading(false);
    }
  };

  const inputClass = "w-full border text-sm rounded-lg px-4 py-3 focus:outline-none focus:border-[#00ff88]/40 placeholder-[#333] transition-all"
    + " bg-[var(--bg-secondary)] border-[var(--border-color)] text-[var(--text-primary)]";

  return (
    <div className="min-h-screen flex items-center justify-center p-4" style={{ background: 'var(--bg-primary)' }}>
      {/* Background grid */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute inset-0 opacity-[0.02]"
          style={{
            backgroundImage: 'linear-gradient(rgba(0,255,136,0.5) 1px, transparent 1px), linear-gradient(90deg, rgba(0,255,136,0.5) 1px, transparent 1px)',
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
          <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
            {mode === 'login' ? 'Sign in to your dashboard' : 'Create your free account'}
          </p>
        </div>

        {/* Form */}
        <div className="rounded-2xl border p-6 shadow-2xl"
          style={{ background: 'var(--bg-card)', borderColor: 'var(--border-color)' }}
        >
          <form onSubmit={handleSubmit} className="space-y-4">
            {mode === 'register' && (
              <>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[#666] text-xs font-mono mb-1.5">FIRST NAME</label>
                    <input className={inputClass} placeholder="John" required
                      value={form.firstName} onChange={(e) => setForm((f) => ({ ...f, firstName: e.target.value }))} />
                  </div>
                  <div>
                    <label className="block text-[#666] text-xs font-mono mb-1.5">LAST NAME</label>
                    <input className={inputClass} placeholder="Doe" required
                      value={form.lastName} onChange={(e) => setForm((f) => ({ ...f, lastName: e.target.value }))} />
                  </div>
                </div>
                <div>
                  <label className="block text-[#666] text-xs font-mono mb-1.5">COMPANY NAME</label>
                  <input className={inputClass} placeholder="Acme Marketing Co." required
                    value={form.companyName} onChange={(e) => setForm((f) => ({ ...f, companyName: e.target.value }))} />
                </div>
              </>
            )}

            <div>
              <label className="block text-[#666] text-xs font-mono mb-1.5">EMAIL</label>
              <input type="email" className={inputClass} placeholder="you@company.com" required
                value={form.email} onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))} />
            </div>

            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="block text-[#666] text-xs font-mono">PASSWORD</label>
                {mode === 'login' && (
                  <Link to="/forgot-password" className="text-xs text-[#00ff88]/70 hover:text-[#00ff88] transition-colors">
                    Şifremi unuttum?
                  </Link>
                )}
              </div>
              <input type="password" className={inputClass} placeholder="••••••••" required
                minLength={8}
                value={form.password} onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))} />
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
              ) : mode === 'login' ? 'Sign In' : 'Create Account'}
            </button>
          </form>

          <div className="mt-4 text-center">
            <button
              onClick={() => { setMode(mode === 'login' ? 'register' : 'login'); setError(''); }}
              className="text-[#555] text-sm hover:text-[#888] transition-colors"
            >
              {mode === 'login' ? "Don't have an account? " : 'Already have an account? '}
              <span className="text-[#00ff88]">{mode === 'login' ? 'Sign up' : 'Sign in'}</span>
            </button>
          </div>
        </div>

        <p className="text-center text-[#333] text-xs mt-6">
          Digital Marketing AI Platform — All data encrypted at rest
        </p>
      </div>
    </div>
  );
}
