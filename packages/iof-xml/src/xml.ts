/** Gemensamma hjälpfunktioner för IOF XML 3.0-tolkningen. */
export type XmlRecord = Record<string, unknown>;

export class IofValidationError extends Error {
  readonly issues: readonly string[];

  constructor(issues: readonly string[]) {
    super(`Ogiltig IOF XML: ${issues.join("; ")}`);
    this.name = "IofValidationError";
    this.issues = issues;
  }
}

/**
 * Översynen 2026-11-02: raden i filen för en sökväg som `ClassStart[2].PersonStart[0].Start.StartTime`, så att felet säger
 * var i filen det sitter. Varje led söks efter föregående leds början (n:te förekomsten av elementet); ett led utan index
 * är den första förekomsten. Ger undefined om något led inte hittas.
 */
export function lineOfPath(xml: string, path: string): number | undefined {
  const segments = path.split(".").map((segment) => /^([A-Za-z][\w-]*)(?:\[(\d+)\])?/.exec(segment.trim()));
  let position = 0;
  let found = false;
  for (const segment of segments) {
    if (!segment) break;
    const [, name, index] = segment;
    if (["CourseData", "EntryList", "StartList"].includes(name!)) continue;
    const pattern = new RegExp(`<${name}[\\s>/]`, "g");
    pattern.lastIndex = position;
    let match: RegExpExecArray | null = null;
    for (let count = 0; count <= Number(index ?? 0); count += 1) {
      match = pattern.exec(xml);
      if (!match) return found ? lineAt(xml, position) : undefined;
    }
    position = match!.index;
    found = true;
  }
  return found ? lineAt(xml, position) : undefined;
}

function lineAt(xml: string, position: number): number {
  let line = 1;
  for (let index = xml.indexOf("\n"); index !== -1 && index < position; index = xml.indexOf("\n", index + 1)) line += 1;
  return line;
}

const LATIN1_LABELS = new Set(["iso-8859-1", "iso8859-1", "latin1", "l1", "windows-1252", "cp1252"]);

/**
 * Översynen 2026-11-02: filens text. UTF-8 (med eller utan BOM, som behålls), eller ISO-8859-1/Windows-1252 när
 * XML-deklarationen säger det (äldre program och Excel-export). Andra kodningar avvisas med ett begripligt besked.
 */
export function decodeIofXml(bytes: Uint8Array): { readonly xml: string } | { readonly issue: string } {
  const head = new TextDecoder("windows-1252").decode(bytes.subarray(0, 256));
  const declared = /^(?:\uFEFF|\u00EF\u00BB\u00BF)?\s*<\?xml[^>]*\bencoding\s*=\s*["']([A-Za-z0-9._-]+)["']/i.exec(head)?.[1];
  const encoding = declared?.toLowerCase();
  if (encoding && LATIN1_LABELS.has(encoding)) return { xml: new TextDecoder("windows-1252").decode(bytes) };
  if (encoding && encoding !== "utf-8" && encoding !== "utf8") {
    return { issue: `Teckenkodningen ${declared} stöds inte. Spara filen som UTF-8 eller ISO-8859-1.` };
  }
  try {
    return { xml: new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes) };
  } catch {
    return { issue: "Filen är inte UTF-8. Spara den som UTF-8, eller ange encoding=\"ISO-8859-1\" i XML-deklarationen." };
  }
}

/** "Rad 12: ClassStart[0].PersonStart[1].EntryId saknas" när raden går att hitta. */
export function withLines(xml: string, issues: readonly string[]): string[] {
  return issues.map((issue) => {
    const path = /^([A-Za-z][\w-]*(?:\[\d+\])?(?:\.[A-Za-z@][\w:-]*(?:\[\d+\])?)*)/.exec(issue)?.[1];
    const line = path ? lineOfPath(xml, path) : undefined;
    return line ? `Rad ${line}: ${issue}` : issue;
  });
}

export function record(value: unknown): XmlRecord {
  return typeof value === "object" && value !== null ? value as XmlRecord : {};
}

export function array(value: unknown): unknown[] {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

export function text(value: unknown): string {
  if (typeof value === "string" || typeof value === "number") return String(value).trim();
  const object = record(value);
  const nested = object["#text"] ?? object["_text"];
  return nested === undefined ? "" : text(nested);
}

export function requireText(value: unknown, path: string, issues: string[]): string {
  const parsed = text(value);
  if (!parsed) issues.push(`${path} saknas`);
  return parsed;
}

export function count(value: unknown): number {
  return array(value).length;
}

export function rejectUnexpectedKeys(
  value: XmlRecord,
  allowed: readonly string[],
  path: string,
  issues: string[]
): void {
  const allowedKeys = new Set(allowed);
  for (const key of Object.keys(value)) {
    if (!allowedKeys.has(key)) issues.push(`${path}.${key} ingår inte i stödd IOF XML 3.0-struktur`);
  }
}

