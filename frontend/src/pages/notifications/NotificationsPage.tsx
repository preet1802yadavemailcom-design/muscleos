import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { Bell, Mail, MessageSquare, Send, Megaphone, CheckCircle2, XCircle, Clock, Plus } from 'lucide-react';
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
  scheduledAt?: string;
}

export function NotificationsPage() {
  const [tab, setTab] = useState<Tab>('logs');
  const [logs, setLogs] = useState<NotificationLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [sendResult, setSendResult] = useState('');

  const { register, handleSubmit, reset } = useForm<SendForm>({
    defaultValues: { channels: ['EMAIL'] },
  });

  useEffect(() => {
    (async () => {
      try {
        const res: any = await api.get('/notifications');
        setLogs(res.data ?? []);
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
        scheduledAt: data.scheduledAt || undefined,
      });
      setSendResult('Announcement queued to all active members.');
      reset();
    } catch (err: any) {
      setSendResult(err.response?.data?.message || 'Failed to send notification');
    } finally {
      setSending(false);
    }
  };

  const tabs: { key: Tab; label: string }[] = [
    { key: 'logs', label: 'Delivery Logs' },
    { key: 'send', label: 'Send Notification' },
    { key: 'announcements', label: 'Announcements' },
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
        <Card>
          <CardHeader>
            <CardTitle>Send an Announcement</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit(onSend)} className="space-y-4 max-w-lg">
              {sendResult && (
                <div className="rounded-lg bg-muted p-3 text-sm">{sendResult}</div>
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
                <p className="text-xs text-muted-foreground">
                  Sent to every active member of your gym on the selected channels.
                </p>
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">Title</label>
                <input
                  {...register('title', { required: true })}
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                  placeholder="Membership renewal reminder"
                />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">Message</label>
                <textarea
                  {...register('message', { required: true })}
                  rows={4}
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                  placeholder="Your membership expires in 3 days..."
                />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">Schedule for (optional)</label>
                <input
                  type="datetime-local"
                  {...register('scheduledAt')}
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                />
              </div>
              <Button type="submit" disabled={sending}>
                <Send className="h-4 w-4 mr-2" />
                {sending ? 'Sending...' : 'Send Announcement'}
              </Button>
            </form>
          </CardContent>
        </Card>
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
              Use the "Send Announcement" tab to broadcast a message to every active
              member across Email, SMS, Push, or in-app channels — instantly or
              scheduled for later.
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
