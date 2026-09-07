import api from "@/lib/api";
import type {
    EmployeeDetail,
    EmployeeListItem,
    EmployeeProfileInput,
} from "@/lib/validations/employee";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

interface PaginatedResponse<T> {
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

export interface UseEmployeesParams {
    search?: string;
    department_id?: string;
    /** Filter to the people on one shift — how a team is picked out. */
    shift_id?: string;
    employment_status?: string;
    employment_type?: string;
    /** Archive tab: list archived (is_active=false) employees instead of active ones. */
    archived?: boolean;
    page?: number;
    per_page?: number;
}

export function useEmployees(params?: UseEmployeesParams) {
    return useQuery<PaginatedResponse<EmployeeListItem>>({
        queryKey: ["employees", params],
        queryFn: async () => {
            const queryParams: Record<string, string | number> = {};
            if (params?.page) queryParams.page = params.page;
            if (params?.per_page) queryParams.per_page = params.per_page;
            if (params?.search) queryParams.search = params.search;
            if (params?.department_id)
                queryParams.department_id = params.department_id;
            if (params?.shift_id) queryParams.shift_id = params.shift_id;
            if (params?.employment_status && params.employment_status !== "all")
                queryParams.employment_status = params.employment_status;
            if (params?.employment_type && params.employment_type !== "all")
                queryParams.employment_type = params.employment_type;
            if (params?.archived) queryParams.archived = 1;
            const res = await api.get("/hr/employees", { params: queryParams });
            const raw = res.data;
            // Laravel returns flat pagination; normalize to {data, meta} format
            return {
                data: raw.data ?? [],
                meta: raw.meta ?? {
                    current_page: raw.current_page ?? 1,
                    last_page: raw.last_page ?? 1,
                    per_page: raw.per_page ?? 25,
                    total: raw.total ?? 0,
                    from: raw.from ?? null,
                    to: raw.to ?? null,
                },
            };
        },
    });
}

export function useEmployee(id: string | undefined) {
    return useQuery<{ data: EmployeeDetail }>({
        queryKey: ["employees", id],
        queryFn: async () => {
            const res = await api.get(`/hr/employees/${id}`);
            return res.data;
        },
        enabled: !!id,
    });
}

export function useUpdateEmployeeProfile() {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: async ({
            id,
            data,
        }: {
            id: string;
            data: EmployeeProfileInput;
        }) => {
            const res = await api.put(`/hr/employees/${id}/profile`, data);
            return res.data;
        },
        onSuccess: (response, variables) => {
            queryClient.setQueryData(
                ["employees", variables.id],
                (old: { data: EmployeeDetail } | undefined) => {
                    if (!old?.data) return response;
                    return { data: { ...old.data, ...response.data } };
                },
            );
            queryClient.invalidateQueries({ queryKey: ["employees"] });
            queryClient.invalidateQueries({
                queryKey: ["employees", variables.id],
            });
            // The form can also reassign the employee's shift, which the Shift
            // Assignment screen and the check-in schedule both read.
            queryClient.invalidateQueries({ queryKey: ["shift-assignments"] });
            queryClient.invalidateQueries({ queryKey: ["attendance", "today"] });
            toast.success("Profile updated successfully");
        },
        onError: (err: Error) => {
            toast.error(err.message || "Failed to update profile");
        },
    });
}

/**
 * Archive employees — "these people have left".
 *
 * Hides them from every list in the product, revokes their tokens so a running
 * desktop agent stops tracking, and closes anything still open in their name.
 * Reversible via useRestoreEmployees.
 */
export function useArchiveEmployees() {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: async (userIds: string[]) => {
            const res = await api.post("/hr/employees/archive", {
                user_ids: userIds,
            });
            return res.data as { archived: number; message: string };
        },
        onSuccess: (data) => {
            // Archiving changes headcount, pickers, payroll rosters and the
            // dashboard team, so the whole people surface is invalidated
            // rather than just the directory the action was fired from.
            invalidatePeopleSurface(queryClient);
            toast.success(data.message);
        },
        onError: (err: Error) => {
            toast.error(err.message || "Failed to archive employees");
        },
    });
}

/** Bring archived employees back into the active directory. */
export function useRestoreEmployees() {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: async (userIds: string[]) => {
            const res = await api.post("/hr/employees/restore", {
                user_ids: userIds,
            });
            return res.data as { restored: number; message: string };
        },
        onSuccess: (data) => {
            invalidatePeopleSurface(queryClient);
            toast.success(data.message);
        },
        onError: (err: Error) => {
            toast.error(err.message || "Failed to restore employees");
        },
    });
}

/** Every cached list whose contents depend on who is active. */
function invalidatePeopleSurface(queryClient: ReturnType<typeof useQueryClient>) {
    [
        "employees",
        "users",
        "user-list",
        "team",
        "dashboard",
        "payslips",
        "salary-roster",
        "attendance",
        "shift-assignments",
    ].forEach((key) => queryClient.invalidateQueries({ queryKey: [key] }));
}
