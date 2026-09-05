import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CreditCard, Plus, Trash2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogTrigger,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/hooks/use-toast';
import api from '@services/api';
import { apiErrorMessage } from '@/lib/api-error';

interface GymPlan {
  id: string;
  name: string;
  type: string;
  monthlyPrice: number;
  yearlyPrice: number;
  maxMembers?: number | null;
  isActive: boolean;
}

export function PlansPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ name: '', type: 'BASIC', monthlyPrice: '', yearlyPrice: '', maxMembers: '' });

  const { data, isLoading } = useQuery<GymPlan[]>({
    queryKey: ['super-admin', 'plans'],
    queryFn: async () => (await api.get('/super-admin/plans')).data,
  });

  const createMutation = useMutation({
    mutationFn: () => api.post('/super-admin/plans', {
      name: form.name,
      type: form.type,
      monthlyPrice: Number(form.monthlyPrice),
      yearlyPrice: Number(form.yearlyPrice),
      maxMembers: form.maxMembers ? Number(form.maxMembers) : undefined,
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['super-admin', 'plans'] });
      toast({ title: 'Plan created' });
      setOpen(false);
      setForm({ name: '', type: 'BASIC', monthlyPrice: '', yearlyPrice: '', maxMembers: '' });
    },
    onError: (e: unknown) => toast({ title: 'Failed to create plan', description: apiErrorMessage(e), variant: 'destructive' }),
  });

  const deactivateMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/super-admin/plans/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['super-admin', 'plans'] });
      toast({ title: 'Plan deactivated' });
    },
    onError: (e: unknown) => toast({ title: 'Failed', description: apiErrorMessage(e), variant: 'destructive' }),
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold tracking-tight flex items-center gap-2">
            <CreditCard className="h-5 w-5" /> Platform Plans
          </h1>
          <p className="text-sm text-muted-foreground">SaaS plans that Gym Owners subscribe to.</p>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button size="sm" className="gap-1"><Plus className="h-4 w-4" /> New Plan</Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-sm">
            <DialogHeader><DialogTitle>New Plan</DialogTitle></DialogHeader>
            <div className="space-y-3">
              <div>
                <Label htmlFor="plan-name">Name</Label>
                <Input id="plan-name" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <Label htmlFor="plan-monthly">Monthly price (₹)</Label>
                  <Input id="plan-monthly" type="number" value={form.monthlyPrice} onChange={(e) => setForm((f) => ({ ...f, monthlyPrice: e.target.value }))} />
                </div>
                <div>
                  <Label htmlFor="plan-yearly">Yearly price (₹)</Label>
                  <Input id="plan-yearly" type="number" value={form.yearlyPrice} onChange={(e) => setForm((f) => ({ ...f, yearlyPrice: e.target.value }))} />
                </div>
              </div>
              <div>
                <Label htmlFor="plan-max-members">Max members (optional)</Label>
                <Input id="plan-max-members" type="number" value={form.maxMembers} onChange={(e) => setForm((f) => ({ ...f, maxMembers: e.target.value }))} />
              </div>
            </div>
            <DialogFooter>
              <Button
                onClick={() => createMutation.mutate()}
                disabled={!form.name || !form.monthlyPrice || !form.yearlyPrice || createMutation.isPending}
              >
                {createMutation.isPending ? 'Creating…' : 'Create'}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      <Card>
        <CardContent className="divide-y pt-6">
          {isLoading && <p className="py-6 text-sm text-muted-foreground text-center">Loading…</p>}
          {!isLoading && (!data || data.length === 0) && (
            <p className="py-6 text-sm text-muted-foreground text-center">No plans yet — create one above.</p>
          )}
          {data?.map((plan) => (
            <div key={plan.id} className="py-3 flex items-center justify-between gap-4">
              <div className="min-w-0">
                <p className="font-medium truncate">{plan.name}</p>
                <p className="text-xs text-muted-foreground">
                  ₹{plan.monthlyPrice}/mo · ₹{plan.yearlyPrice}/yr {plan.maxMembers ? `· up to ${plan.maxMembers} members` : ''}
                </p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <Badge variant={plan.isActive ? 'success' : 'secondary'}>{plan.isActive ? 'Active' : 'Inactive'}</Badge>
                {plan.isActive && (
                  <Button size="icon" variant="ghost" onClick={() => deactivateMutation.mutate(plan.id)} aria-label="Deactivate plan">
                    <Trash2 className="h-4 w-4" />
                  </Button>
                )}
              </div>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
