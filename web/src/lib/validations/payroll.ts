import { z } from 'zod/v4';

// ─── Form Schemas ──────────────────────────────────────────────────

export const salaryStructureFormSchema = z.object({
  name: z.string().min(1, 'Name is required').max(255),
  description: z.string().optional().nullable(),
  type: z.enum(['monthly', 'hourly', 'daily'], { message: 'Please select a type' }),
  base_salary: z.coerce.number().min(0, 'Must be 0 or more'),
  currency: z.string().length(3).default('AUD'),
  is_active: z.boolean().default(true),
  effective_from: z.string().min(1, 'Effective from is required'),
  effective_to: z.string().optional().nullable(),
});

export const payComponentFormSchema = z.object({
  name: z.string().min(1, 'Name is required').max(255),
  type: z.enum(['allowance', 'deduction', 'bonus', 'tax'], { message: 'Please select a type' }),
  calculation_type: z.enum(['fixed', 'percentage'], { message: 'Please select a calculation type' }),
  value: z.coerce.number().min(0, 'Must be 0 or more'),
  is_taxable: z.boolean().default(false),
  is_mandatory: z.boolean().default(false),
  applies_to: z.enum(['all', 'specific']).default('all'),
});

export const payrollPeriodFormSchema = z.object({
  name: z.string().min(1, 'Name is required').max(255),
  period_type: z.enum(['monthly', 'bi-weekly', 'weekly'], { message: 'Please select a period type' }),
  start_date: z.string().min(1, 'Start date is required'),
  end_date: z.string().min(1, 'End date is required'),
});

export const assignSalaryFormSchema = z.object({
  salary_structure_id: z.string().uuid('Please select a salary structure'),
  custom_base_salary: z.coerce.number().min(0).optional().nullable(),
  effective_from: z.string().min(1, 'Effective from is required'),
  effective_to: z.string().optional().nullable(),
});

export type SalaryStructureFormData = z.infer<typeof salaryStructureFormSchema>;
export type PayComponentFormData = z.infer<typeof payComponentFormSchema>;
export type PayrollPeriodFormData = z.infer<typeof payrollPeriodFormSchema>;
export type AssignSalaryFormData = z.infer<typeof assignSalaryFormSchema>;

// ─── API Response Types ────────────────────────────────────────────

export interface SalaryStructure {
  id: string;
  name: string;
  description: string | null;
  type: 'monthly' | 'hourly' | 'daily';
  base_salary: string;
  currency: string;
  is_active: boolean;
  effective_from: string;
  effective_to: string | null;
  created_at: string;
  updated_at: string;
}

export interface PayComponent {
  id: string;
  name: string;
  type: 'allowance' | 'deduction' | 'bonus' | 'tax';
  calculation_type: 'fixed' | 'percentage';
  value: string;
  is_taxable: boolean;
  is_mandatory: boolean;
  applies_to: 'all' | 'specific';
  created_at: string;
  updated_at: string;
}

export interface PayrollPeriod {
  id: string;
  name: string;
  period_type: 'monthly' | 'bi-weekly' | 'weekly';
  start_date: string;
  end_date: string;
  status: 'draft' | 'processing' | 'approved' | 'paid';
  processed_at: string | null;
  approved_by: string | null;
  approver?: { id: string; name: string; email: string } | null;
  payslips_count?: number;
  created_at: string;
  updated_at: string;
}

export interface PayslipUser {
  id: string;
  name: string;
  email: string;
  avatar_url: string | null;
}

export interface PayslipLineItem {
  id: string;
  pay_component_id: string | null;
  label: string;
  type: 'earning' | 'deduction';
  amount: string;
  is_taxable: boolean;
  sort_order: number;
}

export interface Payslip {
  id: string;
  user_id: string;
  payroll_period_id: string;
  gross_salary: string;
  total_deductions: string;
  total_allowances: string;
  net_salary: string;
  status: 'draft' | 'approved' | 'paid';
  payment_date: string | null;
  payment_method: string | null;
  notes: string | null;
  user?: PayslipUser;
  payroll_period?: Pick<PayrollPeriod, 'id' | 'name' | 'start_date' | 'end_date' | 'status'>;
  line_items?: PayslipLineItem[];
  created_at: string;
  updated_at: string;
}

export interface EmployeeSalaryAssignment {
  id: string;
  user_id: string;
  salary_structure_id: string;
  effective_from: string;
  effective_to: string | null;
  salary_structure?: SalaryStructure;
  created_at: string;
  updated_at: string;
}

export interface PaginatedResponse<T> {
  data: T[];
  meta: {
    current_page: number;
    last_page: number;
    per_page: number;
    total: number;
    from: number | null;
    to: number | null;
  };
}
