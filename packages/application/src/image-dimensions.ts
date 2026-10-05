/**
 * Kartbildens typ och storlek ur filens egna bytes (PNG: IHDR, JPEG: SOF-markören). Ett eget litet
 * avsnitt i stället för ett bildbibliotek; bilden avkodas aldrig på servern.
 */
export type ImageDimensions = { mediaType: "image/png" | "image/jpeg"; width: number; height: number };

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const MAX_SIDE = 30_000;

function valid(result: ImageDimensions): ImageDimensions | undefined {
  return result.width >= 1 && result.height >= 1 && result.width <= MAX_SIDE && result.height <= MAX_SIDE ? result : undefined;
}

function png(bytes: Uint8Array): ImageDimensions | undefined {
  if (bytes.length < 24 || PNG_SIGNATURE.some((value, index) => bytes[index] !== value)) return undefined;
  // Första chunken måste vara IHDR: längd (4), "IHDR" (4), bredd (4), höjd (4), big-endian.
  if (String.fromCharCode(...bytes.subarray(12, 16)) !== "IHDR") return undefined;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return valid({ mediaType: "image/png", width: view.getUint32(16), height: view.getUint32(20) });
}

/** SOF0–SOF15 utom DHT (C4), JPG (C8) och DAC (CC) bär bildens höjd och bredd. */
const isStartOfFrame = (marker: number) => marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;

function jpeg(bytes: Uint8Array): ImageDimensions | undefined {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return undefined;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 2;
  while (offset + 4 <= bytes.length) {
    if (bytes[offset] !== 0xff) return undefined;
    const marker = bytes[offset + 1]!;
    // Utfyllnad (FF FF …) och markörer utan längd.
    if (marker === 0xff) { offset += 1; continue; }
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { offset += 2; continue; }
    if (marker === 0xd9 || marker === 0xda) return undefined;
    const length = view.getUint16(offset + 2);
    if (length < 2) return undefined;
    if (isStartOfFrame(marker)) {
      if (offset + 9 > bytes.length) return undefined;
      return valid({ mediaType: "image/jpeg", height: view.getUint16(offset + 5), width: view.getUint16(offset + 7) });
    }
    offset += 2 + length;
  }
  return undefined;
}

export function imageDimensions(bytes: Uint8Array): ImageDimensions | undefined {
  return png(bytes) ?? jpeg(bytes);
}
