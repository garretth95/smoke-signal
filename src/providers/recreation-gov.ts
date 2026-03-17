import type {
  AvailabilityProvider,
  AvailabilityStatus,
  CampsiteAvailability,
  Facility,
} from "./types";

const AVAILABILITY_BASE = "https://www.recreation.gov/api/camps/availability/campground";
const RIDB_BASE = "https://ridb.recreation.gov/api/v1";
const USER_AGENT = "smoke-signal/1.0 (personal use; github.com/garrettwheald/smoke-signal)";

// Shape returned by the Recreation.gov availability API
interface RecGovCampsiteEntry {
  campsite_id: string;
  site: string; // site label e.g. "042"
  campsite_type: string; // e.g. "STANDARD NONELECTRIC"
  loop: string;
  type_of_use: string; // "Overnight" | "Day"
  min_num_people: number;
  max_num_people: number;
  availabilities: Record<string, string>; // ISO timestamp → status string
}

interface RecGovMonthResponse {
  campsites: Record<string, RecGovCampsiteEntry>;
  count: number;
}

// RIDB facility search response shapes
interface RidbFacility {
  FacilityID: string;
  FacilityName: string;
  FacilityDescription?: string;
  FacilityLatitude?: number;
  FacilityLongitude?: number;
}

interface RidbSearchResponse {
  RECDATA: RidbFacility[];
  METADATA: { RESULTS: { CURRENT_COUNT: number; TOTAL_COUNT: number } };
}

function parseStatus(raw: string): AvailabilityStatus {
  switch (raw) {
    case "Available":
      return "Available";
    case "Reserved":
      return "Reserved";
    case "Not Available":
    case "NotAvailable":
      return "NotAvailable";
    default:
      return "Unknown";
  }
}

/**
 * Extract the YYYY-MM-DD date portion from a Recreation.gov ISO timestamp
 * like "2026-07-04T00:00:00Z".
 */
function extractDate(isoTimestamp: string): string {
  return isoTimestamp.slice(0, 10);
}

/**
 * Format a Date as the start_date query param Recreation.gov expects:
 * "YYYY-MM-01T00:00:00.000Z" (always first of the month).
 */
function formatMonthParam(month: Date): string {
  const y = month.getUTCFullYear();
  const m = String(month.getUTCMonth() + 1).padStart(2, "0");
  return `${y}-${m}-01T00:00:00.000Z`;
}

export class RecreationGovProvider implements AvailabilityProvider {
  readonly name = "recreation_gov";

  private readonly ridbApiKey: string | undefined;

  constructor(ridbApiKey?: string) {
    this.ridbApiKey = ridbApiKey;
  }

  /**
   * Fetch all campsite availability for a given facility and calendar month.
   * Returns one CampsiteAvailability record per (campsite, date) pair.
   */
  async fetchAvailability(facilityId: string, month: Date): Promise<CampsiteAvailability[]> {
    const startDate = formatMonthParam(month);
    const url = `${AVAILABILITY_BASE}/${facilityId}/month?start_date=${encodeURIComponent(startDate)}`;

    const response = await fetch(url, {
      headers: {
        "User-Agent": USER_AGENT,
        Accept: "application/json",
      },
    });

    if (!response.ok) {
      throw new Error(
        `Recreation.gov availability API error: ${response.status} ${response.statusText} for facility ${facilityId}`
      );
    }

    const data = await response.json<RecGovMonthResponse>();

    const results: CampsiteAvailability[] = [];

    for (const entry of Object.values(data.campsites)) {
      // Skip day-use sites — we only care about overnight camping
      if (entry.type_of_use !== "Overnight") continue;

      for (const [timestamp, rawStatus] of Object.entries(entry.availabilities)) {
        results.push({
          campsiteId: entry.campsite_id,
          siteName: entry.site,
          siteType: entry.campsite_type,
          loop: entry.loop,
          date: extractDate(timestamp),
          status: parseStatus(rawStatus),
          minPeople: entry.min_num_people,
          maxPeople: entry.max_num_people,
        });
      }
    }

    return results;
  }

  /**
   * Search for campground facilities by name using the RIDB API.
   * Requires a RIDB API key (free at ridb.recreation.gov).
   */
  async searchFacilities(query: string): Promise<Facility[]> {
    if (!this.ridbApiKey) {
      throw new Error("RIDB API key required for facility search");
    }

    const params = new URLSearchParams({
      query,
      activity: "9", // Camping
      limit: "20",
      apikey: this.ridbApiKey,
    });

    const response = await fetch(`${RIDB_BASE}/facilities?${params.toString()}`, {
      headers: {
        "User-Agent": USER_AGENT,
        Accept: "application/json",
      },
    });

    if (!response.ok) {
      throw new Error(`RIDB API error: ${response.status} ${response.statusText}`);
    }

    const data = await response.json<RidbSearchResponse>();

    return data.RECDATA.map((f) => ({
      id: f.FacilityID,
      name: f.FacilityName,
      description: f.FacilityDescription,
      latitude: f.FacilityLatitude,
      longitude: f.FacilityLongitude,
    }));
  }
}
