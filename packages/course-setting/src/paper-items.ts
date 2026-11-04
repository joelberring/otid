/**
 * Papperet, steg 2 (ADR-0197): det som står på arket utöver kartan och banan – texter med variabler, bilder (logotyper),
 * skalstock och nordpil – och klippningen av kartan i ramen. Allt i papperets mm, förankrat i ett hörn av kartramen eller
 * arket (`paper-anchor.ts`), per bana i `event.paperLayouts` och i namngivna mallar (`event.paperTemplates`) som banorna
 * ärver av. Ingenting här ritas i editorn ("model space"); förhandsvisningen och PDF:en ritar samma delar (`PaperPart`).
 */
import type { Point } from "@o-tid/map-file";
import { anchorToPaper, PAPER_CORNERS, type PaperAnchor, type PaperRect } from "./paper-anchor";
import type { TrainingMapPass } from "./training-types";
import type { CourseSettingDocument, MapRect, PartOverlap } from "./types";
import { CourseSettingEditError } from "./types";
import { measuredLengthMeters, variations } from "./walk";
import { shapeParts, shapeSize, validateShapeItem, validateWhiteAreas } from "./paper-shapes";

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

/** Text: rutans bredd (raderna justeras i den), storleken (em i mm), fet, justering och vit bakgrund. */
export interface PaperText extends PaperItemBase {
  readonly kind: "TEXT";
  readonly text: string;
  readonly sizeMm: number;
  readonly widthMm: number;
  readonly bold?: boolean | undefined;
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
      return { ...base, kind: "TEXT", text: item.text, sizeMm: item.sizeMm, widthMm: item.widthMm, ...(flag(item.bold, "fet") ? { bold: true } : {}),
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

// ── Variablerna ─────────────────────────────────────────────────────────────────────────────────────────────────────────

/** Det som variablerna fylls i för: ramens bana, variant, skala och (i en karta per löpare) löparen. */
export interface PaperTextFrame {
  readonly course: string;
  readonly variant?: string | undefined;
  /** Kartbyten (ADR-0203): delen av banan. */
  readonly part?: number | undefined;
  readonly printScale: number;
  readonly runner?: { readonly kind: "RUNNER" | "VACANT" | "RESERVE"; readonly name: string | null; readonly club?: string | null | undefined;
    readonly className: string | null; readonly startTime: string | null; readonly startNumber: number | null } | undefined;
}

const thousands = (value: number) => Math.round(value).toLocaleString("sv-SE").replace(/\s/g, " ");

function lengthMeters(document: CourseSettingDocument, course: string, variant: string | undefined): number | undefined {
  const found = document.courses.find(item => item.id === course);
  if (!found) return undefined;
  if (found.lengthOverrideMeters !== undefined) return found.lengthOverrideMeters;
  const all = variations(document, course).filter(item => variant === undefined || item.code === variant);
  return Math.max(...(all.length > 0 ? all.map(item => measuredLengthMeters(document, course, item.choices)) : [measuredLengthMeters(document, course, null)]));
}

/** Variablernas värden för ramen. */
export function paperTextValues(document: CourseSettingDocument, frame: PaperTextFrame | undefined, date?: string): Record<string, string> {
  const course = frame ? document.courses.find(item => item.id === frame.course) : undefined;
  const meters = frame ? lengthMeters(document, frame.course, frame.variant) : undefined;
  const runner = frame?.runner;
  const classes = (course?.secondaryTitle ?? "").replace(/\|/g, " ");
  return {
    "tävling": document.event.title.replace(/\|/g, " "),
    bana: frame ? course?.name ?? "Alla kontroller" : "",
    variant: frame?.variant ?? "",
    "längd": meters === undefined ? "" : `${(Math.round(meters / 100) / 10).toFixed(1).replace(".", ",")} km`,
    stigning: course?.climbMeters !== undefined && course.climbMeters >= 0 ? `${Math.round(course.climbMeters / 5) * 5} m` : "",
    skala: frame ? `1:${thousands(frame.printScale)}` : "",
    datum: date ?? document.event.paperValues?.date ?? "",
    ekvidistans: document.event.paperValues?.contourInterval ?? "",
    klasser: classes,
    "löpare": runner?.name ?? (runner?.kind === "VACANT" ? "Ledig" : runner?.kind === "RESERVE" ? "Reserv" : ""),
    klubb: runner?.club ?? "",
    // Klassen: löparens i en karta per löpare, annars banans klasser.
    klass: runner ? runner.className ?? "" : classes,
    starttid: runner?.startTime ?? "",
    startnummer: runner?.startNumber !== null && runner?.startNumber !== undefined ? String(runner.startNumber) : ""
  };
}

/** Texten med variablerna ifyllda ({bana}, {längd} …); okända lämnas kvar. Raderna behålls, tomma rader i slutet tas bort. */
export function expandPaperText(text: string, document: CourseSettingDocument, frame: PaperTextFrame | undefined, date?: string): string {
  const values = paperTextValues(document, frame, date);
  return text.split("\n").map(line => line.replace(/\{([a-zåäö]+)\}/gi, (whole, key: string) => values[key.toLowerCase()] ?? whole)
    .replace(/ {2,}(?=\S)/g, "  ").trimEnd()).join("\n").replace(/\n+$/, "").replace(/^\s+$/, "");
}

/** Purple Pens makron för variablerna; datum och ekvidistans har inget makro och skrivs som text. */
const PPEN_MACROS: Readonly<Record<string, string>> = {
  bana: "$(CourseName)", "tävling": "$(EventTitle)", "längd": "$(CourseLength) km", stigning: "$(CourseClimb) m", skala: "$(PrintScale)",
  klass: "$(ClassList)", klasser: "$(ClassList)", variant: "$(Variation)"
};

/** Texten för Purple Pens textobjekt: variablerna som Purple Pens makron, datum och ekvidistans ifyllda. */
export function paperTextForPpen(text: string, document: CourseSettingDocument): string {
  return text.replace(/\{([a-zåäö]+)\}/gi, (whole, key: string) => {
    const name = key.toLowerCase();
    const macro = PPEN_MACROS[name];
    if (macro) return macro;
    if (name === "datum") return document.event.paperValues?.date ?? "";
    if (name === "ekvidistans") return document.event.paperValues?.contourInterval ?? "";
    return whole;
  });
}

// ── Elementen på arket ──────────────────────────────────────────────────────────────────────────────────────────────────

/** Delarna som förhandsvisningen (SVG) och PDF:en ritar, i papperets mm (y nedåt). Svart och vitt; bilden med täckning. */
export type PaperPart =
  | { readonly kind: "rect"; readonly x: number; readonly y: number; readonly width: number; readonly height: number;
      readonly fill?: "WHITE" | "BLACK" | undefined; readonly stroke?: number | undefined;
      /** Rektangelns färger (#rrggbb, ADR-0211 beslut 8) i stället för svart och vitt, och rundade hörn. */
      readonly fillColor?: string | undefined; readonly strokeColor?: string | undefined; readonly radius?: number | undefined }
  | { readonly kind: "line"; readonly x1: number; readonly y1: number; readonly x2: number; readonly y2: number; readonly width: number; readonly color: string }
  | { readonly kind: "polygon"; readonly points: readonly { readonly x: number; readonly y: number }[]; readonly fill: "WHITE" | "BLACK";
      readonly stroke?: number | undefined }
  | { readonly kind: "text"; readonly text: string; readonly at: { readonly x: number; readonly y: number }; readonly heightMm: number;
      readonly bold: boolean; readonly align: PaperAlign }
  | { readonly kind: "image"; readonly x: number; readonly y: number; readonly width: number; readonly height: number; readonly image: string;
      readonly mediaType: string; readonly opacity: number };

/** Ett element på arket: var det står, varifrån det kommer och delarna. */
export interface SheetPaperItem {
  readonly id: string;
  readonly kind: PaperItemKind;
  readonly course: string;
  readonly frame: number;
  readonly rect: PaperRect;
  readonly source: PaperSource;
  readonly relativeTo: "FRAME" | "PAGE";
  readonly parts: readonly PaperPart[];
  /** Låst i lagerlistan: ritas men markeras och flyttas inte på arket. */
  readonly locked?: boolean | undefined;
}

export const PAPER_TEXT_LINE = 1.2;
const TEXT_PAD_MM = 0.8;
const SCALE_BAR = { bar: 1.5, label: 2.5, gap: 0.6, pad: 1 } as const;

/** Skalstockens längd: största 1, 2 eller 5 gånger en tiopotens (meter) som ryms i `maxMm` i skalan. */
export function scaleBarLength(maxMm: number, printScale: number): { meters: number; mm: number; segments: number } {
  const maxMeters = maxMm * printScale / 1000;
  if (!(maxMeters > 0)) return { meters: 0, mm: 0, segments: 1 };
  const power = 10 ** Math.floor(Math.log10(maxMeters));
  const lead = [5, 2, 1].find(step => step * power <= maxMeters + 1e-9) ?? 1;
  const meters = lead * power;
  return { meters, mm: meters * 1000 / printScale, segments: lead === 2 ? 4 : 5 };
}

const metersText = (meters: number) => meters >= 1000 ? `${String(meters / 1000).replace(".", ",")} km` : `${meters} m`;

/** Elementets storlek på papperet (mm). */
export function paperItemSize(item: PaperItem, text?: string): { width: number; height: number } {
  switch (item.kind) {
    case "TEXT": {
      const lines = Math.max(1, (text ?? item.text).split("\n").length);
      return { width: item.widthMm, height: lines * item.sizeMm * PAPER_TEXT_LINE + (item.background ? 2 * TEXT_PAD_MM : 0) };
    }
    case "IMAGE": return { width: item.widthMm, height: item.widthMm / item.aspect };
    case "SCALE_BAR": return { width: item.widthMm + (item.background ? 2 * SCALE_BAR.pad : 0),
      height: SCALE_BAR.label * PAPER_TEXT_LINE + SCALE_BAR.gap + SCALE_BAR.bar + (item.background ? 2 * SCALE_BAR.pad : 0) };
    case "NORTH_ARROW": return { width: item.sizeMm * 0.6, height: item.sizeMm };
    case "RECT": case "LINE": return shapeSize(item);
  }
}

/** Delarna för ett element med övre vänstra hörnet i `at`. */
export function paperItemParts(item: PaperItem, at: { x: number; y: number }, context: { text?: string; printScale: number }): PaperPart[] {
  const size = paperItemSize(item, context.text);
  switch (item.kind) {
    case "TEXT": {
      const parts: PaperPart[] = item.background ? [{ kind: "rect", x: at.x, y: at.y, width: size.width, height: size.height, fill: "WHITE" }] : [];
      const pad = item.background ? TEXT_PAD_MM : 0;
      const align = item.align ?? "left";
      const x = align === "left" ? at.x + pad : align === "right" ? at.x + size.width - pad : at.x + size.width / 2;
      (context.text ?? item.text).split("\n").forEach((line, index) => {
        if (line.trim() === "") return;
        // Baslinjen: radens topp + 0,95 em (versalerna ryms ovanför, nedstaplarna under).
        parts.push({ kind: "text", text: line, at: { x, y: at.y + pad + index * item.sizeMm * PAPER_TEXT_LINE + item.sizeMm * 0.95 },
          heightMm: item.sizeMm, bold: item.bold === true, align });
      });
      return parts;
    }
    case "IMAGE":
      return [{ kind: "image", x: at.x, y: at.y, width: size.width, height: size.height, image: item.image, mediaType: item.mediaType, opacity: item.opacity ?? 1 }];
    case "SCALE_BAR": {
      const pad = item.background ? SCALE_BAR.pad : 0;
      const bar = scaleBarLength(item.widthMm, context.printScale);
      const parts: PaperPart[] = item.background ? [{ kind: "rect", x: at.x, y: at.y, width: size.width, height: size.height, fill: "WHITE" }] : [];
      const left = at.x + pad, top = at.y + pad + SCALE_BAR.label * PAPER_TEXT_LINE + SCALE_BAR.gap;
      const step = bar.mm / bar.segments;
      for (let i = 0; i < bar.segments; i += 1) {
        parts.push({ kind: "rect", x: left + i * step, y: top, width: step, height: SCALE_BAR.bar, fill: i % 2 === 0 ? "BLACK" : "WHITE", stroke: 0.15 });
      }
      const baseline = top - SCALE_BAR.gap - 0.15 * SCALE_BAR.label;
      parts.push({ kind: "text", text: "0", at: { x: left, y: baseline }, heightMm: SCALE_BAR.label, bold: false, align: "left" });
      parts.push({ kind: "text", text: metersText(bar.meters), at: { x: left + bar.mm, y: baseline }, heightMm: SCALE_BAR.label, bold: false, align: "right" });
      return parts;
    }
    case "NORTH_ARROW": {
      const w = size.width, h = size.height;
      return [
        { kind: "polygon", points: [{ x: at.x + w / 2, y: at.y }, { x: at.x + w, y: at.y + 0.68 * h }, { x: at.x + w / 2, y: at.y + 0.54 * h },
          { x: at.x, y: at.y + 0.68 * h }], fill: "BLACK" },
        { kind: "text", text: "N", at: { x: at.x + w / 2, y: at.y + h }, heightMm: 0.28 * h, bold: true, align: "center" }
      ];
    }
    case "RECT": case "LINE": return shapeParts(item, at);
  }
}

/** En ram på arket som elementen förankras i. */
export interface PaperFrameRef extends PaperTextFrame {
  readonly clip: PaperRect;
}

/**
 * Banans element på ett ark: förankrade i ramen (eller arket, bara för första ramen på arket), variablerna ifyllda för
 * ramens bana. En text som blir tom efter ifyllningen står inte på arket.
 */
export function sheetPaperItems(document: CourseSettingDocument, frame: PaperFrameRef, frameIndex: number,
  options: { readonly page: PaperRect; readonly date?: string | undefined; readonly pageItems?: boolean | undefined;
    /** false = en senare sida av en bana på flera sidor: bara elementen med `pages: "ALL"`. */
    readonly firstPage?: boolean | undefined }): SheetPaperItem[] {
  const out: SheetPaperItem[] = [];
  const partOwn = new Set(frame.part !== undefined ? (ownPartLayout(document, frame.course, frame.part).items ?? []).map(item => item.id) : []);
  for (const { item, source } of effectivePaper(document, frame.course, frame.part).items) {
    if (options.firstPage === false && item.pages !== "ALL") continue;
    if (item.hide) continue;
    // Kartbyten (ADR-0203): "Alla sidor" är alla delar; en senare del har annars bara sina egna element.
    if (frame.part !== undefined && frame.part > 0 && item.pages !== "ALL" && !partOwn.has(item.id)) continue;
    const onPage = item.relativeTo === "PAGE";
    if (onPage && options.pageItems === false) continue;
    const text = item.kind === "TEXT" ? expandPaperText(item.text, document, frame, options.date) : undefined;
    if (item.kind === "TEXT" && text === "") continue;
    const size = paperItemSize(item, text);
    const at = anchorToPaper(item.at, size, onPage ? options.page : frame.clip);
    out.push({ id: item.id, kind: item.kind, course: frame.course, frame: frameIndex, rect: { ...at, ...size }, source, relativeTo: onPage ? "PAGE" : "FRAME",
      ...(item.locked ? { locked: true } : {}),
      parts: paperItemParts(item, at, { ...(text !== undefined ? { text } : {}), printScale: frame.printScale }) });
  }
  return out;
}

// ── Klippningen ─────────────────────────────────────────────────────────────────────────────────────────────────────────

/** Klippningens hörn i ramens mm. */
export function paperClipPoints(clip: PaperClip): { x: number; y: number }[] {
  if (clip.shape === "POLYGON") return clip.points.map(p => ({ x: p.x, y: p.y }));
  const r = clip.rect;
  return [{ x: r.x, y: r.y }, { x: r.x + r.width, y: r.y }, { x: r.x + r.width, y: r.y + r.height }, { x: r.x, y: r.y + r.height }];
}

/** Klippningen som ring i kartans mm för ramen (spegelvänd karta: kring ramens lodräta mittlinje, som kartbilden). */
export function paperClipRing(clip: PaperClip, frame: { readonly clip: PaperRect; readonly transform: { scale: number; translateX: number; translateY: number };
  readonly mapArea: MapRect; readonly mirror?: boolean | undefined }): Point[] {
  const t = frame.transform;
  const axis = (frame.mapArea.minX + frame.mapArea.maxX) / 2;
  return paperClipPoints(clip).map(p => {
    const x = (frame.clip.x + p.x - t.translateX) / t.scale, y = -(frame.clip.y + p.y - t.translateY) / t.scale;
    return { x: frame.mirror ? 2 * axis - x : x, y };
  });
}

/** Specialobjekten som är punktsymboler: står helt eller inte alls (efter sin punkt), klipps aldrig mitt itu. */
export const POINT_MARKINGS: ReadonlySet<string> = new Set(["first-aid", "water", "optional-crossing-point", "forbidden-route", "registration-mark"]);

function inside(point: { x: number; y: number }, polygon: readonly { x: number; y: number }[]): boolean {
  let hit = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i]!, b = polygon[j]!;
    if ((a.y > point.y) !== (b.y > point.y) && point.x < (b.x - a.x) * (point.y - a.y) / (b.y - a.y) + a.x) hit = !hit;
  }
  return hit;
}

/** Markeringarnas klippning på ett ark: polygonen i papperets mm och specialobjekten (id) som ritas klippta till den. */
export interface MarkingClip {
  readonly polygon: readonly { readonly x: number; readonly y: number }[];
  readonly refs: readonly string[];
}

/**
 * Banläggningens markeringar vid klippningen (ägaren 2026-11-03): banans figurer står kvar hela; en punktsymbol (vätska,
 * sjukvård, passage …) vars punkt ligger utanför tas bort; övriga specialobjekt (förbjudet område, gräns, text, bild …)
 * ritas klippta till polygonen (`refs`), så att ett område som delvis ligger innanför syns där. `mirror`: figurerna är
 * redan speglade kring ramens mitt (träningens spegelvända karta).
 */
export function clipMarkings<F extends { readonly role: string; readonly ref?: string | undefined; readonly kind: string }>(document: CourseSettingDocument,
  frame: { readonly clip: PaperRect; readonly transform: { scale: number; translateX: number; translateY: number }; readonly mapArea: MapRect;
    readonly figures: readonly F[] }, clip: PaperClip, mirror = false): { figures: F[]; markingClip: MarkingClip } {
  const polygon = paperClipPoints(clip).map(p => ({ x: frame.clip.x + p.x, y: frame.clip.y + p.y }));
  const t = frame.transform;
  const axis = (frame.mapArea.minX + frame.mapArea.maxX) / 2;
  const specials = new Map(document.specialObjects.map(special => [special.id, special]));
  const dropped = new Set<string>(), clipped = new Set<string>();
  for (const figure of frame.figures) {
    if (figure.role !== "SPECIAL" || figure.ref === undefined || figure.kind === "description") continue;
    const special = specials.get(figure.ref);
    if (special && POINT_MARKINGS.has(special.kind) && special.points[0]) {
      const p = special.points[0];
      const x = mirror ? 2 * axis - p.x : p.x;
      if (!inside({ x: t.scale * x + t.translateX, y: -t.scale * p.y + t.translateY }, polygon)) dropped.add(figure.ref);
    } else clipped.add(figure.ref);
  }
  const figures = frame.figures.filter(figure => !(figure.role === "SPECIAL" && figure.ref !== undefined && dropped.has(figure.ref)));
  return { figures, markingClip: { polygon, refs: [...clipped] } };
}

/** Tonen utanför klippningen (andel mot vitt), som träningens tonade. */
export const PAPER_CLIP_FADE = 0.75;

/** Kartans pass med klippningen: innanför som förut, utanför vitt (inget ritas) eller tonat. */
export function clipMapPasses(passes: readonly TrainingMapPass[] | undefined, ring: readonly Point[], outside: "WHITE" | "FADED"): TrainingMapPass[] {
  const base: readonly TrainingMapPass[] = passes ?? [{ within: [], without: [], filters: [] }];
  const region = [ring];
  const inside = base.map(pass => ({ ...pass, within: [...pass.within, region] }));
  if (outside === "WHITE") return inside;
  return [...inside, ...base.map(pass => ({ ...pass, without: [...pass.without, region],
    lighten: Math.max(pass.lighten ?? 0, PAPER_CLIP_FADE) }))];
}

/** Bilderna (sha256) som banornas papper och mallarna pekar på. */
export function paperImageHashes(document: CourseSettingDocument): string[] {
  const out = new Set<string>();
  const add = (items: readonly PaperItem[] | undefined) => { for (const item of items ?? []) if (item.kind === "IMAGE") out.add(item.image); };
  for (const layout of Object.values(document.event.paperLayouts ?? {})) add(layout.items);
  for (const template of document.event.paperTemplates ?? []) add(template.items);
  return [...out];
}
