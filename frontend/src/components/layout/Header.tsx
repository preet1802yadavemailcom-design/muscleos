import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { useAuthStore } from '@store/auth.store';
import { Button } from '@/components/ui/button';
import { LogOut, User, Bell, Menu } from 'lucide-react';
import { getRouteTitle, updateDocumentTitle } from '@/lib/route-metadata';

interface HeaderProps {
  onMenuClick: () => void;
}

export function Header({ onMenuClick }: HeaderProps) {
  const location = useLocation();
  const { user, logout } = useAuthStore();
  const title = getRouteTitle(location.pathname);

  useEffect(() => {
    updateDocumentTitle(title);
  }, [title]);

  return (
    <header className="sticky top-0 z-40 border-b bg-background px-4 sm:px-6 py-3">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <Button
            variant="ghost"
            size="icon"
            className="lg:hidden -ml-2"
            onClick={onMenuClick}
            aria-label="Open menu"
          >
            <Menu className="h-5 w-5" />
          </Button>
          <h1 className="text-xl sm:text-2xl font-bold tracking-tight truncate">{title}</h1>
        </div>
        <div className="flex items-center gap-2 sm:gap-4 shrink-0">
          <Button variant="ghost" size="icon" aria-label="Notifications">
            <Bell className="h-5 w-5" />
          </Button>
          <div className="flex items-center gap-2">
            <div className="h-8 w-8 rounded-full bg-primary flex items-center justify-center shrink-0">
              <User className="h-4 w-4 text-primary-foreground" />
            </div>
            <div className="hidden md:block">
              <p className="text-sm font-medium">{user?.firstName} {user?.lastName}</p>
              <p className="text-xs text-muted-foreground capitalize">{user?.role}</p>
            </div>
          </div>
          <Button variant="ghost" size="icon" onClick={logout} aria-label="Sign out">
            <LogOut className="h-5 w-5" />
          </Button>
        </div>
      </div>
    </header>
  );
}
