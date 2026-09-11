import { useEffect, useState, useRef } from 'react';
import { useLocation, useNavigate, Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuthStore } from '@store/auth.store';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { LogOut, User, Bell, Menu, Shield, CheckCheck, Clock, ExternalLink } from 'lucide-react';
import { getRouteTitle, updateDocumentTitle } from '@/lib/route-metadata';
import { notificationsApi } from '@/services/notifications.api';

interface HeaderProps {
  onMenuClick: () => void;
}

export function Header({ onMenuClick }: HeaderProps) {
  const location = useLocation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { user, logout } = useAuthStore();
  const title = getRouteTitle(location.pathname);

  const [notifOpen, setNotifOpen] = useState(false);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const notifRef = useRef<HTMLDivElement>(null);
  const userMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    updateDocumentTitle(title);
  }, [title]);

  // Click outside listener for dropdowns
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (notifRef.current && !notifRef.current.contains(e.target as Node)) {
        setNotifOpen(false);
      }
      if (userMenuRef.current && !userMenuRef.current.contains(e.target as Node)) {
        setUserMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Poll unread count every 30s
  const { data: unreadCount = 0 } = useQuery({
    queryKey: ['notifications', 'unread-count'],
    queryFn: () => notificationsApi.getUnreadCount(),
    refetchInterval: 30000,
  });

  // Query notifications when popover is opened
  const { data: notifsData, isLoading: notifsLoading } = useQuery({
    queryKey: ['notifications', 'my-recent'],
    queryFn: () => notificationsApi.getMyNotifications(1, 10),
    enabled: notifOpen,
  });

  const markReadMutation = useMutation({
    mutationFn: (id: string) => notificationsApi.markAsRead(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['notifications'] });
    },
  });

  const markAllMutation = useMutation({
    mutationFn: () => notificationsApi.markAllAsRead(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['notifications'] });
    },
  });

  const notifications = notifsData?.items ?? [];

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
          {/* Notification Center */}
          <div className="relative" ref={notifRef}>
            <Button
              variant="ghost"
              size="icon"
              className="relative"
              onClick={() => setNotifOpen((v) => !v)}
              aria-label="Notifications"
            >
              <Bell className="h-5 w-5" />
              {unreadCount > 0 && (
                <span className="absolute -top-0.5 -right-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-bold text-destructive-foreground">
                  {unreadCount > 9 ? '9+' : unreadCount}
                </span>
              )}
            </Button>

            {notifOpen && (
              <div className="absolute right-0 mt-2 w-80 sm:w-96 rounded-lg border bg-popover shadow-lg text-popover-foreground z-50 animate-in fade-in-50 zoom-in-95">
                <div className="flex items-center justify-between border-b px-4 py-3">
                  <div className="flex items-center gap-2">
                    <h3 className="font-semibold text-sm">Notifications</h3>
                    {unreadCount > 0 && (
                      <Badge variant="secondary" className="text-xs px-1.5 py-0">{unreadCount} new</Badge>
                    )}
                  </div>
                  {unreadCount > 0 && (
                    <button
                      onClick={() => markAllMutation.mutate()}
                      disabled={markAllMutation.isPending}
                      className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1"
                    >
                      <CheckCheck className="h-3.5 w-3.5" /> Mark all read
                    </button>
                  )}
                </div>

                <div className="max-h-80 overflow-y-auto divide-y">
                  {notifsLoading && (
                    <div className="py-6 text-center text-xs text-muted-foreground">Loading notifications…</div>
                  )}
                  {!notifsLoading && notifications.length === 0 && (
                    <div className="py-8 text-center text-xs text-muted-foreground">
                      <Bell className="h-6 w-6 mx-auto mb-2 opacity-40" />
                      No notifications yet
                    </div>
                  )}
                  {notifications.map((item) => (
                    <div
                      key={item.id}
                      onClick={() => !item.readAt && markReadMutation.mutate(item.id)}
                      className={`p-3 text-left transition-colors cursor-pointer hover:bg-muted/50 flex flex-col gap-1 ${
                        !item.readAt ? 'bg-primary/5' : ''
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-medium text-xs truncate">{item.title}</span>
                        <span className="text-[10px] text-muted-foreground flex items-center gap-1 shrink-0">
                          <Clock className="h-3 w-3" />
                          {new Date(item.createdAt).toLocaleDateString()}
                        </span>
                      </div>
                      <p className="text-xs text-muted-foreground line-clamp-2">{item.content}</p>
                    </div>
                  ))}
                </div>

                {user?.role === 'GYM_OWNER' && (
                  <div className="border-t p-2 text-center">
                    <Link
                      to="/notifications"
                      onClick={() => setNotifOpen(false)}
                      className="text-xs text-primary hover:underline flex items-center justify-center gap-1"
                    >
                      Staff announcement console <ExternalLink className="h-3 w-3" />
                    </Link>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* User Profile / Security / Signout Dropdown */}
          <div className="relative" ref={userMenuRef}>
            <button
              onClick={() => setUserMenuOpen((v) => !v)}
              className="flex items-center gap-2 rounded-full hover:opacity-85 transition-opacity focus:outline-none"
              aria-label="User menu"
            >
              <div className="h-8 w-8 rounded-full bg-primary flex items-center justify-center shrink-0 text-primary-foreground font-semibold text-xs">
                {(user?.firstName?.[0] ?? 'U').toUpperCase()}
              </div>
              <div className="hidden md:block text-left">
                <p className="text-sm font-medium leading-none">{user?.firstName} {user?.lastName}</p>
                <p className="text-xs text-muted-foreground capitalize mt-0.5">{user?.role?.toLowerCase().replace('_', ' ')}</p>
              </div>
            </button>

            {userMenuOpen && (
              <div className="absolute right-0 mt-2 w-48 rounded-lg border bg-popover shadow-lg text-popover-foreground z-50 py-1 text-sm animate-in fade-in-50 zoom-in-95">
                <div className="px-3 py-2 border-b">
                  <p className="font-medium text-xs truncate">{user?.firstName} {user?.lastName}</p>
                  <p className="text-[11px] text-muted-foreground truncate">{user?.email}</p>
                </div>
                <button
                  onClick={() => { setUserMenuOpen(false); navigate('/my/profile'); }}
                  className="w-full text-left px-3 py-2 hover:bg-muted/50 flex items-center gap-2 text-xs"
                >
                  <User className="h-3.5 w-3.5" /> My Profile
                </button>
                <button
                  onClick={() => { setUserMenuOpen(false); navigate('/security'); }}
                  className="w-full text-left px-3 py-2 hover:bg-muted/50 flex items-center gap-2 text-xs"
                >
                  <Shield className="h-3.5 w-3.5" /> Security & 2FA
                </button>
                <div className="border-t my-1" />
                <button
                  onClick={() => { setUserMenuOpen(false); logout(); }}
                  className="w-full text-left px-3 py-2 hover:bg-destructive/10 text-destructive flex items-center gap-2 text-xs"
                >
                  <LogOut className="h-3.5 w-3.5" /> Sign Out
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </header>
  );
}

