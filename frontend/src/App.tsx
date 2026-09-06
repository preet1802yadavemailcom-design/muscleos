import { Suspense, lazy } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { useAuthStore } from '@store/auth.store';
import { Layout } from '@components/layout/Layout';
import { RoleRoute } from '@components/auth/RoleRoute';
import { PwaUpdatePrompt } from '@components/layout/PwaUpdatePrompt';

// Route-level code splitting: each page is its own chunk, fetched only when
// the user navigates to it, instead of one ~760KB bundle loaded up front.
const LoginPage = lazy(() => import('@pages/auth/LoginPage').then((m) => ({ default: m.LoginPage })));
const ClaimAccountPage = lazy(() => import('@pages/auth/ClaimAccountPage').then((m) => ({ default: m.ClaimAccountPage })));
const WelcomePage = lazy(() => import('@pages/auth/WelcomePage').then((m) => ({ default: m.WelcomePage })));
const AuthCallbackPage = lazy(() => import('@pages/auth/AuthCallbackPage').then((m) => ({ default: m.AuthCallbackPage })));
const CompleteProfilePage = lazy(() => import('@pages/auth/CompleteProfilePage').then((m) => ({ default: m.CompleteProfilePage })));
const TwoFactorSetupPage = lazy(() => import('@pages/auth/TwoFactorSetupPage').then((m) => ({ default: m.TwoFactorSetupPage })));
const TwoFactorVerifyPage = lazy(() => import('@pages/auth/TwoFactorVerifyPage').then((m) => ({ default: m.TwoFactorVerifyPage })));
const RegisterPage = lazy(() => import('@pages/auth/RegisterPage').then((m) => ({ default: m.RegisterPage })));
const ForgotPasswordPage = lazy(() => import('@pages/auth/ForgotPasswordPage').then((m) => ({ default: m.ForgotPasswordPage })));
const ResetPasswordPage = lazy(() => import('@pages/auth/ResetPasswordPage').then((m) => ({ default: m.ResetPasswordPage })));
const VerifyOtpPage = lazy(() => import('@pages/auth/VerifyOtpPage').then((m) => ({ default: m.VerifyOtpPage })));
const VerifyPhonePage = lazy(() => import('@pages/auth/VerifyPhonePage').then((m) => ({ default: m.VerifyPhonePage })));
const DashboardPage = lazy(() => import('@pages/dashboard/DashboardPage').then((m) => ({ default: m.DashboardPage })));
const SuperAdminDashboardPage = lazy(() => import('@pages/dashboard/SuperAdminDashboardPage').then((m) => ({ default: m.SuperAdminDashboardPage })));
const OwnerDashboardPage = lazy(() => import('@pages/dashboard/OwnerDashboardPage').then((m) => ({ default: m.OwnerDashboardPage })));
const MembersPage = lazy(() => import('@pages/members/MembersPage').then((m) => ({ default: m.MembersPage })));
const MemberDetailPage = lazy(() => import('@pages/members/MemberDetailPage').then((m) => ({ default: m.MemberDetailPage })));
const BatchesPage = lazy(() => import('@pages/batches/BatchesPage').then((m) => ({ default: m.BatchesPage })));
const AttendancePage = lazy(() => import('@pages/attendance/AttendancePage').then((m) => ({ default: m.AttendancePage })));
const MembershipsPage = lazy(() => import('@pages/memberships/MembershipsPage').then((m) => ({ default: m.MembershipsPage })));
const PaymentsPage = lazy(() => import('@pages/payments/PaymentsPage').then((m) => ({ default: m.PaymentsPage })));
const PendingUpiPaymentsPage = lazy(() => import('@pages/payments/PendingUpiPaymentsPage').then((m) => ({ default: m.PendingUpiPaymentsPage })));
const ReceptionPage = lazy(() => import('@pages/reception/ReceptionPage').then((m) => ({ default: m.ReceptionPage })));
const ReportsPage = lazy(() => import('@pages/reports/ReportsPage').then((m) => ({ default: m.ReportsPage })));
const NotificationsPage = lazy(() => import('@pages/notifications/NotificationsPage').then((m) => ({ default: m.NotificationsPage })));
const SettingsPage = lazy(() => import('@pages/settings/SettingsPage').then((m) => ({ default: m.SettingsPage })));
const PublicProfilePage = lazy(() => import('@pages/public/PublicProfilePage').then((m) => ({ default: m.PublicProfilePage })));
const CheckInPage = lazy(() => import('@pages/checkin/CheckInPage').then((m) => ({ default: m.CheckInPage })));
const MyProfilePage = lazy(() => import('@pages/profile/MyProfilePage').then((m) => ({ default: m.MyProfilePage })));
const MyMembershipPage = lazy(() => import('@pages/profile/MyMembershipPage').then((m) => ({ default: m.MyMembershipPage })));
const MyPaymentsPage = lazy(() => import('@pages/profile/MyPaymentsPage').then((m) => ({ default: m.MyPaymentsPage })));
const MyAttendancePage = lazy(() => import('@pages/profile/MyAttendancePage').then((m) => ({ default: m.MyAttendancePage })));
const OrganizationsPage = lazy(() => import('@pages/super-admin/OrganizationsPage').then((m) => ({ default: m.OrganizationsPage })));
const PlansPage = lazy(() => import('@pages/super-admin/PlansPage').then((m) => ({ default: m.PlansPage })));
const AuditLogsPage = lazy(() => import('@pages/super-admin/AuditLogsPage').then((m) => ({ default: m.AuditLogsPage })));
const SupportTicketsPage = lazy(() => import('@pages/super-admin/SupportTicketsPage').then((m) => ({ default: m.SupportTicketsPage })));
const MySupportTicketsPage = lazy(() => import('@pages/support/SupportTicketsPage').then((m) => ({ default: m.SupportTicketsPage })));
const MyFitnessPage = lazy(() => import('@pages/fitness/MyFitnessPage').then((m) => ({ default: m.MyFitnessPage })));
const AssignFitnessPlanPage = lazy(() => import('@pages/fitness/AssignFitnessPlanPage').then((m) => ({ default: m.AssignFitnessPlanPage })));

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

/** Renders the correct dashboard based on the signed-in user's role. Every
 *  role gets its own real, backend-connected home screen - there is no
 *  generic fallback with placeholder/mock data, since that would show a
 *  MEMBER or RECEPTIONIST numbers that have nothing to do with their
 *  account (e.g. "Total Members: 1,234"). */
function RoleAwareDashboard() {
  const { user } = useAuthStore();
  if (user?.role === ROLES.SUPER_ADMIN) return <SuperAdminDashboardPage />;
  if (user?.role === ROLES.GYM_OWNER) return <OwnerDashboardPage />;
  if (user?.role === ROLES.MEMBER) return <Navigate to="/my/membership" replace />;
  if (user?.role === ROLES.RECEPTION) return <Navigate to="/reception" replace />;
  if (user?.role === ROLES.TRAINER) return <Navigate to="/batches" replace />;
  return <DashboardPage />;
}

function App() {
  return (
    <>
      <PwaUpdatePrompt />
      <Suspense
        fallback={
          <div className="flex h-screen w-full items-center justify-center">
            <div className="h-8 w-8 animate-spin rounded-full border-2 border-muted-foreground border-t-transparent" />
          </div>
        }
      >
      <Routes>
      {/* Public / unauthenticated routes */}
      <Route path="/welcome" element={<WelcomePage />} />
      <Route path="/login" element={<LoginPage />} />
      <Route path="/claim" element={<ClaimAccountPage />} />
      <Route path="/auth/callback" element={<AuthCallbackPage />} />
      <Route path="/complete-profile" element={<CompleteProfilePage />} />
      <Route path="/2fa-setup" element={<TwoFactorSetupPage />} />
      <Route path="/2fa-verify" element={<TwoFactorVerifyPage />} />
      <Route path="/register" element={<RegisterPage />} />
      <Route path="/forgot-password" element={<ForgotPasswordPage />} />
      <Route path="/reset-password" element={<ResetPasswordPage />} />
      <Route path="/verify-otp" element={<VerifyOtpPage />} />
      <Route path="/verify-phone" element={<VerifyPhonePage />} />
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
          path="members/:id"
          element={
            <RoleRoute allowedRoles={[ROLES.GYM_OWNER, ROLES.TRAINER, ROLES.RECEPTION]}>
              <MemberDetailPage />
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
        <Route
          path="fitness/assign"
          element={
            <RoleRoute allowedRoles={[ROLES.GYM_OWNER, ROLES.TRAINER]}>
              <AssignFitnessPlanPage />
            </RoleRoute>
          }
        />
        <Route
          path="my/fitness"
          element={
            <RoleRoute allowedRoles={[ROLES.MEMBER]}>
              <MyFitnessPage />
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
          path="my/attendance"
          element={
            <RoleRoute allowedRoles={[ROLES.MEMBER]}>
              <MyAttendancePage />
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
          path="payments/pending-upi"
          element={
            <RoleRoute allowedRoles={[ROLES.GYM_OWNER, ROLES.RECEPTION]}>
              <PendingUpiPaymentsPage />
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
      </Suspense>
    </>
  );
}

export default App;
