import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { Bell, Mail, MessageSquare, Send, Megaphone, CheckCircle2, XCircle, Clock } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
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
        setLogs(res.data?.data ?? []);
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

function TemplatesPanel() {
  const [templates, setTemplates] = useState<{ id: string; name: string; channel: string }[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const res: any = await api.get('/notifications/templates/list');
        setTemplates(res.data ?? []);
      } catch {
        setTemplates([]);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Notification Templates</CardTitle>
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
                key={tpl.id}
                className="rounded-md border p-3 text-sm flex items-center justify-between"
              >
                <span>
                  {tpl.name} <span className="text-muted-foreground">({tpl.channel})</span>
                </span>
                <Button variant="ghost" size="sm">
                  Edit
                </Button>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
