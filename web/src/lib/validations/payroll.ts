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
  /** The position this grade is a level of. Optional — grades may exist before
   *  positions are configured. */
  position_id: z.string().uuid().optional().nullable(),
  /** Approved band. Warns when breached, never blocks. */
  min_salary: z.coerce.number().min(0).optional().nullable(),
  max_salary: z.coerce.number().min(0).optional().nullable(),
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

/**
 * A salary GRADE: a level within a position ("Engineer L1" under "Software
 * Engineer"), not a separate job. position_id is nullable because grades can
 * exist before positions are configured — the normal state mid-migration.
 */
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
  position_id?: string | null;
  position?: { id: string; title: string } | null;
  /** Approved band. Null means no band — unknown, never a violation. */
  min_salary?: string | null;
  max_salary?: string | null;
  created_at: string;
  updated_at: string;
}

/** Where an amount sits against a grade's band. */
export type BandStatus = 'in_band' | 'below' | 'above' | 'no_band';

export function bandStatus(
  amount: number | null | undefined,
  grade: Pick<SalaryStructure, 'min_salary' | 'max_salary'> | null | undefined,
): BandStatus {
  if (!grade) return 'no_band';
  const min = grade.min_salary != null ? Number(grade.min_salary) : null;
  const max = grade.max_salary != null ? Number(grade.max_salary) : null;
  if (min == null && max == null) return 'no_band';
  if (amount == null || Number.isNaN(amount)) return 'no_band';
  if (min != null && amount < min) return 'below';
  if (max != null && amount > max) return 'above';
  return 'in_band';
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
  /**
   * True when a salary changed after this draft period was run, so the
   * payslips are a stale snapshot until it is run again. Only sent on the
   * period detail endpoint.
   */
  salaries_changed_since_run?: boolean;
  approver?: { id: string; name: string; email: string } | null;
  /** Who RAN this payroll. Only they may run it again. */
  processed_by?: string | null;
  processor?: { id: string; name: string; email: string } | null;
  payslips_count?: number;
  /** How many of them a human has checked. Approval is refused below the total. */
  verified_payslips_count?: number;
  created_at: string;
  updated_at: string;
}

export interface PayslipUser {
  id: string;
  name: string;
  email: string;
  avatar_url: string | null;
}

/**
 * What a line IS. `type` only says which side of the payslip it falls on, so
 * it cannot tell tax from a loan repayment — which is what the payroll listing
 * totals by column.
 */
export type PayslipLineCategory =
  | 'basic'
  | 'allowance'
  | 'bonus'
  | 'overtime'
  | 'tax'
  | 'deduction'
  | 'other';

/** Categories that add to pay; everything else subtracts. */
export const EARNING_CATEGORIES: PayslipLineCategory[] = [
  'basic',
  'allowance',
  'bonus',
  'overtime',
];

export const LINE_CATEGORY_LABELS: Record<PayslipLineCategory, string> = {
  basic: 'Basic Salary',
  allowance: 'Allowance',
  bonus: 'Bonus',
  overtime: 'Overtime',
  tax: 'Tax',
  deduction: 'Deduction',
  other: 'Other',
};

export interface PayslipLineItem {
  id: string;
  pay_component_id: string | null;
  label: string;
  type: 'earning' | 'deduction';
  category: PayslipLineCategory | null;
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
  /**
   * Set once a human has checked this specific payslip. Null means the
   * employee cannot see it — the API hides unverified payslips from the person
   * they belong to.
   */
  verified_at: string | null;
  verified_by: string | null;
  /**
   * Set when a verification was taken back. The verification itself is NOT
   * erased, so the history reads as a sequence: checked by X, withdrawn by Y.
   * A payslip is visible to its employee only while this is null.
   */
  withdrawn_at?: string | null;
  withdrawn_by?: string | null;
  /** Who released it to the employee. */
  verifier?: { id: string; name: string } | null;
  /** Summed server-side per category, for the payroll listing's columns. */
  basic_total?: string | number | null;
  tax_total?: string | number | null;
  bonus_total?: string | number | null;
  payment_date: string | null;
  payment_method: string | null;
  notes: string | null;
  user?: PayslipUser;
  payroll_period?: Pick<PayrollPeriod, 'id' | 'name' | 'start_date' | 'end_date' | 'status'>;
  line_items?: PayslipLineItem[];
  created_at: string;
  updated_at: string;
}

/**
 * Is this payslip visible to the employee it belongs to?
 *
 * Verified AND not since withdrawn — `verified_at` alone is no longer the
 * answer, because a withdrawal now RECORDS itself rather than erasing the
 * verification. Everywhere that used to test `verified_at` must use this, or a
 * withdrawn payslip reads as sent.
 */
export function isReleased(
  payslip: Pick<Payslip, 'verified_at' | 'withdrawn_at'>,
): boolean {
  return Boolean(payslip.verified_at) && !payslip.withdrawn_at;
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

// --- Payslip design ---

/** Layouts shipped with the product, plus the org's own uploaded HTML. */
export type PayslipLayout = 'classic' | 'modern' | 'compact' | 'custom' | 'image';

/**
 * Where one payroll value prints on a company's own payslip artwork.
 * `x`/`y` are PERCENTAGES of the page, so a placement survives the artwork
 * being re-exported at a different resolution.
 */
export interface PayslipFieldPosition {
  /** A catalogue key ("employee.name"), or 'custom' for the org's own text. */
  key: string;
  /** Only used when key is 'custom' — printed verbatim, escaped on render. */
  text?: string;
  x: number;
  y: number;
  size?: number;
  align?: 'left' | 'center' | 'right';
  bold?: boolean;
  color?: string | null;
}

export interface PayslipImageField {
  key: string;
  label: string;
  sample: string;
}

/** Grouped for the placer palette: "Employee", "Pay", "Earnings", … */
export type PayslipImageFieldCatalogue = Record<string, PayslipImageField[]>;

export interface PayslipTemplate {
  id: string;
  organization_id: string;
  layout: PayslipLayout;
  accent_color: string;
  company_name: string | null;
  company_address: string | null;
  company_registration_no: string | null;
  footer_note: string | null;
  /** Stored inline as a data: URI so the PDF renderer never fetches it. */
  logo_data_uri: string | null;
  show_payment_details: boolean;
  show_employer_contributions: boolean;
  show_attendance_summary: boolean;
  show_leave_balance: boolean;
  show_ytd_totals: boolean;
  show_signature_block: boolean;
  /** Kept separate from `layout`, so switching layouts never destroys it. */
  custom_template_html: string | null;
  custom_template_name: string | null;
  custom_template_uploaded_at: string | null;
  /** The company's own payslip artwork, used by the `image` layout. */
  background_image_data_uri: string | null;
  background_image_name: string | null;
  field_positions: PayslipFieldPosition[] | null;
  created_at: string;
  updated_at: string;
}

export type PayslipTemplateFormData = Omit<
  PayslipTemplate,
  'id' | 'organization_id' | 'created_at' | 'updated_at' | 'custom_template_uploaded_at'
>;

/**
 * `values` maps a dot-path placeholder to its sample value; `lists` maps a
 * repeatable block name to the field names available inside it.
 */
export interface PayslipPlaceholderReference {
  values: Record<string, string>;
  lists: Record<string, string[]>;
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
