import { useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import { useToast } from '@/hooks/use-toast';
import api from '@services/api';

interface MemberQrDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  member: { id: string; memberCode: string; firstName: string; lastName: string; qrCode?: string } | null;
}

export function MemberQrDialog({ open, onOpenChange, member }: MemberQrDialogProps) {
  const [qrCode, setQrCode] = useState(member?.qrCode);
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const regenerate = useMutation({
    mutationFn: () => api.post(`/members/${member!.id}/regenerate-qr`),
    onSuccess: (res: any) => {
      setQrCode(res.data.qrCode);
      queryClient.invalidateQueries({ queryKey: ['members'] });
      toast({ title: 'QR code regenerated', description: 'The old code is no longer valid at check-in.' });
    },
  });

  if (!member) return null;
  const code = qrCode ?? member.qrCode ?? member.id;

  return (
    <Dialog open={open} onOpenChange={(next) => { setQrCode(undefined); onOpenChange(next); }}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Digital Member ID</DialogTitle>
          <DialogDescription>
            {member.firstName} {member.lastName} — {member.memberCode}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col items-center gap-4 py-4">
          <div className="rounded-lg border p-4 bg-white">
            <QRCodeSVG value={code} size={200} level="H" />
          </div>
          <p className="text-xs text-muted-foreground text-center max-w-xs">
            This code encodes an encrypted reference only — it never exposes the member's internal ID.
            Scan it at the gym entrance to check in or out.
          </p>
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => regenerate.mutate()}
            disabled={regenerate.isPending}
          >
            <RefreshCw className="h-4 w-4 mr-2" />
            {regenerate.isPending ? 'Regenerating...' : 'Regenerate code'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
