import type { LucideIcon } from 'lucide-react';
import {
  LayoutDashboard, Users, Calendar, QrCode,
  CreditCard, BarChart3, Settings, RefreshCcw, UserCog, Bell, Building2, LifeBuoy, Dumbbell, Wallet,
} from 'lucide-react';

export interface NavItem {
  name: string;
  href: string;
  icon: LucideIcon;
  roles?: string[];
}

export const navigation: NavItem[] = [
  { name: 'Dashboard', href: '/', icon: LayoutDashboard },
  { name: 'Reception', href: '/reception', icon: UserCog, roles: ['GYM_OWNER', 'RECEPTIONIST'] },
  { name: 'Platform', href: '/super-admin', icon: Building2, roles: ['SUPER_ADMIN'] },
  { name: 'Organizations', href: '/super-admin/organizations', icon: Building2, roles: ['SUPER_ADMIN'] },
  { name: 'Platform Plans', href: '/super-admin/plans', icon: CreditCard, roles: ['SUPER_ADMIN'] },
  { name: 'Audit Logs', href: '/super-admin/audit-logs', icon: Bell, roles: ['SUPER_ADMIN'] },
  { name: 'Support Tickets', href: '/super-admin/tickets', icon: UserCog, roles: ['SUPER_ADMIN'] },
  { name: 'Members', href: '/members', icon: Users, roles: ['SUPER_ADMIN', 'GYM_OWNER', 'TRAINER', 'RECEPTIONIST'] },
  { name: 'Batches', href: '/batches', icon: Calendar, roles: ['SUPER_ADMIN', 'GYM_OWNER', 'TRAINER'] },
  { name: 'Attendance', href: '/attendance', icon: QrCode, roles: ['SUPER_ADMIN', 'GYM_OWNER', 'TRAINER', 'RECEPTIONIST', 'MEMBER'] },
  { name: 'Memberships', href: '/memberships', icon: RefreshCcw, roles: ['SUPER_ADMIN', 'GYM_OWNER', 'RECEPTIONIST'] },
  { name: 'Payments', href: '/payments', icon: CreditCard, roles: ['SUPER_ADMIN', 'GYM_OWNER', 'RECEPTIONIST'] },
  { name: 'Pending UPI', href: '/payments/pending-upi', icon: Wallet, roles: ['GYM_OWNER', 'RECEPTIONIST'] },
  { name: 'Reports', href: '/reports', icon: BarChart3, roles: ['SUPER_ADMIN', 'GYM_OWNER'] },
  { name: 'Notifications', href: '/notifications', icon: Bell, roles: ['SUPER_ADMIN', 'GYM_OWNER'] },
  { name: 'Support', href: '/support', icon: LifeBuoy, roles: ['SUPER_ADMIN', 'GYM_OWNER', 'TRAINER', 'RECEPTIONIST', 'MEMBER'] },
  { name: 'Assign Fitness Plan', href: '/fitness/assign', icon: Dumbbell, roles: ['GYM_OWNER', 'TRAINER'] },
  { name: 'Settings', href: '/settings', icon: Settings, roles: ['SUPER_ADMIN', 'GYM_OWNER'] },
  { name: 'My Fitness', href: '/my/fitness', icon: Dumbbell, roles: ['MEMBER'] },
];

export const memberBottomNav: NavItem[] = [
  { name: 'Home', href: '/', icon: LayoutDashboard },
  { name: 'Scan', href: '/attendance', icon: QrCode },
  { name: 'Membership', href: '/my/membership', icon: RefreshCcw },
  { name: 'Profile', href: '/my/profile', icon: Settings },
];

/**
 * Robust active route detection supporting parent route matching
 * (e.g. /members/123 highlights Members) and nested subroutes.
 */
export function isRouteActive(pathname: string, href: string): boolean {
  if (href === '/') {
    return pathname === '/';
  }
  if (pathname === href) {
    return true;
  }
  // Sub-route priority: /payments/pending-upi should not activate /payments
  if (href === '/payments' && pathname.startsWith('/payments/pending-upi')) {
    return false;
  }
  return pathname.startsWith(href + '/');
}
