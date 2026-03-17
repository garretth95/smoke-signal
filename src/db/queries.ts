import type { CampsiteAvailability } from "../providers/types";

export interface Watch {
  id: number;
  provider: string;
  facility_id: string;
  facility_name: string | null;
  start_date: string;
  end_date: string;
  site_ids: string | null; // JSON array or null
  site_types: string | null; // JSON array or null
  loop_name: string | null;
  notify_push: number;
  notify_email: number;
  active: number;
}

export interface AvailabilitySnapshot {
  watch_id: number;
  campsite_id: string;
  check_date: string;
  status: string;
}

export interface Reminder {
  id: number;
  provider: string;
  facility_id: string;
  facility_name: string | null;
  target_date: string;
  nights: number;
  window_months: number;
  notify_schedule: string; // JSON array of minute offsets e.g. [-4320,-1440,-60,0]
  notified_at: string; // JSON array of offsets already fired
  created_at: string;
}

export interface NotificationLogEntry {
  watch_id: number;
  campsite_id: string;
  check_date: string;
  event_type: string;
  channel: string;
  payload: string;
}

export async function getActiveWatches(db: D1Database): Promise<Watch[]> {
  const result = await db.prepare("SELECT * FROM watches WHERE active = 1").all<Watch>();
  return result.results;
}

export async function getSnapshots(db: D1Database, watchId: number): Promise<Map<string, string>> {
  const result = await db
    .prepare(
      "SELECT campsite_id, check_date, status FROM availability_snapshots WHERE watch_id = ?"
    )
    .bind(watchId)
    .all<{ campsite_id: string; check_date: string; status: string }>();

  const map = new Map<string, string>();
  for (const row of result.results) {
    map.set(`${row.campsite_id}:${row.check_date}`, row.status);
  }
  return map;
}

export async function upsertSnapshots(
  db: D1Database,
  watchId: number,
  availability: CampsiteAvailability[]
): Promise<void> {
  if (availability.length === 0) return;

  // D1 batch: up to 100 statements per batch
  const statements = availability.map((a) =>
    db
      .prepare(
        `INSERT INTO availability_snapshots (watch_id, campsite_id, check_date, status)
         VALUES (?, ?, ?, ?)
         ON CONFLICT (watch_id, campsite_id, check_date) DO UPDATE SET
           status = excluded.status,
           captured_at = datetime('now')`
      )
      .bind(watchId, a.campsiteId, a.date, a.status)
  );

  // Chunk into batches of 100
  for (let i = 0; i < statements.length; i += 100) {
    await db.batch(statements.slice(i, i + 100));
  }
}

/** Returns true if a notification was already sent for this (watch, campsite, date) within the last hour. */
export async function wasRecentlyNotified(
  db: D1Database,
  watchId: number,
  campsiteId: string,
  checkDate: string
): Promise<boolean> {
  const result = await db
    .prepare(
      `SELECT 1 FROM notification_log
       WHERE watch_id = ? AND campsite_id = ? AND check_date = ?
         AND sent_at > datetime('now', '-1 hour')
       LIMIT 1`
    )
    .bind(watchId, campsiteId, checkDate)
    .first();
  return result !== null;
}

export async function getActiveReminders(db: D1Database): Promise<Reminder[]> {
  const result = await db
    .prepare(
      `SELECT * FROM reminders
       WHERE json_array_length(notified_at) < json_array_length(notify_schedule)
       ORDER BY target_date ASC`
    )
    .all<Reminder>();
  return result.results;
}

export async function markReminderNotified(
  db: D1Database,
  id: number,
  notifiedAt: number[]
): Promise<void> {
  await db
    .prepare("UPDATE reminders SET notified_at = ? WHERE id = ?")
    .bind(JSON.stringify(notifiedAt), id)
    .run();
}

export async function logNotification(db: D1Database, entry: NotificationLogEntry): Promise<void> {
  await db
    .prepare(
      `INSERT INTO notification_log (watch_id, campsite_id, check_date, event_type, channel, payload)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
    .bind(
      entry.watch_id,
      entry.campsite_id,
      entry.check_date,
      entry.event_type,
      entry.channel,
      entry.payload
    )
    .run();
}
