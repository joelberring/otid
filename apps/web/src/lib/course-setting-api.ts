import {
  courseSettingConflictSchema, courseSettingRevisionSchema, courseSettingRevisionsSchema, courseSettingSavedSchema, courseSettingStateSchema,
  courseSettingTransferProblemSchema, syncPreviewResponseSchema, type CourseSettingConflict, type CourseSettingRevision,
  type CourseSettingRevisions, type CourseSettingState, type CourseSettingTransferProblem, type SyncPreviewResponse
} from "@o-tid/contracts";
import type { CourseSettingDocument } from "@o-tid/course-setting";
import { readAccountCsrfCookie } from "./organizer-account-cookies";
import { fetchWithRetry } from "./retrying-fetch";
import type { SaveOutcome } from "./course-setting-autosave";

/**
 * Steg 62: banläggningens anrop. Egna anrop (som vägvalen), så att autosparandet inte stör något annat. Bara admin;
 * servern kontrollerar behörigheten. 409 ger den aktuella versionen.
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

const write = (raceId: string, path: string, method: string, body: unknown) => fetch(`${base(raceId)}${path}`, { method,
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
