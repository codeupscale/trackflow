'use client';

import { useQuery } from '@tanstack/react-query';
import {
  CreditCard,
  CheckCircle,
  ArrowLeft,
  Users,
  Zap,
} from 'lucide-react';
import Link from 'next/link';

import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Separator } from '@/components/ui/separator';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import api from '@/lib/api';
import { useAuthStore } from '@/stores/auth-store';

interface BillingUsage {
  seats_used: number;
  seats_limit: number;
  plan: string;
  trial_ends_at: string | null;
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

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Link href="/settings">
          <Button variant="ghost" size="sm">
            <ArrowLeft className="mr-2 h-4 w-4" />
            Settings
          </Button>
        </Link>
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Billing</h1>
          <p className="text-muted-foreground">Manage your subscription and invoices</p>
        </div>
      </div>

      {/* Current Plan */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Zap className="h-5 w-5" />
                Current Plan
              </CardTitle>
              <CardDescription>Your active subscription</CardDescription>
            </div>
            <Badge variant="default" className="text-sm capitalize">
              {currentPlan}
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {usageLoading ? (
            <div className="space-y-3">
              <div className="h-6 w-48 bg-muted animate-pulse rounded" />
              <div className="h-4 w-full bg-muted animate-pulse rounded" />
            </div>
          ) : (
            <>
              <div className="flex items-center justify-between text-sm">
                <span className="flex items-center gap-2">
                  <Users className="h-4 w-4 text-muted-foreground" />
                  Seats: {usage?.seats_used} / {usage?.seats_limit}
                </span>
                <span className="text-muted-foreground">{seatPercentage}% used</span>
              </div>
              <Progress value={seatPercentage} className="h-2" />
              {usage?.trial_ends_at && (
                <p className="text-sm text-amber-500">
                  Trial ends: {new Date(usage.trial_ends_at).toLocaleDateString()}
                </p>
              )}
            </>
          )}
        </CardContent>
      </Card>

      {/* Plans */}
      <div>
        <h2 className="text-lg font-semibold mb-4">Available Plans</h2>
        <div className="grid gap-4 md:grid-cols-3">
          {plans.map((plan) => {
            const isCurrent = plan.name.toLowerCase() === currentPlan;
            return (
              <Card key={plan.name} className={isCurrent ? 'border-blue-500' : ''}>
                <CardHeader>
                  <CardTitle className="text-lg">{plan.name}</CardTitle>
                  <CardDescription className="text-2xl font-bold text-foreground">
                    {plan.price}
                  </CardDescription>
                  <p className="text-xs text-muted-foreground">{plan.seats}</p>
                </CardHeader>
                <CardContent>
                  <ul className="space-y-2">
                    {plan.features.map((feature) => (
                      <li key={feature} className="flex items-center gap-2 text-sm">
                        <CheckCircle className="h-4 w-4 text-green-500 shrink-0" />
                        {feature}
                      </li>
                    ))}
                  </ul>
                  <Separator className="my-4" />
                  {isCurrent ? (
                    <Button variant="outline" className="w-full" disabled>
                      Current Plan
                    </Button>
                  ) : (
                    <Button variant={plan.name === 'Pro' ? 'default' : 'outline'} className="w-full">
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
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <CreditCard className="h-5 w-5" />
            Invoices
          </CardTitle>
          <CardDescription>Your billing history</CardDescription>
        </CardHeader>
        <CardContent>
          {!invoices || invoices.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <CreditCard className="h-10 w-10 mx-auto mb-3 opacity-50" />
              <p>No invoices yet</p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Amount</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">PDF</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {invoices.map((inv) => (
                  <TableRow key={inv.id}>
                    <TableCell className="text-sm">
                      {new Date(inv.date).toLocaleDateString()}
                    </TableCell>
                    <TableCell className="text-sm font-medium">
                      ${(inv.amount / 100).toFixed(2)}
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant={inv.status === 'paid' ? 'default' : 'secondary'}
                        className="text-xs capitalize"
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
                          className="text-sm text-blue-500 hover:underline"
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
    </div>
  );
}
