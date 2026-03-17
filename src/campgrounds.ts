export interface Campground {
  id: string;
  name: string;
  park: string;
  state: string;
}

import rawData from "./campgrounds.json";

export const CAMPGROUNDS: Campground[] = rawData as Campground[];
