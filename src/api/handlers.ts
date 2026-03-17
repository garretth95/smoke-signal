import type { Context } from "hono";
import type { Env } from "../index";

// --- Watches ---

export async function listWatches(c: Context<{ Bindings: Env }>) {
  const result = await c.env.DB.prepare(
    "SELECT * FROM watches WHERE active = 1 ORDER BY start_date ASC"
  ).all();
  return c.json(result.results);
}

export async function createWatch(c: Context<{ Bindings: Env }>) {
  const body = await c.req.json<{
    facility_id: string;
    facility_name?: string;
    start_date: string;
    end_date: string;
    site_ids?: string[];
    site_types?: string[];
    loop_name?: string;
    notify_push?: boolean;
  }>();

  if (!body.facility_id || !body.start_date || !body.end_date) {
    return c.json({ error: "facility_id, start_date, and end_date are required" }, 400);
  }

  const result = await c.env.DB.prepare(
    `INSERT INTO watches (facility_id, facility_name, start_date, end_date, site_ids, site_types, loop_name, notify_push)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     RETURNING *`
  )
    .bind(
      body.facility_id,
      body.facility_name ?? null,
      body.start_date,
      body.end_date,
      body.site_ids ? JSON.stringify(body.site_ids) : null,
      body.site_types ? JSON.stringify(body.site_types) : null,
      body.loop_name ?? null,
      body.notify_push === false ? 0 : 1
    )
    .first();

  return c.json(result, 201);
}

export async function deleteWatch(c: Context<{ Bindings: Env }>) {
  const id = Number(c.req.param("id"));
  const result = await c.env.DB.prepare(
    "UPDATE watches SET active = 0, updated_at = datetime('now') WHERE id = ? AND active = 1"
  )
    .bind(id)
    .run();

  if (result.meta.changes === 0) {
    return c.json({ error: "Watch not found" }, 404);
  }
  return c.json({ success: true });
}

export async function getWatchHistory(c: Context<{ Bindings: Env }>) {
  const id = Number(c.req.param("id"));
  const result = await c.env.DB.prepare(
    `SELECT * FROM notification_log WHERE watch_id = ? ORDER BY sent_at DESC LIMIT 50`
  )
    .bind(id)
    .all();
  return c.json(result.results);
}

// --- Reminders ---

const DEFAULT_NOTIFY_SCHEDULE = [-1440, -60, -15, 0];

export async function listReminders(c: Context<{ Bindings: Env }>) {
  const result = await c.env.DB.prepare(
    `SELECT * FROM reminders
     WHERE json_array_length(notified_at) < json_array_length(notify_schedule)
     ORDER BY target_date ASC`
  ).all();
  return c.json(result.results);
}

export async function createReminder(c: Context<{ Bindings: Env }>) {
  const body = await c.req.json<{
    facility_id: string;
    facility_name?: string;
    target_date: string;
    nights?: number;
    window_months?: number;
    notify_schedule?: number[];
  }>();

  if (!body.facility_id || !body.target_date) {
    return c.json({ error: "facility_id and target_date are required" }, 400);
  }

  const notifySchedule = body.notify_schedule ?? DEFAULT_NOTIFY_SCHEDULE;

  const result = await c.env.DB.prepare(
    `INSERT INTO reminders (facility_id, facility_name, target_date, nights, window_months, notify_schedule, notified_at)
     VALUES (?, ?, ?, ?, ?, ?, '[]')
     RETURNING *`
  )
    .bind(
      body.facility_id,
      body.facility_name ?? null,
      body.target_date,
      body.nights ?? 1,
      body.window_months ?? 6,
      JSON.stringify(notifySchedule)
    )
    .first();

  return c.json(result, 201);
}

export async function deleteReminder(c: Context<{ Bindings: Env }>) {
  const id = Number(c.req.param("id"));
  const result = await c.env.DB.prepare("DELETE FROM reminders WHERE id = ?").bind(id).run();
  if (result.meta.changes === 0) {
    return c.json({ error: "Reminder not found" }, 404);
  }
  return c.json({ success: true });
}

// --- Status ---

export async function getStatus(c: Context<{ Bindings: Env }>) {
  const [watches, snapshots, notifications] = await c.env.DB.batch([
    c.env.DB.prepare("SELECT COUNT(*) as count FROM watches WHERE active = 1"),
    c.env.DB.prepare("SELECT COUNT(*) as count FROM availability_snapshots"),
    c.env.DB.prepare(
      "SELECT COUNT(*) as count FROM notification_log WHERE sent_at > datetime('now', '-24 hours')"
    ),
  ]);

  type CountRow = { count: number };
  return c.json({
    active_watches: (watches?.results[0] as CountRow | undefined)?.count ?? 0,
    total_snapshots: (snapshots?.results[0] as CountRow | undefined)?.count ?? 0,
    notifications_last_24h: (notifications?.results[0] as CountRow | undefined)?.count ?? 0,
  });
}
