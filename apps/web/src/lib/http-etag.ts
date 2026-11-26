/**
 * Gemensamma HTTP ETag- och buffert-hjälpare (RFC 9110 §13.1.2).
 * Caddy gör om starka ETag (`"abc"`) till svaga (`W/"abc"`) vid zstd/gzip-komprimering;
 * `If-None-Match` använder alltid svag jämförelse och kan innehålla kommaseparerade listor eller `*`.
 */

const SHA256_TAG = /^(?:W\/)?"([a-f0-9]{64})"$/;

/** Delar upp en `If-None-Match`-rubrik i enskilda taggar utan att klyva kommatecken inuti citattecken. */
function splitEntityTags(header: string): string[] {
  const tags: string[] = [];
  let start = 0;
  let inQuotes = false;
  for (let index = 0; index < header.length; index += 1) {
    const ch = header[index];
    if (ch === "\"") {
      inQuotes = !inQuotes;
    } else if (ch === "," && !inQuotes) {
      const part = header.slice(start, index).trim();
      if (part) tags.push(part);
      start = index + 1;
    }
  }
  const tail = header.slice(start).trim();
  if (tail) tags.push(tail);
  return tags;
}

/** Tar bort valfritt svagt `W/`-prefix och kontrollerar att värdet är en citerad entity-tag (`"..."`). */
function opaqueTag(value: string): string | undefined {
  const stripped = value.startsWith("W/") ? value.slice(2) : value;
  return stripped.length >= 2 && stripped.startsWith("\"") && stripped.endsWith("\"") ? stripped : undefined;
}

/**
 * RFC 9110 §13.1.2: svag jämförelse för `If-None-Match`.
 * Normaliserar `W/`, stöder kommaseparerade listor och `*`.
 */
export function matchesIfNoneMatch(header: string | null | undefined, etag: string): boolean {
  if (!header) return false;
  const target = opaqueTag(etag.trim());
  if (!target) return false;
  for (const raw of splitEntityTags(header)) {
    if (raw === "*") return true;
    const candidate = opaqueTag(raw);
    if (candidate !== undefined && candidate === target) return true;
  }
  return false;
}

/**
 * Plockar ut en 64-teckens SHA-256 ur `If-None-Match` (`"sha"`, `W/"sha"`, eller första matchande i en lista),
 * för tjänster som tar en enskild hash före läsning av innehållet.
 */
export function ifNoneMatchSha256(header: string | null | undefined): string | undefined {
  if (!header) return undefined;
  for (const raw of splitEntityTags(header)) {
    const match = SHA256_TAG.exec(raw);
    if (match) return match[1];
  }
  return undefined;
}

/** Zero-copy `Uint8Array`-vy över en `Buffer`/`Uint8Array` (undviker att dubbelkopiera stora filer till `Response`). */
export function bufferView(bytes: Uint8Array): Uint8Array<ArrayBuffer> {
  return new Uint8Array(bytes.buffer as ArrayBuffer, bytes.byteOffset, bytes.byteLength);
}
