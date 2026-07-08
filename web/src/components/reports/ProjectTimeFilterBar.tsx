"use client";

import { Check, ChevronsUpDown, FolderOpen } from "lucide-react";
import { useState } from "react";

import { useProjectList } from "@/components/time-entries/ProjectCombobox";
import { UserCombobox } from "@/components/time-entries/UserCombobox";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
    Command,
    CommandEmpty,
    CommandGroup,
    CommandInput,
    CommandItem,
    CommandList,
} from "@/components/ui/command";
import { DatePicker } from "@/components/ui/date-picker";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
    Popover,
    PopoverContent,
    PopoverTrigger,
} from "@/components/ui/popover";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import type {
    ProjectTimeFilters,
    ProjectTimePeriod,
} from "@/hooks/reports/use-project-time-report";
import { cn } from "@/lib/utils";

interface ProjectTimeFilterBarProps {
    filters: ProjectTimeFilters;
    onChange: (patch: Partial<ProjectTimeFilters>) => void;
}

/** Multi-select project picker (checkbox list in a popover). */
function ProjectMultiSelect({
    value,
    onChange,
}: {
    value: string[];
    onChange: (ids: string[]) => void;
}) {
    const [open, setOpen] = useState(false);
    const { data: projects, isLoading } = useProjectList();

    const toggle = (id: string) => {
        onChange(
            value.includes(id) ? value.filter((v) => v !== id) : [...value, id],
        );
    };

    const label =
        value.length === 0
            ? "All projects"
            : value.length === 1
              ? (projects?.find((p) => p.id === value[0])?.name ?? "1 project")
              : `${value.length} projects`;

    return (
        <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger
                render={
                    <Button
                        variant="outline"
                        role="combobox"
                        aria-expanded={open}
                        aria-label="Filter by project"
                        className={cn(
                            "w-full justify-between font-normal",
                            value.length === 0 && "text-muted-foreground",
                        )}
                    />
                }
            >
                <span className="flex min-w-0 items-center gap-2 truncate">
                    <FolderOpen className="size-3.5 shrink-0 opacity-60" />
                    <span className="truncate">{label}</span>
                </span>
                <ChevronsUpDown className="size-3.5 shrink-0 opacity-50" />
            </PopoverTrigger>
            <PopoverContent
                className="w-[var(--anchor-width)] p-0"
                align="start"
            >
                <Command>
                    <CommandInput placeholder="Search projects..." />
                    <CommandList>
                        <CommandEmpty>
                            {isLoading ? "Loading..." : "No projects found."}
                        </CommandEmpty>
                        <CommandGroup>
                            {projects?.map((p) => {
                                const checked = value.includes(p.id);
                                return (
                                    <CommandItem
                                        key={p.id}
                                        value={p.name}
                                        onSelect={() => toggle(p.id)}
                                    >
                                        <div
                                            className={cn(
                                                "flex size-4 items-center justify-center rounded-sm border",
                                                checked
                                                    ? "border-primary bg-primary text-primary-foreground"
                                                    : "border-input",
                                            )}
                                        >
                                            {checked && (
                                                <Check className="size-3" />
                                            )}
                                        </div>
                                        <span className="ml-2 flex items-center gap-2 truncate">
                                            <span
                                                className="size-2 shrink-0 rounded-full"
                                                style={{
                                                    backgroundColor:
                                                        p.color || "#6366f1",
                                                }}
                                            />
                                            <span className="truncate">
                                                {p.name}
                                            </span>
                                        </span>
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

export function ProjectTimeFilterBar({
    filters,
    onChange,
}: ProjectTimeFilterBarProps) {
    return (
        <div className="flex flex-col gap-4 rounded-lg border border-border bg-card p-4">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:flex-wrap">
                {/* Project (multi) */}
                <div className="flex w-full flex-col gap-1.5 lg:w-64">
                    <Label>Projects</Label>
                    <ProjectMultiSelect
                        value={filters.project_ids}
                        onChange={(ids) =>
                            onChange({
                                project_ids: ids,
                                // Resource list is project-scoped — reset so a
                                // previously picked user isn't left selected after
                                // they fall out of the new member set.
                                user_id: null,
                            })
                        }
                    />
                </div>

                {/* Resource — members of selected projects only (all users if none) */}
                <div className="flex w-full flex-col gap-1.5 lg:w-56">
                    <Label>Resource</Label>
                    <UserCombobox
                        value={filters.user_id}
                        onChange={(v) => onChange({ user_id: v })}
                        placeholder="All resources"
                        projectIds={filters.project_ids}
                    />
                </div>

                {/* Period */}
                <div className="flex flex-col gap-1.5">
                    <Label>Period</Label>
                    <ToggleGroup
                        value={[filters.period]}
                        onValueChange={(val) => {
                            const v = val[0];
                            if (
                                v === "week" ||
                                v === "month" ||
                                v === "custom"
                            ) {
                                onChange({ period: v as ProjectTimePeriod });
                            }
                        }}
                        variant="outline"
                        className="w-fit"
                    >
                        <ToggleGroupItem value="week">Week</ToggleGroupItem>
                        <ToggleGroupItem value="month">Month</ToggleGroupItem>
                        <ToggleGroupItem value="custom">Custom</ToggleGroupItem>
                    </ToggleGroup>
                </div>

                {/* Period-specific date inputs */}
                {filters.period === "week" && (
                    <div className="flex flex-col gap-1.5">
                        <Label>Week of</Label>
                        <DatePicker
                            value={filters.week_of}
                            onChange={(v) => onChange({ week_of: v })}
                            placeholder="Pick a week"
                        />
                    </div>
                )}

                {filters.period === "month" && (
                    <div className="flex flex-col gap-1.5">
                        <Label htmlFor="month">Month</Label>
                        <Input
                            id="month"
                            type="month"
                            value={filters.month}
                            onChange={(e) =>
                                onChange({ month: e.target.value })
                            }
                            className="w-[180px]"
                        />
                    </div>
                )}

                {filters.period === "custom" && (
                    <div className="flex flex-col gap-1.5">
                        <Label>Date range</Label>
                        <div className="flex items-center gap-2">
                            <DatePicker
                                value={filters.start_date}
                                onChange={(v) => onChange({ start_date: v })}
                                placeholder="Start date"
                            />
                            <span className="text-sm text-muted-foreground">
                                to
                            </span>
                            <DatePicker
                                value={filters.end_date}
                                onChange={(v) => onChange({ end_date: v })}
                                placeholder="End date"
                            />
                        </div>
                    </div>
                )}
            </div>

            <div className="flex items-start gap-3 border-t border-border pt-4">
                <Checkbox
                    id="group-by-day"
                    checked={filters.group_by_day}
                    onCheckedChange={(checked) =>
                        onChange({ group_by_day: checked === true })
                    }
                />
                <div className="grid gap-1 leading-none">
                    <Label
                        htmlFor="group-by-day"
                        className="cursor-pointer font-medium"
                    >
                        Sum time by day
                    </Label>
                    <p className="text-xs text-muted-foreground">
                        One row per employee, project, and day with summed
                        duration. Applies to the table, CSV, and PDF exports.
                    </p>
                </div>
            </div>
        </div>
    );
}
