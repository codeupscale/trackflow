'use client';

import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import Script from 'next/script';
import { useForm } from 'react-hook-form';
import { z } from 'zod/v4';
import { zodResolver } from '@hookform/resolvers/zod';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { PasswordInput } from '@/components/ui/password-input';
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

  // If already logged in, redirect to dashboard
  useEffect(() => {
    const token = localStorage.getItem('access_token');
    if (token) {
      router.replace('/dashboard');
    }
  }, [router]);
  const [error, setError] = useState<string | null>(null);

  // Google Sign-In callback — now handles multi-org
  const handleGoogleResponse = useCallback(async (response: { credential: string }) => {
    setError(null);
    setGoogleLoading(true);
    try {
      const res = await api.post('/auth/google', { id_token: response.credential });

      if (res.data.requires_org_selection) {
        // Multi-org detected — show org selector
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

  // Initialize Google Sign-In
  useEffect(() => {
    if (!GOOGLE_CLIENT_ID) return;

    const initGoogle = () => {
      if (typeof window !== 'undefined' && (window as unknown as Record<string, unknown>).google) {
        const google = (window as unknown as { google: { accounts: { id: { initialize: (config: Record<string, unknown>) => void; renderButton: (el: HTMLElement | null, config: Record<string, unknown>) => void } } } }).google;
        google.accounts.id.initialize({
          client_id: GOOGLE_CLIENT_ID,
          callback: handleGoogleResponse,
        });
        google.accounts.id.renderButton(
          document.getElementById('google-signin-btn'),
          { theme: 'outline', size: 'large', width: 360, text: 'signin_with', shape: 'rectangular' }
        );
      }
    };

    // If script already loaded
    initGoogle();

    // Also listen for script load
    window.addEventListener('google-loaded', initGoogle);
    return () => window.removeEventListener('google-loaded', initGoogle);
  }, [handleGoogleResponse]);

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
        // Multi-org — org selector will show via pendingOrgSelection state
        return;
      }
      toast.success('Welcome back!');
      router.push('/dashboard');
    } catch (err: unknown) {
      const axiosError = err as { response?: { data?: { message?: string } } };
      const message = axiosError.response?.data?.message || (err as Error).message || 'Invalid credentials. Please try again.';
      setError(message);
      toast.error(message);
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

  // Show org selector if pending
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
        <OrgSelector
          organizations={pendingOrgSelection.organizations}
          onSelect={handleOrgSelect}
          onBack={handleOrgSelectBack}
        />
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
    <Card className="border-border bg-card/80 backdrop-blur">
      <CardHeader className="space-y-1">
        <CardTitle className="text-2xl text-center text-foreground">Sign in</CardTitle>
        <CardDescription className="text-center text-muted-foreground">
          Enter your credentials to access your account
        </CardDescription>
      </CardHeader>
      <CardContent>
        {/* Google Sign-In */}
        {GOOGLE_CLIENT_ID && (
          <>
            <div className="flex justify-center mb-4">
              {googleLoading ? (
                <Button variant="outline" className="w-full border-border" disabled>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Signing in with Google...
                </Button>
              ) : (
                <div id="google-signin-btn" className="flex justify-center w-full" />
              )}
            </div>
            <div className="relative mb-4">
              <div className="absolute inset-0 flex items-center">
                <span className="w-full border-t border-border" />
              </div>
              <div className="relative flex justify-center text-xs uppercase">
                <span className="bg-card px-2 text-muted-foreground">or continue with email</span>
              </div>
            </div>
          </>
        )}

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            {error && (
              <div className="bg-destructive/10 text-destructive text-sm p-3 rounded-md border border-destructive/20">
                {error}
              </div>
            )}
            <FormField
              control={form.control}
              name="email"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Email</FormLabel>
                  <FormControl>
                    <Input
                      type="email"
                      placeholder="you@example.com"
                      autoComplete="email"
                      className="bg-background"
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="password"
              render={({ field }) => (
                <FormItem>
                  <div className="flex items-center justify-between">
                    <FormLabel>Password</FormLabel>
                    <Link
                      href="/forgot-password"
                      className="text-xs text-muted-foreground hover:text-blue-600 underline-offset-4 hover:underline transition-colors"
                    >
                      Forgot password?
                    </Link>
                  </div>
                  <FormControl>
                    <PasswordInput
                      placeholder="Enter your password"
                      autoComplete="current-password"
                      className="bg-background"
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <Button
              type="submit"
              className="w-full"
              disabled={form.formState.isSubmitting}
            >
              {form.formState.isSubmitting && (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              )}
              Sign in
            </Button>
          </form>
        </Form>
      </CardContent>
      <CardFooter className="flex justify-center border-t border-border pt-6">
        <p className="text-sm text-muted-foreground">
          Don&apos;t have an account?{' '}
          <Link
            href="/register"
            className="text-primary font-medium hover:underline underline-offset-4"
          >
            Sign up
          </Link>
        </p>
      </CardFooter>
    </Card>
    </>
  );
}
