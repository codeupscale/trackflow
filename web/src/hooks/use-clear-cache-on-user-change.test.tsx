import { describe, it, expect, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { QueryClient } from '@tanstack/react-query';
import { useAuthStore } from '@/stores/auth-store';
import { useClearCacheOnUserChange } from './use-clear-cache-on-user-change';

type AnyUser = NonNullable<ReturnType<typeof useAuthStore.getState>['user']>;

const user = (id: string, name = id) => ({ id, name, email: `${id}@example.test` }) as unknown as AnyUser;

/** A cache holding one "private" entry, so a clear is observable. */
function seededClient(): QueryClient {
  const client = new QueryClient();
  client.setQueryData(['payslips'], [{ id: 'owner-payslip' }]);
  return client;
}

const hasData = (client: QueryClient) => client.getQueryData(['payslips']) !== undefined;

describe('useClearCacheOnUserChange', () => {
  beforeEach(() => {
    act(() => useAuthStore.setState({ user: null, isAuthenticated: false }));
  });

  it('clears the cache when the user logs out', () => {
    act(() => useAuthStore.setState({ user: user('owner'), isAuthenticated: true }));
    const client = seededClient();
    renderHook(() => useClearCacheOnUserChange(client));

    act(() => useAuthStore.setState({ user: null, isAuthenticated: false }));

    expect(hasData(client)).toBe(false);
  });

  it('clears the cache when a different user signs in on the same tab', () => {
    act(() => useAuthStore.setState({ user: user('owner'), isAuthenticated: true }));
    const client = seededClient();
    renderHook(() => useClearCacheOnUserChange(client));

    act(() => useAuthStore.setState({ user: user('alice'), isAuthenticated: true }));

    expect(hasData(client)).toBe(false);
  });

  it('does NOT clear when the same user profile is refreshed', () => {
    // /auth/me replaces the user object with a new one for the same person;
    // clearing then would blank every screen after each profile refresh.
    act(() => useAuthStore.setState({ user: user('owner', 'John'), isAuthenticated: true }));
    const client = seededClient();
    renderHook(() => useClearCacheOnUserChange(client));

    act(() => useAuthStore.setState({ user: user('owner', 'John Updated') }));

    expect(hasData(client)).toBe(true);
  });

  it('does NOT clear on first sign-in from no user', () => {
    const client = seededClient();
    renderHook(() => useClearCacheOnUserChange(client));

    act(() => useAuthStore.setState({ user: user('owner'), isAuthenticated: true }));

    expect(hasData(client)).toBe(true);
  });

  it('stops listening once unmounted', () => {
    act(() => useAuthStore.setState({ user: user('owner'), isAuthenticated: true }));
    const client = seededClient();
    const { unmount } = renderHook(() => useClearCacheOnUserChange(client));

    unmount();
    act(() => useAuthStore.setState({ user: null, isAuthenticated: false }));

    expect(hasData(client)).toBe(true);
  });
});
