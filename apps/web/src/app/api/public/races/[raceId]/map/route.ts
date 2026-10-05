import { readPublicRaceMapImage } from "@o-tid/application";
import { db } from "../../../../../../lib/db";
import { publicRaceResponse } from "../../../../../../lib/public-race-gate";

/**
 * Kartbilden för vägvalen (PLAN.md steg 16), bara när kartan är georefererad. Med rätt version (`?v=`, början av
 * bildens SHA-256) får webbläsaren spara den länge; en ny bild får en ny version.
 */
export async function GET(request: Request, context: { params: Promise<{ raceId: string }> }) {
  const { raceId } = await context.params;
  return publicRaceResponse(raceId, async () => {
    const map = await readPublicRaceMapImage(db, raceId);
    if (!map) return new Response(null, { status: 404, headers: { "cache-control": "no-store" } });
    const version = new URL(request.url).searchParams.get("v");
    return new Response(new Uint8Array(map.image), { headers: {
      "content-type": map.mediaType, "content-length": String(map.image.byteLength), "x-content-type-options": "nosniff",
      "content-security-policy": "default-src 'none'", etag: `"${map.sha256}"`,
      "cache-control": version === map.sha256.slice(0, 16) ? "public, max-age=31536000, immutable" : "public, max-age=60"
    } });
  });
}
