import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { Bell, Mail, MessageSquare, Send, Megaphone, CheckCircle2, XCircle, Clock, Plus, TestTube, Users } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/hooks/use-toast';
import api from '@services/api';

interface NotificationLog {
  id: string;
  channel: 'SMS' | 'EMAIL' | 'PUSH' | 'IN_APP';
  title: string;
  status: 'PENDING' | 'SENT' | 'DELIVERED' | 'FAILED' | 'READ';
  userId?: string | null;
  memberId?: string | null;
  createdAt: string;
}

type Tab = 'logs' | 'send' | 'announcements' | 'templates';

const channelIcon: Record<string, any> = { SMS: MessageSquare, EMAIL: Mail, PUSH: Bell, IN_APP: Bell };
const statusStyle: Record<string, { variant: any; icon: any }> = {
  SENT: { variant: 'success', icon: CheckCircle2 },
  DELIVERED: { variant: 'success', icon: CheckCircle2 },
  READ: { variant: 'success', icon: CheckCircle2 },
  FAILED: { variant: 'destructive', icon: XCircle },
  PENDING: { variant: 'secondary', icon: Clock },
};

interface SendForm {
  channels: string[];
  title: string;
  message: string;
  targetType: 'ALL_ACTIVE' | 'BATCH' | 'SPECIFIC_MEMBER' | 'EXPIRING' | 'PENDING_PAYMENT';
  batchId?: string;
  memberId?: string;
  scheduledAt?: string;
}

export function NotificationsPage() {
  const [tab, setTab] = useState<Tab>('logs');
  const [logs, setLogs] = useState<NotificationLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [sendResult, setSendResult] = useState('');
  const [batches, setBatches] = useState<{ id: string; name: string }[]>([]);

  // Test Email state
  const [testEmail, setTestEmail] = useState('');
  const [testEmailSending, setTestEmailSending] = useState(false);
  const [testEmailResult, setTestEmailResult] = useState<{ success: boolean; message: string } | null>(null);

  const { toast } = useToast();

  const { register, handleSubmit, reset, watch } = useForm<SendForm>({
    defaultValues: {
      channels: ['EMAIL'],
      targetType: 'ALL_ACTIVE',
    },
  });

  const selectedTargetType = watch('targetType');

  useEffect(() => {
    (async () => {
      try {
        const [logsRes, batchesRes] = await Promise.all([
          api.get('/notifications'),
          api.get('/batches').catch(() => ({ data: [] })),
        ]);
        const rawLogs = (logsRes as any)?.data?.data ?? (logsRes as any)?.data ?? [];
        setLogs(Array.isArray(rawLogs) ? rawLogs : []);
        const batchData = (batchesRes as any)?.data?.data ?? (batchesRes as any)?.data ?? [];
        setBatches(Array.isArray(batchData) ? batchData : []);
      } catch {
        setLogs([]);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const onSend = async (data: SendForm) => {
    try {
      setSending(true);
      setSendResult('');
      await api.post('/notifications/announcements', {
        title: data.title,
        content: data.message,
        channels: data.channels,
        targetType: data.targetType,
        batchId: data.targetType === 'BATCH' ? data.batchId : undefined,
        memberId: data.targetType === 'SPECIFIC_MEMBER' ? data.memberId : undefined,
        scheduledAt: data.scheduledAt || undefined,
      });
      const targetLabel =
        data.targetType === 'BATCH'
          ? 'selected batch'
          : data.targetType === 'SPECIFIC_MEMBER'
          ? 'specified member'
          : data.targetType === 'EXPIRING'
          ? 'members expiring soon'
          : data.targetType === 'PENDING_PAYMENT'
          ? 'members with pending payment'
          : 'all active members';
      setSendResult(`Announcement queued successfully to ${targetLabel}.`);
      toast({ title: 'Announcement Queued', description: `Dispatch initiated to ${targetLabel}.` });
      reset();
    } catch (err: any) {
      const errMsg = err.response?.data?.message || 'Failed to send notification';
      setSendResult(errMsg);
      toast({ title: 'Announcement Failed', description: errMsg, variant: 'destructive' });
    } finally {
      setSending(false);
    }
  };

  const handleSendTestEmail = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!testEmail || !testEmail.includes('@')) {
      toast({ title: 'Invalid Email', description: 'Please enter a valid email address.', variant: 'destructive' });
      return;
    }
    try {
      setTestEmailSending(true);
      setTestEmailResult(null);
      const res: any = await api.post('/notifications/test-email', { email: testEmail });
      setTestEmailResult({ success: true, message: res.data?.message || `Test email successfully sent to ${testEmail}` });
      toast({ title: 'Test Email Sent', description: `Delivered to ${testEmail}` });
    } catch (err: any) {
      const msg = err.response?.data?.message || 'Could not dispatch test email';
      setTestEmailResult({ success: false, message: msg });
      toast({ title: 'Test Email Failed', description: msg, variant: 'destructive' });
    } finally {
      setTestEmailSending(false);
    }
  };

  const tabs: { key: Tab; label: string }[] = [
    { key: 'logs', label: 'Delivery Logs' },
    { key: 'send', label: 'Send Announcement' },
    { key: 'announcements', label: 'Announcements Info' },
    { key: 'templates', label: 'Templates' },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-3xl font-bold tracking-tight">Notifications</h2>
        <p className="text-muted-foreground">
          SMS, Email &amp; Push — expiry alerts, birthdays, payments, batch changes
        </p>
      </div>

      <div className="flex gap-2 border-b">
        {tabs.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
              tab === t.key
                ? 'border-primary text-primary'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'logs' && (
        <Card>
          <CardHeader>
            <CardTitle>Recent Deliveries</CardTitle>
          </CardHeader>
          <CardContent>
            {loading ? (
              <p className="text-sm text-muted-foreground">Loading...</p>
            ) : logs.length === 0 ? (
              <p className="text-sm text-muted-foreground">No notifications sent yet</p>
            ) : (
              <div className="space-y-2">
                {logs.map((log) => {
                  const ChannelIcon = channelIcon[log.channel] ?? Bell;
                  const status = statusStyle[log.status] ?? statusStyle.PENDING;
                  const StatusIcon = status.icon;
                  return (
                    <div
                      key={log.id}
                      className="flex items-center justify-between rounded-md border p-3 text-sm"
                    >
                      <div className="flex items-center gap-3">
                        <ChannelIcon className="h-4 w-4 text-muted-foreground" />
                        <div>
                          <p className="font-medium">{log.title}</p>
                          <p className="text-muted-foreground text-xs">
                            {log.userId ?? log.memberId ?? 'Broadcast'} •{' '}
                            {new Date(log.createdAt).toLocaleString()}
                          </p>
                        </div>
                      </div>
                      <Badge variant={status.variant} className="flex items-center gap-1">
                        <StatusIcon className="h-3 w-3" /> {log.status}
                      </Badge>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {tab === 'send' && (
        <div className="grid gap-6 lg:grid-cols-3">
          <Card className="lg:col-span-2">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Megaphone className="h-5 w-5 text-primary" />
                Broadcast an Announcement
              </CardTitle>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleSubmit(onSend)} className="space-y-4">
                {sendResult && (
                  <div className="rounded-lg bg-muted p-3 text-sm">{sendResult}</div>
                )}

                {/* Target Audience Dropdown */}
                <div className="space-y-2">
                  <label className="text-sm font-medium flex items-center gap-1.5">
                    <Users className="h-4 w-4 text-muted-foreground" /> Target Audience
                  </label>
                  <select
                    {...register('targetType')}
                    className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background"
                  >
                    <option value="ALL_ACTIVE">All Active Members</option>
                    <option value="BATCH">Specific Batch</option>
                    <option value="EXPIRING">Members Expiring Soon (Next 7 Days)</option>
                    <option value="PENDING_PAYMENT">Members with Pending Payments</option>
                    <option value="SPECIFIC_MEMBER">Specific Member (by Member ID)</option>
                  </select>
                </div>

                {/* Conditional Batch Select */}
                {selectedTargetType === 'BATCH' && (
                  <div className="space-y-2 p-3 rounded-lg border bg-muted/20">
                    <label className="text-xs font-medium text-muted-foreground">Select Batch</label>
                    <select
                      {...register('batchId', { required: selectedTargetType === 'BATCH' })}
                      className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                    >
                      <option value="">Select a batch...</option>
                      {batches.map((b) => (
                        <option key={b.id} value={b.id}>
                          {b.name}
                        </option>
                      ))}
                    </select>
                  </div>
                )}

                {/* Conditional Specific Member Input */}
                {selectedTargetType === 'SPECIFIC_MEMBER' && (
                  <div className="space-y-2 p-3 rounded-lg border bg-muted/20">
                    <label className="text-xs font-medium text-muted-foreground">Member ID (UUID)</label>
                    <Input
                      {...register('memberId', { required: selectedTargetType === 'SPECIFIC_MEMBER' })}
                      placeholder="e.g. 123e4567-e89b-12d3-a456-426614174000"
                    />
                  </div>
                )}

                <div className="space-y-2">
                  <label className="text-sm font-medium">Channels</label>
                  <div className="flex gap-4">
                    {['EMAIL', 'SMS', 'PUSH', 'IN_APP'].map((ch) => (
                      <label key={ch} className="flex items-center gap-2 text-sm">
                        <input type="checkbox" value={ch} {...register('channels')} />
                        {ch}
                      </label>
                    ))}
                  </div>
                </div>

                <div className="space-y-2">
                  <label className="text-sm font-medium">Title</label>
                  <Input
                    {...register('title', { required: true })}
                    placeholder="e.g. Special Holiday Hours / Maintenance Notice"
                  />
                </div>

                <div className="space-y-2">
                  <label className="text-sm font-medium">Message Content</label>
                  <Textarea
                    {...register('message', { required: true })}
                    rows={4}
                    placeholder="Write the announcement message that will be broadcast..."
                  />
                </div>

                <div className="space-y-2">
                  <label className="text-sm font-medium">Schedule for (optional)</label>
                  <Input
                    type="datetime-local"
                    {...register('scheduledAt')}
                  />
                </div>

                <Button type="submit" disabled={sending} className="gap-2">
                  <Send className="h-4 w-4" />
                  {sending ? 'Sending...' : 'Send Announcement'}
                </Button>
              </form>
            </CardContent>
          </Card>

          {/* Test Email Delivery Card */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <TestTube className="h-4 w-4 text-primary" />
                Test Email Delivery
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-xs text-muted-foreground">
                Verify your SMTP / Resend configuration by sending a real test email immediately.
              </p>
              <form onSubmit={handleSendTestEmail} className="space-y-3">
                <div>
                  <label className="text-xs font-medium text-muted-foreground">Recipient Email</label>
                  <Input
                    type="email"
                    placeholder="yourname@gmail.com"
                    value={testEmail}
                    onChange={(e) => setTestEmail(e.target.value)}
                    required
                    className="mt-1"
                  />
                </div>
                <Button
                  type="submit"
                  size="sm"
                  variant="outline"
                  disabled={testEmailSending || !testEmail}
                  className="w-full gap-1.5"
                >
                  <Mail className="h-3.5 w-3.5" />
                  {testEmailSending ? 'Sending test…' : 'Send Test Email'}
                </Button>
              </form>
              {testEmailResult && (
                <div
                  className={`p-3 rounded-lg text-xs ${
                    testEmailResult.success
                      ? 'bg-green-50 text-green-800 border border-green-200'
                      : 'bg-red-50 text-red-800 border border-red-200'
                  }`}
                >
                  {testEmailResult.message}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      )}

      {tab === 'announcements' && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Megaphone className="h-5 w-5" /> Announcements
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">
              Use the "Send Announcement" tab to broadcast a message to active
              members across Email, SMS, Push, or in-app channels — instantly or
              scheduled for later. Target filters include all active members, specific batches,
              members with expiring memberships, or members with pending payments.
            </p>
          </CardContent>
        </Card>
      )}

      {tab === 'templates' && <TemplatesPanel />}
    </div>
  );
}

interface TemplateItem {
  id?: string;
  name: string;
  type: string;
  channel: string;
  subject?: string;
  body: string;
  variables?: string[];
}

function TemplatesPanel() {
  const [templates, setTemplates] = useState<TemplateItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingTemplate, setEditingTemplate] = useState<TemplateItem | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const { toast } = useToast();

  const loadTemplates = async () => {
    try {
      const res: any = await api.get('/notifications/templates/list');
      setTemplates(res.data ?? []);
    } catch {
      setTemplates([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadTemplates();
  }, []);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingTemplate || !editingTemplate.name.trim() || !editingTemplate.body.trim()) return;
    setIsSaving(true);
    try {
      await api.post('/notifications/templates', {
        name: editingTemplate.name.trim(),
        type: editingTemplate.type || 'ANNOUNCEMENT',
        channel: editingTemplate.channel || 'EMAIL',
        subject: editingTemplate.subject?.trim() || undefined,
        body: editingTemplate.body.trim(),
        variables: editingTemplate.variables ?? [],
      });
      toast({ title: 'Template saved successfully' });
      setEditingTemplate(null);
      await loadTemplates();
    } catch (err: any) {
      toast({
        title: 'Failed to save template',
        description: err?.response?.data?.message || err.message,
        variant: 'destructive',
      });
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>Notification Templates</CardTitle>
          <Button
            size="sm"
            onClick={() =>
              setEditingTemplate({
                name: '',
                type: 'ANNOUNCEMENT',
                channel: 'EMAIL',
                subject: '',
                body: '',
              })
            }
          >
            <Plus className="h-4 w-4 mr-1" />
            New Template
          </Button>
        </CardHeader>
        <CardContent>
          {loading ? (
            <p className="text-sm text-muted-foreground">Loading...</p>
          ) : templates.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No templates yet — expiry, birthday, payment success, and batch-change
              templates can be configured here.
            </p>
          ) : (
            <div className="grid gap-3 md:grid-cols-2">
              {templates.map((tpl) => (
                <div
                  key={tpl.id || tpl.name}
                  className="rounded-md border p-3 text-sm flex items-center justify-between"
                >
                  <div>
                    <div className="font-medium">{tpl.name}</div>
                    <div className="text-xs text-muted-foreground">
                      {tpl.channel} · {tpl.type}
                    </div>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setEditingTemplate({ ...tpl })}
                  >
                    Edit
                  </Button>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {editingTemplate && (
        <Card className="border-primary/50 bg-primary/5">
          <CardHeader>
            <CardTitle className="text-base">
              {editingTemplate.id ? `Edit Template: ${editingTemplate.name}` : 'Create Notification Template'}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSave} className="space-y-4 max-w-xl">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-medium text-muted-foreground">Template Name</label>
                  <Input
                    placeholder="e.g. PAYMENT_REMINDER"
                    value={editingTemplate.name}
                    onChange={(e) => setEditingTemplate({ ...editingTemplate, name: e.target.value })}
                    disabled={!!editingTemplate.id}
                    required
                  />
                </div>
                <div>
                  <label className="text-xs font-medium text-muted-foreground">Channel</label>
                  <select
                    className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background"
                    value={editingTemplate.channel}
                    onChange={(e) => setEditingTemplate({ ...editingTemplate, channel: e.target.value })}
                  >
                    <option value="EMAIL">EMAIL</option>
                    <option value="SMS">SMS</option>
                    <option value="PUSH">PUSH</option>
                    <option value="WHATSAPP">WHATSAPP</option>
                    <option value="IN_APP">IN_APP</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="text-xs font-medium text-muted-foreground">Notification Type</label>
                <select
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background"
                  value={editingTemplate.type}
                  onChange={(e) => setEditingTemplate({ ...editingTemplate, type: e.target.value })}
                >
                  <option value="ANNOUNCEMENT">ANNOUNCEMENT</option>
                  <option value="MEMBERSHIP_EXPIRY">MEMBERSHIP_EXPIRY</option>
                  <option value="PAYMENT_SUCCESS">PAYMENT_SUCCESS</option>
                  <option value="PAYMENT_FAILED">PAYMENT_FAILED</option>
                  <option value="BATCH_CHANGE">BATCH_CHANGE</option>
                  <option value="BIRTHDAY">BIRTHDAY</option>
                </select>
              </div>

              <div>
                <label className="text-xs font-medium text-muted-foreground">Subject (Optional for SMS/Push)</label>
                <Input
                  placeholder="e.g. Your membership is expiring soon"
                  value={editingTemplate.subject ?? ''}
                  onChange={(e) => setEditingTemplate({ ...editingTemplate, subject: e.target.value })}
                />
              </div>

              <div>
                <label className="text-xs font-medium text-muted-foreground">
                  Body (Use &#123;&#123;variable&#125;&#125; placeholders)
                </label>
                <Textarea
                  rows={4}
                  placeholder="e.g. Hello {{memberName}}, your membership at {{gymName}} will expire on {{expiryDate}}."
                  value={editingTemplate.body}
                  onChange={(e) => setEditingTemplate({ ...editingTemplate, body: e.target.value })}
                  required
                />
              </div>

              <div className="flex gap-2 pt-2">
                <Button type="submit" disabled={isSaving}>
                  {isSaving ? 'Saving...' : 'Save Template'}
                </Button>
                <Button type="button" variant="ghost" onClick={() => setEditingTemplate(null)}>
                  Cancel
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
