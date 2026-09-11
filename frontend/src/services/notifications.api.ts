import api from './api';
import { unwrapData, unwrapPaginated, PaginatedResult } from '@/lib/api-response';

export interface UserNotification {
  id: string;
  title: string;
  content: string;
  type: string;
  channel: string;
  createdAt: string;
  readAt?: string | null;
  status: string;
}

export interface NotificationTemplate {
  id: string;
  name: string;
  subject?: string | null;
  body: string;
  type: string;
  channel: string;
  variables: string[];
  isActive: boolean;
}

export const notificationsApi = {
  async getMyNotifications(page: number = 1, limit: number = 20): Promise<PaginatedResult<UserNotification>> {
    const res = await api.get('/notifications/my', { params: { page, limit } });
    return unwrapPaginated<UserNotification>(res);
  },

  async getUnreadCount(): Promise<number> {
    const res = await api.get('/notifications/my/unread-count');
    const data = unwrapData<{ count: number }>(res);
    return data?.count ?? 0;
  },

  async markAsRead(id: string): Promise<void> {
    await api.patch(`/notifications/my/${id}/read`);
  },

  async markAllAsRead(): Promise<void> {
    await api.post('/notifications/my/read-all');
  },

  async getStaffNotifications(params?: { page?: number; limit?: number; status?: string; type?: string }): Promise<PaginatedResult<any>> {
    const res = await api.get('/notifications', { params });
    return unwrapPaginated(res);
  },

  async getTemplates(): Promise<NotificationTemplate[]> {
    const res = await api.get('/notifications/templates/list');
    const data = unwrapData<any>(res);
    return Array.isArray(data) ? data : data?.data ?? [];
  },

  async sendNotification(dto: any): Promise<any> {
    const res = await api.post('/notifications/send', dto);
    return unwrapData(res);
  },

  async sendTestEmail(email: string): Promise<{ success: boolean; message: string }> {
    const res = await api.post('/notifications/test-email', { email });
    return unwrapData(res);
  },

  async createAnnouncement(dto: { title: string; content: string; channel?: string }): Promise<any> {
    const res = await api.post('/notifications/announcements', dto);
    return unwrapData(res);
  },
};
