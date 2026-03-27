'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useForm } from 'react-hook-form';
import { z } from 'zod/v4';
import { zodResolver } from '@hookform/resolvers/zod';
import { ArrowLeft, Loader2, Mail } from 'lucide-react';
import { toast } from 'sonner';

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
  FormField,
  FormItem,
  FormLabel,
  FormControl,
  FormMessage,
} from '@/components/ui/form';
import api from '@/lib/api';

const forgotPasswordSchema = z.object({
  email: z.string().min(1, 'Email is required').email('Invalid email address'),
});

type ForgotPasswordFormValues = z.infer<typeof forgotPasswordSchema>;

export default function ForgotPasswordPage() {
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const form = useForm<ForgotPasswordFormValues>({
    resolver: zodResolver(forgotPasswordSchema),
    defaultValues: {
      email: '',
    },
  });

  const onSubmit = async (values: ForgotPasswordFormValues) => {
    setError(null);
    try {
      await api.post('/auth/forgot-password', { email: values.email });
      setSubmitted(true);
      toast.success('Reset link sent! Check your email.');
    } catch (err: unknown) {
      const axiosError = err as { response?: { data?: { message?: string } } };
      const message = axiosError.response?.data?.message || 'Unable to send reset link. Please try again.';
      setError(message);
      toast.error(message);
    }
  };

  if (submitted) {
    return (
      <Card className="border-border bg-card/80 backdrop-blur">
        <CardHeader className="space-y-1 text-center">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
            <Mail className="h-6 w-6 text-primary" />
          </div>
          <CardTitle className="text-2xl text-foreground">Check your email</CardTitle>
          <CardDescription className="text-muted-foreground">
            We&apos;ve sent a password reset link to your email address. Please check
            your inbox.
          </CardDescription>
        </CardHeader>
        <CardFooter className="flex justify-center border-t border-border pt-6">
          <Link
            href="/login"
            className="text-sm text-primary font-medium hover:underline underline-offset-4 inline-flex items-center gap-1"
          >
            <ArrowLeft className="h-3 w-3" />
            Back to sign in
          </Link>
        </CardFooter>
      </Card>
    );
  }

  return (
    <Card className="border-border bg-card/80 backdrop-blur">
      <CardHeader className="space-y-1">
        <CardTitle className="text-2xl text-center text-foreground">Reset password</CardTitle>
        <CardDescription className="text-center text-muted-foreground">
          Enter your email address and we&apos;ll send you a reset link
        </CardDescription>
      </CardHeader>
      <CardContent>
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
            <Button
              type="submit"
              className="w-full"
              disabled={form.formState.isSubmitting}
            >
              {form.formState.isSubmitting && (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              )}
              Send Reset Link
            </Button>
          </form>
        </Form>
      </CardContent>
      <CardFooter className="flex justify-center border-t border-border pt-6">
        <Link
          href="/login"
          className="text-sm text-muted-foreground hover:text-foreground inline-flex items-center gap-1 transition-colors"
        >
          <ArrowLeft className="h-3 w-3" />
          Back to sign in
        </Link>
      </CardFooter>
    </Card>
  );
}
