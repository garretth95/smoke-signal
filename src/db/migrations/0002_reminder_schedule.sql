-- Migration: 0002_reminder_schedule
-- Replace single remind_days_before with a flexible per-offset notification schedule.
-- notify_schedule: JSON array of minute offsets relative to window open time
--   (negative = before open, 0 = at open). Default: 3 days, 1 day, 1 hour, at open.
-- notified_at: JSON array of offsets that have already fired.
ALTER TABLE reminders ADD COLUMN notify_schedule TEXT NOT NULL DEFAULT '[-1440,-60,-15,0]';
ALTER TABLE reminders ADD COLUMN notified_at TEXT NOT NULL DEFAULT '[]';
