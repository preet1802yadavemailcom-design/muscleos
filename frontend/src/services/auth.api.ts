import api from './api';
import { unwrapData } from '@/lib/api-response';
import type { User } from '@/store/auth.store';

export interface TwoFactorSetupBeginResponse {
  qrDataUrl: string;
  secret: string;
}

export interface TwoFactorSetupConfirmResponse {
  recoveryCodes: string[];
}

export interface TwoFactorVerifyLoginResponse {
  user: User;
  accessToken: string;
  refreshToken: string;
}

export interface SessionInfo {
  id: string;
  deviceInfo?: string;
  ipAddress?: string;
  lastActiveAt?: string;
  createdAt: string;
  isCurrent?: boolean;
}

export const authApi = {
  async begin2FASetup(setupToken?: string): Promise<TwoFactorSetupBeginResponse> {
    const headers = setupToken ? { Authorization: `Bearer ${setupToken}` } : undefined;
    const res = await api.post(
      '/auth/2fa/setup/begin',
      {},
      { headers }
    );
    return unwrapData<TwoFactorSetupBeginResponse>(res);
  },

  async confirm2FASetup(code: string, setupToken?: string): Promise<TwoFactorSetupConfirmResponse> {
    const headers = setupToken ? { Authorization: `Bearer ${setupToken}` } : undefined;
    const res = await api.post(
      '/auth/2fa/setup/confirm',
      { code },
      { headers }
    );
    return unwrapData<TwoFactorSetupConfirmResponse>(res);
  },

  async verifyLogin2FA(pendingToken: string, code: string): Promise<TwoFactorVerifyLoginResponse> {
    const res = await api.post('/auth/2fa/verify-login', { pendingToken, code });
    return unwrapData<TwoFactorVerifyLoginResponse>(res);
  },

  async disable2FA(password: string): Promise<{ success: boolean; message: string }> {
    const res = await api.post('/auth/2fa/disable', { password });
    return unwrapData(res);
  },

  async regenerateRecoveryCodes(): Promise<{ recoveryCodes: string[] }> {
    const res = await api.post('/auth/2fa/recovery-codes/regenerate');
    return unwrapData(res);
  },

  async changePassword(currentPassword: string, newPassword: string): Promise<{ success: boolean; message: string }> {
    const res = await api.post('/auth/change-password', { currentPassword, newPassword });
    return unwrapData(res);
  },

  async getSessions(): Promise<SessionInfo[]> {
    const res = await api.get('/auth/sessions');
    const data = unwrapData<any>(res);
    return Array.isArray(data) ? data : data?.sessions ?? [];
  },

  async revokeSession(sessionId: string): Promise<{ success: boolean }> {
    const res = await api.delete(`/auth/sessions/${sessionId}`);
    return unwrapData(res);
  },

  async revokeOtherSessions(): Promise<{ success: boolean }> {
    const res = await api.post('/auth/sessions/revoke-others');
    return unwrapData(res);
  },

  async getMe(customToken?: string): Promise<{ user: User }> {
    const config = customToken ? { headers: { Authorization: `Bearer ${customToken}` } } : undefined;
    const res = await api.get('/auth/me', config);
    return unwrapData<{ user: User }>(res);
  },
};
