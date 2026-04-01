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
    expect(screen.getByText('of 20 days')).toBeInTheDocument();
    expect(screen.getByText('5 used')).toBeInTheDocument();
    expect(screen.getByText('15 remaining')).toBeInTheDocument();
  });

  it('shows green color when remaining > 50%', () => {
    // remaining = 20 - 5 = 15, remainingPercent = 75%
    const balance = makeBalance({ total_days: 20, used_days: 5, pending_days: 0 });
    render(<LeaveBalanceCard balance={balance} />);

    const remainingNumber = screen.getByText('15');
    expect(remainingNumber.className).toContain('text-green-');
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

  it('displays pending days when present', () => {
    const balance = makeBalance({ total_days: 20, used_days: 5, pending_days: 3 });
    render(<LeaveBalanceCard balance={balance} />);

    expect(screen.getByText('3 pending')).toBeInTheDocument();
    // remaining = 20 - 5 - 3 = 12
    expect(screen.getByText('12 remaining')).toBeInTheDocument();
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
    expect(screen.getByText('of 0 days')).toBeInTheDocument();
    expect(screen.getByText('0 used')).toBeInTheDocument();
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
