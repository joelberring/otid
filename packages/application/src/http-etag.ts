/**
 * RFC 9110 §13.1.2: svag jämförelse för `If-None-Match` (normaliserar `W/`, kommaseparerade listor och `*`).
 * Används i applikationstjänster som kan svara 304 direkt på metadata innan bytea/kartinnehåll läses ur DB.
 */
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

function opaqueTag(value: string): string | undefined {
  const stripped = value.startsWith("W/") ? value.slice(2) : value;
  return stripped.length >= 2 && stripped.startsWith("\"") && stripped.endsWith("\"") ? stripped : undefined;
}

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
