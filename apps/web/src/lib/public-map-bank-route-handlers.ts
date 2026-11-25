import {
  attachClubMapVersionToRaceServerSide, createRaceFromPublicMapListing, downloadPublicMapSource, listPublicMapListings,
  readClubMapCatalogStatus, readMapProjectCatalogStatus, readPublicMapListing, readPublicMapPreview,
  removeClubMapCatalogListing, removeMapProjectCatalogListing, streamMapContentParts,
  upsertClubMapCatalogListing, upsertMapProjectCatalogListing
} from "@o-tid/application";
import { UUID_PATTERN } from "@o-tid/contracts";
import type { Database } from "@o-tid/database";
import { attachment, failure, guarded, mutation, problem, readProof, type ClubEnvironment } from "./club-route-handlers";
import { publicBusyResponse, publicLoad } from "./public-load";
import { privateJson } from "./security-policy";
import { logServerError } from "./server-error-log";

/**
 * Etapp 3.2: API-hanterare för den publika kartbanken (`/api/public/map-bank/**`),
 * "Använd i ny träning" (`/api/organizer/map-bank/[listingId]/use`),
 * publicering från klubbkartor och kartprojekt, samt serverrenderad koppling av spärrade klubbkartor.
 */
const validId = (id: string) => UUID_PATTERN.test(id);

const publicJsonHeaders = {
  "cache-control": "public, max-age=30",
  "x-content-type-options": "nosniff"
} as const;

async function admitted(run: () => Promise<Response>): Promise<Response> {
  const slot = await publicLoad().admit();
  if (slot.kind === "busy") return publicBusyResponse(slot.retryAfterSeconds);
  try { return await run(); } finally { slot.release(); }
}

/** GET /api/public/map-bank — publik listning med filter och kommunsiffror. */
export async function publicMapBankListRoute(db: Database, request: Request): Promise<Response> {
  return admitted(async () => {
    try {
      const params = new URL(request.url).searchParams;
      const raw: Record<string, string> = {};
      for (const [key, value] of params.entries()) {
        if (value !== "") raw[key] = value;
      }
      const result = await listPublicMapListings(db, raw);
      if (result.status !== "ok") return failure(result.status);
      return Response.json(
        { formatVersion: 1, items: result.items, total: result.total, municipalityCounts: result.municipalityCounts },
        { headers: publicJsonHeaders }
      );
    } catch (error) {
      logServerError("public-map-bank", "list", error);
      return failure("internal");
    }
  });
}

/** GET /api/public/map-bank/[listingId] — publik detaljvy. */
export async function publicMapBankDetailRoute(db: Database, listingId: string): Promise<Response> {
  if (!validId(listingId)) return failure("not-found");
  return admitted(async () => {
    try {
      const result = await readPublicMapListing(db, listingId);
      if (result.status !== "ok") return failure(result.status);
      return Response.json({ formatVersion: 1, listing: result.listing }, { headers: publicJsonHeaders });
    } catch (error) {
      logServerError("public-map-bank", "detail", error);
      return failure("internal");
    }
  });
}

/** GET /api/public/map-bank/[listingId]/preview — PNG-förhandsvisning endast när `showPreview === true`. */
export async function publicMapBankPreviewRoute(db: Database, listingId: string): Promise<Response> {
  if (!validId(listingId)) return failure("not-found");
  return admitted(async () => {
    try {
      const result = await readPublicMapPreview(db, listingId);
      if (result.status !== "ok") return failure(result.status);
      return new Response(new Uint8Array(result.png), {
        headers: {
          "content-type": "image/png",
          "x-content-type-options": "nosniff",
          "cache-control": "public, max-age=300",
          "content-length": String(result.png.byteLength),
          etag: `"${result.sha256}"`
        }
      });
    } catch (error) {
      logServerError("public-map-bank", "preview", error);
      return failure("internal");
    }
  });
}

/** GET /api/public/map-bank/[listingId]/download — rå .ocd/.omap ENDAST när `accessMode === "OPEN_DOWNLOAD"`. */
export async function publicMapBankDownloadRoute(db: Database, listingId: string): Promise<Response> {
  if (!validId(listingId)) return failure("not-found");
  return admitted(async () => {
    try {
      const head = await downloadPublicMapSource(db, listingId);
      if (head.status !== "ok") return failure(head.status);
      const parts = streamMapContentParts(db, head.contentId);
      const stream = new ReadableStream<Uint8Array>({
        async pull(controller) {
          try {
            const next = await parts.next();
            if (next.done) controller.close(); else controller.enqueue(next.value);
          } catch (error) {
            logServerError("public-map-bank", "download-stream", error);
            controller.error(error);
          }
        },
        async cancel() { await parts.return(undefined); }
      });
      return new Response(stream, {
        headers: {
          "content-type": "application/octet-stream",
          "content-disposition": attachment(head.fileName, head.format === "OCD" ? "karta.ocd" : "karta.omap"),
          "content-length": String(head.byteLength),
          "x-content-type-options": "nosniff",
          "cache-control": "public, max-age=300",
          etag: `"${head.sha256}"`
        }
      });
    } catch (error) {
      logServerError("public-map-bank", "download", error);
      return failure("internal");
    }
  });
}

/** POST /api/organizer/map-bank/[listingId]/use — skapa ny träning från publik listning (serverrenderad PNG). */
export async function usePublicMapListingRoute(
  db: Database,
  request: Request,
  listingId: string,
  environment: ClubEnvironment = process.env
): Promise<Response> {
  if (!validId(listingId)) return failure("not-found");
  const hasBody = request.headers.get("content-type")?.includes("application/json") === true && request.headers.get("content-length") !== "0";
  const input = await mutation(request, environment, hasBody ? "json" : "none");
  if ("response" in input) return input.response;
  return guarded(async () => {
    const result = await createRaceFromPublicMapListing(db, { ...input.proof, listingId, request: input.body ?? {} });
    if (result.status === "problem") return problem(result.problem, result.quota);
    if (result.status !== "created") return failure(result.status);
    return privateJson({
      formatVersion: 1,
      eventId: result.eventId,
      raceId: result.raceId,
      georeferenced: result.georeferenced,
      sourceDownloadLocked: result.sourceDownloadLocked
    }, 201);
  });
}

/** GET / PUT / DELETE /api/organizer/clubs/[clubId]/maps/[mapId]/catalog */
export async function clubMapCatalogRoute(
  db: Database,
  request: Request,
  clubId: string,
  mapId: string,
  environment: ClubEnvironment = process.env
): Promise<Response> {
  if (!validId(clubId) || !validId(mapId)) return failure("not-found");
  if (request.method === "GET") {
    const input = await readProof(request, environment);
    if ("response" in input) return input.response;
    return guarded(async () => {
      const result = await readClubMapCatalogStatus(db, { ...input.proof, clubId, mapId });
      return result.status === "ok"
        ? privateJson({ formatVersion: 1, listing: result.listing, suggested: result.suggested })
        : failure(result.status);
    });
  }
  const input = await mutation(request, environment, request.method === "PUT" ? "json" : "none");
  if ("response" in input) return input.response;
  return guarded(async () => {
    if (request.method === "PUT") {
      const result = await upsertClubMapCatalogListing(db, { ...input.proof, clubId, mapId, request: input.body });
      if (result.status === "quota") return problem("STORAGE_QUOTA_EXCEEDED", result.quota);
      return result.status === "ok" ? privateJson({ formatVersion: 1, listing: result.listing }) : failure(result.status);
    }
    const result = await removeClubMapCatalogListing(db, { ...input.proof, clubId, mapId });
    return result.status === "removed" ? privateJson({ formatVersion: 1, status: "removed" }) : failure(result.status);
  });
}

/** GET / PUT / DELETE /api/organizer/map-projects/[projectId]/catalog */
export async function mapProjectCatalogRoute(
  db: Database,
  request: Request,
  projectId: string,
  environment: ClubEnvironment = process.env
): Promise<Response> {
  if (!validId(projectId)) return failure("not-found");
  if (request.method === "GET") {
    const input = await readProof(request, environment);
    if ("response" in input) return input.response;
    return guarded(async () => {
      const result = await readMapProjectCatalogStatus(db, { ...input.proof, projectId });
      return result.status === "ok"
        ? privateJson({ formatVersion: 1, listing: result.listing, suggested: result.suggested })
        : failure(result.status);
    });
  }
  const input = await mutation(request, environment, request.method === "PUT" ? "json" : "none");
  if ("response" in input) return input.response;
  return guarded(async () => {
    if (request.method === "PUT") {
      const result = await upsertMapProjectCatalogListing(db, { ...input.proof, projectId, request: input.body });
      if (result.status === "quota") return problem("STORAGE_QUOTA_EXCEEDED", result.quota);
      return result.status === "ok" ? privateJson({ formatVersion: 1, listing: result.listing }) : failure(result.status);
    }
    const result = await removeMapProjectCatalogListing(db, { ...input.proof, projectId });
    return result.status === "removed" ? privateJson({ formatVersion: 1, status: "removed" }) : failure(result.status);
  });
}

/** POST /api/organizer/clubs/[clubId]/map-versions/[versionId]/attach-race — serverrenderad koppling för spärrade kartor. */
export async function clubMapVersionAttachRaceRoute(
  db: Database,
  request: Request,
  clubId: string,
  versionId: string,
  environment: ClubEnvironment = process.env
): Promise<Response> {
  if (!validId(clubId) || !validId(versionId)) return failure("not-found");
  const input = await mutation(request, environment, "json");
  if ("response" in input) return input.response;
  return guarded(async () => {
    const result = await attachClubMapVersionToRaceServerSide(db, {
      ...input.proof,
      clubId,
      versionId,
      request: input.body
    });
    if (result.status === "club-activity-only") {
      return privateJson({
        formatVersion: 1,
        error: "CLUB_ACTIVITIES_ONLY",
        message: "Kartan får endast användas på klubbens egna aktiviteter."
      }, 403);
    }
    if (result.status === "problem") return problem(result.problem, result.quota);
    if (result.status !== "ok") return failure(result.status);
    return privateJson({
      formatVersion: 1,
      georeferenced: result.georeferenced,
      sourceDownloadLocked: result.sourceDownloadLocked ?? false
    });
  });
}
