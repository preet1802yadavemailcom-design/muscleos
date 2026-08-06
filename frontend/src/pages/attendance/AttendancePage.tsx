import { useState } from 'react';
import { QrCode, CheckCircle, XCircle, Clock } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';

export function AttendancePage() {
  const [qrData, setQrData] = useState('');
  const [scanResult, setScanResult] = useState<any>(null);

  const handleScan = async () => {
    // Simulate QR scan
    setScanResult({
      memberName: 'John Doe',
      status: 'CHECKED_IN',
      time: new Date().toLocaleTimeString(),
    });
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-3xl font-bold tracking-tight">Attendance</h2>
        <p className="text-muted-foreground">Scan QR codes to mark attendance</p>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <QrCode className="h-5 w-5" />
              QR Scanner
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="aspect-square rounded-lg border-2 border-dashed border-muted flex items-center justify-center bg-muted/50">
              <QrCode className="h-16 w-16 text-muted-foreground" />
            </div>
            <div className="flex gap-2">
              <Input
                placeholder="Enter QR code data..."
                value={qrData}
                onChange={(e) => setQrData(e.target.value)}
              />
              <Button onClick={handleScan}>Scan</Button>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Scan Result</CardTitle>
          </CardHeader>
          <CardContent>
            {scanResult ? (
              <div className="space-y-4">
                <div className="flex items-center gap-2">
                  <CheckCircle className="h-5 w-5 text-green-500" />
                  <span className="font-medium">{scanResult.memberName}</span>
                </div>
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Clock className="h-4 w-4" />
                  {scanResult.time}
                </div>
                <div className="rounded-lg bg-green-50 p-3 text-sm text-green-800">
                  Successfully {scanResult.status.toLowerCase().replace('_', ' ')}
                </div>
              </div>
            ) : (
              <div className="text-center py-8 text-muted-foreground">
                <XCircle className="h-8 w-8 mx-auto mb-2" />
                No scan yet
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
