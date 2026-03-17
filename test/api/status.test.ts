import { describe, it, expect } from "vitest";
import app from "../../src/api/router";
import { createMockDb, fakeEnv } from "../helpers/mock-db";

const env = (db: D1Database) => ({ ...fakeEnv, DB: db });

describe("GET /api/status", () => {
  it("returns counts for watches, snapshots, and recent notifications", async () => {
    const res = await app.request(
      "/api/status",
      {},
      env(createMockDb({ statusCounts: { watches: 3, snapshots: 1200, notifications: 5 } }))
    );
    expect(res.status).toBe(200);
    const body = await res.json<{
      active_watches: number;
      total_snapshots: number;
      notifications_last_24h: number;
    }>();
    expect(body.active_watches).toBe(3);
    expect(body.total_snapshots).toBe(1200);
    expect(body.notifications_last_24h).toBe(5);
  });

  it("returns zeros when the database is empty", async () => {
    const res = await app.request("/api/status", {}, env(createMockDb()));
    expect(res.status).toBe(200);
    const body = await res.json<Record<string, number>>();
    expect(body.active_watches).toBe(0);
    expect(body.total_snapshots).toBe(0);
    expect(body.notifications_last_24h).toBe(0);
  });
});
