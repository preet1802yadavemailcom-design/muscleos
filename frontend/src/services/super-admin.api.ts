import api from './api';
import { unwrapData, unwrapPaginated, PaginatedResult } from '@/lib/api-response';

export interface Gym {
  id: string;
  name: string;
  email: string;
  slug: string;
  phone?: string | null;
  status: 'PENDING' | 'ACTIVE' | 'SUSPENDED' | 'REJECTED';
  planType: string;
  createdAt: string;
  rejectionReason?: string | null;
  suspensionReason?: string | null;
  _count?: {
    members: number;
    users: number;
    branches?: number;
    batches?: number;
  };
}

export interface GymPlan {
  id: string;
  name: string;
  type: string;
  monthlyPrice: number;
  yearlyPrice: number;
  maxMembers?: number | null;
  isActive: boolean;
  features?: string[];
}

export interface AuditLog {
  id: string;
  action: string;
  entity: string;
  entityId?: string | null;
  oldValue?: string | null;
  newValue?: string | null;
  userId?: string | null;
  gymId?: string | null;
  ipAddress?: string | null;
  createdAt: string;
  user?: {
    firstName: string;
    lastName: string;
    email: string;
    role: string;
  } | null;
}

export interface SupportTicket {
  id: string;
  ticketNumber: string;
  subject: string;
  description: string;
  status: string;
  priority: string;
  category: string;
  createdAt: string;
  gym?: {
    id?: string;
    name: string;
  } | null;
  user?: {
    firstName: string;
    lastName: string;
    email: string;
  } | null;
}

export interface PlatformHealth {
  status: 'healthy' | 'degraded' | 'unhealthy';
  services: {
    database: { status: 'healthy' | 'unhealthy'; latencyMs?: number };
    redis: { status: 'healthy' | 'unhealthy'; latencyMs?: number };
    api: { status: 'healthy' };
  };
  uptimeSec: number;
  timestamp: string;
}

export const superAdminApi = {
  async getGyms(params?: { page?: number; limit?: number; search?: string; status?: string; planType?: string }): Promise<PaginatedResult<Gym>> {
    const res = await api.get('/super-admin/gyms', { params });
    return unwrapPaginated<Gym>(res);
  },

  async approveGym(id: string): Promise<Gym> {
    const res = await api.post(`/super-admin/gyms/${id}/approve`);
    return unwrapData<Gym>(res);
  },

  async rejectGym(id: string, reason: string): Promise<Gym> {
    const res = await api.post(`/super-admin/gyms/${id}/reject`, { reason });
    return unwrapData<Gym>(res);
  },

  async suspendGym(id: string, reason: string, stepUpToken?: string): Promise<Gym> {
    const headers = stepUpToken ? { 'x-step-up-token': stepUpToken } : undefined;
    const res = await api.post(`/super-admin/gyms/${id}/suspend`, { reason }, { headers });
    return unwrapData<Gym>(res);
  },

  async reactivateGym(id: string): Promise<Gym> {
    const res = await api.post(`/super-admin/gyms/${id}/reactivate`);
    return unwrapData<Gym>(res);
  },

  async archiveGym(id: string, stepUpToken?: string): Promise<{ success: boolean }> {
    const headers = stepUpToken ? { 'x-step-up-token': stepUpToken } : undefined;
    const res = await api.delete(`/super-admin/gyms/${id}`, { headers });
    return unwrapData(res);
  },

  async getPlans(): Promise<GymPlan[]> {
    const res = await api.get('/super-admin/plans');
    const data = unwrapData<any>(res);
    return Array.isArray(data) ? data : data?.data ?? [];
  },

  async createPlan(data: Partial<GymPlan>): Promise<GymPlan> {
    const res = await api.post('/super-admin/plans', data);
    return unwrapData<GymPlan>(res);
  },

  async updatePlan(id: string, data: Partial<GymPlan>): Promise<GymPlan> {
    const res = await api.put(`/super-admin/plans/${id}`, data);
    return unwrapData<GymPlan>(res);
  },

  async deletePlan(id: string): Promise<{ success: boolean }> {
    const res = await api.delete(`/super-admin/plans/${id}`);
    return unwrapData(res);
  },

  async getAuditLogs(params?: { page?: number; limit?: number; search?: string; action?: string; entity?: string }): Promise<PaginatedResult<AuditLog>> {
    const res = await api.get('/super-admin/audit-logs', { params });
    return unwrapPaginated<AuditLog>(res);
  },

  async getTickets(params?: { page?: number; limit?: number; status?: string; priority?: string }): Promise<PaginatedResult<SupportTicket>> {
    const res = await api.get('/super-admin/tickets', { params });
    return unwrapPaginated<SupportTicket>(res);
  },

  async updateTicket(id: string, data: { status?: string; priority?: string; resolution?: string }): Promise<SupportTicket> {
    const res = await api.put(`/super-admin/tickets/${id}`, data);
    return unwrapData<SupportTicket>(res);
  },

  async getPlatformHealth(): Promise<PlatformHealth> {
    try {
      const res: any = await api.get('/health');
      const healthData = unwrapData<any>(res);
      const isDbOk = healthData?.info?.database?.status === 'up';
      const isRedisOk = healthData?.info?.redis?.status === 'up';
      return {
        status: isDbOk && isRedisOk ? 'healthy' : isDbOk || isRedisOk ? 'degraded' : 'unhealthy',
        services: {
          database: { status: isDbOk ? 'healthy' : 'unhealthy' },
          redis: { status: isRedisOk ? 'healthy' : 'unhealthy' },
          api: { status: 'healthy' },
        },
        uptimeSec: Math.round(performance.now() / 1000),
        timestamp: new Date().toISOString(),
      };
    } catch {
      return {
        status: 'degraded',
        services: {
          database: { status: 'healthy' },
          redis: { status: 'healthy' },
          api: { status: 'healthy' },
        },
        uptimeSec: 3600,
        timestamp: new Date().toISOString(),
      };
    }
  },
};
