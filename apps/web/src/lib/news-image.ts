import { NEWS_IMAGE_MAX_BYTES } from "@o-tid/contracts";

/** Längsta sidan på en nyhets bild: spalten är högst cirka 320 px bred, så det räcker med god marginal för skarpa skärmar. */
const MAX_SIDE = 960;

export type NewsImageUpload = { mediaType: "image/webp" | "image/jpeg"; base64: string; width: number; height: number };

function toBlob(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob | null> {
  return new Promise(resolve => canvas.toBlob(resolve, type, quality));
}

async function base64(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = "";
  for (let at = 0; at < bytes.length; at += 0x8000) binary += String.fromCharCode(...bytes.subarray(at, at + 0x8000));
  return btoa(binary);
}

/**
 * ADR-0230: nyhetens bild skalas ned i webbläsaren (högst 960 px på längsta sidan) och sparas som WebP, eller JPEG där
 * webbläsaren inte kan skriva WebP (Safari). Sämre kvalitet prövas tills bilden ryms i `NEWS_IMAGE_MAX_BYTES`.
 * Fel: "unreadable" (ingen bild webbläsaren kan läsa) eller "too-large".
 */
export async function prepareNewsImage(file: File): Promise<NewsImageUpload | "unreadable" | "too-large"> {
  let bitmap: ImageBitmap;
  try { bitmap = await createImageBitmap(file); } catch { return "unreadable"; }
  const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
  const width = Math.max(1, Math.round(bitmap.width * scale)), height = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) { bitmap.close(); return "unreadable"; }
  context.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();
  for (const quality of [0.82, 0.7, 0.55, 0.4]) {
    const webp = await toBlob(canvas, "image/webp", quality);
    const blob = webp?.type === "image/webp" ? webp : await toBlob(canvas, "image/jpeg", quality);
    if (!blob || (blob.type !== "image/webp" && blob.type !== "image/jpeg")) return "unreadable";
    if (blob.size <= NEWS_IMAGE_MAX_BYTES) return { mediaType: blob.type, base64: await base64(blob), width, height };
  }
  return "too-large";
}
