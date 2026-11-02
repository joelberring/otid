import { baseName, extensionOf, normalizePath } from "./folder-name";

/**
 * ADR-0194 beslut 6: vilka filer importen tar. Bara kartfiler (.ocd, .omap, .xmap), Purple Pen (.ppen) och XML vars rot är
 * IOF `CourseData`. Allt annat läses aldrig (bara namnet och storleken räknas i rapporten): PDF, Word och Excel kan ha
 * personuppgifter, bilder och GPS-spår hör inte till arkivet.
 */
export type SkipCategory = "PDF" | "WORD" | "EXCEL" | "IMAGE" | "WORLD_FILE" | "GPS" | "OTHER_XML" | "SYSTEM" | "BACKUP" | "UNKNOWN_MAP" | "OTHER";

export type Classified =
  | { readonly kind: "MAP"; readonly format: "OCD" | "OMAP" }
  | { readonly kind: "PPEN" }
  /** XML: rotelementet avgör (`isCourseDataXml`); läses bara de första 4 kB. */
  | { readonly kind: "XML" }
  | { readonly kind: "SKIP"; readonly category: SkipCategory };

export const SKIP_LABELS: Record<SkipCategory, string> = {
  PDF: "PDF", WORD: "Word", EXCEL: "Excel", IMAGE: "bilder", WORLD_FILE: "georeferensfiler (pgw/jgw …)", GPS: "GPS (gpx/kmz/kml)",
  OTHER_XML: "annan XML (inte CourseData)", SYSTEM: "systemfiler", BACKUP: "säkerhetskopior", UNKNOWN_MAP: "kartfiler i okänt format",
  OTHER: "övrigt"
};

const SKIP_BY_EXTENSION: Record<string, SkipCategory> = {
  pdf: "PDF", doc: "WORD", docx: "WORD", odt: "WORD", rtf: "WORD", xls: "EXCEL", xlsx: "EXCEL", xlsm: "EXCEL", ods: "EXCEL", csv: "EXCEL",
  jpg: "IMAGE", jpeg: "IMAGE", png: "IMAGE", gif: "IMAGE", heic: "IMAGE", tif: "IMAGE", tiff: "IMAGE", bmp: "IMAGE", webp: "IMAGE",
  pgw: "WORLD_FILE", jgw: "WORLD_FILE", tfw: "WORLD_FILE", gfw: "WORLD_FILE", wld: "WORLD_FILE", prj: "WORLD_FILE",
  gpx: "GPS", kmz: "GPS", kml: "GPS", fit: "GPS", tcx: "GPS", bak: "BACKUP", tmp: "BACKUP"
};

/** Systemfiler och macOS-kataloger som zip-program lägger till. */
export function isSystemPath(path: string): boolean {
  const parts = normalizePath(path).split("/");
  const name = parts[parts.length - 1] ?? "";
  return parts.some(part => part === "__MACOSX" || part === ".git") || name.startsWith("._") || name.startsWith("~$")
    || name === ".DS_Store" || name.toLowerCase() === "thumbs.db" || name.toLowerCase() === "desktop.ini";
}

export function classifyPath(path: string): Classified {
  if (isSystemPath(path)) return { kind: "SKIP", category: "SYSTEM" };
  const extension = extensionOf(path);
  if (extension === "ocd") return { kind: "MAP", format: "OCD" };
  if (extension === "omap" || extension === "xmap") return { kind: "MAP", format: "OMAP" };
  if (extension === "ppen") return { kind: "PPEN" };
  if (extension === "xml") return { kind: "XML" };
  // OCAD:s automatiska säkerhetskopior (Karta.ocd.bak, Karta.1.ocd i backup-mappen räknas som karta).
  if (/\.ocd\.\w+$/i.test(baseName(path))) return { kind: "SKIP", category: "BACKUP" };
  return { kind: "SKIP", category: SKIP_BY_EXTENSION[extension] ?? "OTHER" };
}

/** Rotelementets lokala namn i en XML-text (efter deklaration, kommentarer och DOCTYPE), eller null. */
export function xmlRootName(head: string): string | null {
  const text = head.replace(/^\uFEFF/, "").replace(/<\?[\s\S]*?\?>/g, "").replace(/<!--[\s\S]*?-->/g, "").replace(/<![^>]*>/g, "");
  const match = /<(?:[A-Za-z_][\w.-]*:)?([A-Za-z_][\w.-]*)[\s>/]/.exec(text);
  return match?.[1] ?? null;
}

export const isCourseDataXml = (head: string): boolean => xmlRootName(head) === "CourseData";

/** OCAD: filen börjar med 0x0CAD. Mapper: XML med OpenOrienteerings namnrymd (samma kontroll som servern). */
export function mapFormatOfHead(bytes: Uint8Array): "OCD" | "OMAP" | null {
  if (bytes.length >= 64 && bytes[0] === 0xad && bytes[1] === 0x0c) return "OCD";
  const head = new TextDecoder("utf-8", { fatal: false }).decode(bytes.subarray(0, 4096)).trimStart();
  if (head.startsWith("<?xml") && /<map\b[^>]*xmlns="http:\/\/openorienteering\.org\/apps\/mapper\/xml\/v\d+"/.test(head)) return "OMAP";
  return null;
}
