import { readActiveMapPublication } from "@o-tid/application";
import { createConfiguredMapStore } from "../../../../../../lib/map-store";
import { db } from "../../../../../../lib/db";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request, { params }: { params: Promise<{ raceId: string }> }) {
  const { raceId } = await params;
  const active = await readActiveMapPublication(db, raceId);
  if (!active) return new Response(null, { status: 404, headers: { "cache-control": "no-store" } });
  try {
    const store = createConfiguredMapStore();
    const bytes = await store.read(active.manifest, request.signal);
    const current = await readActiveMapPublication(db, raceId);
    if (!current || current.publication.id !== active.publication.id || current.manifest.versionId !== active.manifest.versionId) {
      return new Response(null, { status: 404, headers: { "cache-control": "no-store", "x-content-type-options": "nosniff" } });
    }
    const body = new Uint8Array(bytes.byteLength);
    body.set(bytes);
    return new Response(body.buffer, { headers: { "content-type": active.manifest.mediaType, "content-length": String(bytes.byteLength), "cache-control": "no-store", "x-content-type-options": "nosniff" } });
  } catch {
    return new Response(null, { status: 404, headers: { "cache-control": "no-store", "x-content-type-options": "nosniff" } });
  }
}
