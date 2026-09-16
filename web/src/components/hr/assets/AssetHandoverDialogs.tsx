'use client';

import { useEffect, useState } from 'react';
import { Loader2, PackageCheck, PackageOpen } from 'lucide-react';

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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { UserCombobox } from '@/components/time-entries/UserCombobox';
import {
  ASSET_CONDITIONS,
  useAssignAsset,
  useReturnAsset,
  type Asset,
  type AssetCondition,
} from '@/hooks/hr/use-assets';

/** Today as YYYY-MM-DD in LOCAL time — toISOString() would report yesterday west of UTC. */
function todayIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

interface Props {
  asset: Asset | null;
  onOpenChange: (open: boolean) => void;
}

// ── Assign ─────────────────────────────────────────────────────────────

export function AssignAssetDialog({ asset, onOpenChange }: Props) {
  const [userId, setUserId] = useState<string | null>(null);
  const [returnBy, setReturnBy] = useState('');
  const [notes, setNotes] = useState('');
  const assign = useAssignAsset();

  useEffect(() => {
    if (!asset) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setUserId(null);
    setReturnBy('');
    setNotes('');
  }, [asset]);

  const submit = () => {
    if (!asset || !userId) return;
    assign.mutate(
      { id: asset.id, user_id: userId, expected_return_on: returnBy || null, notes: notes || null },
      { onSuccess: () => onOpenChange(false) },
    );
  };

  return (
    <Dialog open={!!asset} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-blue-500/10">
              <PackageOpen className="h-3.5 w-3.5 text-blue-600 dark:text-blue-400" />
            </span>
            Assign {asset?.name}
          </DialogTitle>
          <DialogDescription className="text-xs">
            {asset?.asset_tag} · recorded in condition <span className="font-medium text-foreground">{asset?.condition}</span>.
            The person is notified.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-3 py-1">
          <div className="grid gap-1.5">
            <Label className="text-xs">Give it to</Label>
            <UserCombobox value={userId} onChange={setUserId} placeholder="Choose a team member" enabled={!!asset} />
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="asset-return-by" className="text-xs">Return by <span className="text-muted-foreground">(optional)</span></Label>
            <Input id="asset-return-by" type="date" className="h-9 text-xs" min={todayIso()} value={returnBy} onChange={(e) => setReturnBy(e.target.value)} />
            <p className="text-[0.65rem] text-muted-foreground">Leave empty for items kept for the whole job, like a work laptop.</p>
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="asset-assign-notes" className="text-xs">Hand-over notes <span className="text-muted-foreground">(optional)</span></Label>
            <Textarea id="asset-assign-notes" rows={2} className="text-sm" placeholder="e.g. With charger and case" value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>
        </div>

        <DialogFooter className="gap-2">
          <Button type="button" variant="outline" size="sm" className="h-8 text-xs" onClick={() => onOpenChange(false)} disabled={assign.isPending}>Cancel</Button>
          <Button type="button" size="sm" className="h-8 text-xs" onClick={submit} disabled={!userId || assign.isPending}>
            {assign.isPending && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
            Assign
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Return ─────────────────────────────────────────────────────────────

const conditionItems = ASSET_CONDITIONS.map((c) => ({ value: c, label: c.charAt(0).toUpperCase() + c.slice(1) }));

const outcomeItems = [
  { value: 'available', label: 'Back in stock — ready to hand out' },
  { value: 'in_repair', label: 'Needs repair' },
  { value: 'lost', label: 'Not returned — record as lost' },
];

export function ReturnAssetDialog({ asset, onOpenChange }: Props) {
  const [condition, setCondition] = useState<AssetCondition>('good');
  const [outcome, setOutcome] = useState<'available' | 'in_repair' | 'lost'>('available');
  const [notes, setNotes] = useState('');
  const record = useReturnAsset();

  useEffect(() => {
    if (!asset) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setCondition(asset.condition);
    setOutcome('available');
    setNotes('');
  }, [asset]);

  const submit = () => {
    if (!asset) return;
    record.mutate(
      { id: asset.id, condition, status_after: outcome, notes: notes || null },
      { onSuccess: () => onOpenChange(false) },
    );
  };

  return (
    <Dialog open={!!asset} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-emerald-500/10">
              <PackageCheck className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />
            </span>
            Record return
          </DialogTitle>
          <DialogDescription className="text-xs">
            {asset?.name} ({asset?.asset_tag}) from{' '}
            <span className="font-medium text-foreground">{asset?.holder?.name ?? 'the current holder'}</span>.
            It was handed over in condition <span className="font-medium text-foreground">{asset?.condition}</span>.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-3 py-1">
          <div className="grid gap-1.5">
            <Label className="text-xs">Condition now</Label>
            <Select items={conditionItems} value={condition} onValueChange={(v) => v && setCondition(v as AssetCondition)}>
              <SelectTrigger className="h-9 w-full px-3 text-sm data-[size=default]:h-9"><SelectValue /></SelectTrigger>
              <SelectContent>
                {conditionItems.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          <div className="grid gap-1.5">
            <Label className="text-xs">What happens next</Label>
            <Select items={outcomeItems} value={outcome} onValueChange={(v) => v && setOutcome(v as typeof outcome)}>
              <SelectTrigger className="h-9 w-full px-3 text-sm data-[size=default]:h-9"><SelectValue /></SelectTrigger>
              <SelectContent>
                {outcomeItems.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="asset-return-notes" className="text-xs">Notes <span className="text-muted-foreground">(optional)</span></Label>
            <Textarea id="asset-return-notes" rows={2} className="text-sm" placeholder="e.g. Charger missing, screen scratched" value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>
        </div>

        <DialogFooter className="gap-2">
          <Button type="button" variant="outline" size="sm" className="h-8 text-xs" onClick={() => onOpenChange(false)} disabled={record.isPending}>Cancel</Button>
          <Button type="button" size="sm" className="h-8 text-xs" onClick={submit} disabled={record.isPending}>
            {record.isPending && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
            Record return
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
