import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi } from 'vitest';
import { EmployeeSelect } from '@/components/hr/EmployeeSelect';
import type { EmployeeListItem } from '@/lib/validations/employee';

/**
 * Regression fixture for the shipped bug: the employee-directory endpoint
 * (`GET /hr/employees`, `EmployeeService::getDirectory`) selects `users.id AS id`
 * and does NOT return a `user_id` field. The old EmployeeSelect read `emp.user_id`
 * (undefined on every row), so:
 *   - selecting a row called `onChange(undefined)` → the report never filtered and
 *     the CSV exports contained every employee,
 *   - once `value` became undefined, `value === emp.user_id` was
 *     `undefined === undefined` for EVERY row → all rows showed as checked.
 *
 * This fixture therefore mirrors the REAL API shape (id/name/email, no user_id) and
 * includes two DISTINCT users who share a display name (two accounts, two emails —
 * exactly the owner's screenshot) so we can prove keying/checking is by unique id.
 */
const mockRows: EmployeeListItem[] = [
  {
    id: 'user-mirza-1',
    employee_id: 'EMP-001',
    name: 'Mirza Blade Test',
    email: 'mirza.blade@yopmail.com',
    role: 'employee',
    avatar_url: null,
    job_title: 'Engineer',
    phone: null,
    department: null,
    position: null,
    reporting_manager: null,
    employment_status: 'active',
    employment_type: 'full_time',
    date_of_joining: null,
    work_location: null,
    shift: null,
  },
  {
    // Same display name, different account/email and — critically — a different id.
    id: 'user-mirza-2',
    employee_id: 'EMP-002',
    name: 'Mirza Blade Test',
    email: 'mirza.blade.alt@yopmail.com',
    role: 'employee',
    avatar_url: null,
    job_title: 'Engineer',
    phone: null,
    department: null,
    position: null,
    reporting_manager: null,
    employment_status: 'active',
    employment_type: 'full_time',
    date_of_joining: null,
    work_location: null,
    shift: null,
  },
];

vi.mock('@/hooks/hr/use-employees', () => ({
  useEmployees: () => ({
    data: {
      data: mockRows,
      meta: { current_page: 1, last_page: 1, per_page: 20, total: 2, from: 1, to: 2 },
    },
    isLoading: false,
  }),
}));

describe('EmployeeSelect', () => {
  it('emits the real user id (row.id) — not undefined — when a row is selected', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<EmployeeSelect value={null} onChange={onChange} />);

    await user.click(screen.getByRole('combobox'));
    // Disambiguate the two same-name rows by their unique email.
    await user.click(screen.getByText('mirza.blade.alt@yopmail.com'));

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith('user-mirza-2');
    // The exact regression: the old code passed `undefined` here.
    expect(onChange).not.toHaveBeenCalledWith(undefined);
    expect(onChange).not.toHaveBeenCalledWith(null);
  });

  it('marks EXACTLY ONE row as checked for the selected id', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<EmployeeSelect value="user-mirza-1" onChange={onChange} />);

    await user.click(screen.getByRole('combobox'));

    // The Command list portals to document.body, so query the whole document. The old
    // bug marked BOTH rows checked (undefined === undefined); the fix marks exactly one.
    const checked = document.querySelectorAll('[data-checked="true"]');
    expect(checked).toHaveLength(1);
  });

  it('resolves the selected label from the real id', () => {
    render(<EmployeeSelect value="user-mirza-2" onChange={vi.fn()} />);
    // The trigger shows the picked employee's name (not the "All employees" placeholder).
    expect(screen.getByRole('combobox')).toHaveTextContent('Mirza Blade Test');
  });

  it('renders both distinct same-name accounts as separate options', async () => {
    const user = userEvent.setup();
    render(<EmployeeSelect value={null} onChange={vi.fn()} />);

    await user.click(screen.getByRole('combobox'));

    expect(screen.getByText('mirza.blade@yopmail.com')).toBeInTheDocument();
    expect(screen.getByText('mirza.blade.alt@yopmail.com')).toBeInTheDocument();
  });
});
