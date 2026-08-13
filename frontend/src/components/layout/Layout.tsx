import { useState } from 'react';
import { Outlet } from 'react-router-dom';
import { Sidebar } from './Sidebar';
import { Header } from './Header';
import { MobileDrawer } from './MobileDrawer';
import { MemberBottomNav } from './MemberBottomNav';
import { useAuthStore } from '@store/auth.store';

export function Layout() {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const { user } = useAuthStore();
  const isMember = user?.role === 'MEMBER';

  return (
    <div className="min-h-screen bg-background">
      <Sidebar />
      <MobileDrawer open={drawerOpen} onClose={() => setDrawerOpen(false)} />
      <div className="lg:pl-64">
        <Header onMenuClick={() => setDrawerOpen(true)} />
        <main className={isMember ? 'p-4 sm:p-6 pb-20 lg:pb-6' : 'p-4 sm:p-6'}>
          <Outlet />
        </main>
      </div>
      {isMember && <MemberBottomNav />}
    </div>
  );
}
