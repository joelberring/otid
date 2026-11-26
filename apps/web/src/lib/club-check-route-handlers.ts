import {
  readClubEntryThumbnail, readClubMapVersionThumbnail, refreshClubCourseSummaries, saveClubEntryThumbnail, saveClubMapVersionCheck, type ThumbnailRead
} from "@o-tid/application";
import { CLUB_THUMBNAIL_REQUEST_MAX_BYTES, UUID_PATTERN } from "@o-tid/contracts";
import type { Database } from "@o-tid/database";
import { failure, guarded, mutation, readProof, type ClubEnvironment } from "./club-route-handlers";
import { bufferView, matchesIfNoneMatch } from "./http-etag";
import { privateHeaders, privateJson } from "./security-policy";

/**
 * ADR-0196: kontrollen av klubbarkivets kartversioner och bilderna av kartorna och träningarna. Samma skydd som arkivets
 * övriga anrop (club-route-handlers.ts); GET ger PNG:n till medlemmar, PUT sparar kontrollen och bilden för administratörer.
 */
const validId = (id: string) => UUID_PATTERN.test(id);

function png(result: ThumbnailRead, request: Request): Response {
  if (result.status !== "ok" && result.status !== "not-modified") return failure(result.status);
  const version = new URL(request.url).searchParams.get("v");
  const stampMs = Date.parse(result.stamp);
  const versioned = version !== null && (version === result.stamp || (Number.isFinite(stampMs) && version === String(stampMs)));
  const cache = {
    ...privateHeaders,
    "cache-control": versioned ? "private, max-age=86400, immutable" : "private, no-cache",
    etag: result.etag,
    vary: "Cookie"
  };
  if (result.status === "not-modified" || matchesIfNoneMatch(request.headers.get("if-none-match"), result.etag)) {
    return new Response(null, { status: 304, headers: cache });
  }
  return new Response(bufferView(result.png), {
    headers: { ...cache, "content-type": "image/png", "content-length": String(result.png.byteLength) }
  });
}

/** GET kartversionens bild, PUT kontrollen (fungerar eller varför inte) med bilden. */
export async function clubMapVersionCheckRoute(db: Database, request: Request, clubId: string, versionId: string, environment: ClubEnvironment = process.env)
  : Promise<Response> {
  if (!validId(clubId) || !validId(versionId)) return failure("not-found");
  if (request.method === "GET") {
    const input = await readProof(request, environment);
    if ("response" in input) return input.response;
    const ifNoneMatch = request.headers.get("if-none-match");
    return guarded(async () => png(await readClubMapVersionThumbnail(db, { ...input.proof, clubId, versionId, ifNoneMatch }), request));
  }
  const input = await mutation(request, environment, "json", CLUB_THUMBNAIL_REQUEST_MAX_BYTES);
  if ("response" in input) return input.response;
  return guarded(async () => {
    const result = await saveClubMapVersionCheck(db, { ...input.proof, clubId, versionId, request: input.body });
    return result.status === "ok" ? privateJson({ formatVersion: 1, status: "ok" }) : failure(result.status);
  });
}

/** GET träningens bild, PUT bilden (eller att kartan inte kunde ritas). */
export async function clubEntryThumbnailRoute(db: Database, request: Request, clubId: string, entryId: string, environment: ClubEnvironment = process.env)
  : Promise<Response> {
  if (!validId(clubId) || !validId(entryId)) return failure("not-found");
  if (request.method === "GET") {
    const input = await readProof(request, environment);
    if ("response" in input) return input.response;
    const ifNoneMatch = request.headers.get("if-none-match");
    return guarded(async () => png(await readClubEntryThumbnail(db, { ...input.proof, clubId, entryId, ifNoneMatch }), request));
  }
  const input = await mutation(request, environment, "json", CLUB_THUMBNAIL_REQUEST_MAX_BYTES);
  if ("response" in input) return input.response;
  return guarded(async () => {
    const result = await saveClubEntryThumbnail(db, { ...input.proof, clubId, entryId, request: input.body });
    return result.status === "ok" ? privateJson({ formatVersion: 1, status: "ok" }) : failure(result.status);
  });
}

/** POST: banfilernas sammanfattningar räknas om ("Kontrollera alla kartor igen"). */
export async function clubArchiveSummariesRoute(db: Database, request: Request, clubId: string, environment: ClubEnvironment = process.env)
  : Promise<Response> {
  if (!validId(clubId)) return failure("not-found");
  const input = await mutation(request, environment, "none");
  if ("response" in input) return input.response;
  return guarded(async () => {
    const result = await refreshClubCourseSummaries(db, { ...input.proof, clubId });
    return result.status === "ok" ? privateJson(result.response) : failure(result.status);
  });
}
