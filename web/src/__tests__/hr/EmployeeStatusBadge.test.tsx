import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { EmployeeStatusBadge } from '@/components/hr/EmployeeStatusBadge';

describe('EmployeeStatusBadge', () => {
  it('renders "Active" with green styling for active status', () => {
    render(<EmployeeStatusBadge status="active" />);

    const badge = screen.getByText('Active');
    expect(badge).toBeInTheDocument();
    expect(badge.className).toContain('bg-green-100');
    expect(badge.className).toContain('text-green-800');
  });

  it('renders "Probation" with amber styling for probation status', () => {
    render(<EmployeeStatusBadge status="probation" />);

    const badge = screen.getByText('Probation');
    expect(badge).toBeInTheDocument();
    expect(badge.className).toContain('bg-amber-100');
    expect(badge.className).toContain('text-amber-800');
  });

  it('renders "Notice Period" with yellow styling for notice_period status', () => {
    render(<EmployeeStatusBadge status="notice_period" />);

    const badge = screen.getByText('Notice Period');
    expect(badge).toBeInTheDocument();
    expect(badge.className).toContain('bg-yellow-100');
    expect(badge.className).toContain('text-yellow-800');
  });

  it('renders "Terminated" with red styling for terminated status', () => {
    render(<EmployeeStatusBadge status="terminated" />);

    const badge = screen.getByText('Terminated');
    expect(badge).toBeInTheDocument();
    expect(badge.className).toContain('bg-red-100');
    expect(badge.className).toContain('text-red-800');
  });

  it('renders "Resigned" with gray styling for resigned status', () => {
    render(<EmployeeStatusBadge status="resigned" />);

    const badge = screen.getByText('Resigned');
    expect(badge).toBeInTheDocument();
    expect(badge.className).toContain('bg-gray-100');
    expect(badge.className).toContain('text-gray-600');
  });
});
