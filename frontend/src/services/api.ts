import axios from 'axios';
import { useAuthStore } from '@store/auth.store';

const apiBase = import.meta.env.VITE_API_URL || '/api/v1';

const api = axios.create({
  baseURL: apiBase,
  headers: {
    'Content-Type': 'application/json',
  },
});

api.interceptors.request.use((config) => {
  const token = useAuthStore.getState().token;
  const gymId = useAuthStore.getState().user?.gymId;

  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  if (gymId) {
    config.headers['X-Gym-ID'] = gymId;
  }

  return config;
});

api.interceptors.response.use(
  (response) => response.data,
  async (error) => {
    const originalRequest = error.config;

    if (error.response?.status === 401 && !originalRequest._retry) {
      originalRequest._retry = true;
      const refreshToken = useAuthStore.getState().refreshToken;

      if (refreshToken) {
        try {
          const response = await axios.post(
            `${apiBase}/auth/refresh`,
            { refreshToken }
          );
          const data = response.data?.data || response.data;
          const accessToken = data.accessToken;
          useAuthStore.getState().setAuth(
            useAuthStore.getState().user!,
            accessToken,
            data.refreshToken || refreshToken
          );
          originalRequest.headers.Authorization = `Bearer ${accessToken}`;
          return api(originalRequest);
        } catch (refreshError) {
          useAuthStore.getState().logout();
          window.location.href = '/login';
          return Promise.reject(refreshError);
        }
      }
    }

    return Promise.reject(error);
  }
);

export default api;
