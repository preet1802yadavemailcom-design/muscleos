import { useRef } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { QRCodeCanvas } from 'qrcode.react';
import { QrCode, RefreshCw, Printer } from 'lucide-react';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';
import { printQrCode } from '@/lib/qr-print';
import api from '@services/api';

interface GymQrDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

interface BranchQrResponse {
  token: string;
  branchId: string;
  generatedAt: string;
}

/**
 * The entrance check-in QR — printed and stuck on the wall.
 * Backed by `GET/POST /branches/default/qr*` (qr.controller.ts), which
 * auto-provisions a "Main Branch" the first time this is opened for a gym
 * that hasn't set up branches yet, so there's no separate "create" step.
 * Unlike the old /attendance/gym-qr endpoints this replaced, Regenerate
 * here genuinely invalidates the old poster — the token is a real DB row,
 * not a re-encryption of the same gymId.
 */
export function GymQrDialog({ open, onOpenChange }: GymQrDialogProps) {
  const qrWrapRef = useRef<HTMLDivElement>(null);
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const { data, isLoading, refetch } = useQuery<BranchQrResponse>({
    queryKey: ['branch-default-qr'],
    queryFn: async () => (await api.get('/branches/default/qr')).data,
    enabled: open,
  });

  const regenerateMutation = useMutation({
    mutationFn: () => api.post('/branches/default/qr/regenerate'),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['branch-default-qr'] });
      toast({ title: 'QR regenerated', description: 'The old printed poster no longer works — print the new one.' });
    },
    onError: (err: any) => {
      toast({
        title: 'Could not regenerate QR',
        description: err.response?.data?.message || 'Please try again.',
        variant: 'destructive',
      });
    },
  });

  const handlePrint = () => {
    const canvas = qrWrapRef.current?.querySelector('canvas');
    if (canvas) printQrCode(canvas);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <QrCode className="h-5 w-5" />
            Gym Check-in QR
          </DialogTitle>
          <DialogDescription>
            Print this and stick it at the entrance. Any logged-in member of this gym
            who scans it will be checked in or out automatically.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col items-center gap-4 py-4">
          {isLoading ? (
            <div className="flex h-64 w-64 items-center justify-center rounded-lg border bg-muted/50 text-sm text-muted-foreground">
              Loading...
            </div>
          ) : data?.token ? (
            <>
              <div ref={qrWrapRef} className="rounded-2xl border-4 border-primary/20 bg-white p-6">
                <QRCodeCanvas
                  value={`${window.location.origin}/checkin?token=${data.token}`}
                  size={200}
                  level="H"
                  includeMargin
                />
              </div>
              <p className="text-xs text-muted-foreground text-center max-w-xs">
                This is a permanent code — safe to print and stick on a wall. It only
                stops working if you explicitly regenerate it below.
              </p>
            </>
          ) : (
            <div className="flex h-64 w-64 items-center justify-center rounded-lg border border-dashed bg-muted/30 p-4 text-center text-sm text-muted-foreground">
              Couldn't load the QR — try refreshing.
            </div>
          )}
        </div>

        {data?.token && (
          <DialogFooter className="gap-2">
            <Button type="button" variant="outline" onClick={handlePrint}>
              <Printer className="h-4 w-4 mr-2" />
              Print
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => regenerateMutation.mutate()}
              disabled={regenerateMutation.isPending}
            >
              <RefreshCw className="h-4 w-4 mr-2" />
              {regenerateMutation.isPending ? 'Regenerating...' : 'Regenerate'}
            </Button>
            <Button type="button" variant="ghost" onClick={() => refetch()}>
              Refresh
            </Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
}
