import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface PermissionState {
  permissions: Record<string, string>; // e.g. { 'time_entries.view': 'team' }
  setPermissions: (perms: Record<string, string>) => void;
  clearPermissions: () => void;

  // Check methods
  hasPermission: (key: string) => boolean;
  hasPermissionWithScope: (key: string, requiredScope: string) => boolean;
  getScope: (key: string) => string | null;
  canAccessModule: (module: string) => boolean;
}

const SCOPE_HIERARCHY: Record<string, number> = {
  own: 1,
  team: 2,
  organization: 3,
  none: 3, // non-scoped permissions (e.g. boolean toggles)
};

export const usePermissionStore = create<PermissionState>()(
  persist(
    (set, get) => ({
      permissions: {},

      setPermissions: (perms) => set({ permissions: perms }),
      clearPermissions: () => set({ permissions: {} }),

      hasPermission: (key) => {
        return key in get().permissions;
      },

      hasPermissionWithScope: (key, requiredScope) => {
        const granted = get().permissions[key];
        if (!granted) return false;
        return (SCOPE_HIERARCHY[granted] ?? 0) >= (SCOPE_HIERARCHY[requiredScope] ?? 0);
      },

      getScope: (key) => {
        return get().permissions[key] ?? null;
      },

      canAccessModule: (module) => {
        return Object.keys(get().permissions).some((key) => key.startsWith(module + '.'));
      },
    }),
    {
      name: 'trackflow-permissions',
      // Only persist the permissions data, not the methods
      partialize: (state) => ({ permissions: state.permissions }),
    }
  )
);
