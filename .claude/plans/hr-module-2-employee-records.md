# Implementation Plan: HR Module 2 -- Employee Records & Documents

**Date**: 2026-03-31
**Requested by**: User
**Complexity**: High
**Estimated agents needed**: 4 (database, backend, frontend, qa)
**Branch**: `feat/hr-phase-1` (existing)
**Depends on**: Phase 1 complete (departments, positions, leave management)

---

## 1. Problem Analysis

The users table (`backend/app/Models/User.php`) stores only auth and basic profile data (name, email, role, timezone, avatar, job_title, phone, DOB, DOJ, bio). HR operations need richer employee data: org-assigned employee IDs, department/position assignment, reporting hierarchy, employment status lifecycle (probation, notice period, termination), emergency contacts, financial details (bank, tax), and document management (ID proofs, contracts, certifications with expiry tracking).

**Decision: Separate `employee_profiles` table, NOT additional columns on `users`.**
Rationale: The `users` table is authentication-scoped and already has 20+ columns. HR data is a different bounded context. A 1:1 relationship keeps auth lean and allows the HR module to evolve independently. The `BelongsToOrganization` trait (`backend/app/Models/Traits/BelongsToOrganization.php`) provides automatic org scoping via `GlobalOrganizationScope`.

**Key constraints from existing codebase:**
- Departments use `parent_department_id` (not `parent_id`) as established in `2026_03_31_000001_create_departments_table.php`
- Positions have `department_id` FK with `cascadeOnDelete` and encrypted salary fields
- All models use `HasUuids` trait for UUID PKs
- All org-scoped models use `BelongsToOrganization` trait
- Frontend uses TanStack Query with `queryKey` arrays, Zod v4 for validation, shadcn/ui components
- Sidebar nav is defined in `web/src/app/(dashboard)/layout.tsx` lines 67-101

---

## 2. Scope -- What Changes

| Layer | File | Change Type |
|---|---|---|
| Database | `backend/database/migrations/2026_03_31_000003_create_employee_profiles_table.php` | New migration |
| Database | `backend/database/migrations/2026_03_31_000004_create_employee_documents_table.php` | New migration |
| Database | `backend/database/migrations/2026_03_31_000005_create_employee_notes_table.php` | New migration |
| Backend | `backend/app/Models/EmployeeProfile.php` | New model |
| Backend | `backend/app/Models/EmployeeDocument.php` | New model |
| Backend | `backend/app/Models/EmployeeNote.php` | New model |
| Backend | `backend/app/Models/User.php` | Add relationships: `employeeProfile`, `employeeDocuments`, `employeeNotes` |
| Backend | `backend/app/Enums/EmploymentStatus.php` | New enum |
| Backend | `backend/app/Enums/EmploymentType.php` | New enum |
| Backend | `backend/app/Enums/DocumentCategory.php` | New enum |
| Backend | `backend/app/Services/EmployeeService.php` | New service |
| Backend | `backend/app/Http/Controllers/Api/V1/Hr/EmployeeController.php` | New controller |
| Backend | `backend/app/Http/Controllers/Api/V1/Hr/EmployeeDocumentController.php` | New controller |
| Backend | `backend/app/Http/Controllers/Api/V1/Hr/EmployeeNoteController.php` | New controller |
| Backend | `backend/app/Http/Requests/Hr/UpdateEmployeeProfileRequest.php` | New FormRequest |
| Backend | `backend/app/Http/Requests/Hr/StoreEmployeeDocumentRequest.php` | New FormRequest |
| Backend | `backend/app/Http/Requests/Hr/StoreEmployeeNoteRequest.php` | New FormRequest |
| Backend | `backend/app/Policies/EmployeeProfilePolicy.php` | New policy |
| Backend | `backend/app/Policies/EmployeeDocumentPolicy.php` | New policy |
| Backend | `backend/app/Policies/EmployeeNotePolicy.php` | New policy |
| Backend | `backend/app/Observers/EmployeeProfileObserver.php` | New observer (auto-generate employee_id) |
| Backend | `backend/routes/api.php` | Add employee routes under `hr` prefix |
| Frontend | `web/src/lib/validations/employee.ts` | New validation schemas + types |
| Frontend | `web/src/hooks/hr/use-employees.ts` | New TanStack Query hooks |
| Frontend | `web/src/hooks/hr/use-employee-documents.ts` | New TanStack Query hooks |
| Frontend | `web/src/hooks/hr/use-employee-notes.ts` | New TanStack Query hooks |
| Frontend | `web/src/app/(dashboard)/hr/employees/page.tsx` | New page -- employee directory |
| Frontend | `web/src/app/(dashboard)/hr/employees/[id]/page.tsx` | New page -- employee detail |
| Frontend | `web/src/components/hr/EmployeeProfileForm.tsx` | New component -- profile edit form |
| Frontend | `web/src/components/hr/EmployeeDocumentsTab.tsx` | New component -- documents list + upload |
| Frontend | `web/src/components/hr/EmployeeNotesTab.tsx` | New component -- notes list + create |
| Frontend | `web/src/components/hr/EmployeeDirectoryFilters.tsx` | New component -- search + filters |
| Frontend | `web/src/components/hr/DocumentUploadDialog.tsx` | New component -- upload dialog |
| Frontend | `web/src/app/(dashboard)/layout.tsx` | Add "Employees" nav item to HR group |

---

## 3. Database Schema

### Migration 1: `2026_03_31_000003_create_employee_profiles_table.php`

```php
Schema::create('employee_profiles', function (Blueprint $table) {
    $table->uuid('id')->primary();
    $table->foreignUuid('organization_id')->constrained()->cascadeOnDelete();
    $table->foreignUuid('user_id')->constrained()->cascadeOnDelete();
    $table->string('employee_id', 50)->nullable(); // org-assigned, e.g. EMP-001
    $table->foreignUuid('department_id')->nullable()->constrained()->nullOnDelete();
    $table->foreignUuid('position_id')->nullable()->constrained()->nullOnDelete();
    $table->foreignUuid('reporting_manager_id')->nullable()->constrained('users')->nullOnDelete();

    // Employment lifecycle
    $table->string('employment_status', 20)->default('active');
        // Values: active, probation, notice_period, terminated, resigned
    $table->string('employment_type', 20)->default('full_time');
        // Values: full_time, part_time, contract, intern
    $table->date('date_of_joining')->nullable();
    $table->date('date_of_confirmation')->nullable();
    $table->date('date_of_exit')->nullable();
    $table->date('probation_end_date')->nullable();
    $table->integer('notice_period_days')->default(30);
    $table->string('work_location', 255)->nullable(); // Remote, Office - Sydney, Hybrid

    // Personal
    $table->string('gender', 20)->nullable();
    $table->string('marital_status', 20)->nullable();
    $table->string('nationality', 100)->nullable();
    $table->string('blood_group', 10)->nullable();

    // Emergency contact
    $table->string('emergency_contact_name', 255)->nullable();
    $table->string('emergency_contact_phone', 30)->nullable();
    $table->string('emergency_contact_relation', 50)->nullable();

    // Financial (encrypted at rest via Eloquent encrypted cast)
    $table->text('bank_name')->nullable();
    $table->text('bank_account_number')->nullable();
    $table->text('bank_routing_number')->nullable();
    $table->text('tax_id')->nullable(); // TFN in AU, SSN in US

    // Address
    $table->text('current_address')->nullable();
    $table->text('permanent_address')->nullable();

    // Extensibility
    $table->json('custom_fields')->nullable();

    $table->timestamps();

    // Constraints
    $table->unique(['organization_id', 'user_id']);
    $table->unique(['organization_id', 'employee_id']);

    // Query indexes
    $table->index(['organization_id', 'department_id']);
    $table->index(['organization_id', 'employment_status']);
    $table->index(['organization_id', 'employment_type']);
    $table->index(['organization_id', 'reporting_manager_id']);
});
```

**Notes:**
- `date_of_joining` is on employee_profiles (not users.date_of_joining) because the users table field is auth/onboarding context. The employee_profiles field is HR-canonical. The observer will copy `users.date_of_joining` into `employee_profiles.date_of_joining` on profile creation if it exists.
- Financial fields use `text` column type with `encrypted` cast (same pattern as `positions.min_salary` / `positions.max_salary`).
- No soft deletes -- profile lifecycle is tracked via `employment_status`. Deleting a user cascades.

### Migration 2: `2026_03_31_000004_create_employee_documents_table.php`

```php
Schema::create('employee_documents', function (Blueprint $table) {
    $table->uuid('id')->primary();
    $table->foreignUuid('organization_id')->constrained()->cascadeOnDelete();
    $table->foreignUuid('user_id')->constrained()->cascadeOnDelete();
    $table->string('title', 255);
    $table->string('category', 50);
        // Values: id_proof, address_proof, education, experience, contract, tax, medical, visa, certification, other
    $table->string('file_path', 500); // S3 path: documents/{org_id}/{user_id}/{uuid}.ext
    $table->string('file_name', 255); // original filename for download
    $table->unsignedInteger('file_size'); // bytes
    $table->string('mime_type', 100);
    $table->date('expiry_date')->nullable();
    $table->boolean('is_verified')->default(false);
    $table->foreignUuid('verified_by')->nullable()->constrained('users')->nullOnDelete();
    $table->timestamp('verified_at')->nullable();
    $table->foreignUuid('uploaded_by')->constrained('users')->cascadeOnDelete();
    $table->text('notes')->nullable();
    $table->timestamps();
    $table->softDeletes();

    // Query indexes
    $table->index(['organization_id', 'user_id']);
    $table->index(['organization_id', 'category']);
    $table->index(['organization_id', 'expiry_date']); // for expiring documents query
});
```

**Notes:**
- Soft deletes enabled -- documents should never be truly gone for compliance/audit.
- `uploaded_by` tracks who uploaded (could be admin uploading for employee).
- `file_path` follows S3 convention: `documents/{org_id}/{user_id}/{uuid}.{ext}`. Same bucket as screenshots but under `/documents/` prefix.
- Allowed MIME types enforced at validation layer: `application/pdf`, `image/jpeg`, `image/png`, `image/webp`, `application/msword`, `application/vnd.openxmlformats-officedocument.wordprocessingml.document`.
- Max file size: 10MB.

### Migration 3: `2026_03_31_000005_create_employee_notes_table.php`

```php
Schema::create('employee_notes', function (Blueprint $table) {
    $table->uuid('id')->primary();
    $table->foreignUuid('organization_id')->constrained()->cascadeOnDelete();
    $table->foreignUuid('user_id')->constrained()->cascadeOnDelete(); // the employee
    $table->foreignUuid('author_id')->constrained('users')->cascadeOnDelete(); // who wrote it
    $table->text('content');
    $table->boolean('is_confidential')->default(false);
    $table->timestamps();
    $table->softDeletes();

    // Query indexes
    $table->index(['organization_id', 'user_id']);
    $table->index(['organization_id', 'author_id']);
});
```

**Notes:**
- `is_confidential` = true means only owner/admin can see. Regular managers cannot see confidential notes even if they wrote them.
- Soft deletes for audit trail.

---

## 4. API Contract

### 4.1 Employee Directory

#### `GET /api/v1/hr/employees`
**Auth**: Bearer token (Sanctum)
**Roles**: All authenticated org members (basic info). Financial fields filtered by role.
**Query params**:
| Param | Type | Description |
|---|---|---|
| `page` | int | Page number (default 1) |
| `per_page` | int | Items per page (default 25, max 100) |
| `search` | string | Search by name, email, or employee_id |
| `department_id` | uuid | Filter by department |
| `position_id` | uuid | Filter by position |
| `employment_status` | string | Filter by status (active, probation, etc.) |
| `employment_type` | string | Filter by type (full_time, part_time, etc.) |
| `reporting_manager_id` | uuid | Filter by reporting manager |

**Response 200**:
```json
{
  "data": [
    {
      "id": "uuid-of-employee-profile",
      "user_id": "uuid-of-user",
      "employee_id": "EMP-001",
      "name": "John Doe",
      "email": "john@example.com",
      "avatar_url": "https://...",
      "job_title": "Senior Engineer",
      "phone": "+61...",
      "department": {
        "id": "uuid",
        "name": "Engineering",
        "code": "ENG"
      },
      "position": {
        "id": "uuid",
        "title": "Senior Software Engineer",
        "level": "senior"
      },
      "reporting_manager": {
        "id": "uuid",
        "name": "Jane Smith"
      },
      "employment_status": "active",
      "employment_type": "full_time",
      "date_of_joining": "2024-01-15",
      "work_location": "Remote"
    }
  ],
  "meta": {
    "current_page": 1,
    "last_page": 3,
    "per_page": 25,
    "total": 67,
    "from": 1,
    "to": 25
  }
}
```

**Implementation notes:**
- Query joins `users` + `employee_profiles` with eager load of `department`, `position`, `reportingManager`.
- For employees who do NOT yet have an `employee_profiles` row, they still appear in the directory using user data only (department/position/status fields will be null). The service must LEFT JOIN or use a combined query approach.
- Financial fields are NEVER returned from this endpoint.

---

#### `GET /api/v1/hr/employees/{id}`
**Auth**: Bearer token (Sanctum)
**Roles**: All authenticated org members. Field-level visibility:
- Basic info (name, email, department, position, status): everyone
- Personal info (gender, marital status, nationality, blood group): self + owner + admin + manager
- Emergency contact: self + owner + admin + manager
- Financial (bank, tax): self + owner + admin ONLY
- Address: self + owner + admin + manager

**Response 200**:
```json
{
  "data": {
    "id": "uuid-of-employee-profile",
    "user_id": "uuid-of-user",
    "employee_id": "EMP-001",
    "name": "John Doe",
    "email": "john@example.com",
    "avatar_url": "https://...",
    "job_title": "Senior Engineer",
    "phone": "+61...",
    "department": {
      "id": "uuid",
      "name": "Engineering",
      "code": "ENG"
    },
    "position": {
      "id": "uuid",
      "title": "Senior Software Engineer",
      "level": "senior"
    },
    "reporting_manager": {
      "id": "uuid",
      "name": "Jane Smith",
      "email": "jane@example.com"
    },
    "employment_status": "active",
    "employment_type": "full_time",
    "date_of_joining": "2024-01-15",
    "date_of_confirmation": "2024-07-15",
    "date_of_exit": null,
    "probation_end_date": null,
    "notice_period_days": 30,
    "work_location": "Remote",
    "gender": "male",
    "marital_status": "single",
    "nationality": "Australian",
    "blood_group": "O+",
    "emergency_contact_name": "Mary Doe",
    "emergency_contact_phone": "+61...",
    "emergency_contact_relation": "Spouse",
    "bank_name": "Commonwealth Bank",
    "bank_account_number": "****1234",
    "bank_routing_number": "****567",
    "tax_id": "****789",
    "current_address": "123 Main St, Sydney NSW 2000",
    "permanent_address": "456 Home St, Melbourne VIC 3000",
    "custom_fields": {},
    "created_at": "2024-01-15T00:00:00.000000Z",
    "updated_at": "2024-03-01T12:00:00.000000Z"
  }
}
```

**Implementation notes:**
- Financial fields are masked for the `show` endpoint when the viewer is the employee themselves (`****` + last 4 digits). Full values are NEVER returned via API -- they are write-only from the frontend perspective. Admins/owners see masked values too (they can update but not read raw values).
- If no `employee_profiles` row exists for the user, the controller auto-creates one with defaults (via `EmployeeService::getOrCreateProfile()`).

---

#### `PUT /api/v1/hr/employees/{id}/profile`
**Auth**: Bearer token (Sanctum)
**Roles**: Field-level write access:
- Employee (self): personal fields, emergency contact, financial, address
- Manager: cannot update any fields (read-only for direct reports)
- Admin/Owner: all fields including department, position, reporting_manager, employment_status, employment_type, employee_id

**Request** (all fields optional, partial update):
```json
{
  "employee_id": "EMP-042",
  "department_id": "uuid",
  "position_id": "uuid",
  "reporting_manager_id": "uuid",
  "employment_status": "active",
  "employment_type": "full_time",
  "date_of_joining": "2024-01-15",
  "date_of_confirmation": "2024-07-15",
  "date_of_exit": null,
  "probation_end_date": "2024-07-15",
  "notice_period_days": 30,
  "work_location": "Remote",
  "gender": "male",
  "marital_status": "single",
  "nationality": "Australian",
  "blood_group": "O+",
  "emergency_contact_name": "Mary Doe",
  "emergency_contact_phone": "+61400000000",
  "emergency_contact_relation": "Spouse",
  "bank_name": "Commonwealth Bank",
  "bank_account_number": "12345678",
  "bank_routing_number": "063000",
  "tax_id": "123456789",
  "current_address": "123 Main St, Sydney NSW 2000",
  "permanent_address": "456 Home St, Melbourne VIC 3000"
}
```

**Response 200**:
```json
{
  "data": { "...same as GET detail response..." }
}
```

**Response 403** (employee trying to update admin-only fields):
```json
{
  "message": "You do not have permission to update these fields.",
  "errors": {
    "department_id": ["Only administrators can update this field."]
  }
}
```

**Validation rules** (in `UpdateEmployeeProfileRequest`):
```
employee_id       => nullable|string|max:50|unique:employee_profiles,employee_id,{id},id,organization_id,{org_id}
department_id     => nullable|uuid|exists:departments,id
position_id       => nullable|uuid|exists:positions,id
reporting_manager_id => nullable|uuid|exists:users,id
employment_status => nullable|string|in:active,probation,notice_period,terminated,resigned
employment_type   => nullable|string|in:full_time,part_time,contract,intern
date_of_joining   => nullable|date
date_of_confirmation => nullable|date|after_or_equal:date_of_joining
date_of_exit      => nullable|date|after_or_equal:date_of_joining
probation_end_date => nullable|date|after_or_equal:date_of_joining
notice_period_days => nullable|integer|min:0|max:365
work_location     => nullable|string|max:255
gender            => nullable|string|in:male,female,non_binary,prefer_not_to_say
marital_status    => nullable|string|in:single,married,divorced,widowed,prefer_not_to_say
nationality       => nullable|string|max:100
blood_group       => nullable|string|in:A+,A-,B+,B-,AB+,AB-,O+,O-
emergency_contact_name  => nullable|string|max:255
emergency_contact_phone => nullable|string|max:30
emergency_contact_relation => nullable|string|max:50
bank_name             => nullable|string|max:255
bank_account_number   => nullable|string|max:100
bank_routing_number   => nullable|string|max:50
tax_id                => nullable|string|max:100
current_address       => nullable|string|max:2000
permanent_address     => nullable|string|max:2000
```

---

### 4.2 Employee Documents

#### `GET /api/v1/hr/employees/{id}/documents`
**Auth**: Bearer token (Sanctum)
**Roles**: Self (own documents) + owner + admin + manager (direct reports only)

**Query params**:
| Param | Type | Description |
|---|---|---|
| `category` | string | Filter by document category |
| `is_verified` | boolean | Filter by verification status |

**Response 200**:
```json
{
  "data": [
    {
      "id": "uuid",
      "title": "Passport Copy",
      "category": "id_proof",
      "file_name": "passport.pdf",
      "file_size": 524288,
      "mime_type": "application/pdf",
      "expiry_date": "2028-06-15",
      "is_verified": true,
      "verified_by": {
        "id": "uuid",
        "name": "Admin User"
      },
      "verified_at": "2024-02-01T10:00:00.000000Z",
      "uploaded_by": {
        "id": "uuid",
        "name": "John Doe"
      },
      "notes": "Front and back included",
      "download_url": "https://s3-signed-url...",
      "created_at": "2024-01-15T00:00:00.000000Z"
    }
  ],
  "meta": { "current_page": 1, "last_page": 1, "total": 5, "from": 1, "to": 5 }
}
```

**Implementation notes:**
- `file_path` is NEVER returned to the client. Instead, generate a time-limited signed S3 URL and return as `download_url` (15-minute expiry).
- Paginated (default 25 per page).

---

#### `POST /api/v1/hr/employees/{id}/documents`
**Auth**: Bearer token (Sanctum)
**Roles**: Self (upload own) + owner + admin (upload for anyone)
**Content-Type**: `multipart/form-data`

**Request**:
| Field | Type | Required | Description |
|---|---|---|---|
| `file` | file | yes | The document file (max 10MB) |
| `title` | string | yes | Document title |
| `category` | string | yes | One of: id_proof, address_proof, education, experience, contract, tax, medical, visa, certification, other |
| `expiry_date` | date | no | Expiry date (ISO format) |
| `notes` | string | no | Optional notes |

**Response 201**:
```json
{
  "data": {
    "id": "uuid",
    "title": "Passport Copy",
    "category": "id_proof",
    "file_name": "passport.pdf",
    "file_size": 524288,
    "mime_type": "application/pdf",
    "expiry_date": "2028-06-15",
    "is_verified": false,
    "verified_by": null,
    "verified_at": null,
    "uploaded_by": { "id": "uuid", "name": "John Doe" },
    "notes": null,
    "download_url": "https://s3-signed-url...",
    "created_at": "2024-01-15T00:00:00.000000Z"
  }
}
```

**Validation rules** (in `StoreEmployeeDocumentRequest`):
```
file       => required|file|max:10240|mimes:pdf,jpg,jpeg,png,webp,doc,docx
title      => required|string|max:255
category   => required|string|in:id_proof,address_proof,education,experience,contract,tax,medical,visa,certification,other
expiry_date => nullable|date|after:today
notes      => nullable|string|max:2000
```

---

#### `POST /api/v1/hr/employees/{id}/documents/{docId}/verify`
**Auth**: Bearer token (Sanctum)
**Roles**: Owner + Admin only

**Response 200**:
```json
{
  "data": {
    "...document with is_verified: true, verified_by, verified_at..."
  }
}
```

---

#### `DELETE /api/v1/hr/employees/{id}/documents/{docId}`
**Auth**: Bearer token (Sanctum)
**Roles**: Self (own uploaded) + owner + admin

**Response 200**:
```json
{
  "message": "Document deleted."
}
```

**Implementation notes:**
- Soft delete only. File remains on S3.
- Does NOT delete the S3 file -- a scheduled cleanup job can handle orphaned files later.

---

### 4.3 Employee Notes

#### `GET /api/v1/hr/employees/{id}/notes`
**Auth**: Bearer token (Sanctum)
**Roles**: Owner + Admin only. Managers can see non-confidential notes for direct reports.

**Response 200**:
```json
{
  "data": [
    {
      "id": "uuid",
      "content": "Excellent performance this quarter. Recommended for promotion.",
      "is_confidential": false,
      "author": {
        "id": "uuid",
        "name": "Admin User"
      },
      "created_at": "2024-03-01T10:00:00.000000Z",
      "updated_at": "2024-03-01T10:00:00.000000Z"
    }
  ],
  "meta": { "current_page": 1, "last_page": 1, "total": 3, "from": 1, "to": 3 }
}
```

---

#### `POST /api/v1/hr/employees/{id}/notes`
**Auth**: Bearer token (Sanctum)
**Roles**: Owner + Admin + Manager (manager can only write non-confidential notes for direct reports)

**Request**:
```json
{
  "content": "Discussed career development plan. Employee interested in team lead role.",
  "is_confidential": false
}
```

**Response 201**:
```json
{
  "data": {
    "id": "uuid",
    "content": "...",
    "is_confidential": false,
    "author": { "id": "uuid", "name": "Admin User" },
    "created_at": "2024-03-01T10:00:00.000000Z",
    "updated_at": "2024-03-01T10:00:00.000000Z"
  }
}
```

**Validation rules** (in `StoreEmployeeNoteRequest`):
```
content         => required|string|max:10000
is_confidential => sometimes|boolean
```

---

#### `DELETE /api/v1/hr/employees/{id}/notes/{noteId}`
**Auth**: Bearer token (Sanctum)
**Roles**: Owner + Admin only. Author can delete own notes if created within 24 hours.

**Response 200**:
```json
{
  "message": "Note deleted."
}
```

---

## 5. Frontend Specification

### 5.1 Sidebar Navigation Update

**File**: `web/src/app/(dashboard)/layout.tsx`

Add to the `HR` navGroups section (between "Positions" and "My Leave"):

```typescript
{ name: 'Employees', href: '/hr/employees', icon: Users, roles: ['owner', 'admin', 'manager', 'employee'] },
```

Import note: `Users` icon is already imported (line 16).

---

### 5.2 Validation Schemas & Types

**File**: `web/src/lib/validations/employee.ts`

```typescript
// Types
export interface EmployeeListItem {
  id: string;                    // employee_profile.id
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
  employment_status: string;
  employment_type: string;
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
  bank_account_number: string | null;  // masked
  bank_routing_number: string | null;  // masked
  tax_id: string | null;              // masked
  current_address: string | null;
  permanent_address: string | null;
  custom_fields: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface EmployeeDocument {
  id: string;
  title: string;
  category: string;
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
```

Zod schemas for form validation (profile update form, document upload form, note form).

---

### 5.3 TanStack Query Hooks

**File**: `web/src/hooks/hr/use-employees.ts`

| Hook | Query Key | Endpoint | Notes |
|---|---|---|---|
| `useEmployees(params)` | `['employees', params]` | `GET /hr/employees` | Paginated, filterable |
| `useEmployee(id)` | `['employees', id]` | `GET /hr/employees/{id}` | Single detail |
| `useUpdateEmployeeProfile()` | mutation | `PUT /hr/employees/{id}/profile` | Invalidates `['employees']` + `['employees', id]` |

**File**: `web/src/hooks/hr/use-employee-documents.ts`

| Hook | Query Key | Endpoint |
|---|---|---|
| `useEmployeeDocuments(employeeId)` | `['employee-documents', employeeId]` | `GET /hr/employees/{id}/documents` |
| `useUploadDocument()` | mutation | `POST /hr/employees/{id}/documents` |
| `useVerifyDocument()` | mutation | `POST /hr/employees/{id}/documents/{docId}/verify` |
| `useDeleteDocument()` | mutation | `DELETE /hr/employees/{id}/documents/{docId}` |

**File**: `web/src/hooks/hr/use-employee-notes.ts`

| Hook | Query Key | Endpoint |
|---|---|---|
| `useEmployeeNotes(employeeId)` | `['employee-notes', employeeId]` | `GET /hr/employees/{id}/notes` |
| `useCreateNote()` | mutation | `POST /hr/employees/{id}/notes` |
| `useDeleteNote()` | mutation | `DELETE /hr/employees/{id}/notes/{noteId}` |

All mutations follow the pattern in `web/src/hooks/hr/use-departments.ts`: invalidate query keys on success, `toast.success()` / `toast.error()`.

---

### 5.4 Employee Directory Page

**File**: `web/src/app/(dashboard)/hr/employees/page.tsx`

**Layout:**
- `PageHeader` with title "Employee Directory", description, and no action button (no "Add Employee" -- employees are added via invitations)
- `EmployeeDirectoryFilters` component: search input (debounced 300ms), department select (from `useDepartments`), status select, type select
- View toggle: grid (card) / list (table) -- stored in localStorage
- Table columns: Avatar + Name, Employee ID, Department, Position, Status, Type, Location, Actions (view)
- Grid view: Cards with avatar, name, department, position, status badge
- Pagination (same pattern as departments page)
- Empty state: "No employees found" with appropriate messaging
- Loading: skeleton rows/cards
- Error: error card with retry

**State:**
- Page state: `page`, `search`, `departmentId`, `status`, `type`, `view` (grid/list) -- all via `useState`
- No Zustand store needed -- this is pure server data via TanStack Query

**Roles:**
- All roles see the directory
- Employee sees basic info only (name, department, position)
- Manager/Admin/Owner see all list fields

---

### 5.5 Employee Detail Page

**File**: `web/src/app/(dashboard)/hr/employees/[id]/page.tsx`

**Layout:**
- Header: Avatar, Name, Employee ID, Department, Position, Status Badge, Employment Type Badge
- Tabs (using shadcn Tabs component):
  - **Overview** -- profile summary + edit form
  - **Documents** -- document list + upload
  - **Leave History** -- embed existing leave request list filtered to this user (reuse `useLeaveRequests` with user_id filter, or link to leave page)
  - **Notes** -- admin/owner only tab

**Overview Tab:**
- Read-only sections with "Edit" button that opens inline editing or a sheet
- Sections:
  1. **Employment Info**: Employee ID, Department, Position, Reporting Manager, Status, Type, Join Date, Confirmation Date, Probation End, Work Location
  2. **Personal Info**: Gender, Marital Status, Nationality, Blood Group
  3. **Emergency Contact**: Name, Phone, Relationship
  4. **Financial Info**: Bank Name, Account Number (masked), Routing Number (masked), Tax ID (masked) -- visible only to self + admin
  5. **Address**: Current Address, Permanent Address
- Edit form: `EmployeeProfileForm` component with field-level access control
  - Employee editing own profile: personal, emergency, financial, address sections editable
  - Admin editing: all sections editable

**Documents Tab:**
- `EmployeeDocumentsTab` component
- List of documents in a table: Title, Category (badge), Expiry Date, Verified (badge), Size, Actions (download, verify [admin], delete)
- Upload button opens `DocumentUploadDialog` (sheet with file dropzone, title input, category select, expiry date picker, notes textarea)
- Verify button (admin only): single click with confirmation
- Download: opens signed URL in new tab

**Notes Tab:**
- `EmployeeNotesTab` component
- Only visible to owner/admin (managers see tab but only non-confidential notes)
- List of notes: content, author, date, confidential badge
- Create form: textarea + confidential checkbox + submit button
- Delete: only author (within 24h) or admin

**State:**
- Active tab via URL search param `?tab=overview` (default)
- Profile data via `useEmployee(id)`
- Edit mode via local `useState`

---

### 5.6 Components Breakdown

#### `EmployeeProfileForm`
- Props: `profile: EmployeeDetail`, `canEditAdmin: boolean`, `onSuccess: () => void`
- Form library: React Hook Form + Zod resolver (consistent with how department form works, or use the same Formik+Yup if that is the frontend standard per CLAUDE.md)

**IMPORTANT DECISION**: The `CLAUDE.md` for this project says Zustand + TanStack Query for state/data, and Zod is already used for validations (`web/src/lib/validations/department.ts` uses `z` from `zod/v4`). The departments page uses React Hook Form implicitly via the sheet component. Stick with React Hook Form + Zod (already established in Phase 1).

- Sections rendered as collapsible `Card` components
- Field-level disabled state based on `canEditAdmin` and `isSelf`
- Financial fields show as password-type inputs when editing, with masked values when viewing

#### `DocumentUploadDialog`
- Props: `employeeId: string`, `open: boolean`, `onOpenChange: (open: boolean) => void`
- Uses shadcn `Dialog` component
- File input with drag-and-drop zone
- Shows upload progress
- Category as `Select`, expiry as `DatePicker`

#### `EmployeeDirectoryFilters`
- Props: `onFilterChange: (filters) => void`
- Search: `Input` with debounce
- Department: `Select` populated from `useDepartments({ is_active: true })`
- Status: `Select` with hardcoded options
- Type: `Select` with hardcoded options
- Clear filters button

---

## 6. Desktop Specification

No desktop changes required for this module. The desktop agent is a time-tracking agent only. Employee records are managed exclusively through the web dashboard.

---

## 7. Execution Order

```
Phase 1 (Sequential):
  database-architect
    -> 2026_03_31_000003_create_employee_profiles_table.php
    -> 2026_03_31_000004_create_employee_documents_table.php
    -> 2026_03_31_000005_create_employee_notes_table.php

Phase 2 (Sequential -- after Phase 1):
  backend-engineer
    -> Enums: EmploymentStatus, EmploymentType, DocumentCategory
    -> Models: EmployeeProfile, EmployeeDocument, EmployeeNote
    -> User model: add relationships
    -> Observer: EmployeeProfileObserver (auto-generate employee_id)
    -> Service: EmployeeService
    -> FormRequests: UpdateEmployeeProfileRequest, StoreEmployeeDocumentRequest, StoreEmployeeNoteRequest
    -> Policies: EmployeeProfilePolicy, EmployeeDocumentPolicy, EmployeeNotePolicy
    -> Controllers: EmployeeController, EmployeeDocumentController, EmployeeNoteController
    -> Routes: register in api.php under hr prefix

Phase 3 (Sequential -- after Phase 2):
  frontend-engineer
    -> Validation schemas + types: employee.ts
    -> Hooks: use-employees.ts, use-employee-documents.ts, use-employee-notes.ts
    -> Sidebar nav update in layout.tsx
    -> Components: EmployeeDirectoryFilters, EmployeeProfileForm, EmployeeDocumentsTab, EmployeeNotesTab, DocumentUploadDialog
    -> Pages: /hr/employees/page.tsx, /hr/employees/[id]/page.tsx

Phase 4 (Parallel -- after Phase 3):
  qa-tester -> API integration tests + frontend component tests
  security-engineer -> multi-tenancy audit, financial field encryption, S3 signed URL security

Phase 5 (Sequential -- after Phase 4):
  reviewer -> code quality + architecture compliance review

Phase 6 (Sequential -- after Phase 5):
  docs -> update CLAUDE.md with new models, endpoints, pages
```

---

## 8. Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Cross-tenant data leak on employee directory | Low | Critical | `BelongsToOrganization` trait on all 3 new models. Every controller query MUST scope by `organization_id`. Policy checks `organization_id` match. QA must test cross-org access explicitly. |
| Financial field exposure via API response | Medium | Critical | Encrypted cast on model. `$hidden` array on model excludes raw financial fields. Dedicated response transformer masks values. Never return raw values even to admin -- write-only pattern. |
| S3 document access without authorization | Medium | High | Never expose raw S3 paths. All access via time-limited signed URLs (15 min). Signed URL generation gated behind policy check. S3 bucket has no public access. |
| Employee profile auto-creation race condition | Low | Medium | `firstOrCreate` with `organization_id` + `user_id` unique constraint prevents duplicates. Database-level unique index is the safety net. |
| Large org (500+ employees) directory performance | Medium | Medium | Paginated queries (never `->get()`). Composite indexes on `organization_id` + filter columns. Eager load relationships to prevent N+1. p95 target < 200ms. Test with 500-row seed. |
| Employee ID uniqueness collision | Low | Low | Database unique constraint on `(organization_id, employee_id)`. Auto-generation uses `EMP-{sequential_padded}` with max query + increment, inside a DB transaction. |
| File upload abuse (size/type) | Medium | Medium | Server-side validation: max 10MB, allowed MIME types only. Laravel validates MIME by content inspection, not just extension. Rate limit: 10 uploads per minute per user. |
| Breaking sidebar layout with new nav item | Low | Low | Adding one item to existing HR group. Same pattern as existing entries. |

---

## 9. Definition of Done (QA Criteria)

### Backend
- [ ] `php artisan migrate` runs cleanly; rollback works
- [ ] `GET /api/v1/hr/employees` returns paginated list scoped to organization
- [ ] `GET /api/v1/hr/employees` search by name, email, employee_id works
- [ ] `GET /api/v1/hr/employees` filters by department_id, employment_status, employment_type work
- [ ] `GET /api/v1/hr/employees/{id}` returns full profile with field-level visibility
- [ ] `GET /api/v1/hr/employees/{id}` -- employee sees own data with financial masked
- [ ] `GET /api/v1/hr/employees/{id}` -- employee CANNOT see another employee's personal/financial data
- [ ] `PUT /api/v1/hr/employees/{id}/profile` -- employee can update own personal/emergency/financial/address
- [ ] `PUT /api/v1/hr/employees/{id}/profile` -- employee CANNOT update department_id, position_id, employment_status
- [ ] `PUT /api/v1/hr/employees/{id}/profile` -- admin CAN update all fields
- [ ] `PUT /api/v1/hr/employees/{id}/profile` -- returns 403 with field-level error for unauthorized fields
- [ ] Employee ID auto-generation works (EMP-001, EMP-002, etc.) when not provided
- [ ] Employee ID uniqueness enforced per organization
- [ ] Financial fields stored encrypted in database (verify via raw SQL)
- [ ] `POST /api/v1/hr/employees/{id}/documents` -- upload works with valid file
- [ ] `POST /api/v1/hr/employees/{id}/documents` -- rejects files > 10MB
- [ ] `POST /api/v1/hr/employees/{id}/documents` -- rejects invalid MIME types
- [ ] `GET /api/v1/hr/employees/{id}/documents` -- returns signed download URLs
- [ ] `POST /api/v1/hr/employees/{id}/documents/{docId}/verify` -- admin only
- [ ] `DELETE /api/v1/hr/employees/{id}/documents/{docId}` -- soft deletes
- [ ] `POST /api/v1/hr/employees/{id}/notes` -- admin/owner can create confidential notes
- [ ] `POST /api/v1/hr/employees/{id}/notes` -- manager can create non-confidential notes for direct reports only
- [ ] `GET /api/v1/hr/employees/{id}/notes` -- manager CANNOT see confidential notes
- [ ] `DELETE /api/v1/hr/employees/{id}/notes/{noteId}` -- author can delete within 24h
- [ ] User from Org A CANNOT access employees/documents/notes in Org B (multi-tenancy)
- [ ] All existing tests still pass (`php artisan test`)
- [ ] No new N+1 queries (verify via Telescope or `DB::listen`)

### Frontend
- [ ] Employee Directory page loads with table view by default
- [ ] Search input filters employees by name/email with debounce
- [ ] Department, status, type filters work
- [ ] Grid/list view toggle works and persists in localStorage
- [ ] Pagination works correctly
- [ ] Empty state renders when no employees match filters
- [ ] Error state renders on API failure
- [ ] Loading skeletons render during data fetch
- [ ] Employee detail page loads with Overview tab active
- [ ] Profile edit form respects field-level access (employee vs admin)
- [ ] Financial fields show masked values, editable via password inputs
- [ ] Documents tab shows document list with download links
- [ ] Document upload dialog works (file selection, form fields, submit)
- [ ] Notes tab visible only to admin/owner
- [ ] Notes creation form works
- [ ] Sidebar shows "Employees" link in HR group for all roles
- [ ] No TypeScript errors (`npm run type-check`)
- [ ] Page first paint < 2s on directory with 25 employees

### Security
- [ ] `employee_profiles.bank_account_number`, `bank_routing_number`, `tax_id` encrypted at rest (verify raw DB column is ciphertext)
- [ ] S3 signed URLs expire after 15 minutes
- [ ] No raw file paths exposed in API responses
- [ ] CSRF protection on all mutation endpoints (Sanctum handles this)
- [ ] Rate limiting on document upload endpoint

---

## 10. Employee ID Auto-Generation Logic

The `EmployeeProfileObserver` handles auto-generation when `employee_id` is null on creation:

```
Pattern: EMP-{NNN} (zero-padded to 3+ digits)
Algorithm:
  1. Query max employee_id in the organization matching pattern EMP-\d+
  2. Extract numeric suffix, increment by 1
  3. If no existing IDs, start at 001
  4. Pad to at least 3 digits (EMP-001 through EMP-999, then EMP-1000+)
  5. Wrap in DB transaction to prevent race conditions
  6. If generated ID already exists (race condition), retry up to 3 times with increment
```

---

## 11. S3 Storage Convention

```
Bucket: {EXISTING_SCREENSHOT_BUCKET}
Path:   documents/{organization_id}/{user_id}/{document_uuid}.{extension}

Example: documents/abc123/def456/9a8b7c6d-5e4f-3a2b-1c0d-e9f8a7b6c5d4.pdf
```

- Same bucket as screenshots, different prefix
- `filesystems.php` disk: add `documents` disk or use existing S3 disk with path prefix
- Signed URL generation: `Storage::disk('s3')->temporaryUrl($path, now()->addMinutes(15))`

---

## 12. Open Questions for User

1. **Profile auto-creation timing**: Should employee_profiles be created (a) when a user accepts an invitation, (b) lazily on first access to `/hr/employees/{id}`, or (c) both? Plan assumes (b) lazy creation via `getOrCreateProfile()` for simplicity, but (a) is cleaner for data completeness. Recommendation: implement both -- observer on invitation accept + lazy fallback.

2. **Leave History tab**: Should this embed the actual leave request data inline, or link to the existing `/hr/leave` page filtered by user? Plan assumes inline data display reusing existing `useLeaveRequests` hook with a `user_id` filter param (may require adding that filter to the existing leave API endpoint if not already supported).

3. **Document virus scanning**: The reference plan mentions ClamAV. Should this be a Phase 2 follow-up, or block this module? Recommendation: defer to a follow-up. Upload validation (MIME type + size) is sufficient for initial launch. Add a `scan_status` column later if needed.
