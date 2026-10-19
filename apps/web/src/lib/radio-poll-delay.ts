import { RADIO_POLL_INTERVAL_MS } from "@o-tid/application";

/**
 * Radiopollerns väntan (PLAN.md steg 27): vanliga intervallet utan fel, efter databasfel i följd 20, 40 och högst
 * 60 sekunder, så att en databas som inte är migrerad inte fyller loggen var tionde sekund.
 */
export function radioPollDelay(databaseFailures: number): number {
  return databaseFailures === 0 ? RADIO_POLL_INTERVAL_MS : Math.min(databaseFailures, 3) * 20_000;
}
