/**
 * ADR-0210 beslut 3: varje kartversion har ett år. Det gissas, i den här ordningen, ur ett år i filnamnet, ur ett år i en
 * mapps namn ("Älvsjöskogen 2019", "2019-05-12 Älvsjöskogen"), ur importens årsmapp ("2019", "2019 träningar"), ur
 * versionens datum (importen sätter det ur filnamnets datum eller den första träningen som använde kartan) och sist ur
 * dagen för uppladdningen. Kartfilerna (OCAD och Mapper) har inget eget datum att läsa. Gissningen går att ändra; ett
 * ändrat år sparas och gäller före gissningen. Ren funktion utan I/O.
 */
import { yearOfYearFolder } from "./year-folder";

export type VersionYearSource = "MANUAL" | "FILE_NAME" | "FOLDER" | "YEAR_FOLDER" | "DATE" | "UPLOAD";

export interface VersionYearInput {
  readonly fileName: string;
  /** Källans sökväg vid importen ("2019/05-12 Älvsjöskogen/Älvsjöskogen.ocd"), null för en uppladdning. */
  readonly sourcePath: string | null;
  /** ÅÅÅÅ-MM-DD. */
  readonly versionDate: string | null;
  readonly uploadedAt: Date | string;
  /** Året som någon har skrivit in. */
  readonly manualYear?: number | null | undefined;
}

export const MIN_VERSION_YEAR = 1950;
export const MAX_VERSION_YEAR = 2100;

const YEAR = /(?<!\d)(19[5-9]\d|20\d{2})(?!\d)/g;

const plausible = (year: number) => year >= MIN_VERSION_YEAR && year <= MAX_VERSION_YEAR;

/** Det senaste rimliga året i texten ("Skogen 2014 rev 2021" → 2021), eller null. */
export function yearInText(text: string): number | null {
  const years = [...text.normalize("NFC").matchAll(YEAR)].map(match => Number(match[1])).filter(plausible);
  return years.length > 0 ? Math.max(...years) : null;
}

export function guessVersionYear(input: VersionYearInput): { year: number; source: VersionYearSource } {
  if (input.manualYear !== null && input.manualYear !== undefined && plausible(input.manualYear)) return { year: input.manualYear, source: "MANUAL" };
  const fileName = input.fileName.replace(/^.*[\\/]/, "");
  const fromFile = yearInText(fileName);
  if (fromFile !== null) return { year: fromFile, source: "FILE_NAME" };
  const folders = (input.sourcePath ?? "").split(/[\\/]/).slice(0, -1).filter(segment => segment.trim().length > 0);
  // Närmaste mappen först; en ren årsmapp räknas för sig (den säger när träningen var, inte när kartan gjordes).
  for (const folder of [...folders].reverse()) {
    if (yearOfYearFolder(folder) !== null) continue;
    const year = yearInText(folder);
    if (year !== null) return { year, source: "FOLDER" };
  }
  for (const folder of [...folders].reverse()) {
    const year = yearOfYearFolder(folder);
    if (year !== null) return { year, source: "YEAR_FOLDER" };
  }
  if (input.versionDate && /^\d{4}-\d{2}-\d{2}$/.test(input.versionDate)) {
    const year = Number(input.versionDate.slice(0, 4));
    if (plausible(year)) return { year, source: "DATE" };
  }
  const uploaded = typeof input.uploadedAt === "string" ? new Date(input.uploadedAt) : input.uploadedAt;
  return { year: uploaded.getUTCFullYear(), source: "UPLOAD" };
}

/** "2014–2023", "2019" eller null utan år. */
export function versionYearSpan(years: readonly number[]): { from: number; to: number } | null {
  if (years.length === 0) return null;
  return { from: Math.min(...years), to: Math.max(...years) };
}
