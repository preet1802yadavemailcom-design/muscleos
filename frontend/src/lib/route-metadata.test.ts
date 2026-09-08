import { describe, it, expect } from 'vitest';
import { getRouteTitle, updateDocumentTitle } from './route-metadata';
import { isRouteActive } from '../components/layout/navigation';

describe('route-metadata', () => {
  describe('getRouteTitle', () => {
    it('returns Dashboard for root path', () => {
      expect(getRouteTitle('/')).toBe('Dashboard');
    });

    it('returns Members for /members and Member Details for /members/:id', () => {
      expect(getRouteTitle('/members')).toBe('Members');
      expect(getRouteTitle('/members/mem_12345')).toBe('Member Details');
    });

    it('returns Payments for /payments and Pending UPI for /payments/pending-upi', () => {
      expect(getRouteTitle('/payments')).toBe('Payments');
      expect(getRouteTitle('/payments/pending-upi')).toBe('Pending UPI');
    });

    it('returns Reception for /reception', () => {
      expect(getRouteTitle('/reception')).toBe('Reception');
    });

    it('returns Attendance for /attendance', () => {
      expect(getRouteTitle('/attendance')).toBe('Attendance');
    });

    it('returns Batches for /batches', () => {
      expect(getRouteTitle('/batches')).toBe('Batches');
    });

    it('returns Super Admin titles correctly', () => {
      expect(getRouteTitle('/super-admin')).toBe('Platform Dashboard');
      expect(getRouteTitle('/super-admin/organizations')).toBe('Organizations');
      expect(getRouteTitle('/super-admin/plans')).toBe('Platform Plans');
      expect(getRouteTitle('/super-admin/audit-logs')).toBe('Audit Logs');
      expect(getRouteTitle('/super-admin/tickets')).toBe('Support Tickets');
    });

    it('handles trailing slashes gracefully', () => {
      expect(getRouteTitle('/attendance/')).toBe('Attendance');
      expect(getRouteTitle('/members/')).toBe('Members');
    });

    it('defaults to Dashboard for unknown routes', () => {
      expect(getRouteTitle('/some/random/route')).toBe('Dashboard');
    });
  });

  describe('updateDocumentTitle', () => {
    it('sets document.title to MuscleOS | Title', () => {
      updateDocumentTitle('Attendance');
      expect(document.title).toBe('MuscleOS — Attendance');
    });
  });

  describe('isRouteActive', () => {
    it('accurately matches root path only when exact', () => {
      expect(isRouteActive('/', '/')).toBe(true);
      expect(isRouteActive('/members', '/')).toBe(false);
    });

    it('matches exact routes', () => {
      expect(isRouteActive('/members', '/members')).toBe(true);
      expect(isRouteActive('/attendance', '/attendance')).toBe(true);
      expect(isRouteActive('/reception', '/reception')).toBe(true);
    });

    it('matches parent routes for child detail pages', () => {
      expect(isRouteActive('/members/mem_987', '/members')).toBe(true);
    });

    it('handles subroute precedence for payments vs pending-upi', () => {
      expect(isRouteActive('/payments/pending-upi', '/payments/pending-upi')).toBe(true);
      expect(isRouteActive('/payments/pending-upi', '/payments')).toBe(false);
    });
  });
});
