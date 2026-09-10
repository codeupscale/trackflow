'use client';

import { useEffect, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, ArrowRight, Loader2 } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import api from '@/lib/api';
import { currencyMeta } from '@/lib/money';

interface Preview {
  from: string;
  to: string;
  rate: number;
  counts: Record<string, number>;
  samples: { label: string; before: string; after: string }[];
}

interface Props {
  from: string;
  to: string | null;
  onOpenChange: (open: boolean) => void;
  onConverted: (currency: string) => void;
}

const COUNT_LABELS: Record<string, string> = {
  salary_structures: 'Salary grades',
  custom_salaries: 'Individual salary overrides',
  pay_components: 'Fixed pay components',
  project_rates: 'Project hourly rates',
  payslips_stamped: 'Existing payslips kept in ' /* + from, appended below */,
};

/**
 * Change the organization's currency, repricing what is already stored.
 *
 * The product holds one currency and never converts at read time, so switching
 * the code alone would restate rather than reprice: a 150,000 PKR salary would
 * begin reading as $150,000. The rate is applied to the data once, here, and
 * the operator confirms against real figures from their own org rather than a
 * description of what will happen.
 *
 * The rate is typed, not fetched. A payroll number should be traceable to a
 * decision someone made on a date, and an exchange-rate feed that is down at
 * the moment of the switch must not be able to half-convert an organization.
 */
export function CurrencyChangeDialog({ from, to, onOpenChange, onConverted }: Props) {
  const [rate, setRate] = useState('');
  const [preview, setPreview] = useState<Preview | null>(null);
  const queryClient = useQueryClient();

  useEffect(() => {
    if (to) {
      setRate('');
      setPreview(null);
    }
  }, [to]);

  const parsedRate = Number(rate);
  const rateIsUsable = rate.trim() !== '' && Number.isFinite(parsedRate) && parsedRate > 0;

  const previewMutation = useMutation({
    mutationFn: async () => {
      const res = await api.post('/settings/currency', {
        currency: to,
        rate: parsedRate,
        preview: true,
      });
      return res.data.data as Preview;
    },
    onSuccess: setPreview,
    onError: () => toast.error('Could not preview the conversion.'),
  });

  const convertMutation = useMutation({
    mutationFn: async () => {
      const res = await api.post('/settings/currency', { currency: to, rate: parsedRate });
      return res.data;
    },
    onSuccess: async (res) => {
      // Every screen that shows money reads the org currency, and the amounts
      // themselves have just changed underneath — so nothing cached is right.
      await queryClient.invalidateQueries();
      toast.success(res.message);
      onConverted(to!);
      onOpenChange(false);
    },
    onError: () => toast.error('Conversion failed. Nothing was changed.'),
  });

  // Recompute whenever the typed rate settles, so the numbers on screen always
  // belong to the rate in the box rather than to an earlier one.
  useEffect(() => {
    if (!to || !rateIsUsable) {
      setPreview(null);
      return;
    }
    const timer = setTimeout(() => previewMutation.mutate(), 400);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [to, rate]);

  const fromMeta = currencyMeta(from);
  const toMeta = currencyMeta(to);

  return (
    <Dialog open={Boolean(to)} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            Change currency
            <span className="inline-flex items-center gap-1.5 text-sm font-normal text-muted-foreground">
              {from} <ArrowRight className="h-3.5 w-3.5" /> {to}
            </span>
          </DialogTitle>
          <DialogDescription className="text-xs">
            Existing amounts are converted at the rate you enter. Nothing is fetched
            from an exchange service — the figure below is the one that will be used.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-1.5">
          <Label htmlFor="conversion-rate" className="text-xs">
            1 {from} = ? {to}
          </Label>
          <Input
            id="conversion-rate"
            type="number"
            step="any"
            min={0}
            inputMode="decimal"
            autoFocus
            placeholder={`e.g. 0.0036 (${fromMeta.symbol} 1 → ${toMeta.symbol} 0.0036)`}
            value={rate}
            onChange={(e) => setRate(e.target.value)}
            className="h-9 text-sm tabular-nums"
          />
        </div>

        {rateIsUsable && (previewMutation.isPending || !preview) ? (
          <div className="space-y-2 rounded-md border border-border/60 p-3">
            <Skeleton className="h-3 w-40" />
            <Skeleton className="h-3 w-full" />
            <Skeleton className="h-3 w-3/4" />
          </div>
        ) : preview ? (
          <div className="space-y-3 rounded-md border border-border/60 bg-muted/20 p-3">
            {/* Real grades from this org, not an illustration. Someone
                confirming a payroll-wide change should recognise the numbers. */}
            <div>
              <p className="mb-1.5 text-[0.6rem] font-medium uppercase tracking-wider text-muted-foreground">
                Your salary grades after conversion
              </p>
              <div className="space-y-1">
                {preview.samples.map((s) => (
                  <div key={s.label} className="flex items-baseline justify-between gap-3 text-[0.7rem]">
                    <span className="truncate text-muted-foreground">{s.label}</span>
                    <span className="shrink-0 tabular-nums">
                      <span className="text-muted-foreground line-through">{s.before}</span>
                      <ArrowRight className="mx-1.5 inline h-3 w-3 text-muted-foreground" />
                      <span className="font-medium text-foreground">{s.after}</span>
                    </span>
                  </div>
                ))}
              </div>
            </div>

            <div className="border-t border-border/50 pt-2">
              <p className="mb-1.5 text-[0.6rem] font-medium uppercase tracking-wider text-muted-foreground">
                What changes
              </p>
              <div className="grid grid-cols-2 gap-x-4 gap-y-1">
                {Object.entries(preview.counts)
                  .filter(([, n]) => n > 0)
                  .map(([key, n]) => (
                    <div key={key} className="flex items-baseline justify-between gap-2 text-[0.68rem]">
                      <span className="truncate text-muted-foreground">
                        {COUNT_LABELS[key] ?? key}
                        {key === 'payslips_stamped' ? from : ''}
                      </span>
                      <span className="shrink-0 font-medium tabular-nums">{n}</span>
                    </div>
                  ))}
              </div>
            </div>

            <p className="flex items-start gap-1.5 border-t border-border/50 pt-2 text-[0.65rem] text-muted-foreground">
              <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0 text-amber-500" />
              <span>
                Percentage components (like a 10% tax) are left alone — a ratio is
                not an amount. Payslips already issued keep {from} so they still
                read as what was paid.
              </span>
            </p>
          </div>
        ) : null}

        <DialogFooter className="gap-2">
          <Button variant="outline" size="sm" className="h-8 text-xs" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            size="sm"
            className="h-8 text-xs"
            disabled={!preview || convertMutation.isPending}
            onClick={() => convertMutation.mutate()}
          >
            {convertMutation.isPending && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
            Convert and switch to {to}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
