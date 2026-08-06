import { Link, useLocation } from 'react-router-dom';
import {
  LayoutDashboard, Users, Calendar, QrCode,
  CreditCard, BarChart3, Settings, Dumbbell, RefreshCcw, UserCog, Bell, Building2,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAuthStore } from '@store/auth.store';

interface NavItem {
  name: string;
  href: string;
  icon: any;
  roles?: string[];
}

const navigation: NavItem[] = [
  { name: 'Dashboard', href: '/', icon: LayoutDashboard },
  {
    name: 'Platform',
    href: '/super-admin',
    icon: Building2,
    roles: ['SUPER_ADMIN'],
  },
  {
    name: 'Members',
    href: '/members',
    icon: Users,
    roles: ['SUPER_ADMIN', 'GYM_OWNER', 'TRAINER', 'RECEPTION'],
  },
  {
    name: 'Batches',
    href: '/batches',
    icon: Calendar,
    roles: ['SUPER_ADMIN', 'GYM_OWNER', 'TRAINER'],
  },
  { name: 'Attendance', href: '/attendance', icon: QrCode },
  {
    name: 'Memberships',
    href: '/memberships',
    icon: RefreshCcw,
    roles: ['SUPER_ADMIN', 'GYM_OWNER', 'RECEPTION'],
  },
  {
    name: 'Payments',
    href: '/payments',
    icon: CreditCard,
    roles: ['SUPER_ADMIN', 'GYM_OWNER', 'RECEPTION'],
  },
  {
    name: 'Reception',
    href: '/reception',
    icon: UserCog,
    roles: ['GYM_OWNER', 'RECEPTION'],
  },
  {
    name: 'Reports',
    href: '/reports',
    icon: BarChart3,
    roles: ['SUPER_ADMIN', 'GYM_OWNER'],
  },
  {
    name: 'Notifications',
    href: '/notifications',
    icon: Bell,
    roles: ['SUPER_ADMIN', 'GYM_OWNER'],
  },
  {
    name: 'Settings',
    href: '/settings',
    icon: Settings,
    roles: ['SUPER_ADMIN', 'GYM_OWNER'],
  },
];

export function Sidebar() {
  const location = useLocation();
  const { user } = useAuthStore();

  const visibleNavigation = navigation.filter(
    (item) => !item.roles || (user?.role && item.roles.includes(user.role))
  );

  return (
    <div className="hidden lg:fixed lg:inset-y-0 lg:z-50 lg:flex lg:w-64 lg:flex-col">
      <div className="flex grow flex-col gap-y-5 overflow-y-auto border-r bg-card px-6 pb-4">
        <div className="flex h-16 shrink-0 items-center gap-2">
          <Dumbbell className="h-8 w-8 text-primary" />
          <span className="text-xl font-bold">MuscleOS</span>
        </div>
        <nav className="flex flex-1 flex-col">
          <ul role="list" className="flex flex-1 flex-col gap-y-1">
            {visibleNavigation.map((item) => (
              <li key={item.name}>
                <Link
                  to={item.href}
                  className={cn(
                    'group flex gap-x-3 rounded-md p-3 text-sm font-semibold leading-6 transition-colors',
                    location.pathname === item.href
                      ? 'bg-primary text-primary-foreground'
                      : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground'
                  )}
                >
                  <item.icon className="h-5 w-5 shrink-0" aria-hidden="true" />
                  {item.name}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      </div>
    </div>
  );
}
