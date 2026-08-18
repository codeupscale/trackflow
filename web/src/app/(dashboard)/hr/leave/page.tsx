"use client";

import {
    Calendar,
    Loader2,
    Plus,
    Clock,
    CheckCircle2,
    XCircle,
    Hourglass,
} from "lucide-react";
import { useState, useMemo } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
    Dialog,
    DialogClose,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import {
    Pagination,
    PaginationContent,
    PaginationEllipsis,
    PaginationItem,
    PaginationLink,
    PaginationNext,
    PaginationPrevious,
} from "@/components/ui/pagination";
import { Skeleton } from "@/components/ui/skeleton";
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table";

import { ApplyLeaveDialog } from "@/components/hr/ApplyLeaveDialog";
import { LeaveBalanceCard } from "@/components/hr/LeaveBalanceCard";
import { useCancelLeave } from "@/hooks/hr/use-leave-actions";
import { useLeaveBalance } from "@/hooks/hr/use-leave-balance";
import { useLeaveRequests } from "@/hooks/hr/use-leave-requests";
import { formatDate } from "@/lib/utils";
import type { LeaveRequest } from "@/lib/validations/leave";

const statusDot: Record<string, { dot: string; text: string; label: string }> = {
    pending: { dot: "bg-amber-500", text: "text-amber-600 dark:text-amber-400", label: "Pending" },
    approved: { dot: "bg-emerald-500", text: "text-emerald-600 dark:text-emerald-400", label: "Approved" },
    rejected: { dot: "bg-red-500", text: "text-red-600 dark:text-red-400", label: "Rejected" },
    cancelled: { dot: "bg-muted-foreground/40", text: "text-muted-foreground", label: "Cancelled" },
};

export default function MyLeavePage() {
    const [currentPage, setCurrentPage] = useState(1);
    const [cancelTarget, setCancelTarget] = useState<LeaveRequest | null>(null);
    const [applyOpen, setApplyOpen] = useState(false);

    const {
        balances,
        isLoading: balancesLoading,
        isError: balancesError,
    } = useLeaveBalance();
    const {
        data: requestsData,
        isLoading: requestsLoading,
        isError: requestsError,
    } = useLeaveRequests({ page: currentPage });
    const cancelMutation = useCancelLeave();

    const requests = requestsData?.data ?? [];
    const totalPages = requestsData?.last_page ?? 1;

    const stats = useMemo(() => {
        const all = requests;
        return {
            total: requestsData?.total ?? all.length,
            approved: all.filter((r) => r.status === "approved").length,
            pending: all.filter((r) => r.status === "pending").length,
            rejected: all.filter((r) => r.status === "rejected").length,
        };
    }, [requests, requestsData?.total]);

    const handleCancel = () => {
        if (!cancelTarget) return;
        cancelMutation.mutate(cancelTarget.id, {
            onSuccess: () => setCancelTarget(null),
        });
    };

    return (
        <div className="flex flex-col gap-4">
            {/* Header */}
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-lg font-semibold tracking-tight">My Leave</h1>
                    <p className="text-xs text-muted-foreground">
                        View your leave balances and manage requests
                    </p>
                </div>
                <Button
                    size="sm"
                    className="h-8 text-xs"
                    onClick={() => setApplyOpen(true)}
                >
                    <Plus className="h-3.5 w-3.5 mr-1" />
                    Apply for Leave
                </Button>
            </div>

            {/* Stats Strip */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                {[
                    { label: "Total Requests", value: stats.total, icon: Calendar, color: "text-blue-500", bg: "bg-blue-500/10" },
                    { label: "Approved", value: stats.approved, icon: CheckCircle2, color: "text-emerald-500", bg: "bg-emerald-500/10" },
                    { label: "Pending", value: stats.pending, icon: Hourglass, color: "text-amber-500", bg: "bg-amber-500/10" },
                    { label: "Rejected", value: stats.rejected, icon: XCircle, color: "text-red-500", bg: "bg-red-500/10" },
                ].map((s) => (
                    <Card key={s.label} className="border-border">
                        <CardContent className="p-3">
                            <div className="flex items-center gap-2.5">
                                <div className={`flex h-8 w-8 items-center justify-center rounded-lg ${s.bg} shrink-0`}>
                                    <s.icon className={`h-4 w-4 ${s.color}`} />
                                </div>
                                <div className="min-w-0">
                                    <p className="text-[0.65rem] font-medium text-muted-foreground uppercase tracking-wider">{s.label}</p>
                                    <p className="text-base font-bold text-foreground tabular-nums leading-tight">
                                        {requestsLoading ? "--" : s.value}
                                    </p>
                                </div>
                            </div>
                        </CardContent>
                    </Card>
                ))}
            </div>

            {/* Leave Balances */}
            <div>
                <p className="text-[0.6rem] uppercase tracking-wider font-medium text-muted-foreground mb-2.5">
                    Leave Balances
                </p>
                {balancesError ? (
                    <Card>
                        <CardContent className="py-8">
                            <div className="flex flex-col items-center gap-2">
                                <Calendar className="h-8 w-8 text-muted-foreground/40" />
                                <p className="text-sm text-muted-foreground">Failed to load leave balances</p>
                            </div>
                        </CardContent>
                    </Card>
                ) : balancesLoading ? (
                    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                        {Array.from({ length: 4 }).map((_, i) => (
                            <Card key={i}>
                                <CardContent className="p-4">
                                    <Skeleton className="h-20" />
                                </CardContent>
                            </Card>
                        ))}
                    </div>
                ) : !balances || balances.length === 0 ? (
                    <Card>
                        <CardContent className="py-8">
                            <div className="flex flex-col items-center gap-2">
                                <Calendar className="h-8 w-8 text-muted-foreground/40" />
                                <p className="text-sm text-muted-foreground font-medium">No leave types configured yet</p>
                                <p className="text-xs text-muted-foreground">Contact your administrator to set up leave types</p>
                            </div>
                        </CardContent>
                    </Card>
                ) : (
                    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                        {balances.map((balance) => (
                            <LeaveBalanceCard
                                key={balance.leave_type_id}
                                balance={balance}
                            />
                        ))}
                    </div>
                )}
            </div>

            {/* My Requests Table */}
            <div>
                <p className="text-[0.6rem] uppercase tracking-wider font-medium text-muted-foreground mb-2.5">
                    My Requests
                </p>
                {requestsError ? (
                    <Card className="border-destructive/50">
                        <CardContent className="py-12">
                            <div className="flex flex-col items-center gap-2">
                                <Calendar className="h-8 w-8 text-destructive/60" />
                                <p className="text-sm text-muted-foreground font-medium">Failed to load leave requests</p>
                            </div>
                        </CardContent>
                    </Card>
                ) : requestsLoading ? (
                    <Card>
                        <CardContent className="p-0">
                            <div className="flex flex-col">
                                <div className="flex items-center gap-4 px-4 py-2.5 border-b border-border/50">
                                    {Array.from({ length: 5 }).map((_, i) => (
                                        <Skeleton key={i} className="h-3 w-20" />
                                    ))}
                                </div>
                                {Array.from({ length: 4 }).map((_, i) => (
                                    <div key={i} className="flex items-center gap-4 px-4 py-3 border-b border-border/50 last:border-0">
                                        <Skeleton className="h-3.5 w-24" />
                                        <Skeleton className="h-3.5 w-32" />
                                        <Skeleton className="h-3.5 w-10" />
                                        <Skeleton className="h-5 w-16" />
                                        <Skeleton className="h-3.5 w-20" />
                                    </div>
                                ))}
                            </div>
                        </CardContent>
                    </Card>
                ) : requests.length === 0 ? (
                    <Card>
                        <CardContent className="py-12">
                            <div className="flex flex-col items-center text-center gap-2">
                                <Calendar className="h-8 w-8 text-muted-foreground/40" />
                                <p className="text-sm text-muted-foreground font-medium">No leave requests yet</p>
                                <p className="text-xs text-muted-foreground">
                                    Click &quot;Apply for Leave&quot; to submit your first request
                                </p>
                            </div>
                        </CardContent>
                    </Card>
                ) : (
                    <>
                        <Card>
                            <CardContent className="p-0">
                                <div className="overflow-x-auto">
                                    <table className="w-full text-left border-collapse">
                                        <thead>
                                            <tr className="border-b border-border/50">
                                                <th className="text-[0.6rem] uppercase tracking-wider font-medium text-muted-foreground px-4 py-2.5 whitespace-nowrap">Leave Type</th>
                                                <th className="text-[0.6rem] uppercase tracking-wider font-medium text-muted-foreground px-4 py-2.5 whitespace-nowrap">From</th>
                                                <th className="text-[0.6rem] uppercase tracking-wider font-medium text-muted-foreground px-4 py-2.5 whitespace-nowrap">To</th>
                                                <th className="text-[0.6rem] uppercase tracking-wider font-medium text-muted-foreground px-4 py-2.5 whitespace-nowrap text-center">Days</th>
                                                <th className="text-[0.6rem] uppercase tracking-wider font-medium text-muted-foreground px-4 py-2.5 whitespace-nowrap">Status</th>
                                                <th className="text-[0.6rem] uppercase tracking-wider font-medium text-muted-foreground px-4 py-2.5 whitespace-nowrap">Applied On</th>
                                                <th className="text-[0.6rem] uppercase tracking-wider font-medium text-muted-foreground px-4 py-2.5 whitespace-nowrap text-right">Action</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {requests.map((req) => {
                                                const sd = statusDot[req.status] ?? statusDot.pending;
                                                return (
                                                    <tr key={req.id} className="border-b border-border/30 last:border-0 hover:bg-muted/30 transition-colors">
                                                        <td className="px-4 py-2.5 whitespace-nowrap">
                                                            <span className="text-[0.75rem] font-medium">{req.leave_type.name}</span>
                                                        </td>
                                                        <td className="px-4 py-2.5 whitespace-nowrap text-[0.75rem] text-muted-foreground">
                                                            {formatDate(req.start_date)}
                                                        </td>
                                                        <td className="px-4 py-2.5 whitespace-nowrap text-[0.75rem] text-muted-foreground">
                                                            {formatDate(req.end_date)}
                                                        </td>
                                                        <td className="px-4 py-2.5 whitespace-nowrap text-center">
                                                            <span className="text-[0.75rem] font-semibold tabular-nums">
                                                                {Number(req.days_count) % 1 === 0 ? Math.round(Number(req.days_count)) : req.days_count}
                                                            </span>
                                                        </td>
                                                        <td className="px-4 py-2.5 whitespace-nowrap">
                                                            <span className={`inline-flex items-center gap-1.5 text-[0.7rem] font-medium ${sd.text}`}>
                                                                <span className={`inline-block w-1.5 h-1.5 rounded-full ${sd.dot}`} />
                                                                {sd.label}
                                                            </span>
                                                        </td>
                                                        <td className="px-4 py-2.5 whitespace-nowrap text-[0.75rem] text-muted-foreground">
                                                            {formatDate(req.created_at)}
                                                        </td>
                                                        <td className="px-4 py-2.5 whitespace-nowrap text-right">
                                                            {req.status === "pending" ? (
                                                                <Button
                                                                    variant="ghost"
                                                                    size="sm"
                                                                    className="h-6 px-2 text-[0.65rem] text-destructive hover:text-destructive"
                                                                    onClick={() => setCancelTarget(req)}
                                                                >
                                                                    Cancel
                                                                </Button>
                                                            ) : (
                                                                <span className="text-[0.65rem] text-muted-foreground/50">&mdash;</span>
                                                            )}
                                                        </td>
                                                    </tr>
                                                );
                                            })}
                                        </tbody>
                                    </table>
                                </div>
                            </CardContent>
                        </Card>

                        {totalPages > 1 && (
                            <div className="flex items-center justify-between mt-1">
                                <p className="text-[0.65rem] text-muted-foreground">
                                    Page {currentPage} of {totalPages}
                                </p>
                                <Pagination>
                                    <PaginationContent>
                                        <PaginationItem>
                                            <PaginationPrevious
                                                onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                                                aria-disabled={currentPage === 1}
                                                className={currentPage === 1 ? "pointer-events-none opacity-50" : "cursor-pointer"}
                                            />
                                        </PaginationItem>
                                        {Array.from({ length: totalPages }, (_, i) => i + 1)
                                            .filter((p) => p === 1 || p === totalPages || Math.abs(p - currentPage) <= 1)
                                            .reduce((acc, p, idx, arr) => {
                                                if (idx > 0 && p - arr[idx - 1] > 1) acc.push(-1);
                                                acc.push(p);
                                                return acc;
                                            }, [] as number[])
                                            .map((p, idx) =>
                                                p === -1 ? (
                                                    <PaginationItem key={`e-${idx}`}>
                                                        <PaginationEllipsis />
                                                    </PaginationItem>
                                                ) : (
                                                    <PaginationItem key={p}>
                                                        <PaginationLink
                                                            isActive={p === currentPage}
                                                            onClick={() => setCurrentPage(p)}
                                                            className="cursor-pointer"
                                                        >
                                                            {p}
                                                        </PaginationLink>
                                                    </PaginationItem>
                                                ),
                                            )}
                                        <PaginationItem>
                                            <PaginationNext
                                                onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                                                aria-disabled={currentPage === totalPages}
                                                className={currentPage >= totalPages ? "pointer-events-none opacity-50" : "cursor-pointer"}
                                            />
                                        </PaginationItem>
                                    </PaginationContent>
                                </Pagination>
                            </div>
                        )}
                    </>
                )}
            </div>

            {/* Cancel Confirmation Dialog */}
            <Dialog
                open={!!cancelTarget}
                onOpenChange={(open) => {
                    if (!open) setCancelTarget(null);
                }}
            >
                <DialogContent className="sm:max-w-md">
                    <DialogHeader>
                        <DialogTitle className="text-base">Cancel Leave Request</DialogTitle>
                        <DialogDescription className="text-xs">
                            Are you sure you want to cancel your{" "}
                            <span className="font-medium text-foreground">{cancelTarget?.leave_type.name}</span>{" "}
                            request for {formatDate(cancelTarget?.start_date)} to{" "}
                            {formatDate(cancelTarget?.end_date)}? This action cannot be undone.
                        </DialogDescription>
                    </DialogHeader>
                    <DialogFooter className="gap-2">
                        <DialogClose render={<Button variant="outline" size="sm" />}>
                            Keep Request
                        </DialogClose>
                        <Button
                            variant="destructive"
                            size="sm"
                            onClick={handleCancel}
                            disabled={cancelMutation.isPending}
                        >
                            {cancelMutation.isPending && (
                                <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
                            )}
                            Yes, Cancel
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* Apply Leave Dialog */}
            <ApplyLeaveDialog open={applyOpen} onOpenChange={setApplyOpen} />
        </div>
    );
}
