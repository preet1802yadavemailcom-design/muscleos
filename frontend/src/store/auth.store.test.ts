import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useAuthStore } from './auth.store';
import api from '@services/api';

vi.mock('@services/api', () => ({
  default: {
    post: vi.fn(),
  },
}));

describe('auth.store', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    useAuthStore.setState({
      user: null,
      token: null,
      refreshToken: null,
      isAuthenticated: false,
    });
  });

  it('sets authentication state properly via setAuth', () => {
    const mockUser = {
      id: 'u-1',
      email: 'owner@gym.com',
      firstName: 'Gym',
      lastName: 'Owner',
      role: 'GYM_OWNER',
    };

    useAuthStore.getState().setAuth(mockUser, 'access-jwt', 'refresh-jwt');

    const state = useAuthStore.getState();
    expect(state.isAuthenticated).toBe(true);
    expect(state.user).toEqual(mockUser);
    expect(state.token).toBe('access-jwt');
    expect(state.refreshToken).toBe('refresh-jwt');
  });

  it('updates partial user state via updateUser', () => {
    const mockUser = {
      id: 'u-1',
      email: 'owner@gym.com',
      firstName: 'Gym',
      lastName: 'Owner',
      role: 'GYM_OWNER',
    };
    useAuthStore.getState().setAuth(mockUser, 'access-jwt', 'refresh-jwt');

    useAuthStore.getState().updateUser({ firstName: 'Super' });

    expect(useAuthStore.getState().user?.firstName).toBe('Super');
    expect(useAuthStore.getState().user?.lastName).toBe('Owner');
  });

  it('logs out and revokes tokens using cached push token from localStorage without prompting', async () => {
    localStorage.setItem('fcm_token', 'cached-push-token-123');

    useAuthStore.setState({
      user: { id: 'u-1', email: 'test@example.com', firstName: 'A', lastName: 'B', role: 'MEMBER' },
      token: 'jwt-1',
      refreshToken: 'refresh-1',
      isAuthenticated: true,
    });

    (api.post as any).mockResolvedValue({ data: { success: true } });

    await useAuthStore.getState().logout();

    expect(api.post).toHaveBeenCalledWith('/auth/logout', {
      refreshToken: 'refresh-1',
      pushToken: 'cached-push-token-123',
    });

    const state = useAuthStore.getState();
    expect(state.isAuthenticated).toBe(false);
    expect(state.user).toBeNull();
    expect(state.token).toBeNull();
    expect(state.refreshToken).toBeNull();
  });

  it('clears state on logout even if server revocation call fails', async () => {
    useAuthStore.setState({
      user: { id: 'u-1', email: 'test@example.com', firstName: 'A', lastName: 'B', role: 'MEMBER' },
      token: 'jwt-1',
      refreshToken: 'refresh-1',
      isAuthenticated: true,
    });

    (api.post as any).mockRejectedValue(new Error('Network error'));

    await useAuthStore.getState().logout();

    const state = useAuthStore.getState();
    expect(state.isAuthenticated).toBe(false);
    expect(state.user).toBeNull();
    expect(state.token).toBeNull();
    expect(state.refreshToken).toBeNull();
  });
});
