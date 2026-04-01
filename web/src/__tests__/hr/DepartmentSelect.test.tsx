import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi } from 'vitest';
import { DepartmentSelect } from '@/components/hr/DepartmentSelect';
import type { Department } from '@/lib/validations/department';

const mockDepartments: Department[] = [
  {
    id: 'dept-1',
    name: 'Engineering',
    code: 'ENG',
    description: null,
    parent_department_id: null,
    manager_id: null,
    is_active: true,
    positions_count: 5,
    created_at: '2024-01-01T00:00:00Z',
    updated_at: '2024-01-01T00:00:00Z',
  },
  {
    id: 'dept-2',
    name: 'Marketing',
    code: 'MKT',
    description: null,
    parent_department_id: null,
    manager_id: null,
    is_active: true,
    positions_count: 3,
    created_at: '2024-01-01T00:00:00Z',
    updated_at: '2024-01-01T00:00:00Z',
  },
  {
    id: 'dept-3',
    name: 'Sales',
    code: 'SLS',
    description: null,
    parent_department_id: null,
    manager_id: null,
    is_active: true,
    positions_count: 4,
    created_at: '2024-01-01T00:00:00Z',
    updated_at: '2024-01-01T00:00:00Z',
  },
];

vi.mock('@/hooks/hr/use-departments', () => ({
  useDepartments: () => ({
    data: { data: mockDepartments, meta: { current_page: 1, last_page: 1, total: 3, from: 1, to: 3 } },
    isLoading: false,
  }),
}));

describe('DepartmentSelect', () => {
  it('renders with placeholder text', () => {
    const onChange = vi.fn();
    render(<DepartmentSelect value={null} onChange={onChange} />);

    expect(screen.getByText('Select department...')).toBeInTheDocument();
  });

  it('renders with custom placeholder text', () => {
    const onChange = vi.fn();
    render(
      <DepartmentSelect value={null} onChange={onChange} placeholder="Choose one..." />
    );

    expect(screen.getByText('Choose one...')).toBeInTheDocument();
  });

  it('shows the selected department name when value is set', () => {
    const onChange = vi.fn();
    render(<DepartmentSelect value="dept-1" onChange={onChange} />);

    expect(screen.getByText('Engineering')).toBeInTheDocument();
  });

  it('shows department options when opened', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<DepartmentSelect value={null} onChange={onChange} />);

    const trigger = screen.getByRole('combobox');
    await user.click(trigger);

    expect(screen.getByText('Engineering')).toBeInTheDocument();
    expect(screen.getByText('Marketing')).toBeInTheDocument();
    expect(screen.getByText('Sales')).toBeInTheDocument();
  });

  it('shows department codes alongside names', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<DepartmentSelect value={null} onChange={onChange} />);

    const trigger = screen.getByRole('combobox');
    await user.click(trigger);

    expect(screen.getByText('ENG')).toBeInTheDocument();
    expect(screen.getByText('MKT')).toBeInTheDocument();
  });

  it('calls onChange when a department is selected', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<DepartmentSelect value={null} onChange={onChange} />);

    const trigger = screen.getByRole('combobox');
    await user.click(trigger);

    const option = screen.getByText('Engineering');
    await user.click(option);

    expect(onChange).toHaveBeenCalledWith('dept-1');
  });

  it('calls onChange with null when clear button is clicked', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<DepartmentSelect value="dept-1" onChange={onChange} />);

    const clearButton = screen.getByLabelText('Clear selection');
    await user.click(clearButton);

    expect(onChange).toHaveBeenCalledWith(null);
  });

  it('has accessible combobox label', () => {
    const onChange = vi.fn();
    render(<DepartmentSelect value={null} onChange={onChange} />);

    expect(screen.getByLabelText('Select department')).toBeInTheDocument();
  });
});
