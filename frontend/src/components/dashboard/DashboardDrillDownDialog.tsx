import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  Users, UserCheck, DollarSign, TrendingUp, Search, ChevronLeft,
  ChevronRight, AlertCircle, RefreshCw, ExternalLink, Calendar,
  ArrowRight,
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

export type DashboardDrillMetric =
  | 'ACTIVE_MEMBERS'
  | 'CHECKINS_TODAY'
  | 'CHECKOUTS_TODAY'
  | 'CURRENTLY_IN_GYM'
  | 'EXPIRING_SOON'
  | 'EXPIRED_MEMBERSHIPS'
  | 'REVENUE_TODAY'
  | 'REVENUE_MONTH'
  | 'INACTIVE_MEMBERS'
  | 'EXPIRED_MEMBERS';

interface DashboardDrillDownDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  metric: DashboardDrillMetric | null;
}

interface MetricConfig {
  title: string;
  description: string;
  icon: any;
  viewAllRoute: string;
  viewAllLabel: string;
}

const METRIC_CONFIGS: Record<DashboardDrillMetric, MetricConfig> = {
  ACTIVE_MEMBERS: {
    title: 'Active Members',
    description: 'Members currently enrolled with active account standing',
    icon: Users,
    viewAllRoute: '/members?status=ACTIVE',
    viewAllLabel: 'View in Members',
  },
  CHECKINS_TODAY: {
    title: "Today's Check-ins",
    description: 'Attendance check-in events recorded for today',
    icon: UserCheck,
    viewAllRoute: '/attendance?date=today&event=CHECK_IN',
    viewAllLabel: 'View in Attendance',
  },
  CHECKOUTS_TODAY: {
    title: "Today's Check-outs",
    description: 'Attendance check-out events completed today',
    icon: UserCheck,
    viewAllRoute: '/attendance?date=today&event=CHECK_OUT',
    viewAllLabel: 'View in Attendance',
  },
  CURRENTLY_IN_GYM: {
    title: 'Currently In Gym',
    description: 'Live members checked in without a check-out timestamp',
    icon: TrendingUp,
    viewAllRoute: '/attendance?status=OPEN',
    viewAllLabel: 'View Live Feed',
  },
  EXPIRING_SOON: {
    title: 'Expiring Soon (Within 7 Days)',
    description: 'Active memberships ending within the next 7 days',
    icon: Calendar,
    viewAllRoute: '/memberships?expiry=within_7_days',
    viewAllLabel: 'View in Memberships',
  },
  EXPIRED_MEMBERSHIPS: {
    title: 'Expired Memberships',
    description: 'Memberships that have elapsed past their validity date',
    icon: Calendar,
    viewAllRoute: '/memberships?status=EXPIRED',
    viewAllLabel: 'View in Memberships',
  },
  REVENUE_TODAY: {
    title: "Today's Revenue",
    description: 'Successful payments recorded today',
    icon: DollarSign,
    viewAllRoute: '/payments?range=today&status=SUCCESS',
    viewAllLabel: 'View in Payments',
  },
  REVENUE_MONTH: {
    title: 'Revenue This Month',
    description: 'Successful payments collected this calendar month',
    icon: DollarSign,
    viewAllRoute: '/payments?range=this_month&status=SUCCESS',
    viewAllLabel: 'View in Payments',
  },
  INACTIVE_MEMBERS: {
    title: 'Inactive Members',
    description: 'Members with inactive or suspended status',
    icon: Users,
    viewAllRoute: '/members?status=INACTIVE',
    viewAllLabel: 'View in Members',
  },
  EXPIRED_MEMBERS: {
    title: 'Expired Members',
    description: 'Members whose subscriptions have lapsed',
    icon: Users,
    viewAllRoute: '/members?status=EXPIRED',
    viewAllLabel: 'View in Members',
  },
};

const PAGE_SIZE = 10;

function getInitialSort(metric: DashboardDrillMetric | null): string {
  if (metric === 'CHECKINS_TODAY' || metric === 'CURRENTLY_IN_GYM') return 'checkInAt';
  if (metric === 'CHECKOUTS_TODAY') return 'checkOutAt';
  if (metric === 'EXPIRING_SOON' || metric === 'EXPIRED_MEMBERSHIPS') return 'endDate';
  return 'createdAt';
}

export function DashboardDrillDownDialog({
  open,
  onOpenChange,
  metric,
}: DashboardDrillDownDialogProps) {
  const navigate = useNavigate();
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [sortBy, setSortBy] = useState(() => getInitialSort(metric));
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc');
  const [page, setPage] = useState(1);

  // Debounce search input by 300ms
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(search.trim());
      setPage(1);
    }, 300);
    return () => clearTimeout(timer);
  }, [search]);

  // Reset page and search when dialog opens or metric changes
  useEffect(() => {
    if (open) {
      setSearch('');
      setDebouncedSearch('');
      setPage(1);
      if (metric === 'CHECKINS_TODAY' || metric === 'CURRENTLY_IN_GYM') {
        setSortBy('checkInAt');
      } else if (metric === 'CHECKOUTS_TODAY') {
        setSortBy('checkOutAt');
      } else if (metric === 'EXPIRING_SOON' || metric === 'EXPIRED_MEMBERSHIPS') {
        setSortBy('endDate');
      } else if (metric === 'REVENUE_TODAY' || metric === 'REVENUE_MONTH') {
        setSortBy('createdAt');
      } else {
        setSortBy('createdAt');
      }
      setSortOrder('desc');
    }
  }, [open, metric]);

  const config = metric ? METRIC_CONFIGS[metric] : null;

  const {
    data: responseData,
    isLoading,
    isError,
    error,
    refetch,
    isFetching,
  } = useQuery({
    queryKey: ['dashboard-drilldown', metric, page, debouncedSearch, sortBy, sortOrder],
    queryFn: async () => {
      if (!metric) return null;
      const res = await api.get('/gyms/me/dashboard/drill-down', {
        params: {
          metric,
          page,
          limit: PAGE_SIZE,
          search: debouncedSearch || undefined,
          sortBy,
          sortOrder,
        },
      });
      return res.data;
    },
    enabled: open && !!metric,
    staleTime: 15000,
  });

  const payload = responseData?.data ?? responseData ?? {};
  const rows: any[] = Array.isArray(payload.data)
    ? payload.data
    : Array.isArray(payload)
    ? payload
    : [];
  const total = typeof payload.total === 'number' ? payload.total : rows.length;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const handleNavigateViewAll = () => {
    if (!config) return;
    onOpenChange(false);
    navigate(config.viewAllRoute);
  };

  const handleRowClick = (item: any) => {
    if (
      metric === 'ACTIVE_MEMBERS' ||
      metric === 'INACTIVE_MEMBERS' ||
      metric === 'EXPIRED_MEMBERS'
    ) {
      onOpenChange(false);
      navigate(`/members/${item.id}`);
    } else if (item.member?.id) {
      onOpenChange(false);
      navigate(`/members/${item.member.id}`);
    } else if (metric === 'REVENUE_TODAY' || metric === 'REVENUE_MONTH') {
      onOpenChange(false);
      navigate('/payments');
    }
  };

  const formatDateTime = (dateStr?: string | null) => {
    if (!dateStr) return '—';
    try {
      const d = new Date(dateStr);
      return `${d.toLocaleDateString()} ${d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
    } catch {
      return String(dateStr);
    }
  };

  const formatDateOnly = (dateStr?: string | null) => {
    if (!dateStr) return '—';
    try {
      return new Date(dateStr).toLocaleDateString();
    } catch {
      return String(dateStr);
    }
  };

  const renderContent = () => {
    if (isLoading) {
      return (
        <div className="space-y-2 py-6">
          <div className="flex items-center justify-center py-12 text-muted-foreground gap-2">
            <RefreshCw className="h-5 w-5 animate-spin text-primary" />
            <span>Loading drill-down records...</span>
          </div>
        </div>
      );
    }

    if (isError) {
      return (
        <div className="flex flex-col items-center justify-center py-12 text-center">
          <AlertCircle className="h-10 w-10 text-destructive mb-3" />
          <p className="font-medium text-foreground">Failed to load drill-down records</p>
          <p className="text-sm text-muted-foreground mt-1 mb-4">
            {(error as any)?.response?.data?.message || 'An unexpected error occurred.'}
          </p>
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            <RefreshCw className="h-4 w-4 mr-2" /> Retry
          </Button>
        </div>
      );
    }

    if (!rows.length) {
      return (
        <div className="flex flex-col items-center justify-center py-12 text-center">
          <div className="rounded-full bg-muted p-3 mb-3">
            <Search className="h-6 w-6 text-muted-foreground" />
          </div>
          <p className="font-semibold text-foreground">No records found</p>
          <p className="text-sm text-muted-foreground max-w-sm mt-1">
            {debouncedSearch
              ? `No results matching "${debouncedSearch}". Try a different name, phone, or code.`
              : 'There are currently no active records under this metric.'}
          </p>
        </div>
      );
    }

    return (
      <div className="overflow-x-auto rounded-md border">
        <table className="w-full text-sm">
          <thead className="border-b bg-muted/50 text-left">
            {isMemberMetric(metric) && (
              <tr>
                <th className="p-3 font-medium">Member</th>
                <th className="p-3 font-medium">Contact</th>
                <th className="p-3 font-medium">Status</th>
                <th className="p-3 font-medium">Plan / Batch</th>
                <th className="p-3 font-medium text-right">Action</th>
              </tr>
            )}
            {isAttendanceMetric(metric) && (
              <tr>
                <th className="p-3 font-medium">Member</th>
                <th className="p-3 font-medium">Check-In</th>
                <th className="p-3 font-medium">Check-Out</th>
                <th className="p-3 font-medium">Duration</th>
                <th className="p-3 font-medium text-right">Action</th>
              </tr>
            )}
            {isMembershipMetric(metric) && (
              <tr>
                <th className="p-3 font-medium">Member</th>
                <th className="p-3 font-medium">Plan</th>
                <th className="p-3 font-medium">Period</th>
                <th className="p-3 font-medium">Status</th>
                <th className="p-3 font-medium text-right">Action</th>
              </tr>
            )}
            {isRevenueMetric(metric) && (
              <tr>
                <th className="p-3 font-medium">Date & Time</th>
                <th className="p-3 font-medium">Member</th>
                <th className="p-3 font-medium">Amount</th>
                <th className="p-3 font-medium">Method</th>
                <th className="p-3 font-medium text-right">Action</th>
              </tr>
            )}
          </thead>
          <tbody className="divide-y">
            {rows.map((row: any) => {
              if (isMemberMetric(metric)) {
                const planName = row.currentMembership?.planName || 'No plan';
                const isMemberActive = row.status === 'ACTIVE';
                return (
                  <tr
                    key={row.id}
                    className="hover:bg-muted/40 cursor-pointer transition-colors"
                    onClick={() => handleRowClick(row)}
                  >
                    <td className="p-3 font-medium">
                      <div className="flex flex-col">
                        <span>{row.firstName} {row.lastName}</span>
                        <span className="text-xs text-muted-foreground font-mono">
                          {row.memberCode}
                        </span>
                      </div>
                    </td>
                    <td className="p-3">
                      <div className="flex flex-col text-xs">
                        <span>{row.mobile}</span>
                        {row.email && <span className="text-muted-foreground">{row.email}</span>}
                      </div>
                    </td>
                    <td className="p-3">
                      <Badge variant={isMemberActive ? 'default' : 'secondary'}>
                        {row.status}
                      </Badge>
                    </td>
                    <td className="p-3 text-xs">
                      <div>{planName}</div>
                      {row.batch?.name && (
                        <div className="text-muted-foreground">Batch: {row.batch.name}</div>
                      )}
                    </td>
                    <td className="p-3 text-right">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleRowClick(row);
                        }}
                      >
                        Profile <ArrowRight className="h-3.5 w-3.5 ml-1" />
                      </Button>
                    </td>
                  </tr>
                );
              }

              if (isAttendanceMetric(metric)) {
                const member = row.member;
                return (
                  <tr
                    key={row.id}
                    className="hover:bg-muted/40 cursor-pointer transition-colors"
                    onClick={() => handleRowClick(row)}
                  >
                    <td className="p-3 font-medium">
                      <div className="flex flex-col">
                        <span>{member ? `${member.firstName} ${member.lastName}` : 'Unknown'}</span>
                        {member?.memberCode && (
                          <span className="text-xs text-muted-foreground font-mono">
                            {member.memberCode}
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="p-3 text-xs">
                      <span className="font-mono">{formatDateTime(row.checkInAt)}</span>
                    </td>
                    <td className="p-3 text-xs">
                      {row.checkOutAt ? (
                        <span className="font-mono">{formatDateTime(row.checkOutAt)}</span>
                      ) : (
                        <Badge variant="outline" className="text-amber-600 border-amber-300">
                          In Gym
                        </Badge>
                      )}
                    </td>
                    <td className="p-3 text-xs">
                      {row.durationMinutes != null
                        ? `${row.durationMinutes} min`
                        : row.checkOutAt
                        ? 'Completed'
                        : 'Active now'}
                    </td>
                    <td className="p-3 text-right">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleRowClick(row);
                        }}
                      >
                        Profile <ArrowRight className="h-3.5 w-3.5 ml-1" />
                      </Button>
                    </td>
                  </tr>
                );
              }

              if (isMembershipMetric(metric)) {
                const member = row.member;
                return (
                  <tr
                    key={row.id}
                    className="hover:bg-muted/40 cursor-pointer transition-colors"
                    onClick={() => handleRowClick(row)}
                  >
                    <td className="p-3 font-medium">
                      <div className="flex flex-col">
                        <span>{member ? `${member.firstName} ${member.lastName}` : 'Unknown'}</span>
                        {member?.memberCode && (
                          <span className="text-xs text-muted-foreground font-mono">
                            {member.memberCode}
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="p-3 text-xs font-medium">
                      {row.planName || 'Standard'}
                    </td>
                    <td className="p-3 text-xs">
                      <div className="flex flex-col">
                        <span>End: {formatDateOnly(row.endDate)}</span>
                        <span className="text-muted-foreground text-[11px]">
                          Start: {formatDateOnly(row.startDate)}
                        </span>
                      </div>
                    </td>
                    <td className="p-3">
                      <Badge
                        variant={row.status === 'ACTIVE' ? 'default' : 'secondary'}
                        className={
                          row.status === 'EXPIRED'
                            ? 'bg-red-100 text-red-800'
                            : row.status === 'ACTIVE'
                            ? 'bg-green-100 text-green-800'
                            : ''
                        }
                      >
                        {row.status}
                      </Badge>
                    </td>
                    <td className="p-3 text-right">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleRowClick(row);
                        }}
                      >
                        View <ArrowRight className="h-3.5 w-3.5 ml-1" />
                      </Button>
                    </td>
                  </tr>
                );
              }

              if (isRevenueMetric(metric)) {
                const member = row.member;
                return (
                  <tr
                    key={row.id}
                    className="hover:bg-muted/40 cursor-pointer transition-colors"
                    onClick={() => handleRowClick(row)}
                  >
                    <td className="p-3 text-xs font-mono">
                      {formatDateTime(row.paidAt || row.createdAt)}
                    </td>
                    <td className="p-3 font-medium">
                      {member ? (
                        <div className="flex flex-col">
                          <span>{member.firstName} {member.lastName}</span>
                          <span className="text-xs text-muted-foreground font-mono">
                            {member.memberCode || member.mobile}
                          </span>
                        </div>
                      ) : (
                        <span className="text-muted-foreground">Ad-hoc / Guest</span>
                      )}
                    </td>
                    <td className="p-3 font-bold text-green-600">
                      ₹{Number(row.amount || 0).toLocaleString('en-IN')}
                    </td>
                    <td className="p-3 text-xs">
                      <Badge variant="outline">
                        {row.gateway || row.method || 'CASH'}
                      </Badge>
                    </td>
                    <td className="p-3 text-right">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleRowClick(row);
                        }}
                      >
                        Details <ArrowRight className="h-3.5 w-3.5 ml-1" />
                      </Button>
                    </td>
                  </tr>
                );
              }

              return null;
            })}
          </tbody>
        </table>
      </div>
    );
  };

  if (!config) return null;
  const Icon = config.icon;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[85vh] flex flex-col">
        <DialogHeader className="pb-2 border-b">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="rounded-md bg-primary/10 p-2 text-primary">
                <Icon className="h-5 w-5" />
              </div>
              <div>
                <DialogTitle className="text-xl font-bold flex items-center gap-2">
                  <span>{config.title}</span>
                  {!isLoading && (
                    <Badge variant="secondary" className="font-mono text-xs">
                      {total} {total === 1 ? 'record' : 'records'}
                    </Badge>
                  )}
                </DialogTitle>
                <DialogDescription className="text-xs text-muted-foreground mt-0.5">
                  {config.description}
                </DialogDescription>
              </div>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={handleNavigateViewAll}
              className="hidden sm:inline-flex"
            >
              <ExternalLink className="h-4 w-4 mr-1.5" />
              {config.viewAllLabel}
            </Button>
          </div>
        </DialogHeader>

        {/* Search Toolbar */}
        <div className="flex items-center gap-3 pt-3">
          <div className="relative flex-1">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search by name, mobile, code..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-8 text-sm"
            />
          </div>
          {isFetching && !isLoading && (
            <RefreshCw className="h-4 w-4 animate-spin text-muted-foreground shrink-0" />
          )}
        </div>

        {/* Drilldown Table Content */}
        <div className="flex-1 overflow-y-auto py-2">
          {renderContent()}
        </div>

        {/* Footer with Pagination and View All button */}
        <div className="flex items-center justify-between pt-3 border-t text-sm text-muted-foreground">
          <div className="text-xs">
            {total > 0 ? (
              <>
                Showing {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, total)} of {total}
              </>
            ) : (
              '0 records'
            )}
          </div>

          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page <= 1 || isLoading}
            >
              <ChevronLeft className="h-4 w-4 mr-1" /> Prev
            </Button>
            <span className="text-xs font-medium px-1">
              Page {page} of {totalPages}
            </span>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page >= totalPages || isLoading}
            >
              Next <ChevronRight className="h-4 w-4 ml-1" />
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function isMemberMetric(metric: DashboardDrillMetric | null): boolean {
  return (
    metric === 'ACTIVE_MEMBERS' ||
    metric === 'INACTIVE_MEMBERS' ||
    metric === 'EXPIRED_MEMBERS'
  );
}

function isAttendanceMetric(metric: DashboardDrillMetric | null): boolean {
  return (
    metric === 'CHECKINS_TODAY' ||
    metric === 'CHECKOUTS_TODAY' ||
    metric === 'CURRENTLY_IN_GYM'
  );
}

function isMembershipMetric(metric: DashboardDrillMetric | null): boolean {
  return (
    metric === 'EXPIRING_SOON' ||
    metric === 'EXPIRED_MEMBERSHIPS'
  );
}

function isRevenueMetric(metric: DashboardDrillMetric | null): boolean {
  return (
    metric === 'REVENUE_TODAY' ||
    metric === 'REVENUE_MONTH'
  );
}
