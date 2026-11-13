import { discardStagedMapContent, readMapProjectCurrentFile, saveMapProjectSnapshotToRace } from "@o-tid/application";
import { MAP_PROJECT_SNAPSHOT_HEADERS, UUID_PATTERN } from "@o-tid/contracts";
import type { Database } from "@o-tid/database";
import { attachment, failure, guarded, mutation, problem, readProof, renderedMap, type ClubEnvironment } from "./club-route-handlers";
import { privateHeaders, privateJson } from "./security-policy";

/**
 * Ägarens plan 2026-11-13, etapp 1: kartprojektets aktuella karta som banläggningens kartfil. Samma skydd som kartprojektens
 * andra anrop (exakt Origin och CSRF på skrivningen, privata svar utan cache); behörigheten avgörs i tjänsterna.
 */
const validId = (id: string) => UUID_PATTERN.test(id);
/** 422 när skrivaren vägrar (t.ex. en OCAD-karta med ändringar innan OCAD-skrivningen är påslagen); skälen följer med. */
const refused = (refusals: readonly { code: string; message: string }[]) =>
  privateJson({ formatVersion: 1, error: "MAP_NOT_WRITABLE", refusals }, 422);

/** GET projektets aktuella karta (grundfilen med införda ändringar) som fil; löpnumret och filens sha256 i rubrikerna. */
export async function mapProjectCurrentFileRoute(db: Database, request: Request, projectId: string, environment: ClubEnvironment = process.env)
  : Promise<Response> {
  if (!validId(projectId)) return failure("not-found");
  const input = await readProof(request, environment);
  if ("response" in input) return input.response;
  return guarded(async () => {
    const result = await readMapProjectCurrentFile(db, { ...input.proof, projectId });
    if (result.status === "refused") return refused(result.refusals);
    if (result.status !== "ok") return failure(result.status);
    return new Response(new Uint8Array(result.bytes), { headers: { ...privateHeaders, "content-type": "application/octet-stream",
      "content-disposition": attachment(result.fileName, result.format === "OCD" ? "karta.ocd" : "karta.omap"),
      "content-length": String(result.bytes.byteLength), etag: `"${result.sha256}"`,
      [MAP_PROJECT_SNAPSHOT_HEADERS.seq]: String(result.seq), [MAP_PROJECT_SNAPSHOT_HEADERS.fileName]: encodeURIComponent(result.fileName.slice(0, 200)), [MAP_PROJECT_SNAPSHOT_HEADERS.sha256]: result.sha256 } });
  });
}

/**
 * POST kartan till tävlingen i `x-otid-race-id`: kopplar banläggningen till projektet eller tar in kartans ändringar. Kroppen
 * är bilden webbläsaren ritat och dess uppgifter (multipart), `x-otid-map-sha256` filen den ritades ur. 409 = kartan har
 * ändrats sedan den hämtades (hämta och rita på nytt).
 */
export async function mapProjectRaceRoute(db: Database, request: Request, projectId: string, environment: ClubEnvironment = process.env)
  : Promise<Response> {
  if (!validId(projectId)) return failure("not-found");
  const input = await mutation(request, environment, "stream");
  if ("response" in input) return input.response;
  const raceId = request.headers.get(MAP_PROJECT_SNAPSHOT_HEADERS.race) ?? "", sha256 = request.headers.get(MAP_PROJECT_SNAPSHOT_HEADERS.sha256) ?? "";
  return guarded(async () => {
    const rendered = await renderedMap(db, request);
    if (rendered instanceof Response) return rendered;
    try {
      const result = await saveMapProjectSnapshotToRace(db, { ...input.proof, projectId, raceId, sha256, image: rendered.image,
        metadata: rendered.metadata });
      if (result.status === "refused") return refused(result.refusals);
      if (result.status === "problem") return problem(result.problem, result.quota);
      return result.status === "ok" ? privateJson({ formatVersion: 1, georeferenced: result.georeferenced, seq: result.seq }) : failure(result.status);
    } finally {
      await discardStagedMapContent(db, rendered.image.contentId);
    }
  });
}
