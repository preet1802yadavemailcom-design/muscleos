import { Navigate } from 'react-router-dom';
import { useAuthStore } from '@store/auth.store';

interface RoleRouteProps {
  allowedRoles: string[];
  children: React.ReactNode;
  fallback?: string;
}

/**
 * Restricts a route to a specific set of roles.
 * Redirects unauthenticated users to /login and unauthorized
 * users back to the dashboard (or a custom fallback route).
 */
export function RoleRoute({ allowedRoles, children, fallback = '/' }: RoleRouteProps) {
  const { isAuthenticated, user } = useAuthStore();

  if (!isAuthenticated || !user) {
    return <Navigate to="/login" replace />;
  }

  if (!allowedRoles.includes(user.role)) {
    return <Navigate to={fallback} replace />;
  }

  return <>{children}</>;
}
