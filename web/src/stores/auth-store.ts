import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import api from '@/lib/api';
import { identifyUser, resetUser } from '@/lib/posthog';

interface User {
  id: string;
  name: string;
  email: string;
  role: 'owner' | 'admin' | 'manager' | 'employee';
  organization_id: string;
  timezone: string;
  avatar_url: string | null;
  is_active: boolean;
  organization: {
    id: string;
    name: string;
    slug: string;
    plan: string;
    trial_ends_at: string | null;
    settings: Record<string, unknown>;
  };
}

export interface OrgSelectionItem {
  organization_id: string;
  organization_name: string;
  organization_slug: string;
  organization_plan: string;
  organization_avatar: string | null;
  user_role: string;
  user_id: string;
}

interface RegisterData {
  name: string;
  email: string;
  password: string;
  password_confirmation: string;
  company_name: string;
  timezone?: string;
}

interface LoginResult {
  success: boolean;
  requires_org_selection?: boolean;
  organizations?: OrgSelectionItem[];
  auth_method?: string;
}

interface AuthState {
  user: User | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  pendingOrgSelection: {
    organizations: OrgSelectionItem[];
    email?: string;
    password?: string;
    id_token?: string;
    auth_method?: string;
  } | null;
  login: (email: string, password: string) => Promise<LoginResult>;
  register: (data: RegisterData) => Promise<void>;
  logout: () => Promise<void>;
  fetchUser: () => Promise<void>;
  setUser: (user: User) => void;
  setTokens: (accessToken: string, refreshToken: string) => void;
  selectOrganization: (organizationId: string) => Promise<void>;
  switchOrganization: (organizationId: string) => Promise<void>;
  clearPendingOrgSelection: () => void;
  setPendingOrgSelection: (data: AuthState['pendingOrgSelection']) => void;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      user: null,
      isAuthenticated: false,
      isLoading: false,
      pendingOrgSelection: null,

      login: async (email: string, password: string): Promise<LoginResult> => {
        set({ isLoading: true });
        try {
          const res = await api.post('/auth/login', { email, password });

          if (res.data.requires_org_selection) {
            set({
              isLoading: false,
              pendingOrgSelection: {
                organizations: res.data.organizations,
                email,
                password,
                auth_method: 'email',
              },
            });
            return {
              success: true,
              requires_org_selection: true,
              organizations: res.data.organizations,
            };
          }

          if (typeof window !== 'undefined') {
            localStorage.setItem('access_token', res.data.access_token);
            localStorage.setItem('refresh_token', res.data.refresh_token);
          }
          set({ user: res.data.user, isAuthenticated: true, isLoading: false, pendingOrgSelection: null });
          identifyUser(res.data.user);
          return { success: true };
        } catch (error) {
          set({ isLoading: false });
          throw error;
        }
      },

      register: async (data: RegisterData) => {
        set({ isLoading: true });
        try {
          const res = await api.post('/auth/register', data);
          if (typeof window !== 'undefined') {
            localStorage.setItem('access_token', res.data.access_token);
            localStorage.setItem('refresh_token', res.data.refresh_token);
          }
          set({ user: res.data.user, isAuthenticated: true, isLoading: false });
          identifyUser(res.data.user);
        } catch (error) {
          set({ isLoading: false });
          throw error;
        }
      },

      logout: async () => {
        try {
          await api.post('/auth/logout');
        } catch {
          // Ignore logout API errors
        }
        resetUser();
        if (typeof window !== 'undefined') {
          localStorage.removeItem('access_token');
          localStorage.removeItem('refresh_token');
        }
        set({ user: null, isAuthenticated: false, pendingOrgSelection: null });
      },

      fetchUser: async () => {
        try {
          const res = await api.get('/auth/me');
          set({ user: res.data.user, isAuthenticated: true });
          identifyUser(res.data.user);
        } catch {
          set({ user: null, isAuthenticated: false });
        }
      },

      setUser: (user: User) => set({ user, isAuthenticated: true }),

      setTokens: (accessToken: string, refreshToken: string) => {
        if (typeof window !== 'undefined') {
          localStorage.setItem('access_token', accessToken);
          localStorage.setItem('refresh_token', refreshToken);
        }
        // Fetch user profile after setting tokens
        api.get('/auth/me').then((res) => {
          const user = res.data.user;
          identifyUser(user);
          set({ user, isAuthenticated: true, pendingOrgSelection: null });
        }).catch(() => {});
      },

      selectOrganization: async (organizationId: string) => {
        const pending = get().pendingOrgSelection;
        if (!pending) throw new Error('No pending organization selection.');

        set({ isLoading: true });
        try {
          const payload: Record<string, string> = { organization_id: organizationId };

          if (pending.id_token) {
            payload.id_token = pending.id_token;
          } else if (pending.email && pending.password) {
            payload.email = pending.email;
            payload.password = pending.password;
          }

          const res = await api.post('/auth/select-organization', payload);

          if (typeof window !== 'undefined') {
            localStorage.setItem('access_token', res.data.access_token);
            localStorage.setItem('refresh_token', res.data.refresh_token);
          }
          set({
            user: res.data.user,
            isAuthenticated: true,
            isLoading: false,
            pendingOrgSelection: null,
          });
          identifyUser(res.data.user);
        } catch (error) {
          set({ isLoading: false });
          throw error;
        }
      },

      switchOrganization: async (organizationId: string) => {
        set({ isLoading: true });
        try {
          const res = await api.post('/auth/switch-organization', {
            organization_id: organizationId,
          });

          if (typeof window !== 'undefined') {
            localStorage.setItem('access_token', res.data.access_token);
            localStorage.setItem('refresh_token', res.data.refresh_token);
          }
          set({
            user: res.data.user,
            isAuthenticated: true,
            isLoading: false,
          });
          identifyUser(res.data.user);
        } catch (error) {
          set({ isLoading: false });
          throw error;
        }
      },

      clearPendingOrgSelection: () => set({ pendingOrgSelection: null }),

      setPendingOrgSelection: (data) => set({ pendingOrgSelection: data }),
    }),
    {
      name: 'auth-storage',
      partialize: (state) => ({ user: state.user, isAuthenticated: state.isAuthenticated }),
    }
  )
);
