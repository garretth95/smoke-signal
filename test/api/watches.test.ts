import { describe, it, expect } from "vitest";
import app from "../../src/api/router";
import { createMockDb, makeWatchRow, fakeEnv } from "../helpers/mock-db";

const env = (db: D1Database) => ({ ...fakeEnv, DB: db });

describe("GET /api/watches", () => {
  it("returns an empty array when there are no watches", async () => {
    const res = await app.request("/api/watches", {}, env(createMockDb()));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([]);
  });

  it("returns the list of active watches", async () => {
    const watch = makeWatchRow();
    const res = await app.request("/api/watches", {}, env(createMockDb({ watches: [watch] })));
    expect(res.status).toBe(200);
    const body = await res.json<unknown[]>();
    expect(body).toHaveLength(1);
    expect(body[0]).toMatchObject({ facility_id: "232450", facility_name: "Lower Pines" });
  });
});

describe("POST /api/watches", () => {
  const validPayload = {
    facility_id: "232450",
    facility_name: "Lower Pines",
    start_date: "2026-07-01",
    end_date: "2026-07-31",
  };

  it("creates a watch and returns 201 with the new row", async () => {
    const insertResult = makeWatchRow();
    const db = createMockDb({ insertWatchResult: insertResult });
    const res = await app.request(
      "/api/watches",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(validPayload),
      },
      env(db)
    );
    expect(res.status).toBe(201);
    const body = await res.json<Record<string, unknown>>();
    expect(body.facility_id).toBe("232450");
  });

  it("returns 400 when facility_id is missing", async () => {
    const res = await app.request(
      "/api/watches",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ start_date: "2026-07-01", end_date: "2026-07-31" }),
      },
      env(createMockDb())
    );
    expect(res.status).toBe(400);
    const body = await res.json<{ error: string }>();
    expect(body.error).toMatch(/facility_id/);
  });

  it("returns 400 when start_date is missing", async () => {
    const res = await app.request(
      "/api/watches",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ facility_id: "232450", end_date: "2026-07-31" }),
      },
      env(createMockDb())
    );
    expect(res.status).toBe(400);
  });

  it("accepts site_types and returns 201", async () => {
    const res = await app.request(
      "/api/watches",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...validPayload, site_types: ["STANDARD NONELECTRIC"] }),
      },
      env(createMockDb({ insertWatchResult: makeWatchRow() }))
    );
    expect(res.status).toBe(201);
  });

  it("defaults notify_push to 1 when not specified", async () => {
    const db = createMockDb({ insertWatchResult: makeWatchRow({ notify_push: 1 }) });
    const res = await app.request(
      "/api/watches",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(validPayload),
      },
      env(db)
    );
    expect(res.status).toBe(201);
    const body = await res.json<{ notify_push: number }>();
    expect(body.notify_push).toBe(1);
  });
});

describe("DELETE /api/watches/:id", () => {
  it("returns 200 when the watch exists", async () => {
    const res = await app.request(
      "/api/watches/1",
      { method: "DELETE" },
      env(createMockDb({ watchChanges: 1 }))
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true });
  });

  it("returns 404 when the watch does not exist", async () => {
    const res = await app.request(
      "/api/watches/999",
      { method: "DELETE" },
      env(createMockDb({ watchChanges: 0 }))
    );
    expect(res.status).toBe(404);
    const body = await res.json<{ error: string }>();
    expect(body.error).toMatch(/not found/i);
  });
});

describe("GET /api/watches/:id/history", () => {
  it("returns notification log entries for the watch", async () => {
    const entry = {
      id: 1,
      watch_id: 1,
      campsite_id: "7859",
      check_date: "2026-07-04",
      event_type: "cancellation_found",
      channel: "ntfy",
      sent_at: "2026-03-17 00:00:00",
      payload: "{}",
    };
    const res = await app.request(
      "/api/watches/1/history",
      {},
      env(createMockDb({ notificationLog: [entry] }))
    );
    expect(res.status).toBe(200);
    const body = await res.json<unknown[]>();
    expect(body).toHaveLength(1);
    expect(body[0]).toMatchObject({ campsite_id: "7859" });
  });

  it("returns an empty array when there is no history", async () => {
    const res = await app.request("/api/watches/1/history", {}, env(createMockDb()));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([]);
  });
});
