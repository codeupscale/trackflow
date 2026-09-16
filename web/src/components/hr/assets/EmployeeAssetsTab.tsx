'use client';

import { useEffect, useState } from 'react';
import { Loader2, Package, PackageCheck, PackageOpen, Plus } from 'lucide-react';

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
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import { usePermissionStore } from '@/stores/permission-store';
import {
  categoryLabel,
  useAssets,
  useAssignAsset,
  type Asset,
} from '@/hooks/hr/use-assets';
import { ReturnAssetDialog } from './AssetHandoverDialogs';

interface Props {
  /** The employee record from the profile modal. Assets belong to the USER. */
  employee: { id: string; user_id?: string | null; user?: { name?: string } | null; name?: string };
  editing: boolean;
}

/** Today as YYYY-MM-DD in LOCAL time — toISOString() would report yesterday west of UTC. */
function todayIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/**
 * The company items one employee holds, inside their profile.
 *
 * View mode lists them. Edit mode adds Assign and Return, for whoever can manage
 * assets — the profile's own edit rights are not enough, because a hand-over is
 * a different right from editing someone's details.
 *
 * Every action goes through the SAME assign and return endpoints as the Assets
 * page, so the rules — one person per item, history kept, the employee notified
 * — are enforced in one place and cannot drift between the two screens.
 *
 * Every button here is type="button": this tab renders inside the profile's
 * <form>, and a default submit button would save the employee profile instead.
 */
export function EmployeeAssetsTab({ employee, editing }: Props) {
  const userId = employee.user_id ?? employee.id;
  const personName = employee.user?.name ?? employee.name ?? 'this employee';

  const { hasPermission } = usePermissionStore();
  const canManage = hasPermission('assets.manage');

  const { data, isLoading, isError } = useAssets({ holder_id: userId, per_page: 100 });
  const held = data?.data ?? [];

  const [assignOpen, setAssignOpen] = useState(false);
  const [returning, setReturning] = useState<Asset | null>(null);

  const showActions = editing && canManage;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Package className="h-4 w-4 text-blue-500" />
          <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Company items {held.length > 0 && `(${held.length})`}
          </h3>
        </div>
        {showActions && (
          <Button type="button" size="sm" className="h-7 px-3 text-xs" onClick={() => setAssignOpen(true)}>
            <Plus className="mr-1 h-3 w-3" />
            Assign item
          </Button>
        )}
      </div>

      {isLoading ? (
        <div className="space-y-2">{Array.from({ length: 2 }).map((_, i) => <Skeleton key={i} className="h-14" />)}</div>
      ) : isError ? (
        <p className="py-6 text-center text-xs text-muted-foreground">Could not load company items.</p>
      ) : held.length === 0 ? (
        <div className="flex flex-col items-center gap-2 py-6 text-center">
          <Package className="size-8 text-muted-foreground/60" />
          <p className="text-sm font-medium text-muted-foreground">No company items</p>
          <p className="text-xs text-muted-foreground">
            {showActions
              ? 'Use Assign item to give them a laptop, phone or ID card.'
              : canManage
                ? 'Click Edit to assign items to this employee.'
                : 'Nothing has been assigned yet.'}
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {held.map((a) => (
            <div key={a.id} className="flex items-center gap-3 rounded-lg border border-border/60 px-3 py-2.5">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-blue-500/10">
                <PackageOpen className="h-4 w-4 text-blue-600 dark:text-blue-400" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-[0.8rem] font-medium text-foreground">{a.name}</p>
                <p className="truncate text-[0.68rem] text-muted-foreground">
                  <span className="font-mono">{a.asset_tag}</span>
                  {' · '}{categoryLabel(a.category)}
                  {a.serial_number && <> · <span className="font-mono">{a.serial_number}</span></>}
                  {' · '}<span className="capitalize">{a.condition}</span>
                </p>
              </div>
              {showActions && (
                <Button type="button" variant="outline" size="sm" className="h-7 shrink-0 px-2.5 text-[0.65rem]" onClick={() => setReturning(a)}>
                  <PackageCheck className="mr-1 h-3 w-3" />
                  Return
                </Button>
              )}
            </div>
          ))}
        </div>
      )}

      <AssignToEmployeeDialog
        open={assignOpen}
        onOpenChange={setAssignOpen}
        userId={userId}
        personName={personName}
      />
      <ReturnAssetDialog asset={returning} onOpenChange={(o) => !o && setReturning(null)} />
    </div>
  );
}

// ── Pick an item for this person ───────────────────────────────────────

function AssignToEmployeeDialog({
  open,
  onOpenChange,
  userId,
  personName,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  userId: string;
  personName: string;
}) {
  const [assetId, setAssetId] = useState('');
  const [returnBy, setReturnBy] = useState('');
  const [notes, setNotes] = useState('');
  const assign = useAssignAsset();

  // Only items that can actually be handed out. The server refuses anything
  // else, but offering an item that is already with someone is a dead end.
  const { data, isLoading } = useAssets({ status: 'available', per_page: 100 });
  const available = data?.data ?? [];
  const items = available.map((a) => ({ value: a.id, label: `${a.asset_tag} · ${a.name}` }));
  const chosen = available.find((a) => a.id === assetId);

  useEffect(() => {
    if (!open) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setAssetId('');
    setReturnBy('');
    setNotes('');
  }, [open]);

  const submit = () => {
    if (!assetId) return;
    assign.mutate(
      { id: assetId, user_id: userId, expected_return_on: returnBy || null, notes: notes || null },
      { onSuccess: () => onOpenChange(false) },
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-blue-500/10">
              <PackageOpen className="h-3.5 w-3.5 text-blue-600 dark:text-blue-400" />
            </span>
            Assign an item
          </DialogTitle>
          <DialogDescription className="text-xs">
            To <span className="font-medium text-foreground">{personName}</span>. They are notified, and the hand-over is recorded.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-3 py-1">
          <div className="grid gap-1.5">
            <Label className="text-xs">Item</Label>
            {isLoading ? (
              <Skeleton className="h-9 w-full" />
            ) : available.length === 0 ? (
              <p className="rounded-md border border-dashed border-border px-3 py-3 text-center text-xs text-muted-foreground">
                No items are available. Add one on the Assets page, or record a return first.
              </p>
            ) : (
              <Select items={items} value={assetId} onValueChange={(v) => setAssetId(v ?? '')}>
                <SelectTrigger className="h-9 w-full px-3 text-sm data-[size=default]:h-9">
                  <SelectValue placeholder="Choose an available item" />
                </SelectTrigger>
                <SelectContent>
                  {items.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
                </SelectContent>
              </Select>
            )}
            {chosen && (
              <p className="text-[0.65rem] text-muted-foreground">
                {categoryLabel(chosen.category)}
                {chosen.serial_number && <> · <span className="font-mono">{chosen.serial_number}</span></>}
                {' · '}recorded as <span className="capitalize">{chosen.condition}</span>
              </p>
            )}
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="emp-asset-return-by" className="text-xs">Return by <span className="text-muted-foreground">(optional)</span></Label>
            <Input id="emp-asset-return-by" type="date" className="h-9 text-xs" min={todayIso()} value={returnBy} onChange={(e) => setReturnBy(e.target.value)} />
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="emp-asset-notes" className="text-xs">Hand-over notes <span className="text-muted-foreground">(optional)</span></Label>
            <Textarea id="emp-asset-notes" rows={2} className="text-sm" placeholder="e.g. With charger and case" value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>
        </div>

        <DialogFooter className="gap-2">
          <Button type="button" variant="outline" size="sm" className="h-8 text-xs" onClick={() => onOpenChange(false)} disabled={assign.isPending}>
            Cancel
          </Button>
          <Button type="button" size="sm" className="h-8 text-xs" onClick={submit} disabled={!assetId || assign.isPending}>
            {assign.isPending && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
            Assign
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
