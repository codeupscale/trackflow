'use client';

import { Suspense, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { z } from 'zod/v4';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Loader2, CheckCircle2 } from 'lucide-react';
import { toast } from 'sonner';

import api from '@/lib/api';
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
  const [error, setError] = useState<string | null>(
    token ? null : 'Missing invitation token. Please use the link from your email.'
  );

  const form = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: { name: '', password: '', password_confirmation: '' },
  });

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
      <div className="min-h-screen flex items-center justify-center bg-background p-4">
        <div className="flex items-center gap-2 text-foreground">
          <CheckCircle2 className="h-5 w-5 text-emerald-400" />
          Opening dashboard…
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background dark:bg-gradient-to-br dark:from-slate-950 dark:via-slate-900 dark:to-slate-950 p-4">
      <Card className="w-full max-w-md border-border bg-card/80 backdrop-blur">
        <CardHeader className="space-y-1">
          <CardTitle className="text-2xl text-center text-foreground">Accept invitation</CardTitle>
          <CardDescription className="text-center text-muted-foreground">
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
                    <FormLabel>Full name</FormLabel>
                    <FormControl>
                      <Input
                        placeholder="Your name"
                        className="bg-background"
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
                    <FormLabel>Password</FormLabel>
                    <FormControl>
                      <PasswordInput
                        placeholder="Create a password"
                        autoComplete="new-password"
                        className="bg-background"
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
                    <FormLabel>Confirm password</FormLabel>
                    <FormControl>
                      <PasswordInput
                        placeholder="Confirm password"
                        autoComplete="new-password"
                        className="bg-background"
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
                className="w-full"
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
        <CardFooter className="justify-center text-xs text-muted-foreground">
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
        <div className="min-h-screen flex items-center justify-center bg-background">
          <div className="flex items-center gap-2 text-muted-foreground">
            <div className="h-5 w-5 animate-spin rounded-full border-2 border-muted border-t-blue-500" />
            Loading…
          </div>
        </div>
      }
    >
      <AcceptInviteContent />
    </Suspense>
  );
}

