import {
  CLUB_MAP_CHECK_STATUSES, type ClubArchiveList, type ClubArchiveListItem, CLUB_THUMBNAIL_MAX_BYTES, type ClubArchiveSummariesResponse, type ClubEntryThumbnailRequest, type ClubMapCheckStatus,
  type ClubMapCheckView, type ClubMapVersionCheckRequest
} from "@o-tid/contracts";
import { MAP_READER_VERSION } from "@o-tid/map-file";
import { clubArchiveChecksSv } from "../i18n/club-archive-checks-sv";
import type { Texts } from "./language";
import { clubBase, clubRequest } from "./club-archive-client";
import type { MapFileWorkerErrorCode } from "./map-file-worker-protocol";

/**
 * ADR-0196: klubbarkivets kontroll av kartorna och de små bilderna. Kartorna ritas i den här webbläsaren (kartfilens Worker)
 * och bilden och beskedet sparas på servern, så att arkivet visar dem utan att rita igen.
 */
type ChecksTexts = Texts<typeof clubArchiveChecksSv>;

/** Arbetarens felkod som kontrollens status. */
export function checkStatusOf(code: MapFileWorkerErrorCode): ClubMapCheckStatus {
  if (code === "NO_CANVAS") return "FAILED";
  return (CLUB_MAP_CHECK_STATUSES as readonly string[]).includes(code) ? code as ClubMapCheckStatus : "FAILED";
}

/** Skälet i klartext: läsarens eget besked när det finns (t.ex. "OCAD 7 stöds inte. …"), annars en förklaring per fel. */
export function renderFailureReason(code: MapFileWorkerErrorCode, message?: string | null, text: ChecksTexts = clubArchiveChecksSv): string {
  return message?.trim() || text.explain[checkStatusOf(code)];
}

/** Kort etikett till statusmärket: "Fungerar · OCAD 11.2", "OCAD 7 stöds inte", "Filen är skadad" … */
export function checkLabel(check: ClubMapCheckView | null, text: ChecksTexts = clubArchiveChecksSv): string {
  if (!check) return text.notChecked;
  if (check.status === "OK") return text.works(check.fileVersion);
  if (check.status === "UNSUPPORTED_VERSION" && check.detail) return check.detail.split(/\.\s/)[0]!.replace(/\.$/, "");
  return text.status[check.status];
}

/** Hela förklaringen (title och text under märket). */
export function checkExplanation(check: ClubMapCheckView | null, text: ChecksTexts = clubArchiveChecksSv): string {
  if (!check || check.status === "OK") return "";
  return check.detail ?? text.explain[check.status];
}

const thumbnailUrl = (clubId: string, path: string, stamp: string) => `${clubBase(clubId)}/${path}?v=${encodeURIComponent(stamp)}`;
export const mapThumbnailUrl = (clubId: string, versionId: string, checkedAt: string) => thumbnailUrl(clubId, `map-versions/${versionId}/check`, checkedAt);
export const entryThumbnailUrl = (clubId: string, entryId: string, createdAt: string) => thumbnailUrl(clubId, `archive/${entryId}/thumbnail`, createdAt);

function base64(bytes: Uint8Array): string {
  let binary = "";
  for (let index = 0; index < bytes.length; index += 0x8000) binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  return btoa(binary);
}

export type EncodedPng = { pngBase64: string; width: number; height: number };

/**
 * En bild som PNG för servern (högst 512 kB). `paint` ritar på en duk av given storlek; blir PNG:n för stor ritas den mindre.
 */
export async function encodeThumbnail(width: number, height: number, paint: (ctx: CanvasRenderingContext2D, size: { width: number; height: number }) => void)
  : Promise<EncodedPng | null> {
  for (let scale = 1; scale > 0.2; scale *= 0.7) {
    const size = { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
    const canvas = document.createElement("canvas");
    canvas.width = size.width; canvas.height = size.height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    paint(ctx, size);
    const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, "image/png"));
    if (!blob) return null;
    if (blob.size <= CLUB_THUMBNAIL_MAX_BYTES) return { pngBase64: base64(new Uint8Array(await blob.arrayBuffer())), ...size };
  }
  return null;
}

export async function saveMapCheck(clubId: string, versionId: string, check: Omit<ClubMapVersionCheckRequest, "formatVersion">): Promise<number> {
  return (await clubRequest(`${clubBase(clubId)}/map-versions/${versionId}/check`, "PUT", { formatVersion: 1, ...check })).status;
}

export async function saveEntryThumbnail(clubId: string, entryId: string, thumbnail: Omit<ClubEntryThumbnailRequest, "formatVersion">): Promise<number> {
  return (await clubRequest(`${clubBase(clubId)}/archive/${entryId}/thumbnail`, "PUT", { formatVersion: 1, ...thumbnail })).status;
}

export async function refreshSummaries(clubId: string): Promise<ClubArchiveSummariesResponse | null> {
  const result = await clubRequest(`${clubBase(clubId)}/archive/summaries`, "POST");
  return result.status === 200 ? result.json as ClubArchiveSummariesResponse : null;
}

/** En kartversion att rita: kontrollen (om den behövs) och träningarna som ska ha en bild av den. */
export interface CheckJob { versionId: string; fileName: string; label: string; check: boolean; entries: ClubArchiveListItem[] }

const outdated = (readerVersion: number) => readerVersion < MAP_READER_VERSION;

/** Arbetet: kartversioner att kontrollera och träningar att rita, grupperade per kartversion. */
export function planChecks(list: ClubArchiveList, force: boolean): CheckJob[] {
  const jobs = new Map<string, CheckJob>();
  const job = (versionId: string, fileName: string, label: string) => {
    let found = jobs.get(versionId);
    if (!found) { found = { versionId, fileName, label, check: false, entries: [] }; jobs.set(versionId, found); }
    return found;
  };
  for (const map of list.maps) for (const version of map.versions) {
    // ADR-0210: en fungerande version utan fingeravtryck kontrolleras igen, så att dubbletterna kan jämföras.
    if (force || !version.check || outdated(version.check.readerVersion) || (version.check.status === "OK" && !version.check.fingerprint)) {
      job(version.versionId, version.fileName, `${map.name} (${version.fileName})`).check = true;
    }
  }
  const nameOf = new Map(list.maps.flatMap(map => map.versions.map(version => [version.versionId, `${map.name} (${version.fileName})`] as const)));
  for (const entry of list.entries) {
    const source = entry.thumbnailSource;
    if (!source) continue;
    if (force || !entry.thumbnail || entry.thumbnail.stale || outdated(entry.thumbnail.readerVersion)) {
      job(source.versionId, source.fileName, nameOf.get(source.versionId) ?? source.fileName).entries.push(entry);
    }
  }
  return [...jobs.values()];
}

