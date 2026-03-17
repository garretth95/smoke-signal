export type AvailabilityStatus = "Available" | "Reserved" | "NotAvailable" | "Unknown";

export interface CampsiteAvailability {
  campsiteId: string;
  siteName: string;
  siteType: string;
  loop: string;
  date: string; // ISO date "YYYY-MM-DD"
  status: AvailabilityStatus;
  minPeople?: number;
  maxPeople?: number;
}

export interface Facility {
  id: string;
  name: string;
  description?: string;
  latitude?: number;
  longitude?: number;
}

export interface AvailabilityProvider {
  readonly name: string;
  fetchAvailability(facilityId: string, month: Date): Promise<CampsiteAvailability[]>;
  searchFacilities?(query: string): Promise<Facility[]>;
}
