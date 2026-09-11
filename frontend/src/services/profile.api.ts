import api from './api';
import { unwrapData } from '@/lib/api-response';

export interface MyProfile {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  phone?: string | null;
  avatar?: string | null;
  role: string;
  emailVerified: boolean;
  twoFactorEnabled?: boolean;
  createdAt: string;
  gym?: { id: string; name: string } | null;
  branch?: { id: string; name: string } | null;
  memberProfile?: {
    id?: string;
    memberCode: string;
    photo?: string | null;
    emergencyContactName?: string | null;
    emergencyContactPhone?: string | null;
    createdAt: string;
    status: string;
    currentStreak?: number;
    longestStreak?: number;
    branch?: { name: string; city?: string | null } | null;
    currentMembership?: { status: string; endDate: string; planName?: string | null } | null;
  } | null;
}

export interface UpdateProfileInput {
  firstName?: string;
  lastName?: string;
  phone?: string;
  emergencyContactName?: string;
  emergencyContactPhone?: string;
  photo?: string;
}

export const profileApi = {
  async getProfile(): Promise<MyProfile> {
    const res = await api.get('/profile');
    return unwrapData<MyProfile>(res);
  },

  async updateProfile(input: UpdateProfileInput): Promise<MyProfile> {
    const res = await api.patch('/profile', input);
    return unwrapData<MyProfile>(res);
  },

  async sendLinkMemberOtp(mobile: string): Promise<{ success: boolean; message: string }> {
    const res = await api.post('/profile/link-member/send-otp', { mobile });
    return unwrapData(res);
  },

  async linkMember(memberCode: string, mobile: string, otp?: string): Promise<MyProfile> {
    const res = await api.post('/profile/link-member', {
      memberCode: memberCode.trim(),
      mobile: mobile.trim(),
      otp: otp?.trim() || undefined,
    });
    return unwrapData<MyProfile>(res);
  },

  async registerPushToken(token: string, platform: string = 'web'): Promise<void> {
    await api.post('/profile/push-token', { token, platform });
  },

  async unregisterPushToken(token: string): Promise<void> {
    await api.delete('/profile/push-token', { data: { token } });
  },
};
