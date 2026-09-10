import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

import api from '@/lib/api';
import { readBlobError, triggerDownload } from '@/lib/download';
import type {
  PayslipImageFieldCatalogue,
  PayslipPlaceholderReference,
  PayslipTemplate,
  PayslipTemplateFormData,
} from '@/lib/validations/payroll';

/**
 * The reason an API call failed, as text.
 *
 * This API wraps errors as `{ error: { code, message } }` (see the render()
 * handler in backend/bootstrap/app.php); only validation failures also carry a
 * top-level `message`. Reading `message` alone loses the reason on every
 * abort() — a 422 that says exactly what is wrong arrives as a generic toast.
 */
function apiErrorMessage(err: unknown): string | null {
  const data = (err as { response?: { data?: unknown } })?.response?.data;
  if (typeof data !== 'object' || data === null) return null;

  const wrapped = (data as { error?: { message?: unknown } }).error?.message;
  if (typeof wrapped === 'string' && wrapped) return wrapped;

  const plain = (data as { message?: unknown }).message;
  return typeof plain === 'string' && plain ? plain : null;
}

export function usePayslipTemplate() {
  return useQuery<PayslipTemplate>({
    queryKey: ['payslip-template'],
    queryFn: async () => {
      const res = await api.get('/hr/payslips/template');
      return res.data.data;
    },
  });
}

/**
 * Every placeholder a company-uploaded design may use, with a sample value.
 * Served from a real sample render so the reference cannot drift from what the
 * engine actually resolves.
 */
export function usePayslipPlaceholders(enabled = true) {
  return useQuery<PayslipPlaceholderReference>({
    queryKey: ['payslip-template', 'placeholders'],
    enabled,
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      const res = await api.get('/hr/payslips/template/placeholders');
      return res.data.data;
    },
  });
}

/**
 * The droppable field palette for the image layout, grouped, each with a
 * sample value. Derived server-side from a real sample render, so a field can
 * never be offered that would not resolve on a payslip.
 */
export function usePayslipImageFields(enabled = true) {
  return useQuery<PayslipImageFieldCatalogue>({
    queryKey: ['payslip-template', 'image-fields'],
    enabled,
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      const res = await api.get('/hr/payslips/template/fields');
      return res.data.data;
    },
  });
}

export function useUpdatePayslipTemplate() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: Partial<PayslipTemplateFormData>) => {
      const res = await api.put('/hr/payslips/template', data);
      return res.data.data as PayslipTemplate;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['payslip-template'] });
      toast.success('Payslip design saved');
    },
    onError: (err: unknown) => {
      // The server returns the real reason an uploaded design was refused
      // (a script tag, an unbalanced block, a render failure). Surfacing the
      // generic message instead would leave the uploader with nothing to fix.
      const detail = (err as { response?: { data?: { errors?: Record<string, string[]> } } })
        ?.response?.data?.errors?.custom_template_html?.[0];

      toast.error(detail ?? (err as Error).message ?? 'Failed to save payslip design');
    },
  });
}

/**
 * Fetch one payslip's PDF as an object URL for on-screen review.
 *
 * Separate from the download hook because reviewing must not put a file in
 * anyone's Downloads folder — HR opens dozens of these before verifying.
 * The caller owns the returned URL and must revoke it.
 */
export function usePayslipPreviewUrl() {
  return useMutation({
    mutationFn: async (id: string) => {
      const res = await api.get(`/hr/payslips/${id}/download`, { responseType: 'blob' });
      return URL.createObjectURL(res.data as Blob);
    },
    onError: async (err: unknown) => {
      toast.error((await readBlobError(err)) ?? 'Failed to open payslip');
    },
  });
}

/**
 * Replace a payslip's earnings and deductions.
 *
 * The whole set is sent, not a patch: the totals are derived from the lines,
 * so a partial update would leave gross, deductions and net disagreeing with
 * what they are the sum of.
 */
export function useUpdatePayslipLines() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      id,
      lines,
    }: {
      id: string;
      lines: { label: string; category: string; amount: number; is_taxable?: boolean }[];
    }) => {
      const res = await api.put(`/hr/payslips/${id}/lines`, { lines });
      return res.data.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['payslips'] });
      queryClient.invalidateQueries({ queryKey: ['payroll-periods'] });
      toast.success('Payslip updated — verify it again to release it');
    },
    onError: (err: unknown) => {
      toast.error(apiErrorMessage(err) ?? 'Failed to update payslip');
    },
  });
}

/**
 * Verify one payslip, releasing it to that employee's My Payslips.
 * One at a time by design — see PayrollService::verifyPayslip.
 */
export function useVerifyPayslip() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: string) => {
      const res = await api.post(`/hr/payslips/${id}/verify`);
      return res.data.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['payslips'] });
      toast.success('Payslip verified and sent to the employee');
    },
    onError: (err: unknown) => {
      toast.error(apiErrorMessage(err) ?? 'Failed to verify payslip');
    },
  });
}

export function useUnverifyPayslip() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: string) => {
      const res = await api.post(`/hr/payslips/${id}/unverify`);
      return res.data.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['payslips'] });
      toast.success('Verification withdrawn. The employee can no longer see it.');
    },
    onError: (err: unknown) => {
      toast.error(apiErrorMessage(err) ?? 'Failed to withdraw verification');
    },
  });
}

/**
 * Download one payslip as a PDF.
 *
 * `responseType: 'blob'` means a failure arrives as a Blob rather than JSON,
 * which is why the error path goes through readBlobError().
 */
export function useDownloadPayslip() {
  return useMutation({
    mutationFn: async ({ id, filename }: { id: string; filename?: string }) => {
      const res = await api.get(`/hr/payslips/${id}/download`, { responseType: 'blob' });

      const fromHeader = /filename="?([^"';]+)"?/i.exec(
        String(res.headers?.['content-disposition'] ?? ''),
      )?.[1];

      triggerDownload(res.data, fromHeader ?? filename ?? 'payslip.pdf', 'application/pdf');
    },
    onError: async (err: unknown) => {
      toast.error((await readBlobError(err)) ?? 'Failed to download payslip');
    },
  });
}
