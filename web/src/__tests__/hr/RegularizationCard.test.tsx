import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi } from 'vitest';
import { RegularizationCard } from '@/components/hr/RegularizationCard';
import type { AttendanceRegularization } from '@/lib/validations/attendance';

function makeRegularization(
  overrides: Partial<AttendanceRegularization> = {}
): AttendanceRegularization {
  return {
    id: 'reg-1',
    attendance_record_id: 'att-1',
    user_id: 'u-1',
    user: {
      id: 'u-1',
      name: 'Jane Doe',
      email: 'jane@example.com',
      avatar_url: null,
    },
    attendance_record: {
      id: 'att-1',
      date: '2026-03-28',
      status: 'absent' as const,
    },
    current_status: 'absent',
    requested_status: 'present',
    reason: 'Was working from home',
    status: 'pending',
    review_note: null,
    reviewed_by: null,
    reviewer: null,
    reviewed_at: null,
    created_at: '2026-03-29T10:00:00Z',
    updated_at: '2026-03-29T10:00:00Z',
    ...overrides,
  } as AttendanceRegularization;
}

describe('RegularizationCard', () => {
  it('renders employee name and email', () => {
    render(
      <RegularizationCard
        regularization={makeRegularization()}
        onApprove={vi.fn()}
        onReject={vi.fn()}
      />
    );

    expect(screen.getByText('Jane Doe')).toBeInTheDocument();
    expect(screen.getByText('jane@example.com')).toBeInTheDocument();
  });

  it('renders user avatar initials', () => {
    render(
      <RegularizationCard
        regularization={makeRegularization()}
        onApprove={vi.fn()}
        onReject={vi.fn()}
      />
    );

    expect(screen.getByText('JD')).toBeInTheDocument();
  });

  it('renders the reason', () => {
    render(
      <RegularizationCard
        regularization={makeRegularization({ reason: 'Was working from home' })}
        onApprove={vi.fn()}
        onReject={vi.fn()}
      />
    );

    expect(screen.getByText('Was working from home')).toBeInTheDocument();
  });

  it('shows approve and reject buttons for pending status', () => {
    render(
      <RegularizationCard
        regularization={makeRegularization({ status: 'pending' })}
        onApprove={vi.fn()}
        onReject={vi.fn()}
      />
    );

    expect(screen.getByRole('button', { name: /approve/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^reject$/i })).toBeInTheDocument();
  });

  it('does not show approve/reject buttons for non-pending status', () => {
    render(
      <RegularizationCard
        regularization={makeRegularization({ status: 'approved' })}
        onApprove={vi.fn()}
        onReject={vi.fn()}
      />
    );

    expect(screen.queryByRole('button', { name: /approve/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^reject$/i })).not.toBeInTheDocument();
  });

  it('calls onApprove with regularization id when approve is clicked', async () => {
    const user = userEvent.setup();
    const onApprove = vi.fn();

    render(
      <RegularizationCard
        regularization={makeRegularization({ id: 'reg-42', status: 'pending' })}
        onApprove={onApprove}
        onReject={vi.fn()}
      />
    );

    await user.click(screen.getByRole('button', { name: /approve/i }));
    expect(onApprove).toHaveBeenCalledWith('reg-42');
  });

  it('opens reject dialog when reject button is clicked', async () => {
    const user = userEvent.setup();

    render(
      <RegularizationCard
        regularization={makeRegularization({ status: 'pending' })}
        onApprove={vi.fn()}
        onReject={vi.fn()}
      />
    );

    await user.click(screen.getByRole('button', { name: /^reject$/i }));

    expect(screen.getByText('Reject Regularization')).toBeInTheDocument();
    expect(screen.getByLabelText('Review Note')).toBeInTheDocument();
  });

  it('shows review note when provided on rejected regularization', () => {
    render(
      <RegularizationCard
        regularization={makeRegularization({
          status: 'rejected',
          review_note: 'No supporting evidence',
          reviewer: { id: 'u-admin', name: 'Admin User' },
          reviewed_at: '2026-03-30T10:00:00Z',
        })}
        onApprove={vi.fn()}
        onReject={vi.fn()}
      />
    );

    expect(screen.getByText(/No supporting evidence/)).toBeInTheDocument();
  });

  it('shows reviewer info for approved regularization', () => {
    render(
      <RegularizationCard
        regularization={makeRegularization({
          status: 'approved',
          reviewer: { id: 'u-admin', name: 'Admin User' },
          reviewed_at: '2026-03-30T10:00:00Z',
        })}
        onApprove={vi.fn()}
        onReject={vi.fn()}
      />
    );

    expect(screen.getByText(/Approved/)).toBeInTheDocument();
    expect(screen.getByText(/Admin User/)).toBeInTheDocument();
  });
});
