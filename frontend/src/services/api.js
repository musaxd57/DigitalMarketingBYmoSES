import axios from 'axios';

const BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001';

const api = axios.create({
  baseURL: `${BASE_URL}/api`,
  timeout: 30000,
  headers: {
    'Content-Type': 'application/json',
  },
});

// ─── Request Interceptor: attach auth token ───────────────────────────────────
api.interceptors.request.use(
  (config) => {
    const token = localStorage.getItem('accessToken');
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  },
  (error) => Promise.reject(error)
);

// ─── Response Interceptor: handle token refresh ───────────────────────────────
let isRefreshing = false;
let failedQueue = [];

const processQueue = (error, token = null) => {
  failedQueue.forEach((prom) => {
    if (error) prom.reject(error);
    else prom.resolve(token);
  });
  failedQueue = [];
};

api.interceptors.response.use(
  (response) => response,
  async (error) => {
    const originalRequest = error.config;

    if (error.response?.status === 401 && !originalRequest._retry) {
      if (error.response?.data?.code === 'TOKEN_EXPIRED') {
        if (isRefreshing) {
          return new Promise((resolve, reject) => {
            failedQueue.push({ resolve, reject });
          }).then((token) => {
            originalRequest.headers.Authorization = `Bearer ${token}`;
            return api(originalRequest);
          }).catch((err) => Promise.reject(err));
        }

        originalRequest._retry = true;
        isRefreshing = true;

        const refreshToken = localStorage.getItem('refreshToken');
        if (!refreshToken) {
          isRefreshing = false;
          window.location.href = '/login';
          return Promise.reject(error);
        }

        try {
          const res = await axios.post(`${BASE_URL}/api/auth/refresh`, { refreshToken });
          const { accessToken, refreshToken: newRefreshToken } = res.data;

          localStorage.setItem('accessToken', accessToken);
          localStorage.setItem('refreshToken', newRefreshToken);

          api.defaults.headers.common.Authorization = `Bearer ${accessToken}`;
          processQueue(null, accessToken);

          originalRequest.headers.Authorization = `Bearer ${accessToken}`;
          return api(originalRequest);
        } catch (refreshError) {
          processQueue(refreshError, null);
          localStorage.removeItem('accessToken');
          localStorage.removeItem('refreshToken');
          window.location.href = '/login';
          return Promise.reject(refreshError);
        } finally {
          isRefreshing = false;
        }
      }

      // Non-token-expired 401
      localStorage.removeItem('accessToken');
      localStorage.removeItem('refreshToken');
      window.location.href = '/login';
    }

    return Promise.reject(error);
  }
);

// ─── Auth API ─────────────────────────────────────────────────────────────────
export const authAPI = {
  register: (data) => api.post('/auth/register', data),
  login: (email, password) => api.post('/auth/login', { email, password }),
  logout: (refreshToken) => api.post('/auth/logout', { refreshToken }),
  getMe: () => api.get('/auth/me'),
  refresh: (refreshToken) => api.post('/auth/refresh', { refreshToken }),
  forgotPassword: (email) => api.post('/auth/forgot-password', { email }),
  resetPassword: (token, password) => api.post('/auth/reset-password', { token, password }),
};

// ─── Accounts API ─────────────────────────────────────────────────────────────
export const accountsAPI = {
  list: () => api.get('/accounts'),
  disconnect: (id) => api.delete(`/accounts/${id}`),
  getMetaAuthUrl: () => api.get('/accounts/meta/connect'),
  getGoogleAuthUrl: () => api.get('/accounts/google/connect'),
  getTikTokAuthUrl: () => api.get('/accounts/tiktok/connect'),
};

// ─── Campaigns API ────────────────────────────────────────────────────────────
export const campaignsAPI = {
  list: (params) => api.get('/campaigns', { params }),
  get: (id) => api.get(`/campaigns/${id}`),
  create: (data) => api.post('/campaigns', data),
  update: (id, data) => api.put(`/campaigns/${id}`, data),
  sync: (data) => api.post('/campaigns/sync', data),
};

// ─── Analytics API ────────────────────────────────────────────────────────────
export const analyticsAPI = {
  overview: (params) => api.get('/analytics/overview', { params }),
  timeseries: (params) => api.get('/analytics/timeseries', { params }),
  byPlatform: (params) => api.get('/analytics/by-platform', { params }),
  topCampaigns: (params) => api.get('/analytics/top-campaigns', { params }),
  ltv: (params) => api.get('/analytics/ltv', { params }),
};

// ─── Creative API ─────────────────────────────────────────────────────────────
export const creativeAPI = {
  list: (params) => api.get('/creative', { params }),
  get: (id) => api.get(`/creative/${id}`),
  create: (data) => api.post('/creative', data),
  score: (id) => api.post(`/creative/${id}/score`),
  scoreBatch: (ids) => api.post('/creative/score-batch', { creativeIds: ids }),
};

// ─── AI API ───────────────────────────────────────────────────────────────────
const AI_TIMEOUT = 120000;
export const aiAPI = {
  generateAdCopy: (data) => api.post('/ai/ad-copy', data),
  getAdCopyStatus: (id) => api.get(`/ai/ad-copy/status/${id}`),
  generateVideo: (data) => api.post('/ai/video', data, { timeout: AI_TIMEOUT }),
  getVideoStatus: (jobId) => api.get(`/ai/video/status/${jobId}`),
  generateVoiceover: (data) => api.post('/ai/voiceover', data),
  getVoiceoverStatus: (id) => api.get(`/ai/voiceover/status/${id}`),
  analyze: (data) => api.post('/ai/analyze', data, { timeout: AI_TIMEOUT }),
  getGenerations: (params) => api.get('/ai/generations', { params }),
};

// ─── Demo API ─────────────────────────────────────────────────────────────────
export const demoAPI = {
  seed: () => api.post('/demo/seed', {}, { timeout: 15000 }),
  status: () => api.get('/demo/status'),
  clear: () => api.delete('/demo/clear'),
};

// ─── Trends API ───────────────────────────────────────────────────────────────
export const trendsAPI = {
  list: () => api.get('/trends'),
  latest: (params) => api.get('/trends/latest', { params }),
  generate: (data) => api.post('/trends/generate', data),
};

export default api;
