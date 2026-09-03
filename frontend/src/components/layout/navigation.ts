import type { LucideIcon } from 'lucide-react';
import {
  LayoutDashboard, Users, Calendar, QrCode,
  CreditCard, BarChart3, Settings, RefreshCcw, UserCog, Bell, Building2, LifeBuoy, Dumbbell,
} from 'lucide-react';

export interface NavItem {
  name: string;
  href: string;
  icon: LucideIcon;
  roles?: string[];
}

export const navigation: NavItem[] = [
  { name: 'Dashboard', href: '/', icon: LayoutDashboard },
  { name: 'Platform', href: '/super-admin', icon: Building2, roles: ['SUPER_ADMIN'] },
  { name: 'Organizations', href: '/super-admin/organizations', icon: Building2, roles: ['SUPER_ADMIN'] },
  { name: 'Platform Plans', href: '/super-admin/plans', icon: CreditCard, roles: ['SUPER_ADMIN'] },
  { name: 'Audit Logs', href: '/super-admin/audit-logs', icon: Bell, roles: ['SUPER_ADMIN'] },
  { name: 'Support Tickets', href: '/super-admin/tickets', icon: UserCog, roles: ['SUPER_ADMIN'] },
  { name: 'Members', href: '/members', icon: Users, roles: ['SUPER_ADMIN', 'GYM_OWNER', 'TRAINER', 'RECEPTION'] },
  { name: 'Batches', href: '/batches', icon: Calendar, roles: ['SUPER_ADMIN', 'GYM_OWNER', 'TRAINER'] },
  { name: 'Attendance', href: '/attendance', icon: QrCode, roles: ['SUPER_ADMIN', 'GYM_OWNER', 'TRAINER', 'RECEPTIONIST', 'MEMBER'] },
  { name: 'Memberships', href: '/memberships', icon: RefreshCcw, roles: ['SUPER_ADMIN', 'GYM_OWNER', 'RECEPTIONIST'] },
  { name: 'Payments', href: '/payments', icon: CreditCard, roles: ['SUPER_ADMIN', 'GYM_OWNER', 'RECEPTIONIST'] },
  { name: 'Reception', href: '/reception', icon: UserCog, roles: ['GYM_OWNER', 'RECEPTIONIST'] },
  { name: 'Reports', href: '/reports', icon: BarChart3, roles: ['SUPER_ADMIN', 'GYM_OWNER'] },
  { name: 'Notifications', href: '/notifications', icon: Bell, roles: ['SUPER_ADMIN', 'GYM_OWNER'] },
  { name: 'Settings', href: '/settings', icon: Settings, roles: ['SUPER_ADMIN', 'GYM_OWNER'] },
  { name: 'Support', href: '/support', icon: LifeBuoy, roles: ['SUPER_ADMIN', 'GYM_OWNER', 'TRAINER', 'RECEPTIONIST', 'MEMBER'] },
  { name: 'Assign Fitness Plan', href: '/fitness/assign', icon: Dumbbell, roles: ['GYM_OWNER', 'TRAINER'] },
  { name: 'My Fitness', href: '/my/fitness', icon: Dumbbell, roles: ['MEMBER'] },
];

/** Member-facing PWA gets a focused bottom nav instead of the full admin
 *  sidebar — 4 items max keeps touch targets comfortable at 375px. */
/** Member-facing PWA gets a focused bottom nav instead of the full admin
 *  sidebar — 4 items keeps touch targets comfortable at 375px. All four
 *  routes now exist and are MEMBER-accessible (see App.tsx): profile is
 *  open to any role, membership/payments are MEMBER-only via RoleRoute. */
export const memberBottomNav: NavItem[] = [
  { name: 'Home', href: '/', icon: LayoutDashboard },
  { name: 'Scan', href: '/attendance', icon: QrCode },
  { name: 'Membership', href: '/my/membership', icon: RefreshCcw },
  { name: 'Profile', href: '/my/profile', icon: Settings },
];
