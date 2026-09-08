/**
 * Centralized Route Metadata and Title Mapping for MuscleOS.
 * Maps application paths to human-readable page titles and handles document.title synchronization.
 */

export interface RouteMeta {
  title: string;
  exact?: boolean;
}

export const ROUTE_TITLE_MAP: Array<{ pattern: RegExp; title: string }> = [
  // Super Admin routes
  { pattern: /^\/super-admin\/organizations$/, title: 'Organizations' },
  { pattern: /^\/super-admin\/plans$/, title: 'Platform Plans' },
  { pattern: /^\/super-admin\/audit-logs$/, title: 'Audit Logs' },
  { pattern: /^\/super-admin\/tickets$/, title: 'Support Tickets' },
  { pattern: /^\/super-admin$/, title: 'Platform Dashboard' },

  // Management routes
  { pattern: /^\/members\/[^/]+$/, title: 'Member Details' },
  { pattern: /^\/members$/, title: 'Members' },
  { pattern: /^\/batches$/, title: 'Batches' },
  { pattern: /^\/attendance$/, title: 'Attendance' },
  { pattern: /^\/memberships$/, title: 'Memberships' },
  { pattern: /^\/payments\/pending-upi$/, title: 'Pending UPI' },
  { pattern: /^\/payments$/, title: 'Payments' },
  { pattern: /^\/reception$/, title: 'Reception' },
  { pattern: /^\/reports$/, title: 'Reports' },
  { pattern: /^\/notifications$/, title: 'Notifications' },
  { pattern: /^\/settings$/, title: 'Settings' },
  { pattern: /^\/support$/, title: 'Support' },
  { pattern: /^\/fitness\/assign$/, title: 'Assign Fitness Plan' },

  // Member-facing routes
  { pattern: /^\/my\/fitness$/, title: 'My Fitness' },
  { pattern: /^\/my\/profile$/, title: 'My Profile' },
  { pattern: /^\/my\/membership$/, title: 'My Membership' },
  { pattern: /^\/my\/attendance$/, title: 'My Attendance' },
  { pattern: /^\/my\/payments$/, title: 'My Payments' },

  // Root / Home
  { pattern: /^\/$/, title: 'Dashboard' },
];

/**
 * Derives the clean human-readable title for any given route pathname.
 */
export function getRouteTitle(pathname: string): string {
  const normalized = pathname.endsWith('/') && pathname.length > 1 ? pathname.slice(0, -1) : pathname;
  for (const item of ROUTE_TITLE_MAP) {
    if (item.pattern.test(normalized)) {
      return item.title;
    }
  }
  return 'Dashboard';
}

/**
 * Synchronizes the browser document.title with the active route.
 */
export function updateDocumentTitle(title: string): void {
  if (typeof document !== 'undefined') {
    document.title = `MuscleOS — ${title}`;
  }
}
