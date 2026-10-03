import { getPublishedStartListXml } from "@o-tid/application";
import type { Database } from "@o-tid/database";

const headers = { "cache-control": "no-store", "x-content-type-options": "nosniff" };
export async function publicStartListXmlRoute(db: Database, raceId: string, read = getPublishedStartListXml): Promise<Response> {
  try {
    const result = await read(db, raceId);
    if (result.status !== "exported") return new Response(null, { status: result.status === "unavailable" ? 409 : 404, headers });
    return new Response(result.xml, { headers: { ...headers,
      "content-type": "application/xml; charset=utf-8",
      "content-disposition": `attachment; filename="startlista-${result.revision}.xml"`
    } });
  } catch { return new Response(null, { status: 503, headers }); }
}
