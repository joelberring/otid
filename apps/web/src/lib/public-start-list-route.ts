import { getPublicStartList } from "@o-tid/application";
import { publicStartListResponseSchema } from "@o-tid/contracts";
import type { Database } from "@o-tid/database";

const headers = { "cache-control": "no-store", "x-content-type-options": "nosniff" };
export async function publicStartListRoute(db: Database, raceId: string, read = getPublicStartList): Promise<Response> {
  try {
    const result = await read(db, raceId);
    if (result.status !== "published") return new Response(null, { status: 404, headers });
    return Response.json(publicStartListResponseSchema.parse(result.response), { headers });
  } catch { return new Response(null, { status: 503, headers }); }
}
