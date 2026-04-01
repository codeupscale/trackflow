import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { AttendanceStatusBadge } from '@/components/hr/AttendanceStatusBadge';

describe('AttendanceStatusBadge', () => {
  it('renders "Present" with green styling for present status', () => {
    render(<AttendanceStatusBadge status="present" />);

    const badge = screen.getByText('Present');
    expect(badge).toBeInTheDocument();
    expect(badge.className).toContain('bg-green-100');
    expect(badge.className).toContain('text-green-800');
  });

  it('renders "Absent" with red styling for absent status', () => {
    render(<AttendanceStatusBadge status="absent" />);

    const badge = screen.getByText('Absent');
    expect(badge).toBeInTheDocument();
    expect(badge.className).toContain('bg-red-100');
    expect(badge.className).toContain('text-red-800');
  });

  it('renders "Half Day" with amber styling for half_day status', () => {
    render(<AttendanceStatusBadge status="half_day" />);

    const badge = screen.getByText('Half Day');
    expect(badge).toBeInTheDocument();
    expect(badge.className).toContain('bg-amber-100');
    expect(badge.className).toContain('text-amber-800');
  });

  it('renders "On Leave" with blue styling for on_leave status', () => {
    render(<AttendanceStatusBadge status="on_leave" />);

    const badge = screen.getByText('On Leave');
    expect(badge).toBeInTheDocument();
    expect(badge.className).toContain('bg-blue-100');
    expect(badge.className).toContain('text-blue-800');
  });

  it('renders "Holiday" with purple styling for holiday status', () => {
    render(<AttendanceStatusBadge status="holiday" />);

    const badge = screen.getByText('Holiday');
    expect(badge).toBeInTheDocument();
    expect(badge.className).toContain('bg-purple-100');
    expect(badge.className).toContain('text-purple-800');
  });

  it('renders "Weekend" with gray styling for weekend status', () => {
    render(<AttendanceStatusBadge status="weekend" />);

    const badge = screen.getByText('Weekend');
    expect(badge).toBeInTheDocument();
    expect(badge.className).toContain('bg-gray-100');
    expect(badge.className).toContain('text-gray-600');
  });
});
