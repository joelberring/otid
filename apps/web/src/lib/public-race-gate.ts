import { notFound } from "next/navigation";
import { isRacePubliclyVisible } from "@o-tid/application";
import { db } from "./db";

/**
 * Publika sidor och API:er visar bara tävlingar som syns publikt (ADR-0172: inte dolda av superadmin;
 * steg 19 lägger till arrangörens publicering i samma villkor). Dold eller okänd tävling ger 404.
 */
export async function requirePublicRace(raceId: string): Promise<void> {
  if (!await isRacePubliclyVisible(db, raceId)) notFound();
}

export async function hiddenRaceResponse(raceId: string): Promise<Response | undefined> {
  if (await isRacePubliclyVisible(db, raceId)) return undefined;
  return Response.json({ formatVersion: 1, error: "NOT_FOUND" }, { status: 404, headers: { "cache-control": "no-store" } });
}
