-- ============================================================================
-- Migration 0002: Hours aggregation view
-- Centralizes the business rule: "actual hours are derived from approved
-- actual time entries; planned hours are derived from planned entries or the
-- action-level planned-hours field". Falls back to the confirmed legacy
-- import value only when no actual time entries exist yet.
-- ============================================================================

CREATE VIEW action_hours AS
SELECT
  a.uuid AS action_uuid,
  COALESCE(
    (SELECT SUM(te.hours) FROM time_entries te WHERE te.action_uuid = a.uuid AND te.type = 'PLANNED'),
    a.planned_hours,
    0
  ) AS planned_hours_total,
  COALESCE(
    (SELECT SUM(te.hours) FROM time_entries te WHERE te.action_uuid = a.uuid AND te.type = 'ACTUAL' AND te.approval_status = 'APPROVED'),
    CASE WHEN a.legacy_hours_confirmed = 1 THEN a.actual_hours_legacy ELSE 0 END,
    0
  ) AS actual_hours_total
FROM actions a;
