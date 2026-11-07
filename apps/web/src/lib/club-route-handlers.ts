import {
  bearerToken, createClub, createClubImportToken, deleteClubArchiveEntry, discardStagedMapContent, importBatch, importCheck, importMapContent, importTokenClub,
  inviteClubMember, listMyClubs, moveClubMapVersion, readClub, readClubArchive, readClubArchiveEntry, readClubCourseFile,
  readClubMapVersionHead, removeClubMember, revokeClubImportToken, saveClubMapToGroupLibrary, saveClubMapVersionToRace, setClubCourseFileMap,
  setClubMemberRole, stageMapContent, streamMapContentParts, updateClubArchiveEntry, updateClubMap, updateClubMapVersion, uploadClubMapVersion,
  type MapQuotaExceeded, type StagedMapContent
} from "@o-tid/application";
import { CLUB_ARCHIVE_MAP_MAX_BYTES, CLUB_IMPORT_BATCH_MAX_BYTES, RACE_MAP_MAX_BYTES, RACE_MAP_SOURCE_PARTS, UUID_PATTERN } from "@o-tid/contracts";
import type { Database } from "@o-tid/database";
import { mailAvailable, routeMailer } from "./invitation-route-handlers";
import { forEachMultipartPart, MultipartError, multipartBoundary, partBytes } from "./multipart";
import {
  SecurityConfigurationError, accountFailure, hasExpectedOrigin, hasNoRequestBody, privateHeaders, privateJson, readJsonBody, securityPolicy,
  sessionProof, validDeclaredLength, type SecurityPolicy
} from "./security-policy";
import { logServerError } from "./server-error-log";

/**
 * ADR-0194: klubbens och klubbarkivets anrop. Under /api/organizer/clubs samma skydd som kontots andra anrop (exakt Origin och
 * CSRF på skrivningar, privata svar utan cache); behörigheten avgörs i tjänsterna. Under /api/club-import/ importkommandot från
 * ägarens dator: nyckeln i `Authorization: Bearer`, inga kakor.
 */
type Environment = Partial<Pick<NodeJS.ProcessEnv, "NODE_ENV" | "O_TID_PUBLIC_ORIGIN" | "OTID_SMTP_URL" | "OTID_MAIL_FROM">>;
const BODY_MAX = 16 * 1024;
const MB = 1024 * 1024;

function policy(environment: Environment): { value: SecurityPolicy } | { response: Response } {
  try { return { value: securityPolicy(environment) }; }
  catch (error) {
    if (error instanceof SecurityConfigurationError) return { response: accountFailure(500, "INTERNAL_ERROR") };
    throw error;
  }
}

export function failure(status: string): Response {
  switch (status) {
    case "unauthorized": return accountFailure(401, "UNAUTHORIZED");
    case "forbidden": return accountFailure(403, "FORBIDDEN");
    case "invalid-request": return accountFailure(400, "INVALID_REQUEST");
    case "not-found": return accountFailure(404, "NOT_FOUND");
    case "conflict": return accountFailure(409, "CONFLICT");
    case "name-taken": return accountFailure(409, "NAME_TAKEN");
    default: return accountFailure(500, "INTERNAL_ERROR");
  }
}

/** 422 med felet; vid full kvot också gränsen och vad som används i hela MB (som kartfilens uppladdning, ADR-0189 beslut 3). */
function problem(error: string, quota?: MapQuotaExceeded): Response {
  return privateJson({ formatVersion: 1, error, ...(quota ? { quota: { scope: quota.scope, usedMb: Math.ceil(quota.usedBytes / MB),
    limitMb: Math.floor(quota.limitBytes / MB), neededMb: Math.ceil(quota.neededBytes / MB) } } : {}) }, 422);
}

type Proof = ReturnType<typeof sessionProof>;
export type ClubEnvironment = Environment;

export async function mutation(request: Request, environment: Environment, body: "json" | "none" | "stream" = "json", maxBytes = BODY_MAX)
  : Promise<{ response: Response } | { body: unknown; proof: Proof }> {
  const configured = policy(environment);
  if ("response" in configured) return configured;
  if (!hasExpectedOrigin(request, configured.value)) return { response: accountFailure(403, "FORBIDDEN") };
  const proof = sessionProof(request, configured.value, true);
  // Utan session 401 före kroppen och dess typ (städrundan 2026-11-07); tjänsterna prövar sedan inloggningen före kroppen.
  if (!proof.sessionToken) return { response: accountFailure(401, "UNAUTHORIZED") };
  let parsed: unknown = undefined;
  if (body === "json") {
    try { parsed = await readJsonBody(request, maxBytes); } catch { return { response: accountFailure(400, "INVALID_REQUEST") }; }
  } else if (body === "none" && !await hasNoRequestBody(request)) return { response: accountFailure(400, "INVALID_REQUEST") };
  return { body: parsed, proof };
}

export async function readProof(request: Request, environment: Environment): Promise<{ response: Response } | { proof: Proof }> {
  const configured = policy(environment);
  if ("response" in configured) return configured;
  if (!await hasNoRequestBody(request)) return { response: accountFailure(400, "INVALID_REQUEST") };
  return { proof: sessionProof(request, configured.value, false) };
}

export async function guarded(run: () => Promise<Response>): Promise<Response> {
  try { return await run(); }
  catch (error) {
    logServerError("club", "route", error);
    return accountFailure(500, "INTERNAL_ERROR");
  }
}

const validId = (id: string) => UUID_PATTERN.test(id);

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

function headerText(request: Request, name: string, max: number): string | null {
  const raw = request.headers.get(name);
  if (raw === null) return null;
  try { return decodeURIComponent(raw).replace(/\p{Cc}/gu, "").trim().slice(0, max) || null; } catch { return null; }
}

const attachment = (fileName: string, fallback: string) => {
  const safe = fileName.replace(/[^\p{L}\p{N} ._()-]/gu, "_") || fallback;
  return `attachment; filename="${fallback}"; filename*=UTF-8''${encodeURIComponent(safe)}`;
};

// --- Klubben ------------------------------------------------------------------------------------------------------------

export async function clubsListRoute(db: Database, request: Request, environment: Environment = process.env): Promise<Response> {
  const input = await readProof(request, environment);
  if ("response" in input) return input.response;
  return guarded(async () => {
    const result = await listMyClubs(db, input.proof);
    return result.status === "ok" ? privateJson({ formatVersion: 1, clubs: result.clubs }) : failure(result.status);
  });
}

export async function clubCreateRoute(db: Database, request: Request, environment: Environment = process.env): Promise<Response> {
  const input = await mutation(request, environment);
  if ("response" in input) return input.response;
  return guarded(async () => {
    const result = await createClub(db, { ...input.proof, request: input.body });
    return result.status === "created" ? privateJson({ formatVersion: 1, club: result.club }, result.replayed ? 200 : 201) : failure(result.status);
  });
}

export async function clubReadRoute(db: Database, request: Request, clubId: string, environment: Environment = process.env): Promise<Response> {
  if (!validId(clubId)) return failure("not-found");
  const input = await readProof(request, environment);
  if ("response" in input) return input.response;
  return guarded(async () => {
    const result = await readClub(db, { ...input.proof, clubId });
    return result.status === "ok" ? privateJson({ ...result.view, mailEnabled: mailAvailable(environment) }) : failure(result.status);
  });
}

/** POST bjud in, PUT ändra roll, DELETE ta bort medlem eller inbjudan. */
export async function clubMembersRoute(db: Database, request: Request, clubId: string, environment: Environment = process.env): Promise<Response> {
  if (!validId(clubId)) return failure("not-found");
  const input = await mutation(request, environment);
  if ("response" in input) return input.response;
  return guarded(async () => {
    const args = { ...input.proof, clubId, request: input.body };
    if (request.method === "POST") {
      const result = await inviteClubMember(db, args, new Date(), routeMailer(environment));
      // Samma svar med och utan konto (ADR-0188 beslut 6). ADR-0206: och vad som hände med mejlet.
      return result.status === "invited" ? privateJson({ formatVersion: 1, invitationId: result.invitationId, mail: result.mail },
        result.replayed ? 200 : 201) : failure(result.status);
    }
    if (request.method === "PUT") {
      const result = await setClubMemberRole(db, args);
      return result.status === "ok" ? privateJson({ formatVersion: 1, status: "ok" }) : failure(result.status);
    }
    const result = await removeClubMember(db, args);
    return result.status === "removed" ? privateJson({ formatVersion: 1, status: "removed" }) : failure(result.status);
  });
}

export async function clubImportTokenCreateRoute(db: Database, request: Request, clubId: string, environment: Environment = process.env)
  : Promise<Response> {
  if (!validId(clubId)) return failure("not-found");
  const input = await mutation(request, environment, "none");
  if ("response" in input) return input.response;
  return guarded(async () => {
    const result = await createClubImportToken(db, { ...input.proof, clubId });
    return result.status === "created" ? privateJson({ formatVersion: 1, token: result.token, tokenId: result.tokenId, expiresAt: result.expiresAt }, 201)
      : failure(result.status);
  });
}

export async function clubImportTokenRevokeRoute(db: Database, request: Request, clubId: string, tokenId: string,
  environment: Environment = process.env): Promise<Response> {
  if (!validId(clubId) || !validId(tokenId)) return failure("not-found");
  const input = await mutation(request, environment, "none");
  if ("response" in input) return input.response;
  return guarded(async () => {
    const result = await revokeClubImportToken(db, { ...input.proof, clubId, tokenId });
    return result.status === "revoked" ? privateJson({ formatVersion: 1, status: "revoked" }) : failure(result.status);
  });
}

// --- Arkivet ------------------------------------------------------------------------------------------------------------

export async function clubArchiveRoute(db: Database, request: Request, clubId: string, environment: Environment = process.env): Promise<Response> {
  if (!validId(clubId)) return failure("not-found");
  const input = await readProof(request, environment);
  if ("response" in input) return input.response;
  return guarded(async () => {
    const result = await readClubArchive(db, { ...input.proof, clubId });
    return result.status === "ok" ? privateJson(result.list) : failure(result.status);
  });
}

/** GET träningen, PUT ändra, DELETE ta bort. */
export async function clubArchiveEntryRoute(db: Database, request: Request, clubId: string, entryId: string, environment: Environment = process.env)
  : Promise<Response> {
  if (!validId(clubId) || !validId(entryId)) return failure("not-found");
  if (request.method === "GET") {
    const input = await readProof(request, environment);
    if ("response" in input) return input.response;
    return guarded(async () => {
      const result = await readClubArchiveEntry(db, { ...input.proof, clubId, entryId });
      return result.status === "ok" ? privateJson(result.view) : failure(result.status);
    });
  }
  const input = await mutation(request, environment, request.method === "PUT" ? "json" : "none");
  if ("response" in input) return input.response;
  return guarded(async () => {
    if (request.method === "PUT") {
      const result = await updateClubArchiveEntry(db, { ...input.proof, clubId, entryId, request: input.body });
      return result.status === "ok" ? privateJson({ formatVersion: 1, status: "ok" }) : failure(result.status);
    }
    const result = await deleteClubArchiveEntry(db, { ...input.proof, clubId, entryId });
    return result.status === "deleted" ? privateJson({ formatVersion: 1, status: "deleted" }) : failure(result.status);
  });
}

/** GET banfilen orörd ("Ladda ner original"), PUT banfilens karta. */
export async function clubCourseFileRoute(db: Database, request: Request, clubId: string, courseFileId: string, environment: Environment = process.env)
  : Promise<Response> {
  if (!validId(clubId) || !validId(courseFileId)) return failure("not-found");
  if (request.method === "GET") {
    const input = await readProof(request, environment);
    if ("response" in input) return input.response;
    return guarded(async () => {
      const result = await readClubCourseFile(db, { ...input.proof, clubId, courseFileId });
      if (result.status !== "ok") return failure(result.status);
      const fallback = result.kind === "PPEN" ? "banor.ppen" : "banor.xml";
      return new Response(new Uint8Array(result.content), { headers: { ...privateHeaders,
        "content-type": result.kind === "PPEN" ? "application/octet-stream" : "application/xml",
        "content-disposition": attachment(result.fileName, fallback), "content-length": String(result.content.byteLength) } });
    });
  }
  const input = await mutation(request, environment);
  if ("response" in input) return input.response;
  return guarded(async () => {
    const result = await setClubCourseFileMap(db, { ...input.proof, clubId, courseFileId, request: input.body });
    return result.status === "ok" ? privateJson({ formatVersion: 1, status: "ok" }) : failure(result.status);
  });
}

// --- Kartorna -----------------------------------------------------------------------------------------------------------

/**
 * Ny karta (`mapId` null, namnet i `x-otid-map-name`) eller ny version av en karta (POST): filen som body
 * (`application/octet-stream`), strömmad till kartinnehållet. Filnamn, datum och anteckning i rubriker (URI-kodade).
 */
export async function clubMapUploadRoute(db: Database, request: Request, clubId: string, mapId: string | null, environment: Environment = process.env)
  : Promise<Response> {
  if (!validId(clubId) || (mapId !== null && !validId(mapId))) return failure("not-found");
  const input = await mutation(request, environment, "stream");
  if ("response" in input) return input.response;
  if (request.headers.get("content-type") !== "application/octet-stream" || !request.body) return failure("invalid-request");
  if (!validDeclaredLength(request, CLUB_ARCHIVE_MAP_MAX_BYTES)) return problem("MAP_FILE_TOO_LARGE");
  const versionDate = headerText(request, "x-otid-version-date", 10);
  const body = request.body;
  return guarded(async () => {
    const result = await uploadClubMapVersion(db, { ...input.proof, clubId, mapId, newMapName: mapId ? null : headerText(request, "x-otid-map-name", 120),
      fileName: headerText(request, "x-otid-file-name", 200) ?? "", versionDate, note: headerText(request, "x-otid-note", 500), body: streamChunks(body) });
    if (result.status === "problem") return problem(result.problem === "TOO_LARGE" ? "MAP_FILE_TOO_LARGE" : result.problem);
    if (result.status === "quota") return problem("STORAGE_QUOTA_EXCEEDED", result.quota);
    return result.status === "created" ? privateJson({ formatVersion: 1, mapId: result.mapId, versionId: result.versionId }, 201) : failure(result.status);
  });
}

export async function clubMapUpdateRoute(db: Database, request: Request, clubId: string, mapId: string, environment: Environment = process.env)
  : Promise<Response> {
  if (!validId(clubId) || !validId(mapId)) return failure("not-found");
  const input = await mutation(request, environment);
  if ("response" in input) return input.response;
  return guarded(async () => {
    const result = await updateClubMap(db, { ...input.proof, clubId, mapId, request: input.body });
    return result.status === "ok" ? privateJson({ formatVersion: 1, status: "ok" }) : failure(result.status);
  });
}

/** GET originalet (strömmas del för del), PUT datum och anteckning. */
export async function clubMapVersionRoute(db: Database, request: Request, clubId: string, versionId: string, environment: Environment = process.env)
  : Promise<Response> {
  if (!validId(clubId) || !validId(versionId)) return failure("not-found");
  if (request.method === "GET") {
    const input = await readProof(request, environment);
    if ("response" in input) return input.response;
    return guarded(async () => {
      const head = await readClubMapVersionHead(db, { ...input.proof, clubId, versionId });
      if (head.status !== "ok") return failure(head.status);
      const parts = streamMapContentParts(db, head.contentId);
      const stream = new ReadableStream<Uint8Array>({
        async pull(controller) {
          try {
            const next = await parts.next();
            if (next.done) controller.close(); else controller.enqueue(next.value);
          } catch (error) {
            logServerError("club", "map-download", error);
            controller.error(error);
          }
        },
        async cancel() { await parts.return(undefined); }
      });
      return new Response(stream, { headers: { ...privateHeaders, "content-type": "application/octet-stream",
        "content-disposition": attachment(head.fileName, head.format === "OCD" ? "karta.ocd" : "karta.omap"), "content-length": String(head.byteLength),
        etag: `"${head.sha256}"` } });
    });
  }
  const input = await mutation(request, environment);
  if ("response" in input) return input.response;
  return guarded(async () => {
    const result = await updateClubMapVersion(db, { ...input.proof, clubId, versionId, request: input.body });
    return result.status === "ok" ? privateJson({ formatVersion: 1, status: "ok" }) : failure(result.status);
  });
}

export async function clubMapVersionMoveRoute(db: Database, request: Request, clubId: string, versionId: string, environment: Environment = process.env)
  : Promise<Response> {
  if (!validId(clubId) || !validId(versionId)) return failure("not-found");
  const input = await mutation(request, environment);
  if ("response" in input) return input.response;
  return guarded(async () => {
    const result = await moveClubMapVersion(db, { ...input.proof, clubId, versionId, request: input.body });
    return result.status === "ok" ? privateJson({ formatVersion: 1, mapId: result.mapId }) : failure(result.status);
  });
}

class UploadRejected extends Error {
  constructor(readonly response: Response) { super("Uppladdningen avvisades"); }
}

/** Bilden (strömmad till kartinnehållet) och metadata ur en multipart med två delar, som kartfilens uppladdning utan filen. */
async function renderedMap(db: Database, request: Request): Promise<Response | { image: StagedMapContent; metadata: unknown }> {
  const boundary = multipartBoundary(request.headers.get("content-type"));
  if (!boundary) return failure("invalid-request");
  if (!validDeclaredLength(request, RACE_MAP_MAX_BYTES + 512 * 1024)) return problem("IMAGE_TOO_LARGE");
  let image: StagedMapContent | undefined, meta: Uint8Array | undefined;
  try {
    await forEachMultipartPart(request.body, boundary, { maxBytes: RACE_MAP_MAX_BYTES + 512 * 1024, maxParts: 2 }, async part => {
      if (part.name === RACE_MAP_SOURCE_PARTS.image && !image) {
        const staged = await stageMapContent(db, part.chunks, { maxBytes: RACE_MAP_MAX_BYTES });
        if (staged.kind === "too-large") throw new UploadRejected(problem("IMAGE_TOO_LARGE"));
        if (staged.kind === "empty") throw new UploadRejected(failure("invalid-request"));
        image = staged;
      } else if (part.name === RACE_MAP_SOURCE_PARTS.metadata && !meta) {
        meta = await partBytes(part.chunks, 256 * 1024);
      } else throw new MultipartError("invalid");
    });
  } catch (error) {
    const staged = image;
    if (staged) await discardStagedMapContent(db, staged.contentId);
    if (error instanceof UploadRejected) return error.response;
    if (error instanceof MultipartError) return error.kind === "too-large" ? problem("IMAGE_TOO_LARGE") : failure("invalid-request");
    throw error;
  }
  if (!image || !meta) {
    if (image) await discardStagedMapContent(db, image.contentId);
    return failure("invalid-request");
  }
  try { return { image, metadata: JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(meta)) as unknown }; }
  catch {
    await discardStagedMapContent(db, image.contentId);
    return failure("invalid-request");
  }
}

/**
 * "Använd igen": versionen blir tävlingens kartfil (`target` = "race", tävlingen i `x-otid-race-id`) eller läggs i en
 * träningsgrupps kartbibliotek (`target` = "group", gruppen i `x-otid-group-id`). Bilden är ritad i webbläsaren.
 */
export async function clubMapVersionTargetRoute(db: Database, request: Request, clubId: string, versionId: string, target: "race" | "group",
  environment: Environment = process.env): Promise<Response> {
  if (!validId(clubId) || !validId(versionId)) return failure("not-found");
  const targetId = request.headers.get(target === "race" ? "x-otid-race-id" : "x-otid-group-id") ?? "";
  if (!validId(targetId)) return failure("invalid-request");
  const input = await mutation(request, environment, "stream");
  if ("response" in input) return input.response;
  return guarded(async () => {
    const rendered = await renderedMap(db, request);
    if (rendered instanceof Response) return rendered;
    try {
      if (target === "race") {
        const result = await saveClubMapVersionToRace(db, { ...input.proof, clubId, versionId, raceId: targetId, image: rendered.image,
          metadata: rendered.metadata });
        if (result.status === "problem") return problem(result.problem, result.quota);
        return result.status === "ok" ? privateJson({ formatVersion: 1, georeferenced: result.georeferenced }) : failure(result.status);
      }
      const result = await saveClubMapToGroupLibrary(db, { ...input.proof, clubId, versionId, groupId: targetId, image: rendered.image,
        metadata: rendered.metadata });
      if (result.status === "problem") return problem(result.problem);
      if (result.status === "quota") return problem("STORAGE_QUOTA_EXCEEDED", result.quota);
      return result.status === "saved" ? privateJson({ formatVersion: 1, mapId: result.mapId, updated: result.updated }) : failure(result.status);
    } finally {
      await discardStagedMapContent(db, rendered.image.contentId);
    }
  });
}

// --- Importen från ägarens dator (ADR-0194 beslut 6–7) ------------------------------------------------------------------

const importFailure = (status: string) => status === "unauthorized" ? privateJson({ formatVersion: 1, error: "UNAUTHORIZED" }, 401)
  : status === "not-found" ? privateJson({ formatVersion: 1, error: "NOT_FOUND" }, 404) : privateJson({ formatVersion: 1, error: "INVALID_REQUEST" }, 400);

async function importJson(request: Request): Promise<unknown> {
  if (!(request.headers.get("content-type") ?? "").startsWith("application/json")) throw new Error("content-type");
  return readJsonBody(request, CLUB_IMPORT_BATCH_MAX_BYTES);
}

/** GET: klubben som nyckeln hör till (importverktyget visar namnet innan något skickas). */
export async function clubImportTokenRoute(db: Database, request: Request): Promise<Response> {
  const token = bearerToken(request.headers.get("authorization"));
  if (!token) return importFailure("unauthorized");
  return guarded(async () => {
    const result = await importTokenClub(db, { token });
    return result.status === "ok" ? privateJson({ formatVersion: 1, clubId: result.clubId, clubName: result.clubName }) : importFailure(result.status);
  });
}

export async function clubImportCheckRoute(db: Database, request: Request, clubId: string): Promise<Response> {
  const token = bearerToken(request.headers.get("authorization"));
  if (!token) return importFailure("unauthorized");
  let body: unknown;
  try { body = await importJson(request); } catch { return importFailure("invalid-request"); }
  return guarded(async () => {
    const result = await importCheck(db, { token, clubId, request: body });
    return result.status === "ok" ? privateJson(result.response) : importFailure(result.status);
  });
}

export async function clubImportContentRoute(db: Database, request: Request, clubId: string, sha256: string): Promise<Response> {
  const token = bearerToken(request.headers.get("authorization"));
  if (!token) return importFailure("unauthorized");
  if (request.headers.get("content-type") !== "application/octet-stream" || !request.body) return importFailure("invalid-request");
  if (!validDeclaredLength(request, CLUB_ARCHIVE_MAP_MAX_BYTES)) return problem("MAP_FILE_TOO_LARGE");
  const body = request.body;
  return guarded(async () => {
    const result = await importMapContent(db, { token, clubId, sha256, body: streamChunks(body) });
    if (result.status === "problem") return problem(result.problem === "TOO_LARGE" ? "MAP_FILE_TOO_LARGE" : result.problem);
    if (result.status === "quota") return problem("STORAGE_QUOTA_EXCEEDED", result.quota);
    return result.status === "ok" ? privateJson(result.response) : importFailure(result.status);
  });
}

export async function clubImportBatchRoute(db: Database, request: Request, clubId: string): Promise<Response> {
  const token = bearerToken(request.headers.get("authorization"));
  if (!token) return importFailure("unauthorized");
  let body: unknown;
  try { body = await importJson(request); } catch { return importFailure("invalid-request"); }
  return guarded(async () => {
    const result = await importBatch(db, { token, clubId, request: body });
    return result.status === "ok" ? privateJson(result.response) : importFailure(result.status);
  });
}

// --- Importen från webbläsaren (ADR-0204) -------------------------------------------------------------------------------
// Samma tjänster som importnyckelns anrop ovan, men med inloggningen: exakt Origin och CSRF som arrangörens andra skrivningar,
// och rollen administratör i klubben (`requireClubRole`). Importnyckeln behövs inte och tas inte emot här.

export async function clubWebImportCheckRoute(db: Database, request: Request, clubId: string, environment: Environment = process.env)
  : Promise<Response> {
  if (!validId(clubId)) return failure("not-found");
  const input = await mutation(request, environment, "json", CLUB_IMPORT_BATCH_MAX_BYTES);
  if ("response" in input) return input.response;
  return guarded(async () => {
    const result = await importCheck(db, { session: input.proof, clubId, request: input.body });
    return result.status === "ok" ? privateJson(result.response) : failure(result.status);
  });
}

export async function clubWebImportContentRoute(db: Database, request: Request, clubId: string, sha256: string,
  environment: Environment = process.env): Promise<Response> {
  if (!validId(clubId)) return failure("not-found");
  const input = await mutation(request, environment, "stream");
  if ("response" in input) return input.response;
  if (request.headers.get("content-type") !== "application/octet-stream" || !request.body) return failure("invalid-request");
  if (!validDeclaredLength(request, CLUB_ARCHIVE_MAP_MAX_BYTES)) return problem("MAP_FILE_TOO_LARGE");
  const body = request.body;
  return guarded(async () => {
    const result = await importMapContent(db, { session: input.proof, clubId, sha256, body: streamChunks(body) });
    if (result.status === "problem") return problem(result.problem === "TOO_LARGE" ? "MAP_FILE_TOO_LARGE" : result.problem);
    if (result.status === "quota") return problem("STORAGE_QUOTA_EXCEEDED", result.quota);
    return result.status === "ok" ? privateJson(result.response) : failure(result.status);
  });
}

export async function clubWebImportBatchRoute(db: Database, request: Request, clubId: string, environment: Environment = process.env)
  : Promise<Response> {
  if (!validId(clubId)) return failure("not-found");
  const input = await mutation(request, environment, "json", CLUB_IMPORT_BATCH_MAX_BYTES);
  if ("response" in input) return input.response;
  return guarded(async () => {
    const result = await importBatch(db, { session: input.proof, clubId, request: input.body });
    return result.status === "ok" ? privateJson(result.response) : failure(result.status);
  });
}
