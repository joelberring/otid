import { paperImageSchema, paperLibrarySchema, PAPER_IMAGE_MAX_BYTES, type PaperImageResponse, type PaperLibrary } from "@o-tid/contracts";
import { specialImage, type CourseSettingDocument, type PaperTemplate, type SpecialObject } from "@o-tid/course-setting";
import { courseSettingBase, HttpError } from "./course-setting-api";
import { readAccountCsrfCookie } from "./organizer-account-cookies";
import { fetchUntilReached, fetchWithRetry } from "./retrying-fetch";

/** ADR-0197: papperets bilder och kontots mallbibliotek. */
function csrf(): string {
  const value = readAccountCsrfCookie(document.cookie, new URL(window.location.href));
  if (!value) throw new Error("csrf");
  return value;
}

export const paperImageUrl = (raceId: string, sha256: string) => `${courseSettingBase(raceId)}/course-setting/paper-images/${sha256}`;

/** Största sidan när en SVG görs om till PNG (ADR-0197: PDF:en tar PNG och JPEG). */
export const SVG_RASTER_PX = 2400;

/** SVG som PNG (webbläsaren ritar den på en canvas, längsta sidan `SVG_RASTER_PX`). */
export async function rasterizeSvg(file: Blob): Promise<Blob> {
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    await new Promise<void>((resolve, reject) => { image.onload = () => resolve(); image.onerror = () => reject(new Error("svg")); image.src = url; });
    const w = image.naturalWidth || 300, h = image.naturalHeight || 150;
    const scale = SVG_RASTER_PX / Math.max(w, h);
    const canvas = window.document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(w * scale)); canvas.height = Math.max(1, Math.round(h * scale));
    canvas.getContext("2d")?.drawImage(image, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, "image/png"));
    if (!blob) throw new Error("svg");
    return blob;
  } finally { URL.revokeObjectURL(url); }
}

export type UploadOutcome = { readonly kind: "ok"; readonly image: PaperImageResponse } | { readonly kind: "too-large" } | { readonly kind: "invalid" };

/** Laddar upp en PNG, JPEG eller SVG (som PNG). */
export async function uploadPaperImage(raceId: string, file: File): Promise<UploadOutcome> {
  const svg = file.type === "image/svg+xml" || /\.svg$/i.test(file.name);
  const body = svg ? await rasterizeSvg(file) : file;
  const type = svg ? "image/png" : file.type === "image/jpg" ? "image/jpeg" : file.type;
  if (type !== "image/png" && type !== "image/jpeg") return { kind: "invalid" };
  if (body.size > PAPER_IMAGE_MAX_BYTES) return { kind: "too-large" };
  const response = await fetchUntilReached(`${courseSettingBase(raceId)}/course-setting/paper-images`, { method: "POST", credentials: "same-origin",
    headers: { "content-type": type, "x-otid-csrf": csrf() }, body });
  if (response.status === 413) return { kind: "too-large" };
  if (response.status === 400) return { kind: "invalid" };
  if (!response.ok) throw new HttpError(response.status);
  return { kind: "ok", image: paperImageSchema.parse(await response.json()) };
}

/** Bildens data som base64 (för .ppen). */
export async function paperImageBase64(raceId: string, sha256: string): Promise<string> {
  const response = await fetchWithRetry(paperImageUrl(raceId, sha256), { credentials: "same-origin" });
  if (!response.ok) throw new HttpError(response.status);
  const bytes = new Uint8Array(await response.arrayBuffer());
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

export async function fetchPaperLibrary(raceId: string): Promise<PaperLibrary> {
  const response = await fetchWithRetry(`${courseSettingBase(raceId)}/course-setting/paper-library`, { credentials: "same-origin", cache: "no-store" });
  if (!response.ok) throw new HttpError(response.status);
  return paperLibrarySchema.parse(await response.json());
}

export async function savePaperLibrary(raceId: string, template: PaperTemplate): Promise<PaperLibrary> {
  const response = await fetchUntilReached(`${courseSettingBase(raceId)}/course-setting/paper-library`, { method: "POST", credentials: "same-origin",
    headers: { "content-type": "application/json", "x-otid-csrf": csrf() }, body: JSON.stringify({ formatVersion: 1, name: template.name, template }) });
  if (!response.ok) throw new HttpError(response.status);
  return paperLibrarySchema.parse(await response.json());
}

export async function deletePaperLibrary(raceId: string, id: string): Promise<PaperLibrary> {
  const response = await fetchUntilReached(`${courseSettingBase(raceId)}/course-setting/paper-library/${encodeURIComponent(id)}`, { method: "DELETE",
    credentials: "same-origin", headers: { "x-otid-csrf": csrf() } });
  if (!response.ok) throw new HttpError(response.status);
  return paperLibrarySchema.parse(await response.json());
}

/** sha256 (hex) för base64-data, för att känna igen papperets egna bilder i en inläst .ppen. */
export async function sha256OfBase64(data: string): Promise<string> {
  const binary = atob(data.replace(/\s+/g, ""));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, "0")).join("");
}

/** sha256 för filens bildobjekt för en bana (de som kan vara papperets egna), för `keepPaperOnImport`. */
export async function importedImageHashes(document: CourseSettingDocument): Promise<(special: SpecialObject) => string | undefined> {
  const hashes = new Map<string, string>();
  for (const special of document.specialObjects) {
    if (special.kind !== "image" || special.courses.length !== 1) continue;
    const image = specialImage(special);
    if (!image) continue;
    try { hashes.set(special.id, await sha256OfBase64(image.data)); } catch (error) { console.error("Bildobjektet kunde inte läsas", error); }
  }
  return special => hashes.get(special.id);
}
