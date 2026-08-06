import { useQuery } from '@tanstack/react-query';
import { Plus, CheckCircle, XCircle, Clock } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import api from '@services/api';

export function PaymentsPage() {
  const { data, isLoading } = useQuery({
    queryKey: ['payments'],
    queryFn: () => api.get('/payments'),
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-3xl font-bold tracking-tight">Payments</h2>
          <p className="text-muted-foreground">Manage payments and invoices</p>
        </div>
        <Button>
          <Plus className="h-4 w-4 mr-2" />
          New Payment
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Recent Transactions</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="text-center py-8">Loading...</div>
          ) : (
            <div className="rounded-md border">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-muted/50">
                    <th className="h-12 px-4 text-left font-medium">Receipt #</th>
                    <th className="h-12 px-4 text-left font-medium">Amount</th>
                    <th className="h-12 px-4 text-left font-medium">Gateway</th>
                    <th className="h-12 px-4 text-left font-medium">Status</th>
                    <th className="h-12 px-4 text-left font-medium">Date</th>
                  </tr>
                </thead>
                <tbody>
                  {data?.data?.data?.map((payment: any) => (
                    <tr key={payment.id} className="border-b">
                      <td className="p-4">{payment.receiptNumber || 'N/A'}</td>
                      <td className="p-4 font-medium">₹{payment.total}</td>
                      <td className="p-4">{payment.gateway}</td>
                      <td className="p-4">
                        <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium ${
                          payment.status === 'COMPLETED' 
                            ? 'bg-green-100 text-green-800' 
                            : payment.status === 'PENDING'
                            ? 'bg-yellow-100 text-yellow-800'
                            : 'bg-red-100 text-red-800'
                        }`}>
                          {payment.status === 'COMPLETED' && <CheckCircle className="h-3 w-3" />}
                          {payment.status === 'PENDING' && <Clock className="h-3 w-3" />}
                          {payment.status === 'FAILED' && <XCircle className="h-3 w-3" />}
                          {payment.status}
                        </span>
                      </td>
                      <td className="p-4 text-muted-foreground">
                        {new Date(payment.createdAt).toLocaleDateString()}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
