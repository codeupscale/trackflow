'use client';

import { BellOff, Loader2 } from 'lucide-react';
import { toast } from 'sonner';

import { Card, CardContent } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import {
  useNotificationPreferences,
  useUpdateNotificationPreferences,
  type NotificationPreferenceGroup,
} from '@/hooks/use-notifications';

/**
 * Per-group switches for what arrives in the bell.
 *
 * A switch that is ON means "notify me". Muting is the exception a person opts
 * into, so the default state of every row is on, and the copy talks about what
 * you receive rather than what you have silenced.
 *
 * Grouped into "About the organisation" and "About you", because those are two
 * different decisions: turning down the org-activity stream is noise control,
 * turning off your own payslip notification is something to do knowingly.
 */
export function NotificationPreferences() {
  const { data: groups, isLoading, isError } = useNotificationPreferences();
  const update = useUpdateNotificationPreferences();

  const toggle = (group: NotificationPreferenceGroup, receive: boolean) => {
    if (!groups) return;

    const muted = groups
      .filter((g) => (g.key === group.key ? !receive : g.muted))
      .map((g) => g.key);

    update.mutate(muted, {
      onError: () => toast.error('Could not save your notification settings.'),
    });
  };

  if (isLoading) {
    return (
      <Card>
        <CardContent className="p-0">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="flex items-center justify-between gap-4 border-b border-border/50 px-4 py-3 last:border-0">
              <div className="flex-1 space-y-2">
                <div className="h-3 w-40 animate-pulse rounded bg-muted" />
                <div className="h-2.5 w-64 animate-pulse rounded bg-muted" />
              </div>
              <div className="h-4 w-7 animate-pulse rounded-full bg-muted" />
            </div>
          ))}
        </CardContent>
      </Card>
    );
  }

  if (isError || !groups) {
    return (
      <Card className="border-destructive/50">
        <CardContent className="py-12">
          <div className="flex flex-col items-center gap-2 text-center">
            <BellOff className="h-8 w-8 text-destructive/60" />
            <p className="text-sm font-medium text-muted-foreground">Could not load your settings</p>
            <p className="text-xs text-muted-foreground">Please try again later.</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  const sections = [
    { title: 'About the organisation', hint: 'Activity across the team.', items: groups.filter((g) => g.audience === 'org') },
    { title: 'About you', hint: 'Things addressed to you personally.', items: groups.filter((g) => g.audience === 'personal') },
  ].filter((s) => s.items.length > 0);

  return (
    <div className="flex flex-col gap-4">
      <p className="text-xs text-muted-foreground">
        Turn off anything you don&apos;t need to hear about. Muted notifications
        don&apos;t appear in your bell. Your payslip email is always sent.
      </p>

      {sections.map((section) => (
        <div key={section.title} className="flex flex-col gap-2">
          <div>
            <h3 className="text-sm font-semibold tracking-tight">{section.title}</h3>
            <p className="text-[0.7rem] text-muted-foreground">{section.hint}</p>
          </div>

          <Card>
            <CardContent className="p-0">
              <div className="divide-y divide-border/60">
                {section.items.map((group) => {
                  const receiving = !group.muted;
                  const inputId = `notif-pref-${group.key}`;

                  return (
                    <div key={group.key} className="flex items-center justify-between gap-4 px-4 py-3">
                      <label htmlFor={inputId} className="min-w-0 flex-1 cursor-pointer">
                        <p className="text-[0.8rem] font-medium text-foreground">{group.label}</p>
                        <p className="mt-0.5 text-[0.7rem] text-muted-foreground">{group.description}</p>
                      </label>
                      <Switch
                        id={inputId}
                        checked={receiving}
                        onCheckedChange={(checked) => toggle(group, checked)}
                        aria-label={`${receiving ? 'Mute' : 'Unmute'} ${group.label}`}
                      />
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>
        </div>
      ))}

      {update.isPending && (
        <p className="flex items-center gap-1.5 text-[0.7rem] text-muted-foreground">
          <Loader2 className="h-3 w-3 animate-spin" />
          Saving…
        </p>
      )}
    </div>
  );
}
