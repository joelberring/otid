import {
  courseSettingConflictSchema, courseSettingRevisionSchema, courseSettingRevisionsSchema, courseSettingSavedSchema, courseSettingStateSchema,
  courseSettingTransferProblemSchema, syncPreviewResponseSchema, type CourseSettingConflict, type CourseSettingRevision,
  type CourseSettingRevisions, type CourseSettingState, type CourseSettingTransferProblem, type SyncPreviewResponse
} from "@o-tid/contracts";
import {
  courseSettingEditsSavedSchema, courseSettingInspectionsSchema, courseSettingModeRequestSchema, courseSettingNoteSchema, courseSettingNotesSchema, courseSettingSuggestionDecidedSchema,
  courseSettingSuggestionSchema, courseSettingSuggestionsSchema, type CourseSettingEditsRequest, type CourseSettingEditsSaved, type CourseSettingMode,
  type CourseSettingNote, type CourseSettingNoteCreate, type CourseSettingNotes, type CourseSettingSuggestion, type CourseSettingSuggestionCreate,
  type CourseSettingSuggestionDecided, type CourseSettingSuggestionDecision, type CourseSettingSuggestions, type CourseSettingInspectionRequest,
  type CourseSettingInspections
} from "@o-tid/contracts";
import type { CourseSettingDocument } from "@o-tid/course-setting";
import { HttpStatusError } from "./course-setting-sync";
import { readAccountCsrfCookie } from "./organizer-account-cookies";
import { fetchUntilReached, fetchWithRetry } from "./retrying-fetch";
export type SaveOutcome<C> = { readonly kind: "saved"; readonly version: number } | { readonly kind: "conflict"; readonly conflict: C }
  | { readonly kind: "too-large" };

/**
 * Steg 62: banläggningens anrop. Egna anrop (som vägvalen), så att autosparandet inte stör något annat. Servern
 * kontrollerar behörigheten (steg 66: banläggningens). 409 ger den aktuella versionen.
 */
export const courseSettingBase = (raceId: string) => `/api/admin/races/${encodeURIComponent(raceId)}/administrator`;
const base = courseSettingBase;

function csrf(): string {
  const value = readAccountCsrfCookie(document.cookie, new URL(window.location.href));
  if (!value) throw new Error("csrf");
  return value;
}

export class HttpError extends Error {
  constructor(readonly status: number) { super(String(status)); }
}

/** Skrivningarna: ett svar som aldrig nådde routen (utvecklingsserverns 404-sida) skickas om (`fetchUntilReached`). */
const write = (raceId: string, path: string, method: string, body: unknown) => fetchUntilReached(`${base(raceId)}${path}`, { method,
  credentials: "same-origin", headers: { "content-type": "application/json", "x-otid-csrf": csrf() }, body: JSON.stringify(body) });

export async function fetchCourseSetting(raceId: string, signal?: AbortSignal): Promise<CourseSettingState> {
  const response = await fetchWithRetry(`${base(raceId)}/course-setting`, { credentials: "same-origin", cache: "no-store", signal: signal ?? null });
  if (!response.ok) throw new HttpError(response.status);
  const value = courseSettingStateSchema.parse(await response.json());
  if (value.raceId !== raceId) throw new Error("scope");
  return value;
}

async function savedOrConflict(raceId: string, response: Response): Promise<SaveOutcome<CourseSettingConflict>> {
  if (response.status === 409) return { kind: "conflict", conflict: courseSettingConflictSchema.parse(await response.json()) };
  if (response.status === 413) return { kind: "too-large" };
  if (!response.ok) throw new HttpError(response.status);
  const saved = courseSettingSavedSchema.parse(await response.json());
  if (saved.raceId !== raceId) throw new Error("scope");
  return { kind: "saved", version: saved.version };
}

export async function saveCourseSetting(raceId: string, document: CourseSettingDocument, expectedVersion: number)
  : Promise<SaveOutcome<CourseSettingConflict>> {
  return savedOrConflict(raceId, await write(raceId, "/course-setting", "PUT", { formatVersion: 1, expectedVersion, document }));
}

export async function importCourseSetting(raceId: string, input: { document: CourseSettingDocument; expectedVersion: number; fileName: string;
  ppen: string }): Promise<SaveOutcome<CourseSettingConflict>> {
  return savedOrConflict(raceId, await write(raceId, "/course-setting/import", "POST", { formatVersion: 1, ...input }));
}

export async function restoreCourseSetting(raceId: string, expectedVersion: number, revision: number): Promise<SaveOutcome<CourseSettingConflict>> {
  return savedOrConflict(raceId, await write(raceId, "/course-setting/restore", "POST", { formatVersion: 1, expectedVersion, revision }));
}

export async function fetchCourseSettingRevisions(raceId: string): Promise<CourseSettingRevisions> {
  const response = await fetchWithRetry(`${base(raceId)}/course-setting/revisions`, { credentials: "same-origin", cache: "no-store" });
  if (!response.ok) throw new HttpError(response.status);
  return courseSettingRevisionsSchema.parse(await response.json());
}

export async function fetchCourseSettingRevision(raceId: string, version: number): Promise<CourseSettingRevision> {
  const response = await fetchWithRetry(`${base(raceId)}/course-setting/revisions/${version}`, { credentials: "same-origin", cache: "no-store" });
  if (!response.ok) throw new HttpError(response.status);
  return courseSettingRevisionSchema.parse(await response.json());
}

/** "Överför till tävlingen": banfilens förhandsvisning, eller varför det inte går. */
export async function previewCourseSettingTransfer(raceId: string, version: number)
  : Promise<{ kind: "preview"; preview: SyncPreviewResponse } | { kind: "problem"; problem: CourseSettingTransferProblem } | { kind: "conflict" }> {
  const response = await write(raceId, "/course-setting/transfer", "POST", { formatVersion: 1, version });
  if (response.status === 409) return { kind: "conflict" };
  if (response.status === 422) return { kind: "problem", problem: courseSettingTransferProblemSchema.parse(await response.json()) };
  if (!response.ok) throw new HttpError(response.status);
  const preview = syncPreviewResponseSchema.parse(await response.json());
  if (preview.raceId !== raceId) throw new Error("scope");
  return { kind: "preview", preview };
}

/** Webbläsarens nedladdning av en text som fil. */
export function downloadText(fileName: string, content: string, type = "application/xml;charset=utf-8") {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const link = Object.assign(window.document.createElement("a"), { href: url, download: fileName });
  window.document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// Steg 66: åtgärder, arbetssätt, notiser, förslag och strömmen.
async function parsed<T>(response: Response, schema: { parse: (value: unknown) => T }): Promise<T> {
  if (!response.ok) throw new HttpStatusError(response.status);
  return schema.parse(await response.json());
}

export async function saveCourseSettingEdits(raceId: string, request: CourseSettingEditsRequest): Promise<CourseSettingEditsSaved> {
  return parsed(await write(raceId, "/course-setting/edits", "POST", request), courseSettingEditsSavedSchema);
}

export async function setCourseSettingMode(raceId: string, mode: CourseSettingMode): Promise<CourseSettingMode> {
  return (await parsed(await write(raceId, "/course-setting/mode", "PUT", { formatVersion: 1, mode }), courseSettingModeRequestSchema)).mode;
}

export async function fetchCourseSettingNotes(raceId: string): Promise<CourseSettingNotes> {
  return parsed(await fetchWithRetry(`${base(raceId)}/course-setting/notes`, { credentials: "same-origin", cache: "no-store" }), courseSettingNotesSchema);
}

export async function createCourseSettingNote(raceId: string, request: Omit<CourseSettingNoteCreate, "formatVersion">): Promise<CourseSettingNote> {
  return parsed(await write(raceId, "/course-setting/notes", "POST", { formatVersion: 1, ...request }), courseSettingNoteSchema);
}

export async function replyCourseSettingNote(raceId: string, noteId: string, text: string): Promise<CourseSettingNote> {
  return parsed(await write(raceId, `/course-setting/notes/${encodeURIComponent(noteId)}/replies`, "POST",
    { formatVersion: 1, requestId: crypto.randomUUID(), text }), courseSettingNoteSchema);
}

export async function setCourseSettingNoteStatus(raceId: string, noteId: string, status: "OPEN" | "DONE"): Promise<CourseSettingNote> {
  return parsed(await write(raceId, `/course-setting/notes/${encodeURIComponent(noteId)}/status`, "PUT", { formatVersion: 1, status }),
    courseSettingNoteSchema);
}

/**
 * ADR-0214 beslut 9: redigera en egen notis (utan `replyId`) eller ett eget svar. `expectedText` är texten som redigeringen
 * bygger på; 409 betyder att någon annan ändrat den (läs om).
 */
export async function editCourseSettingNote(raceId: string, input: { noteId: string; replyId?: string | undefined; text: string;
  expectedText: string }): Promise<CourseSettingNote> {
  const path = `/course-setting/notes/${encodeURIComponent(input.noteId)}${input.replyId ? `/replies/${encodeURIComponent(input.replyId)}` : ""}`;
  return parsed(await write(raceId, path, "PATCH", { formatVersion: 1, text: input.text, expectedText: input.expectedText }), courseSettingNoteSchema);
}

/** ADR-0181 beslut 8: ta bort notisen (svar och foto med); 404 om den redan är borta. */
export async function deleteCourseSettingNote(raceId: string, noteId: string): Promise<void> {
  const response = await write(raceId, `/course-setting/notes/${encodeURIComponent(noteId)}`, "DELETE", {});
  if (!response.ok) throw new HttpStatusError(response.status);
}

export async function deleteCourseSettingNoteReply(raceId: string, noteId: string, replyId: string): Promise<CourseSettingNote> {
  return parsed(await write(raceId, `/course-setting/notes/${encodeURIComponent(noteId)}/replies/${encodeURIComponent(replyId)}`, "DELETE", {}),
    courseSettingNoteSchema);
}

export const courseSettingNotePhotoUrl = (raceId: string, noteId: string) => `${base(raceId)}/course-setting/notes/${encodeURIComponent(noteId)}/photo`;
export const courseSettingEventsUrl = (raceId: string) => `${base(raceId)}/course-setting/events`;

export async function fetchCourseSettingSuggestions(raceId: string): Promise<CourseSettingSuggestions> {
  return parsed(await fetchWithRetry(`${base(raceId)}/course-setting/suggestions`, { credentials: "same-origin", cache: "no-store" }),
    courseSettingSuggestionsSchema);
}

export async function createCourseSettingSuggestion(raceId: string, request: Omit<CourseSettingSuggestionCreate, "formatVersion">)
  : Promise<CourseSettingSuggestion> {
  return parsed(await write(raceId, "/course-setting/suggestions", "POST", { formatVersion: 1, ...request }), courseSettingSuggestionSchema);
}

export async function decideCourseSettingSuggestion(raceId: string, suggestionId: string,
  request: Omit<CourseSettingSuggestionDecision, "formatVersion" | "requestId">): Promise<CourseSettingSuggestionDecided> {
  return parsed(await write(raceId, `/course-setting/suggestions/${encodeURIComponent(suggestionId)}/decision`, "POST",
    { formatVersion: 1, requestId: crypto.randomUUID(), ...request }), courseSettingSuggestionDecidedSchema);
}

// Steg 67: "kollad" per kontroll.
export async function fetchCourseSettingInspections(raceId: string): Promise<CourseSettingInspections> {
  return parsed(await fetchWithRetry(`${base(raceId)}/course-setting/inspections`, { credentials: "same-origin", cache: "no-store" }),
    courseSettingInspectionsSchema);
}

export async function setCourseSettingInspection(raceId: string, request: CourseSettingInspectionRequest): Promise<CourseSettingInspections> {
  return parsed(await write(raceId, "/course-setting/inspections", "PUT", request), courseSettingInspectionsSchema);
}
