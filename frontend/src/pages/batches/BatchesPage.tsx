import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Clock, Users, Calendar, Pencil, Archive, Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { BatchFormDialog } from './BatchFormDialog';
import { useToast } from '@/hooks/use-toast';
import api from '@services/api';

type Batch = {
  id: string;
  name: string;
  type: string;
  description?: string;
  startTime: string;
  endTime: string;
  days: string[];
  capacity: number;
  status: string;
  trainer?: { id: string; firstName: string; lastName: string } | null;
  seatsTaken?: number;
  seatsAvailable?: number;
};

export function BatchesPage() {
  const [search, setSearch] = useState('');
  const [formOpen, setFormOpen] = useState(false);
  const [editingBatch, setEditingBatch] = useState<Batch | null>(null);
  const [pendingArchive, setPendingArchive] = useState<Batch | null>(null);

  const queryClient = useQueryClient();
  const { toast } = useToast();

  const { data, isLoading } = useQuery({
    queryKey: ['batches'],
    queryFn: () => api.get('/batches?limit=100'),
  });

  const body = data as any;
  const batches: Batch[] = useMemo(() => {
    const all: Batch[] = body?.data ?? [];
    const q = search.trim().toLowerCase();
    if (!q) return all;
    return all.filter(
      (b) =>
        b.name.toLowerCase().includes(q) ||
        b.type.toLowerCase().includes(q) ||
        (b.trainer && `${b.trainer.firstName} ${b.trainer.lastName}`.toLowerCase().includes(q)),
    );
  }, [body, search]);

  const archiveMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/batches/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['batches'] });
      toast({ title: 'Batch archived' });
      setPendingArchive(null);
    },
    onError: (err: any) => {
      toast({
        title: 'Could not archive batch',
        description: err.response?.data?.message || 'Please try again.',
        variant: 'destructive',
      });
      setPendingArchive(null);
    },
  });

  const statusVariant = (status: string) => {
    switch (status) {
      case 'ACTIVE': return 'success' as const;
      case 'FULL': return 'default' as const;
      case 'INACTIVE': return 'secondary' as const;
      case 'ARCHIVED': return 'outline' as const;
      default: return 'secondary' as const;
    }
  };

  // The dialog expects the slim form shape — map the rich list row to it.
  const batchForEdit = editingBatch
    ? {
        id: editingBatch.id,
        name: editingBatch.name,
        type: editingBatch.type as any,
        description: editingBatch.description,
        startTime: editingBatch.startTime,
        endTime: editingBatch.endTime,
        days: editingBatch.days,
        capacity: editingBatch.capacity,
        trainerId: editingBatch.trainer?.id,
        status: editingBatch.status as any,
      }
    : null;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-3xl font-bold tracking-tight">Batches</h2>
          <p className="text-muted-foreground">Manage training batches</p>
        </div>
        <Button onClick={() => { setEditingBatch(null); setFormOpen(true); }}>
          <Plus className="h-4 w-4 mr-2" />
          Create Batch
        </Button>
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-center gap-4">
            <Search className="h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search batches, type, or trainer..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="max-w-sm"
            />
          </div>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="text-center py-8">Loading...</div>
          ) : batches.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              {search ? 'No batches match your search' : 'No batches yet — create your first batch'}
            </div>
          ) : (
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {batches.map((batch) => (
                <Card key={batch.id} className="flex flex-col">
                  <CardHeader className="flex flex-row items-start justify-between gap-2 pb-2">
                    <div>
                      <p className="font-semibold leading-tight">{batch.name}</p>
                      <div className="mt-1 flex flex-wrap gap-1">
                        <Badge variant="secondary">{batch.type.replace(/_/g, ' ')}</Badge>
                        <Badge variant={statusVariant(batch.status)}>{batch.status}</Badge>
                      </div>
                    </div>
                    <div className="flex gap-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        title="Edit"
                        onClick={() => { setEditingBatch(batch); setFormOpen(true); }}
                      >
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        title="Archive"
                        onClick={() => setPendingArchive(batch)}
                      >
                        <Archive className="h-4 w-4" />
                      </Button>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-2 text-sm text-muted-foreground">
                    <div className="flex items-center gap-2">
                      <Clock className="h-4 w-4" />
                      {batch.startTime} - {batch.endTime}
                    </div>
                    <div className="flex items-center gap-2">
                      <Calendar className="h-4 w-4" />
                      {batch.days?.join(', ')}
                    </div>
                    <div className="flex items-center gap-2">
                      <Users className="h-4 w-4" />
                      {batch.seatsTaken ?? 0}/{batch.capacity} seats taken
                    </div>
                    {batch.trainer && (
                      <div className="rounded-md bg-muted/50 px-2 py-1 text-xs">
                        Trainer: {batch.trainer.firstName} {batch.trainer.lastName}
                      </div>
                    )}
                    {batch.description && (
                      <p className="line-clamp-2 text-xs">{batch.description}</p>
                    )}
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <BatchFormDialog open={formOpen} onOpenChange={setFormOpen} batch={batchForEdit} />

      <ConfirmDialog
        open={!!pendingArchive}
        onOpenChange={(o) => !o && setPendingArchive(null)}
        title="Archive batch?"
        description={`${pendingArchive?.name} will be hidden from active listings. Members already assigned are kept.`}
        confirmLabel="Archive"
        variant="destructive"
        loading={archiveMutation.isPending}
        onConfirm={() => pendingArchive && archiveMutation.mutate(pendingArchive.id)}
      />

    </div>
  );
}
