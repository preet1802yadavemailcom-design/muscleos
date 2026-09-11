import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import api from '@services/api';

export interface User {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  role: string;
  gymId?: string;
}

interface AuthState {
  user: User | null;
  token: string | null;
  refreshToken: string | null;
  isAuthenticated: boolean;
  setAuth: (user: User, token: string, refreshToken: string) => void;
  logout: () => Promise<void>;
  updateUser: (user: Partial<User>) => void;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      user: null,
      token: null,
      refreshToken: null,
      isAuthenticated: false,
      setAuth: (user, token, refreshToken) =>
        set({ user, token, refreshToken, isAuthenticated: true }),
      logout: async () => {
        // Best-effort: revoke the refresh token server-side and stop this
        // device's push notifications. Local state is cleared regardless of whether this
        // network call succeeds, so a slow/offline backend never traps the
        // user on a page that thinks they're still logged in.
        const { refreshToken } = get();
        try {
          const pushToken = typeof window !== 'undefined' ? localStorage.getItem('fcm_token') || undefined : undefined;
          await api.post('/auth/logout', { refreshToken, pushToken });
        } catch {
          // ignore — logging out locally still proceeds
        }
        set({ user: null, token: null, refreshToken: null, isAuthenticated: false });
      },
      updateUser: (userData) =>
        set((state) => ({
          user: state.user ? { ...state.user, ...userData } : null,
        })),
    }),
    {
      name: 'muscleos-auth',
    }
  )
);
