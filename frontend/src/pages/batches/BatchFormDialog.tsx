import { useEffect, useState } from 'react';
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
import { cn } from '@/lib/utils';
import api from '@services/api';

const BATCH_TYPES = [
  { value: 'MORNING', label: 'Morning' },
  { value: 'EVENING', label: 'Evening' },
  { value: 'LADIES', label: 'Ladies' },
  { value: 'CROSSFIT', label: 'CrossFit' },
  { value: 'YOGA', label: 'Yoga' },
  { value: 'PERSONAL_TRAINING', label: 'Personal Training' },
  { value: 'ZUMBA', label: 'Zumba' },
  { value: 'PILATES', label: 'Pilates' },
  { value: 'SPINNING', label: 'Spinning' },
  { value: 'GENERAL', label: 'General' },
] as const;

const WEEK_DAYS = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'] as const;

const TIME_REGEX = /^([01]\d|2[0-3]):([0-5]\d)$/;

const batchSchema = z
  .object({
    name: z.string().min(1, 'Batch name is required').max(100),
    type: z
      .enum(['MORNING', 'EVENING', 'LADIES', 'CROSSFIT', 'YOGA', 'PERSONAL_TRAINING', 'ZUMBA', 'PILATES', 'SPINNING', 'GENERAL'])
      .optional(),
    description: z.string().optional(),
    startTime: z.string().regex(TIME_REGEX, 'Use 24hr format (HH:mm)'),
    endTime: z.string().regex(TIME_REGEX, 'Use 24hr format (HH:mm)'),
    days: z.array(z.string()).min(1, 'Pick at least one day'),
    capacity: z.coerce.number().int().min(1, 'Capacity must be at least 1'),
    trainerId: z.string().optional(),
    status: z.enum(['ACTIVE', 'INACTIVE', 'ARCHIVED', 'FULL']).optional(),
  })
  .superRefine((data, ctx) => {
    const toMin = (t: string) => {
      const [h, m] = t.split(':').map(Number);
      return h * 60 + m;
    };
    if (data.startTime && data.endTime && TIME_REGEX.test(data.startTime) && TIME_REGEX.test(data.endTime)) {
      if (toMin(data.startTime) >= toMin(data.endTime)) {
        ctx.addIssue({ code: 'custom', path: ['endTime'], message: 'End time must be after start time' });
      }
    }
  });

type BatchFormValues = z.infer<typeof batchSchema>;

interface BatchFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  batch?: (BatchFormValues & { id: string }) | null;
}

export function BatchFormDialog({ open, onOpenChange, batch }: BatchFormDialogProps) {
  const isEdit = !!batch;
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [selectedDays, setSelectedDays] = useState<string[]>([]);

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
    getValues,
    formState: { errors, isSubmitting },
  } = useForm<BatchFormValues>({
    resolver: zodResolver(batchSchema),
    defaultValues: { name: '', startTime: '', endTime: '', days: [], capacity: 20, type: 'GENERAL' },
  });

  useEffect(() => {
    if (open) {
      reset(
        batch ?? {
          name: '',
          type: 'GENERAL',
          description: '',
          startTime: '',
          endTime: '',
          days: [],
          capacity: 20,
          trainerId: undefined,
          status: 'ACTIVE',
        },
      );
      setSelectedDays(batch?.days ?? []);
    }
  }, [open, batch, reset]);

  const toggleDay = (day: string) => {
    setSelectedDays((prev) => {
      const next = prev.includes(day) ? prev.filter((d) => d !== day) : [...prev, day];
      // Keep whatever the user has typed so far; only the days list changes.
      reset({ ...getValues(), days: next });
      return next;
    });
  };

  const mutation = useMutation({
    mutationFn: (values: BatchFormValues) => {
      const payload = {
        ...values,
        days: selectedDays,
        trainerId: values.trainerId || undefined,
      };
      return isEdit ? api.put(`/batches/${batch!.id}`, payload) : api.post('/batches', payload);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['batches'] });
      toast({ title: isEdit ? 'Batch updated' : 'Batch created' });
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

  const trainers = trainersData?.data ?? [];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{isEdit ? 'Edit Batch' : 'Create Batch'}</DialogTitle>
          <DialogDescription>
            {isEdit
              ? 'Update timing, days, trainer, or capacity.'
              : 'Define a recurring batch — timing conflicts with the same trainer are prevented.'}
          </DialogDescription>
        </DialogHeader>

        <form
          onSubmit={handleSubmit((values) => mutation.mutate(values))}
          className="space-y-4"
        >
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="name">Batch name</Label>
              <Input id="name" placeholder="Morning CrossFit" {...register('name')} />
              {errors.name && <p className="text-sm text-destructive">{errors.name.message}</p>}
            </div>
            <div className="space-y-1.5">
              <Label>Type</Label>
              <Controller
                control={control}
                name="type"
                render={({ field }) => (
                  <Select value={field.value} onValueChange={field.onChange}>
                    <SelectTrigger><SelectValue placeholder="Select type" /></SelectTrigger>
                    <SelectContent>
                      {BATCH_TYPES.map((t) => (
                        <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="startTime">Start time</Label>
              <Input id="startTime" type="time" {...register('startTime')} />
              {errors.startTime && <p className="text-sm text-destructive">{errors.startTime.message}</p>}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="endTime">End time</Label>
              <Input id="endTime" type="time" {...register('endTime')} />
              {errors.endTime && <p className="text-sm text-destructive">{errors.endTime.message}</p>}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="capacity">Capacity</Label>
              <Input id="capacity" type="number" min={1} {...register('capacity')} />
              {errors.capacity && <p className="text-sm text-destructive">{errors.capacity.message}</p>}
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>Days of week</Label>
            <div className="flex flex-wrap gap-2">
              {WEEK_DAYS.map((day) => (
                <Button
                  key={day}
                  type="button"
                  size="sm"
                  variant={selectedDays.includes(day) ? 'default' : 'outline'}
                  onClick={() => toggleDay(day)}
                  className={cn(selectedDays.includes(day) && 'bg-primary text-primary-foreground')}
                >
                  {day}
                </Button>
              ))}
            </div>
            {errors.days && <p className="text-sm text-destructive">{errors.days.message}</p>}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label>Trainer</Label>
              <Controller
                control={control}
                name="trainerId"
                render={({ field }) => (
                  <Select value={field.value} onValueChange={field.onChange}>
                    <SelectTrigger><SelectValue placeholder="Assign a trainer (optional)" /></SelectTrigger>
                    <SelectContent>
                      {trainers.map((t: any) => (
                        <SelectItem key={t.id} value={t.id}>{t.firstName} {t.lastName}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Status</Label>
              <Controller
                control={control}
                name="status"
                render={({ field }) => (
                  <Select value={field.value} onValueChange={field.onChange}>
                    <SelectTrigger><SelectValue placeholder="Status" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="ACTIVE">Active</SelectItem>
                      <SelectItem value="INACTIVE">Inactive</SelectItem>
                      <SelectItem value="FULL">Full</SelectItem>
                    </SelectContent>
                  </Select>
                )}
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="description">Description</Label>
            <Textarea
              id="description"
              placeholder="Optional details about the batch"
              {...register('description')}
            />
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={isSubmitting || mutation.isPending}>
              {mutation.isPending ? 'Saving...' : isEdit ? 'Save changes' : 'Create batch'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
