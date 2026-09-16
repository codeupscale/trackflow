'use client';

import { useEffect, useState } from 'react';
import {
  AlertTriangle,
  ChevronLeft,
  ChevronRight,
  Package,
  PackageCheck,
  PackageOpen,
  Plus,
  Search,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import {
  ASSET_CATEGORIES,
  ASSET_STATUSES,
  categoryLabel,
  statusLabel,
  useAssets,
  useAssetSummary,
  type Asset,
  type AssetCategory,
  type AssetStatus,
} from '@/hooks/hr/use-assets';
import { AssetStatusBadge } from '@/components/hr/assets/AssetStatusBadge';
import { AssetFormDialog } from '@/components/hr/assets/AssetFormDialog';
import { AssetDetailSheet } from '@/components/hr/assets/AssetDetailSheet';
import { AssignAssetDialog, ReturnAssetDialog } from '@/components/hr/assets/AssetHandoverDialogs';
import { MyAssetsView } from '@/components/hr/assets/MyAssetsView';

const statusItems = [{ value: 'all', label: 'All statuses' }, ...ASSET_STATUSES.map((s) => ({ value: s, label: statusLabel(s) }))];
const categoryItems = [{ value: 'all', label: 'All categories' }, ...ASSET_CATEGORIES.map((c) => ({ value: c, label: categoryLabel(c) }))];

/**
 * Company items: the register for HR, "what I hold" for everyone else.
 *
 * One page for both, because the SERVER decides which one a person gets (from
 * their assets.view scope) and says so in meta.scope. The page renders what it
 * was given; it never works out on its own whether someone may see the whole
 * register, so it cannot get that wrong.
 */
export default function AssetsPage() {
  const [search, setSearch] = useState('');
  const [debounced, setDebounced] = useState('');
  const [status, setStatus] = useState<AssetStatus | ''>('');
  const [category, setCategory] = useState<AssetCategory | ''>('');
  const [page, setPage] = useState(1);

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Asset | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [assigning, setAssigning] = useState<Asset | null>(null);
  const [returning, setReturning] = useState<Asset | null>(null);

  // A request per keystroke would race itself; wait for a pause in typing.
  useEffect(() => {
    const t = setTimeout(() => {
      setDebounced(search.trim());
      setPage(1);
    }, 300);
    return () => clearTimeout(t);
  }, [search]);

  const { data, isLoading, isError } = useAssets({ search: debounced, status, category, page });
  const scope = data?.meta.scope;
  const canManage = data?.meta.can_manage ?? false;
  const register = scope === 'organization';
  const { data: summary } = useAssetSummary(canManage);

  const assets = data?.data ?? [];
  const lastPage = data?.meta.last_page ?? 1;
  const filtered = !!(debounced || status || category);

  const openEdit = (asset: Asset) => {
    setEditing(asset);
    setFormOpen(true);
  };

  return (
    <div className="flex flex-col gap-4">
      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-lg font-semibold tracking-tight">{register || !data ? 'Assets' : 'My company items'}</h1>
          <p className="text-xs text-muted-foreground">
            {register
              ? 'Company items and who has each one'
              : 'Items the company has given you. Contact HR if anything here is wrong.'}
          </p>
        </div>
        {canManage && (
          <Button size="sm" className="h-8 text-xs" onClick={() => { setEditing(null); setFormOpen(true); }}>
            <Plus className="mr-1 h-3.5 w-3.5" />
            Add item
          </Button>
        )}
      </div>

      {/* Summary — managers only */}
      {canManage && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {[
            { label: 'Total items', value: summary?.total, icon: Package, color: 'text-slate-500', bg: 'bg-slate-500/10' },
            { label: 'Assigned', value: summary?.by_status.assigned, icon: PackageOpen, color: 'text-blue-500', bg: 'bg-blue-500/10' },
            { label: 'Available', value: summary?.by_status.available, icon: PackageCheck, color: 'text-emerald-500', bg: 'bg-emerald-500/10' },
            {
              label: 'Needs attention',
              value: summary ? summary.by_status.in_repair + summary.by_status.lost + summary.warranty_expiring_soon : undefined,
              icon: AlertTriangle,
              color: 'text-amber-500',
              bg: 'bg-amber-500/10',
              hint: summary ? `${summary.by_status.in_repair} in repair · ${summary.by_status.lost} lost · ${summary.warranty_expiring_soon} warranty ending` : undefined,
            },
          ].map((s) => (
            <Card key={s.label} className="border-border">
              <CardContent className="p-3">
                <div className="flex items-center gap-2.5">
                  <div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${s.bg}`}>
                    <s.icon className={`h-4 w-4 ${s.color}`} />
                  </div>
                  <div className="min-w-0">
                    <p className="text-[0.65rem] font-medium uppercase tracking-wider text-muted-foreground">{s.label}</p>
                    <p className="text-base font-bold leading-tight tabular-nums text-foreground">{s.value ?? '--'}</p>
                    {'hint' in s && s.hint && <p className="truncate text-[0.6rem] text-muted-foreground">{s.hint}</p>}
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Filters — the register only; a handful of your own items needs none */}
      {register && (
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <div className="relative flex-1 sm:max-w-xs">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              className="h-8 pl-8 text-xs"
              placeholder="Search tag, name, serial, brand"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              aria-label="Search items"
            />
          </div>
          <Select items={statusItems} value={status || 'all'} onValueChange={(v) => { setStatus(v === 'all' || !v ? '' : (v as AssetStatus)); setPage(1); }}>
            <SelectTrigger className="h-8 w-full px-2.5 text-xs data-[size=default]:h-8 sm:w-40" aria-label="Status"><SelectValue /></SelectTrigger>
            <SelectContent>{statusItems.map((o) => <SelectItem key={o.value} value={o.value} className="text-xs">{o.label}</SelectItem>)}</SelectContent>
          </Select>
          <Select items={categoryItems} value={category || 'all'} onValueChange={(v) => { setCategory(v === 'all' || !v ? '' : (v as AssetCategory)); setPage(1); }}>
            <SelectTrigger className="h-8 w-full px-2.5 text-xs data-[size=default]:h-8 sm:w-44" aria-label="Category"><SelectValue /></SelectTrigger>
            <SelectContent>{categoryItems.map((o) => <SelectItem key={o.value} value={o.value} className="text-xs">{o.label}</SelectItem>)}</SelectContent>
          </Select>
        </div>
      )}

      {/* Body */}
      {isError ? (
        <Card className="border-destructive/50">
          <CardContent className="py-12">
            <div className="flex flex-col items-center gap-2 text-center">
              <Package className="h-8 w-8 text-destructive/60" />
              <p className="text-sm font-medium text-muted-foreground">Failed to load items</p>
              <p className="text-xs text-muted-foreground">Please try again later.</p>
            </div>
          </CardContent>
        </Card>
      ) : isLoading ? (
        <Card>
          <CardContent className="p-0">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="flex items-center gap-4 border-b border-border/50 px-4 py-3 last:border-0">
                <Skeleton className="h-3.5 w-16" />
                <Skeleton className="h-3.5 w-40" />
                <Skeleton className="h-3.5 w-20" />
                <Skeleton className="h-3.5 w-28" />
              </div>
            ))}
          </CardContent>
        </Card>
      ) : assets.length === 0 ? (
        <Card>
          <CardContent className="py-14">
            <div className="flex flex-col items-center gap-2 text-center">
              <Package className="h-8 w-8 text-muted-foreground/40" />
              <p className="text-sm font-medium text-muted-foreground">
                {filtered ? 'No items match these filters' : register ? 'No items yet' : 'You have no company items'}
              </p>
              <p className="text-xs text-muted-foreground">
                {filtered
                  ? 'Try a different search or clear the filters.'
                  : register
                    ? 'Add your first laptop, phone or licence to start tracking who has it.'
                    : 'Anything the company gives you — a laptop, a phone, an ID card — will appear here.'}
              </p>
              {canManage && !filtered && (
                <Button size="sm" className="mt-2 h-7 text-xs" onClick={() => { setEditing(null); setFormOpen(true); }}>
                  <Plus className="mr-1 h-3 w-3" />
                  Add item
                </Button>
              )}
            </div>
          </CardContent>
        </Card>
      ) : register ? (
        <Card>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-left">
                <thead>
                  <tr className="border-b border-border/50">
                    {['Tag', 'Item', 'Category', 'Serial', 'With', 'Status', ''].map((h, i) => (
                      <th key={i} className={`whitespace-nowrap px-4 py-2.5 text-[0.6rem] font-medium uppercase tracking-wider text-muted-foreground ${i === 6 ? 'text-right' : ''}`}>
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {assets.map((a) => (
                    <tr
                      key={a.id}
                      className="cursor-pointer border-b border-border/30 transition-colors last:border-0 hover:bg-muted/30"
                      onClick={() => setOpenId(a.id)}
                    >
                      <td className="whitespace-nowrap px-4 py-2.5 font-mono text-[0.72rem] text-muted-foreground">{a.asset_tag}</td>
                      <td className="px-4 py-2.5">
                        <p className="text-[0.78rem] font-medium text-foreground">{a.name}</p>
                        {(a.brand || a.model) && <p className="text-[0.65rem] text-muted-foreground">{[a.brand, a.model].filter(Boolean).join(' · ')}</p>}
                      </td>
                      <td className="whitespace-nowrap px-4 py-2.5 text-[0.75rem] text-muted-foreground">{categoryLabel(a.category)}</td>
                      <td className="whitespace-nowrap px-4 py-2.5 font-mono text-[0.7rem] text-muted-foreground">{a.serial_number ?? '—'}</td>
                      <td className="whitespace-nowrap px-4 py-2.5 text-[0.75rem]">
                        {a.holder ? <span className="text-foreground">{a.holder.name}</span> : <span className="text-muted-foreground/60">—</span>}
                      </td>
                      <td className="whitespace-nowrap px-4 py-2.5"><AssetStatusBadge status={a.status} /></td>
                      <td className="whitespace-nowrap px-4 py-2.5 text-right" onClick={(e) => e.stopPropagation()}>
                        {canManage && a.status === 'available' && (
                          <Button variant="outline" size="sm" className="h-6 px-2.5 text-[0.6rem]" onClick={() => setAssigning(a)}>Assign</Button>
                        )}
                        {canManage && a.status === 'assigned' && (
                          <Button variant="outline" size="sm" className="h-6 px-2.5 text-[0.6rem]" onClick={() => setReturning(a)}>Return</Button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      ) : (
        // An employee's own items, laid out as labelled receipts.
        <MyAssetsView assets={assets} onOpen={(a) => setOpenId(a.id)} />
      )}

      {lastPage > 1 && (
        <div className="flex items-center justify-between">
          <p className="text-[0.7rem] tabular-nums text-muted-foreground">Page {page} of {lastPage}</p>
          <div className="flex items-center gap-1.5">
            <Button variant="outline" size="sm" className="h-7 px-2 text-[0.7rem]" disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>
              <ChevronLeft className="mr-0.5 h-3.5 w-3.5" />Previous
            </Button>
            <Button variant="outline" size="sm" className="h-7 px-2 text-[0.7rem]" disabled={page >= lastPage} onClick={() => setPage((p) => Math.min(lastPage, p + 1))}>
              Next<ChevronRight className="ml-0.5 h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
      )}

      <AssetDetailSheet
        assetId={openId}
        onOpenChange={(o) => !o && setOpenId(null)}
        canManage={canManage}
        onEdit={(a) => { setOpenId(null); openEdit(a); }}
        onAssign={(a) => { setOpenId(null); setAssigning(a); }}
        onReturn={(a) => { setOpenId(null); setReturning(a); }}
      />
      <AssetFormDialog open={formOpen} onOpenChange={setFormOpen} asset={editing} />
      <AssignAssetDialog asset={assigning} onOpenChange={(o) => !o && setAssigning(null)} />
      <ReturnAssetDialog asset={returning} onOpenChange={(o) => !o && setReturning(null)} />
    </div>
  );
}
