import { describe, it, expect } from "vitest";
import app from "../../src/api/router";
import { createMockDb, makeReminderRow, fakeEnv } from "../helpers/mock-db";

const env = (db: D1Database) => ({ ...fakeEnv, DB: db });

describe("GET /api/reminders", () => {
  it("returns an empty array when there are no reminders", async () => {
    const res = await app.request("/api/reminders", {}, env(createMockDb()));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([]);
  });

  it("returns the list of pending reminders", async () => {
    const reminder = makeReminderRow();
    const res = await app.request(
      "/api/reminders",
      {},
      env(createMockDb({ reminders: [reminder] }))
    );
    expect(res.status).toBe(200);
    const body = await res.json<unknown[]>();
    expect(body).toHaveLength(1);
    expect(body[0]).toMatchObject({ facility_id: "232450", target_date: "2026-07-04" });
  });
});

describe("POST /api/reminders", () => {
  const validPayload = {
    facility_id: "232450",
    facility_name: "Lower Pines",
    target_date: "2026-07-04",
    nights: 2,
    window_months: 6,
    remind_days_before: 3,
  };

  it("creates a reminder and returns 201 with the new row", async () => {
    const insertResult = makeReminderRow();
    const res = await app.request(
      "/api/reminders",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(validPayload),
      },
      env(createMockDb({ insertReminderResult: insertResult }))
    );
    expect(res.status).toBe(201);
    const body = await res.json<Record<string, unknown>>();
    expect(body.facility_id).toBe("232450");
    expect(body.target_date).toBe("2026-07-04");
  });

  it("returns 400 when facility_id is missing", async () => {
    const res = await app.request(
      "/api/reminders",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ target_date: "2026-07-04" }),
      },
      env(createMockDb())
    );
    expect(res.status).toBe(400);
    const body = await res.json<{ error: string }>();
    expect(body.error).toMatch(/facility_id/);
  });

  it("returns 400 when target_date is missing", async () => {
    const res = await app.request(
      "/api/reminders",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ facility_id: "232450" }),
      },
      env(createMockDb())
    );
    expect(res.status).toBe(400);
  });

  it("uses default values when optional fields are omitted", async () => {
    const insertResult = makeReminderRow({ nights: 1, window_months: 6, remind_days_before: 3 });
    const res = await app.request(
      "/api/reminders",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ facility_id: "232450", target_date: "2026-07-04" }),
      },
      env(createMockDb({ insertReminderResult: insertResult }))
    );
    expect(res.status).toBe(201);
    const body = await res.json<Record<string, unknown>>();
    expect(body.nights).toBe(1);
    expect(body.window_months).toBe(6);
    expect(body.remind_days_before).toBe(3);
  });
});

describe("DELETE /api/reminders/:id", () => {
  it("returns 200 when the reminder exists", async () => {
    const res = await app.request(
      "/api/reminders/1",
      { method: "DELETE" },
      env(createMockDb({ reminderChanges: 1 }))
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true });
  });

  it("returns 404 when the reminder does not exist", async () => {
    const res = await app.request(
      "/api/reminders/999",
      { method: "DELETE" },
      env(createMockDb({ reminderChanges: 0 }))
    );
    expect(res.status).toBe(404);
    const body = await res.json<{ error: string }>();
    expect(body.error).toMatch(/not found/i);
  });
});
