'use client';

import { ArrowRightLeft, PackageCheck, PackageOpen, Pencil, ShieldAlert } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { formatDate } from '@/lib/utils';
import { useMoney } from '@/lib/money';
import { categoryLabel, useAsset, type Asset } from '@/hooks/hr/use-assets';
import { AssetStatusBadge } from './AssetStatusBadge';

interface Props {
  assetId: string | null;
  onOpenChange: (open: boolean) => void;
  canManage: boolean;
  onEdit: (asset: Asset) => void;
  onAssign: (asset: Asset) => void;
  onReturn: (asset: Asset) => void;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <p className="text-[0.6rem] font-medium uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className="mt-0.5 truncate text-[0.8rem] text-foreground">{children || <span className="text-muted-foreground/60">—</span>}</p>
    </div>
  );
}

/** Warranty state, because "ends 12 Oct" alone makes the reader do the maths. */
function warrantyNote(date: string | null): { text: string; urgent: boolean } | null {
  if (!date) return null;
  const days = Math.ceil((new Date(date).getTime() - Date.now()) / 86_400_000);
  if (days < 0) return { text: 'Warranty has ended', urgent: false };
  if (days <= 30) return { text: `Warranty ends in ${days} day${days === 1 ? '' : 's'}`, urgent: true };
  return null;
}

/**
 * One item: its details, what can be done with it, and every hand-over.
 *
 * The history is the heart of the screen, so it sits in the main column rather
 * than behind a tab: "who had this, and how did they return it" is the
 * question people open an item to answer.
 */
export function AssetDetailSheet({ assetId, onOpenChange, canManage, onEdit, onAssign, onReturn }: Props) {
  const { data, isLoading, isError } = useAsset(assetId);
  const money = useMoney();
  const asset = data?.data;
  const history = data?.history ?? [];
  const warranty = warrantyNote(asset?.warranty_expires_on ?? null);

  return (
    <Sheet open={!!assetId} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-lg">
        {isLoading || !asset ? (
          <div className="space-y-3 p-6">
            {isError ? (
              <p className="text-sm text-muted-foreground">Could not load this item.</p>
            ) : (
              <>
                <div className="h-5 w-40 animate-pulse rounded bg-muted" />
                <div className="h-3 w-24 animate-pulse rounded bg-muted" />
                <div className="h-24 w-full animate-pulse rounded bg-muted" />
              </>
            )}
          </div>
        ) : (
          <>
            <SheetHeader className="border-b border-border px-5 py-4">
              <div className="flex items-start justify-between gap-3 pr-6">
                <div className="min-w-0">
                  <SheetTitle className="truncate text-base font-semibold">{asset.name}</SheetTitle>
                  <SheetDescription className="mt-0.5 flex items-center gap-2 text-xs">
                    <span className="font-mono">{asset.asset_tag}</span>
                    <span>·</span>
                    <span>{categoryLabel(asset.category)}</span>
                  </SheetDescription>
                </div>
                <AssetStatusBadge status={asset.status} className="shrink-0" />
              </div>

              {canManage && (
                <div className="mt-3 flex flex-wrap gap-2">
                  {asset.status === 'available' && (
                    <Button size="sm" className="h-8 text-xs" onClick={() => onAssign(asset)}>
                      <PackageOpen className="mr-1.5 h-3.5 w-3.5" />
                      Assign
                    </Button>
                  )}
                  {asset.status === 'assigned' && (
                    <Button size="sm" className="h-8 text-xs" onClick={() => onReturn(asset)}>
                      <PackageCheck className="mr-1.5 h-3.5 w-3.5" />
                      Record return
                    </Button>
                  )}
                  <Button variant="outline" size="sm" className="h-8 text-xs" onClick={() => onEdit(asset)}>
                    <Pencil className="mr-1.5 h-3.5 w-3.5" />
                    Edit
                  </Button>
                </div>
              )}
            </SheetHeader>

            <div className="space-y-5 px-5 py-4">
              {asset.holder && (
                <div className="rounded-lg border border-blue-500/20 bg-blue-500/5 px-3 py-2.5">
                  <p className="text-[0.6rem] font-medium uppercase tracking-wider text-blue-600 dark:text-blue-400">With</p>
                  <p className="text-sm font-medium text-foreground">{asset.holder.name}</p>
                  <p className="text-[0.7rem] text-muted-foreground">{asset.holder.email}</p>
                </div>
              )}

              {warranty && (
                <p className={`flex items-center gap-1.5 text-xs ${warranty.urgent ? 'text-amber-600 dark:text-amber-400' : 'text-muted-foreground'}`}>
                  <ShieldAlert className="h-3.5 w-3.5" />
                  {warranty.text}
                </p>
              )}

              <div className="grid grid-cols-2 gap-x-4 gap-y-3">
                <Field label="Brand">{asset.brand}</Field>
                <Field label="Model">{asset.model}</Field>
                <Field label="Serial number"><span className="font-mono">{asset.serial_number}</span></Field>
                <Field label="Condition"><span className="capitalize">{asset.condition}</span></Field>
                <Field label="Purchased">{asset.purchase_date ? formatDate(asset.purchase_date) : null}</Field>
                <Field label="Cost">{asset.purchase_cost ? money(Number(asset.purchase_cost)) : null}</Field>
                <Field label="Warranty ends">{asset.warranty_expires_on ? formatDate(asset.warranty_expires_on) : null}</Field>
              </div>

              {asset.notes && (
                <div>
                  <p className="text-[0.6rem] font-medium uppercase tracking-wider text-muted-foreground">Notes</p>
                  <p className="mt-1 whitespace-pre-line text-[0.8rem] text-foreground">{asset.notes}</p>
                </div>
              )}

              <div>
                <div className="mb-2 flex items-center gap-1.5">
                  <ArrowRightLeft className="h-3.5 w-3.5 text-muted-foreground" />
                  <h3 className="text-xs font-semibold">Hand-over history</h3>
                </div>

                {history.length === 0 ? (
                  <p className="rounded-lg border border-dashed border-border px-3 py-4 text-center text-xs text-muted-foreground">
                    Never assigned yet.
                  </p>
                ) : (
                  <ol className="relative space-y-3 border-l border-border pl-4">
                    {history.map((h) => (
                      <li key={h.id} className="relative">
                        <span className={`absolute -left-[1.3rem] top-1.5 h-2 w-2 rounded-full ring-4 ring-background ${h.returned_at ? 'bg-slate-400' : 'bg-blue-500'}`} />
                        <p className="text-[0.8rem] font-medium text-foreground">
                          {h.user?.name ?? 'Former member'}
                          {!h.returned_at && <span className="ml-2 text-[0.65rem] font-medium text-blue-600 dark:text-blue-400">Current</span>}
                        </p>
                        <p className="text-[0.7rem] text-muted-foreground">
                          Given {formatDate(h.assigned_at)}{h.assigner ? ` by ${h.assigner.name}` : ''} · {h.condition_on_assign}
                        </p>
                        {h.returned_at && (
                          <p className="text-[0.7rem] text-muted-foreground">
                            Returned {formatDate(h.returned_at)}{h.receiver ? ` to ${h.receiver.name}` : ''} · {h.condition_on_return}
                          </p>
                        )}
                        {!h.returned_at && h.expected_return_on && (
                          <p className="text-[0.7rem] text-muted-foreground">Due back {formatDate(h.expected_return_on)}</p>
                        )}
                        {h.notes && <p className="mt-0.5 whitespace-pre-line text-[0.7rem] italic text-muted-foreground">{h.notes}</p>}
                      </li>
                    ))}
                  </ol>
                )}
              </div>
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
