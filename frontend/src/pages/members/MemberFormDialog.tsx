import { useEffect } from 'react';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import { useToast } from '@/hooks/use-toast';
import api from '@services/api';

const memberSchema = z.object({
  firstName: z.string().min(1, 'First name is required').max(60),
  lastName: z.string().min(1, 'Last name is required').max(60),
  gender: z.enum(['MALE', 'FEMALE', 'OTHER', 'PREFER_NOT_TO_SAY']).optional(),
  dateOfBirth: z.string().optional(),
  mobile: z.string().regex(/^\+?[0-9]{10,15}$/, 'Enter a valid phone number'),
  email: z.string().email('Invalid email address').optional().or(z.literal('')),
  emergencyContactName: z.string().optional(),
  emergencyContactPhone: z
    .string()
    .regex(/^\+?[0-9]{10,15}$/, 'Enter a valid phone number')
    .optional()
    .or(z.literal('')),
  address: z.string().optional(),
  city: z.string().optional(),
  state: z.string().optional(),
  pincode: z.string().optional(),
  medicalNotes: z.string().optional(),
  batchId: z.string().optional(),
  trainerId: z.string().optional(),
  referredBy: z.string().optional(),
  photo: z.string().optional(),
});

export type MemberFormValues = z.infer<typeof memberSchema>;

interface MemberFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** When set, the dialog edits this member instead of creating a new one. */
  member?: (MemberFormValues & { id: string }) | null;
}

export function MemberFormDialog({ open, onOpenChange, member }: MemberFormDialogProps) {
  const isEdit = !!member;
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const { data: batchesData } = useQuery({
    queryKey: ['batches', 'options'],
    queryFn: () => api.get('/batches?limit=100'),
    enabled: open,
  });
  const { data: trainersData } = useQuery({
    queryKey: ['trainers', 'options'],
    queryFn: () => api.get('/users?role=TRAINER&limit=100'),
    enabled: open,
  });

  const {
    register,
    handleSubmit,
    control,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<MemberFormValues>({
    resolver: zodResolver(memberSchema),
    defaultValues: { firstName: '', lastName: '', mobile: '' },
  });

  useEffect(() => {
    if (open) {
      reset(
        member ?? { firstName: '', lastName: '', mobile: '', email: '', address: '', medicalNotes: '' },
      );
    }
  }, [open, member, reset]);

  const mutation = useMutation({
    mutationFn: (values: MemberFormValues) => {
      const payload = { ...values, email: values.email || undefined };
      return isEdit ? api.put(`/members/${member!.id}`, payload) : api.post('/members', payload);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['members'] });
      toast({ title: isEdit ? 'Member updated' : 'Member registered' });
      onOpenChange(false);
    },
    onError: (error: any) => {
      toast({
        title: 'Something went wrong',
        description: error.response?.data?.message || 'Please check the form and try again',
        variant: 'destructive',
      });
    },
  });

  const batches = batchesData?.data?.data ?? [];
  const trainers = trainersData?.data?.data ?? [];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{isEdit ? 'Edit Member' : 'Register New Member'}</DialogTitle>
          <DialogDescription>
            {isEdit
              ? 'Update the member\u2019s profile, batch, or trainer assignment.'
              : 'A member code and encrypted QR/digital ID are generated automatically.'}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit((values) => mutation.mutate(values))} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="firstName">First name</Label>
              <Input id="firstName" {...register('firstName')} />
              {errors.firstName && <p className="text-sm text-destructive">{errors.firstName.message}</p>}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="lastName">Last name</Label>
              <Input id="lastName" {...register('lastName')} />
              {errors.lastName && <p className="text-sm text-destructive">{errors.lastName.message}</p>}
            </div>
          </div>

          <div className="grid grid-cols-3 gap-4">
            <div className="space-y-1.5">
              <Label>Gender</Label>
              <Controller
                control={control}
                name="gender"
                render={({ field }) => (
                  <Select value={field.value} onValueChange={field.onChange}>
                    <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="MALE">Male</SelectItem>
                      <SelectItem value="FEMALE">Female</SelectItem>
                      <SelectItem value="OTHER">Other</SelectItem>
                      <SelectItem value="PREFER_NOT_TO_SAY">Prefer not to say</SelectItem>
                    </SelectContent>
                  </Select>
                )}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="dateOfBirth">Date of birth</Label>
              <Input id="dateOfBirth" type="date" {...register('dateOfBirth')} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="mobile">Mobile</Label>
              <Input id="mobile" placeholder="+919876543210" {...register('mobile')} />
              {errors.mobile && <p className="text-sm text-destructive">{errors.mobile.message}</p>}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="email">Email</Label>
              <Input id="email" type="email" {...register('email')} />
              {errors.email && <p className="text-sm text-destructive">{errors.email.message}</p>}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="referredBy">Referred by (member code)</Label>
              <Input id="referredBy" {...register('referredBy')} />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="emergencyContactName">Emergency contact name</Label>
              <Input id="emergencyContactName" {...register('emergencyContactName')} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="emergencyContactPhone">Emergency contact phone</Label>
              <Input id="emergencyContactPhone" {...register('emergencyContactPhone')} />
              {errors.emergencyContactPhone && (
                <p className="text-sm text-destructive">{errors.emergencyContactPhone.message}</p>
              )}
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="address">Address</Label>
            <Input id="address" {...register('address')} />
          </div>

          <div className="grid grid-cols-3 gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="city">City</Label>
              <Input id="city" {...register('city')} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="state">State</Label>
              <Input id="state" {...register('state')} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="pincode">Pincode</Label>
              <Input id="pincode" {...register('pincode')} />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label>Batch</Label>
              <Controller
                control={control}
                name="batchId"
                render={({ field }) => (
                  <Select value={field.value} onValueChange={field.onChange}>
                    <SelectTrigger><SelectValue placeholder="Assign a batch" /></SelectTrigger>
                    <SelectContent>
                      {batches.map((b: any) => (
                        <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Trainer</Label>
              <Controller
                control={control}
                name="trainerId"
                render={({ field }) => (
                  <Select value={field.value} onValueChange={field.onChange}>
                    <SelectTrigger><SelectValue placeholder="Assign a trainer" /></SelectTrigger>
                    <SelectContent>
                      {trainers.map((t: any) => (
                        <SelectItem key={t.id} value={t.id}>{t.firstName} {t.lastName}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="medicalNotes">Medical notes</Label>
            <Textarea
              id="medicalNotes"
              placeholder="Injuries, conditions, or anything staff should be aware of"
              {...register('medicalNotes')}
            />
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={isSubmitting || mutation.isPending}>
              {mutation.isPending ? 'Saving...' : isEdit ? 'Save changes' : 'Register member'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
