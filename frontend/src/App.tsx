import { Routes, Route, Navigate } from 'react-router-dom';
import { useAuthStore } from '@store/auth.store';
import { Layout } from '@components/layout/Layout';
import { RoleRoute } from '@components/auth/RoleRoute';
import { LoginPage } from '@pages/auth/LoginPage';
import { RegisterPage } from '@pages/auth/RegisterPage';
import { ForgotPasswordPage } from '@pages/auth/ForgotPasswordPage';
import { ResetPasswordPage } from '@pages/auth/ResetPasswordPage';
import { VerifyOtpPage } from '@pages/auth/VerifyOtpPage';
import { DashboardPage } from '@pages/dashboard/DashboardPage';
import { SuperAdminDashboardPage } from '@pages/dashboard/SuperAdminDashboardPage';
import { OwnerDashboardPage } from '@pages/dashboard/OwnerDashboardPage';
import { MembersPage } from '@pages/members/MembersPage';
import { BatchesPage } from '@pages/batches/BatchesPage';
import { AttendancePage } from '@pages/attendance/AttendancePage';
import { MembershipsPage } from '@pages/memberships/MembershipsPage';
import { PaymentsPage } from '@pages/payments/PaymentsPage';
import { ReceptionPage } from '@pages/reception/ReceptionPage';
import { ReportsPage } from '@pages/reports/ReportsPage';
import { NotificationsPage } from '@pages/notifications/NotificationsPage';
import { SettingsPage } from '@pages/settings/SettingsPage';
import { PublicProfilePage } from '@pages/public/PublicProfilePage';

const ROLES = {
  SUPER_ADMIN: 'SUPER_ADMIN',
  GYM_OWNER: 'GYM_OWNER',
  TRAINER: 'TRAINER',
  RECEPTION: 'RECEPTION',
  MEMBER: 'MEMBER',
};

function PrivateRoute({ children }: { children: React.ReactNode }) {
  const { isAuthenticated } = useAuthStore();
  return isAuthenticated ? <>{children}</> : <Navigate to="/login" replace />;
}

/** Renders the correct dashboard based on the signed-in user's role. */
function RoleAwareDashboard() {
  const { user } = useAuthStore();
  if (user?.role === ROLES.SUPER_ADMIN) return <SuperAdminDashboardPage />;
  if (user?.role === ROLES.GYM_OWNER) return <OwnerDashboardPage />;
  return <DashboardPage />;
}

function App() {
  return (
    <Routes>
      {/* Public / unauthenticated routes */}
      <Route path="/login" element={<LoginPage />} />
      <Route path="/register" element={<RegisterPage />} />
      <Route path="/forgot-password" element={<ForgotPasswordPage />} />
      <Route path="/reset-password" element={<ResetPasswordPage />} />
      <Route path="/verify-otp" element={<VerifyOtpPage />} />
      <Route path="/gym/:slug" element={<PublicProfilePage />} />

      {/* Authenticated app shell */}
      <Route
        path="/"
        element={
          <PrivateRoute>
            <Layout />
          </PrivateRoute>
        }
      >
        <Route index element={<RoleAwareDashboard />} />

        <Route
          path="super-admin"
          element={
            <RoleRoute allowedRoles={[ROLES.SUPER_ADMIN]}>
              <SuperAdminDashboardPage />
            </RoleRoute>
          }
        />

        <Route
          path="members"
          element={
            <RoleRoute allowedRoles={[ROLES.SUPER_ADMIN, ROLES.GYM_OWNER, ROLES.TRAINER, ROLES.RECEPTION]}>
              <MembersPage />
            </RoleRoute>
          }
        />
        <Route
          path="batches"
          element={
            <RoleRoute allowedRoles={[ROLES.SUPER_ADMIN, ROLES.GYM_OWNER, ROLES.TRAINER]}>
              <BatchesPage />
            </RoleRoute>
          }
        />
        <Route path="attendance" element={<AttendancePage />} />
        <Route
          path="memberships"
          element={
            <RoleRoute allowedRoles={[ROLES.SUPER_ADMIN, ROLES.GYM_OWNER, ROLES.RECEPTION]}>
              <MembershipsPage />
            </RoleRoute>
          }
        />
        <Route
          path="payments"
          element={
            <RoleRoute allowedRoles={[ROLES.SUPER_ADMIN, ROLES.GYM_OWNER, ROLES.RECEPTION]}>
              <PaymentsPage />
            </RoleRoute>
          }
        />
        <Route
          path="reception"
          element={
            <RoleRoute allowedRoles={[ROLES.GYM_OWNER, ROLES.RECEPTION]}>
              <ReceptionPage />
            </RoleRoute>
          }
        />
        <Route
          path="reports"
          element={
            <RoleRoute allowedRoles={[ROLES.SUPER_ADMIN, ROLES.GYM_OWNER]}>
              <ReportsPage />
            </RoleRoute>
          }
        />
        <Route
          path="notifications"
          element={
            <RoleRoute allowedRoles={[ROLES.SUPER_ADMIN, ROLES.GYM_OWNER]}>
              <NotificationsPage />
            </RoleRoute>
          }
        />
        <Route
          path="settings"
          element={
            <RoleRoute allowedRoles={[ROLES.SUPER_ADMIN, ROLES.GYM_OWNER]}>
              <SettingsPage />
            </RoleRoute>
          }
        />
      </Route>

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

export default App;
