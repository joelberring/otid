import { exportPublicIofResultList } from "@o-tid/application";
import { db } from "../../../../../../lib/db";
import { hiddenRaceResponse } from "../../../../../../lib/public-race-gate";

const headers = { "cache-control": "no-store", "x-content-type-options": "nosniff" };

/** PLAN.md steg 13: de publika resultaten som IOF XML 3.0 (utan externa id:n). */
export async function GET(_request: Request, { params }: { params: Promise<{ raceId: string }> }) {
  const { raceId } = await params;
  const hidden = await hiddenRaceResponse(raceId);
  if (hidden) return hidden;
  const result = await exportPublicIofResultList(db, raceId);
  if (result.status !== "ok") return new Response(null, { status: result.status === "not-found" ? 404 : 409, headers });
  return new Response(Uint8Array.from(result.bytes), { headers: { ...headers, "content-type": "application/xml; charset=utf-8",
    "content-disposition": `attachment; filename="resultat.xml"` } });
}
