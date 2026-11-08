/**
 * Papperet, steg 2 (ADR-0197): det som står på arket utöver kartan och banan – texter med variabler, bilder (logotyper),
 * skalstock och nordpil – och klippningen av kartan i ramen. Allt i papperets mm, förankrat i ett hörn av kartramen eller
 * arket (`paper-anchor.ts`), per bana i `event.paperLayouts` och i namngivna mallar (`event.paperTemplates`) som banorna
 * ärver av. Ingenting här ritas i editorn ("model space"); förhandsvisningen och PDF:en ritar samma delar (`PaperPart`).
 *
 * Här: modellen, kontrollen av den och arvet från mallen. Variablerna i texterna står i `paper-text.ts`, elementen på
 * arket och klippningen i `paper-sheet.ts`.
 */
import { PAPER_CORNERS, type PaperAnchor, type PaperRect } from "./paper-anchor";
import type { CourseSettingDocument, PartOverlap } from "./types";
import { CourseSettingEditError } from "./types";
import { validateShapeItem, validateWhiteAreas } from "./paper-shapes";

export type PaperAlign = "left" | "center" | "right";

interface PaperItemBase {
  /** Elementets id (unikt i banan och mallen; en banas element med en malls id ersätter mallens). */
  readonly id: string;
  readonly at: PaperAnchor;
  /** PAGE = förankrat i arkets hörn i stället för kartramens. */
  readonly relativeTo?: "PAGE" | undefined;
  /** En bana på flera sidor: ALL = på varje sida; saknas = bara första sidan (som beskrivningen). */
  readonly pages?: "ALL" | undefined;
  /** Lagerlistan (ADR-0211 beslut 8): låst = går inte att markera eller flytta på arket; dold = står inte på arket. */
  readonly locked?: boolean | undefined;
  readonly hide?: boolean | undefined;
}

/**
 * Typsnitten för papperets texter: Roboto (förval) och fria typsnitt (OFL och Apache 2.0) som följer med O-Tid och bäddas in i
 * PDF:en. Fet och kursiv finns i de typsnitt som har dem; övriga skrivs i sin enda vikt.
 */
export const PAPER_FONTS = ["ROBOTO", "ROBOTO_CONDENSED", "INTER", "CRIMSON", "BEBAS", "CREEPSTER", "NOSIFER", "MARKER"] as const;
export type PaperFont = typeof PAPER_FONTS[number];
export const PAPER_FONT_INFO: Readonly<Record<PaperFont, { readonly name: string; readonly bold: boolean; readonly italic: boolean }>> = {
  ROBOTO: { name: "Roboto", bold: true, italic: true },
  ROBOTO_CONDENSED: { name: "Roboto Condensed", bold: true, italic: false },
  INTER: { name: "Inter", bold: true, italic: true },
  CRIMSON: { name: "Crimson Text", bold: true, italic: true },
  BEBAS: { name: "Bebas Neue", bold: false, italic: false },
  CREEPSTER: { name: "Creepster", bold: false, italic: false },
  NOSIFER: { name: "Nosifer", bold: false, italic: false },
  MARKER: { name: "Permanent Marker", bold: false, italic: false }
};

/**
 * Text: rutans bredd (raderna justeras i den), storleken (em i mm), typsnittet, fet, kursiv, spärrning (em mellan tecknen),
 * justering och vit bakgrund.
 */
export interface PaperText extends PaperItemBase {
  readonly kind: "TEXT";
  readonly text: string;
  readonly sizeMm: number;
  readonly widthMm: number;
  /** Saknas = Roboto. */
  readonly font?: PaperFont | undefined;
  readonly bold?: boolean | undefined;
  readonly italic?: boolean | undefined;
  /** Spärrning i em (0–1), t.ex. 0,3 för rubriker i versaler. */
  readonly tracking?: number | undefined;
  /** Textens färg (#rrggbb), t.ex. grå på en baksida som inte ska lysa igenom; saknas = svart. */
  readonly color?: string | undefined;
  readonly align?: PaperAlign | undefined;
  readonly background?: boolean | undefined;
}

/** Bild ur papperets bildlager (sha256): bredden, höjden följer bildens proportioner, täckningen 0,05–1. */
export interface PaperImage extends PaperItemBase {
  readonly kind: "IMAGE";
  readonly image: string;
  readonly mediaType: "image/png" | "image/jpeg";
  /** Bredd / höjd i bildpunkter. */
  readonly aspect: number;
  readonly widthMm: number;
  readonly opacity?: number | undefined;
}

/** Skalstock: högst `widthMm` lång, längden avrundad nedåt till 1, 2 eller 5 gånger en tiopotens i meter. */
export interface PaperScaleBar extends PaperItemBase {
  readonly kind: "SCALE_BAR";
  readonly widthMm: number;
  readonly background?: boolean | undefined;
}

/** Nordpil (uppåt på arket, som kartan): höjden. */
export interface PaperNorthArrow extends PaperItemBase {
  readonly kind: "NORTH_ARROW";
  readonly sizeMm: number;
}

/**
 * Rektangel eller ram (ADR-0211 beslut 8): bredd och höjd, linjens bredd (0 = ingen linje), färg (#rrggbb), fyllning
 * (saknas = ingen) och rundade hörn. Så kan banorna få samma ramar och fält kring logotyper.
 */
export interface PaperRectangle extends PaperItemBase {
  readonly kind: "RECT";
  readonly widthMm: number;
  readonly heightMm: number;
  readonly strokeMm: number;
  readonly color: string;
  readonly fill?: string | undefined;
  readonly radiusMm?: number | undefined;
}

/** Linje i rutan bredd × höjd: från övre vänstra till nedre högra hörnet, eller (`rising`) från nedre vänstra till övre högra. */
export interface PaperLine extends PaperItemBase {
  readonly kind: "LINE";
  readonly widthMm: number;
  readonly heightMm: number;
  readonly strokeMm: number;
  readonly color: string;
  readonly rising?: boolean | undefined;
}

export type PaperItem = PaperText | PaperImage | PaperScaleBar | PaperNorthArrow | PaperRectangle | PaperLine;
export type PaperItemKind = PaperItem["kind"];

/**
 * Klippningen av kartan i ramen: en rektangel eller en polygon i ramens mm (origo i ramens övre vänstra hörn). Utanför är
 * papperet vitt eller kartan tonad. Banan (kontroller, start, mål, sträckor, nummer) står alltid hel; banläggningens
 * markeringar (specialobjekten: förbjudet område, gränser, vätska …) står bara innanför, klippta vid kanten, om inte
 * `showMarkings` (ägaren 2026-11-03: "Visa markeringar utanför utsnittet", förval av).
 */
interface PaperClipBase { readonly outside: "WHITE" | "FADED"; readonly showMarkings?: boolean | undefined }
export type PaperClip =
  | (PaperClipBase & { readonly shape: "RECT"; readonly rect: PaperRect })
  | (PaperClipBase & { readonly shape: "POLYGON"; readonly points: readonly { readonly x: number; readonly y: number }[] });

/** Kontrollbeskrivningen på kartan (hittbarhet). Saknas `at` placeras den automatiskt (eller där .ppen-filen har den). */
export interface PaperDescriptions {
  /** false = ingen beskrivning på kartan; saknas = på för banor, av för Alla kontroller. */
  readonly show?: boolean | undefined;
  readonly at?: PaperAnchor | undefined;
  /** Rutans sida i mm på papperet; saknas = filens eller 5 mm. */
  readonly boxMm?: number | undefined;
  /** Spalter (1–4); saknas = filens eller 1. */
  readonly columns?: number | undefined;
}

/**
 * Papperet för en bana (eller "ALL_CONTROLS"). `template` = mallen som banan ärver av; `items` = banans egna element och
 * ändrade mallelement (samma id); `hidden` = mallens element som inte ska stå på banans ark; `clip` = banans klippning
 * ("NONE" = ingen, även om mallen har en).
 */
export interface CoursePaperLayout {
  readonly descriptions?: PaperDescriptions | undefined;
  readonly template?: string | undefined;
  readonly items?: readonly PaperItem[] | undefined;
  readonly hidden?: readonly string[] | undefined;
  readonly clip?: PaperClip | "NONE" | undefined;
  /** Kartbyten (ADR-0203): "Visa överlapp" mot föregående del; saknas = sista sträckan. Gäller banan (inte en del). */
  readonly overlap?: PartOverlap | undefined;
  /** "Vitt på utskriften" (ADR-0211 beslut 8): ytor i ramen som skrivs ut vita; tom lista = inga (också om mallen har). */
  readonly whiteAreas?: readonly PaperShape[] | undefined;
}

/** En rektangel eller polygon i ramens mm (origo i ramens övre vänstra hörn). */
export type PaperShape =
  | { readonly shape: "RECT"; readonly rect: PaperRect }
  | { readonly shape: "POLYGON"; readonly points: readonly { readonly x: number; readonly y: number }[] };

/** En namngiven mall för papperet ("Klubbens träningsmall"): element, klippning och beskrivningens inställning. */
export interface PaperTemplate {
  readonly schemaVersion: 1;
  readonly id: string;
  readonly name: string;
  readonly items: readonly PaperItem[];
  readonly clip?: PaperClip | undefined;
  readonly descriptions?: PaperDescriptions | undefined;
  readonly whiteAreas?: readonly PaperShape[] | undefined;
  /**
   * Papperet (ADR-0211 beslut 9): storlek och marginal i 1/100 tum och riktning, som banans tryckyta (`PrintArea.page`).
   * "Använd mallen" sätter banans papper till mallens.
   */
  readonly page?: { readonly width: number; readonly height: number; readonly margins: number; readonly landscape: boolean } | undefined;
}

/** Tävlingens värden för variablerna som inte finns i banfilen. */
export interface PaperValues {
  readonly date?: string | undefined;
  readonly contourInterval?: string | undefined;
}

export const PAPER_VARIABLES = ["bana", "klass", "längd", "stigning", "tävling", "datum", "skala", "ekvidistans", "variant"] as const;
/**
 * ADR-0213: löparens variabler i en karta per löpare (och på baksidan). {klass} och {variant} finns redan (banans klasser och
 * ramens variant utan löpare). Stafett: {lag}, {lagnummer} och {sträcka}. Mallarna sparar bara variablerna, aldrig löparen.
 */
export const RUNNER_PAPER_VARIABLES = ["namn", "startnummer", "klubb", "starttid", "lag", "lagnummer", "sträcka"] as const;
export const PAPER_LIMITS = {
  items: 40, templates: 30, textLength: 400, nameLength: 80, minTextMm: 1.5, maxTextMm: 40, minWidthMm: 5, maxWidthMm: 1000,
  minScaleBarMm: 10, maxScaleBarMm: 300, minArrowMm: 5, maxArrowMm: 100, minOpacity: 0.05, polygonPoints: 64, imageBytes: 2 * 1024 * 1024
} as const;
export const PAPER_DESCRIPTION_LIMITS = { minBoxMm: 3, maxBoxMm: 10, maxColumns: 4 } as const;

const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
const invalid = (message: string) => new CourseSettingEditError("INVALID", `Papperet: ${message}`);
const ID = /^[A-Za-z0-9_-]{1,40}$/;
const SHA256 = /^[0-9a-f]{64}$/;
const within = (value: unknown, min: number, max: number) => finite(value) && value >= min && value <= max;

function validAnchor(value: unknown, what: string): PaperAnchor {
  const at = value as PaperAnchor | undefined;
  if (!at || !PAPER_CORNERS.includes(at.corner) || !within(at.x, -2000, 2000) || !within(at.y, -2000, 2000)) throw invalid(`platsen för ${what}`);
  return { corner: at.corner, x: at.x, y: at.y };
}

/** Kontrollbeskrivningens inställning (okända fält tas bort). */
export function validatePaperDescriptions(value: unknown): PaperDescriptions {
  if (typeof value !== "object" || value === null) throw invalid("beskrivningen");
  const descriptions = value as PaperDescriptions;
  const out: { -readonly [K in keyof PaperDescriptions]: PaperDescriptions[K] } = {};
  if (descriptions.show !== undefined) {
    if (typeof descriptions.show !== "boolean") throw invalid("på eller av");
    out.show = descriptions.show;
  }
  if (descriptions.at !== undefined) out.at = validAnchor(descriptions.at, "beskrivningen");
  if (descriptions.boxMm !== undefined) {
    if (!within(descriptions.boxMm, PAPER_DESCRIPTION_LIMITS.minBoxMm, PAPER_DESCRIPTION_LIMITS.maxBoxMm)) throw invalid("rutans storlek");
    out.boxMm = descriptions.boxMm;
  }
  if (descriptions.columns !== undefined) {
    if (!Number.isInteger(descriptions.columns) || descriptions.columns < 1 || descriptions.columns > PAPER_DESCRIPTION_LIMITS.maxColumns) throw invalid("spalterna");
    out.columns = descriptions.columns;
  }
  return out;
}

/** Ett element (okända fält tas bort, gränserna i `PAPER_LIMITS`). */
export function validatePaperItem(value: unknown): PaperItem {
  if (typeof value !== "object" || value === null) throw invalid("ett element");
  const item = value as PaperItem;
  if (typeof item.id !== "string" || !ID.test(item.id)) throw invalid("elementets id");
  const base = { id: item.id, at: validAnchor(item.at, "elementet"), ...(item.relativeTo === "PAGE" ? { relativeTo: "PAGE" as const } : {}),
    ...(item.pages === "ALL" ? { pages: "ALL" as const } : {}), ...(item.locked === true ? { locked: true } : {}), ...(item.hide === true ? { hide: true } : {}) };
  if (item.locked !== undefined && typeof item.locked !== "boolean") throw invalid("låst");
  if (item.hide !== undefined && typeof item.hide !== "boolean") throw invalid("dold");
  if (item.relativeTo !== undefined && item.relativeTo !== "PAGE") throw invalid("vad elementet står i förhållande till");
  if (item.pages !== undefined && item.pages !== "ALL") throw invalid("sidorna (första eller alla)");
  const flag = (value: unknown, what: string) => {
    if (value !== undefined && typeof value !== "boolean") throw invalid(what);
    return value === true;
  };
  switch (item.kind) {
    case "TEXT": {
      if (typeof item.text !== "string" || item.text.length > PAPER_LIMITS.textLength) throw invalid(`texten (högst ${PAPER_LIMITS.textLength} tecken)`);
      if (!within(item.sizeMm, PAPER_LIMITS.minTextMm, PAPER_LIMITS.maxTextMm)) throw invalid("textens storlek");
      if (!within(item.widthMm, PAPER_LIMITS.minWidthMm, PAPER_LIMITS.maxWidthMm)) throw invalid("textrutans bredd");
      if (item.align !== undefined && !["left", "center", "right"].includes(item.align)) throw invalid("justeringen");
      if (item.font !== undefined && !(PAPER_FONTS as readonly string[]).includes(item.font)) throw invalid("typsnittet");
      if (item.tracking !== undefined && !within(item.tracking, 0, 1)) throw invalid("spärrningen (0–1 em)");
      if (item.color !== undefined && (typeof item.color !== "string" || !/^#[0-9a-f]{6}$/.test(item.color.toLowerCase()))) throw invalid("textens färg (#rrggbb)");
      return { ...base, kind: "TEXT", text: item.text, sizeMm: item.sizeMm, widthMm: item.widthMm, ...(flag(item.bold, "fet") ? { bold: true } : {}),
        ...(item.font && item.font !== "ROBOTO" ? { font: item.font } : {}), ...(flag(item.italic, "kursiv") ? { italic: true } : {}),
        ...(item.tracking ? { tracking: item.tracking } : {}),
        ...(item.color && item.color.toLowerCase() !== "#000000" ? { color: item.color.toLowerCase() } : {}),
        ...(item.align && item.align !== "left" ? { align: item.align } : {}), ...(flag(item.background, "bakgrunden") ? { background: true } : {}) };
    }
    case "IMAGE": {
      if (typeof item.image !== "string" || !SHA256.test(item.image)) throw invalid("bilden");
      if (item.mediaType !== "image/png" && item.mediaType !== "image/jpeg") throw invalid("bildens typ (PNG eller JPEG)");
      if (!within(item.aspect, 0.01, 100)) throw invalid("bildens proportioner");
      if (!within(item.widthMm, 2, PAPER_LIMITS.maxWidthMm)) throw invalid("bildens bredd");
      if (item.opacity !== undefined && !within(item.opacity, PAPER_LIMITS.minOpacity, 1)) throw invalid("täckningen");
      return { ...base, kind: "IMAGE", image: item.image, mediaType: item.mediaType, aspect: item.aspect, widthMm: item.widthMm,
        ...(item.opacity !== undefined && item.opacity < 1 ? { opacity: item.opacity } : {}) };
    }
    case "SCALE_BAR":
      if (!within(item.widthMm, PAPER_LIMITS.minScaleBarMm, PAPER_LIMITS.maxScaleBarMm)) throw invalid("skalstockens längd");
      return { ...base, kind: "SCALE_BAR", widthMm: item.widthMm, ...(flag(item.background, "bakgrunden") ? { background: true } : {}) };
    case "NORTH_ARROW":
      if (!within(item.sizeMm, PAPER_LIMITS.minArrowMm, PAPER_LIMITS.maxArrowMm)) throw invalid("nordpilens storlek");
      return { ...base, kind: "NORTH_ARROW", sizeMm: item.sizeMm };
    case "RECT": case "LINE": return validateShapeItem(item, base);
    default: throw invalid("okänt slags element");
  }
}

export function validatePaperClip(value: unknown): PaperClip {
  const clip = value as PaperClip | undefined;
  if (!clip || typeof clip !== "object") throw invalid("klippningen");
  if (clip.outside !== "WHITE" && clip.outside !== "FADED") throw invalid("utanför klippningen (vitt eller tonat)");
  if (clip.showMarkings !== undefined && typeof clip.showMarkings !== "boolean") throw invalid("markeringarna utanför klippningen");
  const markings = clip.showMarkings ? { showMarkings: true } : {};
  const point = (p: { x: number; y: number } | undefined) => {
    if (!p || !within(p.x, -2000, 2000) || !within(p.y, -2000, 2000)) throw invalid("klippningens hörn");
    return { x: p.x, y: p.y };
  };
  if (clip.shape === "RECT") {
    const r = clip.rect;
    if (!r || !within(r.width, 1, 2000) || !within(r.height, 1, 2000)) throw invalid("klippningens rektangel");
    const corner = point({ x: r.x, y: r.y });
    return { shape: "RECT", rect: { ...corner, width: r.width, height: r.height }, outside: clip.outside, ...markings };
  }
  if (clip.shape === "POLYGON") {
    if (!Array.isArray(clip.points) || clip.points.length < 3 || clip.points.length > PAPER_LIMITS.polygonPoints) throw invalid(`klippningens polygon (3–${PAPER_LIMITS.polygonPoints} hörn)`);
    return { shape: "POLYGON", points: clip.points.map(point), outside: clip.outside, ...markings };
  }
  throw invalid("klippningens form");
}

function validItems(value: unknown): PaperItem[] {
  if (!Array.isArray(value) || value.length > PAPER_LIMITS.items) throw invalid(`elementen (högst ${PAPER_LIMITS.items})`);
  const items = value.map(validatePaperItem);
  if (new Set(items.map(item => item.id)).size !== items.length) throw invalid("två element med samma id");
  return items;
}

/** Kontrollerar och rensar en banas papper (okända fält tas bort). */
export function validatePaperLayout(value: CoursePaperLayout): CoursePaperLayout {
  if (typeof value !== "object" || value === null) throw invalid("ingen inställning");
  const out: { -readonly [K in keyof CoursePaperLayout]: CoursePaperLayout[K] } = {};
  if (value.descriptions !== undefined) {
    const descriptions = validatePaperDescriptions(value.descriptions);
    if (Object.keys(descriptions).length > 0) out.descriptions = descriptions;
  }
  if (value.template !== undefined) {
    if (typeof value.template !== "string" || !ID.test(value.template)) throw invalid("mallen");
    out.template = value.template;
  }
  if (value.items !== undefined) {
    const items = validItems(value.items);
    if (items.length > 0) out.items = items;
  }
  if (value.hidden !== undefined) {
    if (!Array.isArray(value.hidden) || value.hidden.length > PAPER_LIMITS.items || !value.hidden.every(id => typeof id === "string" && ID.test(id))) throw invalid("dolda element");
    if (value.hidden.length > 0) out.hidden = [...new Set(value.hidden)];
  }
  if (value.clip !== undefined) out.clip = value.clip === "NONE" ? "NONE" : validatePaperClip(value.clip);
  if (value.whiteAreas !== undefined) out.whiteAreas = validateWhiteAreas(value.whiteAreas);
  if (value.overlap !== undefined) {
    if (!["NONE", "LAST_LEG", "PREVIOUS_PART"].includes(value.overlap)) throw invalid("överlappet vid kartbytet");
    if (value.overlap !== "LAST_LEG") out.overlap = value.overlap;
  }
  return out;
}

export function validatePaperTemplate(value: unknown): PaperTemplate {
  const template = value as PaperTemplate | undefined;
  if (!template || typeof template !== "object") throw invalid("mallen");
  if (template.schemaVersion !== 1) throw invalid(`mallens schemaVersion ${String(template.schemaVersion)} stöds inte`);
  if (typeof template.id !== "string" || !ID.test(template.id)) throw invalid("mallens id");
  const name = typeof template.name === "string" ? template.name.trim() : "";
  if (name === "" || name.length > PAPER_LIMITS.nameLength) throw invalid(`mallens namn (1–${PAPER_LIMITS.nameLength} tecken)`);
  const descriptions = template.descriptions === undefined ? undefined : validatePaperDescriptions(template.descriptions);
  return { schemaVersion: 1, id: template.id, name, items: validItems(template.items ?? []),
    ...(template.clip !== undefined ? { clip: validatePaperClip(template.clip) } : {}),
    ...(descriptions && Object.keys(descriptions).length > 0 ? { descriptions } : {}),
    ...(template.whiteAreas !== undefined && template.whiteAreas.length > 0 ? { whiteAreas: validateWhiteAreas(template.whiteAreas) } : {}),
    ...(template.page !== undefined ? { page: validTemplatePage(template.page) } : {}) };
}

function validTemplatePage(page: NonNullable<PaperTemplate["page"]>): NonNullable<PaperTemplate["page"]> {
  if (!within(page.width, 100, 10_000) || !within(page.height, 100, 10_000) || !within(page.margins, 0, 1000) || typeof page.landscape !== "boolean") {
    throw invalid("mallens papper");
  }
  return { width: page.width, height: page.height, margins: page.margins, landscape: page.landscape };
}

/** Nyckeln för en dels papper i `event.paperLayouts` (ADR-0203): "1#0", "1#1" … */
export const paperPartKey = (course: string, part: number) => `${course}#${part}`;

/**
 * Banans papper (tomt om inget är inställt). Med `part` (kartbyten, ADR-0203): delens fält före banans, beskrivningen fält
 * för fält; en del utan eget papper ärver banans.
 */
export function paperLayoutOf(document: CourseSettingDocument, course: string, part?: number): CoursePaperLayout {
  const whole = document.event.paperLayouts?.[course] ?? {};
  if (part === undefined) return whole;
  const own = document.event.paperLayouts?.[paperPartKey(course, part)];
  if (!own) return whole;
  const descriptions = whole.descriptions || own.descriptions ? { ...(whole.descriptions ?? {}), ...(own.descriptions ?? {}) } : undefined;
  return { ...whole, ...own, ...(descriptions ? { descriptions } : {}) };
}

/** Delens eget papper (utan banans), för ändringar av en del. */
export function ownPartLayout(document: CourseSettingDocument, course: string, part: number): CoursePaperLayout {
  return document.event.paperLayouts?.[paperPartKey(course, part)] ?? {};
}

export function paperTemplateOf(document: CourseSettingDocument, id: string | undefined): PaperTemplate | undefined {
  return id === undefined ? undefined : document.event.paperTemplates?.find(template => template.id === id);
}

/** OWN = banans eget; TEMPLATE = ärvt ur mallen; OVERRIDE = mallens element ändrat för banan. */
export type PaperSource = "OWN" | "TEMPLATE" | "OVERRIDE";
export interface EffectivePaperItem { readonly item: PaperItem; readonly source: PaperSource }
export interface EffectivePaper {
  readonly template?: PaperTemplate | undefined;
  readonly items: readonly EffectivePaperItem[];
  readonly clip?: PaperClip | undefined;
  readonly clipSource?: "OWN" | "TEMPLATE" | undefined;
  readonly descriptions: PaperDescriptions;
  /** "Vitt på utskriften": banans ytor, annars mallens. */
  readonly whiteAreas: readonly PaperShape[];
  readonly whiteSource?: "OWN" | "TEMPLATE" | undefined;
}

/**
 * Det som gäller för banan: mallens element (utom de dolda, och med banans ändringar), sedan banans egna; banans klippning
 * annars mallens; beskrivningens inställning fält för fält, banans före mallens.
 */
export function effectivePaper(document: CourseSettingDocument, course: string, part?: number): EffectivePaper {
  const layout = paperLayoutOf(document, course, part);
  const template = paperTemplateOf(document, layout.template);
  const own = layout.items ?? [];
  const hidden = new Set(layout.hidden ?? []);
  const items: EffectivePaperItem[] = [];
  const templateIds = new Set<string>();
  for (const item of template?.items ?? []) {
    templateIds.add(item.id);
    if (hidden.has(item.id)) continue;
    const changed = own.find(row => row.id === item.id);
    items.push(changed ? { item: changed, source: "OVERRIDE" } : { item, source: "TEMPLATE" });
  }
  for (const item of own) if (!templateIds.has(item.id)) items.push({ item, source: "OWN" });
  const clip = layout.clip === "NONE" ? undefined : layout.clip ?? template?.clip;
  const clipSource = layout.clip === "NONE" || !clip ? undefined : layout.clip ? "OWN" as const : "TEMPLATE" as const;
  const descriptions = { ...(template?.descriptions ?? {}), ...(layout.descriptions ?? {}) };
  const white = layout.whiteAreas ?? template?.whiteAreas ?? [];
  const whiteSource = white.length === 0 ? undefined : layout.whiteAreas ? "OWN" as const : "TEMPLATE" as const;
  return { ...(template ? { template } : {}), items, ...(clip ? { clip, clipSource } : {}), descriptions, whiteAreas: white, ...(whiteSource ? { whiteSource } : {}) };
}

/**
 * Banans papper efter att ett element ändrats (ny, flyttad, ändrad): ett mallelement blir en ändring för banan, ett eget
 * ersätts. `null` = elementet tas bort (ett mallelement döljs för banan).
 */
export function withPaperItem(document: CourseSettingDocument, course: string, id: string, item: PaperItem | null, part?: number): CoursePaperLayout {
  const layout = paperLayoutOf(document, course, part);
  const template = paperTemplateOf(document, layout.template);
  const fromTemplate = template?.items.some(row => row.id === id) ?? false;
  const own = (layout.items ?? []).filter(row => row.id !== id);
  const items = item ? (layout.items ?? []).some(row => row.id === id) ? (layout.items ?? []).map(row => row.id === id ? item : row) : [...own, item] : own;
  const hidden = item === null && fromTemplate ? [...new Set([...(layout.hidden ?? []), id])] : layout.hidden ?? [];
  return { ...layout, items, hidden };
}

/** Banans ändring av ett mallelement tas bort (mallens gäller igen). */
export function resetPaperItem(document: CourseSettingDocument, course: string, id: string, part?: number): CoursePaperLayout {
  const layout = paperLayoutOf(document, course, part);
  return { ...layout, items: (layout.items ?? []).filter(row => row.id !== id), hidden: (layout.hidden ?? []).filter(row => row !== id) };
}

/** En mall av det som gäller för banan nu (element, klippning och beskrivningens plats). */
export function paperTemplateFromCourse(document: CourseSettingDocument, course: string, id: string, name: string, part?: number): PaperTemplate {
  const effective = effectivePaper(document, course, part);
  const descriptions = effective.descriptions;
  const page = document.courses.find(row => row.id === course)?.printArea?.page;
  return validatePaperTemplate({ schemaVersion: 1, id, name, items: effective.items.map(row => row.item),
    ...(effective.clip ? { clip: effective.clip } : {}), ...(Object.keys(descriptions).length > 0 ? { descriptions } : {}),
    ...(effective.whiteAreas.length > 0 ? { whiteAreas: effective.whiteAreas } : {}), ...(page ? { page } : {}) });
}

/** Banans papper när mallen används: mallen och beskrivningen ur mallen; banans egna element står kvar, ändringar av mallens tas bort. */
export function applyPaperTemplate(document: CourseSettingDocument, course: string, template: PaperTemplate | undefined, part?: number): CoursePaperLayout {
  const layout = paperLayoutOf(document, course, part);
  if (!template) {
    const rest: { -readonly [K in keyof CoursePaperLayout]: CoursePaperLayout[K] } = { ...layout };
    delete rest.template; delete rest.hidden;
    return rest;
  }
  const ids = new Set(template.items.map(item => item.id));
  const descriptions = layout.descriptions ? { show: layout.descriptions.show } : undefined;
  return { ...(descriptions && descriptions.show !== undefined ? { descriptions } : {}), template: template.id,
    items: (layout.items ?? []).filter(item => !ids.has(item.id)) };
}

/** Ett nytt id för ett element (`p1`, `p2` …) som inte finns i banan eller mallen. */
export function newPaperItemId(document: CourseSettingDocument, course: string, part?: number): string {
  const used = new Set([...effectivePaper(document, course, part).items.map(row => row.item.id), ...(paperLayoutOf(document, course, part).hidden ?? [])]);
  // Delarnas egna element också (samma id i en del ändrar banans).
  for (const [key, layout] of Object.entries(document.event.paperLayouts ?? {})) if (key.startsWith(`${course}#`)) for (const item of layout.items ?? []) used.add(item.id);
  for (const template of document.event.paperTemplates ?? []) for (const item of template.items) used.add(item.id);
  let n = 1;
  while (used.has(`p${n}`)) n += 1;
  return `p${n}`;
}

/** Bilderna (sha256) som banornas papper och mallarna pekar på. */
export function paperImageHashes(document: CourseSettingDocument): string[] {
  const out = new Set<string>();
  const add = (items: readonly PaperItem[] | undefined) => { for (const item of items ?? []) if (item.kind === "IMAGE") out.add(item.image); };
  for (const layout of Object.values(document.event.paperLayouts ?? {})) add(layout.items);
  for (const template of document.event.paperTemplates ?? []) add(template.items);
  return [...out];
}
