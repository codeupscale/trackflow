"use client";

import {
  ArrowLeft,
  Banknote,
  Briefcase,
  Calendar,
  Loader2,
  Lock,
  Mail,
  MapPin,
  Pencil,
  Phone,
  Plus,
  StickyNote,
  Trash2,
  Upload,
  UserRound,
} from "lucide-react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useState } from "react";

import {
  useDeleteDocument,
  useEmployeeDocuments,
  useUploadDocument,
  useVerifyDocument,
} from "@/hooks/hr/use-employee-documents";
import {
  useCreateNote,
  useDeleteNote,
  useEmployeeNotes,
} from "@/hooks/hr/use-employee-notes";
import { useEmployee } from "@/hooks/hr/use-employees";
import { useLeaveRequests } from "@/hooks/hr/use-leave-requests";
import { cn, formatDate } from "@/lib/utils";
import {
  employeeNoteSchema,
  employmentTypeLabels,
  employmentStatusLabels,
} from "@/lib/validations/employee";
import { useAuthStore } from "@/stores/auth-store";
import { usePermissionStore } from "@/stores/permission-store";

import { ConfirmDialog } from "@/components/common/ConfirmDialog";
import { DocumentListItem } from "@/components/hr/DocumentListItem";
import { DocumentUploadCard } from "@/components/hr/DocumentUploadCard";
import { EmployeeProfileSheet } from "@/components/hr/EmployeeProfileSheet";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";

function getInitials(name: string): string {
  return name
    .split(" ")
    .map((n) => n[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

// ── Status dot colors ──
const employmentStatusDotColors: Record<string, string> = {
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

function EmploymentStatusDot({ status }: { status: string }) {
  const dotColor = employmentStatusDotColors[status] ?? "bg-gray-400";
  const label =
    employmentStatusLabels[status as keyof typeof employmentStatusLabels] ??
    status;
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={cn("size-1.5 rounded-full shrink-0", dotColor)} />
      <span className="text-[0.65rem] text-muted-foreground capitalize">
        {label}
      </span>
    </span>
  );
}

function LeaveStatusDot({ status }: { status: string }) {
  const dotColor = leaveStatusDotColors[status] ?? "bg-gray-400";
  const label = leaveStatusLabels[status] ?? status;
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={cn("size-1.5 rounded-full shrink-0", dotColor)} />
      <span className="text-[0.65rem] text-muted-foreground capitalize">
        {label}
      </span>
    </span>
  );
}

// ── Section header with icon badge ──
function SectionHeader({
  icon: Icon,
  title,
  bgClass,
  iconClass,
}: {
  icon: typeof Calendar;
  title: string;
  bgClass: string;
  iconClass: string;
}) {
  return (
    <div className="flex items-center gap-2 mb-3">
      <div
        className={cn(
          "flex h-7 w-7 items-center justify-center rounded-lg",
          bgClass,
        )}
      >
        <Icon className={cn("h-3.5 w-3.5", iconClass)} />
      </div>
      <h3 className="text-sm font-semibold">{title}</h3>
    </div>
  );
}

// ── Info row helper ──
function InfoRow({
  label,
  value,
}: {
  label: string;
  value: string | null | undefined;
}) {
  return (
    <div className="py-1.5">
      <p className="text-[0.65rem] font-medium text-muted-foreground uppercase tracking-wider">
        {label}
      </p>
      <p className="text-[0.75rem] text-foreground mt-0.5">{value || "--"}</p>
    </div>
  );
}

export default function EmployeeDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const { user } = useAuthStore();

  const { hasPermission, hasPermissionWithScope } = usePermissionStore();
  const canEditAllFields = hasPermissionWithScope(
    "employees.edit_profile",
    "organization",
  );
  const canManageDocumentsOrg = hasPermissionWithScope(
    "employees.manage_documents",
    "organization",
  );
  const canManageNotes = hasPermission("employees.manage_notes");
  const isManager =
    hasPermissionWithScope("employees.view_directory", "project") &&
    !canEditAllFields;
  const canManage = canEditAllFields || isManager;

  const employeeId = params.id;
  const { data: employeeData, isLoading, isError } = useEmployee(employeeId);
  const employee = employeeData?.data ?? null;
  const isSelf = employee?.user_id === user?.id;

  // ── State ──
  const [profileSheetOpen, setProfileSheetOpen] = useState(false);
  const [uploadDialogOpen, setUploadDialogOpen] = useState(false);
  const [deleteDocTarget, setDeleteDocTarget] = useState<string | null>(null);
  const [deleteNoteTarget, setDeleteNoteTarget] = useState<string | null>(null);
  const [noteContent, setNoteContent] = useState("");
  const [noteConfidential, setNoteConfidential] = useState(false);

  // ── Documents ──
  const { data: docsData, isLoading: docsLoading } =
    useEmployeeDocuments(employeeId);
  const uploadMutation = useUploadDocument(employeeId);
  const verifyMutation = useVerifyDocument(employeeId);
  const deleteDocMutation = useDeleteDocument(employeeId);
  const documents = docsData?.data ?? [];

  // ── Notes ──
  const { data: notesData, isLoading: notesLoading } = useEmployeeNotes(
    canManage ? employeeId : undefined,
  );
  const createNoteMutation = useCreateNote(employeeId);
  const deleteNoteMutation = useDeleteNote(employeeId);
  const notes = notesData?.data ?? [];

  // ── Leave History ──
  const { data: leaveData, isLoading: leaveLoading } = useLeaveRequests({});
  const leaveRequests = leaveData?.data ?? [];

  // ── Handlers ──
  const handleUpload = (formData: FormData) => {
    uploadMutation.mutate(formData, {
      onSuccess: () => setUploadDialogOpen(false),
    });
  };

  const handleDeleteDoc = () => {
    if (!deleteDocTarget) return;
    deleteDocMutation.mutate(deleteDocTarget, {
      onSuccess: () => setDeleteDocTarget(null),
    });
  };

  const handleCreateNote = () => {
    const parsed = employeeNoteSchema.safeParse({
      content: noteContent,
      is_confidential: noteConfidential,
    });
    if (!parsed.success) return;
    createNoteMutation.mutate(parsed.data, {
      onSuccess: () => {
        setNoteContent("");
        setNoteConfidential(false);
      },
    });
  };

  const handleDeleteNote = () => {
    if (!deleteNoteTarget) return;
    deleteNoteMutation.mutate(deleteNoteTarget, {
      onSuccess: () => setDeleteNoteTarget(null),
    });
  };

  // ── Loading state ──
  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-32" />
        <div className="flex items-center gap-3">
          <Skeleton className="h-16 w-16 rounded-full" />
          <div className="space-y-2">
            <Skeleton className="h-5 w-40" />
            <Skeleton className="h-3 w-52" />
            <Skeleton className="h-3 w-24" />
          </div>
        </div>
        <Skeleton className="h-8 w-full max-w-sm" />
        <div className="grid gap-3 md:grid-cols-2">
          <Skeleton className="h-40" />
          <Skeleton className="h-40" />
        </div>
      </div>
    );
  }

  // ── Error state ──
  if (isError || !employee) {
    return (
      <div className="space-y-4">
        <Button
          variant="ghost"
          size="sm"
          className="h-8 text-xs"
          onClick={() => router.push("/hr/employees")}
        >
          <ArrowLeft className="h-3.5 w-3.5 mr-1.5" />
          Back to Directory
        </Button>
        <Card className="border-destructive/50">
          <CardContent className="py-16">
            <div className="flex flex-col items-center text-center gap-3">
              <UserRound className="size-10 text-destructive/60" />
              <p className="text-sm font-medium text-muted-foreground">
                Failed to load employee profile
              </p>
              <p className="text-xs text-muted-foreground">
                The employee may not exist or you may not have permission to view
                this profile.
              </p>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  const canEdit = canEditAllFields || isSelf;
  const canUploadDoc = hasPermission("employees.manage_documents") || isSelf;
  const canVerifyDoc = canManageDocumentsOrg;
  const canDeleteDoc = canManageDocumentsOrg;
  const canViewNotes = canManageNotes;
  const canCreateNotes = canManageNotes;

  return (
    <div className="space-y-4">
      {/* Back + Actions row */}
      <div className="flex items-center justify-between">
        <Button
          variant="ghost"
          size="sm"
          className="h-8 text-xs"
          nativeButton={false}
          render={<Link href="/hr/employees" />}
        >
          <ArrowLeft className="h-3.5 w-3.5 mr-1.5" />
          Back to Directory
        </Button>
        {canEdit && (
          <Button
            variant="outline"
            size="sm"
            className="h-8 text-xs"
            onClick={() => setProfileSheetOpen(true)}
          >
            <Pencil className="h-3.5 w-3.5 mr-1.5" />
            Edit Profile
          </Button>
        )}
      </div>

      {/* Header Card */}
      <Card className="border-border">
        <CardContent className="p-4">
          <div className="flex items-center gap-3">
            <Avatar className="h-16 w-16 shrink-0">
              <AvatarImage
                src={employee.avatar_url ?? undefined}
                alt={employee.name}
              />
              <AvatarFallback className="text-lg">
                {getInitials(employee.name)}
              </AvatarFallback>
            </Avatar>
            <div className="min-w-0 flex-1">
              <h1 className="text-lg font-semibold tracking-tight text-foreground truncate">
                {employee.name}
              </h1>
              <div className="flex items-center gap-1.5 mt-0.5">
                <Mail className="h-3 w-3 text-muted-foreground shrink-0" />
                <span className="text-xs text-muted-foreground truncate">
                  {employee.email}
                </span>
              </div>
              <div className="flex items-center gap-3 mt-1.5 flex-wrap">
                <EmploymentStatusDot status={employee.employment_status} />
                {employee.department && (
                  <span className="text-[0.65rem] text-muted-foreground">
                    {employee.department.name}
                  </span>
                )}
                {employee.employee_id && (
                  <span className="text-[0.65rem] text-muted-foreground tabular-nums">
                    ID: {employee.employee_id}
                  </span>
                )}
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Tabs */}
      <Tabs defaultValue="overview">
        <TabsList>
          <TabsTrigger value="overview" className="text-xs">
            Overview
          </TabsTrigger>
          <TabsTrigger value="documents" className="text-xs">
            Documents
          </TabsTrigger>
          <TabsTrigger value="leave" className="text-xs">
            Leave History
          </TabsTrigger>
          {canViewNotes && (
            <TabsTrigger value="notes" className="text-xs">
              Notes
            </TabsTrigger>
          )}
        </TabsList>

        {/* ─── Overview Tab ─── */}
        <TabsContent value="overview" className="mt-4">
          <div className="grid gap-3 md:grid-cols-2">
            {/* Personal Info */}
            <Card className="border-border">
              <CardContent className="p-4">
                <SectionHeader
                  icon={UserRound}
                  title="Personal Information"
                  bgClass="bg-blue-500/10"
                  iconClass="text-blue-500"
                />
                <div className="grid grid-cols-2 gap-x-4 gap-y-1">
                  <InfoRow label="Gender" value={employee.gender} />
                  <InfoRow
                    label="Marital Status"
                    value={employee.marital_status}
                  />
                  <InfoRow label="Nationality" value={employee.nationality} />
                  <InfoRow label="Blood Group" value={employee.blood_group} />
                </div>
              </CardContent>
            </Card>

            {/* Employment Info */}
            <Card className="border-border">
              <CardContent className="p-4">
                <SectionHeader
                  icon={Briefcase}
                  title="Employment Information"
                  bgClass="bg-violet-500/10"
                  iconClass="text-violet-500"
                />
                <div className="grid grid-cols-2 gap-x-4 gap-y-1">
                  <InfoRow
                    label="Position"
                    value={employee.position?.title ?? employee.job_title}
                  />
                  <InfoRow
                    label="Department"
                    value={employee.department?.name}
                  />
                  <InfoRow
                    label="Reporting Manager"
                    value={employee.reporting_manager?.name}
                  />
                  <InfoRow
                    label="Employment Type"
                    value={
                      employee.employment_type
                        ? employmentTypeLabels[employee.employment_type]
                        : null
                    }
                  />
                  <InfoRow
                    label="Date of Joining"
                    value={formatDate(employee.date_of_joining)}
                  />
                  <InfoRow
                    label="Confirmation Date"
                    value={formatDate(employee.date_of_confirmation)}
                  />
                  <InfoRow
                    label="Probation End"
                    value={formatDate(employee.probation_end_date)}
                  />
                  {employee.work_location && (
                    <InfoRow
                      label="Work Location"
                      value={employee.work_location}
                    />
                  )}
                </div>
              </CardContent>
            </Card>

            {/* Emergency Contact */}
            <Card className="border-border">
              <CardContent className="p-4">
                <SectionHeader
                  icon={Phone}
                  title="Emergency Contact"
                  bgClass="bg-rose-500/10"
                  iconClass="text-rose-500"
                />
                <div className="grid grid-cols-2 gap-x-4 gap-y-1">
                  <InfoRow
                    label="Name"
                    value={employee.emergency_contact_name}
                  />
                  <InfoRow
                    label="Phone"
                    value={employee.emergency_contact_phone}
                  />
                  <InfoRow
                    label="Relation"
                    value={employee.emergency_contact_relation}
                  />
                </div>
              </CardContent>
            </Card>

            {/* Address */}
            <Card className="border-border">
              <CardContent className="p-4">
                <SectionHeader
                  icon={MapPin}
                  title="Address"
                  bgClass="bg-emerald-500/10"
                  iconClass="text-emerald-500"
                />
                <div className="space-y-1">
                  <InfoRow
                    label="Current Address"
                    value={employee.current_address}
                  />
                  <InfoRow
                    label="Permanent Address"
                    value={employee.permanent_address}
                  />
                </div>
              </CardContent>
            </Card>

            {/* Financial Info (admin or self only) */}
            {(canEditAllFields || isSelf) && (
              <Card className="border-border">
                <CardContent className="p-4">
                  <SectionHeader
                    icon={Banknote}
                    title="Financial Information"
                    bgClass="bg-amber-500/10"
                    iconClass="text-amber-500"
                  />
                  <div className="grid grid-cols-2 gap-x-4 gap-y-1">
                    <InfoRow label="Bank Name" value={employee.bank_name} />
                    <InfoRow
                      label="Account Number"
                      value={employee.bank_account_number}
                    />
                    <InfoRow
                      label="BSB / Routing"
                      value={employee.bank_routing_number}
                    />
                    <InfoRow
                      label="Tax File Number"
                      value={employee.tax_id}
                    />
                  </div>
                </CardContent>
              </Card>
            )}
          </div>
        </TabsContent>

        {/* ─── Documents Tab ─── */}
        <TabsContent value="documents" className="mt-4">
          <div className="space-y-3">
            {canUploadDoc && (
              <div className="flex justify-end">
                <Button
                  size="sm"
                  className="h-8 text-xs"
                  onClick={() => setUploadDialogOpen(true)}
                >
                  <Upload className="h-3.5 w-3.5 mr-1.5" />
                  Upload Document
                </Button>
              </div>
            )}

            {docsLoading ? (
              <Card>
                <CardContent className="p-4">
                  <div className="space-y-2">
                    {Array.from({ length: 3 }).map((_, i) => (
                      <Skeleton key={i} className="h-14" />
                    ))}
                  </div>
                </CardContent>
              </Card>
            ) : documents.length === 0 ? (
              <Card>
                <CardContent className="py-12">
                  <div className="flex flex-col items-center text-center gap-2">
                    <Upload className="size-8 text-muted-foreground/60" />
                    <p className="text-sm font-medium text-muted-foreground">
                      No documents yet
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {canUploadDoc
                        ? "Upload documents such as ID proofs, contracts, or certifications."
                        : "No documents have been uploaded for this employee."}
                    </p>
                  </div>
                </CardContent>
              </Card>
            ) : (
              <Card>
                <CardContent className="p-0">
                  {documents.map((doc, idx) => (
                    <div key={doc.id}>
                      {idx > 0 && <Separator />}
                      <DocumentListItem
                        document={doc}
                        canVerify={canVerifyDoc}
                        canDelete={canDeleteDoc}
                        onVerify={(id) => verifyMutation.mutate(id)}
                        onDelete={(id) => setDeleteDocTarget(id)}
                      />
                    </div>
                  ))}
                </CardContent>
              </Card>
            )}
          </div>
        </TabsContent>

        {/* ─── Leave History Tab ─── */}
        <TabsContent value="leave" className="mt-4">
          {leaveLoading ? (
            <Card>
              <CardContent className="p-4">
                <div className="space-y-2">
                  {Array.from({ length: 3 }).map((_, i) => (
                    <Skeleton key={i} className="h-10" />
                  ))}
                </div>
              </CardContent>
            </Card>
          ) : leaveRequests.length === 0 ? (
            <Card>
              <CardContent className="py-12">
                <div className="flex flex-col items-center text-center gap-2">
                  <Calendar className="size-8 text-muted-foreground/60" />
                  <p className="text-sm font-medium text-muted-foreground">
                    No leave history
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Leave requests will appear here.
                  </p>
                  {isSelf && (
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-8 text-xs mt-1"
                      nativeButton={false}
                      render={<Link href="/hr/leave" />}
                    >
                      Go to My Leave
                    </Button>
                  )}
                </div>
              </CardContent>
            </Card>
          ) : (
            <Card className="border-border">
              <CardContent className="p-0">
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead>
                      <tr className="border-b border-border">
                        <th className="text-left text-[0.6rem] font-semibold uppercase tracking-wider text-muted-foreground px-4 py-2.5">
                          Leave Type
                        </th>
                        <th className="text-left text-[0.6rem] font-semibold uppercase tracking-wider text-muted-foreground px-4 py-2.5">
                          Date Range
                        </th>
                        <th className="text-center text-[0.6rem] font-semibold uppercase tracking-wider text-muted-foreground px-4 py-2.5">
                          Days
                        </th>
                        <th className="text-left text-[0.6rem] font-semibold uppercase tracking-wider text-muted-foreground px-4 py-2.5">
                          Status
                        </th>
                        <th className="text-left text-[0.6rem] font-semibold uppercase tracking-wider text-muted-foreground px-4 py-2.5">
                          Submitted
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {leaveRequests.map((req) => (
                        <tr
                          key={req.id}
                          className="border-b border-border/50 last:border-0 hover:bg-muted/30 transition-colors"
                        >
                          <td className="px-4 py-2.5 text-[0.75rem] font-medium text-foreground">
                            {req.leave_type.name}
                          </td>
                          <td className="px-4 py-2.5 text-[0.7rem] text-muted-foreground tabular-nums">
                            {formatDate(req.start_date)} &mdash;{" "}
                            {formatDate(req.end_date)}
                          </td>
                          <td className="px-4 py-2.5 text-[0.75rem] text-foreground tabular-nums text-center">
                            {req.days_count}
                          </td>
                          <td className="px-4 py-2.5">
                            <LeaveStatusDot status={req.status} />
                          </td>
                          <td className="px-4 py-2.5 text-[0.7rem] text-muted-foreground tabular-nums">
                            {formatDate(req.created_at)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          )}

          {isSelf && leaveRequests.length > 0 && (
            <div className="mt-3">
              <Button
                variant="outline"
                size="sm"
                className="h-8 text-xs"
                nativeButton={false}
                render={<Link href="/hr/leave" />}
              >
                View Full Leave Page
              </Button>
            </div>
          )}
        </TabsContent>

        {/* ─── Notes Tab (admin/manager only) ─── */}
        {canViewNotes && (
          <TabsContent value="notes" className="mt-4">
            <div className="space-y-3">
              {/* Create note form */}
              {canCreateNotes && (
                <Card className="border-border">
                  <CardContent className="p-4">
                    <div className="flex items-center gap-2 mb-3">
                      <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-amber-500/10">
                        <StickyNote className="h-3.5 w-3.5 text-amber-500" />
                      </div>
                      <h3 className="text-sm font-semibold">Add a Note</h3>
                    </div>
                    <Textarea
                      placeholder="Write a note about this employee..."
                      rows={3}
                      value={noteContent}
                      onChange={(e) => setNoteContent(e.target.value)}
                      className="text-xs"
                      aria-label="Note content"
                    />
                    <div className="flex items-center justify-between mt-3">
                      <label className="flex items-center gap-2 text-xs text-muted-foreground cursor-pointer">
                        <Switch
                          checked={noteConfidential}
                          onCheckedChange={setNoteConfidential}
                          aria-label="Mark as confidential"
                        />
                        <Lock className="size-3" />
                        Confidential
                      </label>
                      <Button
                        size="sm"
                        className="h-8 text-xs"
                        onClick={handleCreateNote}
                        disabled={
                          !noteContent.trim() || createNoteMutation.isPending
                        }
                      >
                        {createNoteMutation.isPending && (
                          <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
                        )}
                        <Plus className="h-3.5 w-3.5 mr-1" />
                        Add Note
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              )}

              {/* Notes list */}
              {notesLoading ? (
                <Card>
                  <CardContent className="p-4">
                    <div className="space-y-2">
                      {Array.from({ length: 3 }).map((_, i) => (
                        <Skeleton key={i} className="h-14" />
                      ))}
                    </div>
                  </CardContent>
                </Card>
              ) : notes.length === 0 ? (
                <Card>
                  <CardContent className="py-12">
                    <div className="flex flex-col items-center text-center gap-2">
                      <StickyNote className="size-8 text-muted-foreground/60" />
                      <p className="text-sm font-medium text-muted-foreground">
                        No notes yet
                      </p>
                      <p className="text-xs text-muted-foreground">
                        Add notes to track important information about this
                        employee.
                      </p>
                    </div>
                  </CardContent>
                </Card>
              ) : (
                <div className="space-y-2">
                  {notes.map((note) => (
                    <Card key={note.id} className="border-border">
                      <CardContent className="p-3">
                        <div className="flex items-start justify-between gap-3">
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 mb-1">
                              <p className="text-[0.75rem] font-medium text-foreground">
                                {note.author.name}
                              </p>
                              <span className="text-[0.65rem] text-muted-foreground tabular-nums">
                                {formatDate(note.created_at)}
                              </span>
                              {note.is_confidential && (
                                <span className="inline-flex items-center gap-1 text-[0.6rem] text-amber-600 dark:text-amber-400">
                                  <Lock className="size-2.5" />
                                  Confidential
                                </span>
                              )}
                            </div>
                            <p className="text-[0.75rem] text-foreground whitespace-pre-wrap">
                              {note.content}
                            </p>
                          </div>
                          {canManageNotes && (
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-7 w-7 p-0 text-destructive hover:text-destructive shrink-0"
                              onClick={() => setDeleteNoteTarget(note.id)}
                              aria-label={`Delete note by ${note.author.name}`}
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          )}
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              )}
            </div>
          </TabsContent>
        )}
      </Tabs>

      {/* Edit Profile Sheet */}
      <EmployeeProfileSheet
        open={profileSheetOpen}
        onOpenChange={setProfileSheetOpen}
        employee={employee}
      />

      {/* Upload Document Dialog */}
      <DocumentUploadCard
        open={uploadDialogOpen}
        onOpenChange={setUploadDialogOpen}
        onUpload={handleUpload}
        isPending={uploadMutation.isPending}
      />

      {/* Delete Document Confirmation */}
      <ConfirmDialog
        open={!!deleteDocTarget}
        onOpenChange={(open) => {
          if (!open) setDeleteDocTarget(null);
        }}
        title="Delete Document"
        description="Are you sure you want to delete this document? This action cannot be undone."
        confirmLabel="Delete"
        onConfirm={handleDeleteDoc}
        isPending={deleteDocMutation.isPending}
      />

      {/* Delete Note Confirmation */}
      <ConfirmDialog
        open={!!deleteNoteTarget}
        onOpenChange={(open) => {
          if (!open) setDeleteNoteTarget(null);
        }}
        title="Delete Note"
        description="Are you sure you want to delete this note? This action cannot be undone."
        confirmLabel="Delete"
        onConfirm={handleDeleteNote}
        isPending={deleteNoteMutation.isPending}
      />
    </div>
  );
}
