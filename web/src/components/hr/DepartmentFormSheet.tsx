'use client';

import { useEffect, useState, useMemo } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Loader2, ChevronsUpDown, X, Users, Pencil } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import {
  Form,
  FormField,
  FormItem,
  FormLabel,
  FormControl,
  FormMessage,
} from '@/components/ui/form';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import { cn } from '@/lib/utils';
import { DepartmentSelect } from '@/components/hr/DepartmentSelect';
import {
  codeBadgeColor,
  departmentSchema,
  type DepartmentInput,
  type Department,
} from '@/lib/validations/department';
import {
  useCreateDepartment,
  useUpdateDepartment,
} from '@/hooks/hr/use-departments';
import { useEmployees } from '@/hooks/hr/use-employees';
import type { EmployeeListItem } from '@/lib/validations/employee';

const MANAGER_ROLES = ['owner', 'org_manager', 'hr_manager', 'finance_manager', 'admin', 'manager'];

const ROLE_BADGE: Record<string, { label: string; color: string }> = {
  owner: { label: 'Owner', color: 'bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-400' },
  org_manager: { label: 'Admin', color: 'bg-violet-100 text-violet-700 dark:bg-violet-500/20 dark:text-violet-400' },
  hr_manager: { label: 'HR', color: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-400' },
  finance_manager: { label: 'Finance', color: 'bg-blue-100 text-blue-700 dark:bg-blue-500/20 dark:text-blue-400' },
  admin: { label: 'Admin', color: 'bg-violet-100 text-violet-700 dark:bg-violet-500/20 dark:text-violet-400' },
  manager: { label: 'Manager', color: 'bg-cyan-100 text-cyan-700 dark:bg-cyan-500/20 dark:text-cyan-400' },
};

interface DepartmentFormSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  department?: Department | null;
  /**
   * Which mode to open in. A row click passes 'view'; the row menu's Edit item
   * and the New Department button pass 'edit'. Creating always uses 'edit'
   * because there is nothing to view yet.
   */
  initialMode?: DepartmentModalMode;
}

export type DepartmentModalMode = 'view' | 'edit';

export function DepartmentFormSheet({
  open,
  onOpenChange,
  department,
  initialMode = 'edit',
}: DepartmentFormSheetProps) {
  const isEditing = !!department;
  // Creating has no view state, so force edit regardless of what was passed.
  const [mode, setMode] = useState<DepartmentModalMode>(
    isEditing ? initialMode : 'edit'
  );

  const form = useForm<DepartmentInput>({
    resolver: zodResolver(departmentSchema) as any,
    defaultValues: {
      name: '',
      code: '',
      description: '',
      parent_department_id: null,
      manager_id: null,
      is_active: true,
    },
  });

  // Re-sync the mode each time the modal opens, so a row click always lands on
  // the view pane even if the previous session was left in edit.
  useEffect(() => {
    if (!open) return;
    setMode(department ? initialMode : 'edit');
  }, [open, department, initialMode]);

  useEffect(() => {
    if (!open) return;
    if (department) {
      form.reset({
        name: department.name,
        code: department.code,
        description: department.description ?? '',
        parent_department_id: department.parent_department_id ?? null,
        manager_id: department.manager_id ?? null,
        is_active: department.is_active,
      });
    } else {
      form.reset({
        name: '',
        code: '',
        description: '',
        parent_department_id: null,
        manager_id: null,
        is_active: true,
      });
    }
  }, [open, department, form]);

  const createMutation = useCreateDepartment();
  const updateMutation = useUpdateDepartment();
  const isPending = createMutation.isPending || updateMutation.isPending;

  const onSubmit = (data: DepartmentInput) => {
    if (isEditing && department) {
      updateMutation.mutate(
        { id: department.id, ...data },
        // Saving an edit returns to the VIEW pane rather than closing, so the
        // user sees the saved result and dismisses the modal themselves via the
        // cross icon. Closing here would hide the outcome of their own edit.
        { onSuccess: () => setMode('view') }
      );
    } else {
      createMutation.mutate(data, {
        onSuccess: () => onOpenChange(false),
      });
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {mode === 'view'
              ? department?.name
              : isEditing
                ? 'Edit Department'
                : 'New Department'}
          </DialogTitle>
          <DialogDescription>
            {mode === 'view'
              ? 'Department details'
              : isEditing
                ? 'Update the department details below.'
                : 'Create a new department for your organization.'}
          </DialogDescription>
        </DialogHeader>

        {mode === 'view' && department ? (
          <DepartmentView
            department={department}
            onEdit={() => setMode('edit')}
          />
        ) : (
        <Form {...form}>
          <form
            onSubmit={form.handleSubmit(onSubmit)}
            className="flex flex-col gap-4"
          >
            <div className="grid grid-cols-2 gap-3">
              <FormField
                control={form.control}
                name="name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-xs">Name</FormLabel>
                    <FormControl>
                      <Input placeholder="e.g. Engineering" className="h-8 text-sm" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="code"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-xs">Code</FormLabel>
                    <FormControl>
                      <Input placeholder="e.g. ENG" className="h-8 text-sm" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <FormField
              control={form.control}
              name="description"
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="text-xs">Description</FormLabel>
                  <FormControl>
                    <Textarea
                      placeholder="Optional description..."
                      rows={2}
                      className="text-sm resize-none"
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="parent_department_id"
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="text-xs">Parent Department</FormLabel>
                  <FormControl>
                    <DepartmentSelect
                      value={field.value}
                      onChange={field.onChange}
                      placeholder="None (top-level)"
                      excludeId={department?.id}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="manager_id"
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="text-xs">Department Manager</FormLabel>
                  <FormControl>
                    <ManagerSelect
                      value={field.value}
                      onChange={field.onChange}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="is_active"
              render={({ field }) => (
                <FormItem className="flex items-center justify-between rounded-lg border border-border p-3">
                  <div>
                    <FormLabel className="text-xs">Active</FormLabel>
                    <p className="text-[0.65rem] text-muted-foreground">
                      Inactive departments are hidden from selection
                    </p>
                  </div>
                  <FormControl>
                    <Switch
                      checked={field.value}
                      onCheckedChange={field.onChange}
                    />
                  </FormControl>
                </FormItem>
              )}
            />

            <DialogFooter className="gap-2 pt-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                // Cancelling an edit on an existing department returns to the
                // view pane; cancelling a create closes outright.
                onClick={() =>
                  isEditing ? setMode('view') : onOpenChange(false)
                }
                disabled={isPending}
              >
                Cancel
              </Button>
              <Button type="submit" size="sm" disabled={isPending}>
                {isPending && (
                  <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
                )}
                {isEditing ? 'Save Changes' : 'Create Department'}
              </Button>
            </DialogFooter>
          </form>
        </Form>
        )}
      </DialogContent>
    </Dialog>
  );
}

/* ── View pane (read-only detail + Edit button) ── */

function DetailRow({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-3 py-2 border-b border-border/50 last:border-0">
      <span className="text-[0.65rem] uppercase tracking-wider text-muted-foreground shrink-0 pt-0.5">
        {label}
      </span>
      <div className="text-xs text-foreground text-right min-w-0">{children}</div>
    </div>
  );
}

function DepartmentView({
  department,
  onEdit,
}: {
  department: Department;
  onEdit: () => void;
}) {
  const empty = <span className="text-muted-foreground/50">--</span>;

  return (
    <div className="flex flex-col">
      <div className="flex flex-col">
        <DetailRow label="Code">
          {/* Same helper the listing uses, so a code keeps its colour when the
              row is opened. */}
          <span
            className={`inline-flex items-center rounded-md px-1.5 py-0.5 text-[0.6rem] font-semibold font-mono ${codeBadgeColor(department.code)}`}
          >
            {department.code}
          </span>
        </DetailRow>

        <DetailRow label="Employees">
          <span className="inline-flex items-center gap-1.5">
            <Users className="h-3 w-3 text-muted-foreground/60" />
            <span className="tabular-nums font-medium">
              {department.employees_count ?? 0}
            </span>
          </span>
        </DetailRow>

        <DetailRow label="Manager">
          {department.manager ? (
            <div className="flex flex-col items-end">
              <span className="font-medium">{department.manager.name}</span>
              <span className="text-[0.65rem] text-muted-foreground">
                {department.manager.email}
              </span>
            </div>
          ) : (
            empty
          )}
        </DetailRow>

        <DetailRow label="Parent">
          {department.parent?.name ?? empty}
        </DetailRow>

        <DetailRow label="Status">
          {department.is_active ? (
            <span className="inline-flex items-center gap-1 text-[0.65rem] text-emerald-600 dark:text-emerald-400">
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-emerald-500" />
              Active
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 text-[0.65rem] text-amber-600 dark:text-amber-400">
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-amber-500" />
              Archived
            </span>
          )}
        </DetailRow>

        <DetailRow label="Description">
          {department.description ? (
            <span className="whitespace-pre-wrap">{department.description}</span>
          ) : (
            empty
          )}
        </DetailRow>
      </div>

      <DialogFooter className="pt-4">
        <Button type="button" size="sm" onClick={onEdit}>
          <Pencil className="h-3.5 w-3.5 mr-1.5" />
          Edit
        </Button>
      </DialogFooter>
    </div>
  );
}

/* ── Manager Select (management roles only, with role badges) ── */

function ManagerSelect({
  value,
  onChange,
}: {
  value: string | null | undefined;
  onChange: (value: string | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [selected, setSelected] = useState<EmployeeListItem | null>(null);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(t);
  }, [search]);

  const { data, isLoading } = useEmployees({
    search: debouncedSearch || undefined,
    per_page: 50,
    page: 1,
  });

  const managers = useMemo(() => {
    const all = (data?.data ?? []).filter(
      (e, i, arr) => e.id != null && arr.findIndex((o) => o.id === e.id) === i
    );
    return all.filter((e) => MANAGER_ROLES.includes(e.role));
  }, [data]);

  const selectedRow =
    managers.find((e) => e.id === value) ??
    (selected?.id === value ? selected : null);

  const clear = () => {
    onChange(null);
    setSelected(null);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <Button
            variant="outline"
            role="combobox"
            aria-expanded={open}
            aria-label="Select manager"
            className={cn(
              'w-full justify-between font-normal h-8 text-sm',
              !value && 'text-muted-foreground'
            )}
          />
        }
      >
        <span className="truncate flex items-center gap-2">
          {selectedRow ? (
            <>
              {selectedRow.name}
              {ROLE_BADGE[selectedRow.role] && (
                <span className={`inline-flex items-center rounded px-1.5 py-0 text-[0.55rem] font-semibold leading-tight ${ROLE_BADGE[selectedRow.role].color}`}>
                  {ROLE_BADGE[selectedRow.role].label}
                </span>
              )}
            </>
          ) : (
            'Select manager (optional)'
          )}
        </span>
        <div className="flex items-center gap-1 shrink-0">
          {value && (
            <span
              role="button"
              tabIndex={0}
              className="rounded-sm opacity-70 hover:opacity-100"
              onClick={(e) => { e.stopPropagation(); clear(); }}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.stopPropagation(); clear(); } }}
              aria-label="Clear selection"
            >
              <X className="size-3.5" />
            </span>
          )}
          <ChevronsUpDown className="size-3.5 opacity-50" />
        </div>
      </PopoverTrigger>
      <PopoverContent className="w-[var(--anchor-width)] p-0" align="start">
        <Command shouldFilter={false}>
          <CommandInput
            placeholder="Search managers..."
            value={search}
            onValueChange={setSearch}
          />
          <CommandList>
            <CommandEmpty>
              {isLoading ? 'Loading...' : 'No managers found.'}
            </CommandEmpty>
            <CommandGroup>
              {managers.map((emp) => {
                const badge = ROLE_BADGE[emp.role];
                return (
                  <CommandItem
                    key={emp.id}
                    value={emp.id}
                    onSelect={() => {
                      if (emp.id === value) {
                        clear();
                      } else {
                        onChange(emp.id);
                        setSelected(emp);
                      }
                      setOpen(false);
                    }}
                    data-checked={value === emp.id ? 'true' : undefined}
                  >
                    <div className="flex items-center justify-between w-full gap-2">
                      <div className="flex min-w-0 flex-col">
                        <span className="truncate text-sm">{emp.name}</span>
                        <span className="truncate text-xs text-muted-foreground">{emp.email}</span>
                      </div>
                      {badge && (
                        <span className={`inline-flex items-center rounded px-1.5 py-0.5 text-[0.55rem] font-semibold shrink-0 ${badge.color}`}>
                          {badge.label}
                        </span>
                      )}
                    </div>
                  </CommandItem>
                );
              })}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
