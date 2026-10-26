import type { getPublicStartList } from "@o-tid/application";
import { publicStartListResponseSchema, type PublicStartListResponse } from "@o-tid/contracts";
import { cachedJsonResponse, type CachedPublic } from "./public-race-cache";

const headers = { "cache-control": "no-store", "x-content-type-options": "nosniff" };

/** Den publicerade startlistan som den får visas (validerad), eller null när ingen lista är publicerad. */
export function publicStartListValue(result: Awaited<ReturnType<typeof getPublicStartList>>): PublicStartListResponse | null {
  return result.status === "published" ? publicStartListResponseSchema.parse(result.response) : null;
}

/**
 * Startlistan ur cachen per tävlingsversion (steg 51, `cachedPublicStartList`): bara validerad data, gzip och ETag,
 * aldrig i en delad cache. Fel ger 503 utan innehåll, ingen lista 404.
 */
export async function cachedPublicStartListRoute(request: Request,
  read: () => Promise<CachedPublic<PublicStartListResponse | null>>): Promise<Response> {
  try {
    const entry = await read();
    if (entry.value === null) return new Response(null, { status: 404, headers });
    const response = cachedJsonResponse(request, entry, headers["cache-control"]);
    response.headers.set("x-content-type-options", headers["x-content-type-options"]);
    return response;
  } catch { return new Response(null, { status: 503, headers }); }
}
