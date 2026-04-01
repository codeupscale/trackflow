import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { CheckCircle2, XCircle, Clock } from 'lucide-react';
import { AttendanceSummaryCard } from '@/components/hr/AttendanceSummaryCard';

describe('AttendanceSummaryCard', () => {
  it('renders label and numeric value correctly', () => {
    render(
      <AttendanceSummaryCard
        label="Present Days"
        value={22}
        icon={CheckCircle2}
        variant="green"
      />
    );

    expect(screen.getByText('Present Days')).toBeInTheDocument();
    expect(screen.getByText('22')).toBeInTheDocument();
  });

  it('renders string value correctly', () => {
    render(
      <AttendanceSummaryCard
        label="Overtime Hours"
        value="12.5"
        icon={Clock}
        variant="purple"
      />
    );

    expect(screen.getByText('Overtime Hours')).toBeInTheDocument();
    expect(screen.getByText('12.5')).toBeInTheDocument();
  });

  it('renders subtext when provided', () => {
    render(
      <AttendanceSummaryCard
        label="Present Days"
        value={18}
        subtext="of 22 working days"
        icon={CheckCircle2}
        variant="green"
      />
    );

    expect(screen.getByText('of 22 working days')).toBeInTheDocument();
  });

  it('does not render subtext when not provided', () => {
    render(
      <AttendanceSummaryCard
        label="Absent Days"
        value={3}
        icon={XCircle}
        variant="red"
      />
    );

    expect(screen.getByText('Absent Days')).toBeInTheDocument();
    expect(screen.getByText('3')).toBeInTheDocument();
    // No subtext element expected
    const container = screen.getByText('3').closest('div');
    expect(container?.querySelectorAll('p')).toHaveLength(2); // value + label, no subtext
  });

  it('renders with default variant when none specified', () => {
    render(
      <AttendanceSummaryCard
        label="Test"
        value={0}
        icon={CheckCircle2}
      />
    );

    expect(screen.getByText('Test')).toBeInTheDocument();
    expect(screen.getByText('0')).toBeInTheDocument();
  });
});
