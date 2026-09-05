import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { LifeBuoy, Plus } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/hooks/use-toast';
import api from '@services/api';
import { apiErrorMessage } from '@/lib/api-error';

type TicketStatus = 'OPEN' | 'IN_PROGRESS' | 'RESOLVED' | 'CLOSED' | 'ESCALATED';
type TicketPriority = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';

interface Ticket {
  id: string;
  ticketNumber: string;
  title: string;
  description: string;
  status: TicketStatus;
  priority: TicketPriority;
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
  const [showForm, setShowForm] = useState(false);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [priority, setPriority] = useState<TicketPriority>('MEDIUM');

  const { data, isLoading } = useQuery<Ticket[]>({
    queryKey: ['support-tickets', 'mine'],
    queryFn: async () => (await api.get('/support-tickets/mine')).data,
  });

  const createMutation = useMutation({
    mutationFn: () => api.post('/support-tickets', { title, description, priority }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['support-tickets', 'mine'] });
      toast({ title: 'Ticket raised', description: 'Our team will get back to you soon.' });
      setTitle('');
      setDescription('');
      setPriority('MEDIUM');
      setShowForm(false);
    },
    onError: (e: unknown) => toast({ title: 'Failed', description: apiErrorMessage(e), variant: 'destructive' }),
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (title.trim().length < 4 || description.trim().length < 10) {
      toast({ title: 'Fill both fields', description: 'Description needs at least 10 characters.', variant: 'destructive' });
      return;
    }
    createMutation.mutate();
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold tracking-tight flex items-center gap-2">
            <LifeBuoy className="h-5 w-5" /> Support
          </h1>
          <p className="text-sm text-muted-foreground">Raise a ticket or check on ones you've already sent.</p>
        </div>
        <Button onClick={() => setShowForm((s) => !s)} size="sm">
          <Plus className="h-4 w-4 mr-1" /> New Ticket
        </Button>
      </div>

      {showForm && (
        <Card>
          <CardHeader><CardTitle className="text-base">Raise a Ticket</CardTitle></CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-3">
              <Input
                placeholder="Subject (e.g. QR code not scanning)"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
              />
              <Textarea
                placeholder="Describe the issue in detail..."
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={4}
              />
              <select
                value={priority}
                onChange={(e) => setPriority(e.target.value as TicketPriority)}
                className="rounded-md border border-input bg-background px-3 py-2 text-sm w-full sm:w-auto"
              >
                {(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'] as TicketPriority[]).map((p) => (
                  <option key={p} value={p}>{p}</option>
                ))}
              </select>
              <Button type="submit" disabled={createMutation.isPending}>
                {createMutation.isPending ? 'Submitting…' : 'Submit Ticket'}
              </Button>
            </form>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader><CardTitle className="text-base">Your Tickets</CardTitle></CardHeader>
        <CardContent className="divide-y">
          {isLoading && <p className="py-6 text-sm text-muted-foreground text-center">Loading…</p>}
          {!isLoading && (!data || data.length === 0) && (
            <p className="py-6 text-sm text-muted-foreground text-center">No tickets raised yet.</p>
          )}
          {data?.map((ticket) => (
            <div key={ticket.id} className="py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="font-medium truncate">{ticket.title}</p>
                <p className="text-xs text-muted-foreground">
                  {ticket.ticketNumber} · {new Date(ticket.createdAt).toLocaleDateString()}
                </p>
              </div>
              <div className="flex items-center gap-2 flex-wrap shrink-0">
                <Badge className={priorityColor[ticket.priority]}>{ticket.priority}</Badge>
                <Badge className={statusColor[ticket.status]}>{ticket.status}</Badge>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
