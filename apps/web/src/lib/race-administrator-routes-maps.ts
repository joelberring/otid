import {
  adminRaceMapStateSchema, controlMapResponseSchema, runnerControlMapSchema, PARTICIPANT_ROUTE_CONTENT_TYPE, PARTICIPANT_ROUTE_MAX_BYTES, participantRouteUploadResponseSchema, RACE_MAP_MAX_BYTES,
  RACE_MAP_MEDIA_TYPES, raceMapProjectLinkStateSchema, RACE_MAP_SOURCE_MAX_BYTES, RACE_MAP_SOURCE_PARTS, RACE_MAP_SOURCE_UPLOAD_MAX_BYTES, raceMapProblemSchema,
  type RaceMapProblem
} from "@o-tid/contracts";
import { forEachMultipartPart, MultipartError, multipartBoundary, partBytes } from "./multipart";
import {
  RequestBodyError,
  adminFailure as failure,
  hasNoRequestBody,
  privateJson as json,
  privateHeaders,
  readBoundedBytes,
  readJsonBody,
  validDeclaredLength
} from "./security-policy";
import { resultFailure, type RaceAdministratorRouteContext } from "./race-administrator-route-context";
import { UUID_PATTERN as uuid } from "@o-tid/contracts";
import type { MapQuotaExceeded, StagedMapContent, StageResult } from "@o-tid/application";


const MB = 1024 * 1024;

/** 422 med felet; vid full kvot också gränsen och vad som används (ADR-0189 beslut 3), i hela MB. */
function problem(error: RaceMapProblem, quota?: MapQuotaExceeded): Response {
  return json(raceMapProblemSchema.parse({ formatVersion: 1, error, ...(quota ? { quota: { scope: quota.scope,
    usedMb: Math.ceil(quota.usedBytes / MB), limitMb: Math.floor(quota.limitBytes / MB), neededMb: Math.ceil(quota.neededBytes / MB) } } : {}) }), 422);
}

/**
 * ADR-0218: hur länge webbläsaren använder sin kopia av en kartfil som hämtats med sin sha256 i adressen utan att fråga (ett
 * dygn, som papperets bilder). Sedan frågar den med ETag: behörigheten prövas och svaret är 304 utan filen.
 */
const MAP_SOURCE_MAX_AGE_SECONDS = 24 * 60 * 60;
const SHA256 = /^[a-f0-9]{64}$/;

/** Värdet i If-None-Match (`"sha"` eller `W/"sha"`), eller undefined när det inte är en sha256. */
function etagValue(header: string | null): string | undefined {
  const value = /^(?:W\/)?"([a-f0-9]{64})"$/.exec((header ?? "").trim())?.[1];
  return value && SHA256.test(value) ? value : undefined;
}

/**
 * ADR-0218: kartfilen är oföränderlig när adressen bär dess sha256 (`map/source/<sha256>` lika med filens). Då får webbläsaren behålla
 * den (`private`: aldrig i en delad cache; `immutable`: ingen ny fråga under tiden) med ETag, och bara för samma kakor
 * (`Vary: Cookie`, en annan inloggning i samma webbläsare hämtar och prövas på nytt). Utan sha256 eller med en annan (filen
 * har bytts) sparas inget, som förut.
 */
function mapSourceCacheHeaders(requested: string | null, sha256: string): Record<string, string> {
  if (requested === null || !SHA256.test(requested) || requested !== sha256) return { ...privateHeaders };
  return { ...privateHeaders, "cache-control": `private, max-age=${MAP_SOURCE_MAX_AGE_SECONDS}, immutable`, etag: `"${sha256}"`, vary: "Cookie" };
}

/** Filens namn i en header (URI-kodad); ett trasigt namn ger fallback i stället för fel. */
function headerFileName(request: Request): string {
  const raw = request.headers.get("x-otid-file-name") ?? "";
  try { return decodeURIComponent(raw).slice(0, 200); } catch { return ""; }
}

/** Läser en binär body med typ och storleksgräns. Ger undefined när requesten inte uppfyller dem. */
async function binaryBody(request: Request, types: readonly string[], limit: number): Promise<Uint8Array | "too-large" | undefined> {
  if (!types.includes(request.headers.get("content-type") ?? "")) return undefined;
  if (!validDeclaredLength(request, limit)) return "too-large";
  try { return await readBoundedBytes(request, limit); }
  catch (error) { if (error instanceof RequestBodyError) return error.message === "Bodyn är för stor" ? "too-large" : undefined; throw error; }
}

/**
 * Karta och vägval (PLAN.md steg 16, ADR-0171): kartbilden (GET tillstånd, PUT bild, DELETE), bilden för
 * georeferensen, georeferensen (POST), kartfilen (steg 59: POST multipart, GET originalet, DELETE) och löparnas
 * GPX-rutter (POST, DELETE; löparen i `x-otid-entry-id`).
 * Ger undefined för åtgärder som inte hör till gruppen.
 */
export async function handleMapRoute(context: RaceAdministratorRouteContext): Promise<Response | undefined> {
  const { db, request, raceId, action, dependencies, proof } = context;
  const input = { ...proof, raceId };
  switch (action.kind) {
    // Steg 52 (ADR-0176): kontrollkartan och löparens bana på kartan (deltagarkortet).
    case "control-map": {
      const result = await dependencies.controlMap(db, input);
      if (result.status !== "ok") return resultFailure(result.status);
      return json(controlMapResponseSchema.parse(result.response));
    }
    case "entry-control-map": {
      const result = await dependencies.entryControlMap(db, { ...input, entryId: action.entryId });
      if (result.status !== "ok") return resultFailure(result.status);
      return json(runnerControlMapSchema.parse(result.response));
    }
    case "race-map": {
      if (request.method === "GET") {
        const result = await dependencies.raceMapState(db, input);
        if (result.status !== "ok") return resultFailure(result.status);
        return json(adminRaceMapStateSchema.parse(result.response));
      }
      if (request.method === "DELETE") {
        if (!await hasNoRequestBody(request)) return failure(400, "INVALID_REQUEST");
        const result = await dependencies.raceMapRemove(db, input);
        return result.status === "ok" ? new Response(null, { status: 204, headers: privateHeaders }) : resultFailure(result.status);
      }
      // ADR-0189 beslut 2: bilden strömmas till databasen i delar; webben håller aldrig hela bilden i minnet.
      if (!(RACE_MAP_MEDIA_TYPES as readonly string[]).includes(request.headers.get("content-type") ?? "") || !request.body) {
        return failure(400, "INVALID_REQUEST");
      }
      if (!validDeclaredLength(request, RACE_MAP_MAX_BYTES)) return problem("IMAGE_TOO_LARGE");
      const staged = await dependencies.mapContentStage(db, streamChunks(request.body), { maxBytes: RACE_MAP_MAX_BYTES });
      if (staged.kind === "too-large") return problem("IMAGE_TOO_LARGE");
      if (staged.kind === "empty") return failure(400, "INVALID_REQUEST");
      try {
        const result = await dependencies.raceMapSave(db, { ...input, bytes: staged, fileName: headerFileName(request) });
        if (result.status === "problem") return problem(result.problem, result.quota);
        return result.status === "ok" ? new Response(null, { status: 204, headers: privateHeaders }) : resultFailure(result.status);
      } finally { await dependencies.mapContentDiscard(db, staged.contentId); }
    }
    case "race-map-image": {
      const result = await dependencies.raceMapImage(db, input);
      if (result.status !== "ok") return resultFailure(result.status);
      return new Response(new Uint8Array(result.image), { headers: { ...privateHeaders, "content-type": result.mediaType } });
    }
    case "race-map-georeference": {
      let body: unknown;
      try { body = await readJsonBody(request); } catch { return failure(400, "INVALID_REQUEST"); }
      const result = await dependencies.raceMapGeoreference(db, { ...input, request: body });
      if (result.status === "problem") return problem(result.problem);
      return result.status === "ok" ? new Response(null, { status: 204, headers: privateHeaders }) : resultFailure(result.status);
    }
    // Steg 59 (ADR-0179): kartfilen (OCAD eller Mapper) med bilden ritad i webbläsaren, i en uppladdning.
    case "race-map-source": {
      if (request.method === "GET") {
        const result = await dependencies.raceMapSourceFile(db, input, undefined, { ifNoneMatch: etagValue(request.headers.get("if-none-match")) });
        if (result.status !== "ok" && result.status !== "not-modified") return resultFailure(result.status);
        const headers = mapSourceCacheHeaders(action.sha256 ?? null, result.sha256);
        if (result.status === "not-modified") return new Response(null, { status: 304, headers });
        const extension = result.format === "OCD" ? "ocd" : "omap";
        const name = result.fileName.replace(/[^\p{L}\p{N} ._-]/gu, "_").replace(/\.(ocd|omap|xmap)$/i, "") || "karta";
        return new Response(new Uint8Array(result.file), { headers: { ...headers, "content-type": "application/octet-stream",
          "content-disposition": `attachment; filename="karta.${extension}"; filename*=UTF-8''${encodeURIComponent(`${name}.${extension}`)}`,
          "content-length": String(result.file.byteLength) } });
      }
      if (request.method === "DELETE") {
        if (!await hasNoRequestBody(request)) return failure(400, "INVALID_REQUEST");
        const result = await dependencies.raceMapSourceRemove(db, input);
        return result.status === "ok" ? new Response(null, { status: 204, headers: privateHeaders }) : resultFailure(result.status);
      }
      return uploadMapSource(context);
    }
    // Ägarens plan 2026-11-13: kartprojektet som kartan kommer ur, den låsta versionen och ändringarna som väntar.
    case "race-map-project": {
      const result = await dependencies.raceMapProjectLink(db, input);
      if (result.status !== "ok") return resultFailure(result.status);
      return json(raceMapProjectLinkStateSchema.parse(result.response));
    }
    case "participant-route": {
      const entryId = request.headers.get("x-otid-entry-id") ?? "";
      if (!uuid.test(entryId)) return failure(400, "INVALID_REQUEST");
      if (request.method === "DELETE") {
        if (!await hasNoRequestBody(request)) return failure(400, "INVALID_REQUEST");
        const result = await dependencies.participantRouteRemove(db, { ...input, entryId });
        return result.status === "ok" ? new Response(null, { status: 204, headers: privateHeaders }) : resultFailure(result.status);
      }
      const bytes = await binaryBody(request, [PARTICIPANT_ROUTE_CONTENT_TYPE], PARTICIPANT_ROUTE_MAX_BYTES);
      if (bytes === "too-large") return problem("INVALID_GPX");
      if (!bytes) return failure(400, "INVALID_REQUEST");
      const result = await dependencies.participantRouteSave(db, { ...input, entryId, bytes, fileName: headerFileName(request) });
      if (result.status === "problem") return problem(result.problem);
      if (result.status !== "ok") return resultFailure(result.status);
      return json(participantRouteUploadResponseSchema.parse(result.response));
    }
    default:
      return undefined;
  }
}

/** Bodyn som bitar. */
async function* streamChunks(body: ReadableStream<Uint8Array>): AsyncGenerator<Uint8Array> {
  const reader = body.getReader();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) return;
      yield value;
    }
  } finally { await reader.cancel().catch(() => undefined); }
}

class UploadRejected extends Error {
  constructor(readonly response: Response) { super("Uppladdningen avvisades"); }
}

/**
 * Steg 59: kartfilen, bilden och metadata som multipart. ADR-0189 beslut 2: bodyn läses som en ström; kartfilen och bilden
 * skrivs del för del till databasen medan de läses (`mapContentStage`), och storleken kontrolleras under tiden. Det som
 * strömmats men inte sparats tas bort efteråt (`mapContentDiscard`), oavsett utfall.
 */
async function uploadMapSource(context: RaceAdministratorRouteContext): Promise<Response> {
  const { db, request, raceId, dependencies, proof } = context;
  const boundary = multipartBoundary(request.headers.get("content-type"));
  if (!boundary) return failure(400, "INVALID_REQUEST");
  if (!validDeclaredLength(request, RACE_MAP_SOURCE_UPLOAD_MAX_BYTES)) return problem("MAP_FILE_TOO_LARGE");
  const staged: StagedMapContent[] = [];
  let file: StagedMapContent | undefined, image: StagedMapContent | undefined, meta: Uint8Array | undefined;
  let fileName = "", count = 0;
  const stage = async (chunks: AsyncIterable<Uint8Array>, maxBytes: number, tooLarge: RaceMapProblem) => {
    const result: StageResult = await dependencies.mapContentStage(db, chunks, { maxBytes });
    if (result.kind === "too-large") throw new UploadRejected(problem(tooLarge));
    if (result.kind === "empty") throw new UploadRejected(failure(400, "INVALID_REQUEST"));
    staged.push(result);
    return result;
  };
  try {
    try {
      await forEachMultipartPart(request.body, boundary, { maxBytes: RACE_MAP_SOURCE_UPLOAD_MAX_BYTES, maxParts: 3 }, async part => {
        count += 1;
        if (part.name === RACE_MAP_SOURCE_PARTS.file && !file) {
          fileName = (part.fileName ?? "").slice(0, 200);
          file = await stage(part.chunks, RACE_MAP_SOURCE_MAX_BYTES, "MAP_FILE_TOO_LARGE");
        } else if (part.name === RACE_MAP_SOURCE_PARTS.image && !image) {
          image = await stage(part.chunks, RACE_MAP_MAX_BYTES, "IMAGE_TOO_LARGE");
        } else if (part.name === RACE_MAP_SOURCE_PARTS.metadata && !meta) {
          meta = await partBytes(part.chunks, 256 * 1024);
        } else throw new MultipartError("invalid");
      });
    } catch (error) {
      if (error instanceof UploadRejected) return error.response;
      if (error instanceof MultipartError) return error.kind === "too-large" ? problem("MAP_FILE_TOO_LARGE") : failure(400, "INVALID_REQUEST");
      throw error;
    }
    if (count !== 3 || !file || !image || !meta) return failure(400, "INVALID_REQUEST");
    let metadata: unknown;
    try { metadata = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(meta)); } catch { return failure(400, "INVALID_REQUEST"); }
    const result = await dependencies.raceMapSourceSave(db, { ...proof, raceId, file, image, metadata, fileName });
    if (result.status === "problem") return problem(result.problem, result.quota);
    return result.status === "ok" ? new Response(null, { status: 204, headers: privateHeaders }) : resultFailure(result.status);
  } finally {
    for (const content of staged) await dependencies.mapContentDiscard(db, content.contentId);
  }
}
