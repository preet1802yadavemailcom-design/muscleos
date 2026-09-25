import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  Building2, Users, DollarSign, UserCog, Bell, LifeBuoy, Search,
  ChevronLeft, ChevronRight, AlertCircle, RefreshCw, ExternalLink,
} from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import api from '@services/api';
import { GymDetailsDialog } from '@/components/super-admin/GymDetailsDialog';

export type SuperAdminDrillMetric =
  | 'TOTAL_GYMS'
  | 'TOTAL_MEMBERS'
  | 'PLATFORM_REVENUE'
  | 'TOTAL_TRAINERS'
  | 'PENDING_APPROVALS'
  | 'OPEN_TICKETS';

interface SuperAdminDrillDownDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  metric: SuperAdminDrillMetric | null;
}

interface MetricConfig {
  title: string;
  description: string;
  icon: any;
  viewAllRoute?: string;
  viewAllLabel?: string;
}

const METRIC_CONFIGS: Record<SuperAdminDrillMetric, MetricConfig> = {
  TOTAL_GYMS: {
    title: 'Total Registered Gyms',
    description: 'All gyms and fitness centers onboarded across the platform',
    icon: Building2,
    viewAllRoute: '/super-admin/organizations',
    viewAllLabel: 'Manage Organizations',
  },
  TOTAL_MEMBERS: {
    title: 'Platform Members',
    description: 'All active and registered gym members across all gyms',
    icon: Users,
  },
  PLATFORM_REVENUE: {
    title: 'Platform Revenue & Transactions',
    description: 'Completed payments, memberships, and transactions across the platform',
    icon: DollarSign,
  },
  TOTAL_TRAINERS: {
    title: 'Platform Trainers',
    description: 'All fitness instructors and trainers assigned to gyms',
    icon: UserCog,
  },
  PENDING_APPROVALS: {
    title: 'Pending Gym Approvals',
    description: 'New gym sign-ups waiting for Super Admin review and verification',
    icon: Bell,
    viewAllRoute: '/super-admin/organizations?status=PENDING',
    viewAllLabel: 'Go to Organizations Approval',
  },
  OPEN_TICKETS: {
    title: 'Open Support Tickets',
    description: 'Pending help desk and support requests from gym owners and staff',
    icon: LifeBuoy,
    viewAllRoute: '/super-admin/tickets',
    viewAllLabel: 'Manage Tickets',
  },
};

const PAGE_SIZE = 10;

export function SuperAdminDrillDownDialog({
  open,
  onOpenChange,
  metric,
}: SuperAdminDrillDownDialogProps) {
  const navigate = useNavigate();
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [page, setPage] = useState(1);
  const [detailedGymId, setDetailedGymId] = useState<string | null>(null);

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(search.trim());
      setPage(1);
    }, 300);
    return () => clearTimeout(timer);
  }, [search]);

  useEffect(() => {
    if (open) {
      setSearch('');
      setDebouncedSearch('');
      setPage(1);
    }
  }, [open, metric]);

  const config = metric ? METRIC_CONFIGS[metric] : null;

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['super-admin-drill-down', metric, page, debouncedSearch],
    queryFn: async () => {
      if (!metric) return null;
      const res = await api.get('/super-admin/dashboard/drill-down', {
        params: {
          metric,
          page,
          limit: PAGE_SIZE,
          ...(debouncedSearch ? { search: debouncedSearch } : {}),
        },
      });
      return res.data;
    },
    enabled: open && !!metric,
  });

  const items: any[] = data?.data ?? [];
  const total: number = data?.meta?.total ?? 0;
  const totalPages: number = data?.meta?.totalPages ?? 1;

  const handleNavigate = (route: string) => {
    onOpenChange(false);
    navigate(route);
  };

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[85vh] flex flex-col p-0 gap-0 overflow-hidden">
        {/* Header */}
        <DialogHeader className="p-6 pb-4 border-b bg-card">
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-center gap-3">
              {config && (
                <div className="p-2 rounded-lg bg-primary/10 text-primary">
                  <config.icon className="h-6 w-6" />
                </div>
              )}
              <div>
                <DialogTitle className="text-xl font-bold flex items-center gap-2">
                  {config?.title ?? 'Platform Details'}
                  {!isLoading && (
                    <Badge variant="secondary" className="font-normal text-xs">
                      {total} records
                    </Badge>
                  )}
                </DialogTitle>
                <DialogDescription className="text-xs text-muted-foreground mt-0.5">
                  {config?.description}
                </DialogDescription>
              </div>
            </div>
            {config?.viewAllRoute && (
              <Button
                variant="outline"
                size="sm"
                className="shrink-0 gap-1.5 text-xs"
                onClick={() => handleNavigate(config.viewAllRoute!)}
              >
                {config.viewAllLabel || 'View All'}
                <ExternalLink className="h-3.5 w-3.5" />
              </Button>
            )}
          </div>

          {/* Search bar */}
          <div className="relative mt-4">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder={`Search ${config?.title?.toLowerCase() || ''}...`}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9 text-sm"
            />
          </div>
        </DialogHeader>

        {/* Content Table / List */}
        <div className="flex-1 overflow-y-auto p-6">
          {isLoading ? (
            <div className="flex flex-col items-center justify-center py-16 gap-3 text-muted-foreground">
              <RefreshCw className="h-7 w-7 animate-spin text-primary" />
              <p className="text-sm">Loading details...</p>
            </div>
          ) : isError ? (
            <div className="flex flex-col items-center justify-center py-16 gap-3 text-destructive">
              <AlertCircle className="h-8 w-8" />
              <p className="text-sm font-medium">Failed to load platform data</p>
              <Button variant="outline" size="sm" onClick={() => refetch()}>
                Retry
              </Button>
            </div>
          ) : items.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 gap-2 text-muted-foreground">
              <p className="text-sm font-medium">No records found</p>
              <p className="text-xs">
                {debouncedSearch ? 'Try a different search query' : 'No entries available for this metric yet'}
              </p>
            </div>
          ) : (
            <div className="rounded-md border overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b bg-muted/50 text-left font-medium text-muted-foreground text-xs uppercase tracking-wider">
                      {metric === 'TOTAL_GYMS' && (
                        <>
                          <th className="py-3 px-4">Gym Name</th>
                          <th className="py-3 px-4">Location</th>
                          <th className="py-3 px-4">Owner / Contact</th>
                          <th className="py-3 px-4">Members</th>
                          <th className="py-3 px-4">Status</th>
                          <th className="py-3 px-4">Registered</th>
                          <th className="py-3 px-4 text-right">Actions</th>
                        </>
                      )}
                      {metric === 'PENDING_APPROVALS' && (
                        <>
                          <th className="py-3 px-4">Gym Name</th>
                          <th className="py-3 px-4">Owner Name</th>
                          <th className="py-3 px-4">Email</th>
                          <th className="py-3 px-4">Phone</th>
                          <th className="py-3 px-4">City</th>
                          <th className="py-3 px-4">Requested On</th>
                          <th className="py-3 px-4 text-right">Actions</th>
                        </>
                      )}
                      {metric === 'TOTAL_MEMBERS' && (
                        <>
                          <th className="py-3 px-4">Member Name</th>
                          <th className="py-3 px-4">Gym</th>
                          <th className="py-3 px-4">Member Code</th>
                          <th className="py-3 px-4">Contact</th>
                          <th className="py-3 px-4">Status</th>
                          <th className="py-3 px-4">Joined Date</th>
                        </>
                      )}
                      {metric === 'TOTAL_TRAINERS' && (
                        <>
                          <th className="py-3 px-4">Trainer Name</th>
                          <th className="py-3 px-4">Gym</th>
                          <th className="py-3 px-4">Email</th>
                          <th className="py-3 px-4">Phone</th>
                          <th className="py-3 px-4">Status</th>
                          <th className="py-3 px-4">Joined</th>
                        </>
                      )}
                      {metric === 'PLATFORM_REVENUE' && (
                        <>
                          <th className="py-3 px-4">Invoice / Receipt</th>
                          <th className="py-3 px-4">Gym Name</th>
                          <th className="py-3 px-4">Member</th>
                          <th className="py-3 px-4">Amount</th>
                          <th className="py-3 px-4">Method</th>
                          <th className="py-3 px-4">Status</th>
                          <th className="py-3 px-4">Date</th>
                        </>
                      )}
                      {metric === 'OPEN_TICKETS' && (
                        <>
                          <th className="py-3 px-4">Ticket #</th>
                          <th className="py-3 px-4">Subject</th>
                          <th className="py-3 px-4">Gym</th>
                          <th className="py-3 px-4">Submitted By</th>
                          <th className="py-3 px-4">Priority</th>
                          <th className="py-3 px-4">Created At</th>
                        </>
                      )}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {items.map((row: any) => {
                      if (metric === 'TOTAL_GYMS') {
                        const owner = row.users?.[0];
                        return (
                          <tr key={row.id} className="hover:bg-muted/30 transition-colors">
                            <td className="py-3 px-4 font-semibold text-foreground">
                              {row.name}
                              <div className="text-xs text-muted-foreground font-normal">{row.email || '—'}</div>
                            </td>
                            <td className="py-3 px-4 text-muted-foreground">
                              {row.city ? `${row.city}${row.state ? `, ${row.state}` : ''}` : '—'}
                            </td>
                            <td className="py-3 px-4">
                              {owner ? (
                                <div>
                                  <div className="font-medium">{owner.firstName} {owner.lastName}</div>
                                  <div className="text-xs text-muted-foreground">{owner.phone || owner.email}</div>
                                </div>
                              ) : (
                                <span className="text-muted-foreground">—</span>
                              )}
                            </td>
                            <td className="py-3 px-4 font-medium">
                              {row._count?.members ?? 0}
                            </td>
                            <td className="py-3 px-4">
                              <Badge
                                variant={
                                  row.status === 'ACTIVE'
                                    ? 'default'
                                    : row.status === 'PENDING'
                                    ? 'secondary'
                                    : 'destructive'
                                }
                                className="text-xs"
                              >
                                {row.status}
                              </Badge>
                            </td>
                            <td className="py-3 px-4 text-xs text-muted-foreground">
                              {new Date(row.createdAt).toLocaleDateString()}
                            </td>
                            <td className="py-3 px-4 text-right">
                              <Button
                                size="sm"
                                variant="outline"
                                className="h-7 text-xs font-medium"
                                onClick={() => setDetailedGymId(row.id)}
                              >
                                View Details
                              </Button>
                            </td>
                          </tr>
                        );
                      }

                      if (metric === 'PENDING_APPROVALS') {
                        const owner = row.users?.[0];
                        return (
                          <tr key={row.id} className="hover:bg-muted/30 transition-colors">
                            <td className="py-3 px-4 font-semibold text-foreground">
                              {row.name}
                            </td>
                            <td className="py-3 px-4 font-medium">
                              {owner ? `${owner.firstName} ${owner.lastName}` : '—'}
                            </td>
                            <td className="py-3 px-4 text-muted-foreground">
                              {owner?.email || row.email || '—'}
                            </td>
                            <td className="py-3 px-4 text-muted-foreground">
                              {owner?.phone || row.phone || '—'}
                            </td>
                            <td className="py-3 px-4 text-muted-foreground">
                              {row.city || '—'}
                            </td>
                            <td className="py-3 px-4 text-xs text-muted-foreground">
                              {new Date(row.createdAt).toLocaleDateString()}
                            </td>
                            <td className="py-3 px-4 text-right">
                              <Button
                                size="sm"
                                variant="outline"
                                className="h-7 text-xs font-medium"
                                onClick={() => setDetailedGymId(row.id)}
                              >
                                View Details
                              </Button>
                            </td>
                          </tr>
                        );
                      }

                      if (metric === 'TOTAL_MEMBERS') {
                        return (
                          <tr key={row.id} className="hover:bg-muted/30 transition-colors">
                            <td className="py-3 px-4 font-semibold text-foreground">
                              {row.firstName} {row.lastName}
                            </td>
                            <td className="py-3 px-4 text-muted-foreground font-medium">
                              {row.gym?.name || '—'}
                            </td>
                            <td className="py-3 px-4">
                              <Badge variant="outline" className="font-mono text-xs">
                                {row.memberCode}
                              </Badge>
                            </td>
                            <td className="py-3 px-4 text-xs text-muted-foreground">
                              <div>{row.mobile || '—'}</div>
                              {row.email && <div className="text-[11px]">{row.email}</div>}
                            </td>
                            <td className="py-3 px-4">
                              <Badge
                                variant={row.status === 'ACTIVE' ? 'default' : 'secondary'}
                                className="text-xs"
                              >
                                {row.status}
                              </Badge>
                            </td>
                            <td className="py-3 px-4 text-xs text-muted-foreground">
                              {new Date(row.createdAt).toLocaleDateString()}
                            </td>
                          </tr>
                        );
                      }

                      if (metric === 'TOTAL_TRAINERS') {
                        return (
                          <tr key={row.id} className="hover:bg-muted/30 transition-colors">
                            <td className="py-3 px-4 font-semibold text-foreground">
                              {row.firstName} {row.lastName}
                            </td>
                            <td className="py-3 px-4 text-muted-foreground font-medium">
                              {row.gym?.name || '—'}
                            </td>
                            <td className="py-3 px-4 text-muted-foreground text-xs">
                              {row.email || '—'}
                            </td>
                            <td className="py-3 px-4 text-muted-foreground text-xs">
                              {row.phone || '—'}
                            </td>
                            <td className="py-3 px-4">
                              <Badge
                                variant={row.status === 'ACTIVE' ? 'default' : 'secondary'}
                                className="text-xs"
                              >
                                {row.status}
                              </Badge>
                            </td>
                            <td className="py-3 px-4 text-xs text-muted-foreground">
                              {new Date(row.createdAt).toLocaleDateString()}
                            </td>
                          </tr>
                        );
                      }

                      if (metric === 'PLATFORM_REVENUE') {
                        const amount = Number(row.total || row.amount || 0);
                        return (
                          <tr key={row.id} className="hover:bg-muted/30 transition-colors">
                            <td className="py-3 px-4 font-mono text-xs font-semibold text-foreground">
                              {row.invoiceNumber || row.receiptNumber || row.id.slice(0, 8)}
                            </td>
                            <td className="py-3 px-4 font-medium text-foreground">
                              {row.gym?.name || '—'}
                            </td>
                            <td className="py-3 px-4 text-xs text-muted-foreground">
                              {row.member ? (
                                <>
                                  <div className="font-medium text-foreground">
                                    {row.member.firstName} {row.member.lastName}
                                  </div>
                                  <div>{row.member.mobile || '—'}</div>
                                </>
                              ) : (
                                '—'
                              )}
                            </td>
                            <td className="py-3 px-4 font-bold text-foreground">
                              ₹{amount.toLocaleString('en-IN')}
                            </td>
                            <td className="py-3 px-4 text-xs text-muted-foreground uppercase">
                              {row.method || 'ONLINE'}
                            </td>
                            <td className="py-3 px-4">
                              <Badge
                                variant={row.status === 'COMPLETED' ? 'default' : 'destructive'}
                                className="text-xs"
                              >
                                {row.status}
                              </Badge>
                            </td>
                            <td className="py-3 px-4 text-xs text-muted-foreground">
                              {new Date(row.createdAt).toLocaleDateString()}
                            </td>
                          </tr>
                        );
                      }

                      if (metric === 'OPEN_TICKETS') {
                        return (
                          <tr key={row.id} className="hover:bg-muted/30 transition-colors">
                            <td className="py-3 px-4 font-mono text-xs font-semibold text-foreground">
                              {row.ticketNumber || row.id.slice(0, 8)}
                            </td>
                            <td className="py-3 px-4 font-medium text-foreground">
                              {row.title || row.subject || 'Support Ticket'}
                            </td>
                            <td className="py-3 px-4 text-muted-foreground text-xs">
                              {row.gym?.name || 'Platform'}
                            </td>
                            <td className="py-3 px-4 text-xs text-muted-foreground">
                              {row.requesterName || (row.user ? `${row.user.firstName} ${row.user.lastName}` : '—')}
                              {row.requesterEmail && <div className="text-[11px] text-muted-foreground/80">{row.requesterEmail}</div>}
                            </td>
                            <td className="py-3 px-4">
                              <Badge
                                variant={
                                  row.priority === 'URGENT' || row.priority === 'HIGH'
                                    ? 'destructive'
                                    : 'secondary'
                                }
                                className="text-xs"
                              >
                                {row.priority}
                              </Badge>
                            </td>
                            <td className="py-3 px-4 text-xs text-muted-foreground">
                              {new Date(row.createdAt).toLocaleDateString()}
                            </td>
                          </tr>
                        );
                      }

                      return null;
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>

        {/* Footer / Pagination */}
        <div className="flex items-center justify-between p-4 border-t bg-card text-xs text-muted-foreground">
          <div>
            {total > 0 ? (
              <span>
                Showing <strong className="text-foreground">{(page - 1) * PAGE_SIZE + 1}</strong> to{' '}
                <strong className="text-foreground">{Math.min(page * PAGE_SIZE, total)}</strong> of{' '}
                <strong className="text-foreground">{total}</strong> entries
              </span>
            ) : (
              <span>No entries</span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              className="h-8 px-2"
              disabled={page <= 1 || isLoading}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
            >
              <ChevronLeft className="h-4 w-4 mr-1" />
              Prev
            </Button>
            <span className="px-2">
              Page {page} of {totalPages}
            </span>
            <Button
              variant="outline"
              size="sm"
              className="h-8 px-2"
              disabled={page >= totalPages || isLoading}
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            >
              Next
              <ChevronRight className="h-4 w-4 ml-1" />
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>

    <GymDetailsDialog
      gymId={detailedGymId}
      open={!!detailedGymId}
      onOpenChange={(isOpen) => !isOpen && setDetailedGymId(null)}
    />
  </>
);
}
