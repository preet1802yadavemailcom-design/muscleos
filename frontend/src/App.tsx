import { Routes, Route, Navigate } from 'react-router-dom';
import { useAuthStore } from '@store/auth.store';
import { Layout } from '@components/layout/Layout';
import { RoleRoute } from '@components/auth/RoleRoute';
import { LoginPage } from '@pages/auth/LoginPage';
import { WelcomePage } from '@pages/auth/WelcomePage';
import { AuthCallbackPage } from '@pages/auth/AuthCallbackPage';
import { CompleteProfilePage } from '@pages/auth/CompleteProfilePage';
import { TwoFactorSetupPage } from '@pages/auth/TwoFactorSetupPage';
import { TwoFactorVerifyPage } from '@pages/auth/TwoFactorVerifyPage';
import { RegisterPage } from '@pages/auth/RegisterPage';
import { ForgotPasswordPage } from '@pages/auth/ForgotPasswordPage';
import { ResetPasswordPage } from '@pages/auth/ResetPasswordPage';
import { VerifyOtpPage } from '@pages/auth/VerifyOtpPage';
import { VerifyWhatsappPage } from '@pages/auth/VerifyWhatsappPage';
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
import { CheckInPage } from '@pages/checkin/CheckInPage';
import { PwaUpdatePrompt } from '@components/layout/PwaUpdatePrompt';
import { MyProfilePage } from '@pages/profile/MyProfilePage';
import { MyMembershipPage } from '@pages/profile/MyMembershipPage';
import { MyPaymentsPage } from '@pages/profile/MyPaymentsPage';
import { OrganizationsPage } from '@pages/super-admin/OrganizationsPage';
import { PlansPage } from '@pages/super-admin/PlansPage';
import { AuditLogsPage } from '@pages/super-admin/AuditLogsPage';
import { SupportTicketsPage } from '@pages/super-admin/SupportTicketsPage';
import { SupportTicketsPage as MySupportTicketsPage } from '@pages/support/SupportTicketsPage';

const ROLES = {
  SUPER_ADMIN: 'SUPER_ADMIN',
  GYM_OWNER: 'GYM_OWNER',
  TRAINER: 'TRAINER',
  RECEPTION: 'RECEPTIONIST',
  MEMBER: 'MEMBER',
};

function PrivateRoute({ children }: { children: React.ReactNode }) {
  const { isAuthenticated } = useAuthStore();
  return isAuthenticated ? <>{children}</> : <Navigate to="/welcome" replace />;
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
    <>
      <PwaUpdatePrompt />
      <Routes>
      {/* Public / unauthenticated routes */}
      <Route path="/welcome" element={<WelcomePage />} />
      <Route path="/login" element={<LoginPage />} />
      <Route path="/auth/callback" element={<AuthCallbackPage />} />
      <Route path="/complete-profile" element={<CompleteProfilePage />} />
      <Route path="/2fa-setup" element={<TwoFactorSetupPage />} />
      <Route path="/2fa-verify" element={<TwoFactorVerifyPage />} />
      <Route path="/register" element={<RegisterPage />} />
      <Route path="/forgot-password" element={<ForgotPasswordPage />} />
      <Route path="/reset-password" element={<ResetPasswordPage />} />
      <Route path="/verify-otp" element={<VerifyOtpPage />} />
      <Route path="/verify-whatsapp" element={<VerifyWhatsappPage />} />
      <Route path="/checkin" element={<CheckInPage />} />
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
          path="super-admin/organizations"
          element={
            <RoleRoute allowedRoles={[ROLES.SUPER_ADMIN]}>
              <OrganizationsPage />
            </RoleRoute>
          }
        />
        <Route
          path="super-admin/plans"
          element={
            <RoleRoute allowedRoles={[ROLES.SUPER_ADMIN]}>
              <PlansPage />
            </RoleRoute>
          }
        />
        <Route
          path="super-admin/audit-logs"
          element={
            <RoleRoute allowedRoles={[ROLES.SUPER_ADMIN]}>
              <AuditLogsPage />
            </RoleRoute>
          }
        />
        <Route
          path="super-admin/tickets"
          element={
            <RoleRoute allowedRoles={[ROLES.SUPER_ADMIN]}>
              <SupportTicketsPage />
            </RoleRoute>
          }
        />

        <Route
          path="members"
          element={
            <RoleRoute allowedRoles={[ROLES.GYM_OWNER, ROLES.TRAINER, ROLES.RECEPTION]}>
              <MembersPage />
            </RoleRoute>
          }
        />
        <Route
          path="batches"
          element={
            <RoleRoute allowedRoles={[ROLES.GYM_OWNER, ROLES.TRAINER]}>
              <BatchesPage />
            </RoleRoute>
          }
        />
        <Route
          path="attendance"
          element={
            <RoleRoute allowedRoles={[ROLES.GYM_OWNER, ROLES.TRAINER, ROLES.RECEPTION, ROLES.MEMBER]}>
              <AttendancePage />
            </RoleRoute>
          }
        />
        <Route
          path="support"
          element={
            <RoleRoute allowedRoles={[ROLES.GYM_OWNER, ROLES.TRAINER, ROLES.RECEPTION, ROLES.MEMBER]}>
              <MySupportTicketsPage />
            </RoleRoute>
          }
        />
        <Route path="my/profile" element={<MyProfilePage />} />
        <Route
          path="my/membership"
          element={
            <RoleRoute allowedRoles={[ROLES.MEMBER]}>
              <MyMembershipPage />
            </RoleRoute>
          }
        />
        <Route
          path="my/payments"
          element={
            <RoleRoute allowedRoles={[ROLES.MEMBER]}>
              <MyPaymentsPage />
            </RoleRoute>
          }
        />
        <Route
          path="memberships"
          element={
            <RoleRoute allowedRoles={[ROLES.GYM_OWNER, ROLES.RECEPTION]}>
              <MembershipsPage />
            </RoleRoute>
          }
        />
        <Route
          path="payments"
          element={
            <RoleRoute allowedRoles={[ROLES.GYM_OWNER, ROLES.RECEPTION]}>
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
            <RoleRoute allowedRoles={[ROLES.GYM_OWNER]}>
              <ReportsPage />
            </RoleRoute>
          }
        />
        <Route
          path="notifications"
          element={
            <RoleRoute allowedRoles={[ROLES.GYM_OWNER]}>
              <NotificationsPage />
            </RoleRoute>
          }
        />
        <Route
          path="settings"
          element={
            <RoleRoute allowedRoles={[ROLES.GYM_OWNER]}>
              <SettingsPage />
            </RoleRoute>
          }
        />
      </Route>

      <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </>
  );
}

export default App;
