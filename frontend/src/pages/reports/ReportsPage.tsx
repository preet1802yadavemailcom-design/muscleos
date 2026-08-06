import { useState } from 'react';
import { Download, FileText, BarChart3, Users, Calendar } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

const reportTypes = [
  { name: 'Attendance Report', icon: Calendar, description: 'Daily, weekly, monthly attendance summary' },
  { name: 'Revenue Report', icon: BarChart3, description: 'Payment and revenue analytics' },
  { name: 'Member Report', icon: Users, description: 'Member growth and retention metrics' },
  { name: 'Batch Report', icon: FileText, description: 'Batch performance and utilization' },
];

export function ReportsPage() {
  const [period, setPeriod] = useState('monthly');

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-3xl font-bold tracking-tight">Reports</h2>
          <p className="text-muted-foreground">Generate and download reports</p>
        </div>
        <div className="flex gap-2">
          <select 
            value={period}
            onChange={(e) => setPeriod(e.target.value)}
            className="rounded-md border border-input bg-background px-3 py-2 text-sm"
          >
            <option value="daily">Daily</option>
            <option value="weekly">Weekly</option>
            <option value="monthly">Monthly</option>
            <option value="yearly">Yearly</option>
          </select>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        {reportTypes.map((report) => (
          <Card key={report.name} className="cursor-pointer hover:bg-accent/50 transition-colors">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <report.icon className="h-5 w-5" />
                {report.name}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground mb-4">{report.description}</p>
              <div className="flex gap-2">
                <Button variant="outline" size="sm">
                  <FileText className="h-4 w-4 mr-2" />
                  View
                </Button>
                <Button variant="outline" size="sm">
                  <Download className="h-4 w-4 mr-2" />
                  Export PDF
                </Button>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
