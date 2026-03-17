import { vi } from "vitest";

export interface MockDbConfig {
  watches?: Record<string, unknown>[];
  reminders?: Record<string, unknown>[];
  notificationLog?: Record<string, unknown>[];
  insertWatchResult?: Record<string, unknown> | null;
  insertReminderResult?: Record<string, unknown> | null;
  watchChanges?: number;
  reminderChanges?: number;
  statusCounts?: { watches: number; snapshots: number; notifications: number };
}

/**
 * Builds a D1Database mock that routes responses based on SQL content.
 * Not a full SQL interpreter — just enough to exercise our specific handler queries.
 */
export function createMockDb(config: MockDbConfig = {}): D1Database {
  const {
    watches = [],
    reminders = [],
    notificationLog = [],
    insertWatchResult = null,
    insertReminderResult = null,
    watchChanges = 1,
    reminderChanges = 1,
    statusCounts = { watches: 0, snapshots: 0, notifications: 0 },
  } = config;

  function makeStatement(sql: string) {
    const stmt = {
      _sql: sql,
      bind: vi.fn().mockReturnThis() as unknown as (...values: unknown[]) => D1PreparedStatement,
      all: vi.fn((): Promise<{ results: Record<string, unknown>[] }> => {
        if (sql.includes("FROM watches")) return Promise.resolve({ results: watches });
        if (sql.includes("FROM reminders")) return Promise.resolve({ results: reminders });
        if (sql.includes("FROM notification_log"))
          return Promise.resolve({ results: notificationLog });
        return Promise.resolve({ results: [] });
      }),
      first: vi.fn((): Promise<Record<string, unknown> | null> => {
        if (sql.includes("INTO watches")) return Promise.resolve(insertWatchResult);
        if (sql.includes("INTO reminders")) return Promise.resolve(insertReminderResult);
        return Promise.resolve(null);
      }),
      run: vi.fn((): Promise<{ meta: { changes: number } }> => {
        if (sql.includes("watches")) return Promise.resolve({ meta: { changes: watchChanges } });
        if (sql.includes("reminders"))
          return Promise.resolve({ meta: { changes: reminderChanges } });
        return Promise.resolve({ meta: { changes: 0 } });
      }),
    };
    return stmt as unknown as D1PreparedStatement;
  }

  const db = {
    prepare: vi.fn((sql: string) => makeStatement(sql)),
    batch: vi.fn((stmts: Array<{ _sql: string }>) => {
      return Promise.resolve(
        stmts.map((s) => {
          if (s._sql.includes("FROM watches"))
            return { results: [{ count: statusCounts.watches }] };
          if (s._sql.includes("FROM availability_snapshots"))
            return { results: [{ count: statusCounts.snapshots }] };
          if (s._sql.includes("FROM notification_log"))
            return { results: [{ count: statusCounts.notifications }] };
          return { results: [{ count: 0 }] };
        })
      ) as unknown as Promise<D1Result[]>;
    }),
    // unused but required by the D1Database type
    dump: vi.fn(),
    exec: vi.fn(),
  } as unknown as D1Database;

  return db;
}

export function makeWatchRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 1,
    provider: "recreation_gov",
    facility_id: "232450",
    facility_name: "Lower Pines",
    start_date: "2026-07-01",
    end_date: "2026-07-31",
    site_ids: null,
    site_types: null,
    loop_name: null,
    notify_push: 1,
    notify_email: 0,
    active: 1,
    created_at: "2026-03-17 00:00:00",
    updated_at: "2026-03-17 00:00:00",
    ...overrides,
  };
}

export function makeReminderRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 1,
    provider: "recreation_gov",
    facility_id: "232450",
    facility_name: "Lower Pines",
    target_date: "2026-07-04",
    nights: 2,
    window_months: 6,
    remind_days_before: 3,
    notified: 0,
    created_at: "2026-03-17 00:00:00",
    ...overrides,
  };
}

export const fakeEnv = {
  NTFY_SERVER: "https://ntfy.sh",
  NTFY_TOPIC: "test-topic",
};
