'use client';

import { useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  ArrowLeft,
  Pencil,
  Upload,
  Plus,
  Trash2,
  Loader2,
  Lock,
  Mail,
  Phone,
  MapPin,
  Calendar,
  Briefcase,
  Building2,
  UserRound,
  Heart,
  Globe,
  Droplets,
  AlertTriangle,
  Banknote,
  StickyNote,
} from 'lucide-react';

import { useAuthStore } from '@/stores/auth-store';
import { useEmployee } from '@/hooks/hr/use-employees';
import { useEmployeeDocuments, useUploadDocument, useVerifyDocument, useDeleteDocument } from '@/hooks/hr/use-employee-documents';
import { useEmployeeNotes, useCreateNote, useDeleteNote } from '@/hooks/hr/use-employee-notes';
import { useLeaveRequests } from '@/hooks/hr/use-leave-requests';
import type { EmployeeDetail } from '@/lib/validations/employee';
import { employmentStatusLabels, employmentTypeLabels } from '@/lib/validations/employee';
import { employeeNoteSchema, type EmployeeNoteInput } from '@/lib/validations/employee';
import { formatDate } from '@/lib/utils';

import { EmployeeStatusBadge } from '@/components/hr/EmployeeStatusBadge';
import { EmployeeProfileSheet } from '@/components/hr/EmployeeProfileSheet';
import { DocumentListItem } from '@/components/hr/DocumentListItem';
import { DocumentUploadCard } from '@/components/hr/DocumentUploadCard';
import { LeaveStatusBadge } from '@/components/hr/LeaveStatusBadge';
import { ConfirmDialog } from '@/components/common/ConfirmDialog';

import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';

function getInitials(name: string): string {
  return name
    .split(' ')
    .map((n) => n[0])
    .filter(Boolean)
    .slice(0, 2)
    .join('')
    .toUpperCase();
}

// ── Info row helper ──
function InfoRow({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof Calendar;
  label: string;
  value: string | null | undefined;
}) {
  return (
    <div className="flex items-start gap-3 py-2">
      <Icon className="size-4 text-muted-foreground shrink-0 mt-0.5" />
      <div className="min-w-0">
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className="text-sm text-foreground">{value || '--'}</p>
      </div>
    </div>
  );
}

export default function EmployeeDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const { user } = useAuthStore();

  const isAdmin = user?.role === 'owner' || user?.role === 'admin';
  const isManager = user?.role === 'manager';
  const canManage = isAdmin || isManager;

  const employeeId = params.id;
  const { data: employeeData, isLoading, isError } = useEmployee(employeeId);
  const employee = employeeData?.data ?? null;
  const isSelf = employee?.user_id === user?.id;

  // ── State ──
  const [profileSheetOpen, setProfileSheetOpen] = useState(false);
  const [uploadDialogOpen, setUploadDialogOpen] = useState(false);
  const [deleteDocTarget, setDeleteDocTarget] = useState<string | null>(null);
  const [deleteNoteTarget, setDeleteNoteTarget] = useState<string | null>(null);
  const [noteContent, setNoteContent] = useState('');
  const [noteConfidential, setNoteConfidential] = useState(false);

  // ── Documents ──
  const { data: docsData, isLoading: docsLoading } = useEmployeeDocuments(employeeId);
  const uploadMutation = useUploadDocument(employeeId);
  const verifyMutation = useVerifyDocument(employeeId);
  const deleteDocMutation = useDeleteDocument(employeeId);
  const documents = docsData?.data ?? [];

  // ── Notes ──
  const { data: notesData, isLoading: notesLoading } = useEmployeeNotes(
    canManage ? employeeId : undefined
  );
  const createNoteMutation = useCreateNote(employeeId);
  const deleteNoteMutation = useDeleteNote(employeeId);
  const notes = notesData?.data ?? [];

  // ── Leave History ──
  const { data: leaveData, isLoading: leaveLoading } = useLeaveRequests({
    // The leave API is user-scoped on the backend; for viewing another user's leave,
    // we pass it as a filter param if the API supports it
  });
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
        setNoteContent('');
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
      <div className="flex flex-col gap-6">
        <div className="flex items-center gap-4">
          <Skeleton className="size-20 rounded-full" />
          <div className="flex flex-col gap-2">
            <Skeleton className="h-6 w-48" />
            <Skeleton className="h-4 w-64" />
            <Skeleton className="h-5 w-20" />
          </div>
        </div>
        <Skeleton className="h-10 w-full max-w-md" />
        <div className="grid gap-4 md:grid-cols-2">
          <Skeleton className="h-48" />
          <Skeleton className="h-48" />
        </div>
      </div>
    );
  }

  // ── Error state ──
  if (isError || !employee) {
    return (
      <div className="flex flex-col gap-6">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => router.push('/hr/employees')}
        >
          <ArrowLeft data-icon="inline-start" />
          Back to Directory
        </Button>
        <Card className="border-destructive/50">
          <CardContent className="py-16">
            <div className="flex flex-col items-center text-center gap-3">
              <UserRound className="size-10 text-destructive/60" />
              <p className="text-muted-foreground font-medium">
                Failed to load employee profile
              </p>
              <p className="text-sm text-muted-foreground">
                The employee may not exist or you may not have permission to view this profile.
              </p>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  const canEdit = isAdmin || isSelf;
  const canUploadDoc = isAdmin || isSelf;
  const canVerifyDoc = isAdmin;
  const canDeleteDoc = isAdmin;
  // Notes are admin/owner only — matches EmployeeNotePolicy (managers cannot access)
  const canViewNotes = isAdmin;
  const canCreateNotes = isAdmin;

  return (
    <div className="flex flex-col gap-6">
      {/* Back navigation */}
      <Button
        variant="ghost"
        size="sm"
        className="self-start"
        render={<Link href="/hr/employees" />}
      >
        <ArrowLeft data-icon="inline-start" />
        Back to Directory
      </Button>

      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex items-start gap-4">
          <Avatar className="size-20">
            <AvatarImage src={employee.avatar_url ?? undefined} alt={employee.name} />
            <AvatarFallback className="text-2xl">
              {getInitials(employee.name)}
            </AvatarFallback>
          </Avatar>
          <div className="flex flex-col gap-1">
            <h1 className="text-2xl font-bold text-foreground">
              {employee.name}
            </h1>
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Mail className="size-3.5" />
              {employee.email}
            </div>
            {employee.employee_id && (
              <p className="text-xs text-muted-foreground">
                ID: {employee.employee_id}
              </p>
            )}
            <div className="flex items-center gap-2 mt-1">
              <EmployeeStatusBadge status={employee.employment_status} />
              {employee.department && (
                <Badge variant="secondary">{employee.department.name}</Badge>
              )}
            </div>
          </div>
        </div>

        {canEdit && (
          <Button variant="outline" onClick={() => setProfileSheetOpen(true)}>
            <Pencil data-icon="inline-start" />
            Edit Profile
          </Button>
        )}
      </div>

      {/* Tabs */}
      <Tabs defaultValue="overview">
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="documents">Documents</TabsTrigger>
          <TabsTrigger value="leave">Leave History</TabsTrigger>
          {canViewNotes && <TabsTrigger value="notes">Notes</TabsTrigger>}
        </TabsList>

        {/* ─── Overview Tab ─── */}
        <TabsContent value="overview" className="mt-6">
          <div className="grid gap-6 md:grid-cols-2">
            {/* Personal Info */}
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Personal Information</CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col gap-0">
                <InfoRow icon={UserRound} label="Gender" value={employee.gender} />
                <InfoRow icon={Heart} label="Marital Status" value={employee.marital_status} />
                <InfoRow icon={Globe} label="Nationality" value={employee.nationality} />
                <InfoRow icon={Droplets} label="Blood Group" value={employee.blood_group} />
              </CardContent>
            </Card>

            {/* Employment Info */}
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Employment Information</CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col gap-0">
                <InfoRow
                  icon={Briefcase}
                  label="Position"
                  value={employee.position?.title ?? employee.job_title}
                />
                <InfoRow
                  icon={Building2}
                  label="Department"
                  value={employee.department?.name}
                />
                <InfoRow
                  icon={UserRound}
                  label="Reporting Manager"
                  value={employee.reporting_manager?.name}
                />
                <InfoRow
                  icon={Briefcase}
                  label="Employment Type"
                  value={
                    employee.employment_type
                      ? employmentTypeLabels[employee.employment_type]
                      : null
                  }
                />
                <InfoRow
                  icon={Calendar}
                  label="Date of Joining"
                  value={formatDate(employee.date_of_joining)}
                />
                <InfoRow
                  icon={Calendar}
                  label="Confirmation Date"
                  value={formatDate(employee.date_of_confirmation)}
                />
                <InfoRow
                  icon={Calendar}
                  label="Probation End"
                  value={formatDate(employee.probation_end_date)}
                />
                {employee.work_location && (
                  <InfoRow icon={MapPin} label="Work Location" value={employee.work_location} />
                )}
              </CardContent>
            </Card>

            {/* Emergency Contact */}
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Emergency Contact</CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col gap-0">
                <InfoRow
                  icon={UserRound}
                  label="Name"
                  value={employee.emergency_contact_name}
                />
                <InfoRow
                  icon={Phone}
                  label="Phone"
                  value={employee.emergency_contact_phone}
                />
                <InfoRow
                  icon={Heart}
                  label="Relation"
                  value={employee.emergency_contact_relation}
                />
              </CardContent>
            </Card>

            {/* Address */}
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Address</CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col gap-0">
                <InfoRow
                  icon={MapPin}
                  label="Current Address"
                  value={employee.current_address}
                />
                <InfoRow
                  icon={MapPin}
                  label="Permanent Address"
                  value={employee.permanent_address}
                />
              </CardContent>
            </Card>

            {/* Financial Info (admin or self only) */}
            {(isAdmin || isSelf) && (
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Financial Information</CardTitle>
                </CardHeader>
                <CardContent className="flex flex-col gap-0">
                  <InfoRow icon={Banknote} label="Bank Name" value={employee.bank_name} />
                  <InfoRow
                    icon={Banknote}
                    label="Account Number"
                    value={employee.bank_account_number}
                  />
                  <InfoRow
                    icon={Banknote}
                    label="BSB / Routing"
                    value={employee.bank_routing_number}
                  />
                  <InfoRow icon={Banknote} label="Tax File Number" value={employee.tax_id} />
                </CardContent>
              </Card>
            )}
          </div>
        </TabsContent>

        {/* ─── Documents Tab ─── */}
        <TabsContent value="documents" className="mt-6">
          <div className="flex flex-col gap-4">
            {canUploadDoc && (
              <div className="flex justify-end">
                <Button onClick={() => setUploadDialogOpen(true)}>
                  <Upload data-icon="inline-start" />
                  Upload Document
                </Button>
              </div>
            )}

            {docsLoading ? (
              <Card>
                <CardContent className="p-4">
                  <div className="flex flex-col gap-2">
                    {Array.from({ length: 3 }).map((_, i) => (
                      <Skeleton key={i} className="h-16" />
                    ))}
                  </div>
                </CardContent>
              </Card>
            ) : documents.length === 0 ? (
              <Card>
                <CardContent className="py-12">
                  <div className="flex flex-col items-center text-center gap-3">
                    <Upload className="size-10 text-muted-foreground" />
                    <p className="text-muted-foreground font-medium">
                      No documents yet
                    </p>
                    <p className="text-sm text-muted-foreground">
                      {canUploadDoc
                        ? 'Upload documents such as ID proofs, contracts, or certifications.'
                        : 'No documents have been uploaded for this employee.'}
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
        <TabsContent value="leave" className="mt-6">
          {leaveLoading ? (
            <Card>
              <CardContent className="p-4">
                <div className="flex flex-col gap-2">
                  {Array.from({ length: 3 }).map((_, i) => (
                    <Skeleton key={i} className="h-12" />
                  ))}
                </div>
              </CardContent>
            </Card>
          ) : leaveRequests.length === 0 ? (
            <Card>
              <CardContent className="py-12">
                <div className="flex flex-col items-center text-center gap-3">
                  <Calendar className="size-10 text-muted-foreground" />
                  <p className="text-muted-foreground font-medium">
                    No leave history
                  </p>
                  <p className="text-sm text-muted-foreground">
                    Leave requests will appear here.
                  </p>
                  {isSelf && (
                    <Button variant="outline" render={<Link href="/hr/leave" />}>
                      Go to My Leave
                    </Button>
                  )}
                </div>
              </CardContent>
            </Card>
          ) : (
            <Card>
              <CardContent className="p-0">
                {/* Header */}
                <div className="hidden md:grid md:grid-cols-5 gap-4 px-4 py-2.5 text-xs font-medium text-muted-foreground border-b border-border">
                  <span>Leave Type</span>
                  <span>Date Range</span>
                  <span className="text-center">Days</span>
                  <span>Status</span>
                  <span>Submitted</span>
                </div>
                {leaveRequests.map((req, idx) => (
                  <div key={req.id}>
                    {idx > 0 && <Separator />}
                    <div className="grid grid-cols-2 gap-2 px-4 py-3 md:grid-cols-5 md:gap-4 md:items-center">
                      <div className="font-medium text-sm">
                        {req.leave_type.name}
                      </div>
                      <div className="text-xs text-muted-foreground md:text-sm">
                        {formatDate(req.start_date)} &mdash;{' '}
                        {formatDate(req.end_date)}
                      </div>
                      <div className="text-xs text-foreground tabular-nums md:text-center md:text-sm">
                        {req.days_count}
                      </div>
                      <div>
                        <LeaveStatusBadge status={req.status} />
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {formatDate(req.created_at)}
                      </div>
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}

          {isSelf && leaveRequests.length > 0 && (
            <div className="mt-4">
              <Button variant="outline" render={<Link href="/hr/leave" />}>
                View Full Leave Page
              </Button>
            </div>
          )}
        </TabsContent>

        {/* ─── Notes Tab (admin/manager only) ─── */}
        {canViewNotes && (
          <TabsContent value="notes" className="mt-6">
            <div className="flex flex-col gap-4">
              {/* Create note form */}
              {canCreateNotes && (
                <Card>
                  <CardHeader>
                    <CardTitle className="text-base">Add a Note</CardTitle>
                  </CardHeader>
                  <CardContent className="flex flex-col gap-3">
                    <Textarea
                      placeholder="Write a note about this employee..."
                      rows={3}
                      value={noteContent}
                      onChange={(e) => setNoteContent(e.target.value)}
                      aria-label="Note content"
                    />
                    <div className="flex items-center justify-between">
                      <label className="flex items-center gap-2 text-sm text-muted-foreground cursor-pointer">
                        <Switch
                          checked={noteConfidential}
                          onCheckedChange={setNoteConfidential}
                          aria-label="Mark as confidential"
                        />
                        <Lock className="size-3.5" />
                        Confidential
                      </label>
                      <Button
                        size="sm"
                        onClick={handleCreateNote}
                        disabled={
                          !noteContent.trim() || createNoteMutation.isPending
                        }
                      >
                        {createNoteMutation.isPending && (
                          <Loader2
                            data-icon="inline-start"
                            className="animate-spin"
                          />
                        )}
                        <Plus data-icon="inline-start" />
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
                    <div className="flex flex-col gap-2">
                      {Array.from({ length: 3 }).map((_, i) => (
                        <Skeleton key={i} className="h-16" />
                      ))}
                    </div>
                  </CardContent>
                </Card>
              ) : notes.length === 0 ? (
                <Card>
                  <CardContent className="py-12">
                    <div className="flex flex-col items-center text-center gap-3">
                      <StickyNote className="size-10 text-muted-foreground" />
                      <p className="text-muted-foreground font-medium">
                        No notes yet
                      </p>
                      <p className="text-sm text-muted-foreground">
                        Add notes to track important information about this
                        employee.
                      </p>
                    </div>
                  </CardContent>
                </Card>
              ) : (
                <div className="flex flex-col gap-3">
                  {notes.map((note) => (
                    <Card key={note.id}>
                      <CardContent className="py-4">
                        <div className="flex items-start justify-between gap-3">
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 mb-1">
                              <p className="text-sm font-medium text-foreground">
                                {note.author.name}
                              </p>
                              <span className="text-xs text-muted-foreground">
                                {formatDate(note.created_at)}
                              </span>
                              {note.is_confidential && (
                                <Badge
                                  variant="outline"
                                  className="text-[10px] bg-amber-100 text-amber-800 border-amber-200 dark:bg-amber-900/30 dark:text-amber-400 dark:border-amber-800"
                                >
                                  <Lock className="size-2.5 mr-1" />
                                  Confidential
                                </Badge>
                              )}
                            </div>
                            <p className="text-sm text-foreground whitespace-pre-wrap">
                              {note.content}
                            </p>
                          </div>
                          {isAdmin && (
                            <Button
                              variant="ghost"
                              size="sm"
                              className="text-destructive hover:text-destructive shrink-0"
                              onClick={() => setDeleteNoteTarget(note.id)}
                              aria-label={`Delete note by ${note.author.name}`}
                            >
                              <Trash2 />
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
