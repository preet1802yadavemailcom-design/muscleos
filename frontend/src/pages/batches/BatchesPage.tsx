import { useQuery } from '@tanstack/react-query';
import { Plus, Clock, Users, Calendar } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import api from '@services/api';

export function BatchesPage() {
  const { data, isLoading } = useQuery({
    queryKey: ['batches'],
    queryFn: () => api.get('/batches'),
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-3xl font-bold tracking-tight">Batches</h2>
          <p className="text-muted-foreground">Manage training batches</p>
        </div>
        <Button>
          <Plus className="h-4 w-4 mr-2" />
          Create Batch
        </Button>
      </div>

      {isLoading ? (
        <div className="text-center py-8">Loading...</div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {data?.data?.map((batch: any) => (
            <Card key={batch.id}>
              <CardHeader>
                <CardTitle>{batch.name}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Clock className="h-4 w-4" />
                  {batch.startTime} - {batch.endTime}
                </div>
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Users className="h-4 w-4" />
                  Capacity: {batch.capacity}
                </div>
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Calendar className="h-4 w-4" />
                  {batch.days?.join(', ')}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
