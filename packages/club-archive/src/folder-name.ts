/**
 * ADR-0194 beslut 6: träningens mapp i arkivet, `ÅÅÅÅ/MM-DD Plats [Ledare]/…`. Mappnamnen är skrivna för hand i åtta år:
 * mellanslag i slutet, flera mellanslag, datum som `4-2`, `0402` eller `2019-04-02`, ledaren i hakparenteser eller inte alls,
 * undermappar. Allt här är rena funktioner utan filsystem.
 */

/** En sökväg i arkivet med `/`, varje del trimmad och i NFC (macOS skriver namnen i NFD), utan tomma delar. */
export function normalizePath(path: string): string {
  return path.replace(/\\/g, "/").split("/").map(part => part.normalize("NFC").replace(/\s+/g, " ").trim())
    .filter(part => part !== "" && part !== ".").join("/");
}

export const baseName = (path: string): string => {
  const parts = normalizePath(path).split("/");
  return parts[parts.length - 1] ?? "";
};

export const extensionOf = (path: string): string => {
  const name = baseName(path);
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : "";
};

export const stemOf = (path: string): string => {
  const name = baseName(path);
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(0, dot) : name;
};

/** Årsmappen: "2019" eller "2019 träningar" (men inte en träning som "2019-04-02 Skogen"). */
const YEAR = /^((?:19|20)\d{2})(?:$|\s)/;

/** Mappens namn ser ut som ett år ("2019", "2019 träningar"). */
export const isYearFolderName = (name: string): boolean => YEAR.test(normalizePath(name));

/**
 * Sökvägen i arkivet för en fil i en vald mapp (kommandots mapp eller webbläsarens "Välj mapp"), relativt mappen. Är den valda
 * mappen själv en årsmapp tas den med först, så att träningarna behåller året (ADR-0204, ändring 2026-11-03); annars börjar
 * sökvägen under mappen.
 */
export function pathInChosenFolder(folderName: string, relativePath: string): string {
  const inside = normalizePath(relativePath);
  return isYearFolderName(folderName) ? normalizePath(`${baseName(folderName)}/${inside}`) : inside;
}

/** Ett giltigt datum ÅÅÅÅ-MM-DD, annars null. */
export function isoDate(year: number, month: number, day: number): string | null {
  if (!Number.isInteger(year) || year < 1950 || year > 2200 || month < 1 || month > 12 || day < 1 || day > 31) return null;
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export interface ParsedFolderName {
  readonly date: string | null;
  readonly place: string;
  readonly title: string;
  readonly leader: string | null;
}

const SEPARATOR = /^[\s\-–—_,:.]+/;

/**
 * Mappnamnet utan årsmapp: datum först (`MM-DD`, `M-D`, `MMDD`, `MM.DD`, `MM/DD` eller ett helt datum), sedan plats och övning,
 * och ledaren i den sista hakparentesen. Ett datum som inte finns (t.ex. 04-31) lämnas kvar i texten och ger inget datum.
 */
export function parseFolderName(name: string, year: number | null): ParsedFolderName {
  let text = name.normalize("NFC").replace(/\s+/g, " ").trim();
  let leader: string | null = null;
  const brackets = [...text.matchAll(/\[([^\]]*)\]/g)];
  const last = brackets[brackets.length - 1];
  if (last) {
    const inside = (last[1] ?? "").replace(/\s+/g, " ").trim();
    leader = inside === "" ? null : inside.slice(0, 200);
    text = text.replace(/\[[^\]]*\]/g, " ").replace(/\s+/g, " ").trim();
  }
  let date: string | null = null;
  const full = /^((?:19|20)\d{2})[-._ ]?(\d{1,2})[-._ ]?(\d{1,2})(?!\d)/.exec(text);
  const short = /^(\d{1,2})[-./](\d{1,2})(?!\d)/.exec(text);
  const compact = /^(\d{2})(\d{2})(?!\d)/.exec(text);
  if (full) {
    date = isoDate(Number(full[1]), Number(full[2]), Number(full[3]));
    if (date) text = text.slice(full[0].length);
  } else if (short && year !== null) {
    date = isoDate(year, Number(short[1]), Number(short[2]));
    if (date) text = text.slice(short[0].length);
  } else if (compact && year !== null) {
    date = isoDate(year, Number(compact[1]), Number(compact[2]));
    if (date) text = text.slice(compact[0].length);
  }
  text = text.replace(SEPARATOR, "").replace(/[\s\-–—_,:]+$/, "").trim();
  const place = (text.split(/\s[-–—]\s|,\s/)[0] ?? "").trim().slice(0, 200);
  const title = (text || name.normalize("NFC").replace(/\s+/g, " ").trim() || "Träning").slice(0, 200);
  return { date, place, title, leader };
}

export interface TrainingFolder extends ParsedFolderName {
  /** Mappens sökväg i arkivet (`2019/04-02 Skogen [Anna]`), träningens nyckel vid omkörning. */
  readonly path: string;
  readonly year: number | null;
}

/**
 * Träningen som en fil hör till: mappen direkt under årsmappen (undermappar hör till den), eller filen själv när den ligger
 * direkt i årsmappen. Utan årsmapp gäller den första mappen.
 */
export function trainingFolderOf(filePath: string): TrainingFolder {
  const parts = normalizePath(filePath).split("/");
  const yearIndex = parts.findIndex((part, index) => index < parts.length - 1 && YEAR.test(part));
  const year = yearIndex >= 0 ? Number(YEAR.exec(parts[yearIndex]!)![1]) : null;
  const folderIndex = yearIndex >= 0 ? yearIndex + 1 : 0;
  const inFolder = folderIndex < parts.length - 1;
  const name = inFolder ? parts[folderIndex]! : stemOf(parts[parts.length - 1] ?? "");
  const path = inFolder ? parts.slice(0, folderIndex + 1).join("/") : [...parts.slice(0, -1), name].join("/");
  const parsed = parseFolderName(name, year);
  const dateYear = parsed.date ? Number(parsed.date.slice(0, 4)) : null;
  return { ...parsed, path, year: dateYear ?? year };
}
