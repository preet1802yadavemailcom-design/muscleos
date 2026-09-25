import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Building2, MapPin, Mail, Phone, Calendar, Users, DollarSign,
  Clock, Shield, User, FileText, CheckCircle2, XCircle, AlertTriangle,
  ExternalLink, RefreshCw, AlertCircle
} from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { superAdminApi, Gym } from '@/services/super-admin.api';

interface GymDetailsDialogProps {
  gymId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onApprove?: (gym: Gym) => void;
  onReject?: (gym: Gym) => void;
  onSuspend?: (gym: Gym) => void;
  onReactivate?: (gym: Gym) => void;
}

export function GymDetailsDialog({
  gymId,
  open,
  onOpenChange,
  onApprove,
  onReject,
  onSuspend,
  onReactivate,
}: GymDetailsDialogProps) {
  const [activeTab, setActiveTab] = useState<'overview' | 'owner' | 'batches' | 'legal'>('overview');

  const { data: gym, isLoading, isError, refetch } = useQuery({
    queryKey: ['super-admin', 'gym-detail', gymId],
    queryFn: () => (gymId ? superAdminApi.getGym(gymId) : null),
    enabled: open && !!gymId,
  });

  const owner = gym?.owner || gym?.users?.find((u) => u.role === 'GYM_OWNER');
  const staff = gym?.users?.filter((u) => u.role !== 'GYM_OWNER') || [];
  const batches = gym?.batches || [];
  const stats = gym?.stats || {
    totalMembers: gym?._count?.members ?? 0,
    activeMembers: gym?._count?.members ?? 0,
    inactiveMembers: 0,
    totalBatches: gym?._count?.batches ?? 0,
    totalStaff: gym?._count?.users ?? 0,
    totalRevenue: 0,
    checkInsToday: 0,
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[88vh] flex flex-col p-0 gap-0 overflow-hidden">
        {/* Header */}
        <DialogHeader className="p-6 pb-4 border-b bg-card">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="p-2.5 rounded-xl bg-primary/10 text-primary shrink-0">
                <Building2 className="h-6 w-6" />
              </div>
              <div>
                <DialogTitle className="text-xl font-bold flex items-center gap-2 flex-wrap">
                  {gym?.name || 'Gym Details'}
                  {gym && (
                    <>
                      <Badge
                        variant={
                          gym.status === 'ACTIVE'
                            ? 'default'
                            : gym.status === 'PENDING'
                            ? 'secondary'
                            : 'destructive'
                        }
                        className="text-xs"
                      >
                        {gym.status}
                      </Badge>
                      <Badge variant="outline" className="text-xs font-mono">
                        {gym.planType || 'TRIAL'}
                      </Badge>
                    </>
                  )}
                </DialogTitle>
                <DialogDescription className="text-xs text-muted-foreground mt-0.5 flex items-center gap-2">
                  <span>Slug: <strong className="font-mono text-foreground">{gym?.slug || '—'}</strong></span>
                  {gym?.city && <span>• {gym.city}, {gym.state || 'India'}</span>}
                </DialogDescription>
              </div>
            </div>

            {gym?.slug && (
              <a
                href={`/gym/${gym.slug}`}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1.5 text-xs text-primary hover:underline self-start sm:self-auto"
              >
                Public Profile
                <ExternalLink className="h-3 w-3" />
              </a>
            )}
          </div>

          {/* Quick Stats Banner */}
          {gym && (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-4 pt-3 border-t">
              <div className="bg-muted/40 p-2.5 rounded-lg">
                <div className="text-[11px] text-muted-foreground flex items-center gap-1">
                  <Users className="h-3 w-3" /> Total Members
                </div>
                <div className="text-base font-bold text-foreground mt-0.5">
                  {stats.totalMembers}
                  <span className="text-[11px] text-muted-foreground font-normal ml-1">
                    ({stats.activeMembers} active)
                  </span>
                </div>
              </div>

              <div className="bg-muted/40 p-2.5 rounded-lg">
                <div className="text-[11px] text-muted-foreground flex items-center gap-1">
                  <Clock className="h-3 w-3" /> Batches
                </div>
                <div className="text-base font-bold text-foreground mt-0.5">
                  {stats.totalBatches}
                </div>
              </div>

              <div className="bg-muted/40 p-2.5 rounded-lg">
                <div className="text-[11px] text-muted-foreground flex items-center gap-1">
                  <User className="h-3 w-3" /> Staff / Trainers
                </div>
                <div className="text-base font-bold text-foreground mt-0.5">
                  {stats.totalStaff}
                </div>
              </div>

              <div className="bg-muted/40 p-2.5 rounded-lg">
                <div className="text-[11px] text-muted-foreground flex items-center gap-1">
                  <DollarSign className="h-3 w-3" /> Revenue
                </div>
                <div className="text-base font-bold text-foreground mt-0.5">
                  ₹{stats.totalRevenue.toLocaleString('en-IN')}
                </div>
              </div>
            </div>
          )}

          {/* Navigation Tabs */}
          <div className="flex gap-1 border-b -mb-4 mt-4 pt-1">
            <button
              onClick={() => setActiveTab('overview')}
              className={`px-3 py-1.5 text-xs font-semibold border-b-2 transition-colors ${
                activeTab === 'overview'
                  ? 'border-primary text-primary'
                  : 'border-transparent text-muted-foreground hover:text-foreground'
              }`}
            >
              Overview & Location
            </button>
            <button
              onClick={() => setActiveTab('owner')}
              className={`px-3 py-1.5 text-xs font-semibold border-b-2 transition-colors ${
                activeTab === 'owner'
                  ? 'border-primary text-primary'
                  : 'border-transparent text-muted-foreground hover:text-foreground'
              }`}
            >
              Owner & Staff ({staff.length + (owner ? 1 : 0)})
            </button>
            <button
              onClick={() => setActiveTab('batches')}
              className={`px-3 py-1.5 text-xs font-semibold border-b-2 transition-colors ${
                activeTab === 'batches'
                  ? 'border-primary text-primary'
                  : 'border-transparent text-muted-foreground hover:text-foreground'
              }`}
            >
              Batches ({batches.length})
            </button>
            <button
              onClick={() => setActiveTab('legal')}
              className={`px-3 py-1.5 text-xs font-semibold border-b-2 transition-colors ${
                activeTab === 'legal'
                  ? 'border-primary text-primary'
                  : 'border-transparent text-muted-foreground hover:text-foreground'
              }`}
            >
              Business & Legal
            </button>
          </div>
        </DialogHeader>

        {/* Content Body */}
        <div className="flex-1 overflow-y-auto p-6">
          {isLoading ? (
            <div className="flex flex-col items-center justify-center py-16 gap-3 text-muted-foreground">
              <RefreshCw className="h-7 w-7 animate-spin text-primary" />
              <p className="text-sm">Loading complete gym profile...</p>
            </div>
          ) : isError || !gym ? (
            <div className="flex flex-col items-center justify-center py-16 gap-3 text-destructive">
              <AlertCircle className="h-8 w-8" />
              <p className="text-sm font-medium">Failed to load gym details</p>
              <Button variant="outline" size="sm" onClick={() => refetch()}>
                Retry
              </Button>
            </div>
          ) : (
            <div className="space-y-6">
              {/* TAB 1: OVERVIEW & LOCATION */}
              {activeTab === 'overview' && (
                <div className="grid gap-4 sm:grid-cols-2">
                  {/* Location Card */}
                  <div className="border rounded-xl p-4 bg-card space-y-3">
                    <h4 className="font-semibold text-sm flex items-center gap-1.5 text-primary">
                      <MapPin className="h-4 w-4" /> Location & Address
                    </h4>
                    <div className="text-sm space-y-2">
                      <div>
                        <div className="text-xs text-muted-foreground">Street Address</div>
                        <div className="font-medium text-foreground">{gym.address || 'Not provided'}</div>
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <div className="text-xs text-muted-foreground">City</div>
                          <div className="font-medium text-foreground">{gym.city || '—'}</div>
                        </div>
                        <div>
                          <div className="text-xs text-muted-foreground">State</div>
                          <div className="font-medium text-foreground">{gym.state || '—'}</div>
                        </div>
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <div className="text-xs text-muted-foreground">Pincode</div>
                          <div className="font-medium text-foreground font-mono">{gym.pincode || '—'}</div>
                        </div>
                        <div>
                          <div className="text-xs text-muted-foreground">Country</div>
                          <div className="font-medium text-foreground">{gym.country || 'India'}</div>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Contact Card */}
                  <div className="border rounded-xl p-4 bg-card space-y-3">
                    <h4 className="font-semibold text-sm flex items-center gap-1.5 text-primary">
                      <Phone className="h-4 w-4" /> Official Gym Contact
                    </h4>
                    <div className="text-sm space-y-2">
                      <div>
                        <div className="text-xs text-muted-foreground">Email Address</div>
                        <a
                          href={`mailto:${gym.email}`}
                          className="font-medium text-foreground hover:text-primary transition-colors flex items-center gap-1"
                        >
                          <Mail className="h-3.5 w-3.5 text-muted-foreground" />
                          {gym.email}
                        </a>
                      </div>
                      <div>
                        <div className="text-xs text-muted-foreground">Phone Number</div>
                        <a
                          href={`tel:${gym.phone}`}
                          className="font-medium text-foreground hover:text-primary transition-colors flex items-center gap-1"
                        >
                          <Phone className="h-3.5 w-3.5 text-muted-foreground" />
                          {gym.phone || '—'}
                        </a>
                      </div>
                      <div>
                        <div className="text-xs text-muted-foreground">Onboarded Since</div>
                        <div className="font-medium text-foreground flex items-center gap-1">
                          <Calendar className="h-3.5 w-3.5 text-muted-foreground" />
                          {new Date(gym.createdAt).toLocaleDateString('en-IN', {
                            day: 'numeric',
                            month: 'short',
                            year: 'numeric',
                          })}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* TAB 2: OWNER & STAFF */}
              {activeTab === 'owner' && (
                <div className="space-y-4">
                  {/* Owner Card */}
                  <div className="border rounded-xl p-4 bg-card">
                    <h4 className="font-semibold text-sm flex items-center gap-1.5 text-primary mb-3">
                      <Shield className="h-4 w-4" /> Gym Owner Profile
                    </h4>
                    {owner ? (
                      <div className="grid sm:grid-cols-2 gap-3 text-sm">
                        <div>
                          <div className="text-xs text-muted-foreground">Owner Name</div>
                          <div className="font-bold text-foreground text-base">
                            {owner.firstName} {owner.lastName}
                          </div>
                          <div className="text-xs text-muted-foreground mt-0.5">
                            Status: <Badge variant="outline" className="text-[10px]">{owner.status || 'ACTIVE'}</Badge>
                          </div>
                        </div>

                        <div className="space-y-1">
                          <div>
                            <span className="text-xs text-muted-foreground">Mobile: </span>
                            {owner.phone ? (
                              <a href={`tel:${owner.phone}`} className="font-medium text-foreground hover:text-primary">
                                {owner.phone}
                              </a>
                            ) : (
                              '—'
                            )}
                          </div>
                          <div>
                            <span className="text-xs text-muted-foreground">Email: </span>
                            <a href={`mailto:${owner.email}`} className="font-medium text-foreground hover:text-primary">
                              {owner.email}
                            </a>
                          </div>
                        </div>
                      </div>
                    ) : (
                      <p className="text-xs text-muted-foreground">No gym owner account linked yet.</p>
                    )}
                  </div>

                  {/* Staff List */}
                  <div className="border rounded-xl p-4 bg-card">
                    <h4 className="font-semibold text-sm flex items-center gap-1.5 text-foreground mb-3">
                      <Users className="h-4 w-4" /> Other Staff & Trainers ({staff.length})
                    </h4>
                    {staff.length === 0 ? (
                      <p className="text-xs text-muted-foreground py-2">No other staff members found.</p>
                    ) : (
                      <div className="divide-y divide-border">
                        {staff.map((s) => (
                          <div key={s.id} className="py-2.5 flex items-center justify-between text-sm">
                            <div>
                              <div className="font-medium text-foreground">
                                {s.firstName} {s.lastName}
                              </div>
                              <div className="text-xs text-muted-foreground">
                                {s.phone || s.email}
                              </div>
                            </div>
                            <div className="flex items-center gap-2">
                              <Badge variant="secondary" className="text-xs">
                                {s.role}
                              </Badge>
                              <Badge variant="outline" className="text-xs">
                                {s.status}
                              </Badge>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* TAB 3: BATCHES */}
              {activeTab === 'batches' && (
                <div className="border rounded-xl overflow-hidden bg-card">
                  <div className="p-4 border-b">
                    <h4 className="font-semibold text-sm text-foreground flex items-center gap-1.5">
                      <Clock className="h-4 w-4 text-primary" /> Training Batches Schedule ({batches.length})
                    </h4>
                  </div>
                  {batches.length === 0 ? (
                    <div className="p-8 text-center text-sm text-muted-foreground">
                      No training batches created in this gym yet.
                    </div>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="border-b bg-muted/40 text-left text-xs uppercase text-muted-foreground">
                            <th className="py-2.5 px-4">Batch Name</th>
                            <th className="py-2.5 px-4">Timings</th>
                            <th className="py-2.5 px-4">Schedule Days</th>
                            <th className="py-2.5 px-4">Enrolled / Capacity</th>
                            <th className="py-2.5 px-4">Status</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-border">
                          {batches.map((b) => (
                            <tr key={b.id} className="hover:bg-muted/30">
                              <td className="py-3 px-4 font-semibold text-foreground">
                                {b.name}
                              </td>
                              <td className="py-3 px-4 font-mono text-xs text-muted-foreground">
                                {b.startTime && b.endTime ? `${b.startTime} - ${b.endTime}` : 'Flexible'}
                              </td>
                              <td className="py-3 px-4 text-xs text-muted-foreground">
                                {Array.isArray(b.days) && b.days.length > 0 ? b.days.join(', ') : 'All Days'}
                              </td>
                              <td className="py-3 px-4 font-medium">
                                <span className="text-foreground">{b._count?.members ?? 0}</span>
                                <span className="text-xs text-muted-foreground font-normal"> / {b.capacity || 'Unlimited'}</span>
                              </td>
                              <td className="py-3 px-4">
                                <Badge variant={b.status === 'ACTIVE' ? 'default' : 'secondary'} className="text-xs">
                                  {b.status || 'ACTIVE'}
                                </Badge>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              )}

              {/* TAB 4: LEGAL & BUSINESS */}
              {activeTab === 'legal' && (
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="border rounded-xl p-4 bg-card space-y-3">
                    <h4 className="font-semibold text-sm flex items-center gap-1.5 text-primary">
                      <FileText className="h-4 w-4" /> Tax & Business Registration
                    </h4>
                    <div className="text-sm space-y-2.5">
                      <div>
                        <div className="text-xs text-muted-foreground">Registered Business Name</div>
                        <div className="font-medium text-foreground">{gym.businessName || gym.name}</div>
                      </div>
                      <div>
                        <div className="text-xs text-muted-foreground">GSTIN (Goods & Services Tax)</div>
                        <div className="font-mono font-medium text-foreground">
                          {gym.gstNumber || 'Not Registered / Exemption'}
                        </div>
                      </div>
                      <div>
                        <div className="text-xs text-muted-foreground">Permanent Account Number (PAN)</div>
                        <div className="font-mono font-medium text-foreground">
                          {gym.panNumber || '—'}
                        </div>
                      </div>
                      <div>
                        <div className="text-xs text-muted-foreground">Business Registration / CIN</div>
                        <div className="font-mono font-medium text-foreground">
                          {gym.registrationNumber || '—'}
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="border rounded-xl p-4 bg-card space-y-3">
                    <h4 className="font-semibold text-sm flex items-center gap-1.5 text-primary">
                      <Shield className="h-4 w-4" /> Platform SaaS Subscription
                    </h4>
                    <div className="text-sm space-y-2.5">
                      <div>
                        <div className="text-xs text-muted-foreground">Current Plan Tier</div>
                        <div className="font-bold text-foreground">{gym.planType || 'TRIAL'}</div>
                      </div>
                      <div>
                        <div className="text-xs text-muted-foreground">Plan Expiry Date</div>
                        <div className="font-medium text-foreground">
                          {gym.planExpiry
                            ? new Date(gym.planExpiry).toLocaleDateString('en-IN', {
                                day: 'numeric',
                                month: 'short',
                                year: 'numeric',
                              })
                            : 'Active Continuous Access'}
                        </div>
                      </div>
                      <div>
                        <div className="text-xs text-muted-foreground">Total Payments Processed</div>
                        <div className="font-bold text-foreground">
                          ₹{stats.totalRevenue.toLocaleString('en-IN')}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer Actions */}
        <div className="p-4 border-t bg-card flex items-center justify-between gap-2">
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>
            Close
          </Button>

          {gym && (
            <div className="flex items-center gap-2">
              {gym.status === 'PENDING' && onApprove && (
                <Button
                  size="sm"
                  onClick={() => {
                    onApprove(gym);
                    onOpenChange(false);
                  }}
                  className="gap-1.5"
                >
                  <CheckCircle2 className="h-4 w-4" /> Approve Gym
                </Button>
              )}
              {gym.status === 'PENDING' && onReject && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    onReject(gym);
                    onOpenChange(false);
                  }}
                  className="gap-1.5 text-destructive"
                >
                  <XCircle className="h-4 w-4" /> Reject Gym
                </Button>
              )}
              {gym.status === 'ACTIVE' && onSuspend && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    onSuspend(gym);
                    onOpenChange(false);
                  }}
                  className="gap-1.5 text-destructive"
                >
                  <AlertTriangle className="h-4 w-4" /> Suspend Gym
                </Button>
              )}
              {gym.status === 'SUSPENDED' && onReactivate && (
                <Button
                  size="sm"
                  onClick={() => {
                    onReactivate(gym);
                    onOpenChange(false);
                  }}
                  className="gap-1.5"
                >
                  <RefreshCw className="h-4 w-4" /> Reactivate Gym
                </Button>
              )}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
