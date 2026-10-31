import {
  COURSE_SETTING_IMPORT_MAX_BYTES, COURSE_SETTING_SAVE_MAX_BYTES, courseSettingConflictSchema, courseSettingRevisionSchema,
  courseSettingRevisionsSchema, courseSettingSavedSchema, courseSettingStateSchema, courseSettingTransferProblemSchema, syncPreviewResponseSchema
} from "@o-tid/contracts";
import { adminFailure as failure, privateHeaders, privateJson as json, readJsonBody } from "./security-policy";
import { resultFailure, type RaceAdministratorRouteContext } from "./race-administrator-route-context";

/**
 * Steg 62 (ADR-0180): banläggningens routes. Läget (GET) och sparandet med versionskontroll (PUT), inläst .ppen (POST),
 * tidigare versioner (GET, återställ med POST), den inlästa filen orörd (GET) och "Överför till tävlingen" (POST, ger
 * banfilens förhandsvisning). Bara admin (race-roles.ts); skrivningar kräver CSRF. 409 ger den aktuella versionen.
 */
async function body(request: Request, maxBytes: number): Promise<unknown> {
  try { return await readJsonBody(request, maxBytes); } catch { return undefined; }
}

type Saved = { status: string; response?: unknown; conflict?: unknown };
function saved(result: Saved, raceId: string): Response {
  if (result.status === "version-conflict") return json(courseSettingConflictSchema.parse(result.conflict), 409);
  if (result.status !== "ok") return resultFailure(result.status);
  const response = courseSettingSavedSchema.parse(result.response);
  return response.raceId === raceId ? json(response) : failure(500, "INTERNAL_ERROR");
}

/** Filnamnet i Content-Disposition: bokstäver, siffror och några tecken; alltid .ppen. */
export function ppenFileName(fileName: string): string {
  const name = fileName.replace(/[^\p{L}\p{N} ._-]/gu, "_").replace(/\.ppen$/i, "").trim().slice(0, 120) || "banlaggning";
  return `${name}.ppen`;
}

export async function handleCourseSettingRoute(context: RaceAdministratorRouteContext): Promise<Response | undefined> {
  const { db, request, raceId, action, dependencies, proof } = context;
  const input = { ...proof, raceId };
  switch (action.kind) {
    case "course-setting": {
      if (request.method === "GET") {
        const result = await dependencies.courseSetting(db, input);
        if (result.status !== "ok") return resultFailure(result.status);
        const response = courseSettingStateSchema.parse(result.response);
        return response.raceId === raceId ? json(response) : failure(500, "INTERNAL_ERROR");
      }
      const value = await body(request, COURSE_SETTING_SAVE_MAX_BYTES);
      if (value === undefined) return failure(400, "INVALID_REQUEST");
      return saved(await dependencies.courseSettingSave(db, { ...input, request: value }), raceId);
    }
    case "course-setting-import": {
      const value = await body(request, COURSE_SETTING_IMPORT_MAX_BYTES);
      if (value === undefined) return failure(400, "INVALID_REQUEST");
      return saved(await dependencies.courseSettingImport(db, { ...input, request: value }), raceId);
    }
    case "course-setting-restore": {
      const value = await body(request, 4096);
      if (value === undefined) return failure(400, "INVALID_REQUEST");
      return saved(await dependencies.courseSettingRestore(db, { ...input, request: value }), raceId);
    }
    case "course-setting-revisions": {
      const result = await dependencies.courseSettingRevisions(db, input);
      if (result.status !== "ok") return resultFailure(result.status);
      const response = courseSettingRevisionsSchema.parse(result.response);
      return response.raceId === raceId ? json(response) : failure(500, "INTERNAL_ERROR");
    }
    case "course-setting-revision": {
      const result = await dependencies.courseSettingRevision(db, { ...input, version: action.version });
      if (result.status !== "ok") return resultFailure(result.status);
      const response = courseSettingRevisionSchema.parse(result.response);
      return response.raceId === raceId && response.version === action.version ? json(response) : failure(500, "INTERNAL_ERROR");
    }
    case "course-setting-original": {
      const result = await dependencies.courseSettingOriginal(db, input);
      if (result.status !== "ok") return resultFailure(result.status);
      const name = ppenFileName(result.fileName);
      return new Response(result.ppen, { headers: { ...privateHeaders, "content-type": "application/xml; charset=utf-8",
        "content-disposition": `attachment; filename="banlaggning.ppen"; filename*=UTF-8''${encodeURIComponent(name)}` } });
    }
    case "course-setting-transfer": {
      const value = await body(request, 4096);
      if (value === undefined) return failure(400, "INVALID_REQUEST");
      const result = await dependencies.courseSettingTransfer(db, { ...input, request: value });
      if (result.status === "version-conflict") return json(courseSettingConflictSchema.parse(result.conflict), 409);
      if (result.status === "problem") return json(courseSettingTransferProblemSchema.parse(result.problem), 422);
      if (result.status !== "ok") return resultFailure(result.status);
      const response = syncPreviewResponseSchema.parse(result.response);
      return response.raceId === raceId ? json(response) : failure(500, "INTERNAL_ERROR");
    }
    default:
      return undefined;
  }
}
