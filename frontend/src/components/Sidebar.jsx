import { NavLink, useNavigate } from 'react-router-dom';
import { useAuth } from '../App';

const NAV_ITEMS = [
  {
    path: '/',
    label: 'Ana Sayfa',
    icon: (
      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
          d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
      </svg>
    ),
  },
  {
    path: '/analytics',
    label: 'Analitik',
    icon: (
      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
          d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
      </svg>
    ),
  },
  {
    path: '/campaigns',
    label: 'Kampanyalar',
    icon: (
      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
          d="M11 3.055A9.001 9.001 0 1020.945 13H11V3.055z" />
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
          d="M20.488 9H15V3.512A9.025 9.025 0 0120.488 9z" />
      </svg>
    ),
  },
  {
    path: '/creative',
    label: 'Kreatif Stüdyo',
    icon: (
      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
          d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
      </svg>
    ),
  },
  {
    path: '/trends',
    label: 'Trend Motoru',
    icon: (
      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
          d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
      </svg>
    ),
    badge: 'NEW',
  },
  {
    path: '/settings',
    label: 'Ayarlar',
    icon: (
      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
          d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
          d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
      </svg>
    ),
  },
];

export default function Sidebar() {
  const { user, tenant, logout } = useAuth();
  const navigate = useNavigate();

  const handleLogout = async () => {
    await logout();
    navigate('/login');
  };

  return (
    <aside className="w-64 bg-[#0d0d14] border-r border-white/5 flex flex-col h-full flex-shrink-0">
      {/* Logo */}
      <div className="px-6 py-5 border-b border-white/5">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-[#00ff88]/20 to-[#00aaff]/20 border border-[#00ff88]/30 flex items-center justify-center flex-shrink-0">
            <svg className="w-4 h-4 text-[#00ff88]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
            </svg>
          </div>
          <div className="min-w-0">
            <h1 className="text-white font-bold text-sm leading-none tracking-tight">Digital Marketing</h1>
            <p className="text-[#00ff88] text-xs mt-0.5 font-mono opacity-70">by Moses</p>
          </div>
        </div>
      </div>

      {/* Tenant info */}
      {tenant && (
        <div className="px-4 py-3 border-b border-white/5">
          <div className="flex items-center gap-2 px-2 py-2 rounded-lg bg-white/3">
            <div className="w-6 h-6 rounded bg-[#00ff88]/20 flex items-center justify-center flex-shrink-0">
              <span className="text-[#00ff88] text-xs font-bold">
                {tenant.name?.charAt(0)?.toUpperCase() || 'T'}
              </span>
            </div>
            <div className="min-w-0">
              <p className="text-white text-xs font-medium truncate">{tenant.name}</p>
              <p className="text-[#666] text-xs capitalize">{tenant.plan} plan</p>
            </div>
          </div>
        </div>
      )}

      {/* Navigation */}
      <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto">
        {NAV_ITEMS.map((item) => (
          <NavLink
            key={item.path}
            to={item.path}
            end={item.path === '/'}
            className={({ isActive }) =>
              `flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-all duration-150 group relative
              ${isActive
                ? 'bg-[#00ff88]/10 text-[#00ff88] border border-[#00ff88]/20'
                : 'text-[#888] hover:text-white hover:bg-white/5 border border-transparent'
              }`
            }
          >
            {({ isActive }) => (
              <>
                <span className={isActive ? 'text-[#00ff88]' : 'text-[#555] group-hover:text-[#aaa]'}>
                  {item.icon}
                </span>
                <span className="font-medium">{item.label}</span>
                {item.badge && (
                  <span className="ml-auto text-[10px] font-bold bg-[#00ff88]/20 text-[#00ff88] px-1.5 py-0.5 rounded font-mono">
                    {item.badge}
                  </span>
                )}
                {isActive && (
                  <span className="absolute left-0 top-1/2 -translate-y-1/2 w-0.5 h-6 bg-[#00ff88] rounded-full" />
                )}
              </>
            )}
          </NavLink>
        ))}
      </nav>

      {/* Platform status indicators */}
      <div className="px-4 py-3 border-t border-white/5">
        <p className="text-[#444] text-xs font-mono uppercase tracking-wider mb-2">Platformlar</p>
        <div className="space-y-1.5">
          {[
            { name: 'Meta Ads', color: '#1877f2' },
            { name: 'Google Ads', color: '#4285f4' },
            { name: 'TikTok Ads', color: '#ff0050' },
          ].map((p) => (
            <div key={p.name} className="flex items-center gap-2">
              <div className="w-1.5 h-1.5 rounded-full bg-[#333]" style={{ boxShadow: `0 0 4px ${p.color}44` }} />
              <span className="text-[#555] text-xs">{p.name}</span>
            </div>
          ))}
        </div>
      </div>

      {/* User + logout */}
      <div className="px-4 py-4 border-t border-white/5">
        <div className="flex items-center gap-3">
          <div className="w-7 h-7 rounded-full bg-gradient-to-br from-[#00ff88]/30 to-[#00aaff]/30 flex items-center justify-center flex-shrink-0">
            <span className="text-white text-xs font-semibold">
              {user?.firstName?.charAt(0)?.toUpperCase() || 'U'}
            </span>
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-white text-xs font-medium truncate">
              {user?.firstName} {user?.lastName}
            </p>
            <p className="text-[#555] text-xs truncate">{user?.role}</p>
          </div>
          <button
            onClick={handleLogout}
            className="text-[#555] hover:text-red-400 transition-colors"
            title="Çıkış Yap"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
            </svg>
          </button>
        </div>
      </div>
    </aside>
  );
}
