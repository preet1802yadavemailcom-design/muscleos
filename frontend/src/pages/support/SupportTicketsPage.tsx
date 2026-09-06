import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { LifeBuoy, Plus, Mail, Clock, CheckCircle2, ShieldCheck } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
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
  const [createdTicket, setCreatedTicket] = useState<{ ticketNumber: string; supportEmail?: string } | null>(null);

  const { data: supportInfoRes } = useQuery({
    queryKey: ['support-info'],
    queryFn: async () => {
      const res = await api.get('/support-tickets/info');
      return res.data?.data ?? res.data;
    },
  });
  const supportEmail = supportInfoRes?.supportEmail || 'muscleos021@gmail.com';

  const { data: ticketsRes, isLoading } = useQuery<Ticket[]>({
    queryKey: ['support-tickets', 'mine'],
    queryFn: async () => {
      const res = await api.get('/support-tickets/mine');
      return res.data?.data ?? res.data ?? [];
    },
  });
  const tickets: Ticket[] = Array.isArray(ticketsRes) ? ticketsRes : [];

  const createMutation = useMutation({
    mutationFn: () => api.post('/support-tickets', { title, description, priority }),
    onSuccess: (res: any) => {
      const resData = res.data?.data ?? res.data;
      queryClient.invalidateQueries({ queryKey: ['support-tickets', 'mine'] });
      toast({ title: 'Ticket submitted', description: `Ticket #${resData?.ticketNumber || ''} created.` });
      setCreatedTicket({
        ticketNumber: resData?.ticketNumber || 'Confirmed',
        supportEmail: resData?.supportEmail || supportEmail,
      });
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
            <LifeBuoy className="h-6 w-6 text-primary" /> MuscleOS Help & Support
          </h1>
          <p className="text-sm text-muted-foreground">Raise support requests, track resolution progress, or reach our technical desk.</p>
        </div>
        <Button onClick={() => setShowForm((s) => !s)} size="sm">
          <Plus className="h-4 w-4 mr-1" /> New Support Ticket
        </Button>
      </div>

      {/* SLA & Contact Banner */}
      <div className="rounded-xl border bg-gradient-to-r from-primary/10 via-primary/5 to-background p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4 shadow-sm">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <ShieldCheck className="h-5 w-5 text-primary" />
            <h3 className="font-semibold text-sm">Official MuscleOS Helpdesk</h3>
            <Badge variant="outline" className="text-[10px] bg-background">SLA: &lt; 24h Response</Badge>
          </div>
          <p className="text-xs text-muted-foreground">
            All tickets are assigned to our dedicated technical and billing engineering teams with guaranteed 24-hour first response.
          </p>
        </div>
        <div className="flex items-center gap-4 text-xs font-mono shrink-0">
          <div className="flex items-center gap-1.5 rounded-lg border bg-background px-3 py-2 shadow-xs">
            <Mail className="h-4 w-4 text-primary shrink-0" />
            <a href={`mailto:${supportEmail}`} className="text-primary hover:underline font-medium">
              {supportEmail}
            </a>
          </div>
          <div className="hidden md:flex items-center gap-1.5 text-muted-foreground">
            <Clock className="h-4 w-4 shrink-0" />
            <span>Mon–Sat 9AM–8PM IST</span>
          </div>
        </div>
      </div>

      {/* Instant Ticket Confirmation Banner */}
      {createdTicket && (
        <Card className="border-green-500/40 bg-green-500/5">
          <CardContent className="p-4 flex items-start justify-between gap-3">
            <div className="flex items-start gap-3">
              <CheckCircle2 className="h-5 w-5 text-green-600 shrink-0 mt-0.5" />
              <div className="space-y-0.5">
                <p className="font-semibold text-sm text-green-900 dark:text-green-300">
                  Ticket #{createdTicket.ticketNumber} Raised Successfully
                </p>
                <p className="text-xs text-muted-foreground">
                  Our engineering support team has received your ticket. First response SLA: <strong>within 24 hours</strong>.
                  For urgent operational escalations, you can also write to <span className="font-mono text-primary">{createdTicket.supportEmail}</span> referencing your ticket number.
                </p>
              </div>
            </div>
            <Button variant="ghost" size="sm" onClick={() => setCreatedTicket(null)} className="h-7 text-xs shrink-0">
              Dismiss
            </Button>
          </CardContent>
        </Card>
      )}

      {showForm && (
        <Card className="border-primary/40 shadow-sm">
          <CardHeader><CardTitle className="text-base">Raise a Support Ticket</CardTitle></CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-3 max-w-xl">
              <div>
                <label className="text-xs font-medium text-muted-foreground">Subject</label>
                <Input
                  placeholder="e.g. QR scanner not recognizing camera stream"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  className="mt-1"
                />
              </div>

              <div>
                <label className="text-xs font-medium text-muted-foreground">Detailed Description</label>
                <Textarea
                  placeholder="Please describe what occurred, device model, or error message (min 10 chars)..."
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  rows={4}
                  className="mt-1"
                />
              </div>

              <div className="flex flex-col sm:flex-row sm:items-center gap-3">
                <div className="w-full sm:w-48">
                  <label className="text-xs font-medium text-muted-foreground">Priority</label>
                  <Select value={priority} onValueChange={(val) => setPriority(val as TicketPriority)}>
                    <SelectTrigger className="mt-1">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="LOW">Low</SelectItem>
                      <SelectItem value="MEDIUM">Medium (Default)</SelectItem>
                      <SelectItem value="HIGH">High</SelectItem>
                      <SelectItem value="CRITICAL">Critical (System Down)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex gap-2 sm:self-end pt-2 sm:pt-0">
                  <Button type="submit" disabled={createMutation.isPending}>
                    {createMutation.isPending ? 'Submitting…' : 'Submit Ticket'}
                  </Button>
                  <Button type="button" variant="ghost" onClick={() => setShowForm(false)}>
                    Cancel
                  </Button>
                </div>
              </div>
            </form>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader><CardTitle className="text-base">Your Support Tickets</CardTitle></CardHeader>
        <CardContent className="divide-y">
          {isLoading && <p className="py-8 text-sm text-muted-foreground text-center">Loading your support tickets…</p>}
          {!isLoading && tickets.length === 0 && (
            <div className="py-12 text-center text-sm text-muted-foreground">
              <LifeBuoy className="h-8 w-8 mx-auto mb-2 text-muted-foreground opacity-40" />
              <p>No tickets raised yet.</p>
              <p className="text-xs mt-1">If you need help configuring batches, reconciling payments, or managing equipment, open a ticket above.</p>
            </div>
          )}
          {tickets.map((ticket) => (
            <div key={ticket.id} className="py-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3 hover:bg-muted/20 px-2 rounded-md">
              <div className="min-w-0 space-y-1">
                <p className="font-medium text-sm truncate">{ticket.title}</p>
                <p className="text-xs text-muted-foreground flex items-center gap-2">
                  <span className="font-mono">{ticket.ticketNumber}</span>
                  <span>•</span>
                  <span>{new Date(ticket.createdAt).toLocaleDateString()}</span>
                </p>
                <p className="text-xs text-muted-foreground line-clamp-1">{ticket.description}</p>
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
