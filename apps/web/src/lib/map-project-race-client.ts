import { MAP_PROJECT_SNAPSHOT_HEADERS, RACE_MAP_SOURCE_PARTS, raceMapProjectLinkStateSchema, type MapProjectList, type RaceMapProjectLinkState } from "@o-tid/contracts";
import { clubRequest, csrf } from "./club-archive-client";
import { courseSettingBase } from "./course-setting-api";
import { renderMapFile, type MapFileWorkerErrorCode } from "./map-file-worker-protocol";
import { mapProjectBase, mapProjectsBase } from "./map-project-client";

/**
 * Ägarens plan 2026-11-13, etapp 1: kartprojektets aktuella karta som banläggningens kartfil. Webbläsaren hämtar kartan
 * (grundfilen med införda ändringar), ritar den i kartfilens Worker som vid en uppladdning och skickar bilden; servern
 * sparar samma fil som tävlingens kartfil och minns vilket projekt och vilken version den kom ur. Samma anrop kopplar
 * banläggningen till projektet och tar in kartans ändringar.
 */
export type MapProjectRaceStage = "reading" | "drawing" | "saving";
export type MapProjectRaceOutcome = { kind: "ok"; seq: number } | { kind: "render"; code: MapFileWorkerErrorCode }
  | { kind: "refused" | "changed" | "forbidden" | "tooLarge" | "quota" | "failed" };

const createWorker = () => new Worker(new URL("./map-file-worker.ts", import.meta.url), { type: "module" });

function decoded(value: string | null): string {
  try { return decodeURIComponent(value ?? ""); } catch { return ""; }
}

async function attempt(projectId: string, raceId: string, onStage: (stage: MapProjectRaceStage) => void): Promise<MapProjectRaceOutcome> {
  const token = csrf();
  if (!token) return { kind: "forbidden" };
  onStage("reading");
  const file = await fetch(`${mapProjectBase(projectId)}/current-file`, { credentials: "same-origin", cache: "no-store" });
  if (file.status === 422) return { kind: "refused" };
  if (file.status === 401 || file.status === 403 || file.status === 404) return { kind: "forbidden" };
  const sha256 = file.headers.get(MAP_PROJECT_SNAPSHOT_HEADERS.sha256);
  if (!file.ok || !sha256) return { kind: "failed" };
  const bytes = await file.arrayBuffer();
  const rendered = await renderMapFile(createWorker, { bytes, fileName: decoded(file.headers.get(MAP_PROJECT_SNAPSHOT_HEADERS.fileName)) || "karta.omap" },
    stage => onStage(stage));
  if (rendered.type === "error") return { kind: "render", code: rendered.code };
  onStage("saving");
  const form = new FormData();
  form.append(RACE_MAP_SOURCE_PARTS.metadata, new Blob([JSON.stringify(rendered.metadata)], { type: "application/json" }), "metadata.json");
  form.append(RACE_MAP_SOURCE_PARTS.image, rendered.png, "karta.png");
  const saved = await fetch(`${mapProjectBase(projectId)}/race`, { method: "POST", credentials: "same-origin",
    headers: { "x-otid-csrf": token, [MAP_PROJECT_SNAPSHOT_HEADERS.race]: raceId, [MAP_PROJECT_SNAPSHOT_HEADERS.sha256]: sha256 }, body: form });
  if (saved.status === 409) return { kind: "changed" };
  if (saved.status === 401 || saved.status === 403 || saved.status === 404) return { kind: "forbidden" };
  const json = await saved.json().catch(() => undefined) as { error?: string; seq?: number } | undefined;
  if (saved.status === 422) {
    return { kind: json?.error === "MAP_NOT_WRITABLE" ? "refused" : json?.error === "STORAGE_QUOTA_EXCEEDED" ? "quota"
      : json?.error === "MAP_FILE_TOO_LARGE" || json?.error === "IMAGE_TOO_LARGE" ? "tooLarge" : "failed" };
  }
  return saved.ok && typeof json?.seq === "number" ? { kind: "ok", seq: json.seq } : { kind: "failed" };
}

/** Kartan ur projektet till tävlingen. Ändras kartan medan den hämtas och ritas görs ett försök till. */
export async function applyMapProjectToRace(projectId: string, raceId: string, onStage: (stage: MapProjectRaceStage) => void)
  : Promise<MapProjectRaceOutcome> {
  const first = await attempt(projectId, raceId, onStage);
  return first.kind === "changed" ? attempt(projectId, raceId, onStage) : first;
}

/** Kontots kartprojekt (tom lista för den som inte är inloggad); undefined när de inte gick att hämta. */
export async function fetchMapProjectChoices(): Promise<MapProjectList["projects"] | undefined> {
  const result = await clubRequest(mapProjectsBase);
  if (result.status === 401) return [];
  return result.status === 200 ? (result.json as MapProjectList).projects : undefined;
}

/** Kartprojektet som banläggningens karta kommer ur (null = en vanlig kartfil); undefined när det inte gick att läsa. */
export async function fetchRaceMapProjectLink(raceId: string): Promise<RaceMapProjectLinkState["link"] | undefined> {
  const response = await fetch(`${courseSettingBase(raceId)}/map/project`, { credentials: "same-origin", cache: "no-store" });
  if (!response.ok) return undefined;
  return raceMapProjectLinkStateSchema.safeParse(await response.json()).data?.link;
}
