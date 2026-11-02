/**
 * ADR-0194 beslut 6: kartan som en .ppen pekar på (`<event><map kind="OCAD" …>C:\Users\…\Karta.ocd</map>`). Purple Pen skriver
 * hela sökvägen på datorn där filen sparades, oftast Windows. Bara filnamnet används för att hitta kartan i arkivet.
 */
const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: "\"", apos: "'" };

function decodeEntities(value: string): string {
  return value.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (whole, code: string) => {
    if (code.startsWith("#x") || code.startsWith("#X")) return String.fromCodePoint(Number.parseInt(code.slice(2), 16));
    if (code.startsWith("#")) return String.fromCodePoint(Number.parseInt(code.slice(1), 10));
    return ENTITIES[code.toLowerCase()] ?? whole;
  });
}

/** Sökvägen i `<map>` (det första i filen), eller null när filen inte har någon. */
export function ppenMapReference(xml: string): string | null {
  const match = /<map\b[^>]*>([^<]*)<\/map>/i.exec(xml);
  const value = match ? decodeEntities(match[1] ?? "").trim() : "";
  return value === "" ? null : value.slice(0, 500);
}

/** Filnamnet i en sökväg från Windows eller macOS. */
export function referenceFileName(reference: string): string {
  const parts = reference.split(/[\\/]/);
  return (parts[parts.length - 1] ?? "").normalize("NFC").trim();
}
