import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi } from 'vitest';
import { LeaveBalanceCard } from '@/components/hr/LeaveBalanceCard';
import type { LeaveBalance } from '@/lib/validations/leave';

function makeBalance(overrides: Partial<LeaveBalance> = {}): LeaveBalance {
  return {
    leave_type_id: 'lt-1',
    total_days: 20,
    used_days: 5,
    pending_days: 0,
    leave_type: {
      id: 'lt-1',
      name: 'Annual Leave',
      code: 'AL',
      type: 'paid',
    },
    ...overrides,
  };
}

describe('LeaveBalanceCard', () => {
  it('renders leave type name and remaining days', () => {
    const balance = makeBalance({ total_days: 20, used_days: 5, pending_days: 0 });
    render(<LeaveBalanceCard balance={balance} />);

    expect(screen.getByText('Annual Leave')).toBeInTheDocument();
    // remaining = 20 - 5 - 0 = 15
    expect(screen.getByText('15')).toBeInTheDocument();
    expect(screen.getByText('20 days/year')).toBeInTheDocument();
    expect(screen.getByText('5 used')).toBeInTheDocument();
    expect(screen.getByText('15 remaining')).toBeInTheDocument();
  });

  it('keeps the identity colour (no warning) when remaining > 50%', () => {
    // remaining = 20 - 5 = 15, remainingPercent = 75%. The bar/figure carry the
    // leave type's IDENTITY colour now — amber/red are reserved for low balance.
    const balance = makeBalance({ total_days: 20, used_days: 5, pending_days: 0 });
    render(<LeaveBalanceCard balance={balance} />);

    const remainingNumber = screen.getByText('15');
    expect(remainingNumber.className).not.toContain('text-amber-');
    expect(remainingNumber.className).not.toContain('text-red-');
  });

  it('applies the identity colour passed via the color prop', () => {
    const balance = makeBalance({ total_days: 20, used_days: 5, pending_days: 0 });
    render(
      <LeaveBalanceCard
        balance={balance}
        color={{ icon: 'bg-violet-500/10 text-violet-500', bar: 'bg-violet-500', value: 'text-violet-600 dark:text-violet-400' }}
      />
    );

    expect(screen.getByText('15').className).toContain('text-violet-600');
  });

  it('shows amber color when remaining is 25-50%', () => {
    // remaining = 20 - 12 = 8, remainingPercent = 40%
    const balance = makeBalance({ total_days: 20, used_days: 12, pending_days: 0 });
    render(<LeaveBalanceCard balance={balance} />);

    const remainingNumber = screen.getByText('8');
    expect(remainingNumber.className).toContain('text-amber-');
  });

  it('shows red color when remaining < 25%', () => {
    // remaining = 20 - 18 = 2, remainingPercent = 10%
    const balance = makeBalance({ total_days: 20, used_days: 18, pending_days: 0 });
    render(<LeaveBalanceCard balance={balance} />);

    const remainingNumber = screen.getByText('2');
    expect(remainingNumber.className).toContain('text-red-');
  });

  it('deducts pending days from the remaining figure', () => {
    // Pending is not itemised in the footer, but it must reduce remaining:
    // 20 - 5 used - 3 pending = 12.
    const balance = makeBalance({ total_days: 20, used_days: 5, pending_days: 3 });
    render(<LeaveBalanceCard balance={balance} />);

    expect(screen.getByText('12 remaining')).toBeInTheDocument();
    expect(screen.getByLabelText('Annual Leave: 12 days remaining')).toBeInTheDocument();
  });

  it('does not display pending text when pending_days is zero', () => {
    const balance = makeBalance({ pending_days: 0 });
    render(<LeaveBalanceCard balance={balance} />);

    expect(screen.queryByText(/pending/)).not.toBeInTheDocument();
  });

  it('handles zero total balance gracefully', () => {
    const balance = makeBalance({ total_days: 0, used_days: 0, pending_days: 0 });
    render(<LeaveBalanceCard balance={balance} />);

    expect(screen.getByText('0')).toBeInTheDocument();
    expect(screen.getByText('0 days/year')).toBeInTheDocument();
    // used_days of 0 renders no "used" label at all
    expect(screen.queryByText(/used/)).not.toBeInTheDocument();
    expect(screen.getByText('0 remaining')).toBeInTheDocument();
  });

  it('calls onClick when the card is clicked', async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    const balance = makeBalance();

    render(<LeaveBalanceCard balance={balance} onClick={onClick} />);

    const card = screen.getByRole('button');
    await user.click(card);
    expect(onClick).toHaveBeenCalledOnce();
  });

  it('sets aria-label with leave type and remaining days', () => {
    const balance = makeBalance({ total_days: 20, used_days: 5, pending_days: 0 });
    render(<LeaveBalanceCard balance={balance} />);

    expect(screen.getByLabelText('Annual Leave: 15 days remaining')).toBeInTheDocument();
  });
});
