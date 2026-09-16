'use client';

import { useEffect, useState } from 'react';
import { Loader2, Package } from 'lucide-react';

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
import {
  ASSET_CATEGORIES,
  ASSET_CONDITIONS,
  categoryLabel,
  useCreateAsset,
  useUpdateAsset,
  type Asset,
  type AssetInput,
} from '@/hooks/hr/use-assets';
import { useCurrency } from '@/lib/money';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Present when editing; absent when adding a new item. */
  asset?: Asset | null;
}

const categoryItems = ASSET_CATEGORIES.map((c) => ({ value: c, label: categoryLabel(c) }));
const conditionItems = ASSET_CONDITIONS.map((c) => ({ value: c, label: c.charAt(0).toUpperCase() + c.slice(1) }));

// Editable statuses only. "Assigned" is absent on purpose: an item changes
// hands through Assign and Return, which is what keeps every hand-over on record.
const statusItems = [
  { value: 'available', label: 'Available' },
  { value: 'in_repair', label: 'In repair' },
  { value: 'retired', label: 'Retired' },
  { value: 'lost', label: 'Lost' },
];

const empty = (): AssetInput => ({
  name: '',
  category: 'laptop',
  brand: '',
  model: '',
  serial_number: '',
  purchase_date: '',
  purchase_cost: '',
  warranty_expires_on: '',
  condition: 'new',
  status: 'available',
  notes: '',
});

/**
 * A quiet section label with a rule, so a ten-field form reads as three short
 * groups instead of one long column.
 */
function SectionHeading({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2 pt-1 first:pt-0">
      <span className="text-[0.62rem] font-semibold uppercase tracking-wider text-muted-foreground">{children}</span>
      <span className="h-px flex-1 bg-border/70" />
    </div>
  );
}

export function AssetFormDialog({ open, onOpenChange, asset }: Props) {
  const editing = !!asset;
  const currency = useCurrency();
  const [form, setForm] = useState<AssetInput>(empty);
  const create = useCreateAsset();
  const update = useUpdateAsset();
  const pending = create.isPending || update.isPending;

  // Re-seed each time the dialog opens, so editing item B never shows item A's
  // leftover values and "Add" never starts pre-filled.
  useEffect(() => {
    if (!open) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setForm(asset ? {
      name: asset.name,
      category: asset.category,
      brand: asset.brand ?? '',
      model: asset.model ?? '',
      serial_number: asset.serial_number ?? '',
      purchase_date: asset.purchase_date ?? '',
      purchase_cost: asset.purchase_cost ?? '',
      warranty_expires_on: asset.warranty_expires_on ?? '',
      condition: asset.condition,
      status: asset.status,
      notes: asset.notes ?? '',
    } : empty());
  }, [open, asset]);

  const set = <K extends keyof AssetInput>(key: K, value: AssetInput[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  const submit = () => {
    // Empty strings become null, so clearing a field really clears it rather
    // than failing date/number validation on "".
    const payload: AssetInput = Object.fromEntries(
      Object.entries(form).map(([k, v]) => [k, v === '' ? null : v]),
    ) as AssetInput;

    // An assigned item's status is owned by the hand-over, not by this form.
    if (editing && asset?.status === 'assigned') delete payload.status;

    const done = { onSuccess: () => onOpenChange(false) };

    if (editing && asset) update.mutate({ id: asset.id, input: payload }, done);
    else create.mutate(payload, done);
  };

  const isAssigned = editing && asset?.status === 'assigned';

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary/10">
              <Package className="h-3.5 w-3.5 text-primary" />
            </span>
            {editing ? `Edit ${asset?.asset_tag}` : 'Add item'}
          </DialogTitle>
          <DialogDescription className="text-xs">
            {editing
              ? 'Update the details. To give it to someone or take it back, use Assign or Return.'
              : 'A tag like AST-0001 is created automatically for the sticker.'}
          </DialogDescription>
        </DialogHeader>

        <div className="grid max-h-[65vh] gap-3 overflow-y-auto py-1 pr-1">
          <SectionHeading>Item details</SectionHeading>

          <div className="grid gap-1.5">
            <Label htmlFor="asset-name" className="text-xs">Name</Label>
            <Input id="asset-name" className="h-9 text-sm" placeholder="e.g. MacBook Pro 14" value={form.name ?? ''} onChange={(e) => set('name', e.target.value)} />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <Label className="text-xs">Category</Label>
              <Select items={categoryItems} value={form.category ?? 'laptop'} onValueChange={(v) => v && set('category', v as AssetInput['category'])}>
                <SelectTrigger className="h-9 w-full px-3 text-sm data-[size=default]:h-9"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {categoryItems.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-1.5">
              <Label className="text-xs">Condition</Label>
              <Select items={conditionItems} value={form.condition ?? 'good'} onValueChange={(v) => v && set('condition', v as AssetInput['condition'])}>
                <SelectTrigger className="h-9 w-full px-3 text-sm data-[size=default]:h-9"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {conditionItems.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="asset-brand" className="text-xs">Brand</Label>
              <Input id="asset-brand" className="h-9 text-sm" placeholder="Apple" value={form.brand ?? ''} onChange={(e) => set('brand', e.target.value)} />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="asset-model" className="text-xs">Model</Label>
              <Input id="asset-model" className="h-9 text-sm" placeholder="M3 Pro, 2024" value={form.model ?? ''} onChange={(e) => set('model', e.target.value)} />
            </div>
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="asset-serial" className="text-xs">Serial number <span className="font-normal text-muted-foreground">(optional)</span></Label>
            <Input id="asset-serial" className="h-9 font-mono text-sm" placeholder="e.g. C02XK1ABMD6T" value={form.serial_number ?? ''} onChange={(e) => set('serial_number', e.target.value)} />
          </div>

          <SectionHeading>Purchase &amp; warranty</SectionHeading>

          <div className="grid grid-cols-3 gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="asset-purchased" className="text-xs">Purchased</Label>
              <Input id="asset-purchased" type="date" className="h-9 text-xs" value={form.purchase_date ?? ''} onChange={(e) => set('purchase_date', e.target.value)} />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="asset-cost" className="text-xs">Cost</Label>
              <div className="relative">
                <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[0.7rem] font-medium text-muted-foreground">{currency}</span>
                <Input id="asset-cost" type="number" min="0" step="0.01" className="h-9 text-sm tabular-nums" style={{ paddingLeft: `${currency.length * 0.45 + 1.1}rem` }} placeholder="0" value={form.purchase_cost ?? ''} onChange={(e) => set('purchase_cost', e.target.value)} />
              </div>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="asset-warranty" className="text-xs">Warranty ends</Label>
              <Input id="asset-warranty" type="date" className="h-9 text-xs" value={form.warranty_expires_on ?? ''} min={form.purchase_date || undefined} onChange={(e) => set('warranty_expires_on', e.target.value)} />
            </div>
          </div>

          <SectionHeading>{editing ? 'Status & notes' : 'Notes'}</SectionHeading>

          {editing && (
            <div className="grid gap-1.5">
              <Label className="text-xs">Status</Label>
              {isAssigned ? (
                <p className="rounded-md border border-border/60 bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
                  Assigned to {asset?.holder?.name ?? 'someone'}. Record the return to change its status.
                </p>
              ) : (
                <Select items={statusItems} value={form.status ?? 'available'} onValueChange={(v) => v && set('status', v as AssetInput['status'])}>
                  <SelectTrigger className="h-9 w-full px-3 text-sm data-[size=default]:h-9"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {statusItems.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              )}
            </div>
          )}

          <div className="grid gap-1.5">
            <Label htmlFor="asset-notes" className="sr-only">Notes</Label>
            <Textarea id="asset-notes" rows={2} className="text-sm" placeholder="Accessories, location, anything useful" value={form.notes ?? ''} onChange={(e) => set('notes', e.target.value)} />
          </div>
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" size="sm" className="h-8 text-xs" onClick={() => onOpenChange(false)} disabled={pending}>
            Cancel
          </Button>
          <Button size="sm" className="h-8 text-xs" onClick={submit} disabled={pending || !form.name}>
            {pending && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
            {editing ? 'Save changes' : 'Add item'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
