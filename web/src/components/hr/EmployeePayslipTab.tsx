'use client';

import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { UseFormReturn } from 'react-hook-form';
import { Banknote, FileText, Loader2, Wallet } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

import api from '@/lib/api';
import { formatDate } from '@/lib/utils';
import { usePayslips } from '@/hooks/hr/use-payslips';
import { useAssignSalary } from '@/hooks/hr/use-salary-roster';
import { useSalaryStructures } from '@/hooks/hr/use-salary-structures';
import { usePermissionStore } from '@/stores/permission-store';
import type { EmployeeProfileInput } from '@/lib/validations/employee';

interface EmployeeLike {
  id: string;
  user_id?: string | null;
  name?: string | null;
  position?: { title?: string | null } | null;
  department?: { name?: string | null } | null;
  employment_type?: string | null;
  date_of_joining?: string | null;
  payment_mode?: string | null;
  bank_name?: string | null;
  bank_account_title?: string | null;
  bank_account_number?: string | null;
  tax_id?: string | null;
}

interface Props {
  employee: EmployeeLike;
  form: UseFormReturn<EmployeeProfileInput>;
  editing: boolean;
}

interface SalaryAssignment {
  effective_from: string;
  effective_to: string | null;
  custom_base_salary: number | null;
  salary_structure?: {
    name: string;
    type: string;
    base_salary: string | number;
    currency?: string | null;
  } | null;
}

function Row({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div className="py-1.5">
      <p className="text-[0.6rem] font-medium uppercase tracking-wider text-muted-foreground">
        {label}
      </p>
      <p className="mt-0.5 text-[0.75rem] text-foreground">{value || '—'}</p>
    </div>
  );
}

function money(value: string | number | null | undefined, currency = '') {
  if (value === null || value === undefined || value === '') return '—';
  return `${currency ? currency + ' ' : ''}${Number(value).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

/** "2 years, 3 months" — the same figure the payslip prints. */
function servicePeriod(joined: string | null | undefined): string {
  if (!joined) return '—';
  const start = new Date(joined);
  if (Number.isNaN(start.getTime())) return '—';

  const now = new Date();
  let months =
    (now.getFullYear() - start.getFullYear()) * 12 + (now.getMonth() - start.getMonth());
  if (now.getDate() < start.getDate()) months -= 1;
  if (months < 0) return '—';

  const years = Math.floor(months / 12);
  const rest = months % 12;
  const parts: string[] = [];
  if (years > 0) parts.push(`${years} year${years === 1 ? '' : 's'}`);
  if (rest > 0 || parts.length === 0) parts.push(`${rest} month${rest === 1 ? '' : 's'}`);

  return parts.join(', ');
}

/**
 * Everything a payslip prints for one employee: the fields it fills from, and
 * the money that fills them.
 *
 * They belong together because they answer one question — "will this person's
 * payslip come out right?" — which previously meant checking the employment
 * tab, the financial block and the payroll screen separately.
 */
export function EmployeePayslipTab({ employee, form, editing }: Props) {
  const employeeId = employee.user_id ?? employee.id;

  const { hasPermission } = usePermissionStore();
  const canAssign = hasPermission('payroll.manage_structures');

  const [gradeId, setGradeId] = useState('');
  const [customAmount, setCustomAmount] = useState('');
  const [effectiveFrom, setEffectiveFrom] = useState(() =>
    new Date().toISOString().slice(0, 10),
  );

  const assignSalary = useAssignSalary();
  // Read live rather than passed in: editing a structure's amount should be
  // reflected here the next time this is opened, without anything to sync.
  const { data: structuresData } = useSalaryStructures({ is_active: true, per_page: 100 });
  const structures = useMemo(() => structuresData?.data ?? [], [structuresData]);

  const gradeItems = useMemo(
    () =>
      structures.map((s) => ({
        value: s.id,
        label: `${s.name} — ${money(s.base_salary, s.currency ?? '')}`,
      })),
    [structures],
  );

  const { data: salary, isLoading: salaryLoading } = useQuery<{ data: SalaryAssignment | null }>({
    queryKey: ['employee-salary', employeeId],
    queryFn: async () => {
      const res = await api.get(`/hr/employees/${employeeId}/salary`);
      return res.data;
    },
    // A missing assignment is a 404 by design, not an error worth retrying.
    retry: false,
  });

  const { data: payslipData, isLoading: payslipsLoading } = usePayslips({
    user_id: employeeId,
    per_page: 1,
  });

  const assignment = salary?.data ?? null;
  const structure = assignment?.salary_structure ?? null;
  const currency = structure?.currency ?? '';
  const latest = payslipData?.data?.[0];
  const lineItems = latest?.line_items ?? [];
  const earnings = lineItems.filter((i) => i.type === 'earning');
  const deductions = lineItems.filter((i) => i.type === 'deduction');

  return (
    <div className="space-y-5">
      {/* ── Payslip information ── */}
      <div>
        <div className="mb-3 flex items-center gap-2">
          <FileText className="h-4 w-4 text-blue-500" />
          <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Payslip Information
          </h3>
        </div>

        {editing ? (
          <div className="grid grid-cols-2 gap-x-4 gap-y-3">
            {(
              [
                ['payment_mode', 'Mode of Payment', 'e.g. Bank Transfer'],
                ['bank_name', 'Bank Name', 'e.g. Meezan Bank'],
                ['bank_account_title', 'Account Title', employee.name ?? 'Name on the account'],
                ['bank_account_number', 'Account / IBAN', 'PK36…'],
                ['tax_id', 'CNIC / Tax ID', '35202-1234567-8'],
              ] as const
            ).map(([name, label, placeholder]) => (
              <FormField
                key={name}
                control={form.control}
                name={name}
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-xs">{label}</FormLabel>
                    <FormControl>
                      <Input
                        placeholder={placeholder}
                        value={(field.value as string | null) ?? ''}
                        onChange={(e) => field.onChange(e.target.value || null)}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            ))}
            <p className="col-span-2 text-[0.62rem] text-muted-foreground">
              Designation, Department, Employee Type and Joining Date are edited on the Employee
              Info tab — they print on the payslip from there.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-x-6 gap-y-0.5 sm:grid-cols-3">
            <Row label="Employee Name" value={employee.name} />
            <Row label="Designation" value={employee.position?.title} />
            <Row label="Department" value={employee.department?.name} />
            <Row label="Employee Type" value={employee.employment_type?.replace(/_/g, ' ')} />
            <Row label="CNIC / Tax ID" value={employee.tax_id} />
            <Row label="Joining Date" value={formatDate(employee.date_of_joining)} />
            <Row label="Service Period" value={servicePeriod(employee.date_of_joining)} />
            <Row label="Mode of Payment" value={employee.payment_mode} />
            <Row label="Bank Name" value={employee.bank_name} />
            <Row label="Account Title" value={employee.bank_account_title || employee.name} />
            <Row label="Account / IBAN" value={employee.bank_account_number} />
          </div>
        )}
      </div>

      <Separator />

      {/* ── Salary breakdown ── */}
      <div>
        <div className="mb-3 flex items-center gap-2">
          <Wallet className="h-4 w-4 text-emerald-500" />
          <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Salary Breakdown
          </h3>
        </div>

        {salaryLoading ? (
          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
        ) : (
          <div className="space-y-3">
            {assignment ? (
              <div className="grid grid-cols-2 gap-x-6 gap-y-0.5 sm:grid-cols-3">
                <Row label="Salary Grade" value={structure?.name} />
                <Row label="Type" value={structure?.type} />
                <Row
                  label="Base Salary"
                  value={money(assignment.custom_base_salary ?? structure?.base_salary, currency)}
                />
                <Row label="Effective From" value={formatDate(assignment.effective_from)} />
                {assignment.custom_base_salary !== null && (
                  <Row label="Custom Amount" value="Overrides the grade" />
                )}
              </div>
            ) : (
              <p className="text-[0.72rem] text-amber-600 dark:text-amber-400">
                No salary assigned — payroll cannot run until this employee has one.
              </p>
            )}

            {/* Assigning happens HERE, next to the record it belongs to,
                rather than only on the payroll screen. The grade list is read
                live, so a change to a structure's amount shows up the next
                time this is opened. */}
            {canAssign && (
              <div className="flex flex-wrap items-end gap-2 rounded-md border border-border/60 bg-muted/20 p-2.5">
                <div className="min-w-[190px] flex-1">
                  <Label className="text-[0.6rem] uppercase tracking-wider text-muted-foreground">
                    {assignment ? 'Change grade' : 'Salary grade'}
                  </Label>
                  {/* `items` is what maps the stored value back to a label —
                      without it Base UI's Select renders the raw uuid. */}
                  <Select
                    items={gradeItems}
                    value={gradeId}
                    onValueChange={(v) => setGradeId(v ?? '')}
                    disabled={structures.length === 0}
                  >
                    <SelectTrigger className="mt-1 h-8 text-xs">
                      <SelectValue placeholder="Choose a grade" />
                    </SelectTrigger>
                    <SelectContent>
                      {structures.map((s) => (
                        <SelectItem key={s.id} value={s.id} className="text-xs">
                          {s.name} — {money(s.base_salary, s.currency ?? '')}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="w-[130px]">
                  <Label className="text-[0.6rem] uppercase tracking-wider text-muted-foreground">
                    Amount
                  </Label>
                  <Input
                    type="number"
                    min={0}
                    placeholder={
                      structures.find((s) => s.id === gradeId)?.base_salary
                        ? String(structures.find((s) => s.id === gradeId)?.base_salary)
                        : 'Grade amount'
                    }
                    value={customAmount}
                    onChange={(e) => setCustomAmount(e.target.value)}
                    className="mt-1 h-8 text-xs tabular-nums"
                  />
                </div>

                <div className="w-[140px]">
                  <Label className="text-[0.6rem] uppercase tracking-wider text-muted-foreground">
                    Effective from
                  </Label>
                  <Input
                    type="date"
                    value={effectiveFrom}
                    onChange={(e) => setEffectiveFrom(e.target.value)}
                    className="mt-1 h-8 text-xs"
                  />
                </div>

                <Button
                  size="sm"
                  className="h-8 text-xs"
                  disabled={!gradeId || assignSalary.isPending}
                  onClick={() =>
                    assignSalary
                      .mutateAsync({
                        employeeId,
                        salary_structure_id: gradeId,
                        custom_base_salary:
                          customAmount.trim() === '' ? null : Number(customAmount),
                        effective_from: effectiveFrom,
                      })
                      .then(() => setCustomAmount(''))
                      .catch(() => {})
                  }
                >
                  {assignSalary.isPending ? (
                    <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Wallet className="mr-1.5 h-3.5 w-3.5" />
                  )}
                  {assignment ? 'Update' : 'Assign'}
                </Button>

                {structures.length === 0 && (
                  <p className="w-full text-[0.65rem] text-amber-600 dark:text-amber-400">
                    No salary grades exist yet — create one under Payroll → Salary Structures.
                  </p>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── Latest payslip ── */}
      <div>
        <div className="mb-3 flex items-center gap-2">
          <Banknote className="h-4 w-4 text-amber-500" />
          <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Latest Payslip
            {latest?.payroll_period?.name ? ` — ${latest.payroll_period.name}` : ''}
          </h3>
        </div>

        {payslipsLoading ? (
          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
        ) : !latest ? (
          <p className="text-[0.72rem] text-muted-foreground">
            No payslip yet. One appears here after payroll runs for a period.
          </p>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <p className="mb-1 text-[0.6rem] font-medium uppercase tracking-wider text-muted-foreground">
                Earnings
              </p>
              {earnings.length === 0 ? (
                <p className="text-[0.7rem] text-muted-foreground">—</p>
              ) : (
                earnings.map((item) => (
                  <div key={item.id} className="flex justify-between py-0.5 text-[0.72rem]">
                    <span>{item.label}</span>
                    <span className="tabular-nums">{money(item.amount)}</span>
                  </div>
                ))
              )}
              <div className="mt-1 flex justify-between border-t border-border/60 pt-1 text-[0.72rem] font-semibold">
                <span>Total Earning</span>
                <span className="tabular-nums">{money(latest.gross_salary)}</span>
              </div>
            </div>

            <div>
              <p className="mb-1 text-[0.6rem] font-medium uppercase tracking-wider text-muted-foreground">
                Deductions
              </p>
              {deductions.length === 0 ? (
                <p className="text-[0.7rem] text-muted-foreground">—</p>
              ) : (
                deductions.map((item) => (
                  <div key={item.id} className="flex justify-between py-0.5 text-[0.72rem]">
                    <span>{item.label}</span>
                    <span className="tabular-nums">{money(item.amount)}</span>
                  </div>
                ))
              )}
              <div className="mt-1 flex justify-between border-t border-border/60 pt-1 text-[0.72rem] font-semibold">
                <span>Total Deductions</span>
                <span className="tabular-nums">{money(latest.total_deductions)}</span>
              </div>
            </div>

            <div className="sm:col-span-2 flex items-center justify-between rounded-md bg-muted/40 px-3 py-2">
              <span className="text-[0.7rem] font-semibold uppercase tracking-wider text-muted-foreground">
                Total Payable
              </span>
              <span className="text-sm font-bold tabular-nums">{money(latest.net_salary)}</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
