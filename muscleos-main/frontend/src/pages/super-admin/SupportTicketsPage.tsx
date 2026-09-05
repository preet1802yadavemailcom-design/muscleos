import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { LifeBuoy } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useToast } from '@/hooks/use-toast';
import api from '@services/api';
import { apiErrorMessage } from '@/lib/api-error';

type TicketStatus = 'OPEN' | 'IN_PROGRESS' | 'RESOLVED' | 'CLOSED' | 'ESCALATED';
type TicketPriority = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';

interface Ticket {
  id: string;
  subject: string;
  status: TicketStatus;
  priority: TicketPriority;
  gym?: { name: string } | null;
  createdAt: string;
}

const statusColor: Record<TicketStatus, string> = {
  OPEN: 'bg-amber-100 text-amber-800',
  IN_PROGRESS: 'bg-blue-100 text-blue-800',
  RESOLVED: 'bg-green-100 text-green-800',
  CLOSED: 'bg-gray-100 text-gray-800',
  ESCALATED: 'bg-red-100 text-red-800',
};

const priorityColor: Record<TicketPriority, string> = {
  LOW: 'bg-gray-100 text-gray-700',
  MEDIUM: 'bg-blue-100 text-blue-700',
  HIGH: 'bg-amber-100 text-amber-800',
  CRITICAL: 'bg-red-100 text-red-800',
};

export function SupportTicketsPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [statusFilter, setStatusFilter] = useState<TicketStatus | 'ALL'>('OPEN');

  const { data, isLoading } = useQuery<{ data: Ticket[] }>({
    queryKey: ['super-admin', 'tickets', statusFilter],
    queryFn: async () => (await api.get('/super-admin/tickets', {
      params: statusFilter === 'ALL' ? {} : { status: statusFilter },
    })).data,
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, status }: { id: string; status: TicketStatus }) => api.put(`/super-admin/tickets/${id}`, { status }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['super-admin', 'tickets'] });
      toast({ title: 'Ticket updated' });
    },
    onError: (e: unknown) => toast({ title: 'Failed', description: apiErrorMessage(e), variant: 'destructive' }),
  });

  const statusOptions: Array<TicketStatus | 'ALL'> = ['ALL', 'OPEN', 'IN_PROGRESS', 'ESCALATED', 'RESOLVED', 'CLOSED'];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl sm:text-2xl font-bold tracking-tight flex items-center gap-2">
          <LifeBuoy className="h-5 w-5" /> Support Tickets
        </h1>
        <p className="text-sm text-muted-foreground">Requests from gym owners across the platform.</p>
      </div>

      <div className="flex gap-2 flex-wrap">
        {statusOptions.map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => setStatusFilter(s)}
            className={`rounded-full px-3 py-1 text-xs font-medium border transition-colors ${
              statusFilter === s ? 'bg-primary text-primary-foreground border-primary' : 'border-input text-muted-foreground'
            }`}
          >
            {s}
          </button>
        ))}
      </div>

      <Card>
        <CardHeader><CardTitle className="text-base">Tickets</CardTitle></CardHeader>
        <CardContent className="divide-y">
          {isLoading && <p className="py-6 text-sm text-muted-foreground text-center">Loading…</p>}
          {!isLoading && (!data?.data || data.data.length === 0) && (
            <p className="py-6 text-sm text-muted-foreground text-center">No tickets here.</p>
          )}
          {data?.data?.map((ticket) => (
            <div key={ticket.id} className="py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="font-medium truncate">{ticket.subject}</p>
                <p className="text-xs text-muted-foreground">
                  {ticket.gym?.name ?? 'Unknown org'} · {new Date(ticket.createdAt).toLocaleDateString()}
                </p>
              </div>
              <div className="flex items-center gap-2 flex-wrap shrink-0">
                <Badge className={priorityColor[ticket.priority]}>{ticket.priority}</Badge>
                <select
                  value={ticket.status}
                  onChange={(e) => updateMutation.mutate({ id: ticket.id, status: e.target.value as TicketStatus })}
                  className={`rounded-md border-0 px-2 py-1 text-xs font-medium ${statusColor[ticket.status]}`}
                >
                  {(['OPEN', 'IN_PROGRESS', 'ESCALATED', 'RESOLVED', 'CLOSED'] as TicketStatus[]).map((s) => (
                    <option key={s} value={s}>{s}</option>
                  ))}
                </select>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
