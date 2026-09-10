import { useCallback, useState } from 'react';
import { toast } from 'sonner';

import api from '@/lib/api';
import { useBulkAssignSalary, type SalaryRosterRow } from '@/hooks/hr/use-salary-roster';
import { useSalaryStructures } from '@/hooks/hr/use-salary-structures';

export type AutoAssignPhase = 'idle' | 'fetching' | 'assigning' | 'done';

/**
 * Give every employee without a salary the grade linked to their designation.
 *
 * Shared by the payroll run card and the salary roster, because both offer an
 * "Assign salaries" button and they must do the same thing — the run card's
 * used to only switch tabs, which is why pressing it appeared to do nothing.
 *
 * No grade is asked for. That decision already lives on the designation, and
 * prompting for one figure to apply to everybody is precisely what this must
 * not encourage. Anyone whose designation has no grade cannot be placed
 * without inventing a salary for them, so they are reported by name instead.
 */
export function useAutoAssignSalaries() {
  const [phase, setPhase] = useState<AutoAssignPhase>('idle');
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [skipped, setSkipped] = useState<string[]>([]);

  const bulkAssign = useBulkAssignSalary();
  const { data: structuresData } = useSalaryStructures({ is_active: true, per_page: 100 });

  const run = useCallback(async () => {
    setPhase('fetching');
    setSkipped([]);

    const structures = structuresData?.data ?? [];

    if (structures.length === 0) {
      toast.error('No salary grades exist yet — create one under Salary Structures first.');
      setPhase('idle');
      return;
    }

    // Read fresh from the directory rather than trusting a cached list: this
    // runs at the start of a payroll month, exactly when someone has just been
    // hired and the cached copy is a person short.
    let directory: SalaryRosterRow[] = [];
    try {
      const res = await api.get('/hr/salary-roster', { params: { per_page: 200 } });
      directory = res.data?.data ?? [];
    } catch {
      toast.error('Could not load employees from the directory.');
      setPhase('idle');
      return;
    }

    const unassigned = directory.filter((r) => !r.assignment);

    if (unassigned.length === 0) {
      toast.success('Everyone already has a salary.');
      setPhase('done');
      return;
    }

    const byStructure = new Map<string, string[]>();
    const missingGrade: string[] = [];

    for (const row of unassigned) {
      const grade = structures.find(
        (s) => row.position?.id && s.position_id === row.position.id,
      );

      if (!grade) {
        missingGrade.push(row.name);
        continue;
      }

      byStructure.set(grade.id, [...(byStructure.get(grade.id) ?? []), row.id]);
    }

    const total = unassigned.length - missingGrade.length;

    if (total === 0) {
      setSkipped(missingGrade);
      setPhase('done');
      toast.error(
        `No designation has a salary grade linked to it. Link grades under Salary Structures, or assign ${missingGrade.length === 1 ? 'this person' : 'these people'} individually.`,
      );
      return;
    }

    setPhase('assigning');
    setProgress({ done: 0, total });

    // Effective from the first of this month, so the assignment covers the
    // period being run rather than starting midway through it.
    const effectiveFrom = new Date();
    effectiveFrom.setDate(1);

    for (const [salary_structure_id, user_ids] of byStructure) {
      try {
        await bulkAssign.mutateAsync({
          user_ids,
          salary_structure_id,
          effective_from: effectiveFrom.toISOString().slice(0, 10),
        });
        setProgress((p) => ({ ...p, done: p.done + user_ids.length }));
      } catch {
        // onError already surfaced the reason; stop rather than press on, so
        // a second identical failure does not bury the first message.
        setPhase('idle');
        return;
      }
    }

    setSkipped(missingGrade);
    setPhase('done');

    // One press, one message — however many grades it took to satisfy it.
    // Anyone skipped is named in the banner on the roster rather than here; a
    // toast disappears, and a list of people who still need a salary is
    // something to work through.
    toast.success(
      `Salaries assigned to ${total} ${total === 1 ? 'employee' : 'employees'}.` +
        (missingGrade.length > 0
          ? ` ${missingGrade.length} skipped — no grade for their designation.`
          : ''),
    );
  }, [bulkAssign, structuresData]);

  return {
    run,
    phase,
    progress,
    skipped,
    isBusy: phase === 'fetching' || phase === 'assigning',
  };
}
