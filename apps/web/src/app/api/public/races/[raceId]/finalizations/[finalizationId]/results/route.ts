import { raceGroupNameDisplay, readPublicFrozenRaceResults } from "@o-tid/application";
import { maskPublicNames } from "@o-tid/domain";
import { db } from "../../../../../../../../lib/db";
import { publicRaceResponse } from "../../../../../../../../lib/public-race-gate";

export const dynamic = "force-dynamic";

export async function GET(_request: Request, { params }: { params: Promise<{ raceId: string; finalizationId: string }> }) {
  const { raceId, finalizationId } = await params;
  return publicRaceResponse(raceId, async () => {
    const [result, names] = await Promise.all([readPublicFrozenRaceResults(db, raceId, finalizationId), raceGroupNameDisplay(db, raceId)]);
    // Steg 68: namnen enligt träningsgruppen; då kan inställningen ändras och listan sparas inte för alltid.
    return result.status === "ok"
      ? Response.json(maskPublicNames(result.response, names), { headers: { "cache-control": names === "FULL"
        ? "public, max-age=31536000, immutable" : "public, max-age=60", "x-content-type-options": "nosniff" } })
      : new Response(null, { status: 404, headers: { "cache-control": "no-store", "x-content-type-options": "nosniff" } });
  });
}
