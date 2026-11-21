import { deleteClubNews, deleteNewsAsSuperadmin, listClubNews, listNewsAsSuperadmin, readNewsImage, saveClubNews, saveNewsAsSuperadmin } from "@o-tid/application";
import { NEWS_REQUEST_MAX_BYTES, newsListSchema, newsSaveResponseSchema } from "@o-tid/contracts";
import type { Database } from "@o-tid/database";
import { failure, guarded, mutation, readProof, type ClubEnvironment } from "./club-route-handlers";
import { privateJson } from "./security-policy";

/**
 * ADR-0230: nyhetsflödets anrop. Samma skydd som kontots och klubbens andra anrop (exakt Origin och CSRF på skrivningar,
 * privata svar utan cache, `mutation`/`readProof` i club-route-handlers); behörigheten avgörs i tjänsterna (`requireSuperadmin`,
 * `requireClubRole`). Kroppen får vara högst `NEWS_REQUEST_MAX_BYTES` (bilden i base64). Inget om nyhetens innehåll loggas.
 */
type Scope = { kind: "SUPERADMIN" } | { kind: "CLUB"; clubId: string };

export async function newsListRoute(db: Database, request: Request, scope: Scope, environment: ClubEnvironment = process.env): Promise<Response> {
  const input = await readProof(request, environment);
  if ("response" in input) return input.response;
  return guarded(async () => {
    const result = scope.kind === "SUPERADMIN" ? await listNewsAsSuperadmin(db, input.proof) : await listClubNews(db, { ...input.proof, clubId: scope.clubId });
    return result.status === "ok" ? privateJson(newsListSchema.parse(result.response)) : failure(result.status);
  });
}

/** POST ny nyhet (utan `newsId`), PUT ändra, DELETE ta bort. */
export async function newsWriteRoute(db: Database, request: Request, scope: Scope, newsId?: string, environment: ClubEnvironment = process.env)
  : Promise<Response> {
  const input = await mutation(request, environment, request.method === "DELETE" ? "none" : "json", NEWS_REQUEST_MAX_BYTES);
  if ("response" in input) return input.response;
  return guarded(async () => {
    if (request.method === "DELETE") {
      if (!newsId) return failure("not-found");
      const result = scope.kind === "SUPERADMIN" ? await deleteNewsAsSuperadmin(db, { ...input.proof, newsId })
        : await deleteClubNews(db, { ...input.proof, clubId: scope.clubId, newsId });
      return result.status === "removed" ? privateJson({ formatVersion: 1, status: "removed" }) : failure(result.status);
    }
    const args = { ...input.proof, request: input.body, ...(newsId ? { newsId } : {}) };
    const result = scope.kind === "SUPERADMIN" ? await saveNewsAsSuperadmin(db, args) : await saveClubNews(db, { ...args, clubId: scope.clubId });
    if (result.status !== "saved") return failure(result.status);
    return privateJson(newsSaveResponseSchema.parse({ formatVersion: 1, item: result.item }), result.created ? 201 : 200);
  });
}

/**
 * Nyhetens bild (16:9 på startsidan). En synlig allmän nyhet får sparas i delade cacher; med rätt version (`?v=`, början av
 * bildens SHA-256) länge. En klubbnyhet eller en dold nyhet bara för den som får se den, och aldrig i en delad cache.
 */
export async function newsImageRoute(db: Database, request: Request, newsId: string, sessionToken: string | null): Promise<Response> {
  return guarded(async () => {
    const image = await readNewsImage(db, newsId, sessionToken);
    if (!image) return new Response(null, { status: 404, headers: { "cache-control": "no-store" } });
    const versioned = new URL(request.url).searchParams.get("v") === image.sha256.slice(0, 16);
    return new Response(new Uint8Array(image.image), { headers: {
      "content-type": image.mediaType, "content-length": String(image.image.byteLength), "x-content-type-options": "nosniff",
      "content-security-policy": "default-src 'none'", etag: `"${image.sha256}"`,
      "cache-control": image.shared ? (versioned ? "public, max-age=31536000, immutable" : "public, max-age=60") : "private, no-store",
      ...(image.shared ? {} : { vary: "Cookie" })
    } });
  });
}
