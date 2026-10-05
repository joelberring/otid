import { cache } from "react";
import { notFound } from "next/navigation";
import { raceIdForShortCode, readPublicRaceHub, readPublicRouteIndex, type PublicRaceHub } from "@o-tid/application";
import { db } from "./db";
import { raceAccess } from "./public-race-gate";

/**
 * Tävlingssidan (/t/{kod}) och QR-sidan läser samma underlag (ADR-0172 beslut 4), bakom samma grind som de
 * andra publika sidorna. `cache` gör att sidan och dess metadata delar en läsning per begäran.
 * Undefined = tävlingen syns inte (sidan visar "Tävlingen är inte publicerad").
 */
export type RaceHubView = PublicRaceHub & { access: "PUBLIC" | "PREVIEW"; routes: boolean };

export const loadRaceHub = cache(async (code: string): Promise<RaceHubView | undefined> => {
  const raceId = await raceIdForShortCode(db, code);
  if (!raceId) return undefined;
  const access = await raceAccess(raceId);
  if (access === "NONE") return undefined;
  const [hub, routes] = await Promise.all([readPublicRaceHub(db, raceId), readPublicRouteIndex(db, raceId)]);
  if (!hub) return undefined;
  return { ...hub, access, routes: Object.keys(routes.legs).length > 0 };
});

export async function requireRaceHub(code: string): Promise<RaceHubView> {
  const hub = await loadRaceHub(code);
  if (!hub) notFound();
  return hub;
}
