'use client';

import { useEffect, useState } from 'react';
import { Clock4, Loader2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { formatDuration } from '@/lib/check-in-time';
import type { EarlyCheckoutPayload } from '@/hooks/hr/use-check-in';

/** Fallback list, used only if the server payload has not arrived yet. */
const FALLBACK_CATEGORIES = [
  { value: 'medical', label: 'Medical appointment or unwell' },
  { value: 'family_emergency', label: 'Family emergency' },
  { value: 'personal_work', label: 'Personal work' },
  { value: 'travel', label: 'Travel or commute' },
  { value: 'official_work', label: 'Official work outside the office' },
  { value: 'other', label: 'Other' },
];

const NONE = '__none__';

/**
 * Round to whole minutes for display. The shortfall is measured to the second,
 * which is right for the arithmetic and wrong for the sentence: "Leaving 8h 12m
 * 52s early" reads like a stopwatch when the only thing being asked is roughly
 * how much of the day is missing.
 */
function toWholeMinutes(seconds: number): number {
  return Math.round(seconds / 60) * 60;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** How far short of the day's requirement they are, in seconds. */
  shortfallSeconds: number;
  /** Hours owed today, for the explanatory line. */
  requiredSeconds: number;
  categories?: { value: string; label: string }[];
  approvers?: { id: string; name: string }[];
  minNoteLength?: number;
  isPending: boolean;
  /** Called with the reason, or with undefined when they choose to skip it. */
  onConfirm: (payload?: EarlyCheckoutPayload) => void;
}

/**
 * Asked when someone checks out before their hours are done.
 *
 * The reason is NOT a condition of checking out. Blocking the button would not
 * produce better records — it would produce people who simply never check out,
 * and a missing checkout is a worse problem for HR than an unexplained early
 * one. So there are two ways forward and the consequence of each is stated
 * plainly on the buttons themselves, rather than being discovered the next day
 * on the attendance screen.
 */
export function EarlyCheckoutDialog({
  open,
  onOpenChange,
  shortfallSeconds,
  requiredSeconds,
  categories,
  approvers,
  minNoteLength = 10,
  isPending,
  onConfirm,
}: Props) {
  const [category, setCategory] = useState('');
  const [note, setNote] = useState('');
  const [approver, setApprover] = useState(NONE);

  // A fresh answer every time it opens — a reason left over from a previous
  // early day must never be submitted for this one by accident.
  useEffect(() => {
    if (!open) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setCategory('');
    setNote('');
    setApprover(NONE);
  }, [open]);

  const options = categories?.length ? categories : FALLBACK_CATEGORIES;

  // Base UI's Select.Value renders the raw VALUE unless the option list is
  // handed to Select.Root, which is how it maps a value back to its label.
  // Without this the trigger reads "medical" and "__none__" rather than the
  // sentences the employee actually picked.
  const approverItems = [
    { value: NONE, label: 'Nobody / not asked' },
    ...(approvers ?? []).map((a) => ({ value: a.id, label: a.name })),
  ];

  const trimmed = note.trim();
  const noteTooShort = trimmed.length > 0 && trimmed.length < minNoteLength;
  const canSubmit = category !== '' && !noteTooShort;

  const submitWithReason = () => {
    if (!canSubmit) return;
    onConfirm({
      early_checkout_category: category,
      early_checkout_reason: trimmed || undefined,
      early_checkout_approved_by: approver === NONE ? null : approver,
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-amber-500/10">
              <Clock4 className="h-3.5 w-3.5 text-amber-600 dark:text-amber-400" />
            </span>
            Leaving {formatDuration(toWholeMinutes(shortfallSeconds))} early
          </DialogTitle>
          <DialogDescription className="text-xs">
            Today asks for {formatDuration(requiredSeconds)}. Tell us why you are leaving
            now and the day is recorded with your reason instead of an unexplained
            early checkout.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-3 py-1">
          <div className="grid gap-1.5">
            <Label className="text-xs">Reason</Label>
            <Select items={options} value={category} onValueChange={(v) => setCategory(v ?? '')}>
              <SelectTrigger className="w-full px-3 text-xs data-[size=default]:h-9">
                <SelectValue placeholder="Choose a reason" />
              </SelectTrigger>
              <SelectContent>
                {options.map((o) => (
                  <SelectItem key={o.value} value={o.value} className="text-xs">
                    {o.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="early-checkout-note" className="text-xs">
              Details <span className="text-muted-foreground">(optional)</span>
            </Label>
            <Textarea
              id="early-checkout-note"
              rows={2}
              className="text-sm"
              placeholder="e.g. Dentist appointment at 5 PM"
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
            {noteTooShort && (
              <p className="text-[0.65rem] text-destructive">
                Please write at least {minNoteLength} characters, or leave it empty.
              </p>
            )}
          </div>

          <div className="grid gap-1.5">
            <Label className="text-xs">
              Approved by <span className="text-muted-foreground">(optional)</span>
            </Label>
            <Select items={approverItems} value={approver} onValueChange={(v) => setApprover(v ?? NONE)}>
              <SelectTrigger className="w-full px-3 text-xs data-[size=default]:h-9">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {approverItems.map((a) => (
                  <SelectItem key={a.value} value={a.value} className="text-xs">
                    {a.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-[0.65rem] text-muted-foreground">
              Name the manager or HR person who allowed it, if you asked someone.
            </p>
          </div>
        </div>

        <DialogFooter className="gap-2 sm:flex-col-reverse sm:items-stretch">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-8 text-xs text-muted-foreground"
            disabled={isPending}
            onClick={() => onConfirm(undefined)}
          >
            Check out without a reason
          </Button>
          <Button
            type="button"
            size="sm"
            className="h-8 text-xs"
            disabled={!canSubmit || isPending}
            onClick={submitWithReason}
          >
            {isPending && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
            Submit reason &amp; check out
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
