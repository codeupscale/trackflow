import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi } from 'vitest';
import { PositionSelect } from '@/components/hr/PositionSelect';

const mockPositions = [
  {
    id: 'pos-1',
    title: 'Senior Engineer',
    code: 'SE-001',
    department_id: 'dept-1',
    department: { id: 'dept-1', name: 'Engineering' },
    level: 'senior',
    employment_type: 'full_time',
    min_salary: null,
    max_salary: null,
    is_active: true,
    created_at: '2024-01-01',
    updated_at: '2024-01-01',
  },
  {
    id: 'pos-2',
    title: 'Marketing Manager',
    code: 'MM-001',
    department_id: 'dept-2',
    department: { id: 'dept-2', name: 'Marketing' },
    level: 'lead',
    employment_type: 'full_time',
    min_salary: null,
    max_salary: null,
    is_active: true,
    created_at: '2024-01-01',
    updated_at: '2024-01-01',
  },
  {
    id: 'pos-3',
    title: 'Junior Developer',
    code: 'JD-001',
    department_id: 'dept-1',
    department: { id: 'dept-1', name: 'Engineering' },
    level: 'junior',
    employment_type: 'full_time',
    min_salary: null,
    max_salary: null,
    is_active: true,
    created_at: '2024-01-01',
    updated_at: '2024-01-01',
  },
];

vi.mock('@/hooks/hr/use-positions', () => ({
  usePositions: () => ({
    data: {
      data: mockPositions,
      meta: { current_page: 1, last_page: 1, total: 3, from: 1, to: 3 },
    },
    isLoading: false,
  }),
}));

describe('PositionSelect', () => {
  it('renders with default placeholder text', () => {
    const onChange = vi.fn();
    render(<PositionSelect value={null} onChange={onChange} />);

    expect(screen.getByText('Select position...')).toBeInTheDocument();
  });

  it('renders with custom placeholder text', () => {
    const onChange = vi.fn();
    render(<PositionSelect value={null} onChange={onChange} placeholder="Pick one..." />);

    expect(screen.getByText('Pick one...')).toBeInTheDocument();
  });

  it('shows the selected position title when value is set', () => {
    const onChange = vi.fn();
    render(<PositionSelect value="pos-1" onChange={onChange} />);

    expect(screen.getByText('Senior Engineer')).toBeInTheDocument();
  });

  it('shows position options when opened', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<PositionSelect value={null} onChange={onChange} />);

    const trigger = screen.getByRole('combobox');
    await user.click(trigger);

    expect(screen.getByText('Senior Engineer')).toBeInTheDocument();
    expect(screen.getByText('Marketing Manager')).toBeInTheDocument();
    expect(screen.getByText('Junior Developer')).toBeInTheDocument();
  });

  it('shows department names alongside position titles', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<PositionSelect value={null} onChange={onChange} />);

    const trigger = screen.getByRole('combobox');
    await user.click(trigger);

    expect(screen.getAllByText('Engineering')).toHaveLength(2); // two engineering positions
    expect(screen.getByText('Marketing')).toBeInTheDocument();
  });

  it('calls onChange when a position is selected', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<PositionSelect value={null} onChange={onChange} />);

    const trigger = screen.getByRole('combobox');
    await user.click(trigger);

    const option = screen.getByText('Senior Engineer');
    await user.click(option);

    expect(onChange).toHaveBeenCalledWith('pos-1');
  });

  it('calls onChange with null when clear button is clicked', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<PositionSelect value="pos-1" onChange={onChange} />);

    const clearButton = screen.getByLabelText('Clear selection');
    await user.click(clearButton);

    expect(onChange).toHaveBeenCalledWith(null);
  });

  it('has accessible combobox label', () => {
    const onChange = vi.fn();
    render(<PositionSelect value={null} onChange={onChange} />);

    expect(screen.getByLabelText('Select position')).toBeInTheDocument();
  });
});
