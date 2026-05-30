import { useState, useEffect, createContext, useContext } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { io } from 'socket.io-client';
import Sidebar from './components/Sidebar';
import Dashboard from './pages/Dashboard';
import Analytics from './pages/Analytics';
import Campaigns from './pages/Campaigns';
import Creative from './pages/Creative';
import TrendEngine from './pages/TrendEngine';
import Settings from './pages/Settings';
import Login from './pages/Login';
import ForgotPassword from './pages/ForgotPassword';
import ResetPassword from './pages/ResetPassword';
import { authAPI } from './services/api';

// ─── Auth Context ─────────────────────────────────────────────────────────────
export const AuthContext = createContext(null);
export const SocketContext = createContext(null);

export function useAuth() {
  return useContext(AuthContext);
}

export function useSocket() {
  return useContext(SocketContext);
}

// ─── Theme Context ────────────────────────────────────────────────────────────
export const ThemeContext = createContext(null);

export function useTheme() {
  return useContext(ThemeContext);
}

// ─── Protected Route ──────────────────────────────────────────────────────────
function ProtectedRoute({ children }) {
  const { user, loading } = useAuth();
  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center bg-[#080d1a]">
        <div className="flex flex-col items-center gap-4">
          <div className="h-10 w-10 animate-spin rounded-full border-2 border-[#00ff88] border-t-transparent" />
          <span className="text-[#00ff88] font-mono text-sm">INITIALIZING...</span>
        </div>
      </div>
    );
  }
  if (!user) return <Navigate to="/login" replace />;
  return children;
}

// ─── Layout ───────────────────────────────────────────────────────────────────
function AppLayout({ children }) {
  return (
    <div
      className="flex h-screen text-[#e0e0e0] overflow-hidden relative"
      style={{ background: 'var(--bg-primary)' }}
    >
      {/* Subtle radial gradient glow top-left */}
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background: 'radial-gradient(ellipse at top left, rgba(0,120,255,0.04) 0%, transparent 60%)',
        }}
      />
      <Sidebar />
      <main className="flex-1 overflow-y-auto relative">
        {children}
      </main>
    </div>
  );
}

// ─── App ──────────────────────────────────────────────────────────────────────
export default function App() {
  const [user, setUser] = useState(null);
  const [tenant, setTenant] = useState(null);
  const [loading, setLoading] = useState(true);
  const [socket, setSocket] = useState(null);
  const [notifications, setNotifications] = useState([]);

  // ─── Theme ──────────────────────────────────────────────────────────────────
  const [theme, setThemeState] = useState(() => {
    return localStorage.getItem('theme') || 'dark';
  });

  const setTheme = (newTheme) => {
    setThemeState(newTheme);
    localStorage.setItem('theme', newTheme);
    document.documentElement.classList.toggle('light', newTheme === 'light');
  };

  // Apply theme class on mount and when theme changes
  useEffect(() => {
    document.documentElement.classList.toggle('light', theme === 'light');
  }, [theme]);

  // Initialize auth state from localStorage
  useEffect(() => {
    const initAuth = async () => {
      const token = localStorage.getItem('accessToken');
      if (!token) {
        setLoading(false);
        return;
      }
      try {
        const res = await authAPI.getMe();
        setUser(res.data.user);
        setTenant(res.data.tenant);
      } catch {
        localStorage.removeItem('accessToken');
        localStorage.removeItem('refreshToken');
      } finally {
        setLoading(false);
      }
    };
    initAuth();
  }, []);

  // Initialize Socket.IO when user is authenticated
  useEffect(() => {
    if (!user) return;

    const token = localStorage.getItem('accessToken');
    const socketInstance = io(import.meta.env.VITE_API_URL || 'http://localhost:3001', {
      auth: { token },
      transports: ['websocket', 'polling'],
      reconnectionAttempts: 5,
      reconnectionDelay: 2000,
    });

    socketInstance.on('connect', () => {
      console.log('[Socket] Connected:', socketInstance.id);
    });

    socketInstance.on('connect_error', (err) => {
      console.warn('[Socket] Connection error:', err.message);
    });

    socketInstance.on('video:completed', (data) => {
      addNotification({ type: 'success', title: 'Video Ready', message: 'Your AI video has been generated!', data });
    });

    socketInstance.on('analytics:synced', (data) => {
      addNotification({ type: 'info', title: 'Analytics Updated', message: `${data.platform} data synced successfully` });
    });

    socketInstance.on('trends:updated', () => {
      addNotification({ type: 'info', title: 'Trends Updated', message: 'New trend report is available' });
    });

    setSocket(socketInstance);

    return () => {
      socketInstance.disconnect();
    };
  }, [user]);

  const addNotification = (notif) => {
    const id = Date.now();
    setNotifications((prev) => [{ ...notif, id }, ...prev.slice(0, 4)]);
    setTimeout(() => {
      setNotifications((prev) => prev.filter((n) => n.id !== id));
    }, 5000);
  };

  const login = (userData, tenantData, tokens) => {
    localStorage.setItem('accessToken', tokens.accessToken);
    localStorage.setItem('refreshToken', tokens.refreshToken);
    setUser(userData);
    setTenant(tenantData);
  };

  const logout = async () => {
    const refreshToken = localStorage.getItem('refreshToken');
    try {
      await authAPI.logout(refreshToken);
    } catch {
      // Best-effort logout
    }
    localStorage.removeItem('accessToken');
    localStorage.removeItem('refreshToken');
    setUser(null);
    setTenant(null);
    if (socket) socket.disconnect();
  };

  return (
    <ThemeContext.Provider value={{ theme, setTheme }}>
      <AuthContext.Provider value={{ user, tenant, loading, login, logout, notifications, addNotification }}>
        <SocketContext.Provider value={socket}>
          <BrowserRouter>
            {/* Global Notifications */}
            <div className="fixed top-4 right-4 z-50 flex flex-col gap-2 pointer-events-none">
              {notifications.map((notif) => (
                <div
                  key={notif.id}
                  className={`flex items-start gap-3 rounded-lg border p-4 shadow-lg backdrop-blur-sm pointer-events-auto
                    ${notif.type === 'success' ? 'border-[#00ff88]/30 bg-[#00ff88]/10 text-[#00ff88]' : ''}
                    ${notif.type === 'error' ? 'border-red-500/30 bg-red-500/10 text-red-400' : ''}
                    ${notif.type === 'info' ? 'border-blue-500/30 bg-blue-500/10 text-blue-400' : ''}
                  `}
                >
                  <div>
                    <p className="font-semibold text-sm">{notif.title}</p>
                    <p className="text-xs opacity-80">{notif.message}</p>
                  </div>
                </div>
              ))}
            </div>

            <Routes>
              <Route path="/login" element={user ? <Navigate to="/" replace /> : <Login />} />
              <Route path="/forgot-password" element={<ForgotPassword />} />
              <Route path="/reset-password" element={<ResetPassword />} />
              <Route
                path="/"
                element={
                  <ProtectedRoute>
                    <AppLayout><Dashboard /></AppLayout>
                  </ProtectedRoute>
                }
              />
              <Route
                path="/analytics"
                element={
                  <ProtectedRoute>
                    <AppLayout><Analytics /></AppLayout>
                  </ProtectedRoute>
                }
              />
              <Route
                path="/campaigns"
                element={
                  <ProtectedRoute>
                    <AppLayout><Campaigns /></AppLayout>
                  </ProtectedRoute>
                }
              />
              <Route
                path="/creative"
                element={
                  <ProtectedRoute>
                    <AppLayout><Creative /></AppLayout>
                  </ProtectedRoute>
                }
              />
              <Route
                path="/trends"
                element={
                  <ProtectedRoute>
                    <AppLayout><TrendEngine /></AppLayout>
                  </ProtectedRoute>
                }
              />
              <Route
                path="/settings"
                element={
                  <ProtectedRoute>
                    <AppLayout><Settings /></AppLayout>
                  </ProtectedRoute>
                }
              />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </BrowserRouter>
        </SocketContext.Provider>
      </AuthContext.Provider>
    </ThemeContext.Provider>
  );
}
