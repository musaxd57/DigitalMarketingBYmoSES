import { useState, useEffect } from 'react';
import { accountsAPI, demoAPI } from '../services/api';
import { useAuth } from '../App';

const PLATFORM_META = {
  meta: { name: 'Meta Ads', color: '#1877f2', icon: '📘', description: 'Facebook & Instagram advertising' },
  google: { name: 'Google Ads', color: '#4285f4', icon: '🔍', description: 'Search, Display & YouTube ads' },
  tiktok: { name: 'TikTok Ads', color: '#ff0050', icon: '🎵', description: 'TikTok for Business advertising' },
};

function AccountCard({ account, onDisconnect }) {
  const [disconnecting, setDisconnecting] = useState(false);
  const meta = PLATFORM_META[account.platform] || {};

  const handleDisconnect = async () => {
    if (!confirm(`Disconnect ${account.account_name}?`)) return;
    setDisconnecting(true);
    try {
      await onDisconnect(account.id);
    } finally {
      setDisconnecting(false);
    }
  };

  const isExpired = account.token_expires_at && new Date(account.token_expires_at) < new Date();

  return (
    <div className="flex items-center gap-4 py-4 px-5 border-b border-white/5 last:border-0">
      <div
        className="w-10 h-10 rounded-xl flex items-center justify-center text-xl flex-shrink-0"
        style={{ backgroundColor: `${meta.color}20` }}
      >
        {meta.icon}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <p className="text-white text-sm font-medium truncate">{account.account_name}</p>
          {isExpired && (
            <span className="text-yellow-400 text-xs bg-yellow-400/10 px-1.5 py-0.5 rounded border border-yellow-400/20">
              Token expired
            </span>
          )}
        </div>
        <p className="text-[#555] text-xs font-mono mt-0.5">
          ID: {account.account_id} · {account.currency || 'USD'}
          {account.last_sync_at && ` · Synced ${new Date(account.last_sync_at).toLocaleDateString()}`}
        </p>
        {account.sync_error && (
          <p className="text-red-400 text-xs mt-1">{account.sync_error}</p>
        )}
      </div>
      <div className="flex items-center gap-2 flex-shrink-0">
        <span className={`w-2 h-2 rounded-full ${account.is_active ? 'bg-[#00ff88]' : 'bg-[#333]'}`} />
        <button
          onClick={handleDisconnect}
          disabled={disconnecting}
          className="text-red-400 text-xs hover:text-red-300 disabled:opacity-50 transition-colors"
        >
          {disconnecting ? 'Removing...' : 'Disconnect'}
        </button>
      </div>
    </div>
  );
}

function ConnectButton({ platform, onConnect, connecting }) {
  const meta = PLATFORM_META[platform] || {};
  return (
    <button
      onClick={() => onConnect(platform)}
      disabled={connecting === platform}
      className="flex items-center gap-3 px-4 py-3 rounded-xl border border-white/5 hover:border-white/10 bg-[#0d0d14] hover:bg-white/3 transition-all w-full disabled:opacity-50"
    >
      <span className="text-2xl">{meta.icon}</span>
      <div className="text-left">
        <p className="text-white text-sm font-medium">{meta.name}</p>
        <p className="text-[#555] text-xs">{meta.description}</p>
      </div>
      <div className="ml-auto">
        {connecting === platform ? (
          <div className="w-4 h-4 border-2 border-white/30 border-t-white/70 rounded-full animate-spin" />
        ) : (
          <svg className="w-4 h-4 text-[#444]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
          </svg>
        )}
      </div>
    </button>
  );
}

export default function Settings() {
  const { user, tenant } = useAuth();
  const [accounts, setAccounts] = useState([]);
  const [loadingAccounts, setLoadingAccounts] = useState(true);
  const [connecting, setConnecting] = useState(null);
  const [activeTab, setActiveTab] = useState('integrations');

  // Read URL params for OAuth callback messages
  const urlParams = new URLSearchParams(window.location.search);
  const successMsg = urlParams.get('success');
  const errorMsg = urlParams.get('error');
  const connectedAccounts = urlParams.get('accounts');

  useEffect(() => {
    fetchAccounts();
    // Clean URL after reading params
    if (successMsg || errorMsg) {
      window.history.replaceState({}, '', window.location.pathname);
    }
  }, []);

  const fetchAccounts = async () => {
    setLoadingAccounts(true);
    try {
      const res = await accountsAPI.list();
      setAccounts(res.data.accounts || []);
    } finally {
      setLoadingAccounts(false);
    }
  };

  const handleConnect = async (platform) => {
    setConnecting(platform);
    try {
      let res;
      if (platform === 'meta') res = await accountsAPI.getMetaAuthUrl();
      else if (platform === 'google') res = await accountsAPI.getGoogleAuthUrl();
      else if (platform === 'tiktok') res = await accountsAPI.getTikTokAuthUrl();

      if (res?.data?.authUrl) {
        window.location.href = res.data.authUrl;
      }
    } catch (err) {
      alert(`Failed to initiate ${platform} connection: ${err.response?.data?.error || err.message}`);
      setConnecting(null);
    }
  };

  const handleDisconnect = async (accountId) => {
    await accountsAPI.disconnect(accountId);
    setAccounts((prev) => prev.filter((a) => a.id !== accountId));
  };

  const handleClearDemo = async () => {
    if (!confirm('Demo verileri (hesaplar, kampanyalar, analytics) silinecek. Devam?')) return;
    await demoAPI.clear();
    await fetchAccounts();
  };

  const accountsByPlatform = ['meta', 'google', 'tiktok'].reduce((acc, p) => {
    acc[p] = accounts.filter((a) => a.platform === p);
    return acc;
  }, {});

  const TABS = [
    { key: 'integrations', label: 'Ad Integrations' },
    { key: 'profile', label: 'Profile' },
    { key: 'billing', label: 'Plan & Billing' },
  ];

  return (
    <div className="p-6 space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-white text-xl font-semibold">Settings</h1>
          <p className="text-[#555] text-sm">Manage your integrations and account settings</p>
        </div>
        <button onClick={handleClearDemo} className="px-3 py-1.5 text-xs text-red-400 border border-red-400/20 rounded-lg hover:bg-red-400/10 transition-all">
          Demo Verileri Temizle
        </button>
      </div>

      {/* OAuth callback messages */}
      {successMsg && (
        <div className="bg-[#00ff88]/10 border border-[#00ff88]/30 rounded-xl p-4 flex items-center gap-3">
          <span className="text-[#00ff88] text-xl">✓</span>
          <div>
            <p className="text-[#00ff88] font-semibold text-sm">
              {successMsg === 'meta_connected' && 'Meta Ads connected successfully!'}
              {successMsg === 'google_connected' && 'Google Ads connected successfully!'}
              {successMsg === 'tiktok_connected' && 'TikTok Ads connected successfully!'}
            </p>
            {connectedAccounts && (
              <p className="text-[#00ff88]/70 text-xs">{connectedAccounts} ad account(s) linked</p>
            )}
          </div>
        </div>
      )}

      {errorMsg && (
        <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-4">
          <p className="text-red-400 font-semibold text-sm">Connection failed</p>
          <p className="text-red-400/70 text-xs mt-1">{errorMsg.replace(/_/g, ' ')}</p>
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-1 bg-[#0d0d14] rounded-xl p-1 border border-white/5 w-fit">
        {TABS.map((tab) => (
          <button key={tab.key} onClick={() => setActiveTab(tab.key)}
            className={`py-1.5 px-4 rounded-lg text-sm font-medium transition-all
              ${activeTab === tab.key ? 'bg-white/10 text-white' : 'text-[#555] hover:text-[#888]'}`}>
            {tab.label}
          </button>
        ))}
      </div>

      {/* INTEGRATIONS TAB */}
      {activeTab === 'integrations' && (
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">
          {['meta', 'google', 'tiktok'].map((platform) => {
            const meta = PLATFORM_META[platform];
            const platformAccounts = accountsByPlatform[platform] || [];

            return (
              <div key={platform} className="bg-[#111118] rounded-xl border border-white/5 overflow-hidden">
                <div className="px-5 py-4 border-b border-white/5 flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <span className="text-xl">{meta.icon}</span>
                    <div>
                      <h3 className="text-white font-semibold text-sm">{meta.name}</h3>
                      <p className="text-[#555] text-xs">{meta.description}</p>
                    </div>
                  </div>
                  <span className={`text-xs font-mono px-2 py-0.5 rounded border
                    ${platformAccounts.length > 0
                      ? 'bg-[#00ff88]/10 text-[#00ff88] border-[#00ff88]/20'
                      : 'bg-white/3 text-[#444] border-white/5'
                    }`}>
                    {platformAccounts.length} connected
                  </span>
                </div>

                {loadingAccounts ? (
                  <div className="p-5 space-y-3">
                    <div className="h-12 bg-white/3 animate-pulse rounded" />
                  </div>
                ) : (
                  <>
                    {platformAccounts.map((account) => (
                      <AccountCard key={account.id} account={account} onDisconnect={handleDisconnect} />
                    ))}

                    <div className="p-4">
                      <ConnectButton
                        platform={platform}
                        onConnect={handleConnect}
                        connecting={connecting}
                      />
                    </div>
                  </>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* PROFILE TAB */}
      {activeTab === 'profile' && (
        <div className="max-w-lg space-y-5">
          <div className="bg-[#111118] rounded-xl border border-white/5 p-5 space-y-4">
            <h3 className="text-white font-semibold text-sm">Account Information</h3>
            <div className="grid grid-cols-2 gap-4">
              {[
                { label: 'First Name', value: user?.firstName },
                { label: 'Last Name', value: user?.lastName },
                { label: 'Email', value: user?.email },
                { label: 'Role', value: user?.role },
              ].map((field) => (
                <div key={field.label}>
                  <label className="block text-[#555] text-xs font-mono mb-1">{field.label.toUpperCase()}</label>
                  <p className="text-white text-sm">{field.value || '—'}</p>
                </div>
              ))}
            </div>
          </div>

          <div className="bg-[#111118] rounded-xl border border-white/5 p-5 space-y-4">
            <h3 className="text-white font-semibold text-sm">Organization</h3>
            <div className="grid grid-cols-2 gap-4">
              {[
                { label: 'Company', value: tenant?.name },
                { label: 'Plan', value: tenant?.plan },
                { label: 'Tenant Slug', value: tenant?.slug },
              ].map((field) => (
                <div key={field.label}>
                  <label className="block text-[#555] text-xs font-mono mb-1">{field.label.toUpperCase()}</label>
                  <p className="text-white text-sm capitalize">{field.value || '—'}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* BILLING TAB */}
      {activeTab === 'billing' && (
        <div className="max-w-lg">
          <div className="bg-[#111118] rounded-xl border border-white/5 p-5 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-white font-semibold text-sm">Current Plan</h3>
              <span className="text-[#00ff88] text-sm font-bold capitalize">{tenant?.plan || 'Starter'}</span>
            </div>
            <div className="space-y-2">
              {[
                { feature: 'Ad accounts', starter: '3', growth: '10', scale: 'Unlimited' },
                { feature: 'AI generations/month', starter: '100', growth: '500', scale: 'Unlimited' },
                { feature: 'Video pipeline', starter: '5/mo', growth: '25/mo', scale: 'Unlimited' },
                { feature: 'Trend reports', starter: 'Daily', growth: 'Hourly', scale: 'Real-time' },
              ].map((row) => (
                <div key={row.feature} className="flex items-center justify-between py-2 border-b border-white/3 last:border-0">
                  <span className="text-[#666] text-sm">{row.feature}</span>
                  <span className="text-white text-sm">{row[tenant?.plan || 'starter']}</span>
                </div>
              ))}
            </div>
            <button className="w-full py-2.5 rounded-lg bg-[#00ff88]/10 border border-[#00ff88]/30 text-[#00ff88] text-sm font-medium hover:bg-[#00ff88]/20 transition-all">
              Upgrade Plan
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
