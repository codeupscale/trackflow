'use client';

import { Suspense, useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { z } from 'zod/v4';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Loader2, CheckCircle2 } from 'lucide-react';
import { toast } from 'sonner';

import api from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
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
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import { useAuthStore } from '@/stores/auth-store';

const schema = z.object({
  name: z.string().min(2, 'Name is required'),
  password: z.string().min(8, 'Password must be at least 8 characters'),
  password_confirmation: z.string().min(8, 'Please confirm your password'),
}).refine((v) => v.password === v.password_confirmation, {
  message: 'Passwords do not match',
  path: ['password_confirmation'],
});

type Values = z.infer<typeof schema>;

function AcceptInviteContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { setUser } = useAuthStore();

  const token = useMemo(() => searchParams.get('token')?.trim() || '', [searchParams]);
  const [state, setState] = useState<'idle' | 'success'>('idle');
  const [error, setError] = useState<string | null>(null);

  const form = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: { name: '', password: '', password_confirmation: '' },
  });

  useEffect(() => {
    if (!token) {
      setError('Missing invitation token. Please use the link from your email.');
    }
  }, [token]);

  const onSubmit = async (values: Values) => {
    if (!token) return;
    setError(null);
    try {
      const res = await api.post('/invitations/accept', {
        token,
        name: values.name,
        password: values.password,
        password_confirmation: values.password_confirmation,
      });

      // Store tokens and user, then redirect (and clean URL via auto-login page)
      localStorage.setItem('access_token', res.data.access_token);
      localStorage.setItem('refresh_token', res.data.refresh_token);
      setUser(res.data.user);

      setState('success');
      toast.success('Invitation accepted. Welcome!');

      // Use auto-login route to ensure URL doesn't keep token param
      router.replace(`/auth/auto-login?token=${encodeURIComponent(res.data.access_token)}&refresh=${encodeURIComponent(res.data.refresh_token)}&redirect=/dashboard`);
    } catch (err: unknown) {
      const e = err as { response?: { status?: number; data?: { message?: string } }; message?: string };
      const message = e.response?.data?.message || e.message || 'Failed to accept invitation';
      if (e.response?.status === 410) {
        setError('This invitation has expired. Ask your admin to resend it.');
      } else if (e.response?.status === 404) {
        setError('This invitation link is invalid or already used.');
      } else {
        setError(message);
      }
      toast.error(message);
    }
  };

  if (state === 'success') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-950 p-4">
        <div className="flex items-center gap-2 text-slate-300">
          <CheckCircle2 className="h-5 w-5 text-emerald-400" />
          Opening dashboard…
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 p-4">
      <Card className="w-full max-w-md border-slate-800 bg-slate-900/50 backdrop-blur">
        <CardHeader className="space-y-1">
          <CardTitle className="text-2xl text-center text-white">Accept invitation</CardTitle>
          <CardDescription className="text-center text-slate-400">
            Create your account to join your team on TrackFlow.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {error && (
            <div className="bg-red-500/10 text-red-400 text-sm p-3 rounded-md border border-red-500/20 mb-4">
              {error}
            </div>
          )}
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
              <FormField
                control={form.control}
                name="name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-slate-300">Full name</FormLabel>
                    <FormControl>
                      <Input
                        placeholder="Your name"
                        className="bg-slate-800/50 border-slate-700 text-white placeholder:text-slate-500"
                        disabled={!token}
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
                    <FormLabel className="text-slate-300">Password</FormLabel>
                    <FormControl>
                      <Input
                        type="password"
                        placeholder="Create a password"
                        autoComplete="new-password"
                        className="bg-slate-800/50 border-slate-700 text-white placeholder:text-slate-500"
                        disabled={!token}
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="password_confirmation"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-slate-300">Confirm password</FormLabel>
                    <FormControl>
                      <Input
                        type="password"
                        placeholder="Confirm password"
                        autoComplete="new-password"
                        className="bg-slate-800/50 border-slate-700 text-white placeholder:text-slate-500"
                        disabled={!token}
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <Button
                type="submit"
                disabled={!token || form.formState.isSubmitting}
                className="w-full bg-blue-600 hover:bg-blue-700 text-white"
              >
                {form.formState.isSubmitting ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Accepting…
                  </>
                ) : (
                  'Accept & create account'
                )}
              </Button>
            </form>
          </Form>
        </CardContent>
        <CardFooter className="justify-center text-xs text-slate-500">
          If you already have an account, ask your admin to add you to the organization.
        </CardFooter>
      </Card>
    </div>
  );
}

export default function AcceptInvitePage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen flex items-center justify-center bg-slate-950">
          <div className="flex items-center gap-2 text-slate-400">
            <div className="h-5 w-5 animate-spin rounded-full border-2 border-slate-600 border-t-blue-500" />
            Loading…
          </div>
        </div>
      }
    >
      <AcceptInviteContent />
    </Suspense>
  );
}

