-- Migration: 0001_initial
-- Campgrounds the user wants to track
CREATE TABLE watches (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  provider      TEXT    NOT NULL DEFAULT 'recreation_gov',
  facility_id   TEXT    NOT NULL,
  facility_name TEXT,
  start_date    TEXT    NOT NULL,  -- ISO date "2026-07-04"
  end_date      TEXT    NOT NULL,  -- ISO date "2026-07-06"
  -- Filters (null = "any")
  site_ids      TEXT,              -- JSON array of specific site IDs, or null
  site_types    TEXT,              -- JSON array e.g. '["STANDARD NONELECTRIC"]'
  loop_name     TEXT,
  -- Notification prefs
  notify_push   INTEGER NOT NULL DEFAULT 1,
  notify_email  INTEGER NOT NULL DEFAULT 0,
  -- State
  active        INTEGER NOT NULL DEFAULT 1,
  created_at    TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- Reservation window reminders
CREATE TABLE reminders (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  provider            TEXT    NOT NULL DEFAULT 'recreation_gov',
  facility_id         TEXT    NOT NULL,
  facility_name       TEXT,
  target_date         TEXT    NOT NULL,  -- first night of intended stay
  nights              INTEGER NOT NULL DEFAULT 1,
  window_months       INTEGER NOT NULL DEFAULT 6,
  remind_days_before  INTEGER NOT NULL DEFAULT 3,
  notified            INTEGER NOT NULL DEFAULT 0,
  created_at          TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- Last known availability per (watch, campsite, date) — used to detect transitions
CREATE TABLE availability_snapshots (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  watch_id     INTEGER NOT NULL REFERENCES watches(id),
  campsite_id  TEXT    NOT NULL,
  check_date   TEXT    NOT NULL,  -- the camping date (ISO date)
  status       TEXT    NOT NULL,  -- "Available" | "Reserved" | "NotAvailable" | "Unknown"
  captured_at  TEXT    NOT NULL DEFAULT (datetime('now')),
  UNIQUE(watch_id, campsite_id, check_date)
);

-- Log of notifications sent (dedup + history)
CREATE TABLE notification_log (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  watch_id     INTEGER REFERENCES watches(id),
  campsite_id  TEXT,
  check_date   TEXT,
  event_type   TEXT    NOT NULL,  -- "cancellation_found" | "window_reminder"
  channel      TEXT    NOT NULL,  -- "ntfy" | "email"
  sent_at      TEXT    NOT NULL DEFAULT (datetime('now')),
  payload      TEXT               -- JSON of what was sent
);

-- Index to speed up the main checker query
CREATE INDEX idx_watches_active ON watches(active);
CREATE INDEX idx_snapshots_watch ON availability_snapshots(watch_id, check_date);
CREATE INDEX idx_notif_log_dedup ON notification_log(watch_id, campsite_id, check_date, sent_at);