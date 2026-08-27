import axios from 'axios';

export const API_BASE = import.meta.env.VITE_API_BASE || '/api';
export const SOCKET_URL = import.meta.env.VITE_SOCKET_URL || '';

let accessToken = null;
let onTokenRefreshed = null;
let refreshing = null;

export function setAccessToken(token) {
  accessToken = token;
}

export function getAccessToken() {
  return accessToken;
}

export function setRefreshHandler(fn) {
  onTokenRefreshed = fn;
}

const http = axios.create({
  baseURL: API_BASE,
  withCredentials: true,
  timeout: 30000,
});

http.interceptors.request.use((config) => {
  if (accessToken) config.headers.Authorization = `Bearer ${accessToken}`;
  return config;
});

async function doRefresh() {
  const res = await http.post('/auth/refresh');
  accessToken = res.data.data.accessToken;
  return accessToken;
}

http.interceptors.response.use(
  (res) => res,
  async (error) => {
    const original = error.config;
    const code = error.response?.data?.code;

    if (code === 'token_expired' && original && !original._retried) {
      original._retried = true;
      try {
        if (!refreshing) {
          refreshing = doRefresh().finally(() => {
            refreshing = null;
          });
        }
        const token = await refreshing;
        if (onTokenRefreshed) onTokenRefreshed(token);
      } catch {
        setAccessToken(null);
        return Promise.reject(error);
      }
      return http(original);
    }

    return Promise.reject(error);
  }
);

export function apiError(err, fallback = 'Request failed') {
  const data = err.response?.data;
  return {
    status: err.response?.status || 0,
    code: data?.code || 'network_error',
    message: data?.message || (err.message === 'Network Error' ? 'Cannot reach server' : fallback),
    details: data?.details,
  };
}

export default http;
