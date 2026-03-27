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

interface RegisterData {
  name: string;
  email: string;
  password: string;
  password_confirmation: string;
  company_name: string;
  timezone?: string;
}

interface AuthState {
  user: User | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (data: RegisterData) => Promise<void>;
  logout: () => Promise<void>;
  fetchUser: () => Promise<void>;
  setUser: (user: User) => void;
  setTokens: (accessToken: string, refreshToken: string) => void;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      user: null,
      isAuthenticated: false,
      isLoading: false,

      login: async (email: string, password: string) => {
        set({ isLoading: true });
        try {
          const res = await api.post('/auth/login', { email, password });
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
        set({ user: null, isAuthenticated: false });
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
          set({ user, isAuthenticated: true });
        }).catch(() => {});
      },
    }),
    {
      name: 'auth-storage',
      partialize: (state) => ({ user: state.user, isAuthenticated: state.isAuthenticated }),
    }
  )
);
