import { readPublicParty } from "@o-tid/application";
import { db } from "../../../../../lib/db";
import { publicRaceResponse } from "../../../../../lib/public-race-gate";

/**
 * Den publika fest-sidans statistik (PLAN.md steg 40), bakom samma grind som tävlingarnas publika sidor. Inga belopp,
 * bricknummer eller interna id:n i svaret; namn bara när festen visar namn. Huvudena mot indexering och cache står i
 * next.config.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ raceId: string }> }) {
  const { raceId } = await params;
  return publicRaceResponse(raceId, async () => {
    const party = await readPublicParty(db, raceId);
    return party ? Response.json(party) : Response.json({ formatVersion: 1, error: "NOT_FOUND" }, { status: 404 });
  });
}
