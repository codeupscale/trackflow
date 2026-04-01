import { z } from 'zod/v4';

// ── Employment enums ──

export const EMPLOYMENT_STATUSES = [
  'active',
  'probation',
  'notice_period',
  'terminated',
  'resigned',
] as const;

export type EmploymentStatus = (typeof EMPLOYMENT_STATUSES)[number];

export const EMPLOYMENT_TYPES = [
  'full_time',
  'part_time',
  'contract',
  'intern',
] as const;

export type EmploymentType = (typeof EMPLOYMENT_TYPES)[number];

export const DOCUMENT_CATEGORIES = [
  'id_proof',
  'address_proof',
  'education',
  'experience',
  'contract',
  'tax',
  'medical',
  'visa',
  'certification',
  'other',
] as const;

export type DocumentCategory = (typeof DOCUMENT_CATEGORIES)[number];

export const GENDERS = [
  'male',
  'female',
  'non_binary',
  'prefer_not_to_say',
] as const;

export const MARITAL_STATUSES = [
  'single',
  'married',
  'divorced',
  'widowed',
  'prefer_not_to_say',
] as const;

export const BLOOD_GROUPS = [
  'A+',
  'A-',
  'B+',
  'B-',
  'AB+',
  'AB-',
  'O+',
  'O-',
] as const;

// ── Interfaces ──

export interface EmployeeListItem {
  id: string;
  user_id: string;
  employee_id: string | null;
  name: string;
  email: string;
  avatar_url: string | null;
  job_title: string | null;
  phone: string | null;
  department: { id: string; name: string; code: string } | null;
  position: { id: string; title: string; level: string } | null;
  reporting_manager: { id: string; name: string } | null;
  employment_status: EmploymentStatus;
  employment_type: EmploymentType;
  date_of_joining: string | null;
  work_location: string | null;
}

export interface EmployeeDetail extends EmployeeListItem {
  date_of_confirmation: string | null;
  date_of_exit: string | null;
  probation_end_date: string | null;
  notice_period_days: number;
  gender: string | null;
  marital_status: string | null;
  nationality: string | null;
  blood_group: string | null;
  emergency_contact_name: string | null;
  emergency_contact_phone: string | null;
  emergency_contact_relation: string | null;
  bank_name: string | null;
  bank_account_number: string | null;
  bank_routing_number: string | null;
  tax_id: string | null;
  current_address: string | null;
  permanent_address: string | null;
  custom_fields: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface EmployeeDocument {
  id: string;
  title: string;
  category: DocumentCategory;
  file_name: string;
  file_size: number;
  mime_type: string;
  expiry_date: string | null;
  is_verified: boolean;
  verified_by: { id: string; name: string } | null;
  verified_at: string | null;
  uploaded_by: { id: string; name: string };
  notes: string | null;
  download_url: string;
  created_at: string;
}

export interface EmployeeNote {
  id: string;
  content: string;
  is_confidential: boolean;
  author: { id: string; name: string };
  created_at: string;
  updated_at: string;
}

// ── Zod Schemas ──

export const employeeProfileSchema = z.object({
  // Employment (admin-only fields)
  employee_id: z.string().max(50).optional().nullable(),
  department_id: z.string().uuid().optional().nullable(),
  position_id: z.string().uuid().optional().nullable(),
  reporting_manager_id: z.string().uuid().optional().nullable(),
  employment_status: z.enum(EMPLOYMENT_STATUSES).optional().nullable(),
  employment_type: z.enum(EMPLOYMENT_TYPES).optional().nullable(),
  date_of_joining: z.string().optional().nullable(),
  date_of_confirmation: z.string().optional().nullable(),
  date_of_exit: z.string().optional().nullable(),
  probation_end_date: z.string().optional().nullable(),
  notice_period_days: z.coerce.number().int().min(0).max(365).optional().nullable(),
  work_location: z.string().max(255).optional().nullable(),

  // Personal
  gender: z.enum(GENDERS).optional().nullable(),
  marital_status: z.enum(MARITAL_STATUSES).optional().nullable(),
  nationality: z.string().max(100).optional().nullable(),
  blood_group: z.enum(BLOOD_GROUPS).optional().nullable(),

  // Emergency contact
  emergency_contact_name: z.string().max(255).optional().nullable(),
  emergency_contact_phone: z.string().max(30).optional().nullable(),
  emergency_contact_relation: z.string().max(50).optional().nullable(),

  // Financial
  bank_name: z.string().max(255).optional().nullable(),
  bank_account_number: z.string().max(100).optional().nullable(),
  bank_routing_number: z.string().max(50).optional().nullable(),
  tax_id: z.string().max(100).optional().nullable(),

  // Address
  current_address: z.string().max(2000).optional().nullable(),
  permanent_address: z.string().max(2000).optional().nullable(),
});

export type EmployeeProfileInput = z.infer<typeof employeeProfileSchema>;

export const employeeDocumentSchema = z.object({
  title: z.string().min(1, 'Title is required').max(255),
  category: z.enum(DOCUMENT_CATEGORIES, {
    error: 'Please select a category',
  }),
  expiry_date: z.string().optional().nullable(),
  notes: z.string().max(2000).optional().nullable(),
});

export type EmployeeDocumentInput = z.infer<typeof employeeDocumentSchema>;

export const employeeNoteSchema = z.object({
  content: z.string().min(1, 'Note content is required').max(10000),
  is_confidential: z.boolean().default(false),
});

export type EmployeeNoteInput = z.infer<typeof employeeNoteSchema>;

// ── Label helpers ──

export const employmentStatusLabels: Record<EmploymentStatus, string> = {
  active: 'Active',
  probation: 'Probation',
  notice_period: 'Notice Period',
  terminated: 'Terminated',
  resigned: 'Resigned',
};

export const employmentTypeLabels: Record<EmploymentType, string> = {
  full_time: 'Full Time',
  part_time: 'Part Time',
  contract: 'Contract',
  intern: 'Intern',
};

export const documentCategoryLabels: Record<DocumentCategory, string> = {
  id_proof: 'ID Proof',
  address_proof: 'Address Proof',
  education: 'Education',
  experience: 'Experience',
  contract: 'Contract',
  tax: 'Tax',
  medical: 'Medical',
  visa: 'Visa',
  certification: 'Certification',
  other: 'Other',
};
