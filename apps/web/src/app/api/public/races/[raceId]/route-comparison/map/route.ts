import { resolvePublicParticipantRouteComparisonMap } from "@o-tid/application";
import { db } from "../../../../../../../lib/db";
import { createConfiguredMapStore } from "../../../../../../../lib/map-store";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
const missing = () => new Response(null, { status: 404, headers: { "cache-control": "no-store", "x-content-type-options": "nosniff" } });
export async function GET(request: Request, { params }: { params: Promise<{ raceId: string }> }) {
  const { raceId } = await params;
  const url = new URL(request.url);
  const first = url.searchParams.get("first") ?? "", second = url.searchParams.get("second") ?? "", third = url.searchParams.get("third") ?? undefined;
  const active = await resolvePublicParticipantRouteComparisonMap(db, raceId, first, second, third); if (active.status !== "ok") return missing();
  try {
    const bytes = await createConfiguredMapStore().read(active.manifest, request.signal);
    const current = await resolvePublicParticipantRouteComparisonMap(db, raceId, first, second, third);
    if (current.status !== "ok" || current.publicationIds.length !== active.publicationIds.length || current.publicationIds.some((publicationId, index) => publicationId !== active.publicationIds[index]) || current.manifest.versionId !== active.manifest.versionId) return missing();
    return new Response(new Uint8Array(bytes), { headers: { "content-type": active.manifest.mediaType, "content-length": String(bytes.byteLength), "cache-control": "no-store", "x-content-type-options": "nosniff" } });
  } catch { return missing(); }
}
