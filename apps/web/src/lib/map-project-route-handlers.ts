import {
  createMapProject, createMapProjectFromUpload, createMapProjectNew, deleteMapProject, discardStagedMapContent, exportMapProjectChanges, inviteMapProjectMember, listMapProjects,
  readMapProject, readMapProjectOutput, readMapProjectPdf, readMapProjectSource, startMapProjectPdf, removeMapProjectMember, setMapProjectMemberRole, stageMapContent, streamMapContentParts,
  syncMapProject, updateMapProject, writeMapProjectVersion
} from "@o-tid/application";
import { CLUB_ARCHIVE_MAP_MAX_BYTES, MAP_PROJECT_SYNC_MAX_BYTES, mapProjectExportFormatSchema, UUID_PATTERN } from "@o-tid/contracts";
import type { Database } from "@o-tid/database";
import {
  attachment, contentPartStream, failure, guarded, headerText, mutation, privateContentCacheHeaders, problem, readProof, requireStreamSession, streamChunks,
  type ClubEnvironment
} from "./club-route-handlers";
import { matchesIfNoneMatch } from "./http-etag";
import { mailAvailable, routeMailer } from "./invitation-route-handlers";
import { privateHeaders, privateJson, validDeclaredLength } from "./security-policy";

/**
 * ADR-0219: kartprojektens anrop under /api/organizer/map-projects. Samma skydd som klubbens (exakt Origin och CSRF på
 * skrivningar, privata svar utan cache); behörigheten avgörs i tjänsterna. Projekten är aldrig publika.
 */
type Environment = ClubEnvironment;
const validId = (id: string) => UUID_PATTERN.test(id);

/** GET kontots projekt, POST nytt projekt från en kartversion i klubbarkivet (ett eget projekt från en fil: `mapProjectUploadRoute`). */
export async function mapProjectsRoute(db: Database, request: Request, environment: Environment = process.env): Promise<Response> {
  if (request.method === "GET") {
    const input = await readProof(request, environment);
    if ("response" in input) return input.response;
    return guarded(async () => {
      const result = await listMapProjects(db, input.proof);
      return result.status === "ok" ? privateJson(result.list) : failure(result.status);
    });
  }
  const input = await mutation(request, environment);
  if ("response" in input) return input.response;
  return guarded(async () => {
    const result = await createMapProject(db, { ...input.proof, request: input.body });
    return result.status === "created" ? privateJson({ formatVersion: 1, projectId: result.projectId }, result.replayed ? 200 : 201)
      : failure(result.status);
  });
}

/** POST nytt projekt med en ny tom karta (K1): norm, skala, område och missvisning; 422 när området är för stort. */
export async function mapProjectNewRoute(db: Database, request: Request, environment: Environment = process.env): Promise<Response> {
  const input = await mutation(request, environment);
  if ("response" in input) return input.response;
  return guarded(async () => {
    const result = await createMapProjectNew(db, { ...input.proof, request: input.body });
    if (result.status === "quota") return problem("STORAGE_QUOTA_EXCEEDED");
    if (result.status === "area-too-large") return problem("AREA_TOO_LARGE");
    return result.status === "created" ? privateJson({ formatVersion: 1, projectId: result.projectId }, result.replayed ? 200 : 201)
      : failure(result.status);
  });
}

/** GET projektet, PUT byt namn, avsluta eller öppna igen, DELETE radera projektet (ägaren; 422 `MAP_PROJECT_BUSY` vid pågående körningar). */
export async function mapProjectRoute(db: Database, request: Request, projectId: string, environment: Environment = process.env): Promise<Response> {
  if (!validId(projectId)) return failure("not-found");
  if (request.method === "GET") {
    const input = await readProof(request, environment);
    if ("response" in input) return input.response;
    return guarded(async () => {
      const result = await readMapProject(db, { ...input.proof, projectId });
      return result.status === "ok" ? privateJson({ ...result.view, mailEnabled: mailAvailable(environment) }) : failure(result.status);
    });
  }
  if (request.method === "DELETE") {
    const removal = await mutation(request, environment, "none");
    if ("response" in removal) return removal.response;
    return guarded(async () => {
      const result = await deleteMapProject(db, { ...removal.proof, projectId });
      if (result.status === "busy") return problem("MAP_PROJECT_BUSY");
      return result.status === "deleted" ? privateJson({ formatVersion: 1, status: "deleted" }) : failure(result.status);
    });
  }
  const input = await mutation(request, environment);
  if ("response" in input) return input.response;
  return guarded(async () => {
    const result = await updateMapProject(db, { ...input.proof, projectId, request: input.body });
    return result.status === "ok" ? privateJson({ formatVersion: 1, status: "ok" }) : failure(result.status);
  });
}

/** POST bjud in, PUT byt roll, DELETE ta bort medlem eller inbjudan (eller lämna själv). */
export async function mapProjectMembersRoute(db: Database, request: Request, projectId: string, environment: Environment = process.env)
  : Promise<Response> {
  if (!validId(projectId)) return failure("not-found");
  const input = await mutation(request, environment);
  if ("response" in input) return input.response;
  return guarded(async () => {
    const args = { ...input.proof, projectId, request: input.body };
    if (request.method === "POST") {
      const result = await inviteMapProjectMember(db, args, new Date(), routeMailer(environment, request));
      // Samma svar med och utan konto (ADR-0188 beslut 6), och vad som hände med mejlet (ADR-0206).
      return result.status === "invited" ? privateJson({ formatVersion: 1, invitationId: result.invitationId, mail: result.mail },
        result.replayed ? 200 : 201) : failure(result.status);
    }
    if (request.method === "PUT") {
      const result = await setMapProjectMemberRole(db, args);
      return result.status === "ok" ? privateJson({ formatVersion: 1, status: "ok" }) : failure(result.status);
    }
    const result = await removeMapProjectMember(db, args);
    return result.status === "removed" ? privateJson({ formatVersion: 1, status: "removed" }) : failure(result.status);
  });
}

/**
 * POST ett eget projekt från en kartfil (kroppen, `application/octet-stream`; uppgifterna i rubrikerna). Filen strömmas till
 * kartinnehållet först och tas bort igen om projektet inte skapas.
 */
export async function mapProjectUploadRoute(db: Database, request: Request, environment: Environment = process.env): Promise<Response> {
  const input = await mutation(request, environment, "stream");
  if ("response" in input) return input.response;
  if (request.headers.get("content-type") !== "application/octet-stream" || !request.body) return failure("invalid-request");
  if (!validDeclaredLength(request, CLUB_ARCHIVE_MAP_MAX_BYTES)) return problem("MAP_FILE_TOO_LARGE");
  const metadata = { formatVersion: 1, requestId: headerText(request, "x-otid-request-id", 64) ?? "", name: headerText(request, "x-otid-name", 120) ?? "",
    fileName: headerText(request, "x-otid-file-name", 200) ?? "" };
  const unauthenticated = await requireStreamSession(db, input.proof);
  if (unauthenticated) return unauthenticated;
  const body = request.body;
  return guarded(async () => {
    const staged = await stageMapContent(db, streamChunks(body), { maxBytes: CLUB_ARCHIVE_MAP_MAX_BYTES });
    if (staged.kind === "too-large") return problem("MAP_FILE_TOO_LARGE");
    if (staged.kind === "empty") return failure("invalid-request");
    let result: Awaited<ReturnType<typeof createMapProjectFromUpload>>;
    // Granskningen runda 2 (A): den strömmade filen tas bort efter transaktionen, också när innehållet sparades.
    try { result = await createMapProjectFromUpload(db, { ...input.proof, metadata, file: staged }); }
    finally { await discardStagedMapContent(db, staged.contentId); }
    if (result.status === "created") return privateJson({ formatVersion: 1, projectId: result.projectId }, result.replayed ? 200 : 201);
    if (result.status === "quota") return problem("STORAGE_QUOTA_EXCEEDED");
    if (result.status === "unsupported-file") return problem("UNSUPPORTED_MAP_FILE");
    if (result.status === "too-large") return problem("MAP_FILE_TOO_LARGE");
    return failure(result.status);
  });
}

/** GET ett resultat ur projektet (strömmas, oföränderligt per sha256). */
export async function mapProjectOutputRoute(db: Database, request: Request, projectId: string, outputId: string,
  environment: Environment = process.env): Promise<Response> {
  if (!validId(projectId) || !validId(outputId)) return failure("not-found");
  const input = await readProof(request, environment);
  if ("response" in input) return input.response;
  return guarded(async () => {
    const head = await readMapProjectOutput(db, { ...input.proof, projectId, outputId });
    if (head.status !== "ok") return failure(head.status);
    return contentResponse(db, request, head, head.fileName.toLowerCase().endsWith(".ocd") ? "karta.ocd" : "karta.omap");
  });
}

/** Innehållet som en ström (privat, med filnamn, storlek och ETag/304 före läsning av delar). */
function contentResponse(db: Database, request: Request, head: { contentId: string; fileName: string; byteLength: number; sha256: string }, fallback: string): Response {
  const cache = privateContentCacheHeaders(request, head.sha256);
  if (matchesIfNoneMatch(request.headers.get("if-none-match"), `"${head.sha256}"`)) {
    return new Response(null, { status: 304, headers: cache });
  }
  const stream = contentPartStream(streamMapContentParts(db, head.contentId), "map-project", "content");
  return new Response(stream, { headers: { ...cache, "content-type": "application/octet-stream",
    "content-disposition": attachment(head.fileName, fallback), "content-length": String(head.byteLength) } });
}

/** GET grundfilen (strömmas, oföränderlig per sha256). */
export async function mapProjectSourceRoute(db: Database, request: Request, projectId: string, environment: Environment = process.env)
  : Promise<Response> {
  if (!validId(projectId)) return failure("not-found");
  const input = await readProof(request, environment);
  if ("response" in input) return input.response;
  return guarded(async () => {
    const head = await readMapProjectSource(db, { ...input.proof, projectId });
    if (head.status !== "ok") return failure(head.status);
    return contentResponse(db, request, head, head.format === "OCD" ? "karta.ocd" : "karta.omap");
  });
}

/** POST en omgång ändringar och det som ändrats sedan `since`. */
export async function mapProjectSyncRoute(db: Database, request: Request, projectId: string, environment: Environment = process.env)
  : Promise<Response> {
  if (!validId(projectId)) return failure("not-found");
  const input = await mutation(request, environment, "json", MAP_PROJECT_SYNC_MAX_BYTES);
  if ("response" in input) return input.response;
  return guarded(async () => {
    const result = await syncMapProject(db, { ...input.proof, projectId, request: input.body });
    return result.status === "ok" ? privateJson(result.response) : failure(result.status);
  });
}

/** POST "Skapa ny kartversion" ur ändringarna. */
export async function mapProjectVersionRoute(db: Database, request: Request, projectId: string, environment: Environment = process.env)
  : Promise<Response> {
  if (!validId(projectId)) return failure("not-found");
  const input = await mutation(request, environment);
  if ("response" in input) return input.response;
  return guarded(async () => {
    const result = await writeMapProjectVersion(db, { ...input.proof, projectId, request: input.body });
    if (result.status !== "ok") return failure(result.status);
    return privateJson(result.response, result.response.status === "created" && !result.replayed ? 201 : 200);
  });
}

/** GET ändringarna (`?format=omap|ocd|geojson`) eller konverterad fullkarta (`?format=ocd-full|omap-full`, `&report=1` för JSON-rapport). */
export async function mapProjectExportRoute(db: Database, request: Request, projectId: string, environment: Environment = process.env)
  : Promise<Response> {
  if (!validId(projectId)) return failure("not-found");
  const url = new URL(request.url);
  const parsedFormat = mapProjectExportFormatSchema.safeParse(url.searchParams.get("format"));
  if (!parsedFormat.success) return failure("invalid-request");
  const format = parsedFormat.data;
  const reportOnly = url.searchParams.get("report") === "1";
  if (reportOnly && format !== "ocd-full" && format !== "omap-full") return failure("invalid-request");
  const input = await readProof(request, environment);
  if ("response" in input) return input.response;
  return guarded(async () => {
    const result = await exportMapProjectChanges(db, { ...input.proof, projectId, format });
    if (result.status !== "ok") return failure(result.status);
    const conversionReport = "report" in result ? { formatVersion: 1 as const, fileName: result.fileName, ...result.report } : undefined;
    if (reportOnly) {
      if (!conversionReport) return failure("invalid-request");
      return privateJson(conversionReport);
    }
    const reportHeaders: Record<string, string> = {};
    if (conversionReport) {
      reportHeaders["x-otid-conversion-warnings"] = String(conversionReport.warnings.length);
      const encoded = Buffer.from(JSON.stringify(conversionReport), "utf8").toString("base64");
      if (encoded.length <= 8192) reportHeaders["x-otid-conversion-report"] = encoded;
    }
    if (result.body instanceof Uint8Array) {
      const contentType = format === "omap-full" ? `${result.contentType}; charset=utf-8` : result.contentType;
      const fallback = format === "omap-full" ? "karta.omap" : format === "ocd-full" ? "karta.ocd" : "andringar.ocd";
      return new Response(Buffer.from(result.body), { headers: { ...privateHeaders, ...reportHeaders, "content-type": contentType,
        "content-disposition": attachment(result.fileName, fallback) } });
    }
    return new Response(result.body, { headers: { ...privateHeaders, ...reportHeaders, "content-type": `${result.contentType}; charset=utf-8`,
      "content-disposition": attachment(result.fileName, format === "omap" ? "andringar.xmap" : "andringar.geojson") } });
  });
}

/**
 * Ägaren 2026-11-15: hela kartan som PDF. POST lägger jobbet (202 med `jobId`, 429 när kontot har för många jobb);
 * GET `?job=` svarar 202 medan det pågår, 422 när det misslyckats och PDF:en när den är klar.
 */
function parseMapPdfOptions(body: unknown): { mode?: "OFFICE" | "PRESS"; lightenForOffice?: boolean } | null {
  if (body === undefined) return {};
  if (typeof body !== "object" || body === null || Array.isArray(body)) return null;
  const record = body as Record<string, unknown>;
  for (const key of Object.keys(record)) if (key !== "mode" && key !== "lightenForOffice") return null;
  if (record.mode !== undefined && record.mode !== "OFFICE" && record.mode !== "PRESS") return null;
  if (record.lightenForOffice !== undefined && typeof record.lightenForOffice !== "boolean") return null;
  return {
    ...(record.mode !== undefined ? { mode: record.mode } : {}),
    ...(record.lightenForOffice !== undefined ? { lightenForOffice: record.lightenForOffice } : {})
  };
}

export async function mapProjectPdfRoute(db: Database, request: Request, projectId: string, environment: Environment = process.env): Promise<Response> {
  if (!validId(projectId)) return failure("not-found");
  if (request.method === "POST") {
    const hasContentType = request.headers.get("content-type") !== null;
    const input = await mutation(request, environment, hasContentType ? "json" : "none");
    if ("response" in input) return input.response;
    const options = parseMapPdfOptions(input.body);
    if (!options) return failure("invalid-request");
    return guarded(async () => {
      const result = await startMapProjectPdf(db, { ...input.proof, projectId, ...options });
      if (result.status === "throttled") return privateJson({ formatVersion: 1, error: "throttled" }, 429);
      return result.status === "ok" ? privateJson({ formatVersion: 1, jobId: result.jobId }, 202) : failure(result.status);
    });
  }
  const jobId = new URL(request.url).searchParams.get("job") ?? "";
  const input = await readProof(request, environment);
  if ("response" in input) return input.response;
  return guarded(async () => {
    const result = await readMapProjectPdf(db, { ...input.proof, projectId, jobId });
    if (result.status === "waiting") return privateJson({ formatVersion: 1, status: "waiting" }, 202);
    if (result.status === "failed") return problem(result.error);
    if (result.status !== "ok") return failure(result.status);
    return new Response(Buffer.from(result.bytes), { headers: { ...privateHeaders, "content-type": "application/pdf",
      "content-disposition": attachment(result.fileName, "karta.pdf").replace(/^attachment/, "inline"),
      "x-otid-paper-size": result.result.size ?? "", "x-otid-paper-landscape": String(result.result.landscape),
      "x-otid-paper-width": String(result.result.widthMm), "x-otid-paper-height": String(result.result.heightMm) } });
  });
}
