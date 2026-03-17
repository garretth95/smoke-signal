import { RecreationGovProvider } from "./providers/recreation-gov";
import type { CampsiteAvailability } from "./providers/types";
import type { NotificationChannel } from "./notifications/types";
import {
  getActiveWatches,
  getSnapshots,
  upsertSnapshots,
  wasRecentlyNotified,
  logNotification,
  type Watch,
} from "./db/queries";

interface Env {
  DB: D1Database;
}

const PROVIDERS = {
  recreation_gov: new RecreationGovProvider(),
} as const;

/**
 * Returns the set of YYYY-MM months (as Date objects at month start) that a
 * watch's date range spans. Used to know which monthly API calls to make.
 */
function monthsInRange(startDate: string, endDate: string): Date[] {
  const months: Date[] = [];
  const start = new Date(startDate + "T00:00:00Z");
  const end = new Date(endDate + "T00:00:00Z");

  const cursor = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), 1));
  while (cursor <= end) {
    months.push(new Date(cursor));
    cursor.setUTCMonth(cursor.getUTCMonth() + 1);
  }
  return months;
}

/** Key for grouping API calls: provider + facility + YYYY-MM */
function monthKey(provider: string, facilityId: string, month: Date): string {
  const y = month.getUTCFullYear();
  const m = String(month.getUTCMonth() + 1).padStart(2, "0");
  return `${provider}:${facilityId}:${y}-${m}`;
}

function applyWatchFilters(
  availability: CampsiteAvailability[],
  watch: Watch
): CampsiteAvailability[] {
  let filtered = availability;

  // Filter to the watch's date range
  filtered = filtered.filter((a) => a.date >= watch.start_date && a.date <= watch.end_date);

  // Filter by specific site IDs if set
  if (watch.site_ids) {
    const ids = new Set<string>(JSON.parse(watch.site_ids) as string[]);
    filtered = filtered.filter((a) => ids.has(a.campsiteId));
  }

  // Filter by site types if set
  if (watch.site_types) {
    const types = new Set<string>(JSON.parse(watch.site_types) as string[]);
    filtered = filtered.filter((a) => types.has(a.siteType));
  }

  // Filter by loop name if set
  if (watch.loop_name) {
    const loop = watch.loop_name.toLowerCase();
    filtered = filtered.filter((a) => a.loop.toLowerCase() === loop);
  }

  return filtered;
}

function bookingUrl(campsiteId: string): string {
  return `https://www.recreation.gov/camping/campsites/${campsiteId}`;
}

function formatDateDisplay(isoDate: string): string {
  // "2026-07-04" → "Jul 4, 2026"
  const [year, month, day] = isoDate.split("-").map(Number);
  const d = new Date(Date.UTC(year ?? 0, (month ?? 1) - 1, day ?? 1));
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

export async function runCheck(env: Env, notifier: NotificationChannel): Promise<void> {
  const watches = await getActiveWatches(env.DB);
  if (watches.length === 0) return;

  // --- Step 1: Group by (provider, facilityId, month) to deduplicate API calls ---
  type CacheKey = string;
  const fetchPlan = new Map<CacheKey, { provider: string; facilityId: string; month: Date }>();

  for (const watch of watches) {
    for (const month of monthsInRange(watch.start_date, watch.end_date)) {
      const key = monthKey(watch.provider, watch.facility_id, month);
      if (!fetchPlan.has(key)) {
        fetchPlan.set(key, { provider: watch.provider, facilityId: watch.facility_id, month });
      }
    }
  }

  // --- Step 2: Fetch availability for each unique (provider, facility, month) ---
  const availabilityCache = new Map<CacheKey, CampsiteAvailability[]>();

  await Promise.all(
    Array.from(fetchPlan.entries()).map(async ([key, { provider, facilityId, month }]) => {
      const providerImpl = PROVIDERS[provider as keyof typeof PROVIDERS];
      if (!providerImpl) {
        console.error(`Unknown provider: ${provider}`);
        return;
      }
      try {
        const data = await providerImpl.fetchAvailability(facilityId, month);
        availabilityCache.set(key, data);
      } catch (err) {
        console.error(`Failed to fetch availability for ${facilityId} (${provider}):`, err);
      }
    })
  );

  // --- Step 3: For each watch, diff against snapshots and detect cancellations ---
  for (const watch of watches) {
    // Gather all availability for this watch's months
    const months = monthsInRange(watch.start_date, watch.end_date);
    const allAvailability: CampsiteAvailability[] = [];
    for (const month of months) {
      const key = monthKey(watch.provider, watch.facility_id, month);
      const cached = availabilityCache.get(key);
      if (cached) allAvailability.push(...cached);
    }

    const filtered = applyWatchFilters(allAvailability, watch);
    if (filtered.length === 0) continue;

    const snapshots = await getSnapshots(env.DB, watch.id);

    for (const avail of filtered) {
      const snapshotKey = `${avail.campsiteId}:${avail.date}`;
      const previousStatus = snapshots.get(snapshotKey);

      const becameAvailable =
        avail.status === "Available" &&
        previousStatus !== undefined &&
        previousStatus !== "Available";

      if (becameAvailable) {
        const alreadyNotified = await wasRecentlyNotified(
          env.DB,
          watch.id,
          avail.campsiteId,
          avail.date
        );
        if (alreadyNotified) continue;

        const facilityLabel = watch.facility_name ?? watch.facility_id;
        const dateLabel = formatDateDisplay(avail.date);
        const siteLabel = `Site ${avail.siteName}${avail.loop ? ` (${avail.loop})` : ""}`;
        const url = bookingUrl(avail.campsiteId);

        if (watch.notify_push) {
          try {
            await notifier.send({
              title: `Campsite available — ${facilityLabel}`,
              body: `${siteLabel} is open on ${dateLabel}`,
              url,
              priority: "high",
              tags: ["tent", "evergreen_tree"],
            });

            await logNotification(env.DB, {
              watch_id: watch.id,
              campsite_id: avail.campsiteId,
              check_date: avail.date,
              event_type: "cancellation_found",
              channel: "ntfy",
              payload: JSON.stringify({ facilityLabel, siteLabel, dateLabel, url }),
            });
          } catch (err) {
            console.error(`Failed to send notification for watch ${watch.id}:`, err);
          }
        }
      }
    }

    // Upsert snapshots with current state
    await upsertSnapshots(env.DB, watch.id, filtered);
  }
}
