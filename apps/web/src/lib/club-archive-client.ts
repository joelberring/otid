import { IOF_IMPORT_CONTENT_TYPE, RACE_MAP_SOURCE_PARTS, type RaceMapSourceMetadata } from "@o-tid/contracts";
import type { CourseSettingDocument } from "@o-tid/course-setting";
import type { Texts } from "./language";
import { clubArchiveSv } from "../i18n/club-archive-sv";
import type { MapGeoreference } from "@o-tid/map-file";
import { importCourseSetting, saveCourseSetting } from "./course-setting-api";
import { renderMapFile, type MapFileRenderError, type MapFileRenderResult } from "./map-file-worker-protocol";
import { readOrganizerCsrf } from "./organizer-client";

/**
 * ADR-0194: klubbarkivets anrop från webbläsaren. "Använd igen" går de befintliga vägarna: Ny tävling
 * (`/api/organizer/events`), Lägg i grupp (`/api/organizer/races/…/group`), kartan ritad i kartfilens Worker och sparad som
 * tävlingens kartfil (arkivets innehåll, bara bilden skickas), och banfilen som i banläggningen (.ppen) eller som banfil
 * (CourseData, `/api/races/…/imports`).
 */
export const clubBase = (clubId: string) => `/api/organizer/clubs/${encodeURIComponent(clubId)}`;

export function csrf(): string | undefined {
  try { return readOrganizerCsrf(document.cookie, new URL(window.location.href)); } catch { return undefined; }
}

export async function clubRequest(path: string, method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE" = "GET", body?: unknown)
  : Promise<{ status: number; json: unknown }> {
  const headers: Record<string, string> = {};
  if (body !== undefined) headers["content-type"] = "application/json";
  if (method !== "GET") {
    const value = csrf();
    if (!value) return { status: 401, json: undefined };
    headers["x-otid-csrf"] = value;
  }
  const response = await fetch(path, { method, credentials: "same-origin", cache: "no-store", headers,
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
  const text = await response.text();
  let json: unknown;
  try { json = text ? JSON.parse(text) as unknown : undefined; } catch { json = undefined; }
  return { status: response.status, json };
}

export function clubFailure(status: number, errors: Texts<typeof clubArchiveSv.errors> = clubArchiveSv.errors): string {
  if (status === 401) return errors.session;
  if (status === 400) return errors.invalid;
  if (status === 403) return errors.forbidden;
  if (status === 404) return errors.notFound;
  if (status === 409) return errors.conflict;
  return errors.generic(status);
}

/** Kartversionens originalfil. */
export async function fetchMapVersion(clubId: string, versionId: string, signal?: AbortSignal): Promise<ArrayBuffer> {
  const response = await fetch(`${clubBase(clubId)}/map-versions/${versionId}`, { credentials: "same-origin", cache: "force-cache",
    ...(signal ? { signal } : {}) });
  if (!response.ok) throw new Error(`Kartfilen kunde inte hämtas (${response.status})`);
  return response.arrayBuffer();
}

export async function fetchCourseFileText(clubId: string, courseFileId: string): Promise<string> {
  const response = await fetch(`${clubBase(clubId)}/course-files/${courseFileId}`, { credentials: "same-origin", cache: "no-store" });
  if (!response.ok) throw new Error(`Banfilen kunde inte hämtas (${response.status})`);
  return response.text();
}

export async function fetchCourseFileBytes(clubId: string, courseFileId: string): Promise<ArrayBuffer> {
  const response = await fetch(`${clubBase(clubId)}/course-files/${courseFileId}`, { credentials: "same-origin", cache: "no-store" });
  if (!response.ok) throw new Error(`Banfilen kunde inte hämtas (${response.status})`);
  return response.arrayBuffer();
}

const createWorker = () => new Worker(new URL("./map-file-worker.ts", import.meta.url), { type: "module" });

/** Ritar kartversionen i kartfilens Worker (samma som vid uppladdning av en kartfil); `maxSide` begränsar upplösningen. */
export async function renderMapVersion(clubId: string, versionId: string, fileName: string, onStage: (stage: "reading" | "drawing") => void = () => undefined,
  signal?: AbortSignal, maxSide?: number): Promise<MapFileRenderResult | MapFileRenderError> {
  const bytes = await fetchMapVersion(clubId, versionId, signal);
  return renderMapFile(createWorker, { bytes, fileName, ...(maxSide ? { maxSide } : {}) }, onStage, signal);
}

/** Bilden och metadata som multipart till kartversionens mål ("race" eller "group"). */
export async function sendRenderedMap(clubId: string, versionId: string, target: "race" | "group", targetId: string, rendered: { png: Blob; metadata: RaceMapSourceMetadata })
  : Promise<{ status: number; json: unknown }> {
  const value = csrf();
  if (!value) return { status: 401, json: undefined };
  const form = new FormData();
  form.append(RACE_MAP_SOURCE_PARTS.metadata, new Blob([JSON.stringify(rendered.metadata)], { type: "application/json" }), "metadata.json");
  form.append(RACE_MAP_SOURCE_PARTS.image, rendered.png, "karta.png");
  const response = await fetch(`${clubBase(clubId)}/map-versions/${versionId}/${target}`, { method: "POST", credentials: "same-origin",
    headers: { "x-otid-csrf": value, [target === "race" ? "x-otid-race-id" : "x-otid-group-id"]: targetId }, body: form });
  const text = await response.text();
  let json: unknown;
  try { json = text ? JSON.parse(text) as unknown : undefined; } catch { json = undefined; }
  return { status: response.status, json };
}

/** Ny version (eller ny karta när `mapId` är null) som ström. */
export async function uploadMapVersion(clubId: string, input: { mapId: string | null; mapName: string | null; file: File; versionDate: string | null;
  note: string | null }): Promise<{ status: number; json: unknown }> {
  const value = csrf();
  if (!value) return { status: 401, json: undefined };
  const headers: Record<string, string> = { "x-otid-csrf": value, "content-type": "application/octet-stream",
    "x-otid-file-name": encodeURIComponent(input.file.name.slice(0, 200)) };
  if (input.mapName) headers["x-otid-map-name"] = encodeURIComponent(input.mapName);
  if (input.versionDate) headers["x-otid-version-date"] = input.versionDate;
  if (input.note) headers["x-otid-note"] = encodeURIComponent(input.note);
  const response = await fetch(input.mapId ? `${clubBase(clubId)}/maps/${input.mapId}` : `${clubBase(clubId)}/maps`,
    { method: "POST", credentials: "same-origin", headers, body: input.file });
  const text = await response.text();
  let json: unknown;
  try { json = text ? JSON.parse(text) as unknown : undefined; } catch { json = undefined; }
  return { status: response.status, json };
}

export type ReuseStage = "race" | "group" | "reading" | "drawing" | "map" | "courses" | "transfer";
/** `done.notes`: vad som gjordes utöver träningen (arrangörsklubben, banorna i tidtagningen), för beskedet i banläggningen. */
export type ReuseOutcome = { kind: "done"; raceId: string; openCourseSetting: boolean; notes: string[] }
  | { kind: "partial"; raceId: string; problem: keyof typeof clubArchiveSv.reuse.failed }
  | { kind: "failed"; problem: string };

export interface ReuseInput {
  readonly clubId: string;
  readonly requestId: string;
  readonly eventName: string;
  readonly raceDate: string;
  readonly groupId: string | null;
  /** Klubbytans klubb i Eventor: blir träningens arrangörsklubb (punkt A, användartestet 2026-11-12). */
  readonly organisationId: string | null;
  readonly clubName: string;
  readonly map: { readonly versionId: string; readonly fileName: string } | null;
  /** En redan ritad karta (förhandsvisningen), annars ritas den här. */
  readonly rendered?: MapFileRenderResult | undefined;
  readonly course: { readonly kind: "PPEN"; readonly fileName: string; readonly ppen: string; readonly document: CourseSettingDocument }
    | { readonly kind: "COURSE_DATA"; readonly bytes: ArrayBuffer } | null;
}

/** "Använd igen": skapar träningen och fyller den steg för steg. Ett steg som går fel lämnar träningen med det som hann bli klart. */
export async function reuseTraining(input: ReuseInput, onStage: (stage: ReuseStage) => void,
  text: Texts<typeof clubArchiveSv> = clubArchiveSv): Promise<ReuseOutcome> {
  const token = csrf();
  if (!token) return { kind: "failed", problem: text.errors.session };
  onStage("race");
  const created = await fetch("/api/organizer/events", { method: "POST", credentials: "same-origin",
    headers: { "content-type": "application/json", "x-otid-csrf": token, "Idempotency-Key": `organizer-event-create:${input.requestId}` },
    body: JSON.stringify({ formatVersion: 1, eventName: input.eventName, raceName: "Träning", raceDate: input.raceDate, timeZone: "Europe/Stockholm",
      raceType: "TRAINING" }) });
  if (!created.ok) return { kind: "failed", problem: `${text.reuse.failed.race} ${clubFailure(created.status, text.errors)}` };
  const raceId = ((await created.json()) as { raceId: string }).raceId;
  if (input.groupId) {
    onStage("group");
    const attached = await clubRequest(`/api/organizer/races/${raceId}/group`, "PUT", { formatVersion: 1, groupId: input.groupId });
    if (attached.status !== 200) return { kind: "partial", raceId, problem: "group" };
  }
  const notes: string[] = [];
  if (input.organisationId) {
    // Träningen hör till klubben vars arkiv den kommer ur (annars skaparens klubb, eller ingen).
    const organiser = await clubRequest(`/api/organizer/races/${encodeURIComponent(raceId)}/club-archive`, "PUT",
      { formatVersion: 1, organisationId: input.organisationId });
    notes.push(organiser.status === 200 ? text.reuse.notes.organiser(input.clubName) : text.reuse.notes.organiserFailed);
  }
  let metadata: RaceMapSourceMetadata | undefined;
  if (input.map) {
    const rendered = input.rendered ?? await renderMapVersion(input.clubId, input.map.versionId, input.map.fileName, stage => onStage(stage));
    if (rendered.type === "error") return { kind: "partial", raceId, problem: "map" };
    metadata = rendered.metadata;
    onStage("map");
    const saved = await sendRenderedMap(input.clubId, input.map.versionId, "race", raceId, rendered);
    if (saved.status !== 200) {
      const error = (saved.json as { error?: string } | undefined)?.error;
      return { kind: "partial", raceId, problem: error === "MAP_FILE_TOO_LARGE" ? "mapTooLarge" : "map" };
    }
  }
  if (input.course) {
    onStage("courses");
    if (input.course.kind === "PPEN") {
      try {
        const outcome = await importCourseSetting(raceId, { document: input.course.document, expectedVersion: 0, fileName: input.course.fileName,
          ppen: input.course.ppen });
        if (outcome.kind !== "saved") return { kind: "partial", raceId, problem: "courses" };
        onStage("transfer");
        notes.push(await transferNote(raceId, outcome.version, text));
      } catch { return { kind: "partial", raceId, problem: "courses" }; }
    } else {
      const response = await fetch(`/api/races/${raceId}/imports`, { method: "POST", credentials: "same-origin",
        headers: { "content-type": IOF_IMPORT_CONTENT_TYPE, "idempotency-key": `iof-import:${crypto.randomUUID()}`, "x-otid-csrf": token },
        body: input.course.bytes });
      if (!response.ok) return { kind: "partial", raceId, problem: "courses" };
      // Utan .ppen: banfilen blir banläggning på kartan, så att träningen öppnas där och starten och kontrollerna går att flytta.
      if (metadata) {
        if (!await courseDataToCourseSetting(raceId, input.course.bytes, input.eventName, metadata, notes)) return { kind: "partial", raceId, problem: "courseSetting" };
        return { kind: "done", raceId, openCourseSetting: true, notes: [] };
      }
    }
  }
  return { kind: "done", raceId, openCourseSetting: input.course?.kind === "PPEN" || (input.course === null && input.map !== null), notes };
}

/** Banorna i tidtagningen (samma som Överför till tävlingen) och beskedet om det. */
async function transferNote(raceId: string, version: number, text: Texts<typeof clubArchiveSv>): Promise<string> {
  try {
    const { transferReusedCourses } = await import("./club-archive-reuse-transfer");
    const transferred = await transferReusedCourses(raceId, version);
    if (transferred.kind === "done") return text.reuse.notes.transferred(transferred.courses, transferred.classes);
    return text.reuse.notes.transferFailed;
  } catch (error) {
    console.error("Banorna fördes inte över till tävlingen", error);
    return text.reuse.notes.transferFailed;
  }
}

/** Banfilen som träningens första banläggning (version 0, träningen är ny). Beskedet visas när editorn öppnas. */
async function courseDataToCourseSetting(raceId: string, bytes: ArrayBuffer, title: string, metadata: RaceMapSourceMetadata,
  notes: readonly string[]): Promise<boolean> {
  // Banfilens tolkning laddas först här (bara Använd igen med en banfil behöver den).
  const { courseSettingFromCourseData, rememberCourseSettingNotice } = await import("./course-data-course-setting");
  const converted = courseSettingFromCourseData(new Uint8Array(bytes), { title, mapScale: metadata.scale,
    georeference: metadata.georeference as MapGeoreference | null });
  if (converted.kind === "problem") { console.error("Banfilen blev ingen banläggning", converted.text); return false; }
  try {
    const saved = await saveCourseSetting(raceId, converted.document, 0);
    if (saved.kind !== "saved") return false;
  } catch (error) { console.error("Banläggningen sparades inte", error); return false; }
  rememberCourseSettingNotice(raceId, { text: [...notes, ...converted.notices].join(" "), stays: converted.stays || notes.length > 0 });
  return true;
}
