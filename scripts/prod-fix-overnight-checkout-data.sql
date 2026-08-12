-- Repair the checkout columns for the six evening workers after the overnight-shift move.
--
-- Scope: EXACTLY the six user ids below, records from 2026-07-07 onward. Nothing else.
--
-- Two defects are being undone, both from the off time of a 16:00→01:00 shift having been
-- anchored to the record's own date (~15h BEFORE the shift began). See
-- bugs/overnight-shift-checkout-off-time-anchored-to-wrong-day.md
--
--   1. Every checkout compared "at or after the off time", so a 23:59 finish was booked as
--      ~1,379 minutes of overtime instead of an hour short of the shift end.
--   2. The midnight sweep closed the session at 23:59:59 (its activity search was bounded to
--      the calendar day), discarding the work done between midnight and the 01:00 shift end.
--
-- Mirrors the FIXED CheckInService exactly, so a later re-run of the sweep agrees with it:
--   off time      = (date + 1 day) 01:00 Asia/Karachi  = date 20:00 UTC
--   day start     = date 00:00 Asia/Karachi            = (date - 1) 19:00 UTC
--   last activity = MAX(tracked entry ended_at, activity_log logged_at) within
--                   [day start, off time]  -- the off time is a CEILING: a fabricated
--                   checkout is never stamped past the end of the shift it belongs to
--   checkout      = last activity when after check-in, else the off time, else check_in + 1s
--   early/overtime measured against the off time; exactly at it = 0 overtime, not early
--
-- Only records the system auto-closed (check_in_flags->>'auto_checked_out' = 'true') have
-- their checkout instant moved -- a checkout the EMPLOYEE performed is authoritative and is
-- left exactly where it is. Both groups get early/overtime recomputed.
--
-- worked_seconds is re-summed from the (non-deleted) closed sessions, absolute-instant diff
-- so a session spanning midnight counts correctly -- same invariant as recomputeRecordRollups().

\set ON_ERROR_STOP on

BEGIN;

CREATE TEMP TABLE tgt_users(id uuid) ON COMMIT DROP;
INSERT INTO tgt_users VALUES
  ('019e1c76-d20f-70ed-842f-bf436c809676'),  -- Adnan Kamran
  ('019e1c69-a8f6-712b-8913-2534037ceb90'),  -- Tayyab Shaikh
  ('019e16e8-d8ab-72d5-817b-59ae7cb8ad54'),  -- Umar Amjad
  ('019e1c72-69ed-7185-9291-cca1a42a87b9'),  -- Ali Asgher
  ('019e1c5a-0ffb-7009-84db-d4c3e8b89348'),  -- Sher afgan
  ('019e1c5a-34b1-737d-81f7-7f62c6aec0f4');  -- Zarar Khalid

-- Guard: the six must be on the overnight shift, or the off time below is wrong.
DO $$
DECLARE n int;
BEGIN
  SELECT count(DISTINCT us.user_id) INTO n
    FROM user_shifts us JOIN shifts s ON s.id = us.shift_id
   WHERE us.user_id IN (SELECT id FROM tgt_users)
     AND us.deleted_at IS NULL AND s.deleted_at IS NULL
     AND s.start_time = '16:00:00' AND s.end_time = '01:00:00';
  IF n <> 6 THEN RAISE EXCEPTION 'Expected 6 users on a 16:00-01:00 shift, found %', n; END IF;
END $$;

-- ── the records in scope, with their shift-correct off time ──────────────
CREATE TEMP TABLE scope ON COMMIT DROP AS
SELECT ar.id,
       ar.user_id,
       ar.date,
       ar.organization_id,
       (ar.date::timestamp + interval '20 hours')  AS off_at_utc,   -- next-day 01:00 PKT
       (ar.date::timestamp - interval '5 hours')   AS day_start_utc,-- same-day 00:00 PKT
       (ar.check_in_flags->>'auto_checked_out' = 'true') AS auto_closed
  FROM attendance_records ar
 WHERE ar.user_id IN (SELECT id FROM tgt_users)
   AND ar.deleted_at IS NULL
   AND ar.date >= DATE '2026-07-07'
   AND ar.check_out_at IS NOT NULL;

-- ── 1. move the auto-closed checkouts to the true end of the shift ───────
-- The LAST closed session of the day carries the day's checkout, so that is the row that
-- moves. A checkout is only ever pushed LATER, never earlier.
CREATE TEMP TABLE session_fix ON COMMIT DROP AS
WITH last_session AS (
  SELECT DISTINCT ON (cis.attendance_record_id)
         cis.id, cis.attendance_record_id, cis.check_in_at, cis.check_out_at
    FROM check_in_sessions cis
   WHERE cis.attendance_record_id IN (SELECT id FROM scope WHERE auto_closed)
     AND cis.deleted_at IS NULL
     AND cis.check_out_at IS NOT NULL
   ORDER BY cis.attendance_record_id, cis.check_in_at DESC
), activity AS (
  SELECT s.id AS record_id,
         GREATEST(
           COALESCE((SELECT max(te.ended_at) FROM time_entries te
                      WHERE te.user_id = s.user_id AND te.organization_id = s.organization_id
                        AND te.type = 'tracked' AND te.deleted_at IS NULL
                        AND te.ended_at BETWEEN s.day_start_utc AND s.off_at_utc),
                    '-infinity'::timestamp),
           COALESCE((SELECT max(al.logged_at) FROM activity_logs al
                      WHERE al.user_id = s.user_id AND al.organization_id = s.organization_id
                        AND al.logged_at BETWEEN s.day_start_utc AND s.off_at_utc),
                    '-infinity'::timestamp)
         ) AS last_activity
    FROM scope s WHERE s.auto_closed
)
SELECT ls.id AS session_id,
       ls.attendance_record_id AS record_id,
       ls.check_out_at AS old_out,
       CASE
         WHEN a.last_activity > ls.check_in_at THEN a.last_activity
         WHEN s.off_at_utc   > ls.check_in_at THEN s.off_at_utc
         ELSE ls.check_in_at + interval '1 second'
       END AS new_out
  FROM last_session ls
  JOIN scope s    ON s.id = ls.attendance_record_id
  JOIN activity a ON a.record_id = ls.attendance_record_id;

UPDATE check_in_sessions cis
   SET check_out_at = f.new_out, updated_at = now()
  FROM session_fix f
 WHERE cis.id = f.session_id
   AND f.new_out > f.old_out;   -- never pull a checkout earlier

-- ── 2. re-roll each record from its session set ──────────────────────────
UPDATE attendance_records ar
   SET check_out_at               = r.last_out,
       worked_seconds             = r.worked,
       is_early_checkout          = r.last_out < s.off_at_utc,
       check_out_early_minutes    = CASE WHEN r.last_out < s.off_at_utc
                                      THEN floor(EXTRACT(epoch FROM (s.off_at_utc - r.last_out))/60)::int
                                      ELSE 0 END,
       check_out_overtime_minutes = CASE WHEN r.last_out >= s.off_at_utc
                                      THEN floor(EXTRACT(epoch FROM (r.last_out - s.off_at_utc))/60)::int
                                      ELSE 0 END,
       updated_at                 = now()
  FROM scope s,
       LATERAL (
         SELECT max(cis.check_out_at) AS last_out,
                sum(EXTRACT(epoch FROM (cis.check_out_at - cis.check_in_at)))::int AS worked
           FROM check_in_sessions cis
          WHERE cis.attendance_record_id = s.id
            AND cis.deleted_at IS NULL
            AND cis.check_out_at IS NOT NULL
       ) r
 WHERE ar.id = s.id
   AND r.last_out IS NOT NULL;

-- ── verification ─────────────────────────────────────────────────────────
\echo '--- 2026-08-11 after ---'
SELECT u.name,
       (ar.check_out_at AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Karachi') AS checkout_pkt,
       round(ar.worked_seconds/3600.0, 2) AS worked_h,
       ar.is_early_checkout AS early,
       ar.check_out_early_minutes AS early_min,
       ar.check_out_overtime_minutes AS ot_min
  FROM attendance_records ar JOIN users u ON u.id = ar.user_id
 WHERE ar.user_id IN (SELECT id FROM tgt_users) AND ar.date = DATE '2026-08-11'
 ORDER BY u.name;

\echo '--- overtime total across the whole repaired range ---'
SELECT count(*) AS records,
       sum(check_out_overtime_minutes) AS ot_minutes,
       round(sum(check_out_overtime_minutes)/60.0, 1) AS ot_hours,
       count(*) FILTER (WHERE is_early_checkout) AS early_days,
       round(sum(worked_seconds)/3600.0, 1) AS worked_hours
  FROM attendance_records
 WHERE user_id IN (SELECT id FROM tgt_users) AND deleted_at IS NULL
   AND date >= DATE '2026-07-07' AND check_out_at IS NOT NULL;

\echo '--- blast radius: rows changed outside the six (must be 0) ---'
SELECT count(*) AS other_users_touched
  FROM attendance_records
 WHERE updated_at > now() - interval '1 minute'
   AND user_id NOT IN (SELECT id FROM tgt_users);

SELECT count(*) AS other_sessions_touched
  FROM check_in_sessions
 WHERE updated_at > now() - interval '1 minute'
   AND user_id NOT IN (SELECT id FROM tgt_users);
