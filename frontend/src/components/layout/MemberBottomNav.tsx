import { Link, useLocation } from 'react-router-dom';
import { cn } from '@/lib/utils';
import { memberBottomNav } from './navigation';

/** Only rendered for role === MEMBER (see Layout.tsx) — staff/owner/admin
 *  keep the sidebar+drawer pattern since they need the full nav surface. */
export function MemberBottomNav() {
  const location = useLocation();

  return (
    <nav
      className="fixed bottom-0 inset-x-0 z-40 lg:hidden border-t bg-background pb-[env(safe-area-inset-bottom)]"
      aria-label="Primary"
    >
      <ul className={cn('grid', memberBottomNav.length === 2 ? 'grid-cols-2' : memberBottomNav.length === 3 ? 'grid-cols-3' : 'grid-cols-4')}>
        {memberBottomNav.map((item) => {
          const active = location.pathname === item.href;
          return (
            <li key={item.name}>
              <Link
                to={item.href}
                className={cn(
                  'flex flex-col items-center justify-center gap-1 py-2 min-h-[56px] text-xs font-medium transition-colors',
                  active ? 'text-primary' : 'text-muted-foreground',
                )}
                aria-current={active ? 'page' : undefined}
              >
                <item.icon className="h-5 w-5" aria-hidden="true" />
                {item.name}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
