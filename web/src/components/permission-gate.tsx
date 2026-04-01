'use client';

import type { ReactNode } from 'react';
import { usePermissionStore } from '@/stores/permission-store';

interface PermissionGateProps {
  permission: string;
  scope?: string;
  fallback?: ReactNode;
  children: ReactNode;
}

export function PermissionGate({
  permission,
  scope,
  fallback = null,
  children,
}: PermissionGateProps) {
  const { hasPermission, hasPermissionWithScope } = usePermissionStore();

  const allowed = scope
    ? hasPermissionWithScope(permission, scope)
    : hasPermission(permission);

  if (!allowed) return <>{fallback}</>;
  return <>{children}</>;
}

/**
 * Hook to check if the current user has a specific permission.
 * Optionally checks scope level (own, team, organization).
 */
export function useHasPermission(key: string, scope?: string): boolean {
  const { hasPermission, hasPermissionWithScope } = usePermissionStore();
  return scope ? hasPermissionWithScope(key, scope) : hasPermission(key);
}
