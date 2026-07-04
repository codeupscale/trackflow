import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock the API client and the shared download helpers. The export function must
// reuse triggerDownload (from the reports export fix) rather than hand-rolling a blob
// download — this test asserts that contract, plus the exact filename + query params.
vi.mock('@/lib/api', () => ({
  default: { get: vi.fn() },
}));
vi.mock('@/lib/download', () => ({
  triggerDownload: vi.fn(),
  readBlobError: vi.fn().mockResolvedValue('server said no'),
}));
vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

import api from '@/lib/api';
import { triggerDownload, readBlobError } from '@/lib/download';
import { toast } from 'sonner';
import { exportCheckIns } from '@/hooks/hr/use-check-in';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('exportCheckIns', () => {
  it('requests the export as a blob with day params + view, then triggers download', async () => {
    const blob = new Blob(['csv'], { type: 'text/csv' });
    vi.mocked(api.get).mockResolvedValue({ data: blob });

    await exportCheckIns({ period: 'day', date: '2026-07-03', view: 'summary' });

    expect(api.get).toHaveBeenCalledWith('/hr/attendance/check-ins/export', {
      params: {
        period: 'day',
        date: '2026-07-03',
        view: 'summary',
        format: 'csv',
      },
      responseType: 'blob',
    });

    expect(triggerDownload).toHaveBeenCalledTimes(1);
    expect(triggerDownload).toHaveBeenCalledWith(
      blob,
      'check-ins-summary-day-2026-07-03.csv',
      'text/csv'
    );
  });

  it('builds a month filename and omits empty params', async () => {
    const blob = new Blob(['csv'], { type: 'text/csv' });
    vi.mocked(api.get).mockResolvedValue({ data: blob });

    await exportCheckIns({ period: 'month', month: '2026-07' });

    expect(api.get).toHaveBeenCalledWith('/hr/attendance/check-ins/export', {
      params: {
        period: 'month',
        month: '2026-07',
        view: 'detail', // default view
        format: 'csv',
      },
      responseType: 'blob',
    });

    expect(triggerDownload).toHaveBeenCalledWith(
      blob,
      'check-ins-detail-month-2026-07.csv',
      'text/csv'
    );
  });

  it('includes user_id when an employee is selected', async () => {
    const blob = new Blob(['csv'], { type: 'text/csv' });
    vi.mocked(api.get).mockResolvedValue({ data: blob });

    await exportCheckIns({
      period: 'month',
      month: '2026-07',
      user_id: 'user-123',
      view: 'summary',
    });

    expect(api.get).toHaveBeenCalledWith('/hr/attendance/check-ins/export', {
      params: {
        period: 'month',
        month: '2026-07',
        user_id: 'user-123',
        view: 'summary',
        format: 'csv',
      },
      responseType: 'blob',
    });
  });

  it('omits user_id from params when null ("All employees")', async () => {
    const blob = new Blob(['csv'], { type: 'text/csv' });
    vi.mocked(api.get).mockResolvedValue({ data: blob });

    await exportCheckIns({
      period: 'day',
      date: '2026-07-03',
      user_id: null,
      view: 'detail',
    });

    expect(api.get).toHaveBeenCalledWith('/hr/attendance/check-ins/export', {
      params: {
        period: 'day',
        date: '2026-07-03',
        view: 'detail',
        format: 'csv',
      },
      responseType: 'blob',
    });
  });

  it('surfaces the server message via readBlobError on failure and rethrows', async () => {
    const err = { response: { data: new Blob(['{"message":"nope"}']) } };
    vi.mocked(api.get).mockRejectedValue(err);

    await expect(
      exportCheckIns({ period: 'day', date: '2026-07-03' })
    ).rejects.toBe(err);

    expect(readBlobError).toHaveBeenCalledWith(err);
    expect(toast.error).toHaveBeenCalledWith('server said no');
    expect(triggerDownload).not.toHaveBeenCalled();
  });
});
