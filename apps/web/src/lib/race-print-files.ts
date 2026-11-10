import { courseSettingBase, HttpError } from "./course-setting-api";
import { adminFetch, fetchUntilReached } from "./retrying-fetch";

/** Ägaren 2026-11-10: utskrifternas PDF:er sparade i träningen (anropen från banläggningen och terminsplanen). */
export interface RacePrintFile {
  readonly fileId: string; readonly fileName: string; readonly label: string; readonly source: "UPLOAD" | "PRINT_JOB";
  readonly byteLength: number; readonly createdAt: string; readonly createdBy: string | null;
}

const base = (raceId: string) => `${courseSettingBase(raceId)}/course-setting/print-files`;
export const racePrintFileUrl = (raceId: string, fileId: string) => `${base(raceId)}/${encodeURIComponent(fileId)}`;

export async function fetchRacePrintFiles(raceId: string): Promise<{ files: RacePrintFile[]; maxBytes: number }> {
  const response = await adminFetch(base(raceId), { method: "GET" }, fetchUntilReached);
  if (!response.ok) throw new HttpError(response.status);
  return await response.json() as { files: RacePrintFile[]; maxBytes: number };
}

export async function uploadRacePrintFile(raceId: string, file: File, label = ""): Promise<void> {
  const response = await adminFetch(base(raceId), { method: "POST", body: file, headers: { "content-type": "application/pdf",
    "x-otid-file-name": encodeURIComponent(file.name.slice(0, 200)), "x-otid-label": encodeURIComponent(label.slice(0, 200)) } }, fetchUntilReached);
  if (!response.ok) throw new HttpError(response.status);
}

export async function saveRacePrintJob(raceId: string, jobId: string, fileName: string): Promise<void> {
  const response = await adminFetch(base(raceId), { method: "POST", body: JSON.stringify({ fromJobId: jobId }),
    headers: { "content-type": "application/json", "x-otid-file-name": encodeURIComponent(fileName) } }, fetchUntilReached);
  if (!response.ok) throw new HttpError(response.status);
}

export async function removeRacePrintFile(raceId: string, fileId: string): Promise<void> {
  const response = await adminFetch(racePrintFileUrl(raceId, fileId), { method: "DELETE" }, fetchUntilReached);
  if (!response.ok && response.status !== 404) throw new HttpError(response.status);
}
