'use client';

import {
  Armchair,
  CalendarClock,
  CreditCard,
  IdCard,
  Info,
  KeyRound,
  Laptop,
  Monitor,
  Mouse,
  Package,
  PcCase,
  ShieldAlert,
  ShieldCheck,
  Smartphone,
  Tablet,
  UserRound,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

import { Card, CardContent } from '@/components/ui/card';
import { cn, formatDate } from '@/lib/utils';
import { categoryLabel, type Asset, type AssetCondition } from '@/hooks/hr/use-assets';

const CATEGORY_ICON: Record<string, LucideIcon> = {
  laptop: Laptop,
  desktop: PcCase,
  monitor: Monitor,
  phone: Smartphone,
  tablet: Tablet,
  sim_card: CreditCard,
  id_card: IdCard,
  accessory: Mouse,
  furniture: Armchair,
  software_license: KeyRound,
  other: Package,
};

/** Condition as a pill: green is fine, amber is worth watching, red is a problem. */
const CONDITION_LOOK: Record<AssetCondition, string> = {
  new: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
  good: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
  fair: 'bg-amber-500/10 text-amber-600 dark:text-amber-400',
  poor: 'bg-orange-500/10 text-orange-600 dark:text-orange-400',
  damaged: 'bg-red-500/10 text-red-600 dark:text-red-400',
};

function daysUntil(date: string): number {
  return Math.ceil((new Date(date).getTime() - Date.now()) / 86_400_000);
}

function Detail({ label, children, tone }: { label: string; children: React.ReactNode; tone?: 'warn' | 'muted' }) {
  return (
    <div className="min-w-0">
      <dt className="text-[0.6rem] font-medium uppercase tracking-wider text-muted-foreground">{label}</dt>
      <dd
        className={cn(
          'mt-0.5 truncate text-[0.78rem]',
          tone === 'warn' ? 'font-medium text-amber-600 dark:text-amber-400' : tone === 'muted' ? 'text-muted-foreground' : 'text-foreground',
        )}
      >
        {children}
      </dd>
    </div>
  );
}

/**
 * "My company items" — what an employee holds, laid out as a receipt.
 *
 * Every field is labelled. The earlier version listed bare values ("JKJKD8923J",
 * "Dell new · M3 PRO") and left the reader to guess which was the serial and
 * which the model. The hand-over itself — when, and from whom — is the part an
 * employee most often needs, so it sits alongside the item's own details.
 */
export function MyAssetsView({ assets, onOpen }: { assets: Asset[]; onOpen: (asset: Asset) => void }) {
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-start gap-2.5 rounded-lg border border-blue-500/20 bg-blue-500/5 px-3.5 py-2.5">
        <Info className="mt-0.5 h-4 w-4 shrink-0 text-blue-600 dark:text-blue-400" />
        <p className="text-xs leading-relaxed text-muted-foreground">
          You have <span className="font-semibold text-foreground">{assets.length} company {assets.length === 1 ? 'item' : 'items'}</span>.
          They belong to the company — if anything is lost or damaged, let HR know straight away.
        </p>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {assets.map((a) => {
          const Icon = CATEGORY_ICON[a.category] ?? Package;
          const hand = a.open_assignment ?? null;
          const returnIn = hand?.expected_return_on ? daysUntil(hand.expected_return_on) : null;
          const warrantyIn = a.warranty_expires_on ? daysUntil(a.warranty_expires_on) : null;

          return (
            <Card
              key={a.id}
              role="button"
              tabIndex={0}
              onClick={() => onOpen(a)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  onOpen(a);
                }
              }}
              className="cursor-pointer gap-0 overflow-hidden py-0 transition-colors hover:border-primary/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <CardContent className="p-0">
                {/* Identity */}
                <div className="flex items-start gap-3 px-4 py-4">
                  <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-primary/10">
                    <Icon className="h-5 w-5 text-primary" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-start justify-between gap-2">
                      <p className="truncate text-sm font-semibold text-foreground">{a.name}</p>
                      <span className={cn('shrink-0 rounded-full px-2 py-0.5 text-[0.62rem] font-medium capitalize', CONDITION_LOOK[a.condition])}>
                        {a.condition}
                      </span>
                    </div>
                    <p className="truncate text-xs text-muted-foreground">
                      {[a.brand, a.model].filter(Boolean).join(' · ') || categoryLabel(a.category)}
                    </p>
                    <span className="mt-1.5 inline-block rounded bg-muted px-1.5 py-0.5 font-mono text-[0.65rem] text-muted-foreground">
                      {a.asset_tag}
                    </span>
                  </div>
                </div>

                {/* Details */}
                <dl className="grid grid-cols-2 gap-x-4 gap-y-3 border-t border-border/60 bg-muted/20 px-4 py-3.5">
                  <Detail label="Category">{categoryLabel(a.category)}</Detail>
                  <Detail label="Serial number" tone={a.serial_number ? undefined : 'muted'}>
                    <span className={a.serial_number ? 'font-mono' : undefined}>{a.serial_number ?? 'Not recorded'}</span>
                  </Detail>

                  <Detail label="Assigned on" tone={hand ? undefined : 'muted'}>
                    {hand ? formatDate(hand.assigned_at) : '—'}
                  </Detail>
                  <Detail label="Assigned by" tone={hand?.assigner ? undefined : 'muted'}>
                    <span className="inline-flex items-center gap-1">
                      {hand?.assigner && <UserRound className="h-3 w-3 text-muted-foreground" />}
                      {hand?.assigner?.name ?? '—'}
                    </span>
                  </Detail>

                  <Detail
                    label="Return by"
                    tone={returnIn === null ? 'muted' : returnIn <= 7 ? 'warn' : undefined}
                  >
                    <span className="inline-flex items-center gap-1">
                      {returnIn !== null && <CalendarClock className="h-3 w-3" />}
                      {returnIn === null
                        ? 'Yours to keep for now'
                        : returnIn < 0
                          ? `Overdue since ${formatDate(hand!.expected_return_on!)}`
                          : `${formatDate(hand!.expected_return_on!)}${returnIn <= 7 ? ` · ${returnIn}d left` : ''}`}
                    </span>
                  </Detail>
                  <Detail
                    label="Warranty"
                    tone={warrantyIn === null ? 'muted' : warrantyIn >= 0 && warrantyIn <= 30 ? 'warn' : undefined}
                  >
                    <span className="inline-flex items-center gap-1">
                      {warrantyIn !== null &&
                        (warrantyIn >= 0 && warrantyIn <= 30
                          ? <ShieldAlert className="h-3 w-3" />
                          : <ShieldCheck className="h-3 w-3 text-muted-foreground" />)}
                      {warrantyIn === null
                        ? 'Not recorded'
                        : warrantyIn < 0
                          ? 'Ended'
                          : `Until ${formatDate(a.warranty_expires_on!)}${warrantyIn <= 30 ? ` · ${warrantyIn}d left` : ''}`}
                    </span>
                  </Detail>
                </dl>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
