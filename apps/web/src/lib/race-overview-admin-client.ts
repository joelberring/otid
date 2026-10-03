import { raceOverviewResponseSchema, type RaceOverviewResponse } from "@o-tid/contracts";
import { sv } from "../i18n/sv";
import { readRaceOverviewAdminCsrfCookie } from "./race-overview-admin-cookies";

export function parseRaceOverview(value: unknown, expectedRaceId: string): RaceOverviewResponse {
  const parsed = raceOverviewResponseSchema.safeParse(value);
  if (!parsed.success || parsed.data.race.id !== expectedRaceId) {
    throw new Error(sv.raceOverviewInvalidResponse);
  }
  return parsed.data;
}

export function readRaceOverviewAdminCsrf(cookieText: string, currentUrl: URL): string {
  const value = readRaceOverviewAdminCsrfCookie(cookieText, currentUrl);
  if (value !== undefined && /^[A-Za-z0-9_-]{43}$/.test(value)) return value;
  throw new Error(sv.raceOverviewLoginAgain);
}
