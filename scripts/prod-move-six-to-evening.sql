-- Move six evening workers off Morning Shift onto the "Sales Team" shift (16:00-01:00)
-- and recompute their late attendance, backdated to 2026-07-07.
--
-- Scope: EXACTLY the six user ids below, in org Codeupscale. Nothing else is touched.
--
-- Late math mirrors CheckInService::checkIn():
--   late threshold = shift start 16:00 + grace 15m = 16:15 Asia/Karachi
--   boundary (exactly 16:15) counts as ON TIME
--   late minutes are measured FROM the threshold, truncated to whole minutes
--
-- attendance_records.late_minutes (the legacy tracker column) is zeroed on days that
-- have a check-in: AttendanceService::serializeRecord() takes check_in_late_minutes as
-- the authoritative late figure whenever check_in_at exists, and the monthly summary
-- ORs the two columns together -- leaving the stale tracker value would keep cleared
-- days counting as late. No affected day without a check-in carries a tracker late
-- value (verified: 0 rows), so nothing is lost.
--
-- Checkout / overtime columns are deliberately NOT recomputed -- see the note reported
-- alongside this change re: CheckInService::recomputeRecordRollups() lacking overnight
-- handling for a shift whose end_time (01:00) is before its start_time (16:00).

\set ON_ERROR_STOP on

BEGIN;

-- ── ids ──────────────────────────────────────────────────────────────────
CREATE TEMP TABLE tgt_users(id uuid) ON COMMIT DROP;
INSERT INTO tgt_users VALUES
  ('019e1c76-d20f-70ed-842f-bf436c809676'),  -- Adnan Kamran
  ('019e1c69-a8f6-712b-8913-2534037ceb90'),  -- Tayyab Shaikh
  ('019e16e8-d8ab-72d5-817b-59ae7cb8ad54'),  -- Umar Amjad
  ('019e1c72-69ed-7185-9291-cca1a42a87b9'),  -- Ali Asgher
  ('019e1c5a-0ffb-7009-84db-d4c3e8b89348'),  -- Sher afgan
  ('019e1c5a-34b1-737d-81f7-7f62c6aec0f4');  -- Zarar Khalid

-- Guard: exactly 6 targets, all active, all in Codeupscale.
DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM users u JOIN tgt_users t ON t.id = u.id
   WHERE u.organization_id = '019d01e7-a622-7145-b0e5-6c7d6d09d512'
     AND u.is_active AND u.deleted_at IS NULL;
  IF n <> 6 THEN RAISE EXCEPTION 'Expected 6 active Codeupscale users, found %', n; END IF;
END $$;

-- Guard: the Sales Team shift is live.
DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM shifts
   WHERE id = '019febc3-23c4-722a-bbf1-1c19b1e09f8f'
     AND organization_id = '019d01e7-a622-7145-b0e5-6c7d6d09d512'
     AND is_active AND deleted_at IS NULL;
  IF n <> 1 THEN RAISE EXCEPTION 'Sales Team shift not found/active'; END IF;
END $$;

-- ── 1. retire the wrong Morning Shift assignments (soft delete, recoverable) ──
UPDATE user_shifts
   SET deleted_at = now(), updated_at = now()
 WHERE user_id IN (SELECT id FROM tgt_users)
   AND organization_id = '019d01e7-a622-7145-b0e5-6c7d6d09d512'
   AND deleted_at IS NULL;

-- ── 2. assign the evening (Sales Team) shift from 2026-07-07, open-ended ──
INSERT INTO user_shifts (id, organization_id, user_id, shift_id, effective_from, effective_to, created_at, updated_at)
SELECT gen_random_uuid(),
       '019d01e7-a622-7145-b0e5-6c7d6d09d512',
       t.id,
       '019febc3-23c4-722a-bbf1-1c19b1e09f8f',
       DATE '2026-07-07',
       NULL,
       now(), now()
  FROM tgt_users t;

-- ── 3. repoint the attendance rows at the evening shift ──
UPDATE attendance_records ar
   SET shift_id       = '019febc3-23c4-722a-bbf1-1c19b1e09f8f',
       expected_start = '16:00:00',
       expected_end   = '01:00:00',
       updated_at     = now()
 WHERE ar.user_id IN (SELECT id FROM tgt_users)
   AND ar.deleted_at IS NULL
   AND ar.date >= DATE '2026-07-07';

-- ── 4. recompute late against the 16:15 threshold, on checked-in days only ──
UPDATE attendance_records ar
   SET check_in_status       = CASE WHEN c.is_late THEN 'late' ELSE 'on_time' END,
       check_in_late_minutes = c.new_late,
       late_minutes          = 0,
       updated_at            = now()
  FROM (
    SELECT ar2.id,
           ((ar2.check_in_at AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Karachi')
              > (ar2.date + time '16:15:00')) AS is_late,
           GREATEST(0, floor(EXTRACT(epoch FROM
              ((ar2.check_in_at AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Karachi')
                 - (ar2.date + time '16:15:00'))) / 60)::int) AS new_late
      FROM attendance_records ar2
     WHERE ar2.user_id IN (SELECT id FROM tgt_users)
       AND ar2.deleted_at IS NULL
       AND ar2.date >= DATE '2026-07-07'
       AND ar2.check_in_at IS NOT NULL
  ) c
 WHERE ar.id = c.id;

-- ── verification ─────────────────────────────────────────────────────────
\echo '--- shift assignments after ---'
SELECT u.name, s.name AS shift, us.effective_from, us.effective_to, us.deleted_at IS NOT NULL AS retired
  FROM user_shifts us
  JOIN users u ON u.id = us.user_id
  JOIN shifts s ON s.id = us.shift_id
 WHERE us.user_id IN (SELECT id FROM tgt_users)
 ORDER BY u.name, us.deleted_at NULLS FIRST;

\echo '--- late summary after ---'
SELECT u.name,
       count(*) FILTER (WHERE ar.check_in_at IS NOT NULL)             AS checkin_days,
       count(*) FILTER (WHERE ar.check_in_status = 'late')            AS late_days,
       count(*) FILTER (WHERE ar.check_in_status = 'on_time')         AS ontime_days,
       sum(ar.check_in_late_minutes)                                  AS late_mins,
       sum(ar.late_minutes)                                           AS tracker_late_mins
  FROM attendance_records ar JOIN users u ON u.id = ar.user_id
 WHERE ar.user_id IN (SELECT id FROM tgt_users)
   AND ar.deleted_at IS NULL AND ar.date >= DATE '2026-07-07'
 GROUP BY u.name ORDER BY u.name;

\echo '--- blast radius: rows changed outside the six (must be 0) ---'
SELECT count(*) AS other_users_touched
  FROM attendance_records
 WHERE updated_at > now() - interval '1 minute'
   AND user_id NOT IN (SELECT id FROM tgt_users);
