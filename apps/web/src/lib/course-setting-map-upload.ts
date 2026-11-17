import { RACE_MAP_SOURCE_PARTS, raceMapProblemSchema, raceMapSourceMetadataSchema } from "@o-tid/contracts";
import type { CourseSettingDocument } from "@o-tid/course-setting";
import type { raceMapSv } from "../i18n/race-map-sv";
import type { Texts } from "./language";
import type { Message } from "../components/race-administrator/source-sync-actions";
import { courseSettingBase } from "./course-setting-api";
import { readAccountCsrfCookie } from "./organizer-account-cookies";
import { fetchUntilReached } from "./retrying-fetch";

/**
 * Kartfilen till banläggningen (`map/source`): ny eller utbytt. Samma besked som i Karta och vägval; `ok` betyder sparad, och
 * den som anropar läser banläggningen på nytt.
 */
export async function uploadCourseSettingMap(raceId: string, form: FormData, text: Texts<typeof raceMapSv>): Promise<Message | undefined> {
  const csrf = readAccountCsrfCookie(document.cookie, new URL(window.location.href));
  if (!csrf) return { tone: "error", text: text.mapFile.failed };
  try {
    const response = await fetchUntilReached(`${courseSettingBase(raceId)}/map/source`, { method: "POST", credentials: "same-origin",
      headers: { "x-otid-csrf": csrf }, body: form });
    // 422 säger vad som är fel med filen, annat är ett fel vid sparandet.
    if (response.status === 422) {
      const parsed = raceMapProblemSchema.safeParse(await response.json()).data;
      const problem = parsed?.error;
      return { tone: "error", text: problem === "MAP_FILE_TOO_LARGE" ? text.mapFile.tooLarge
        : problem === "IMAGE_TOO_LARGE" ? text.mapFile.errors.TOO_LARGE
        : problem === "STORAGE_QUOTA_EXCEEDED" ? text.quota(parsed?.quota) : text.mapFile.invalid };
    }
    if (!response.ok) {
      console.error("Kartfilen sparades inte", response.status, response.headers.get("content-type"));
      return { tone: "error", text: text.mapFile.failed };
    }
    return { tone: "ok", text: "" };
  } catch { return { tone: "error", text: text.mapFile.failed }; }
}

/** Kontrollerna (start, mål, kontroller och passager) som ligger utanför kartfilens yta i formuläret. */
export async function controlsOutsideNewMap(form: FormData, document: CourseSettingDocument): Promise<number | undefined> {
  const part = form.get(RACE_MAP_SOURCE_PARTS.metadata);
  if (!(part instanceof Blob)) return undefined;
  const metadata = raceMapSourceMetadataSchema.safeParse(JSON.parse(await part.text())).data;
  if (!metadata) return undefined;
  return controlsOutside(metadata.bounds, document);
}
export function controlsOutside({ minX, minY, maxX, maxY }: { minX: number; minY: number; maxX: number; maxY: number }, document: Pick<CourseSettingDocument, "controls">): number {
  return Object.values(document.controls).filter(({ at }) => at.x < minX || at.x > maxX || at.y < minY || at.y > maxY).length;
}
