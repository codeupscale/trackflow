'use client';

import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Loader2 } from 'lucide-react';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Form,
  FormField,
  FormItem,
  FormLabel,
  FormControl,
  FormMessage,
} from '@/components/ui/form';
import { Separator } from '@/components/ui/separator';
import { DepartmentSelect } from '@/components/hr/DepartmentSelect';
import { PositionSelect } from '@/components/hr/PositionSelect';
import { useUpdateEmployeeProfile } from '@/hooks/hr/use-employees';
import { useAuthStore } from '@/stores/auth-store';
import {
  employeeProfileSchema,
  type EmployeeProfileInput,
  type EmployeeDetail,
  EMPLOYMENT_STATUSES,
  EMPLOYMENT_TYPES,
  GENDERS,
  MARITAL_STATUSES,
  BLOOD_GROUPS,
  employmentStatusLabels,
  employmentTypeLabels,
} from '@/lib/validations/employee';

const genderLabels: Record<string, string> = {
  male: 'Male',
  female: 'Female',
  non_binary: 'Non-binary',
  prefer_not_to_say: 'Prefer not to say',
};

const maritalStatusLabels: Record<string, string> = {
  single: 'Single',
  married: 'Married',
  divorced: 'Divorced',
  widowed: 'Widowed',
  prefer_not_to_say: 'Prefer not to say',
};

interface EmployeeProfileSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  employee: EmployeeDetail | null;
}

export function EmployeeProfileSheet({
  open,
  onOpenChange,
  employee,
}: EmployeeProfileSheetProps) {
  const { user } = useAuthStore();
  const isAdmin = user?.role === 'owner' || user?.role === 'admin';
  const updateMutation = useUpdateEmployeeProfile();

  const form = useForm<EmployeeProfileInput>({
    resolver: zodResolver(employeeProfileSchema),
    defaultValues: getDefaults(null),
  });

  useEffect(() => {
    if (employee) {
      form.reset(getDefaults(employee));
    } else {
      form.reset(getDefaults(null));
    }
  }, [employee, form]);

  const onSubmit = (data: EmployeeProfileInput) => {
    if (!employee) return;

    // If not admin, strip admin-only fields
    const payload = isAdmin
      ? data
      : {
          gender: data.gender,
          marital_status: data.marital_status,
          nationality: data.nationality,
          blood_group: data.blood_group,
          emergency_contact_name: data.emergency_contact_name,
          emergency_contact_phone: data.emergency_contact_phone,
          emergency_contact_relation: data.emergency_contact_relation,
          bank_name: data.bank_name,
          bank_account_number: data.bank_account_number,
          bank_routing_number: data.bank_routing_number,
          tax_id: data.tax_id,
          current_address: data.current_address,
          permanent_address: data.permanent_address,
        };

    updateMutation.mutate(
      { id: employee.id, data: payload },
      { onSuccess: () => onOpenChange(false) }
    );
  };

  const watchDepartmentId = form.watch('department_id');

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="sm:max-w-xl overflow-y-auto">
        <SheetHeader>
          <SheetTitle>Edit Profile</SheetTitle>
          <SheetDescription>
            Update {employee?.name ? `${employee.name}'s` : 'employee'} profile
            information.
          </SheetDescription>
        </SheetHeader>

        <Form {...form}>
          <form
            onSubmit={form.handleSubmit(onSubmit)}
            className="flex flex-col flex-1 gap-6 p-6"
          >
            {/* Employment Section (admin only) */}
            {isAdmin && (
              <>
                <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">
                  Employment
                </h3>

                <FormField
                  control={form.control}
                  name="employee_id"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Employee ID</FormLabel>
                      <FormControl>
                        <Input
                          placeholder="e.g. EMP-001"
                          value={field.value ?? ''}
                          onChange={(e) =>
                            field.onChange(e.target.value || null)
                          }
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="department_id"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Department</FormLabel>
                      <FormControl>
                        <DepartmentSelect
                          value={field.value}
                          onChange={field.onChange}
                          placeholder="Select department"
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="position_id"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Position</FormLabel>
                      <FormControl>
                        <PositionSelect
                          value={field.value}
                          onChange={field.onChange}
                          departmentId={watchDepartmentId ?? undefined}
                          placeholder="Select position"
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <div className="grid grid-cols-2 gap-4">
                  <FormField
                    control={form.control}
                    name="employment_status"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Status</FormLabel>
                        <Select
                          value={field.value ?? ''}
                          onValueChange={field.onChange}
                        >
                          <FormControl>
                            <SelectTrigger>
                              <SelectValue placeholder="Select status" />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            <SelectGroup>
                              {EMPLOYMENT_STATUSES.map((s) => (
                                <SelectItem key={s} value={s}>
                                  {employmentStatusLabels[s]}
                                </SelectItem>
                              ))}
                            </SelectGroup>
                          </SelectContent>
                        </Select>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="employment_type"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Type</FormLabel>
                        <Select
                          value={field.value ?? ''}
                          onValueChange={field.onChange}
                        >
                          <FormControl>
                            <SelectTrigger>
                              <SelectValue placeholder="Select type" />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            <SelectGroup>
                              {EMPLOYMENT_TYPES.map((t) => (
                                <SelectItem key={t} value={t}>
                                  {employmentTypeLabels[t]}
                                </SelectItem>
                              ))}
                            </SelectGroup>
                          </SelectContent>
                        </Select>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <FormField
                    control={form.control}
                    name="date_of_joining"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Date of Joining</FormLabel>
                        <FormControl>
                          <Input
                            type="date"
                            value={field.value ?? ''}
                            onChange={(e) =>
                              field.onChange(e.target.value || null)
                            }
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="date_of_confirmation"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Confirmation Date</FormLabel>
                        <FormControl>
                          <Input
                            type="date"
                            value={field.value ?? ''}
                            onChange={(e) =>
                              field.onChange(e.target.value || null)
                            }
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <FormField
                    control={form.control}
                    name="probation_end_date"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Probation End</FormLabel>
                        <FormControl>
                          <Input
                            type="date"
                            value={field.value ?? ''}
                            onChange={(e) =>
                              field.onChange(e.target.value || null)
                            }
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="notice_period_days"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Notice Period (days)</FormLabel>
                        <FormControl>
                          <Input
                            type="number"
                            min={0}
                            max={365}
                            value={field.value ?? ''}
                            onChange={(e) =>
                              field.onChange(
                                e.target.value ? Number(e.target.value) : null
                              )
                            }
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>

                <FormField
                  control={form.control}
                  name="work_location"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Work Location</FormLabel>
                      <FormControl>
                        <Input
                          placeholder="e.g. Remote, Office - Sydney"
                          value={field.value ?? ''}
                          onChange={(e) =>
                            field.onChange(e.target.value || null)
                          }
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <Separator />
              </>
            )}

            {/* Personal Info */}
            <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">
              Personal Information
            </h3>

            <div className="grid grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name="gender"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Gender</FormLabel>
                    <Select
                      value={field.value ?? ''}
                      onValueChange={(v) => field.onChange(v || null)}
                    >
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="Select" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectGroup>
                          {GENDERS.map((g) => (
                            <SelectItem key={g} value={g}>
                              {genderLabels[g]}
                            </SelectItem>
                          ))}
                        </SelectGroup>
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="marital_status"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Marital Status</FormLabel>
                    <Select
                      value={field.value ?? ''}
                      onValueChange={(v) => field.onChange(v || null)}
                    >
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="Select" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectGroup>
                          {MARITAL_STATUSES.map((m) => (
                            <SelectItem key={m} value={m}>
                              {maritalStatusLabels[m]}
                            </SelectItem>
                          ))}
                        </SelectGroup>
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name="nationality"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Nationality</FormLabel>
                    <FormControl>
                      <Input
                        placeholder="e.g. Australian"
                        value={field.value ?? ''}
                        onChange={(e) =>
                          field.onChange(e.target.value || null)
                        }
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="blood_group"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Blood Group</FormLabel>
                    <Select
                      value={field.value ?? ''}
                      onValueChange={(v) => field.onChange(v || null)}
                    >
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="Select" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectGroup>
                          {BLOOD_GROUPS.map((bg) => (
                            <SelectItem key={bg} value={bg}>
                              {bg}
                            </SelectItem>
                          ))}
                        </SelectGroup>
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <Separator />

            {/* Emergency Contact */}
            <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">
              Emergency Contact
            </h3>

            <FormField
              control={form.control}
              name="emergency_contact_name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Contact Name</FormLabel>
                  <FormControl>
                    <Input
                      placeholder="Full name"
                      value={field.value ?? ''}
                      onChange={(e) =>
                        field.onChange(e.target.value || null)
                      }
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div className="grid grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name="emergency_contact_phone"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Phone</FormLabel>
                    <FormControl>
                      <Input
                        placeholder="+61..."
                        value={field.value ?? ''}
                        onChange={(e) =>
                          field.onChange(e.target.value || null)
                        }
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="emergency_contact_relation"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Relation</FormLabel>
                    <FormControl>
                      <Input
                        placeholder="e.g. Spouse, Parent"
                        value={field.value ?? ''}
                        onChange={(e) =>
                          field.onChange(e.target.value || null)
                        }
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <Separator />

            {/* Financial Info */}
            <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">
              Financial Information
            </h3>

            <FormField
              control={form.control}
              name="bank_name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Bank Name</FormLabel>
                  <FormControl>
                    <Input
                      placeholder="e.g. Commonwealth Bank"
                      value={field.value ?? ''}
                      onChange={(e) =>
                        field.onChange(e.target.value || null)
                      }
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div className="grid grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name="bank_account_number"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Account Number</FormLabel>
                    <FormControl>
                      <Input
                        placeholder={
                          employee?.bank_account_number
                            ? employee.bank_account_number
                            : 'Account number'
                        }
                        value={field.value ?? ''}
                        onChange={(e) =>
                          field.onChange(e.target.value || null)
                        }
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="bank_routing_number"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>BSB / Routing</FormLabel>
                    <FormControl>
                      <Input
                        placeholder={
                          employee?.bank_routing_number
                            ? employee.bank_routing_number
                            : 'Routing number'
                        }
                        value={field.value ?? ''}
                        onChange={(e) =>
                          field.onChange(e.target.value || null)
                        }
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <FormField
              control={form.control}
              name="tax_id"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Tax File Number (TFN)</FormLabel>
                  <FormControl>
                    <Input
                      placeholder={
                        employee?.tax_id ? employee.tax_id : 'Tax ID'
                      }
                      value={field.value ?? ''}
                      onChange={(e) =>
                        field.onChange(e.target.value || null)
                      }
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <Separator />

            {/* Address */}
            <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">
              Address
            </h3>

            <FormField
              control={form.control}
              name="current_address"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Current Address</FormLabel>
                  <FormControl>
                    <Textarea
                      placeholder="Current residential address"
                      rows={2}
                      value={field.value ?? ''}
                      onChange={(e) =>
                        field.onChange(e.target.value || null)
                      }
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="permanent_address"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Permanent Address</FormLabel>
                  <FormControl>
                    <Textarea
                      placeholder="Permanent address"
                      rows={2}
                      value={field.value ?? ''}
                      onChange={(e) =>
                        field.onChange(e.target.value || null)
                      }
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <SheetFooter className="mt-auto gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => onOpenChange(false)}
                disabled={updateMutation.isPending}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={updateMutation.isPending}>
                {updateMutation.isPending && (
                  <Loader2 data-icon="inline-start" className="animate-spin" />
                )}
                Save Changes
              </Button>
            </SheetFooter>
          </form>
        </Form>
      </SheetContent>
    </Sheet>
  );
}

function getDefaults(
  employee: EmployeeDetail | null
): EmployeeProfileInput {
  return {
    employee_id: employee?.employee_id ?? null,
    department_id: employee?.department?.id ?? null,
    position_id: employee?.position?.id ?? null,
    reporting_manager_id: employee?.reporting_manager?.id ?? null,
    employment_status: employee?.employment_status ?? null,
    employment_type: employee?.employment_type ?? null,
    date_of_joining: employee?.date_of_joining ?? null,
    date_of_confirmation: employee?.date_of_confirmation ?? null,
    date_of_exit: employee?.date_of_exit ?? null,
    probation_end_date: employee?.probation_end_date ?? null,
    notice_period_days: employee?.notice_period_days ?? null,
    work_location: employee?.work_location ?? null,
    gender: employee?.gender ?? null,
    marital_status: employee?.marital_status ?? null,
    nationality: employee?.nationality ?? null,
    blood_group: employee?.blood_group ?? null,
    emergency_contact_name: employee?.emergency_contact_name ?? null,
    emergency_contact_phone: employee?.emergency_contact_phone ?? null,
    emergency_contact_relation: employee?.emergency_contact_relation ?? null,
    bank_name: employee?.bank_name ?? null,
    bank_account_number: null, // Always empty — write-only
    bank_routing_number: null,
    tax_id: null,
    current_address: employee?.current_address ?? null,
    permanent_address: employee?.permanent_address ?? null,
  };
}
