import { raceIdForShortCode, readPartyLogo } from "@o-tid/application";
import { db } from "../../../../../../lib/db";
import { publicRaceResponse } from "../../../../../../lib/public-race-gate";

/** Festens logga (PNG eller JPEG), bakom samma grind som fest-sidan. Inget skript kan köras ur bilden. */
export async function GET(_request: Request, { params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const raceId = /^[2-9a-hjkmnp-z]{6}$/.test(code) ? await raceIdForShortCode(db, code) : undefined;
  if (!raceId) return new Response(null, { status: 404 });
  return publicRaceResponse(raceId, async () => {
    const logo = await readPartyLogo(db, raceId);
    if (!logo) return new Response(null, { status: 404 });
    return new Response(new Uint8Array(logo.image), { headers: { "content-type": logo.mediaType, "x-content-type-options": "nosniff",
      "content-security-policy": "default-src 'none'; sandbox" } });
  });
}
