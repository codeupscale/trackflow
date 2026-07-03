import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { CheckInStatusBadge } from '@/components/hr/CheckInStatusBadge';

describe('CheckInStatusBadge', () => {
  it('renders the on_time label with green styling', () => {
    render(<CheckInStatusBadge status="on_time" />);
    const badge = screen.getByText('On Time');
    expect(badge).toBeInTheDocument();
    expect(badge.className).toContain('green');
  });

  it('renders the late label with amber styling', () => {
    render(<CheckInStatusBadge status="late" />);
    const badge = screen.getByText('Late');
    expect(badge).toBeInTheDocument();
    expect(badge.className).toContain('amber');
  });

  it('renders early_checkout with orange styling', () => {
    render(<CheckInStatusBadge status="early_checkout" />);
    const badge = screen.getByText('Early Checkout');
    expect(badge.className).toContain('orange');
  });

  it('renders missing_checkout with red styling', () => {
    render(<CheckInStatusBadge status="missing_checkout" />);
    const badge = screen.getByText('Missing Checkout');
    expect(badge.className).toContain('red');
  });

  it('renders on_approved_leave with blue styling', () => {
    render(<CheckInStatusBadge status="on_approved_leave" />);
    const badge = screen.getByText('On Approved Leave');
    expect(badge.className).toContain('blue');
  });

  it('merges a custom className', () => {
    render(<CheckInStatusBadge status="late" className="ml-2" />);
    expect(screen.getByText('Late').className).toContain('ml-2');
  });
});
