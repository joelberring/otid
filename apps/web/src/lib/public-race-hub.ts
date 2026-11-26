import { cache } from "react";
import { notFound } from "next/navigation";
import { isRadioLive, raceIdForShortCode, readPublicRaceHub, type PublicRaceHub } from "@o-tid/application";
import { db } from "./db";
import { cachedPublicRouteIndex } from "./public-race-data";
import { raceAccess } from "./public-race-gate";
import { retryReadConflicts } from "./read-conflict";

/**
 * Tävlingssidan (/t/{kod}) och QR-sidan läser samma underlag (ADR-0172 beslut 4), bakom samma grind som de
 * andra publika sidorna. `cache` gör att sidan och dess metadata delar en läsning per begäran.
 * Undefined = tävlingen syns inte (sidan visar "Tävlingen är inte publicerad").
 */
/** `radio`: radiokontrollerna är påslagna (ADR-0172 beslut 5), mellantiderna syns i resultatlistan. */
export type RaceHubView = PublicRaceHub & { access: "PUBLIC" | "PREVIEW"; routes: boolean; radio: boolean };

type LoadRaceHubOptions = {
  /** Sätt `false` för sidor som inte visar vägvalslänken (Live, QR, Fest) så GPS-spår inte läses alls. */
  readonly includeRoutes?: boolean;
};

// Primitiva argument gör att React `cache` träffar lika mellan `generateMetadata` och sidkomponenten.
const loadRaceHubCached = cache(async (code: string, includeRoutes: boolean): Promise<RaceHubView | undefined> => {
  const raceId = await raceIdForShortCode(db, code);
  if (!raceId) return undefined;
  const access = await raceAccess(raceId);
  if (access === "NONE") return undefined;
  // Steg 51: en läsning som avbröts av en samtidig ändring (en funktionär flyttar starttider) görs om i stället för 500.
  const [hub, routes, radio] = await retryReadConflicts(() => Promise.all([
    readPublicRaceHub(db, raceId),
    includeRoutes ? cachedPublicRouteIndex(raceId, { exact: true }).then(entry => entry.value) : Promise.resolve(undefined),
    isRadioLive(db, raceId)
  ]));
  if (!hub) return undefined;
  return { ...hub, access, routes: routes ? Object.keys(routes.legs).length > 0 : false, radio };
});

export function loadRaceHub(code: string, options?: LoadRaceHubOptions): Promise<RaceHubView | undefined> {
  return loadRaceHubCached(code, options?.includeRoutes ?? true);
}

export async function requireRaceHub(code: string, options?: LoadRaceHubOptions): Promise<RaceHubView> {
  const hub = await loadRaceHub(code, options);
  if (!hub) notFound();
  return hub;
}
