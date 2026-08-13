-- =====================================================================
-- TrackFlow — repair inflated time entries  ** DRY RUN — READ ONLY **
-- =====================================================================
-- Reports what a repair WOULD change. Executes no UPDATE/DELETE against
-- any real table; the only writes are TEMP tables, dropped at session end.
--
-- Context: entries written by pre-local-first agents (<= desktop 1.0.45)
-- are inflated by two mechanisms, both fixed in code as of 2026-08-13:
--   A. duplicate rows  — same user + same started_at, each billed in full
--   B. the old 12h cap — CleanupStaleEntries closed abandoned entries at
--      started_at + 12h, fabricating time nobody worked
--
-- SAFETY — the evidence horizon. activity_logs only begins 2026-05-15.
-- Entries before that have no heartbeats because collection had not
-- started, NOT because no work happened. Closing them at "last heartbeat"
-- would zero ~1,000 legitimate entries, so rule B is scoped to the
-- heartbeat-covered window and never fires without positive evidence.
--
-- Usage:
--   ssh trackflow 'docker exec -i infra-postgres-1 psql -U trackflow -d trackflow' \
--     < scripts/prod-repair-inflated-time-entries-dryrun.sql
-- =====================================================================

\set ON_ERROR_STOP on
\pset pager off

-- ---------------------------------------------------------------------
-- 0. Evidence horizon — derived from the data, not hardcoded
-- ---------------------------------------------------------------------
create temp table horizon as
select min(logged_at)::date as hb_start from activity_logs;

\echo ''
\echo '=== 0. EVIDENCE HORIZON (rule B only applies at/after this date) ==='
select hb_start as heartbeat_data_begins,
       (select count(*) from time_entries te
         where te.deleted_at is null and te.type='tracked'
           and te.started_at < h.hb_start) as entries_before_horizon_untouched
from horizon h;

-- ---------------------------------------------------------------------
-- 1. Per-entry evidence: last INPUT-BEARING heartbeat (matches liveAsOf)
-- ---------------------------------------------------------------------
create temp table ev as
select te.id as entry_id, te.user_id, te.started_at, te.ended_at,
       te.duration_seconds,
       count(al.id)                                                        as n_hb,
       count(al.id) filter (where al.keyboard_events>0 or al.mouse_events>0) as n_input_hb,
       max(al.logged_at) filter (where al.keyboard_events>0 or al.mouse_events>0) as last_input_hb
from time_entries te
left join activity_logs al on al.time_entry_id = te.id
where te.deleted_at is null and te.type = 'tracked'
group by te.id, te.user_id, te.started_at, te.ended_at, te.duration_seconds;

create index on ev (user_id, started_at);

-- ---------------------------------------------------------------------
-- 2. RULE A — duplicates (same user + identical started_at)
--    Keeper = most input heartbeats > most heartbeats > SHORTEST duration
--    (shortest breaks ties toward the non-cap-inflated row) > id.
--    Detection is structural, so this is safe outside the horizon too.
-- ---------------------------------------------------------------------
create temp table dup_plan as
with grp as (
  select user_id, started_at from ev
  group by user_id, started_at having count(*) > 1
), ranked as (
  select e.*, row_number() over (
           partition by e.user_id, e.started_at
           order by e.n_input_hb desc, e.n_hb desc, e.duration_seconds asc, e.entry_id
         ) as rn
  from ev e join grp g using (user_id, started_at)
)
select entry_id, user_id, started_at, ended_at, duration_seconds, n_hb, n_input_hb,
       case when rn = 1 then 'KEEP' else 'SOFT-DELETE' end as action
from ranked;

-- ---------------------------------------------------------------------
-- 3. RULE B — re-close entries billed past their last real input.
--    Requires positive evidence (n_input_hb > 0) and the horizon.
--    15-minute grace absorbs normal heartbeat cadence.
--    Surplus duplicate rows are excluded (rule A already removes them).
-- ---------------------------------------------------------------------
create temp table close_plan as
select e.entry_id, e.user_id, e.started_at, e.ended_at, e.duration_seconds,
       e.last_input_hb as new_ended_at,
       greatest(0, extract(epoch from (e.last_input_hb - e.started_at))::int) as new_duration,
       e.duration_seconds
         - greatest(0, extract(epoch from (e.last_input_hb - e.started_at))::int) as seconds_removed
from ev e, horizon h
where e.started_at >= h.hb_start
  and e.n_input_hb > 0
  and e.ended_at is not null
  and e.last_input_hb < e.ended_at - interval '15 minutes'
  and e.entry_id not in (select entry_id from dup_plan where action='SOFT-DELETE');

-- ---------------------------------------------------------------------
-- 4. FLAG ONLY — long entries inside the horizon with zero input evidence.
--    NOT auto-repaired: absence of input heartbeats is weaker proof than
--    a later heartbeat, so these are surfaced for a human decision.
-- ---------------------------------------------------------------------
create temp table review_flags as
select e.entry_id, e.user_id, e.started_at, e.duration_seconds, e.n_hb
from ev e, horizon h
where e.started_at >= h.hb_start
  and e.n_input_hb = 0
  and e.duration_seconds >= 4*3600
  and e.entry_id not in (select entry_id from dup_plan where action='SOFT-DELETE');

\echo ''
\echo '=== 1. RULE A — duplicate rows to soft-delete ==='
select count(*) as rows_to_soft_delete,
       count(distinct (user_id::text||started_at::text)) as dup_groups,
       round(sum(duration_seconds)/3600.0,1) as hours_removed
from dup_plan where action='SOFT-DELETE';

\echo ''
\echo '=== 2. RULE B — entries to re-close at last real input ==='
select count(*) as entries_to_reclose,
       round(sum(seconds_removed)/3600.0,1) as hours_removed,
       round(max(seconds_removed)/3600.0,1) as largest_single_reduction_h
from close_plan;

\echo ''
\echo '=== 3. FLAGGED for manual review (no action taken) ==='
select count(*) as entries_flagged,
       round(sum(duration_seconds)/3600.0,1) as hours_involved
from review_flags;

\echo ''
\echo '=== 4. PER-USER BEFORE / AFTER (all-time tracked hours) ==='
with before as (
  select user_id, sum(duration_seconds) s from ev group by user_id
), rm_dup as (
  select user_id, sum(duration_seconds) s from dup_plan
   where action='SOFT-DELETE' group by user_id
), rm_close as (
  select user_id, sum(seconds_removed) s from close_plan group by user_id
)
select u.email,
       round(b.s/3600.0,1)                                        as before_h,
       round(coalesce(d.s,0)/3600.0,1)                            as minus_dupes_h,
       round(coalesce(c.s,0)/3600.0,1)                            as minus_deadtime_h,
       round((b.s - coalesce(d.s,0) - coalesce(c.s,0))/3600.0,1)  as after_h,
       round(100.0*(coalesce(d.s,0)+coalesce(c.s,0))/nullif(b.s,0),1) as pct_removed
from before b
join users u on u.id = b.user_id
left join rm_dup   d on d.user_id = b.user_id
left join rm_close c on c.user_id = b.user_id
where coalesce(d.s,0) + coalesce(c.s,0) > 0
order by (coalesce(d.s,0)+coalesce(c.s,0)) desc;

\echo ''
\echo '=== 5. ORG-WIDE TOTAL ==='
with before as (select sum(duration_seconds) s from ev),
     rm_dup as (select coalesce(sum(duration_seconds),0) s from dup_plan where action='SOFT-DELETE'),
     rm_close as (select coalesce(sum(seconds_removed),0) s from close_plan)
select round(b.s/3600.0,1) as before_h,
       round(d.s/3600.0,1) as minus_dupes_h,
       round(c.s/3600.0,1) as minus_deadtime_h,
       round((b.s-d.s-c.s)/3600.0,1) as after_h,
       round(100.0*(d.s+c.s)/nullif(b.s,0),1) as pct_removed
from before b, rm_dup d, rm_close c;

\echo ''
\echo '=== 6. SAMPLE of the 20 largest individual corrections ==='
select u.email,
       c.started_at at time zone 'Asia/Karachi' as started_pkt,
       round(c.duration_seconds/3600.0,2) as billed_h,
       round(c.new_duration/3600.0,2)     as corrected_h,
       round(c.seconds_removed/3600.0,2)  as removed_h
from close_plan c join users u on u.id=c.user_id
order by c.seconds_removed desc limit 20;

\echo ''
\echo '*** DRY RUN COMPLETE — nothing was modified ***'
