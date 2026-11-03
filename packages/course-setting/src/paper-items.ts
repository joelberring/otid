/**
 * Papperet, steg 2 (ADR-0197): det som står på arket utöver kartan och banan – texter med variabler, bilder (logotyper),
 * skalstock och nordpil – och klippningen av kartan i ramen. Allt i papperets mm, förankrat i ett hörn av kartramen eller
 * arket (`paper-anchor.ts`), per bana i `event.paperLayouts` och i namngivna mallar (`event.paperTemplates`) som banorna
 * ärver av. Ingenting här ritas i editorn ("model space"); förhandsvisningen och PDF:en ritar samma delar (`PaperPart`).
 */
import type { Point } from "@o-tid/map-file";
import { anchorToPaper, PAPER_CORNERS, type PaperAnchor, type PaperRect } from "./paper-anchor";
import type { TrainingMapPass } from "./training-types";
import type { CourseSettingDocument, MapRect } from "./types";
import { CourseSettingEditError } from "./types";
import { measuredLengthMeters, variations } from "./walk";

export type PaperAlign = "left" | "center" | "right";

interface PaperItemBase {
  /** Elementets id (unikt i banan och mallen; en banas element med en malls id ersätter mallens). */
  readonly id: string;
  readonly at: PaperAnchor;
  /** PAGE = förankrat i arkets hörn i stället för kartramens. */
  readonly relativeTo?: "PAGE" | undefined;
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

export type PaperItem = PaperText | PaperImage | PaperScaleBar | PaperNorthArrow;
export type PaperItemKind = PaperItem["kind"];

/**
 * Klippningen av kartan i ramen: en rektangel eller en polygon i ramens mm (origo i ramens övre vänstra hörn). Utanför är
 * papperet vitt eller kartan tonad. Banan klipps inte.
 */
export type PaperClip =
  | { readonly shape: "RECT"; readonly rect: PaperRect; readonly outside: "WHITE" | "FADED" }
  | { readonly shape: "POLYGON"; readonly points: readonly { readonly x: number; readonly y: number }[]; readonly outside: "WHITE" | "FADED" };

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
}

/** En namngiven mall för papperet ("Klubbens träningsmall"): element, klippning och beskrivningens inställning. */
export interface PaperTemplate {
  readonly schemaVersion: 1;
  readonly id: string;
  readonly name: string;
  readonly items: readonly PaperItem[];
  readonly clip?: PaperClip | undefined;
  readonly descriptions?: PaperDescriptions | undefined;
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
  const base = { id: item.id, at: validAnchor(item.at, "elementet"), ...(item.relativeTo === "PAGE" ? { relativeTo: "PAGE" as const } : {}) };
  if (item.relativeTo !== undefined && item.relativeTo !== "PAGE") throw invalid("vad elementet står i förhållande till");
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
    default: throw invalid("okänt slags element");
  }
}

export function validatePaperClip(value: unknown): PaperClip {
  const clip = value as PaperClip | undefined;
  if (!clip || typeof clip !== "object") throw invalid("klippningen");
  if (clip.outside !== "WHITE" && clip.outside !== "FADED") throw invalid("utanför klippningen (vitt eller tonat)");
  const point = (p: { x: number; y: number } | undefined) => {
    if (!p || !within(p.x, -2000, 2000) || !within(p.y, -2000, 2000)) throw invalid("klippningens hörn");
    return { x: p.x, y: p.y };
  };
  if (clip.shape === "RECT") {
    const r = clip.rect;
    if (!r || !within(r.width, 1, 2000) || !within(r.height, 1, 2000)) throw invalid("klippningens rektangel");
    const corner = point({ x: r.x, y: r.y });
    return { shape: "RECT", rect: { ...corner, width: r.width, height: r.height }, outside: clip.outside };
  }
  if (clip.shape === "POLYGON") {
    if (!Array.isArray(clip.points) || clip.points.length < 3 || clip.points.length > PAPER_LIMITS.polygonPoints) throw invalid(`klippningens polygon (3–${PAPER_LIMITS.polygonPoints} hörn)`);
    return { shape: "POLYGON", points: clip.points.map(point), outside: clip.outside };
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
    ...(descriptions && Object.keys(descriptions).length > 0 ? { descriptions } : {}) };
}

/** Banans papper (tomt om inget är inställt). */
export function paperLayoutOf(document: CourseSettingDocument, course: string): CoursePaperLayout {
  return document.event.paperLayouts?.[course] ?? {};
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
}

/**
 * Det som gäller för banan: mallens element (utom de dolda, och med banans ändringar), sedan banans egna; banans klippning
 * annars mallens; beskrivningens inställning fält för fält, banans före mallens.
 */
export function effectivePaper(document: CourseSettingDocument, course: string): EffectivePaper {
  const layout = paperLayoutOf(document, course);
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
  return { ...(template ? { template } : {}), items, ...(clip ? { clip, clipSource } : {}), descriptions };
}

/**
 * Banans papper efter att ett element ändrats (ny, flyttad, ändrad): ett mallelement blir en ändring för banan, ett eget
 * ersätts. `null` = elementet tas bort (ett mallelement döljs för banan).
 */
export function withPaperItem(document: CourseSettingDocument, course: string, id: string, item: PaperItem | null): CoursePaperLayout {
  const layout = paperLayoutOf(document, course);
  const template = paperTemplateOf(document, layout.template);
  const fromTemplate = template?.items.some(row => row.id === id) ?? false;
  const own = (layout.items ?? []).filter(row => row.id !== id);
  const items = item ? (layout.items ?? []).some(row => row.id === id) ? (layout.items ?? []).map(row => row.id === id ? item : row) : [...own, item] : own;
  const hidden = item === null && fromTemplate ? [...new Set([...(layout.hidden ?? []), id])] : layout.hidden ?? [];
  return { ...layout, items, hidden };
}

/** Banans ändring av ett mallelement tas bort (mallens gäller igen). */
export function resetPaperItem(document: CourseSettingDocument, course: string, id: string): CoursePaperLayout {
  const layout = paperLayoutOf(document, course);
  return { ...layout, items: (layout.items ?? []).filter(row => row.id !== id), hidden: (layout.hidden ?? []).filter(row => row !== id) };
}

/** En mall av det som gäller för banan nu (element, klippning och beskrivningens plats). */
export function paperTemplateFromCourse(document: CourseSettingDocument, course: string, id: string, name: string): PaperTemplate {
  const effective = effectivePaper(document, course);
  const descriptions = effective.descriptions;
  return validatePaperTemplate({ schemaVersion: 1, id, name, items: effective.items.map(row => row.item),
    ...(effective.clip ? { clip: effective.clip } : {}), ...(Object.keys(descriptions).length > 0 ? { descriptions } : {}) });
}

/** Banans papper när mallen används: mallen och beskrivningen ur mallen; banans egna element står kvar, ändringar av mallens tas bort. */
export function applyPaperTemplate(document: CourseSettingDocument, course: string, template: PaperTemplate | undefined): CoursePaperLayout {
  const layout = paperLayoutOf(document, course);
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
export function newPaperItemId(document: CourseSettingDocument, course: string): string {
  const used = new Set([...effectivePaper(document, course).items.map(row => row.item.id), ...(paperLayoutOf(document, course).hidden ?? [])]);
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
    if (PPEN_MACROS[name]) return PPEN_MACROS[name]!;
    if (name === "datum") return document.event.paperValues?.date ?? "";
    if (name === "ekvidistans") return document.event.paperValues?.contourInterval ?? "";
    return whole;
  });
}

// ── Elementen på arket ──────────────────────────────────────────────────────────────────────────────────────────────────

/** Delarna som förhandsvisningen (SVG) och PDF:en ritar, i papperets mm (y nedåt). Svart och vitt; bilden med täckning. */
export type PaperPart =
  | { readonly kind: "rect"; readonly x: number; readonly y: number; readonly width: number; readonly height: number;
      readonly fill?: "WHITE" | "BLACK" | undefined; readonly stroke?: number | undefined }
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
  options: { readonly page: PaperRect; readonly date?: string | undefined; readonly pageItems?: boolean | undefined }): SheetPaperItem[] {
  const out: SheetPaperItem[] = [];
  for (const { item, source } of effectivePaper(document, frame.course).items) {
    const onPage = item.relativeTo === "PAGE";
    if (onPage && options.pageItems === false) continue;
    const text = item.kind === "TEXT" ? expandPaperText(item.text, document, frame, options.date) : undefined;
    if (item.kind === "TEXT" && text === "") continue;
    const size = paperItemSize(item, text);
    const at = anchorToPaper(item.at, size, onPage ? options.page : frame.clip);
    out.push({ id: item.id, kind: item.kind, course: frame.course, frame: frameIndex, rect: { ...at, ...size }, source, relativeTo: onPage ? "PAGE" : "FRAME",
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
