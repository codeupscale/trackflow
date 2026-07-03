import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { createElement } from 'react';

// The check-in mutation must invalidate the attendance SUMMARY query. That query
// lives under a separate key (['attendance-summary', month, year]); a prefix
// invalidation of ['attendance'] does NOT reach it. Regression guard for the
// "0 Present Days / 0 working days" stale-tile bug after checking in.
vi.mock('@/lib/api', () => ({
  default: { post: vi.fn().mockResolvedValue({ data: { data: {} } }) },
}));
vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

import { useCheckIn, useCheckOut } from '@/hooks/hr/use-check-in';

function wrapper(client: QueryClient) {
  return ({ children }: { children: ReactNode }) =>
    createElement(QueryClientProvider, { client }, children);
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe.each([
  ['useCheckIn', useCheckIn],
  ['useCheckOut', useCheckOut],
])('%s invalidation', (_name, useHook) => {
  it('invalidates the attendance-summary query after the action succeeds', async () => {
    const client = new QueryClient();
    const spy = vi.spyOn(client, 'invalidateQueries');

    const { result } = renderHook(() => useHook(), { wrapper: wrapper(client) });

    result.current.mutate();

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    const invalidatedKeys = spy.mock.calls.map((c) => c[0]?.queryKey);
    expect(invalidatedKeys).toContainEqual(['attendance-summary']);
    // Sanity: the list + today keys are still invalidated too.
    expect(invalidatedKeys).toContainEqual(['attendance']);
    expect(invalidatedKeys).toContainEqual(['attendance', 'today']);
  });
});
