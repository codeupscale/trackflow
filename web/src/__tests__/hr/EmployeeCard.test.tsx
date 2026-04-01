import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { EmployeeCard } from '@/components/hr/EmployeeCard';
import type { EmployeeListItem } from '@/lib/validations/employee';

// Mock next/link to render a plain anchor
vi.mock('next/link', () => ({
  default: ({
    children,
    href,
    ...props
  }: {
    children: React.ReactNode;
    href: string;
  }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

const baseEmployee: EmployeeListItem = {
  id: 'profile-1',
  user_id: 'user-1',
  employee_id: 'EMP-001',
  name: 'John Doe',
  email: 'john@example.com',
  avatar_url: null,
  job_title: 'Engineer',
  phone: '+61400000000',
  department: { id: 'dept-1', name: 'Engineering', code: 'ENG' },
  position: { id: 'pos-1', title: 'Senior Engineer', level: 'senior' },
  reporting_manager: { id: 'mgr-1', name: 'Jane Smith' },
  employment_status: 'active',
  employment_type: 'full_time',
  date_of_joining: '2024-01-15',
  work_location: 'Remote',
};

describe('EmployeeCard', () => {
  it('renders employee name, email, department, and position', () => {
    render(<EmployeeCard employee={baseEmployee} />);

    expect(screen.getByText('John Doe')).toBeInTheDocument();
    expect(screen.getByText('john@example.com')).toBeInTheDocument();
    expect(screen.getByText('Engineering')).toBeInTheDocument();
    expect(screen.getByText('Senior Engineer')).toBeInTheDocument();
  });

  it('shows correct status badge for active employee', () => {
    render(<EmployeeCard employee={baseEmployee} />);

    const badge = screen.getByText('Active');
    expect(badge).toBeInTheDocument();
    expect(badge.className).toContain('bg-green-100');
  });

  it('shows initials fallback when no avatar', () => {
    render(<EmployeeCard employee={baseEmployee} />);

    expect(screen.getByText('JD')).toBeInTheDocument();
  });

  it('handles missing department gracefully', () => {
    const emp = { ...baseEmployee, department: null };
    render(<EmployeeCard employee={emp} />);

    expect(screen.getByText('No department')).toBeInTheDocument();
  });

  it('handles missing position gracefully, falls back to job_title', () => {
    const emp = { ...baseEmployee, position: null };
    render(<EmployeeCard employee={emp} />);

    expect(screen.getByText('Engineer')).toBeInTheDocument();
  });

  it('handles both position and job_title missing', () => {
    const emp = { ...baseEmployee, position: null, job_title: null };
    render(<EmployeeCard employee={emp} />);

    expect(screen.getByText('No position')).toBeInTheDocument();
  });

  it('links to the employee detail page', () => {
    render(<EmployeeCard employee={baseEmployee} />);

    const link = screen.getByRole('link');
    expect(link).toHaveAttribute('href', '/hr/employees/profile-1');
  });
});
