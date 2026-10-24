import { raceIdForShortCode, readPublicParty } from "@o-tid/application";
import { db } from "../../../../../lib/db";
import { publicRaceResponse } from "../../../../../lib/public-race-gate";

/**
 * Den publika fest-sidans statistik (PLAN.md steg 40), bakom samma grind som tävlingarnas publika sidor. Inga belopp,
 * bricknummer eller interna id:n; namn bara när festen visar namn. Huvudena mot indexering och cache står i next.config.
 */
const notFound = () => Response.json({ formatVersion: 1, error: "NOT_FOUND" }, { status: 404 });

export async function GET(_request: Request, { params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const raceId = /^[2-9a-hjkmnp-z]{6}$/.test(code) ? await raceIdForShortCode(db, code) : undefined;
  if (!raceId) return notFound();
  return publicRaceResponse(raceId, async () => {
    const party = await readPublicParty(db, raceId);
    return party ? Response.json(party) : notFound();
  });
}
