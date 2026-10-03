import { resolvePublicParticipantRouteMap } from "@o-tid/application";
import { db } from "../../../../../../../../../lib/db";
import { createConfiguredMapStore } from "../../../../../../../../../lib/map-store";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
const missing = () => new Response(null, { status: 404, headers: { "cache-control": "no-store", "x-content-type-options": "nosniff" } });
export async function GET(request: Request, { params }: { params: Promise<{ raceId: string; publicResultId: string }> }) {
  const { raceId, publicResultId } = await params;
  const active = await resolvePublicParticipantRouteMap(db, raceId, publicResultId); if (active.status !== "ok") return missing();
  try {
    const bytes = await createConfiguredMapStore().read(active.manifest, request.signal);
    const current = await resolvePublicParticipantRouteMap(db, raceId, publicResultId);
    if (current.status !== "ok" || current.publicationId !== active.publicationId || current.manifest.versionId !== active.manifest.versionId) return missing();
    return new Response(new Uint8Array(bytes), { headers: { "content-type": active.manifest.mediaType, "content-length": String(bytes.byteLength), "cache-control": "no-store", "x-content-type-options": "nosniff" } });
  } catch { return missing(); }
}
