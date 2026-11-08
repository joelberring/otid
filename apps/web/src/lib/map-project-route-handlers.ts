import {
  createMapProject, createMapProjectFromUpload, createMapProjectNew, discardStagedMapContent, exportMapProjectChanges, inviteMapProjectMember, listMapProjects,
  readMapProject, readMapProjectOutput, readMapProjectSource, removeMapProjectMember, setMapProjectMemberRole, stageMapContent, streamMapContentParts,
  syncMapProject, updateMapProject, writeMapProjectVersion
} from "@o-tid/application";
import { CLUB_ARCHIVE_MAP_MAX_BYTES, MAP_PROJECT_SYNC_MAX_BYTES, UUID_PATTERN } from "@o-tid/contracts";
import type { Database } from "@o-tid/database";
import {
  attachment, failure, guarded, headerText, mutation, problem, readProof, streamChunks, type ClubEnvironment
} from "./club-route-handlers";
import { mailAvailable, routeMailer } from "./invitation-route-handlers";
import { privateHeaders, privateJson, validDeclaredLength } from "./security-policy";
import { logServerError } from "./server-error-log";

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

/** GET projektet, PUT byt namn, avsluta eller öppna igen. */
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
      const result = await inviteMapProjectMember(db, args, new Date(), routeMailer(environment));
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
  const body = request.body;
  return guarded(async () => {
    const staged = await stageMapContent(db, streamChunks(body), { maxBytes: CLUB_ARCHIVE_MAP_MAX_BYTES });
    if (staged.kind === "too-large") return problem("MAP_FILE_TOO_LARGE");
    if (staged.kind === "empty") return failure("invalid-request");
    let result: Awaited<ReturnType<typeof createMapProjectFromUpload>>;
    try { result = await createMapProjectFromUpload(db, { ...input.proof, metadata, file: staged }); }
    catch (error) { await discardStagedMapContent(db, staged.contentId); throw error; }
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
    return contentResponse(db, head, head.fileName.toLowerCase().endsWith(".ocd") ? "karta.ocd" : "karta.omap");
  });
}

/** Innehållet som en ström (privat, med filnamn och storlek). */
function contentResponse(db: Database, head: { contentId: string; fileName: string; byteLength: number; sha256: string }, fallback: string): Response {
  const parts = streamMapContentParts(db, head.contentId);
  const stream = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const next = await parts.next();
        if (next.done) controller.close(); else controller.enqueue(next.value);
      } catch (error) {
        logServerError("map-project", "content", error);
        controller.error(error);
      }
    },
    async cancel() { await parts.return(undefined); }
  });
  return new Response(stream, { headers: { ...privateHeaders, "content-type": "application/octet-stream",
    "content-disposition": attachment(head.fileName, fallback), "content-length": String(head.byteLength), etag: `"${head.sha256}"` } });
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
    return contentResponse(db, head, head.format === "OCD" ? "karta.ocd" : "karta.omap");
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

/** GET ändringarna som en liten egen fil (`?format=omap` eller `geojson`). */
export async function mapProjectExportRoute(db: Database, request: Request, projectId: string, environment: Environment = process.env)
  : Promise<Response> {
  if (!validId(projectId)) return failure("not-found");
  const format = new URL(request.url).searchParams.get("format");
  if (format !== "omap" && format !== "geojson") return failure("invalid-request");
  const input = await readProof(request, environment);
  if ("response" in input) return input.response;
  return guarded(async () => {
    const result = await exportMapProjectChanges(db, { ...input.proof, projectId, format });
    if (result.status !== "ok") return failure(result.status);
    return new Response(result.body, { headers: { ...privateHeaders, "content-type": `${result.contentType}; charset=utf-8`,
      "content-disposition": attachment(result.fileName, format === "omap" ? "andringar.xmap" : "andringar.geojson") } });
  });
}
