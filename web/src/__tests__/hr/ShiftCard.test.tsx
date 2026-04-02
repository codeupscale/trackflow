import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi } from 'vitest';
import { ShiftCard } from '@/components/hr/ShiftCard';
import type { Shift } from '@/lib/validations/shift';

function makeShift(overrides: Partial<Shift> = {}): Shift {
  return {
    id: 'shift-1',
    organization_id: 'org-1',
    name: 'Morning Shift',
    start_time: '09:00',
    end_time: '17:00',
    days_of_week: ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'],
    break_minutes: 60,
    grace_period_minutes: 15,
    color: '#3B82F6',
    timezone: 'UTC',
    description: null,
    is_active: true,
    created_at: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

describe('ShiftCard', () => {
  it('renders shift name and time range', () => {
    render(<ShiftCard shift={makeShift()} />);

    expect(screen.getByText('Morning Shift')).toBeInTheDocument();
    expect(screen.getByText(/09:00/)).toBeInTheDocument();
    expect(screen.getByText(/17:00/)).toBeInTheDocument();
  });

  it('shows color indicator dot with the shift color', () => {
    const { container } = render(
      <ShiftCard shift={makeShift({ color: '#EF4444' })} />
    );

    const dot = container.querySelector('[aria-hidden="true"]');
    expect(dot).toBeInTheDocument();
    expect(dot).toHaveStyle({ backgroundColor: '#EF4444' });
  });

  it('shows day pills for each day of the week', () => {
    render(
      <ShiftCard
        shift={makeShift({ days_of_week: ['monday', 'wednesday', 'friday'] })}
      />
    );

    expect(screen.getByText('Mon')).toBeInTheDocument();
    expect(screen.getByText('Wed')).toBeInTheDocument();
    expect(screen.getByText('Fri')).toBeInTheDocument();
    expect(screen.queryByText('Tue')).not.toBeInTheDocument();
    expect(screen.queryByText('Thu')).not.toBeInTheDocument();
  });

  it('shows actions trigger when callbacks are provided', () => {
    const onEdit = vi.fn();
    const onDelete = vi.fn();

    render(
      <ShiftCard shift={makeShift()} onEdit={onEdit} onDelete={onDelete} />
    );

    const trigger = screen.getByLabelText('Actions for Morning Shift');
    expect(trigger).toBeInTheDocument();
  });

  it('does not show actions menu when no callbacks are provided', () => {
    render(<ShiftCard shift={makeShift()} />);

    expect(
      screen.queryByLabelText('Actions for Morning Shift')
    ).not.toBeInTheDocument();
  });

  it('shows break and grace period info when values are greater than zero', () => {
    render(
      <ShiftCard
        shift={makeShift({ break_minutes: 60, grace_period_minutes: 15 })}
      />
    );

    expect(screen.getByText('Break: 60m')).toBeInTheDocument();
    expect(screen.getByText('Grace: 15m')).toBeInTheDocument();
  });

  it('shows description when provided', () => {
    render(
      <ShiftCard shift={makeShift({ description: 'Standard workday shift' })} />
    );

    expect(screen.getByText('Standard workday shift')).toBeInTheDocument();
  });

  it('renders Active badge for active shifts', () => {
    render(<ShiftCard shift={makeShift({ is_active: true })} />);
    expect(screen.getByText('Active')).toBeInTheDocument();
  });

  it('renders Inactive badge for inactive shifts', () => {
    render(<ShiftCard shift={makeShift({ is_active: false })} />);
    expect(screen.getByText('Inactive')).toBeInTheDocument();
  });
});
