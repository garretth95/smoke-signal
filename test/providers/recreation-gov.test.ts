import { describe, it, expect, vi, beforeEach } from "vitest";
import { RecreationGovProvider } from "../../src/providers/recreation-gov";
import fixture from "../fixtures/rec-gov-month-response.json";

describe("RecreationGovProvider", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: () => fixture,
      })
    );
  });

  it("returns only overnight campsites", async () => {
    const provider = new RecreationGovProvider();
    const results = await provider.fetchAvailability("232450", new Date("2026-07-01"));
    // Day-use site 7860 should be excluded
    const ids = new Set(results.map((r) => r.campsiteId));
    expect(ids.has("7860")).toBe(false);
    expect(ids.has("7859")).toBe(true);
  });

  it("maps statuses correctly", async () => {
    const provider = new RecreationGovProvider();
    const results = await provider.fetchAvailability("232450", new Date("2026-07-01"));
    const byDate = Object.fromEntries(results.map((r) => [r.date, r.status]));
    expect(byDate["2026-07-01"]).toBe("Reserved");
    expect(byDate["2026-07-02"]).toBe("Available");
    expect(byDate["2026-07-03"]).toBe("NotAvailable");
  });

  it("includes metadata on each record", async () => {
    const provider = new RecreationGovProvider();
    const results = await provider.fetchAvailability("232450", new Date("2026-07-01"));
    const r = results[0]!;
    expect(r.siteType).toBe("STANDARD NONELECTRIC");
    expect(r.loop).toBe("NORTH PINES");
    expect(r.siteName).toBe("042");
    expect(r.minPeople).toBe(1);
    expect(r.maxPeople).toBe(6);
  });

  it("throws on non-OK response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: false, status: 429, statusText: "Too Many Requests" })
    );
    const provider = new RecreationGovProvider();
    await expect(provider.fetchAvailability("232450", new Date("2026-07-01"))).rejects.toThrow(
      "429"
    );
  });

  it("throws from searchFacilities when no API key provided", async () => {
    const provider = new RecreationGovProvider();
    await expect(provider.searchFacilities("yosemite")).rejects.toThrow("RIDB API key");
  });
});
