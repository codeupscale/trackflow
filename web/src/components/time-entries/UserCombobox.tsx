"use client";

import { useQuery } from "@tanstack/react-query";
import { ChevronsUpDown, X } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import {
    Command,
    CommandEmpty,
    CommandGroup,
    CommandInput,
    CommandItem,
    CommandList,
} from "@/components/ui/command";
import {
    Popover,
    PopoverContent,
    PopoverTrigger,
} from "@/components/ui/popover";
import api from "@/lib/api";
import { cn } from "@/lib/utils";

export interface TeamUser {
    id: string;
    name: string;
    email: string;
}

/** Roles that can act as a reporting / project manager (excludes employees). */
export const MANAGER_ROLES = [
    "owner",
    "org_manager",
    "hr_manager",
    "finance_manager",
    "admin",
    "manager",
] as const;

interface UserListOptions {
    /**
     * Restrict the list to members of these projects via
     * `GET /users?project_id[]=...`. Empty/undefined = all org members.
     */
    projectIds?: string[];
    /** Restrict the list to these roles via `GET /users?role[]=...`. */
    roles?: readonly string[];
    enabled?: boolean;
}

/**
 * Shared team-member list query backed by `GET /users` (scoped server-side to what
 * the caller may see). Cached under a stable key so the single- and multi-select
 * pickers for the same project/role slice share one fetch.
 */
export function useUserList({
    projectIds,
    roles,
    enabled = true,
}: UserListOptions = {}) {
    // Stable sorted keys so parent re-renders with a new array reference don't refetch.
    const projectKey =
        projectIds && projectIds.length > 0
            ? [...projectIds].sort().join(",")
            : "";
    const rolesKey =
        roles && roles.length > 0 ? [...roles].sort().join(",") : "";

    return useQuery<TeamUser[]>({
        queryKey: ["team-users", projectKey, rolesKey],
        queryFn: async () => {
            const params: Record<string, string | number | string[]> = {
                per_page: 100,
            };
            if (projectIds && projectIds.length > 0) {
                params.project_id = projectIds;
            }
            if (roles && roles.length > 0) {
                params.role = [...roles];
            }
            const res = await api.get("/users", { params });
            return (
                res.data.users ||
                res.data.data ||
                (Array.isArray(res.data) ? res.data : [])
            );
        },
        enabled,
        staleTime: 5 * 60_000,
    });
}

interface UserComboboxProps {
    /** Selected user id, or null for the placeholder / "no selection" state. */
    value: string | null;
    onChange: (value: string | null) => void;
    placeholder?: string;
    disabled?: boolean;
    /** Only fetch the user list when the picker is actually usable. */
    enabled?: boolean;
    /** User ids to omit from the list (e.g. prevent self-selection as manager). */
    excludeUserIds?: string[];
    /**
     * When set, restricts the list to members of these projects via
     * `GET /users?project_id[]=...`. Empty array = all org members (unfiltered).
     */
    projectIds?: string[];
    /**
     * When set, restricts the list to these roles via `GET /users?role[]=...`.
     * Use `MANAGER_ROLES` for reporting-manager pickers.
     */
    roles?: readonly string[];
}

/**
 * Team-member picker backed by `GET /users` — the same source the Time Entries and
 * Reports pages use for member selection (scoped server-side to what the caller may
 * see). Reused for on-behalf manual entries and the project-time report resource
 * filter. Clearable back to null. Pass `projectIds` / `roles` to narrow the list.
 */
export function UserCombobox({
    value,
    onChange,
    placeholder = "Select member",
    disabled = false,
    enabled = true,
    excludeUserIds = [],
    projectIds,
    roles,
}: UserComboboxProps) {
    const [open, setOpen] = useState(false);
    const { data: users, isLoading } = useUserList({
        projectIds,
        roles,
        enabled,
    });

    const selected = users?.find((u) => u.id === value) ?? null;
    const exclude = new Set(excludeUserIds);
    const visibleUsers = users?.filter((u) => !exclude.has(u.id)) ?? [];

    return (
        <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger
                disabled={disabled}
                render={
                    <Button
                        variant="outline"
                        role="combobox"
                        aria-expanded={open}
                        aria-label="Select member"
                        className={cn(
                            "w-full justify-between font-normal",
                            !value && "text-muted-foreground",
                        )}
                    />
                }
            >
                <span className="truncate">
                    {selected ? selected.name : placeholder}
                </span>
                <div className="flex shrink-0 items-center gap-1">
                    {value && (
                        <span
                            role="button"
                            tabIndex={0}
                            className="rounded-sm opacity-70 hover:opacity-100"
                            aria-label="Clear selection"
                            onClick={(e) => {
                                e.stopPropagation();
                                onChange(null);
                            }}
                            onKeyDown={(e) => {
                                if (e.key === "Enter" || e.key === " ") {
                                    e.stopPropagation();
                                    onChange(null);
                                }
                            }}
                        >
                            <X className="size-3.5" />
                        </span>
                    )}
                    <ChevronsUpDown className="size-3.5 opacity-50" />
                </div>
            </PopoverTrigger>
            <PopoverContent
                className="w-[var(--anchor-width)] p-0"
                align="start"
            >
                <Command>
                    <CommandInput placeholder="Search members..." />
                    <CommandList>
                        <CommandEmpty>
                            {isLoading ? "Loading..." : "No members found."}
                        </CommandEmpty>
                        <CommandGroup>
                            {visibleUsers.map((u) => (
                                <CommandItem
                                    key={u.id}
                                    value={`${u.name} ${u.email}`}
                                    data-checked={
                                        value === u.id ? "true" : undefined
                                    }
                                    onSelect={() => {
                                        onChange(u.id === value ? null : u.id);
                                        setOpen(false);
                                    }}
                                >
                                    <div className="flex min-w-0 flex-col">
                                        <span className="truncate">
                                            {u.name}
                                        </span>
                                        <span className="truncate text-xs text-muted-foreground">
                                            {u.email}
                                        </span>
                                    </div>
                                </CommandItem>
                            ))}
                        </CommandGroup>
                    </CommandList>
                </Command>
            </PopoverContent>
        </Popover>
    );
}
