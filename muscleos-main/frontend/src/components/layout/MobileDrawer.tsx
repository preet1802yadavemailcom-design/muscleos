import { Link, useLocation } from 'react-router-dom';
import { Dumbbell, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAuthStore } from '@store/auth.store';
import { navigation } from './navigation';

interface MobileDrawerProps {
  open: boolean;
  onClose: () => void;
}

/** Companion to Sidebar for viewports below `lg` (1024px) — the sidebar is
 *  `hidden` there entirely, so without this there was NO way to navigate
 *  on a phone/tablet at all except by editing the URL bar. */
export function MobileDrawer({ open, onClose }: MobileDrawerProps) {
  const location = useLocation();
  const { user } = useAuthStore();

  const visibleNavigation = navigation.filter(
    (item) => !item.roles || (user?.role && item.roles.includes(user.role)),
  );

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 lg:hidden" role="dialog" aria-modal="true">
      {/* Backdrop */}
      <button
        type="button"
        aria-label="Close menu"
        className="fixed inset-0 bg-black/50"
        onClick={onClose}
      />
      {/* Panel */}
      <div className="fixed inset-y-0 left-0 w-72 max-w-[85vw] bg-card border-r flex flex-col">
        <div className="flex h-16 shrink-0 items-center justify-between px-4 border-b">
          <div className="flex items-center gap-2">
            <Dumbbell className="h-7 w-7 text-primary" />
            <span className="text-lg font-bold">MuscleOS</span>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close menu"
            className="p-2 -mr-2 rounded-md hover:bg-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
        <nav className="flex-1 overflow-y-auto px-4 py-4">
          <ul className="flex flex-col gap-y-1">
            {visibleNavigation.map((item) => (
              <li key={item.name}>
                <Link
                  to={item.href}
                  onClick={onClose}
                  className={cn(
                    'flex items-center gap-x-3 rounded-md p-3 text-base font-semibold leading-6 transition-colors min-h-[44px]',
                    location.pathname === item.href
                      ? 'bg-primary text-primary-foreground'
                      : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground',
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
