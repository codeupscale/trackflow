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
} from 'lucide-react';
import Link from 'next/link';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
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
  const [cancelDialogOpen, setCancelDialogOpen] = useState(false);

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
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Link href="/settings">
          <Button variant="ghost" size="sm" className="text-muted-foreground hover:text-foreground">
            <ArrowLeft className="mr-2 h-4 w-4" />
            Settings
          </Button>
        </Link>
        <div>
          <h1 className="text-2xl font-bold text-foreground">Billing</h1>
          <p className="text-muted-foreground text-sm mt-1">Manage your subscription and invoices</p>
        </div>
      </div>

      {/* Current Plan */}
      <Card className="border-border bg-card">
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2 text-foreground">
                <Zap className="h-5 w-5 text-amber-400" />
                Current Plan
              </CardTitle>
              <CardDescription className="text-muted-foreground">Your active subscription</CardDescription>
            </div>
            <Badge
              className={
                isTrial
                  ? 'bg-amber-500/10 text-amber-400 border-amber-500/20'
                  : 'bg-green-500/10 text-green-400 border-green-500/20'
              }
            >
              {isTrial ? 'Trial' : 'Active'}
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {usageLoading ? (
            <div className="space-y-3">
              <div className="h-6 w-48 bg-muted animate-pulse rounded" />
              <div className="h-3 w-full bg-muted animate-pulse rounded" />
            </div>
          ) : (
            <>
              <div className="text-xl font-bold text-foreground capitalize">{currentPlan}</div>

              {/* Seat usage meter */}
              <div className="space-y-2">
                <div className="flex items-center justify-between text-sm">
                  <span className="flex items-center gap-2 text-muted-foreground">
                    <Users className="h-4 w-4" />
                    Seats: <span className="text-foreground font-medium">{usage?.seats_used}</span> / {usage?.seats_limit}
                  </span>
                  <span className="text-muted-foreground">{seatPercentage}% used</span>
                </div>
                <div className="h-2 bg-muted rounded-full">
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
                <p className="text-sm text-amber-400">
                  Trial ends: {new Date(usage.trial_ends_at).toLocaleDateString()}
                </p>
              )}
              {usage?.subscription_renews_at && !isTrial && (
                <p className="text-sm text-muted-foreground">
                  Renews: {new Date(usage.subscription_renews_at).toLocaleDateString()}
                </p>
              )}
            </>
          )}
        </CardContent>
      </Card>

      {/* Plans */}
      <div>
        <h2 className="text-lg font-semibold text-foreground mb-4">Available Plans</h2>
        <div className="grid gap-4 md:grid-cols-3">
          {plans.map((plan) => {
            const isCurrent = plan.name.toLowerCase() === currentPlan;
            return (
              <Card
                key={plan.name}
                className={`border-border bg-card transition-all ${
                  isCurrent ? 'border-blue-500/50 ring-1 ring-blue-500/20' : ''
                }`}
              >
                <CardHeader>
                  <CardTitle className="text-lg text-foreground">{plan.name}</CardTitle>
                  <CardDescription className="text-2xl font-bold text-foreground">
                    {plan.price}
                  </CardDescription>
                  <p className="text-xs text-muted-foreground">{plan.seats}</p>
                </CardHeader>
                <CardContent>
                  <ul className="space-y-2">
                    {plan.features.map((feature) => (
                      <li key={feature} className="flex items-center gap-2 text-sm text-foreground">
                        <CheckCircle className="h-4 w-4 text-green-500 shrink-0" />
                        {feature}
                      </li>
                    ))}
                  </ul>
                  <Separator className="my-4 bg-muted" />
                  {isCurrent ? (
                    <Button variant="outline" className="w-full border-border text-muted-foreground" disabled>
                      Current Plan
                    </Button>
                  ) : (
                    <Button
                      className={`w-full ${
                        plan.name === 'Pro'
                          ? 'bg-blue-600 hover:bg-blue-700 text-foreground'
                          : 'border-border text-foreground'
                      }`}
                      variant={plan.name === 'Pro' ? 'default' : 'outline'}
                    >
                      {plan.name === 'Trial' ? 'Downgrade' : 'Upgrade'}
                    </Button>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      </div>

      {/* Invoices */}
      <Card className="border-border bg-card">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-foreground">
            <CreditCard className="h-5 w-5" />
            Invoice History
          </CardTitle>
          <CardDescription className="text-muted-foreground">Your billing history</CardDescription>
        </CardHeader>
        <CardContent>
          {!invoices || invoices.length === 0 ? (
            <div className="text-center py-8">
              <CreditCard className="h-10 w-10 text-muted-foreground mx-auto mb-3" />
              <p className="text-muted-foreground">No invoices yet</p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow className="border-border hover:bg-transparent">
                  <TableHead className="text-muted-foreground">Date</TableHead>
                  <TableHead className="text-muted-foreground">Amount</TableHead>
                  <TableHead className="text-muted-foreground">Status</TableHead>
                  <TableHead className="text-muted-foreground text-right">Download</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {invoices.map((inv) => (
                  <TableRow key={inv.id} className="border-border">
                    <TableCell className="text-sm text-foreground">
                      {new Date(inv.date).toLocaleDateString()}
                    </TableCell>
                    <TableCell className="text-sm font-medium text-foreground">
                      ${(inv.amount / 100).toFixed(2)}
                    </TableCell>
                    <TableCell>
                      <Badge
                        className={
                          inv.status === 'paid'
                            ? 'bg-green-500/10 text-green-400 border-green-500/20'
                            : 'bg-amber-500/10 text-amber-400 border-amber-500/20'
                        }
                      >
                        {inv.status}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      {inv.pdf_url && (
                        <a
                          href={inv.pdf_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-sm text-blue-400 hover:underline"
                        >
                          Download
                        </a>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Cancel Subscription */}
      {!isTrial && (
        <Card className="border-red-500/20 bg-card">
          <CardHeader>
            <CardTitle className="text-red-400 flex items-center gap-2">
              <AlertTriangle className="h-5 w-5" />
              Danger Zone
            </CardTitle>
            <CardDescription className="text-muted-foreground">
              Cancel your subscription. This will take effect at the end of your current billing period.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Dialog open={cancelDialogOpen} onOpenChange={setCancelDialogOpen}>
              <DialogTrigger>
                <Button variant="destructive">
                  Cancel Subscription
                </Button>
              </DialogTrigger>
              <DialogContent className="bg-card border-border">
                <DialogHeader>
                  <DialogTitle className="text-foreground">Cancel Subscription</DialogTitle>
                  <DialogDescription className="text-muted-foreground">
                    Are you sure you want to cancel your subscription? Your team will lose access
                    to premium features at the end of the current billing period.
                  </DialogDescription>
                </DialogHeader>
                <DialogFooter>
                  <Button
                    variant="outline"
                    onClick={() => setCancelDialogOpen(false)}
                    className="border-border text-foreground"
                  >
                    Keep Subscription
                  </Button>
                  <Button
                    variant="destructive"
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
