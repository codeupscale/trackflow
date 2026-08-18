'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  CreditCard,
  CheckCircle,
  ArrowLeft,
  Users,
  Zap,
  AlertTriangle,
  Receipt,
  Crown,
  Download,
} from 'lucide-react';
import Link from 'next/link';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
} from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import api from '@/lib/api';
import { useAuthStore } from '@/stores/auth-store';
import { usePermissionStore } from '@/stores/permission-store';

interface BillingUsage {
  seats_used: number;
  seats_limit: number;
  plan: string;
  trial_ends_at: string | null;
  subscription_renews_at: string | null;
}

interface Invoice {
  id: string;
  date: string;
  amount: number;
  status: string;
  pdf_url: string | null;
}

const plans = [
  {
    name: 'Trial',
    price: 'Free',
    seats: '5 seats',
    features: ['Time tracking', 'Screenshots', 'Basic reports', '5 team members'],
  },
  {
    name: 'Starter',
    price: '$5/user/mo',
    seats: '20 seats',
    features: ['Everything in Trial', 'Advanced reports', 'Payroll', '20 team members', 'Priority support'],
  },
  {
    name: 'Pro',
    price: '$9/user/mo',
    seats: 'Unlimited',
    features: ['Everything in Starter', 'Unlimited members', 'Custom integrations', 'API access', 'Dedicated support'],
  },
];

export default function BillingPage() {
  const { user } = useAuthStore();
  const { hasPermission } = usePermissionStore();
  const [cancelDialogOpen, setCancelDialogOpen] = useState(false);

  if (!hasPermission('settings.manage_billing')) {
    return (
      <div className="flex flex-col items-center justify-center h-64 gap-2">
        <CreditCard className="h-8 w-8 text-muted-foreground" />
        <p className="text-xs text-muted-foreground">You do not have access to billing settings.</p>
      </div>
    );
  }

  const { data: usage, isLoading: usageLoading } = useQuery<BillingUsage>({
    queryKey: ['billing-usage'],
    queryFn: async () => {
      const res = await api.get('/billing/usage');
      return res.data;
    },
  });

  const { data: invoices } = useQuery<Invoice[]>({
    queryKey: ['billing-invoices'],
    queryFn: async () => {
      const res = await api.get('/billing/invoices');
      return res.data.invoices || res.data || [];
    },
  });

  const seatPercentage = usage ? Math.round((usage.seats_used / usage.seats_limit) * 100) : 0;
  const currentPlan = usage?.plan || user?.organization?.plan || 'trial';
  const isTrial = currentPlan === 'trial';

  const handleCancelSubscription = async () => {
    try {
      await api.post('/billing/cancel');
      toast.success('Subscription cancelled');
      setCancelDialogOpen(false);
    } catch {
      toast.error('Failed to cancel subscription');
    }
  };

  return (
    <div className="flex flex-col gap-4">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Link href="/settings">
          <Button variant="ghost" className="h-8 text-xs text-muted-foreground hover:text-foreground">
            <ArrowLeft className="h-3.5 w-3.5 mr-1" />
            Settings
          </Button>
        </Link>
        <div>
          <h1 className="text-lg font-semibold tracking-tight text-foreground">Billing</h1>
          <p className="text-xs text-muted-foreground">Manage your subscription and invoices</p>
        </div>
      </div>

      {/* Stats Strip */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Card>
          <CardContent className="p-3">
            <div className="flex items-center gap-3">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-500/10">
                <Crown className="h-4 w-4 text-blue-500" />
              </div>
              <div>
                <p className="text-[0.65rem] font-medium text-muted-foreground uppercase tracking-wider">Current Plan</p>
                <p className="text-base font-bold tabular-nums leading-tight capitalize">{currentPlan}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-3">
            <div className="flex items-center gap-3">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-500/10">
                <Users className="h-4 w-4 text-emerald-500" />
              </div>
              <div>
                <p className="text-[0.65rem] font-medium text-muted-foreground uppercase tracking-wider">Seats Used</p>
                <p className="text-base font-bold tabular-nums leading-tight">
                  {usage?.seats_used ?? '-'}<span className="text-xs font-normal text-muted-foreground">/{usage?.seats_limit ?? '-'}</span>
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-3">
            <div className="flex items-center gap-3">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-amber-500/10">
                <Zap className="h-4 w-4 text-amber-500" />
              </div>
              <div>
                <p className="text-[0.65rem] font-medium text-muted-foreground uppercase tracking-wider">Status</p>
                <p className="text-base font-bold leading-tight">
                  {isTrial ? (
                    <span className="inline-flex items-center gap-1.5 text-[0.75rem] font-medium text-amber-600 dark:text-amber-400">
                      <span className="inline-block w-1.5 h-1.5 rounded-full bg-amber-500" />
                      Trial
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1.5 text-[0.75rem] font-medium text-emerald-600 dark:text-emerald-400">
                      <span className="inline-block w-1.5 h-1.5 rounded-full bg-emerald-500" />
                      Active
                    </span>
                  )}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-3">
            <div className="flex items-center gap-3">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-violet-500/10">
                <Receipt className="h-4 w-4 text-violet-500" />
              </div>
              <div>
                <p className="text-[0.65rem] font-medium text-muted-foreground uppercase tracking-wider">Invoices</p>
                <p className="text-base font-bold tabular-nums leading-tight">{invoices?.length ?? 0}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Current Plan Card */}
      <Card>
        <div className="px-4 pt-3 pb-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-amber-500/10">
                <Zap className="h-3.5 w-3.5 text-amber-500" />
              </div>
              <div>
                <h3 className="text-sm font-semibold">Current Plan</h3>
                <p className="text-[0.65rem] text-muted-foreground">Your active subscription details</p>
              </div>
            </div>
            {isTrial ? (
              <span className="inline-flex items-center gap-1.5 text-[0.7rem] font-medium text-amber-600 dark:text-amber-400">
                <span className="inline-block w-1.5 h-1.5 rounded-full bg-amber-500" />
                Trial
              </span>
            ) : (
              <span className="inline-flex items-center gap-1.5 text-[0.7rem] font-medium text-emerald-600 dark:text-emerald-400">
                <span className="inline-block w-1.5 h-1.5 rounded-full bg-emerald-500" />
                Active
              </span>
            )}
          </div>
        </div>
        <CardContent className="pt-0">
          {usageLoading ? (
            <div className="space-y-2">
              <div className="h-5 w-36 bg-muted animate-pulse rounded" />
              <div className="h-2 w-full bg-muted animate-pulse rounded" />
            </div>
          ) : (
            <div className="space-y-3">
              <p className="text-sm font-bold text-foreground capitalize">{currentPlan}</p>

              {/* Seat usage meter */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between text-[0.7rem]">
                  <span className="flex items-center gap-1.5 text-muted-foreground">
                    <Users className="h-3 w-3" />
                    Seats: <span className="text-foreground font-medium">{usage?.seats_used}</span> / {usage?.seats_limit}
                  </span>
                  <span className="text-muted-foreground tabular-nums">{seatPercentage}% used</span>
                </div>
                <div className="h-1.5 bg-muted rounded-full">
                  <div
                    className={`h-full rounded-full transition-all ${
                      seatPercentage >= 90
                        ? 'bg-red-500'
                        : seatPercentage >= 70
                        ? 'bg-amber-500'
                        : 'bg-blue-500'
                    }`}
                    style={{ width: `${Math.min(seatPercentage, 100)}%` }}
                  />
                </div>
              </div>

              {usage?.trial_ends_at && (
                <p className="text-[0.7rem] text-amber-600 dark:text-amber-400">
                  Trial ends: {new Date(usage.trial_ends_at).toLocaleDateString()}
                </p>
              )}
              {usage?.subscription_renews_at && !isTrial && (
                <p className="text-[0.7rem] text-muted-foreground">
                  Renews: {new Date(usage.subscription_renews_at).toLocaleDateString()}
                </p>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Available Plans */}
      <div>
        <h2 className="text-sm font-semibold text-foreground mb-3">Available Plans</h2>
        <div className="grid gap-3 md:grid-cols-3">
          {plans.map((plan) => {
            const isCurrent = plan.name.toLowerCase() === currentPlan;
            return (
              <Card
                key={plan.name}
                className={`transition-all ${
                  isCurrent ? 'border-blue-500/50 ring-1 ring-blue-500/20' : ''
                }`}
              >
                <CardContent className="p-4">
                  <div className="mb-3">
                    <div className="flex items-center justify-between mb-1">
                      <h3 className="text-xs font-semibold text-foreground">{plan.name}</h3>
                      {isCurrent && (
                        <span className="inline-flex items-center gap-1 text-[0.6rem] font-medium text-blue-600 dark:text-blue-400">
                          <span className="inline-block w-1.5 h-1.5 rounded-full bg-blue-500" />
                          Current
                        </span>
                      )}
                    </div>
                    <p className="text-lg font-bold text-foreground">{plan.price}</p>
                    <p className="text-[0.65rem] text-muted-foreground">{plan.seats}</p>
                  </div>
                  <ul className="space-y-1.5 mb-4">
                    {plan.features.map((feature) => (
                      <li key={feature} className="flex items-center gap-1.5 text-[0.7rem] text-foreground">
                        <CheckCircle className="h-3 w-3 text-emerald-500 shrink-0" />
                        {feature}
                      </li>
                    ))}
                  </ul>
                  <div className="border-t border-border/40 pt-3">
                    {isCurrent ? (
                      <Button variant="outline" className="w-full h-8 text-xs" disabled>
                        Current Plan
                      </Button>
                    ) : (
                      <Button
                        className="w-full h-8 text-xs"
                        variant={plan.name === 'Pro' ? 'default' : 'outline'}
                      >
                        {plan.name === 'Trial' ? 'Downgrade' : 'Upgrade'}
                      </Button>
                    )}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      </div>

      {/* Invoice History */}
      <Card>
        <div className="px-4 pt-3 pb-2">
          <div className="flex items-center gap-2">
            <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-blue-500/10">
              <Receipt className="h-3.5 w-3.5 text-blue-500" />
            </div>
            <div>
              <h3 className="text-sm font-semibold">Invoice History</h3>
              <p className="text-[0.65rem] text-muted-foreground">Your billing history and receipts</p>
            </div>
          </div>
        </div>
        <CardContent className="p-0">
          {!invoices || invoices.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-10 gap-2">
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-muted">
                <CreditCard className="h-5 w-5 text-muted-foreground" />
              </div>
              <p className="text-xs text-muted-foreground">No invoices yet</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-border/50">
                    <th className="text-[0.6rem] uppercase tracking-wider font-medium text-muted-foreground px-4 py-2.5 text-left">Date</th>
                    <th className="text-[0.6rem] uppercase tracking-wider font-medium text-muted-foreground px-4 py-2.5 text-left">Amount</th>
                    <th className="text-[0.6rem] uppercase tracking-wider font-medium text-muted-foreground px-4 py-2.5 text-left">Status</th>
                    <th className="text-[0.6rem] uppercase tracking-wider font-medium text-muted-foreground px-4 py-2.5 text-right">Download</th>
                  </tr>
                </thead>
                <tbody>
                  {invoices.map((inv) => (
                    <tr key={inv.id} className="border-b border-border/30 last:border-0 hover:bg-muted/30 transition-colors">
                      <td className="px-4 py-2.5 text-[0.75rem] text-foreground">
                        {new Date(inv.date).toLocaleDateString()}
                      </td>
                      <td className="px-4 py-2.5 text-[0.75rem] font-medium text-foreground tabular-nums">
                        ${(inv.amount / 100).toFixed(2)}
                      </td>
                      <td className="px-4 py-2.5">
                        {inv.status === 'paid' ? (
                          <span className="inline-flex items-center gap-1.5 text-[0.7rem] font-medium text-emerald-600 dark:text-emerald-400">
                            <span className="inline-block w-1.5 h-1.5 rounded-full bg-emerald-500" />
                            Paid
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1.5 text-[0.7rem] font-medium text-amber-600 dark:text-amber-400">
                            <span className="inline-block w-1.5 h-1.5 rounded-full bg-amber-500" />
                            {inv.status}
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-2.5 text-right">
                        {inv.pdf_url && (
                          <a
                            href={inv.pdf_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 text-[0.7rem] text-blue-600 dark:text-blue-400 hover:underline"
                          >
                            <Download className="h-3 w-3" />
                            PDF
                          </a>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Cancel Subscription (Danger Zone) */}
      {!isTrial && (
        <Card className="border-red-500/20">
          <div className="px-4 pt-3 pb-2">
            <div className="flex items-center gap-2">
              <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-destructive/10">
                <AlertTriangle className="h-3.5 w-3.5 text-destructive" />
              </div>
              <div>
                <h3 className="text-sm font-semibold text-destructive">Danger Zone</h3>
                <p className="text-[0.65rem] text-muted-foreground">
                  Cancel your subscription. Takes effect at the end of your billing period.
                </p>
              </div>
            </div>
          </div>
          <CardContent className="pt-0">
            <Dialog open={cancelDialogOpen} onOpenChange={setCancelDialogOpen}>
              <DialogTrigger>
                <Button variant="destructive" className="h-8 text-xs">
                  Cancel Subscription
                </Button>
              </DialogTrigger>
              <DialogContent className="sm:max-w-md">
                <DialogHeader>
                  <div className="flex items-center gap-2 mb-1">
                    <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-destructive/10">
                      <AlertTriangle className="h-3.5 w-3.5 text-destructive" />
                    </div>
                    <DialogTitle className="text-base">Cancel Subscription</DialogTitle>
                  </div>
                  <DialogDescription className="text-xs">
                    Are you sure you want to cancel your subscription? Your team will lose access
                    to premium features at the end of the current billing period.
                  </DialogDescription>
                </DialogHeader>
                <DialogFooter>
                  <Button
                    variant="outline"
                    className="h-8 text-xs"
                    onClick={() => setCancelDialogOpen(false)}
                  >
                    Keep Subscription
                  </Button>
                  <Button
                    variant="destructive"
                    className="h-8 text-xs"
                    onClick={handleCancelSubscription}
                  >
                    Yes, Cancel
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
