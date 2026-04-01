import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi } from 'vitest';
import { LeaveApprovalCard } from '@/components/hr/LeaveApprovalCard';
import type { LeaveRequest } from '@/lib/validations/leave';

function makeRequest(overrides: Partial<LeaveRequest> = {}): LeaveRequest {
  return {
    id: 'lr-1',
    user_id: 'u-1',
    leave_type_id: 'lt-1',
    start_date: '2026-03-20',
    end_date: '2026-03-22',
    days_count: 3,
    reason: 'Family vacation',
    status: 'pending',
    rejection_reason: null,
    document_path: null,
    user: {
      id: 'u-1',
      name: 'Jane Doe',
      email: 'jane@example.com',
      avatar_url: null,
    },
    leave_type: {
      id: 'lt-1',
      name: 'Annual Leave',
      code: 'AL',
      type: 'paid',
      days_per_year: 20,
      accrual_method: 'annual',
      max_carry_over: 5,
      is_active: true,
      created_at: '2024-01-01T00:00:00Z',
      updated_at: '2024-01-01T00:00:00Z',
    },
    approved_by: null,
    created_at: '2026-03-15T10:00:00Z',
    updated_at: '2026-03-15T10:00:00Z',
    ...overrides,
  };
}

describe('LeaveApprovalCard', () => {
  it('renders employee name and email', () => {
    const request = makeRequest();
    render(
      <LeaveApprovalCard
        request={request}
        onApprove={vi.fn()}
        onReject={vi.fn()}
      />
    );

    expect(screen.getByText('Jane Doe')).toBeInTheDocument();
    expect(screen.getByText('jane@example.com')).toBeInTheDocument();
  });

  it('renders leave type name', () => {
    const request = makeRequest();
    render(
      <LeaveApprovalCard
        request={request}
        onApprove={vi.fn()}
        onReject={vi.fn()}
      />
    );

    expect(screen.getByText('Annual Leave')).toBeInTheDocument();
  });

  it('renders date range using formatted dates', () => {
    const request = makeRequest({
      start_date: '2026-03-20',
      end_date: '2026-03-22',
    });
    render(
      <LeaveApprovalCard
        request={request}
        onApprove={vi.fn()}
        onReject={vi.fn()}
      />
    );

    expect(screen.getByText('Mar 20, 2026')).toBeInTheDocument();
    expect(screen.getByText('Mar 22, 2026')).toBeInTheDocument();
  });

  it('renders number of days', () => {
    const request = makeRequest({ days_count: 3 });
    render(
      <LeaveApprovalCard
        request={request}
        onApprove={vi.fn()}
        onReject={vi.fn()}
      />
    );

    expect(screen.getByText('3')).toBeInTheDocument();
  });

  it('shows half day indicator when applicable', () => {
    const request = makeRequest({ days_count: 0.5 });
    render(
      <LeaveApprovalCard
        request={request}
        onApprove={vi.fn()}
        onReject={vi.fn()}
      />
    );

    expect(screen.getByText('0.5 (half day)')).toBeInTheDocument();
  });

  it('shows approve and reject buttons for pending requests', () => {
    const request = makeRequest({ status: 'pending' });
    render(
      <LeaveApprovalCard
        request={request}
        onApprove={vi.fn()}
        onReject={vi.fn()}
      />
    );

    expect(screen.getByRole('button', { name: /approve/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /reject$/i })).toBeInTheDocument();
  });

  it('does not show approve/reject buttons for non-pending requests', () => {
    const request = makeRequest({ status: 'approved' });
    render(
      <LeaveApprovalCard
        request={request}
        onApprove={vi.fn()}
        onReject={vi.fn()}
      />
    );

    expect(screen.queryByRole('button', { name: /approve/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^reject$/i })).not.toBeInTheDocument();
  });

  it('calls onApprove with request id when approve is clicked', async () => {
    const user = userEvent.setup();
    const onApprove = vi.fn();
    const request = makeRequest({ id: 'lr-42', status: 'pending' });

    render(
      <LeaveApprovalCard
        request={request}
        onApprove={onApprove}
        onReject={vi.fn()}
      />
    );

    await user.click(screen.getByRole('button', { name: /approve/i }));
    expect(onApprove).toHaveBeenCalledWith('lr-42');
  });

  it('opens reject dialog when reject button is clicked', async () => {
    const user = userEvent.setup();
    const request = makeRequest({ status: 'pending' });

    render(
      <LeaveApprovalCard
        request={request}
        onApprove={vi.fn()}
        onReject={vi.fn()}
      />
    );

    await user.click(screen.getByRole('button', { name: /^reject$/i }));

    expect(screen.getByText('Reject Leave Request')).toBeInTheDocument();
    expect(screen.getByLabelText('Rejection Reason')).toBeInTheDocument();
  });

  it('renders the reason when provided', () => {
    const request = makeRequest({ reason: 'Family vacation' });
    render(
      <LeaveApprovalCard
        request={request}
        onApprove={vi.fn()}
        onReject={vi.fn()}
      />
    );

    expect(screen.getByText('Family vacation')).toBeInTheDocument();
  });

  it('renders rejection reason when request has been rejected', () => {
    const request = makeRequest({
      status: 'rejected',
      rejection_reason: 'Insufficient notice period',
    });
    render(
      <LeaveApprovalCard
        request={request}
        onApprove={vi.fn()}
        onReject={vi.fn()}
      />
    );

    expect(screen.getByText(/Insufficient notice period/)).toBeInTheDocument();
  });

  it('renders user avatar initials in fallback', () => {
    const request = makeRequest({
      user: {
        id: 'u-1',
        name: 'Jane Doe',
        email: 'jane@example.com',
        avatar_url: null,
      },
    });
    render(
      <LeaveApprovalCard
        request={request}
        onApprove={vi.fn()}
        onReject={vi.fn()}
      />
    );

    expect(screen.getByText('JD')).toBeInTheDocument();
  });
});
