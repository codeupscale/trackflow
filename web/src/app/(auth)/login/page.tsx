'use client';

import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import Script from 'next/script';
import { useForm } from 'react-hook-form';
import { z } from 'zod/v4';
import { zodResolver } from '@hookform/resolvers/zod';
import {
  Clock,
  Users,
  BarChart3,
  ShieldCheck,
  Mail,
  Loader2,
  Info,
} from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { PasswordInput } from '@/components/ui/password-input';
import { TrackFlowLogo } from '@/components/ui/trackflow-logo';
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  Form,
  FormField,
  FormItem,
  FormLabel,
  FormControl,
  FormMessage,
} from '@/components/ui/form';
import { OrgSelector } from '@/components/org-selector';
import { useAuthStore } from '@/stores/auth-store';
import api from '@/lib/api';

const loginSchema = z.object({
  email: z.string().min(1, 'Email is required').email('Invalid email address'),
  password: z.string().min(1, 'Password is required'),
});

type LoginFormValues = z.infer<typeof loginSchema>;

const GOOGLE_CLIENT_ID = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID || '';

const FEATURES = [
  {
    icon: Clock,
    title: 'Time Tracking',
    desc: 'Track work hours accurately',
    bg: 'bg-orange-100 dark:bg-orange-900/40',
    color: 'text-orange-600 dark:text-orange-400',
  },
  {
    icon: Users,
    title: 'Attendance & Leave',
    desc: 'Manage attendance and leaves seamlessly',
    bg: 'bg-rose-100 dark:bg-rose-900/40',
    color: 'text-rose-500 dark:text-rose-400',
  },
  {
    icon: BarChart3,
    title: 'Team Productivity',
    desc: 'Measure performance and productivity',
    bg: 'bg-slate-800 dark:bg-slate-700',
    color: 'text-white',
  },
  {
    icon: ShieldCheck,
    title: 'Secure & Reliable',
    desc: 'Enterprise-grade security for your data',
    bg: 'bg-red-100 dark:bg-red-900/40',
    color: 'text-red-500 dark:text-red-400',
  },
];

export default function LoginPage() {
  const router = useRouter();
  const {
    login,
    setTokens,
    selectOrganization,
    pendingOrgSelection,
    clearPendingOrgSelection,
    setPendingOrgSelection,
  } = useAuthStore();
  const [googleLoading, setGoogleLoading] = useState(false);
  const [googleReady, setGoogleReady] = useState(false);
  const [rememberMe, setRememberMe] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const token = localStorage.getItem('access_token');
    if (token) {
      router.replace('/dashboard');
    }
  }, [router]);

  const handleGoogleResponse = useCallback(async (response: { credential: string }) => {
    setError(null);
    setGoogleLoading(true);

    try {
      const res = await api.post('/auth/google', { id_token: response.credential });

      if (res.data.requires_org_selection) {
        setPendingOrgSelection({
          organizations: res.data.organizations,
          id_token: response.credential,
          auth_method: 'google',
        });
        setGoogleLoading(false);
        return;
      }

      const { access_token, refresh_token } = res.data;
      setTokens(access_token, refresh_token);
      toast.success('Welcome!');
      router.push('/dashboard');
    } catch (err: unknown) {
      const message = (err as Error).message || 'Google sign-in failed.';
      setError(message);
      toast.error(message);
    } finally {
      setGoogleLoading(false);
    }
  }, [router, setTokens, setPendingOrgSelection]);

  useEffect(() => {
    if (!GOOGLE_CLIENT_ID) return;

    const initGoogle = () => {
      if (typeof window !== 'undefined' && (window as unknown as Record<string, unknown>).google) {
        const google = (window as unknown as { google: { accounts: { id: { initialize: (config: Record<string, unknown>) => void; prompt: () => void } } } }).google;
        google.accounts.id.initialize({
          client_id: GOOGLE_CLIENT_ID,
          callback: handleGoogleResponse,
        });
        setGoogleReady(true);
      }
    };

    initGoogle();
    window.addEventListener('google-loaded', initGoogle);
    return () => window.removeEventListener('google-loaded', initGoogle);
  }, [handleGoogleResponse]);

  const handleGoogleSignIn = async () => {
    if (!googleReady) {
      toast.error('Google sign-in is unavailable.');
      return;
    }

    setGoogleLoading(true);
    const google = (window as unknown as { google?: { accounts?: { id?: { prompt: () => void } } } }).google;
    google?.accounts?.id?.prompt();
  };

  const form = useForm<LoginFormValues>({
    resolver: zodResolver(loginSchema),
    defaultValues: {
      email: '',
      password: '',
    },
  });

  const onSubmit = async (values: LoginFormValues) => {
    setError(null);
    try {
      const result = await login(values.email, values.password);
      if (result.requires_org_selection) {
        return;
      }
      toast.success('Welcome back!');
      router.push('/dashboard');
    } catch (err: unknown) {
      const axiosError = err as { response?: { data?: { message?: string } } };
      const message = axiosError.response?.data?.message || (err as Error).message || 'Invalid credentials. Please try again.';
      setError(message);
      toast.error(message);
    } finally {
      setGoogleLoading(false);
    }
  };

  const handleOrgSelect = async (organizationId: string) => {
    await selectOrganization(organizationId);
    toast.success('Welcome!');
    router.push('/dashboard');
  };

  const handleOrgSelectBack = () => {
    clearPendingOrgSelection();
  };

  if (pendingOrgSelection) {
    return (
      <>
        {GOOGLE_CLIENT_ID && (
          <Script
            src="https://accounts.google.com/gsi/client"
            strategy="afterInteractive"
            onLoad={() => window.dispatchEvent(new Event('google-loaded'))}
          />
        )}
        <div className="flex min-h-screen items-center justify-center px-4">
          <OrgSelector
            organizations={pendingOrgSelection.organizations}
            onSelect={handleOrgSelect}
            onBack={handleOrgSelectBack}
          />
        </div>
      </>
    );
  }

  return (
    <>
      {GOOGLE_CLIENT_ID && (
        <Script
          src="https://accounts.google.com/gsi/client"
          strategy="afterInteractive"
          onLoad={() => window.dispatchEvent(new Event('google-loaded'))}
        />
      )}

      <main className="flex min-h-screen w-full">
        {/* ─── Left Hero Panel (hidden on mobile/tablet) ─── */}
        <section className="relative hidden overflow-hidden bg-slate-200/80 lg:flex lg:w-[55%] xl:w-[60%] dark:bg-slate-900">
          {/* Background decorative circles */}
          <div className="pointer-events-none absolute inset-0 opacity-[0.05]">
            <svg className="absolute -right-40 -top-40 h-[160%] w-[160%]" viewBox="0 0 800 800" fill="none" aria-hidden="true">
              <circle cx="550" cy="250" r="200" stroke="#94a3b8" strokeWidth="0.5" />
              <circle cx="550" cy="250" r="300" stroke="#94a3b8" strokeWidth="0.5" />
              <circle cx="550" cy="250" r="400" stroke="#94a3b8" strokeWidth="0.5" />
              <circle cx="550" cy="250" r="500" stroke="#94a3b8" strokeWidth="0.5" />
            </svg>
          </div>

          {/* Left column: Text content */}
          <div className="relative z-10 flex flex-1 flex-col justify-center p-8 xl:p-12 2xl:p-16">
            <div className="absolute left-8 top-10 xl:left-12 xl:top-12 2xl:left-16 2xl:top-14">
              <TrackFlowLogo size={36} showText />
            </div>

            <h1 className="font-extrabold tracking-tight text-slate-950 dark:text-white">
              <span className="block text-4xl xl:text-5xl xl:leading-[1.15]">Workforce monitoring</span>
              <span className="block text-3xl text-orange-500 xl:text-[2.5rem] xl:leading-[1.2]">made simple</span>
            </h1>

            <p className="mt-4 max-w-sm text-base leading-relaxed text-slate-600 dark:text-slate-400">
              Track time, manage teams, and boost productivity with complete
              visibility and real-time insights.
            </p>

            <div className="mt-8 flex flex-col gap-4">
              {FEATURES.map((f) => (
                <div key={f.title} className="flex items-center gap-4">
                  <div
                    className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-full ${f.bg} ${f.color}`}
                  >
                    <f.icon className="h-5 w-5" />
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                      {f.title}
                    </p>
                    <p className="text-sm text-slate-500 dark:text-slate-400">
                      {f.desc}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Right column: Dashboard mockup — positioned at bottom-right, overflows past panel edge */}
          <div className="pointer-events-none absolute bottom-24 right-20 hidden w-[440px] xl:block 2xl:w-[480px]">
            <div className="relative w-full">
              {/* Main dashboard card */}
              <div className="w-full rotate-[5deg] overflow-hidden rounded-2xl border border-slate-200/50 bg-white shadow-[0_25px_60px_-12px_rgba(0,0,0,0.15)] dark:border-slate-700 dark:bg-slate-800">
                <div className="flex">
                  {/* Dark sidebar with nav labels */}
                  <div className="flex w-[80px] shrink-0 flex-col bg-gradient-to-b from-[#0f172a] to-[#1e293b] px-2 pb-3 pt-3 dark:from-slate-950 dark:to-slate-900">
                    {/* Real TrackFlow logo */}
                    <div className="flex items-center gap-1 px-0.5">
                      <TrackFlowLogo size={16} showText={false} />
                      <span className="text-[6.5px] font-bold text-white">Track<span className="text-primary">Flow</span></span>
                    </div>

                    {/* Nav items */}
                    <div className="mt-4 flex flex-col gap-[2px]">
                      <div className="flex items-center gap-1.5 rounded-md bg-white/10 px-1.5 py-[5px]">
                        <div className="h-[7px] w-[7px] rounded-[2px] bg-white/70" />
                        <span className="text-[6.5px] font-medium text-white">Dashboard</span>
                      </div>
                      <div className="flex items-center gap-1.5 px-1.5 py-[5px]">
                        <div className="h-[7px] w-[7px] rounded-[2px] bg-slate-500/40" />
                        <span className="text-[6.5px] text-slate-400">Time Tracking</span>
                      </div>
                      <div className="flex items-center gap-1.5 px-1.5 py-[5px]">
                        <div className="h-[7px] w-[7px] rounded-[2px] bg-slate-500/40" />
                        <span className="text-[6.5px] text-slate-400">Attendance</span>
                      </div>
                      <div className="flex items-center gap-1.5 px-1.5 py-[5px]">
                        <div className="h-[7px] w-[7px] rounded-[2px] bg-slate-500/40" />
                        <span className="text-[6.5px] text-slate-400">Projects</span>
                      </div>
                      <div className="flex items-center gap-1.5 px-1.5 py-[5px]">
                        <div className="h-[7px] w-[7px] rounded-[2px] bg-slate-500/40" />
                        <span className="text-[6.5px] text-slate-400">Reports</span>
                      </div>
                      <div className="flex items-center gap-1.5 px-1.5 py-[5px]">
                        <div className="h-[7px] w-[7px] rounded-[2px] bg-slate-500/40" />
                        <span className="text-[6.5px] text-slate-400">Team</span>
                      </div>
                      <div className="flex items-center gap-1.5 px-1.5 py-[5px]">
                        <div className="h-[7px] w-[7px] rounded-[2px] bg-slate-500/40" />
                        <span className="text-[6.5px] text-slate-400">Settings</span>
                      </div>
                    </div>

                    {/* User avatar */}
                    <div className="mt-auto flex items-center gap-1.5 px-1.5 pt-3">
                      <div className="h-[14px] w-[14px] rounded-full bg-slate-600" />
                      <span className="text-[6.5px] text-slate-400">Dir...</span>
                    </div>
                  </div>

                  {/* Content area — matches real TrackFlow dashboard */}
                  <div className="flex-1 bg-slate-50/50 p-2.5 dark:bg-slate-800/30">
                    {/* Dashboard header */}
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-[9px] font-bold text-slate-800 dark:text-white">Dashboard</p>
                        <p className="text-[5px] text-slate-400">Overview of your team&apos;s activity today</p>
                      </div>
                      <div className="flex items-center gap-0.5 rounded-md border border-slate-200/80 bg-white px-1.5 py-[3px] dark:border-slate-600 dark:bg-slate-700">
                        <svg viewBox="0 0 16 16" className="h-[6px] w-[6px]" fill="none" aria-hidden="true"><rect x="2" y="2" width="12" height="12" rx="2" stroke="#94a3b8" strokeWidth="1.5" /><path d="M2 6h12" stroke="#94a3b8" strokeWidth="1.5" /></svg>
                        <span className="text-[5px] font-medium text-slate-600 dark:text-slate-300">Today</span>
                      </div>
                    </div>

                    {/* 4 Stat cards — colorful gradients */}
                    <div className="mt-2 grid grid-cols-2 gap-1.5">
                      <div className="overflow-hidden rounded-lg bg-gradient-to-br from-orange-500 to-amber-600 p-2 shadow-sm">
                        <div className="flex items-start justify-between">
                          <p className="text-[5px] font-semibold text-white/80">Total Hours Today</p>
                          <span className="rounded-full bg-white/20 px-1 py-[1px] text-[4px] font-bold text-white">+12%</span>
                        </div>
                        <p className="mt-0.5 text-[11px] font-extrabold leading-none text-white">24h 30m</p>
                        <p className="mt-0.5 text-[4.5px] text-white/60">vs. yesterday</p>
                      </div>
                      <div className="overflow-hidden rounded-lg bg-gradient-to-br from-blue-500 to-indigo-600 p-2 shadow-sm">
                        <div className="flex items-start justify-between">
                          <p className="text-[5px] font-semibold text-white/80">Team Online</p>
                          <span className="flex items-center gap-[2px] rounded-full bg-white/20 px-1 py-[1px]">
                            <span className="h-[3px] w-[3px] rounded-full bg-emerald-300" />
                            <span className="text-[4px] font-bold text-white">5 active</span>
                          </span>
                        </div>
                        <p className="mt-0.5 text-[11px] font-extrabold leading-none text-white">5</p>
                        <p className="mt-0.5 text-[4.5px] text-white/60">currently active</p>
                      </div>
                      <div className="overflow-hidden rounded-lg bg-gradient-to-br from-violet-500 to-purple-600 p-2 shadow-sm">
                        <div className="flex items-start justify-between">
                          <p className="text-[5px] font-semibold text-white/80">Active Projects</p>
                          <svg viewBox="0 0 16 16" className="h-[8px] w-[8px]" fill="none" aria-hidden="true"><path d="M3 4h10v8H3z" stroke="white" strokeOpacity="0.7" strokeWidth="1.5" rx="1" /><path d="M6 4V3a1 1 0 011-1h2a1 1 0 011 1v1" stroke="white" strokeOpacity="0.7" strokeWidth="1.5" /></svg>
                        </div>
                        <p className="mt-0.5 text-[11px] font-extrabold leading-none text-white">12</p>
                        <p className="mt-0.5 text-[4.5px] text-white/60">across your organization</p>
                      </div>
                      <div className="overflow-hidden rounded-lg bg-gradient-to-br from-teal-500 to-emerald-600 p-2 shadow-sm">
                        <div className="flex items-start justify-between">
                          <p className="text-[5px] font-semibold text-white/80">Team Members</p>
                          <svg viewBox="0 0 16 16" className="h-[8px] w-[8px]" fill="none" aria-hidden="true"><circle cx="6" cy="5" r="2.5" stroke="white" strokeOpacity="0.7" strokeWidth="1.5" /><path d="M1 14c0-2.8 2.2-5 5-5s5 2.2 5 5" stroke="white" strokeOpacity="0.7" strokeWidth="1.5" /><circle cx="11" cy="5" r="2" stroke="white" strokeOpacity="0.5" strokeWidth="1.2" /><path d="M12 9c1.7 0 3 1.3 3 3" stroke="white" strokeOpacity="0.5" strokeWidth="1.2" /></svg>
                        </div>
                        <p className="mt-0.5 text-[11px] font-extrabold leading-none text-white">8</p>
                        <p className="mt-0.5 text-[4.5px] text-white/60">in your workspace</p>
                      </div>
                    </div>

                    {/* Team Activity chart */}
                    <div className="mt-2 rounded-lg bg-white p-2 shadow-sm ring-1 ring-slate-100 dark:bg-slate-700/60 dark:ring-slate-600">
                      <div className="flex items-start justify-between">
                        <div>
                          <p className="text-[6.5px] font-bold text-slate-800 dark:text-white">Team Activity This Week</p>
                          <p className="text-[4.5px] text-slate-400">Hours tracked and activity scores</p>
                        </div>
                        <div className="flex gap-[2px]">
                          <span className="rounded border border-slate-200 px-1 py-[2px] text-[3.5px] text-slate-400 dark:border-slate-600">Last 30 days</span>
                          <span className="rounded border border-blue-300 bg-blue-50 px-1 py-[2px] text-[3.5px] font-semibold text-blue-600 dark:border-blue-500 dark:bg-blue-900/30 dark:text-blue-400">Last 7 days</span>
                        </div>
                      </div>
                      <svg className="mt-1 h-[68px] w-full" viewBox="0 0 200 52" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
                        <defs>
                          <linearGradient id="mockBlueGrad" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stopColor="#3B82F6" stopOpacity="0.25" />
                            <stop offset="100%" stopColor="#3B82F6" stopOpacity="0.02" />
                          </linearGradient>
                          <linearGradient id="mockGreenGrad" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stopColor="#22C55E" stopOpacity="0.2" />
                            <stop offset="100%" stopColor="#22C55E" stopOpacity="0.02" />
                          </linearGradient>
                        </defs>
                        <text x="3" y="6" fontSize="3.5" fill="#94a3b8">4</text>
                        <text x="3" y="16" fontSize="3.5" fill="#94a3b8">3</text>
                        <text x="3" y="26" fontSize="3.5" fill="#94a3b8">2</text>
                        <text x="3" y="36" fontSize="3.5" fill="#94a3b8">1</text>
                        <text x="3" y="45" fontSize="3.5" fill="#94a3b8">0</text>
                        <line x1="12" y1="4" x2="195" y2="4" stroke="#f1f5f9" strokeWidth="0.3" />
                        <line x1="12" y1="14" x2="195" y2="14" stroke="#f1f5f9" strokeWidth="0.3" />
                        <line x1="12" y1="24" x2="195" y2="24" stroke="#f1f5f9" strokeWidth="0.3" />
                        <line x1="12" y1="34" x2="195" y2="34" stroke="#f1f5f9" strokeWidth="0.3" />
                        <line x1="12" y1="43" x2="195" y2="43" stroke="#f1f5f9" strokeWidth="0.3" />
                        <path d="M16 38 L42 28 L68 18 L94 10 L120 14 L146 6 L172 12 L172 43 L16 43Z" fill="url(#mockBlueGrad)" />
                        <path d="M16 38 L42 28 L68 18 L94 10 L120 14 L146 6 L172 12" stroke="#3B82F6" strokeWidth="1.2" strokeLinecap="round" fill="none" />
                        <path d="M16 40 L42 34 L68 26 L94 20 L120 24 L146 14 L172 18 L172 43 L16 43Z" fill="url(#mockGreenGrad)" />
                        <path d="M16 40 L42 34 L68 26 L94 20 L120 24 L146 14 L172 18" stroke="#22C55E" strokeWidth="1" strokeLinecap="round" fill="none" />
                        <circle cx="94" cy="10" r="2" fill="white" stroke="#3B82F6" strokeWidth="1.2" />
                        <circle cx="146" cy="6" r="2" fill="white" stroke="#3B82F6" strokeWidth="1.2" />
                        <circle cx="94" cy="20" r="1.5" fill="white" stroke="#22C55E" strokeWidth="1" />
                        <text x="16" y="49" fontSize="3.5" fill="#94a3b8" textAnchor="middle">Mon</text>
                        <text x="42" y="49" fontSize="3.5" fill="#94a3b8" textAnchor="middle">Tue</text>
                        <text x="68" y="49" fontSize="3.5" fill="#94a3b8" textAnchor="middle">Wed</text>
                        <text x="94" y="49" fontSize="3.5" fill="#94a3b8" textAnchor="middle">Thu</text>
                        <text x="120" y="49" fontSize="3.5" fill="#94a3b8" textAnchor="middle">Fri</text>
                        <text x="146" y="49" fontSize="3.5" fill="#94a3b8" textAnchor="middle">Sat</text>
                        <text x="172" y="49" fontSize="3.5" fill="#94a3b8" textAnchor="middle">Sun</text>
                      </svg>
                      <div className="flex items-center justify-center gap-3">
                        <div className="flex items-center gap-[3px]">
                          <div className="h-[3px] w-[6px] rounded-full bg-emerald-500" />
                          <span className="text-[4px] text-slate-500 dark:text-slate-400">Activity %</span>
                        </div>
                        <div className="flex items-center gap-[3px]">
                          <div className="h-[3px] w-[6px] rounded-full bg-blue-500" />
                          <span className="text-[4px] text-slate-500 dark:text-slate-400">Hours Tracked</span>
                        </div>
                      </div>
                    </div>

                    {/* Team Activity member list */}
                    <div className="mt-1.5 rounded-lg bg-white p-2 shadow-sm ring-1 ring-slate-100 dark:bg-slate-700/60 dark:ring-slate-600">
                      <p className="text-[6.5px] font-bold text-slate-800 dark:text-white">Team Activity</p>
                      <p className="text-[4px] text-slate-400">Real-time activity status of your team</p>
                      <div className="mt-1 flex items-center border-b border-slate-100 pb-[3px] dark:border-slate-600">
                        <span className="flex-1 text-[4px] font-semibold text-slate-400">Member</span>
                        <span className="w-[24px] text-center text-[4px] font-semibold text-slate-400">Status</span>
                        <span className="w-[22px] text-right text-[4px] font-semibold text-slate-400">Hours</span>
                        <span className="w-[30px] text-right text-[4px] font-semibold text-slate-400">Activity</span>
                      </div>
                      <div className="mt-[3px] flex items-center">
                        <div className="flex flex-1 items-center gap-[3px]">
                          <span className="inline-flex h-[9px] w-[9px] items-center justify-center rounded-full bg-gradient-to-br from-blue-400 to-blue-600 text-[3.5px] font-bold text-white">A</span>
                          <span className="text-[4.5px] font-semibold text-slate-700 dark:text-slate-200">Alice Developer</span>
                        </div>
                        <div className="flex w-[24px] justify-center">
                          <span className="flex items-center gap-[2px] rounded-full bg-emerald-50 px-[3px] py-[1px] dark:bg-emerald-900/30">
                            <span className="h-[3px] w-[3px] rounded-full bg-emerald-500" />
                            <span className="text-[3px] font-bold text-emerald-600 dark:text-emerald-400">Online</span>
                          </span>
                        </div>
                        <span className="w-[22px] text-right text-[4.5px] font-bold text-slate-800 dark:text-white">04:32</span>
                        <div className="flex w-[30px] items-center justify-end gap-[2px]">
                          <div className="h-[3px] w-[18px] rounded-full bg-slate-100 dark:bg-slate-600">
                            <div className="h-full w-[78%] rounded-full bg-gradient-to-r from-blue-400 to-blue-500" />
                          </div>
                          <span className="text-[3.5px] font-medium text-slate-500">78%</span>
                        </div>
                      </div>
                      <div className="mt-[3px] flex items-center">
                        <div className="flex flex-1 items-center gap-[3px]">
                          <span className="inline-flex h-[9px] w-[9px] items-center justify-center rounded-full bg-gradient-to-br from-rose-400 to-rose-600 text-[3.5px] font-bold text-white">B</span>
                          <span className="text-[4.5px] font-semibold text-slate-700 dark:text-slate-200">Bob Designer</span>
                        </div>
                        <div className="flex w-[24px] justify-center">
                          <span className="flex items-center gap-[2px] rounded-full bg-emerald-50 px-[3px] py-[1px] dark:bg-emerald-900/30">
                            <span className="h-[3px] w-[3px] rounded-full bg-emerald-500" />
                            <span className="text-[3px] font-bold text-emerald-600 dark:text-emerald-400">Online</span>
                          </span>
                        </div>
                        <span className="w-[22px] text-right text-[4.5px] font-bold text-slate-800 dark:text-white">03:15</span>
                        <div className="flex w-[30px] items-center justify-end gap-[2px]">
                          <div className="h-[3px] w-[18px] rounded-full bg-slate-100 dark:bg-slate-600">
                            <div className="h-full w-[65%] rounded-full bg-gradient-to-r from-amber-400 to-amber-500" />
                          </div>
                          <span className="text-[3.5px] font-medium text-slate-500">65%</span>
                        </div>
                      </div>
                      <div className="mt-[3px] flex items-center">
                        <div className="flex flex-1 items-center gap-[3px]">
                          <span className="inline-flex h-[9px] w-[9px] items-center justify-center rounded-full bg-gradient-to-br from-purple-400 to-purple-600 text-[3.5px] font-bold text-white">C</span>
                          <span className="text-[4.5px] font-semibold text-slate-700 dark:text-slate-200">Carol PM</span>
                        </div>
                        <div className="flex w-[24px] justify-center">
                          <span className="flex items-center gap-[2px] rounded-full bg-slate-100 px-[3px] py-[1px] dark:bg-slate-600">
                            <span className="h-[3px] w-[3px] rounded-full bg-slate-400" />
                            <span className="text-[3px] font-bold text-slate-500 dark:text-slate-400">Offline</span>
                          </span>
                        </div>
                        <span className="w-[22px] text-right text-[4.5px] font-bold text-slate-800 dark:text-white">00:00</span>
                        <div className="flex w-[30px] items-center justify-end gap-[2px]">
                          <div className="h-[3px] w-[18px] rounded-full bg-slate-100 dark:bg-slate-600" />
                          <span className="text-[3.5px] font-medium text-slate-500">0%</span>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {/* Floating "Active Users" card */}
              <div className="absolute -bottom-8 -left-4 -rotate-[3deg] rounded-xl border border-slate-100 bg-white px-3.5 py-3 shadow-[0_12px_36px_-8px_rgba(0,0,0,0.12)] dark:border-slate-700 dark:bg-slate-800">
                <p className="text-[7px] font-semibold text-slate-500 dark:text-slate-400">Active Users</p>
                <div className="mt-1 flex items-end gap-3">
                  <div>
                    <p className="text-[22px] font-extrabold leading-none text-slate-900 dark:text-white">42</p>
                    <div className="mt-1 flex items-center gap-1">
                      <span className="h-[5px] w-[5px] rounded-full bg-emerald-500" />
                      <span className="text-[6.5px] font-medium text-emerald-600 dark:text-emerald-400">Online now</span>
                    </div>
                  </div>
                  {/* Mini bar chart */}
                  <div className="flex items-end gap-[3px] pb-1">
                    <div className="h-[14px] w-[5px] rounded-sm bg-gradient-to-t from-orange-400 to-orange-300" />
                    <div className="h-[20px] w-[5px] rounded-sm bg-gradient-to-t from-orange-500 to-orange-400" />
                    <div className="h-[12px] w-[5px] rounded-sm bg-gradient-to-t from-orange-400 to-orange-300" />
                    <div className="h-[24px] w-[5px] rounded-sm bg-gradient-to-t from-orange-500 to-amber-400" />
                    <div className="h-[18px] w-[5px] rounded-sm bg-gradient-to-t from-orange-500 to-orange-400" />
                    <div className="h-[10px] w-[5px] rounded-sm bg-gradient-to-t from-orange-400 to-orange-300" />
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* ─── Right Form Panel (always visible) ─── */}
        <section className="flex w-full flex-col items-center justify-center bg-white px-6 py-10 lg:w-[45%] xl:w-[40%] dark:bg-slate-950">
          {/* Logo for mobile/tablet (left panel is hidden there) */}
          <div className="mb-8 lg:hidden">
            <TrackFlowLogo size={32} showText />
          </div>

          <div className="w-full max-w-[440px]">
            <Card className="w-full rounded-2xl border border-slate-200/80 bg-white shadow-xl shadow-slate-200/40 dark:border-slate-800 dark:bg-slate-900 dark:shadow-none">
              <CardHeader className="space-y-1.5 pb-2 text-center">
                <CardTitle className="text-2xl font-bold text-slate-950 dark:text-white">
                  Welcome back!
                </CardTitle>
                <CardDescription className="text-sm text-slate-500 dark:text-slate-400">
                  Sign in to your{' '}
                  <span className="font-semibold text-orange-500">TrackFlow</span>{' '}
                  account
                </CardDescription>
              </CardHeader>

              <CardContent className="space-y-5 pt-2">
                {/* Google sign-in */}
                <Button
                  type="button"
                  onClick={handleGoogleSignIn}
                  className="flex h-12 w-full items-center justify-center gap-3 rounded-xl border border-slate-200 bg-white text-sm font-medium text-slate-800 shadow-sm transition hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
                  disabled={!googleReady || googleLoading}
                >
                  {googleLoading ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <svg viewBox="0 0 24 24" className="h-5 w-5 shrink-0" aria-hidden="true">
                      <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.27-4.74 3.27-8.1z" />
                      <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
                      <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
                      <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
                    </svg>
                  )}
                  Sign in with Google
                </Button>

                {/* Divider */}
                <div className="relative">
                  <div className="absolute inset-x-0 top-1/2 h-px bg-slate-200 dark:bg-slate-700" />
                  <div className="relative mx-auto w-fit bg-white px-4 text-[11px] font-medium uppercase tracking-[0.2em] text-slate-400 dark:bg-slate-900 dark:text-slate-500">
                    or continue with email
                  </div>
                </div>

                {/* Login form */}
                <Form {...form}>
                  <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
                    {error && (
                      <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-950/50 dark:text-red-400">
                        {error}
                      </div>
                    )}

                    {/* Email field */}
                    <FormField
                      control={form.control}
                      name="email"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel className="text-sm font-medium text-slate-700 dark:text-slate-300">
                            Email address
                          </FormLabel>
                          <FormControl>
                            <div className="relative">
                              <span className="pointer-events-none absolute inset-y-0 left-4 flex items-center text-slate-400">
                                <Mail className="h-4 w-4" />
                              </span>
                              <Input
                                type="email"
                                placeholder="your.email@company.com"
                                autoComplete="email"
                                className="h-12 bg-slate-50 pl-11 text-slate-900 placeholder:text-slate-400 dark:bg-slate-800 dark:text-slate-100 dark:placeholder:text-slate-500"
                                {...field}
                              />
                            </div>
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    {/* Password field */}
                    <FormField
                      control={form.control}
                      name="password"
                      render={({ field }) => (
                        <FormItem>
                          <div className="flex items-center justify-between">
                            <FormLabel className="text-sm font-medium text-slate-700 dark:text-slate-300">
                              Password
                            </FormLabel>
                            <Link
                              href="/forgot-password"
                              className="text-sm font-medium text-orange-500 hover:text-orange-600 dark:text-orange-400"
                            >
                              Forgot password?
                            </Link>
                          </div>
                          <FormControl>
                            <PasswordInput
                              placeholder="Enter your password"
                              autoComplete="current-password"
                              className="h-12 bg-slate-50 text-slate-900 placeholder:text-slate-400 dark:bg-slate-800 dark:text-slate-100 dark:placeholder:text-slate-500"
                              {...field}
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    {/* Remember me */}
                    <div className="flex items-center justify-between py-1">
                      <label className="flex items-center gap-2.5 text-sm">
                        <input
                          type="checkbox"
                          checked={rememberMe}
                          onChange={(e) => setRememberMe(e.target.checked)}
                          className="h-4 w-4 rounded border-slate-300 accent-orange-500"
                        />
                        <span className="font-medium text-slate-700 dark:text-slate-300">
                          Remember me
                        </span>
                      </label>
                      <span className="flex items-center gap-1.5 text-xs text-slate-400">
                        Keep me signed in
                        <Info className="h-3.5 w-3.5" />
                      </span>
                    </div>

                    {/* Sign in button */}
                    <Button
                      type="submit"
                      className="h-12 w-full rounded-xl bg-orange-500 text-sm font-semibold text-white shadow-lg shadow-orange-500/20 transition hover:bg-orange-600 dark:bg-orange-600 dark:hover:bg-orange-700"
                      disabled={form.formState.isSubmitting}
                    >
                      {form.formState.isSubmitting ? (
                        <span className="inline-flex items-center gap-2">
                          <Loader2 className="h-4 w-4 animate-spin" />
                          Signing in...
                        </span>
                      ) : (
                        'Sign in'
                      )}
                    </Button>
                  </form>
                </Form>
              </CardContent>

              <CardFooter className="justify-center border-t border-slate-100 pt-5 dark:border-slate-800">
                <p className="text-sm text-slate-500 dark:text-slate-400">
                  Don&apos;t have an account?{' '}
                  <Link
                    href="/register"
                    className="font-semibold text-orange-500 hover:text-orange-600 dark:text-orange-400"
                  >
                    Sign up
                  </Link>
                </p>
              </CardFooter>
            </Card>

            {/* Security footer */}
            <div className="mt-6 flex items-center justify-center gap-2 text-xs text-slate-400 dark:text-slate-500">
              <ShieldCheck className="h-4 w-4" />
              <span>Your data is safe with us. We never share your information.</span>
            </div>
          </div>
        </section>
      </main>
    </>
  );
}
