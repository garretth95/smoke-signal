import { describe, it, expect, vi, beforeEach } from "vitest";
import { runCheck } from "../src/checker";
import type { Watch } from "../src/db/queries";
import type { CampsiteAvailability } from "../src/providers/types";
import type { NotificationChannel, NotificationMessage } from "../src/notifications/types";

// --- Module mocks ---
// vi.mock calls are hoisted, so variables they reference must use vi.hoisted()

const {
  mockFetchAvailability,
  mockGetActiveWatches,
  mockGetSnapshots,
  mockUpsertSnapshots,
  mockWasRecentlyNotified,
  mockLogNotification,
} = vi.hoisted(() => ({
  mockFetchAvailability:
    vi.fn<(facilityId: string, month: Date) => Promise<CampsiteAvailability[]>>(),
  mockGetActiveWatches: vi.fn<() => Promise<Watch[]>>(),
  mockGetSnapshots: vi.fn<() => Promise<Map<string, string>>>(),
  mockUpsertSnapshots: vi.fn<() => Promise<void>>(),
  mockWasRecentlyNotified: vi.fn<() => Promise<boolean>>(),
  mockLogNotification: vi.fn<() => Promise<void>>(),
}));

vi.mock("../src/providers/recreation-gov", () => ({
  RecreationGovProvider: vi.fn().mockImplementation(() => ({
    name: "recreation_gov",
    fetchAvailability: mockFetchAvailability,
  })),
}));

vi.mock("../src/db/queries", () => ({
  getActiveWatches: mockGetActiveWatches,
  getSnapshots: mockGetSnapshots,
  upsertSnapshots: mockUpsertSnapshots,
  wasRecentlyNotified: mockWasRecentlyNotified,
  logNotification: mockLogNotification,
}));

// --- Helpers ---

function makeWatch(overrides: Partial<Watch> = {}): Watch {
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
    ...overrides,
  };
}

function makeAvailability(overrides: Partial<CampsiteAvailability> = {}): CampsiteAvailability {
  return {
    campsiteId: "7859",
    siteName: "042",
    siteType: "STANDARD NONELECTRIC",
    loop: "NORTH PINES",
    date: "2026-07-04",
    status: "Available",
    minPeople: 1,
    maxPeople: 6,
    ...overrides,
  };
}

function makeNotifier(): { channel: NotificationChannel; sent: NotificationMessage[] } {
  const sent: NotificationMessage[] = [];
  const channel: NotificationChannel = {
    name: "test",
    send: vi.fn((msg: NotificationMessage) => {
      sent.push(msg);
      return Promise.resolve();
    }),
  };
  return { channel, sent };
}

const fakeDb = {} as D1Database;
const fakeEnv = { DB: fakeDb };

// --- Tests ---

beforeEach(() => {
  vi.clearAllMocks();
  mockUpsertSnapshots.mockResolvedValue(undefined);
  mockLogNotification.mockResolvedValue(undefined);
  mockWasRecentlyNotified.mockResolvedValue(false);
});

describe("runCheck", () => {
  it("does nothing when there are no active watches", async () => {
    mockGetActiveWatches.mockResolvedValue([]);
    const { channel } = makeNotifier();
    await runCheck(fakeEnv, channel);
    expect(mockFetchAvailability).not.toHaveBeenCalled();
  });

  it("fetches availability and upserts snapshots on first run (no prior snapshots)", async () => {
    const watch = makeWatch();
    const avail = makeAvailability({ status: "Reserved" });

    mockGetActiveWatches.mockResolvedValue([watch]);
    mockFetchAvailability.mockResolvedValue([avail]);
    mockGetSnapshots.mockResolvedValue(new Map()); // no prior state

    const { channel, sent } = makeNotifier();
    await runCheck(fakeEnv, channel);

    expect(mockFetchAvailability).toHaveBeenCalledOnce();
    expect(mockUpsertSnapshots).toHaveBeenCalledOnce();
    expect(sent).toHaveLength(0); // no notification — no prior state to diff against
  });

  it("does not notify when status is unchanged", async () => {
    const watch = makeWatch();
    const avail = makeAvailability({ status: "Reserved" });

    mockGetActiveWatches.mockResolvedValue([watch]);
    mockFetchAvailability.mockResolvedValue([avail]);
    // Prior snapshot also Reserved
    mockGetSnapshots.mockResolvedValue(new Map([["7859:2026-07-04", "Reserved"]]));

    const { channel, sent } = makeNotifier();
    await runCheck(fakeEnv, channel);

    expect(sent).toHaveLength(0);
  });

  it("notifies when a site transitions from Reserved to Available", async () => {
    const watch = makeWatch();
    const avail = makeAvailability({ status: "Available" });

    mockGetActiveWatches.mockResolvedValue([watch]);
    mockFetchAvailability.mockResolvedValue([avail]);
    mockGetSnapshots.mockResolvedValue(new Map([["7859:2026-07-04", "Reserved"]]));

    const { channel, sent } = makeNotifier();
    await runCheck(fakeEnv, channel);

    expect(sent).toHaveLength(1);
    expect(sent[0]?.title).toContain("Lower Pines");
    expect(sent[0]?.body).toContain("Site 042");
    expect(sent[0]?.body).toContain("Jul 4, 2026");
    expect(sent[0]?.url).toBe("https://www.recreation.gov/camping/campsites/7859");
    expect(sent[0]?.priority).toBe("high");
    expect(mockLogNotification).toHaveBeenCalledOnce();
  });

  it("notifies when a site transitions from NotAvailable to Available", async () => {
    const watch = makeWatch();
    const avail = makeAvailability({ status: "Available" });

    mockGetActiveWatches.mockResolvedValue([watch]);
    mockFetchAvailability.mockResolvedValue([avail]);
    mockGetSnapshots.mockResolvedValue(new Map([["7859:2026-07-04", "NotAvailable"]]));

    const { channel, sent } = makeNotifier();
    await runCheck(fakeEnv, channel);

    expect(sent).toHaveLength(1);
  });

  it("does not notify when site was already Available in the snapshot", async () => {
    const watch = makeWatch();
    const avail = makeAvailability({ status: "Available" });

    mockGetActiveWatches.mockResolvedValue([watch]);
    mockFetchAvailability.mockResolvedValue([avail]);
    // Was already available — not a new cancellation
    mockGetSnapshots.mockResolvedValue(new Map([["7859:2026-07-04", "Available"]]));

    const { channel, sent } = makeNotifier();
    await runCheck(fakeEnv, channel);

    expect(sent).toHaveLength(0);
  });

  it("skips notification when already notified recently (dedup)", async () => {
    const watch = makeWatch();
    const avail = makeAvailability({ status: "Available" });

    mockGetActiveWatches.mockResolvedValue([watch]);
    mockFetchAvailability.mockResolvedValue([avail]);
    mockGetSnapshots.mockResolvedValue(new Map([["7859:2026-07-04", "Reserved"]]));
    mockWasRecentlyNotified.mockResolvedValue(true); // already notified

    const { channel, sent } = makeNotifier();
    await runCheck(fakeEnv, channel);

    expect(sent).toHaveLength(0);
    expect(mockLogNotification).not.toHaveBeenCalled();
  });

  it("does not send push notification when notify_push is 0", async () => {
    const watch = makeWatch({ notify_push: 0 });
    const avail = makeAvailability({ status: "Available" });

    mockGetActiveWatches.mockResolvedValue([watch]);
    mockFetchAvailability.mockResolvedValue([avail]);
    mockGetSnapshots.mockResolvedValue(new Map([["7859:2026-07-04", "Reserved"]]));

    const { channel, sent } = makeNotifier();
    await runCheck(fakeEnv, channel);

    expect(sent).toHaveLength(0);
  });

  it("filters by site type — excludes non-matching types", async () => {
    const watch = makeWatch({ site_types: JSON.stringify(["TENT ONLY NONELECTRIC"]) });
    const avail = makeAvailability({ status: "Available", siteType: "STANDARD NONELECTRIC" });

    mockGetActiveWatches.mockResolvedValue([watch]);
    mockFetchAvailability.mockResolvedValue([avail]);
    mockGetSnapshots.mockResolvedValue(new Map([["7859:2026-07-04", "Reserved"]]));

    const { channel, sent } = makeNotifier();
    await runCheck(fakeEnv, channel);

    expect(sent).toHaveLength(0);
    // Filtered out, so nothing to upsert either
    expect(mockUpsertSnapshots).not.toHaveBeenCalled();
  });

  it("filters by loop name (case-insensitive)", async () => {
    const watch = makeWatch({ loop_name: "south pines" });
    const avail = makeAvailability({ status: "Available", loop: "NORTH PINES" });

    mockGetActiveWatches.mockResolvedValue([watch]);
    mockFetchAvailability.mockResolvedValue([avail]);
    mockGetSnapshots.mockResolvedValue(new Map([["7859:2026-07-04", "Reserved"]]));

    const { channel, sent } = makeNotifier();
    await runCheck(fakeEnv, channel);

    expect(sent).toHaveLength(0);
  });

  it("filters by specific site IDs", async () => {
    const watch = makeWatch({ site_ids: JSON.stringify(["9999"]) });
    const avail = makeAvailability({ status: "Available", campsiteId: "7859" });

    mockGetActiveWatches.mockResolvedValue([watch]);
    mockFetchAvailability.mockResolvedValue([avail]);
    mockGetSnapshots.mockResolvedValue(new Map([["7859:2026-07-04", "Reserved"]]));

    const { channel, sent } = makeNotifier();
    await runCheck(fakeEnv, channel);

    expect(sent).toHaveLength(0);
  });

  it("excludes dates outside the watch range", async () => {
    const watch = makeWatch({ start_date: "2026-07-10", end_date: "2026-07-15" });
    const avail = makeAvailability({ status: "Available", date: "2026-07-04" }); // before range

    mockGetActiveWatches.mockResolvedValue([watch]);
    mockFetchAvailability.mockResolvedValue([avail]);
    mockGetSnapshots.mockResolvedValue(new Map([["7859:2026-07-04", "Reserved"]]));

    const { channel, sent } = makeNotifier();
    await runCheck(fakeEnv, channel);

    expect(sent).toHaveLength(0);
  });

  it("makes only one API call when two watches share the same facility and month", async () => {
    const watch1 = makeWatch({ id: 1 });
    const watch2 = makeWatch({ id: 2 }); // same facility_id, same month

    mockGetActiveWatches.mockResolvedValue([watch1, watch2]);
    mockFetchAvailability.mockResolvedValue([]);
    mockGetSnapshots.mockResolvedValue(new Map());

    const { channel } = makeNotifier();
    await runCheck(fakeEnv, channel);

    expect(mockFetchAvailability).toHaveBeenCalledOnce();
  });

  it("makes two API calls for a watch spanning two calendar months", async () => {
    const watch = makeWatch({ start_date: "2026-06-28", end_date: "2026-07-05" });

    mockGetActiveWatches.mockResolvedValue([watch]);
    mockFetchAvailability.mockResolvedValue([]);
    mockGetSnapshots.mockResolvedValue(new Map());

    const { channel } = makeNotifier();
    await runCheck(fakeEnv, channel);

    expect(mockFetchAvailability).toHaveBeenCalledTimes(2);
    const months = mockFetchAvailability.mock.calls.map((c) => c[1].getUTCMonth());
    expect(months).toContain(5); // June (0-indexed)
    expect(months).toContain(6); // July
  });

  it("continues processing other watches when one API call fails", async () => {
    const watch1 = makeWatch({ id: 1, facility_id: "111111" });
    const watch2 = makeWatch({ id: 2, facility_id: "222222" });
    const avail = makeAvailability({ status: "Available" });

    mockGetActiveWatches.mockResolvedValue([watch1, watch2]);
    mockFetchAvailability
      .mockRejectedValueOnce(new Error("rate limited")) // watch1 fails
      .mockResolvedValueOnce([avail]); // watch2 succeeds
    mockGetSnapshots.mockResolvedValue(new Map([["7859:2026-07-04", "Reserved"]]));

    const { channel, sent } = makeNotifier();
    await runCheck(fakeEnv, channel);

    // watch2 still fires a notification
    expect(sent).toHaveLength(1);
  });

  it("sends one notification per newly available site, not per watch", async () => {
    const watch = makeWatch();
    const avail1 = makeAvailability({
      campsiteId: "7859",
      date: "2026-07-04",
      status: "Available",
    });
    const avail2 = makeAvailability({
      campsiteId: "7860",
      date: "2026-07-04",
      status: "Available",
    });

    mockGetActiveWatches.mockResolvedValue([watch]);
    mockFetchAvailability.mockResolvedValue([avail1, avail2]);
    mockGetSnapshots.mockResolvedValue(
      new Map([
        ["7859:2026-07-04", "Reserved"],
        ["7860:2026-07-04", "Reserved"],
      ])
    );

    const { channel, sent } = makeNotifier();
    await runCheck(fakeEnv, channel);

    expect(sent).toHaveLength(2);
  });
});
