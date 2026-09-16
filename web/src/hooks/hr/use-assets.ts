import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import api from '@/lib/api';

export const ASSET_CATEGORIES = [
  'laptop', 'desktop', 'monitor', 'phone', 'tablet',
  'sim_card', 'id_card', 'accessory', 'furniture', 'software_license', 'other',
] as const;

export const ASSET_STATUSES = ['available', 'assigned', 'in_repair', 'retired', 'lost'] as const;

export const ASSET_CONDITIONS = ['new', 'good', 'fair', 'poor', 'damaged'] as const;

export type AssetCategory = (typeof ASSET_CATEGORIES)[number];
export type AssetStatus = (typeof ASSET_STATUSES)[number];
export type AssetCondition = (typeof ASSET_CONDITIONS)[number];

export interface AssetHolder {
  id: string;
  name: string;
  email: string;
  avatar_url: string | null;
}

export interface Asset {
  id: string;
  asset_tag: string;
  name: string;
  category: AssetCategory;
  brand: string | null;
  model: string | null;
  serial_number: string | null;
  purchase_date: string | null;
  purchase_cost: string | null;
  warranty_expires_on: string | null;
  status: AssetStatus;
  condition: AssetCondition;
  current_holder_id: string | null;
  holder: AssetHolder | null;
  /** The hand-over still open, when the item is with someone. */
  open_assignment?: {
    assigned_at: string;
    expected_return_on: string | null;
    condition_on_assign: AssetCondition;
    assigner: { id: string; name: string } | null;
  } | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface AssetAssignment {
  id: string;
  user_id: string;
  user: { id: string; name: string; email: string } | null;
  assigner: { id: string; name: string } | null;
  receiver: { id: string; name: string } | null;
  assigned_at: string;
  condition_on_assign: AssetCondition;
  expected_return_on: string | null;
  returned_at: string | null;
  condition_on_return: AssetCondition | null;
  notes: string | null;
}

export interface AssetPage {
  data: Asset[];
  meta: {
    current_page: number;
    last_page: number;
    total: number;
    /** 'organization' = the whole register; 'own' = only items this person holds. */
    scope: 'organization' | 'own';
    can_manage: boolean;
  };
}

export interface AssetSummary {
  total: number;
  by_status: Record<AssetStatus, number>;
  total_value: number;
  warranty_expiring_soon: number;
}

export interface AssetFilters {
  search?: string;
  status?: AssetStatus | '';
  category?: AssetCategory | '';
  /** Items held by one person — the employee profile's Assets tab. */
  holder_id?: string;
  page?: number;
  per_page?: number;
}

export type AssetInput = Partial<Pick<Asset,
  'name' | 'category' | 'brand' | 'model' | 'serial_number' | 'purchase_date'
  | 'warranty_expires_on' | 'status' | 'condition' | 'notes'>> & {
  purchase_cost?: number | string | null;
};

/** The server's message, or a fallback — the API wraps errors in two shapes. */
function errorMessage(err: unknown, fallback: string): string {
  const data = (err as { response?: { data?: Record<string, unknown> } })?.response?.data;
  const nested = (data?.error as { message?: string } | undefined)?.message;
  const flat = data?.message as string | undefined;
  const firstField = data?.errors
    ? Object.values(data.errors as Record<string, string[]>)[0]?.[0]
    : undefined;

  return firstField || nested || flat || fallback;
}

export function useAssets(filters: AssetFilters = {}) {
  return useQuery<AssetPage>({
    queryKey: ['assets', filters],
    queryFn: async () => {
      const params: Record<string, string | number> = {};
      if (filters.search) params.search = filters.search;
      if (filters.status) params.status = filters.status;
      if (filters.category) params.category = filters.category;
      if (filters.holder_id) params.holder_id = filters.holder_id;
      if (filters.page) params.page = filters.page;
      params.per_page = filters.per_page ?? 25;

      const res = await api.get('/hr/assets', { params });

      return res.data;
    },
  });
}

export function useAssetSummary(enabled = true) {
  return useQuery<AssetSummary>({
    queryKey: ['assets', 'summary'],
    queryFn: async () => (await api.get('/hr/assets/summary')).data.data,
    enabled,
  });
}

export function useAsset(id: string | null) {
  return useQuery<{ data: Asset; history: AssetAssignment[] }>({
    queryKey: ['assets', 'detail', id],
    queryFn: async () => (await api.get(`/hr/assets/${id}`)).data,
    enabled: !!id,
  });
}

/**
 * Every write invalidates the whole ['assets'] family: a hand-over changes the
 * list, the summary counts and the detail history at once, and refreshing only
 * one of them shows numbers that disagree with each other.
 */
function useAssetMutation<TVars>(
  fn: (vars: TVars) => Promise<unknown>,
  success: string,
  failure: string,
) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: fn,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['assets'] });
      toast.success(success);
    },
    onError: (err: unknown) => toast.error(errorMessage(err, failure)),
  });
}

export function useCreateAsset() {
  return useAssetMutation(
    (input: AssetInput) => api.post('/hr/assets', input),
    'Item added',
    'Could not add the item',
  );
}

export function useUpdateAsset() {
  return useAssetMutation(
    ({ id, input }: { id: string; input: AssetInput }) => api.put(`/hr/assets/${id}`, input),
    'Item updated',
    'Could not update the item',
  );
}

export function useDeleteAsset() {
  return useAssetMutation(
    (id: string) => api.delete(`/hr/assets/${id}`),
    'Item deleted',
    'Could not delete the item',
  );
}

export function useAssignAsset() {
  return useAssetMutation(
    ({ id, ...body }: { id: string; user_id: string; expected_return_on?: string | null; notes?: string | null }) =>
      api.post(`/hr/assets/${id}/assign`, body),
    'Item assigned',
    'Could not assign the item',
  );
}

export function useReturnAsset() {
  return useAssetMutation(
    ({ id, ...body }: { id: string; condition: AssetCondition; status_after?: 'available' | 'in_repair' | 'lost'; notes?: string | null }) =>
      api.post(`/hr/assets/${id}/return`, body),
    'Return recorded',
    'Could not record the return',
  );
}

// ── Display helpers ──────────────────────────────────────────────────

/** "sim_card" → "SIM card", "software_license" → "Software licence". */
export function categoryLabel(category: string): string {
  const special: Record<string, string> = {
    sim_card: 'SIM card',
    id_card: 'ID card',
    software_license: 'Software licence',
  };

  return special[category] ?? category.charAt(0).toUpperCase() + category.slice(1).replace(/_/g, ' ');
}

export function statusLabel(status: string): string {
  return status === 'in_repair' ? 'In repair' : status.charAt(0).toUpperCase() + status.slice(1);
}
