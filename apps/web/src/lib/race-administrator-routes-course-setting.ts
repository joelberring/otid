import {
  COURSE_SETTING_EDITS_MAX_BYTES, COURSE_SETTING_IMPORT_MAX_BYTES, COURSE_SETTING_NOTE_MAX_BYTES, COURSE_SETTING_SAVE_MAX_BYTES,
  courseSettingConflictSchema, courseSettingEditsSavedSchema, courseSettingInspectionsSchema, courseSettingModeRequestSchema, courseSettingNoteSchema, courseSettingNotesSchema,
  courseSettingRevisionSchema, courseSettingRevisionsSchema, courseSettingSavedSchema, courseSettingStateSchema, courseSettingSuggestionDecidedSchema,
  courseSettingSuggestionSchema, courseSettingSuggestionsSchema, courseSettingTransferProblemSchema, PRINT_JOB_REQUEST_MAX_BYTES, printJobProblemSchema,
  printJobSchema, printJobsSchema, syncPreviewResponseSchema
} from "@o-tid/contracts";
import { createCourseSettingEventStream, publishCourseSettingEvent } from "./course-setting-events";
import { adminFailure as failure, privateHeaders, privateJson as json, readJsonBody } from "./security-policy";
import { resultFailure, type RaceAdministratorRouteContext } from "./race-administrator-route-context";

/**
 * Steg 62 (ADR-0180): banläggningens routes. Läget (GET) och sparandet med versionskontroll (PUT), inläst .ppen (POST),
 * tidigare versioner (GET, återställ med POST), den inlästa filen orörd (GET) och "Överför till tävlingen" (POST, ger
 * banfilens förhandsvisning). Skrivningar kräver CSRF. 409 ger den aktuella versionen.
 *
 * Steg 66: behörigheten är banläggningens (`COURSE_SETTING_ROUTES` i race-roles.ts). Nytt: åtgärder (POST edits),
 * arbetssättet (PUT mode), notiser med svar, status och foto, förslag och beslut, och strömmen till editorn (GET events,
 * SSE). En lyckad skrivning ger ett besked i strömmen (`course-setting-events.ts`).
 *
 * Steg 67: "kollad" per kontroll (GET och PUT inspections).
 *
 * Steg 65: PDF för tryck (bara admin): jobben (GET), nytt jobb (POST, 201; samma requestId igen 200), ta bort (DELETE)
 * och den färdiga PDF:en (GET, som bilaga, privat och utan cache). PDF:en skrivs av utskriftsarbetaren, aldrig här.
 */
async function body(request: Request, maxBytes: number): Promise<unknown> {
  try { return await readJsonBody(request, maxBytes); } catch { return undefined; }
}

type Saved = { status: string; response?: unknown; conflict?: unknown };
function saved(result: Saved, raceId: string, by: string): Response {
  if (result.status === "version-conflict") return json(courseSettingConflictSchema.parse(result.conflict), 409);
  if (result.status !== "ok") return resultFailure(result.status);
  const response = courseSettingSavedSchema.parse(result.response);
  if (response.raceId !== raceId) return failure(500, "INTERNAL_ERROR");
  publishCourseSettingEvent(raceId, { type: "version", version: response.version, by });
  return json(response);
}

/** Filnamnet i Content-Disposition: bokstäver, siffror och några tecken; alltid .ppen. */
export function ppenFileName(fileName: string): string {
  const name = fileName.replace(/[^\p{L}\p{N} ._-]/gu, "_").replace(/\.ppen$/i, "").trim().slice(0, 120) || "banlaggning";
  return `${name}.ppen`;
}

export async function handleCourseSettingRoute(context: RaceAdministratorRouteContext): Promise<Response | undefined> {
  const { db, request, raceId, action, dependencies, proof } = context;
  const input = { ...proof, raceId };
  const by = context.courseSetting?.accountId ?? "";
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
      return saved(await dependencies.courseSettingSave(db, { ...input, request: value }), raceId, by);
    }
    case "course-setting-import": {
      const value = await body(request, COURSE_SETTING_IMPORT_MAX_BYTES);
      if (value === undefined) return failure(400, "INVALID_REQUEST");
      return saved(await dependencies.courseSettingImport(db, { ...input, request: value }), raceId, by);
    }
    case "course-setting-restore": {
      const value = await body(request, 4096);
      if (value === undefined) return failure(400, "INVALID_REQUEST");
      return saved(await dependencies.courseSettingRestore(db, { ...input, request: value }), raceId, by);
    }
    case "course-setting-revisions": {
      const result = await dependencies.courseSettingRevisions(db, input);
      if (result.status !== "ok") return resultFailure(result.status);
      const response = courseSettingRevisionsSchema.parse(result.response);
      return response.raceId === raceId ? json(response) : failure(500, "INTERNAL_ERROR");
    }
    case "course-setting-revision": {
      // Versionen prövas efter rollen (en funktionär får 403 oavsett adress).
      if (!Number.isSafeInteger(action.version) || action.version < 1 || action.version > 2_147_483_647) return failure(400, "INVALID_REQUEST");
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
    case "course-setting-edits": {
      const value = await body(request, COURSE_SETTING_EDITS_MAX_BYTES);
      if (value === undefined) return failure(400, "INVALID_REQUEST");
      const result = await dependencies.courseSettingEdits(db, { ...input, request: value });
      if (result.status !== "ok") return resultFailure(result.status);
      const response = courseSettingEditsSavedSchema.parse(result.response);
      if (response.raceId !== raceId) return failure(500, "INTERNAL_ERROR");
      if (response.applied > 0) publishCourseSettingEvent(raceId, { type: "version", version: response.version, by });
      return json(response);
    }
    case "course-setting-mode": {
      const value = await body(request, 1024);
      if (value === undefined) return failure(400, "INVALID_REQUEST");
      const result = await dependencies.courseSettingMode(db, { ...input, request: value });
      if (result.status !== "ok") return resultFailure(result.status);
      publishCourseSettingEvent(raceId, { type: "mode", by });
      return json(courseSettingModeRequestSchema.parse({ formatVersion: 1, mode: result.mode }));
    }
    case "course-setting-notes": {
      if (request.method === "GET") {
        const result = await dependencies.courseSettingNotes(db, input);
        if (result.status !== "ok") return resultFailure(result.status);
        const response = courseSettingNotesSchema.parse(result.response);
        return response.raceId === raceId ? json(response) : failure(500, "INTERNAL_ERROR");
      }
      const value = await body(request, COURSE_SETTING_NOTE_MAX_BYTES);
      if (value === undefined) return failure(400, "INVALID_REQUEST");
      return note(await dependencies.courseSettingNote(db, { ...input, request: value }), raceId, by);
    }
    case "course-setting-note-reply": {
      const value = await body(request, 16 * 1024);
      if (value === undefined) return failure(400, "INVALID_REQUEST");
      return note(await dependencies.courseSettingNoteReply(db, { ...input, noteId: action.noteId, request: value }), raceId, by);
    }
    case "course-setting-note-status": {
      const value = await body(request, 1024);
      if (value === undefined) return failure(400, "INVALID_REQUEST");
      return note(await dependencies.courseSettingNoteStatus(db, { ...input, noteId: action.noteId, request: value }), raceId, by);
    }
    case "course-setting-note-photo": {
      const result = await dependencies.courseSettingNotePhoto(db, { ...input, noteId: action.noteId });
      if (result.status !== "ok") return resultFailure(result.status);
      return new Response(new Uint8Array(result.photo), { headers: { ...privateHeaders, "content-type": result.mediaType,
        "content-length": String(result.photo.byteLength), "x-content-type-options": "nosniff",
        "content-security-policy": "default-src 'none'; sandbox" } });
    }
    case "course-setting-suggestions": {
      if (request.method === "GET") {
        const result = await dependencies.courseSettingSuggestions(db, input);
        if (result.status !== "ok") return resultFailure(result.status);
        const response = courseSettingSuggestionsSchema.parse(result.response);
        return response.raceId === raceId ? json(response) : failure(500, "INTERNAL_ERROR");
      }
      const value = await body(request, COURSE_SETTING_EDITS_MAX_BYTES);
      if (value === undefined) return failure(400, "INVALID_REQUEST");
      const result = await dependencies.courseSettingSuggestion(db, { ...input, request: value });
      if (result.status !== "ok") return resultFailure(result.status);
      publishCourseSettingEvent(raceId, { type: "suggestions", by });
      return json(courseSettingSuggestionSchema.parse(result.suggestion));
    }
    case "course-setting-suggestion-decision": {
      const value = await body(request, 64 * 1024);
      if (value === undefined) return failure(400, "INVALID_REQUEST");
      const result = await dependencies.courseSettingSuggestionDecision(db, { ...input, suggestionId: action.suggestionId, request: value });
      if (result.status !== "ok") return resultFailure(result.status);
      const response = courseSettingSuggestionDecidedSchema.parse(result.response);
      if (response.raceId !== raceId) return failure(500, "INTERNAL_ERROR");
      publishCourseSettingEvent(raceId, { type: "suggestions", by });
      if (response.saved && response.saved.applied > 0) publishCourseSettingEvent(raceId, { type: "version", version: response.saved.version, by });
      return json(response);
    }
    case "course-setting-inspections": {
      if (request.method === "GET") {
        const result = await dependencies.courseSettingInspections(db, input);
        if (result.status !== "ok") return resultFailure(result.status);
        const response = courseSettingInspectionsSchema.parse(result.response);
        return response.raceId === raceId ? json(response) : failure(500, "INTERNAL_ERROR");
      }
      const value = await body(request, 4096);
      if (value === undefined) return failure(400, "INVALID_REQUEST");
      const result = await dependencies.courseSettingInspection(db, { ...input, request: value });
      if (result.status !== "ok") return resultFailure(result.status);
      const response = courseSettingInspectionsSchema.parse(result.response);
      if (response.raceId !== raceId) return failure(500, "INTERNAL_ERROR");
      if (result.changed) publishCourseSettingEvent(raceId, { type: "inspections", by });
      return json(response);
    }
    case "course-setting-print-jobs": {
      if (request.method === "GET") {
        const result = await dependencies.printJobs(db, input);
        if (result.status !== "ok") return resultFailure(result.status);
        const response = printJobsSchema.parse(result.response);
        return response.raceId === raceId ? json(response) : failure(500, "INTERNAL_ERROR");
      }
      const value = await body(request, PRINT_JOB_REQUEST_MAX_BYTES);
      if (value === undefined) return failure(400, "INVALID_REQUEST");
      const result = await dependencies.printJobCreate(db, { ...input, request: value });
      if (result.status === "problem") return json(printJobProblemSchema.parse(result.problem), 422);
      if (result.status !== "ok") return resultFailure(result.status);
      return json(printJobSchema.parse(result.job), result.created ? 201 : 200);
    }
    case "course-setting-print-job": {
      const result = await dependencies.printJobDelete(db, { ...input, jobId: action.jobId });
      if (result.status !== "ok") return resultFailure(result.status);
      return new Response(null, { status: 204, headers: privateHeaders });
    }
    case "course-setting-print-job-pdf": {
      const result = await dependencies.printJobPdf(db, { ...input, jobId: action.jobId });
      if (result.status !== "ok") return resultFailure(result.status);
      // Utan kopia (en PDF kan vara stor).
      return new Response(new Uint8Array(result.pdf.buffer as ArrayBuffer, result.pdf.byteOffset, result.pdf.byteLength), { headers: { ...privateHeaders,
        "content-type": "application/pdf", "content-length": String(result.pdf.byteLength),
        "content-disposition": `attachment; filename="${result.fileName}"` } });
    }
    case "course-setting-events": {
      const viewer = context.courseSetting;
      if (!viewer) return failure(403, "FORBIDDEN");
      const stream = createCourseSettingEventStream(request, raceId, { accountId: viewer.accountId, displayName: viewer.displayName || null,
        level: viewer.level });
      if (!stream) return new Response(null, { status: 503, headers: { ...privateHeaders, "retry-after": "20" } });
      return new Response(stream, { headers: { ...privateHeaders, "content-type": "text/event-stream; charset=utf-8",
        "cache-control": "private, no-store, no-transform", connection: "keep-alive", "x-accel-buffering": "no" } });
    }
    default:
      return undefined;
  }
}

function note(result: { status: string; note?: unknown }, raceId: string, by: string): Response {
  if (result.status !== "ok") return resultFailure(result.status);
  publishCourseSettingEvent(raceId, { type: "notes", by });
  return json(courseSettingNoteSchema.parse(result.note));
}
