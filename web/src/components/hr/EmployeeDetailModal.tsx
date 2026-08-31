"use client";

import { useState, useEffect, useMemo } from "react";
import Link from "next/link";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2, Pencil, X, Upload, Plus, Lock, StickyNote, Calendar, Trash2, Phone, MapPin, Briefcase, UserRound, Banknote, Download, FileText, File as FileIcon, Image as ImageIcon, ShieldCheck, CheckCircle2 } from "lucide-react";
import { cn, formatDate } from "@/lib/utils";
import { useAuthStore } from "@/stores/auth-store";
import { usePermissionStore } from "@/stores/permission-store";
import { useEmployee, useUpdateEmployeeProfile } from "@/hooks/hr/use-employees";
import { useEmployeeDocuments, useUploadDocument, useVerifyDocument, useDeleteDocument } from "@/hooks/hr/use-employee-documents";
import { useEmployeeNotes, useCreateNote, useDeleteNote } from "@/hooks/hr/use-employee-notes";
import { useLeaveRequests } from "@/hooks/hr/use-leave-requests";
import { DepartmentSelect } from "@/components/hr/DepartmentSelect";
import { ShiftSelect } from "@/components/hr/ShiftSelect";

import { MANAGER_ROLES, UserCombobox } from "@/components/time-entries/UserCombobox";

import { DocumentUploadCard } from "@/components/hr/DocumentUploadCard";
import { ConfirmDialog } from "@/components/common/ConfirmDialog";
import {
  BLOOD_GROUPS, GENDERS, MARITAL_STATUSES, EMPLOYMENT_STATUSES, EMPLOYMENT_TYPES,
  employmentStatusLabels, employmentTypeLabels, documentCategoryLabels, employeeProfileSchema, employeeNoteSchema,
  type EmployeeDetail, type EmployeeProfileInput,
} from "@/lib/validations/employee";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";

// ── Role display helpers ──

const roleLabels: Record<string, string> = {
  owner: "Owner",
  org_manager: "Org Manager",
  hr_manager: "HR Manager",
  finance_manager: "Finance Manager",
  employee: "Employee",
};

const roleBadgeVariants: Record<string, string> = {
  owner: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400",
  org_manager: "bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400",
  hr_manager: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400",
  finance_manager: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400",
  employee: "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-400",
};

export function RoleBadge({ role }: { role: string }) {
  const label = roleLabels[role] ?? role.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
  const cls = roleBadgeVariants[role] ?? roleBadgeVariants.employee;
  return (
    <span className={cn("inline-flex items-center rounded-full px-2 py-0.5 text-[0.6rem] font-semibold", cls)}>
      {label}
    </span>
  );
}

// ── Helpers ──

function getInitials(name: string): string {
  return name.split(" ").map((n) => n[0]).filter(Boolean).slice(0, 2).join("").toUpperCase();
}

const avatarColors = [
  "from-blue-500 to-blue-600",
  "from-violet-500 to-violet-600",
  "from-emerald-500 to-emerald-600",
  "from-orange-500 to-orange-600",
  "from-rose-500 to-rose-600",
  "from-cyan-500 to-cyan-600",
  "from-amber-500 to-amber-600",
  "from-indigo-500 to-indigo-600",
];

function getAvatarColor(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
  return avatarColors[Math.abs(hash) % avatarColors.length];
}

const statusDotColors: Record<string, string> = {
  active: "bg-emerald-500",
  probation: "bg-amber-500",
  notice_period: "bg-yellow-500",
  terminated: "bg-red-500",
  resigned: "bg-gray-400",
};

const leaveStatusDotColors: Record<string, string> = {
  pending: "bg-amber-500",
  approved: "bg-emerald-500",
  rejected: "bg-red-500",
  cancelled: "bg-gray-400",
};

const leaveStatusLabels: Record<string, string> = {
  pending: "Pending",
  approved: "Approved",
  rejected: "Rejected",
  cancelled: "Cancelled",
};

const genderLabels: Record<string, string> = {
  male: "Male",
  female: "Female",
  non_binary: "Non-binary",
  prefer_not_to_say: "Prefer not to say",
};

const maritalStatusLabels: Record<string, string> = {
  single: "Single",
  married: "Married",
  divorced: "Divorced",
  widowed: "Widowed",
  prefer_not_to_say: "Prefer not to say",
};

function InfoRow({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div className="py-1.5">
      <p className="text-[0.6rem] font-medium text-muted-foreground uppercase tracking-wider">{label}</p>
      <p className="text-[0.75rem] text-foreground mt-0.5">{value || "—"}</p>
    </div>
  );
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDaysCount(days: number): string {
  const n = Number(days);
  if (n === 0.5) return "Half Day";
  const whole = Math.round(n);
  return whole === 1 ? "1 Day" : `${whole} Days`;
}

function toDateInputValue(value: string | null | undefined): string | null {
  if (!value) return null;
  return value.slice(0, 10);
}

function getDefaults(employee: EmployeeDetail | null): EmployeeProfileInput {
  return {
    name: employee?.name ?? '',
    email: employee?.email ?? '',
    employee_id: employee?.employee_id ?? null,
    department_id: employee?.department?.id ?? null,
    position_id: employee?.position?.id ?? null,
    shift_id: employee?.shift?.id ?? null,
    job_title: employee?.job_title ?? employee?.position?.title ?? null,
    reporting_manager_id: employee?.reporting_manager?.id ?? null,
    employment_status: employee?.employment_status ?? null,
    employment_type: employee?.employment_type ?? null,
    date_of_joining: toDateInputValue(employee?.date_of_joining),
    date_of_confirmation: toDateInputValue(employee?.date_of_confirmation),
    date_of_exit: toDateInputValue(employee?.date_of_exit),
    probation_end_date: toDateInputValue(employee?.probation_end_date),
    notice_period_days: employee?.notice_period_days ?? null,
    work_location: employee?.work_location ?? null,
    gender: (employee?.gender ?? null) as EmployeeProfileInput["gender"],
    marital_status: (employee?.marital_status ?? null) as EmployeeProfileInput["marital_status"],
    nationality: employee?.nationality ?? null,
    blood_group: (employee?.blood_group ?? null) as EmployeeProfileInput["blood_group"],
    emergency_contact_name: employee?.emergency_contact_name ?? null,
    emergency_contact_phone: employee?.emergency_contact_phone ?? null,
    emergency_contact_relation: employee?.emergency_contact_relation ?? null,
    bank_name: employee?.bank_name ?? null,
    bank_account_number: null,
    bank_routing_number: null,
    tax_id: null,
    current_address: employee?.current_address ?? null,
    permanent_address: employee?.permanent_address ?? null,
  };
}

// ── Main Component ──

interface EmployeeDetailModalProps {
  employeeId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function EmployeeDetailModal({ employeeId, open, onOpenChange }: EmployeeDetailModalProps) {
  const { user } = useAuthStore();
  const { hasPermission, hasPermissionWithScope } = usePermissionStore();

  const canEditAllFields = hasPermissionWithScope("employees.edit_profile", "organization");
  // Shift assignment is a separate right from profile editing — the field only
  // renders (and shift_id is only sent) for holders, so an org that grants
  // employees.edit_profile without shift rights never trips the backend's 403.
  const canManageShifts = hasPermission("shifts.manage_assignments");
  const canManageDocumentsOrg = hasPermissionWithScope("employees.manage_documents", "organization");
  const canViewFinancial = hasPermission("employees.view_financial");
  const canManageNotes = hasPermission("employees.manage_notes");
  const isManager = hasPermissionWithScope("employees.view_directory", "project") && !canEditAllFields;
  const canManage = canEditAllFields || isManager;

  // ── Data fetching ──
  const { data: employeeData, isLoading, isError } = useEmployee(employeeId ?? undefined);
  const employee = employeeData?.data ?? null;
  const isSelf = employee?.user_id === user?.id;
  const canEdit = canEditAllFields || isSelf;
  const canUploadDoc = hasPermission("employees.manage_documents") || isSelf;
  const canVerifyDoc = canManageDocumentsOrg;
  const canDeleteDoc = canManageDocumentsOrg;

  // ── State ──
  const [editing, setEditing] = useState(false);
  const [activeTab, setActiveTab] = useState("employee");
  const [uploadDialogOpen, setUploadDialogOpen] = useState(false);
  const [deleteDocTarget, setDeleteDocTarget] = useState<string | null>(null);
  const [deleteNoteTarget, setDeleteNoteTarget] = useState<string | null>(null);
  const [noteContent, setNoteContent] = useState("");
  const [noteConfidential, setNoteConfidential] = useState(false);

  // ── Documents ──
  const { data: docsData, isLoading: docsLoading } = useEmployeeDocuments(employeeId ?? undefined);
  const uploadMutation = useUploadDocument(employeeId ?? "");
  const verifyMutation = useVerifyDocument(employeeId ?? "");
  const deleteDocMutation = useDeleteDocument(employeeId ?? "");
  const documents = docsData?.data ?? [];

  // ── Notes ──
  const { data: notesData, isLoading: notesLoading } = useEmployeeNotes(canManage && employeeId ? employeeId : undefined);
  const createNoteMutation = useCreateNote(employeeId ?? "");
  const deleteNoteMutation = useDeleteNote(employeeId ?? "");
  const notes = notesData?.data ?? [];

  // ── Leave History ──
  const { data: leaveData, isLoading: leaveLoading } = useLeaveRequests({ user_id: employee?.user_id });
  const leaveRequests = leaveData?.data ?? [];

  // ── Edit form ──
  const updateMutation = useUpdateEmployeeProfile();
  const form = useForm<EmployeeProfileInput>({
    resolver: zodResolver(employeeProfileSchema) as any,
    defaultValues: getDefaults(null),
  });

  useEffect(() => {
    if (!open) {
      setEditing(false);
      setActiveTab("employee");
      return;
    }
    if (employee) form.reset(getDefaults(employee));
  }, [open, employee, form]);



  const onSubmit = (data: EmployeeProfileInput) => {
    if (!employee) return;
    // Never send shift_id without the assignment right — the backend 403s the
    // whole update, which would block an otherwise-valid profile edit.
    if (!canManageShifts) {
      delete data.shift_id;
    }
    const payload = canEditAllFields
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
      { id: employee.user_id ?? employee.id, data: payload },
      { onSuccess: () => setEditing(false) },
    );
  };

  const handleCreateNote = () => {
    const parsed = employeeNoteSchema.safeParse({ content: noteContent, is_confidential: noteConfidential });
    if (!parsed.success) return;
    createNoteMutation.mutate(parsed.data, {
      onSuccess: () => { setNoteContent(""); setNoteConfidential(false); },
    });
  };

  // ── Render ──
  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-4xl sm:max-w-4xl h-[min(430px,80vh)] flex flex-col p-0 gap-0 overflow-hidden">
          {/* ── Header ── */}
          {isLoading ? (
            <div className="flex items-center gap-3 p-5 pb-3">
              <Skeleton className="h-14 w-14 rounded-full" />
              <div className="space-y-2 flex-1">
                <Skeleton className="h-5 w-40" />
                <Skeleton className="h-3 w-52" />
              </div>
            </div>
          ) : isError || !employee ? (
            <div className="flex flex-col items-center justify-center flex-1 gap-3 p-8">
              <UserRound className="size-10 text-muted-foreground/60" />
              <p className="text-sm font-medium text-muted-foreground">Failed to load employee profile</p>
              <p className="text-xs text-muted-foreground">The employee may not exist or you may not have permission.</p>
            </div>
          ) : (
            <>
              <div className="flex items-start gap-4 px-6 pt-4 pb-3">
                <Avatar className="h-12 w-12 shrink-0 ring-2 ring-border">
                  <AvatarImage src={employee.avatar_url ?? undefined} alt={employee.name} />
                  <AvatarFallback className={`bg-gradient-to-br ${getAvatarColor(employee.name)} text-white text-sm font-semibold`}>{getInitials(employee.name)}</AvatarFallback>
                </Avatar>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h2 className="text-base font-semibold tracking-tight text-foreground">{employee.name}</h2>
                    <RoleBadge role={employee.role ?? "employee"} />
                    <span className="inline-flex items-center gap-1.5">
                      <span className={cn("size-1.5 rounded-full", statusDotColors[employee.employment_status] ?? "bg-gray-400")} />
                      <span className="text-[0.6rem] text-muted-foreground capitalize">
                        {employmentStatusLabels[employee.employment_status] ?? employee.employment_status}
                      </span>
                    </span>
                  </div>
                  <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground">
                    <span>{employee.email}</span>
                    {employee.department && <><span className="text-border">|</span><span>{employee.department.name}</span></>}
                    {employee.employee_id && <><span className="text-border">|</span><span className="tabular-nums">{employee.employee_id}</span></>}
                  </div>
                </div>
              </div>

              {/* ── Tabs ── */}
              <Form {...form}>
                <form onSubmit={form.handleSubmit(onSubmit)} className="flex flex-col flex-1 min-h-0">
                  <div className="flex flex-col flex-1 min-h-0">
                    <div className="px-6 pt-1 border-b border-border">
                      <div className="flex items-center gap-1 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                        {[
                          { key: "employee", label: "Employee Info" },
                          { key: "personal", label: "Personal" },
                          { key: "emergency", label: "Emergency & Address" },
                          { key: "documents", label: "Documents" },
                          { key: "leave", label: "Leave History" },
                          ...(canManageNotes ? [{ key: "notes", label: "Notes" }] : []),
                        ].map((tab) => (
                          <button
                            key={tab.key}
                            type="button"
                            onClick={() => setActiveTab(tab.key)}
                            className={cn(
                              "inline-flex items-center justify-center px-3 py-2 text-xs font-medium whitespace-nowrap transition-all border-b-2 -mb-px",
                              activeTab === tab.key
                                ? "border-primary text-foreground"
                                : "border-transparent text-muted-foreground hover:text-foreground hover:border-muted-foreground/30",
                            )}
                          >
                            {tab.label}
                          </button>
                        ))}
                      </div>
                    </div>

                    <div className="flex-1 overflow-y-auto px-6 py-4 [scrollbar-width:thin] [scrollbar-color:theme(colors.border)_transparent] [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-border">

                      {/* ─── Employee Info Tab ─── */}
                      {activeTab === "employee" && <div className="space-y-4">
                        {editing ? (
                          <div className="space-y-5">
                            <div>
                              <div className="flex items-center gap-2 mb-3">
                                <UserRound className="h-4 w-4 text-blue-500" />
                                <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Basic Information</h3>
                              </div>
                              <div className="grid gap-x-4 gap-y-3 grid-cols-2">
                                <FormField control={form.control} name="name" render={({ field }) => (
                                  <FormItem>
                                    <FormLabel className="text-xs">Name <span className="text-destructive">*</span></FormLabel>
                                    <FormControl><Input placeholder="Full name" value={field.value ?? ""} onChange={(e) => field.onChange(e.target.value)} /></FormControl>
                                    <FormMessage />
                                  </FormItem>
                                )} />
                                <FormField control={form.control} name="email" render={({ field }) => (
                                  <FormItem>
                                    <FormLabel className="text-xs">Email <span className="text-destructive">*</span></FormLabel>
                                    <FormControl><Input type="email" placeholder="Email address" value={field.value ?? ""} onChange={(e) => field.onChange(e.target.value)} /></FormControl>
                                    <FormMessage />
                                  </FormItem>
                                )} />
                              </div>
                            </div>

                            {canEditAllFields && (
                            <>
                            <Separator />
                            <div>
                              <div className="flex items-center gap-2 mb-3">
                                <Briefcase className="h-4 w-4 text-violet-500" />
                                <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Employment Details</h3>
                              </div>
                              <div className="grid gap-x-4 gap-y-3 grid-cols-3">
                                <FormField control={form.control} name="department_id" render={({ field }) => (
                                  <FormItem>
                                    <FormLabel className="text-xs">Department <span className="text-destructive">*</span></FormLabel>
                                    <FormControl>
                                      <DepartmentSelect value={field.value} onChange={field.onChange} placeholder="Select department" />
                                    </FormControl>
                                    <FormMessage />
                                  </FormItem>
                                )} />
                                <FormField control={form.control} name="job_title" render={({ field }) => (
                                  <FormItem>
                                    <FormLabel className="text-xs">Position</FormLabel>
                                    <FormControl>
                                      <Input placeholder="e.g. Software Engineer" className="rounded-xl" value={field.value ?? ''} onChange={(e) => field.onChange(e.target.value || null)} />
                                    </FormControl>
                                    <FormMessage />
                                  </FormItem>
                                )} />
                                {canManageShifts && (
                                  <FormField control={form.control} name="shift_id" render={({ field }) => (
                                    <FormItem>
                                      <FormLabel className="text-xs">Shift</FormLabel>
                                      <FormControl>
                                        <ShiftSelect
                                          value={field.value ?? null}
                                          onChange={field.onChange}
                                          allowNone
                                          onClear={() => field.onChange(null)}
                                          placeholder="No shift"
                                        />
                                      </FormControl>
                                      <FormMessage />
                                    </FormItem>
                                  )} />
                                )}
                                <FormField control={form.control} name="reporting_manager_id" render={({ field }) => (
                                  <FormItem>
                                    <FormLabel className="text-xs">Reporting Manager</FormLabel>
                                    <FormControl>
                                      <UserCombobox value={field.value ?? null} onChange={(v) => field.onChange(v)} placeholder="No manager" enabled={open} roles={MANAGER_ROLES} excludeUserIds={employee?.user_id ? [employee.user_id] : undefined} />
                                    </FormControl>
                                    <FormMessage />
                                  </FormItem>
                                )} />
                                <FormField control={form.control} name="employment_status" render={({ field }) => (
                                  <FormItem>
                                    <FormLabel className="text-xs">Status</FormLabel>
                                    <Select value={field.value ?? ""} onValueChange={field.onChange}>
                                      <FormControl><SelectTrigger className="w-full data-[size=default]:h-10 rounded-xl"><span data-slot="select-value" className="flex flex-1 text-left">{field.value ? employmentStatusLabels[field.value] ?? field.value : <span className="text-muted-foreground">Select status</span>}</span></SelectTrigger></FormControl>
                                      <SelectContent><SelectGroup>
                                        {EMPLOYMENT_STATUSES.map((s) => <SelectItem key={s} value={s}>{employmentStatusLabels[s]}</SelectItem>)}
                                      </SelectGroup></SelectContent>
                                    </Select>
                                    <FormMessage />
                                  </FormItem>
                                )} />
                                <FormField control={form.control} name="employment_type" render={({ field }) => (
                                  <FormItem>
                                    <FormLabel className="text-xs">Type</FormLabel>
                                    <Select value={field.value ?? ""} onValueChange={field.onChange}>
                                      <FormControl><SelectTrigger className="w-full data-[size=default]:h-10 rounded-xl"><span data-slot="select-value" className="flex flex-1 text-left">{field.value ? employmentTypeLabels[field.value] ?? field.value : <span className="text-muted-foreground">Select type</span>}</span></SelectTrigger></FormControl>
                                      <SelectContent><SelectGroup>
                                        {EMPLOYMENT_TYPES.map((t) => <SelectItem key={t} value={t}>{employmentTypeLabels[t]}</SelectItem>)}
                                      </SelectGroup></SelectContent>
                                    </Select>
                                    <FormMessage />
                                  </FormItem>
                                )} />
                                <FormField control={form.control} name="date_of_joining" render={({ field }) => (
                                  <FormItem>
                                    <FormLabel className="text-xs">Date of Joining</FormLabel>
                                    <FormControl><Input type="date" value={field.value ?? ""} onChange={(e) => field.onChange(e.target.value || null)} /></FormControl>
                                    <FormMessage />
                                  </FormItem>
                                )} />
                                <FormField control={form.control} name="probation_end_date" render={({ field }) => (
                                  <FormItem>
                                    <FormLabel className="text-xs">Probation End</FormLabel>
                                    <FormControl><Input type="date" value={field.value ?? ""} onChange={(e) => field.onChange(e.target.value || null)} /></FormControl>
                                    <FormMessage />
                                  </FormItem>
                                )} />
                                <FormField control={form.control} name="notice_period_days" render={({ field }) => (
                                  <FormItem>
                                    <FormLabel className="text-xs">Notice Period (days)</FormLabel>
                                    <FormControl><Input type="number" min={0} max={365} value={field.value ?? ""} onChange={(e) => field.onChange(e.target.value ? Number(e.target.value) : null)} /></FormControl>
                                    <FormMessage />
                                  </FormItem>
                                )} />
                                <FormField control={form.control} name="work_location" render={({ field }) => (
                                  <FormItem>
                                    <FormLabel className="text-xs">Work Location</FormLabel>
                                    <FormControl><Input placeholder="e.g. Remote, Office" value={field.value ?? ""} onChange={(e) => field.onChange(e.target.value || null)} /></FormControl>
                                    <FormMessage />
                                  </FormItem>
                                )} />
                              </div>
                            </div>
                            </>
                            )}

                            {(canViewFinancial || isSelf) && (
                              <>
                                <Separator />
                                <div>
                                  <div className="flex items-center gap-2 mb-3">
                                    <Banknote className="h-4 w-4 text-amber-500" />
                                    <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Financial Information</h3>
                                  </div>
                                  <div className="grid gap-x-4 gap-y-3 grid-cols-2">
                                    <FormField control={form.control} name="bank_name" render={({ field }) => (
                                      <FormItem>
                                        <FormLabel className="text-xs">Bank Name</FormLabel>
                                        <FormControl><Input placeholder="Bank name" value={field.value ?? ""} onChange={(e) => field.onChange(e.target.value || null)} /></FormControl>
                                        <FormMessage />
                                      </FormItem>
                                    )} />
                                    <FormField control={form.control} name="bank_account_number" render={({ field }) => (
                                      <FormItem>
                                        <FormLabel className="text-xs">Account Number</FormLabel>
                                        <FormControl><Input placeholder="Account number" value={field.value ?? ""} onChange={(e) => field.onChange(e.target.value || null)} /></FormControl>
                                        <FormMessage />
                                      </FormItem>
                                    )} />
                                    <FormField control={form.control} name="bank_routing_number" render={({ field }) => (
                                      <FormItem>
                                        <FormLabel className="text-xs">BSB / Routing Number</FormLabel>
                                        <FormControl><Input placeholder="Routing number" value={field.value ?? ""} onChange={(e) => field.onChange(e.target.value || null)} /></FormControl>
                                        <FormMessage />
                                      </FormItem>
                                    )} />
                                    <FormField control={form.control} name="tax_id" render={({ field }) => (
                                      <FormItem>
                                        <FormLabel className="text-xs">Tax File Number</FormLabel>
                                        <FormControl><Input placeholder="Tax ID" value={field.value ?? ""} onChange={(e) => field.onChange(e.target.value || null)} /></FormControl>
                                        <FormMessage />
                                      </FormItem>
                                    )} />
                                  </div>
                                </div>
                              </>
                            )}
                          </div>
                        ) : (
                          <div className="space-y-5">
                            <div>
                              <div className="flex items-center gap-2 mb-3">
                                <UserRound className="h-4 w-4 text-blue-500" />
                                <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Basic Information</h3>
                              </div>
                              <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-6 gap-y-0.5">
                                <InfoRow label="Name" value={employee.name} />
                                <InfoRow label="Email" value={employee.email} />
                                <InfoRow label="Employee ID" value={employee.employee_id} />
                              </div>
                            </div>

                            <Separator />

                            <div>
                              <div className="flex items-center gap-2 mb-3">
                                <Briefcase className="h-4 w-4 text-violet-500" />
                                <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Employment Details</h3>
                              </div>
                              <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-6 gap-y-0.5">
                                <InfoRow label="Department" value={employee.department?.name} />
                                <InfoRow label="Position" value={employee.position?.title ?? employee.job_title} />
                                <InfoRow
                                  label="Shift"
                                  value={employee.shift ? `${employee.shift.name} (${employee.shift.start_time.slice(0, 5)}–${employee.shift.end_time.slice(0, 5)})` : null}
                                />
                                <InfoRow label="Reporting Manager" value={employee.reporting_manager?.name} />
                                <InfoRow label="Status" value={employee.employment_status ? employmentStatusLabels[employee.employment_status] : null} />
                                <InfoRow label="Type" value={employee.employment_type ? employmentTypeLabels[employee.employment_type] : null} />
                                <InfoRow label="Date of Joining" value={formatDate(employee.date_of_joining)} />
                                <InfoRow label="Probation End" value={formatDate(employee.probation_end_date)} />
                                <InfoRow label="Notice Period" value={employee.notice_period_days ? `${employee.notice_period_days} days` : null} />
                                <InfoRow label="Work Location" value={employee.work_location} />
                              </div>
                            </div>

                            {(canViewFinancial || isSelf) && (
                              <>
                                <Separator />
                                <div>
                                  <div className="flex items-center gap-2 mb-3">
                                    <Banknote className="h-4 w-4 text-amber-500" />
                                    <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Financial Information</h3>
                                  </div>
                                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-6 gap-y-0.5">
                                    <InfoRow label="Bank Name" value={employee.bank_name} />
                                    <InfoRow label="Account Number" value={employee.bank_account_number} />
                                    <InfoRow label="BSB / Routing" value={employee.bank_routing_number} />
                                    <InfoRow label="Tax File Number" value={employee.tax_id} />
                                  </div>
                                </div>
                              </>
                            )}
                          </div>
                        )}
                      </div>}

                      {/* ─── Personal Tab ─── */}
                      {activeTab === "personal" && <div className="space-y-4">
                        {editing ? (
                          <div>
                            <div className="flex items-center gap-2 mb-3">
                              <UserRound className="h-4 w-4 text-blue-500" />
                              <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Personal Information</h3>
                            </div>
                            <div className="grid gap-x-4 gap-y-3 grid-cols-2">
                              <FormField control={form.control} name="gender" render={({ field }) => (
                                <FormItem>
                                  <FormLabel className="text-xs">Gender</FormLabel>
                                  <Select value={field.value ?? ""} onValueChange={(v) => field.onChange(v || null)}>
                                    <FormControl><SelectTrigger className="w-full data-[size=default]:h-10 rounded-xl"><span data-slot="select-value" className="flex flex-1 text-left">{field.value ? genderLabels[field.value] ?? field.value : <span className="text-muted-foreground">Select</span>}</span></SelectTrigger></FormControl>
                                    <SelectContent><SelectGroup>
                                      {GENDERS.map((g) => <SelectItem key={g} value={g}>{genderLabels[g]}</SelectItem>)}
                                    </SelectGroup></SelectContent>
                                  </Select>
                                  <FormMessage />
                                </FormItem>
                              )} />
                              <FormField control={form.control} name="marital_status" render={({ field }) => (
                                <FormItem>
                                  <FormLabel className="text-xs">Marital Status</FormLabel>
                                  <Select value={field.value ?? ""} onValueChange={(v) => field.onChange(v || null)}>
                                    <FormControl><SelectTrigger className="w-full data-[size=default]:h-10 rounded-xl"><span data-slot="select-value" className="flex flex-1 text-left">{field.value ? maritalStatusLabels[field.value] ?? field.value : <span className="text-muted-foreground">Select</span>}</span></SelectTrigger></FormControl>
                                    <SelectContent><SelectGroup>
                                      {MARITAL_STATUSES.map((m) => <SelectItem key={m} value={m}>{maritalStatusLabels[m]}</SelectItem>)}
                                    </SelectGroup></SelectContent>
                                  </Select>
                                  <FormMessage />
                                </FormItem>
                              )} />
                              <FormField control={form.control} name="nationality" render={({ field }) => (
                                <FormItem>
                                  <FormLabel className="text-xs">Nationality</FormLabel>
                                  <FormControl><Input placeholder="e.g. Pakistani" value={field.value ?? ""} onChange={(e) => field.onChange(e.target.value || null)} /></FormControl>
                                  <FormMessage />
                                </FormItem>
                              )} />
                              <FormField control={form.control} name="blood_group" render={({ field }) => (
                                <FormItem>
                                  <FormLabel className="text-xs">Blood Group</FormLabel>
                                  <Select value={field.value ?? ""} onValueChange={(v) => field.onChange(v || null)}>
                                    <FormControl><SelectTrigger className="w-full data-[size=default]:h-10 rounded-xl"><span data-slot="select-value" className="flex flex-1 text-left">{field.value || <span className="text-muted-foreground">Select</span>}</span></SelectTrigger></FormControl>
                                    <SelectContent><SelectGroup>
                                      {BLOOD_GROUPS.map((bg) => <SelectItem key={bg} value={bg}>{bg}</SelectItem>)}
                                    </SelectGroup></SelectContent>
                                  </Select>
                                  <FormMessage />
                                </FormItem>
                              )} />
                            </div>
                          </div>
                        ) : (
                          <div>
                            <div className="flex items-center gap-2 mb-3">
                              <UserRound className="h-4 w-4 text-blue-500" />
                              <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Personal Information</h3>
                            </div>
                            <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-6 gap-y-0.5">
                              <InfoRow label="Gender" value={employee.gender ? genderLabels[employee.gender] ?? employee.gender : null} />
                              <InfoRow label="Marital Status" value={employee.marital_status ? maritalStatusLabels[employee.marital_status] ?? employee.marital_status : null} />
                              <InfoRow label="Nationality" value={employee.nationality} />
                              <InfoRow label="Blood Group" value={employee.blood_group} />
                            </div>
                          </div>
                        )}
                      </div>}

                      {/* ─── Emergency & Address Tab ─── */}
                      {activeTab === "emergency" && <div className="space-y-4">
                        {editing ? (
                          <div className="space-y-5">
                            <div>
                              <div className="flex items-center gap-2 mb-3">
                                <Phone className="h-4 w-4 text-rose-500" />
                                <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Emergency Contact</h3>
                              </div>
                              <div className="grid gap-x-4 gap-y-3 grid-cols-3">
                                <FormField control={form.control} name="emergency_contact_name" render={({ field }) => (
                                  <FormItem>
                                    <FormLabel className="text-xs">Contact Name</FormLabel>
                                    <FormControl><Input placeholder="Full name" value={field.value ?? ""} onChange={(e) => field.onChange(e.target.value || null)} /></FormControl>
                                    <FormMessage />
                                  </FormItem>
                                )} />
                                <FormField control={form.control} name="emergency_contact_phone" render={({ field }) => (
                                  <FormItem>
                                    <FormLabel className="text-xs">Emergency Phone</FormLabel>
                                    <FormControl><Input placeholder="+92..." value={field.value ?? ""} onChange={(e) => field.onChange(e.target.value || null)} /></FormControl>
                                    <FormMessage />
                                  </FormItem>
                                )} />
                                <FormField control={form.control} name="emergency_contact_relation" render={({ field }) => (
                                  <FormItem>
                                    <FormLabel className="text-xs">Relation</FormLabel>
                                    <FormControl><Input placeholder="e.g. Spouse, Parent" value={field.value ?? ""} onChange={(e) => field.onChange(e.target.value || null)} /></FormControl>
                                    <FormMessage />
                                  </FormItem>
                                )} />
                              </div>
                            </div>
                            <Separator />
                            <div>
                              <div className="flex items-center gap-2 mb-3">
                                <MapPin className="h-4 w-4 text-emerald-500" />
                                <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Address</h3>
                              </div>
                              <div className="grid gap-x-4 gap-y-3 grid-cols-2">
                                <FormField control={form.control} name="current_address" render={({ field }) => (
                                  <FormItem>
                                    <FormLabel className="text-xs">Current Address</FormLabel>
                                    <FormControl><Textarea placeholder="Current residential address" rows={2} value={field.value ?? ""} onChange={(e) => field.onChange(e.target.value || null)} /></FormControl>
                                    <FormMessage />
                                  </FormItem>
                                )} />
                                <FormField control={form.control} name="permanent_address" render={({ field }) => (
                                  <FormItem>
                                    <FormLabel className="text-xs">Permanent Address</FormLabel>
                                    <FormControl><Textarea placeholder="Permanent address" rows={2} value={field.value ?? ""} onChange={(e) => field.onChange(e.target.value || null)} /></FormControl>
                                    <FormMessage />
                                  </FormItem>
                                )} />
                              </div>
                            </div>
                          </div>
                        ) : (
                          <div className="space-y-6">
                            <div>
                              <div className="flex items-center gap-2 mb-3">
                                <Phone className="h-4 w-4 text-rose-500" />
                                <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Emergency Contact</h3>
                              </div>
                              <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-6 gap-y-0.5">
                                <InfoRow label="Name" value={employee.emergency_contact_name} />
                                <InfoRow label="Emergency Phone" value={employee.emergency_contact_phone} />
                                <InfoRow label="Relation" value={employee.emergency_contact_relation} />
                              </div>
                            </div>

                            <Separator />

                            <div>
                              <div className="flex items-center gap-2 mb-3">
                                <MapPin className="h-4 w-4 text-emerald-500" />
                                <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Address</h3>
                              </div>
                              <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-0.5">
                                <InfoRow label="Current Address" value={employee.current_address} />
                                <InfoRow label="Permanent Address" value={employee.permanent_address} />
                              </div>
                            </div>
                          </div>
                        )}
                      </div>}

                      {/* ─── Documents Tab ─── */}
                      {activeTab === "documents" && <div className="space-y-3">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <Upload className="h-4 w-4 text-blue-500" />
                            <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Documents {documents.length > 0 && `(${documents.length})`}</h3>
                          </div>
                          {canUploadDoc && (
                            <Button size="sm" className="h-7 text-xs px-3" onClick={() => setUploadDialogOpen(true)}>
                              <Plus className="h-3 w-3 mr-1" />
                              Upload
                            </Button>
                          )}
                        </div>
                        {docsLoading ? (
                          <div className="space-y-2">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-12" />)}</div>
                        ) : documents.length === 0 ? (
                          <div className="flex flex-col items-center text-center gap-2 py-6">
                            <Upload className="size-8 text-muted-foreground/60" />
                            <p className="text-sm font-medium text-muted-foreground">No documents yet</p>
                            <p className="text-xs text-muted-foreground">
                              {canUploadDoc ? "Upload documents such as ID proofs, contracts, or certifications." : "No documents have been uploaded."}
                            </p>
                          </div>
                        ) : (
                          <div className="space-y-2">
                            {documents.map((doc) => (
                              <div key={doc.id} className="flex items-center gap-3 rounded-lg border border-border p-3 hover:bg-muted/30 transition-colors">
                                <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-muted shrink-0">
                                  {doc.mime_type === "application/pdf" ? <FileText className="h-4 w-4 text-red-500" /> : doc.mime_type.startsWith("image/") ? <ImageIcon className="h-4 w-4 text-blue-500" /> : <FileIcon className="h-4 w-4 text-muted-foreground" />}
                                </div>
                                <div className="flex-1 min-w-0">
                                  <div className="flex items-center gap-1.5">
                                    <p className="text-[0.75rem] font-medium text-foreground truncate">{doc.title}</p>
                                    {doc.is_verified && <CheckCircle2 className="size-3.5 text-green-600 dark:text-green-400 shrink-0" />}
                                  </div>
                                  <div className="flex items-center gap-2 mt-0.5">
                                    <span className="text-[0.6rem] text-muted-foreground">{documentCategoryLabels[doc.category] ?? doc.category}</span>
                                    <span className="text-border">·</span>
                                    <span className="text-[0.6rem] text-muted-foreground">{formatFileSize(doc.file_size)}</span>
                                    <span className="text-border">·</span>
                                    <span className="text-[0.6rem] text-muted-foreground">{formatDate(doc.created_at)}</span>
                                  </div>
                                </div>
                                <div className="flex items-center gap-0.5 shrink-0">
                                  <Button variant="ghost" size="sm" className="h-7 w-7 p-0" render={<a href={doc.download_url} target="_blank" rel="noopener noreferrer" aria-label={`Download ${doc.title}`} />}>
                                    <Download className="h-3.5 w-3.5" />
                                  </Button>
                                  {canVerifyDoc && !doc.is_verified && (
                                    <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => verifyMutation.mutate(doc.id)} aria-label={`Verify ${doc.title}`}>
                                      <ShieldCheck className="h-3.5 w-3.5" />
                                    </Button>
                                  )}
                                  {canDeleteDoc && (
                                    <Button variant="ghost" size="sm" className="h-7 w-7 p-0 text-destructive hover:text-destructive" onClick={() => setDeleteDocTarget(doc.id)} aria-label={`Delete ${doc.title}`}>
                                      <Trash2 className="h-3.5 w-3.5" />
                                    </Button>
                                  )}
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>}

                      {/* ─── Leave History Tab ─── */}
                      {activeTab === "leave" && <div>
                        {leaveLoading ? (
                          <div className="space-y-2">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-10" />)}</div>
                        ) : leaveRequests.length === 0 ? (
                          <div className="flex flex-col items-center text-center gap-2 py-6">
                            <Calendar className="size-8 text-muted-foreground/60" />
                            <p className="text-sm font-medium text-muted-foreground">No leave history</p>
                            <p className="text-xs text-muted-foreground">Leave requests will appear here.</p>
                            {isSelf && (
                              <Button variant="outline" size="sm" className="h-8 text-xs mt-1" render={<Link href="/hr/leave" />}>
                                Go to My Leave
                              </Button>
                            )}
                          </div>
                        ) : (
                          <div className="overflow-x-auto rounded-lg border border-border">
                            <table className="w-full">
                              <thead>
                                <tr className="border-b border-border bg-muted/50">
                                  <th className="text-left text-[0.6rem] font-semibold uppercase tracking-wider text-muted-foreground px-4 py-2.5">Leave Type</th>
                                  <th className="text-left text-[0.6rem] font-semibold uppercase tracking-wider text-muted-foreground px-4 py-2.5">Date Range</th>
                                  <th className="text-center text-[0.6rem] font-semibold uppercase tracking-wider text-muted-foreground px-4 py-2.5">Days</th>
                                  <th className="text-left text-[0.6rem] font-semibold uppercase tracking-wider text-muted-foreground px-4 py-2.5">Status</th>
                                  <th className="text-left text-[0.6rem] font-semibold uppercase tracking-wider text-muted-foreground px-4 py-2.5">Submitted</th>
                                </tr>
                              </thead>
                              <tbody>
                                {leaveRequests.map((req) => (
                                  <tr key={req.id} className="border-b border-border/50 last:border-0 hover:bg-muted/30 transition-colors">
                                    <td className="px-4 py-2.5 text-[0.75rem] font-medium text-foreground">{req.leave_type.name}</td>
                                    <td className="px-4 py-2.5 text-[0.7rem] text-muted-foreground tabular-nums">{formatDate(req.start_date)} &mdash; {formatDate(req.end_date)}</td>
                                    <td className="px-4 py-2.5 text-[0.75rem] text-foreground text-center">{formatDaysCount(req.days_count)}</td>
                                    <td className="px-4 py-2.5">
                                      <span className="inline-flex items-center gap-1.5">
                                        <span className={cn("size-1.5 rounded-full", leaveStatusDotColors[req.status] ?? "bg-gray-400")} />
                                        <span className="text-[0.65rem] text-muted-foreground capitalize">{leaveStatusLabels[req.status] ?? req.status}</span>
                                      </span>
                                    </td>
                                    <td className="px-4 py-2.5 text-[0.7rem] text-muted-foreground tabular-nums">{formatDate(req.created_at)}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        )}
                      </div>}

                      {/* ─── Notes Tab ─── */}
                      {activeTab === "notes" && canManageNotes && (
                        <div className="space-y-3">
                            <div>
                              <div className="flex items-center gap-2 mb-2">
                                <StickyNote className="h-4 w-4 text-amber-500" />
                                <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Add a Note</h3>
                              </div>
                              <Textarea placeholder="Write a note about this employee..." rows={2} value={noteContent} onChange={(e) => setNoteContent(e.target.value)} className="text-xs" />
                              <div className="flex items-center justify-between mt-1.5">
                                <label className="flex items-center gap-2 text-xs text-muted-foreground cursor-pointer">
                                  <Switch checked={noteConfidential} onCheckedChange={setNoteConfidential} />
                                  <Lock className="size-3" />
                                  Confidential
                                </label>
                                <Button size="sm" className="h-7 text-xs" onClick={handleCreateNote} disabled={!noteContent.trim() || createNoteMutation.isPending}>
                                  {createNoteMutation.isPending && <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />}
                                  <Plus className="h-3.5 w-3.5 mr-1" />
                                  Add Note
                                </Button>
                              </div>
                            </div>
                            <Separator />
                          {notesLoading ? (
                            <div className="space-y-2">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-14" />)}</div>
                          ) : notes.length === 0 ? (
                            <div className="flex flex-col items-center text-center gap-2 py-6">
                              <StickyNote className="size-8 text-muted-foreground/60" />
                              <p className="text-sm font-medium text-muted-foreground">No notes yet</p>
                              <p className="text-xs text-muted-foreground">Add notes to track important information about this employee.</p>
                            </div>
                          ) : (
                            <div className="space-y-2">
                              {notes.map((note) => (
                                <Card key={note.id} className="border-border">
                                  <CardContent className="p-3">
                                    <div className="flex items-start justify-between gap-3">
                                      <div className="flex-1 min-w-0">
                                        <div className="flex items-center gap-2 mb-1">
                                          <p className="text-[0.75rem] font-medium text-foreground">{note.author.name}</p>
                                          <span className="text-[0.65rem] text-muted-foreground tabular-nums">{formatDate(note.created_at)}</span>
                                          {note.is_confidential && (
                                            <span className="inline-flex items-center gap-1 text-[0.6rem] text-amber-600 dark:text-amber-400">
                                              <Lock className="size-2.5" />
                                              Confidential
                                            </span>
                                          )}
                                        </div>
                                        <p className="text-[0.75rem] text-foreground whitespace-pre-wrap">{note.content}</p>
                                      </div>
                                      <Button variant="ghost" size="sm" className="h-7 w-7 p-0 text-destructive hover:text-destructive shrink-0" onClick={() => setDeleteNoteTarget(note.id)}>
                                        <Trash2 className="h-3.5 w-3.5" />
                                      </Button>
                                    </div>
                                  </CardContent>
                                </Card>
                              ))}
                            </div>
                          )}
                        </div>
                      )}
                    </div>

                    {/* ── Footer ── */}
                    {editing ? (
                      <>
                        <Separator />
                        <div className="flex items-center justify-end gap-2 px-6 py-3">
                          <Button type="button" variant="outline" size="sm" onClick={() => { setEditing(false); form.reset(getDefaults(employee)); }} disabled={updateMutation.isPending}>
                            Cancel
                          </Button>
                          <Button type="submit" size="sm" disabled={updateMutation.isPending}>
                            {updateMutation.isPending && <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />}
                            Save Changes
                          </Button>
                        </div>
                      </>
                    ) : canEdit ? (
                      <>
                        <Separator />
                        <div className="flex items-center justify-end px-6 py-3">
                          <Button variant="outline" size="sm" className="h-8 text-xs" onClick={() => { if (employee) form.reset(getDefaults(employee)); setEditing(true); }}>
                            <Pencil className="h-3.5 w-3.5 mr-1.5" />
                            Edit
                          </Button>
                        </div>
                      </>
                    ) : null}
                  </div>
                </form>
              </Form>
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* Upload Document Dialog */}
      <DocumentUploadCard
        open={uploadDialogOpen}
        onOpenChange={setUploadDialogOpen}
        onUpload={(formData) => uploadMutation.mutate(formData)}
        isPending={uploadMutation.isPending}
      />

      {/* Delete Document Confirmation */}
      <ConfirmDialog
        open={!!deleteDocTarget}
        onOpenChange={(o) => { if (!o) setDeleteDocTarget(null); }}
        title="Delete Document"
        description="Are you sure you want to delete this document? This action cannot be undone."
        confirmLabel="Delete"
        onConfirm={() => { if (deleteDocTarget) deleteDocMutation.mutate(deleteDocTarget, { onSuccess: () => setDeleteDocTarget(null) }); }}
        isPending={deleteDocMutation.isPending}
      />

      {/* Delete Note Confirmation */}
      <ConfirmDialog
        open={!!deleteNoteTarget}
        onOpenChange={(o) => { if (!o) setDeleteNoteTarget(null); }}
        title="Delete Note"
        description="Are you sure you want to delete this note? This action cannot be undone."
        confirmLabel="Delete"
        onConfirm={() => { if (deleteNoteTarget) deleteNoteMutation.mutate(deleteNoteTarget, { onSuccess: () => setDeleteNoteTarget(null) }); }}
        isPending={deleteNoteMutation.isPending}
      />
    </>
  );
}
