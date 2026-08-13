import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Download, FileText, BarChart3, Users, Calendar } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useToast } from '@/hooks/use-toast';
import api from '@services/api';

type ReportType = 'ATTENDANCE' | 'REVENUE' | 'MEMBER' | 'BATCH';
type Period = 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'YEARLY';

const reportTypes: Array<{ type: ReportType; name: string; icon: any; description: string }> = [
  { type: 'ATTENDANCE', name: 'Attendance Report', icon: Calendar, description: 'Daily, weekly, monthly attendance summary' },
  { type: 'REVENUE', name: 'Revenue Report', icon: BarChart3, description: 'Payment and revenue analytics' },
  { type: 'MEMBER', name: 'Member Report', icon: Users, description: 'Member growth and retention metrics' },
  { type: 'BATCH', name: 'Batch Report', icon: FileText, description: 'Batch performance and utilization' },
];

/** Every button here calls a real backend report endpoint
 *  (reports.controller.ts: POST /reports/generate, POST /reports/export) —
 *  this used to render four cards with no onClick handlers at all. */
export function ReportsPage() {
  const [period, setPeriod] = useState<Period>('MONTHLY');
  const { toast } = useToast();
  const [viewing, setViewing] = useState<{ type: ReportType; data: any } | null>(null);

  const viewMutation = useMutation({
    mutationFn: (type: ReportType) => api.post('/reports/generate', { type, period }),
    onSuccess: (res: any, type) => setViewing({ type, data: res.data }),
    onError: (e: any) => toast({
      title: 'Could not generate report',
      description: e?.response?.data?.message ?? 'Please try again',
      variant: 'destructive',
    }),
  });

  const exportMutation = useMutation({
    mutationFn: async ({ type, format }: { type: ReportType; format: 'csv' | 'pdf' | 'excel' }) => {
      const res = await api.post('/reports/export', { type, period, format }, { responseType: 'blob' });
      const contentDisposition = res.headers?.['content-disposition'] as string | undefined;
      const filenameMatch = contentDisposition?.match(/filename="?([^"]+)"?/);
      const filename = filenameMatch?.[1] ?? `${type.toLowerCase()}-report.${format === 'excel' ? 'xlsx' : format}`;
      const url = window.URL.createObjectURL(new Blob([res.data]));
      const link = document.createElement('a');
      link.href = url;
      link.download = filename;
      link.click();
      window.URL.revokeObjectURL(url);
    },
    onError: (e: any) => toast({
      title: 'Export failed',
      description: e?.response?.data?.message ?? 'Please try again',
      variant: 'destructive',
    }),
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h2 className="text-2xl sm:text-3xl font-bold tracking-tight">Reports</h2>
          <p className="text-muted-foreground">Generate and download reports</p>
        </div>
        <div className="flex gap-2">
          <select
            value={period}
            onChange={(e) => setPeriod(e.target.value as Period)}
            className="rounded-md border border-input bg-background px-3 py-2 text-sm"
          >
            <option value="DAILY">Daily</option>
            <option value="WEEKLY">Weekly</option>
            <option value="MONTHLY">Monthly</option>
            <option value="YEARLY">Yearly</option>
          </select>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        {reportTypes.map((report) => (
          <Card key={report.name}>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <report.icon className="h-5 w-5" />
                {report.name}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground mb-4">{report.description}</p>
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => viewMutation.mutate(report.type)}
                  disabled={viewMutation.isPending}
                >
                  <FileText className="h-4 w-4 mr-2" />
                  View
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => exportMutation.mutate({ type: report.type, format: 'csv' })}
                  disabled={exportMutation.isPending}
                >
                  <Download className="h-4 w-4 mr-2" />
                  CSV
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => exportMutation.mutate({ type: report.type, format: 'pdf' })}
                  disabled={exportMutation.isPending}
                >
                  <Download className="h-4 w-4 mr-2" />
                  PDF
                </Button>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {viewing && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{viewing.type} report — {period.toLowerCase()}</CardTitle>
          </CardHeader>
          <CardContent>
            <pre className="text-xs bg-muted rounded-md p-4 overflow-x-auto max-h-96 overflow-y-auto">
              {JSON.stringify(viewing.data, null, 2)}
            </pre>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
