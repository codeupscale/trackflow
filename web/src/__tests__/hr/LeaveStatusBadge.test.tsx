import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { LeaveStatusBadge } from '@/components/hr/LeaveStatusBadge';

describe('LeaveStatusBadge', () => {
  it('renders "Pending" with amber styling for pending status', () => {
    render(<LeaveStatusBadge status="pending" />);

    const badge = screen.getByText('Pending');
    expect(badge).toBeInTheDocument();
    expect(badge.className).toContain('bg-amber-100');
    expect(badge.className).toContain('text-amber-800');
  });

  it('renders "Approved" with green styling for approved status', () => {
    render(<LeaveStatusBadge status="approved" />);

    const badge = screen.getByText('Approved');
    expect(badge).toBeInTheDocument();
    expect(badge.className).toContain('bg-green-100');
    expect(badge.className).toContain('text-green-800');
  });

  it('renders "Rejected" with red styling for rejected status', () => {
    render(<LeaveStatusBadge status="rejected" />);

    const badge = screen.getByText('Rejected');
    expect(badge).toBeInTheDocument();
    expect(badge.className).toContain('bg-red-100');
    expect(badge.className).toContain('text-red-800');
  });

  it('renders "Cancelled" with gray styling for cancelled status', () => {
    render(<LeaveStatusBadge status="cancelled" />);

    const badge = screen.getByText('Cancelled');
    expect(badge).toBeInTheDocument();
    expect(badge.className).toContain('bg-gray-100');
    expect(badge.className).toContain('text-gray-600');
  });
});
