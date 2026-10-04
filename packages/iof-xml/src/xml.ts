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

