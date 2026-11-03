/**
 * Papperet ("paper space", ägarens önskan 2026-11-03): det som står på arket utanför kartbilden och banpåtrycket, per bana.
 * Kartan med banan är "model space" (kartans mm, editorn); här räknas allt i papperets mm relativt kartramen på arket, så
 * att samma inställning gäller i en sida per bana och i en layoutmalls ramar.
 *
 * Nu: kontrollbeskrivningen på kartan (av, automatiskt i ett fritt hörn, eller utplacerad i förhandsvisningen). Senare
 * element (text, bild/logotyp, teckenförklaring, skalstock, utsnitt) får egna fält i `CoursePaperLayout` med samma
 * förankring (`PaperAnchor`): ett hörn av kartramen och avståndet inåt. Ingenting här ritas i editorn.
 *
 * Purple Pens `descriptions`-specialobjekt (kartans mm) tolkas som beskrivningens plats när banan inte har en egen
 * utplacering (`source: "FILE"`), och skrivs tillbaka som specialobjekt i .ppen (`ppenWithPaperLayout`), så att Purple Pen
 * ser samma sak.
 */
import type { Point } from "@o-tid/map-file";
import { layout as layoutDescriptionFigures } from "./description-layout";
import type { DescriptionKind, DescriptionLayout } from "./description-types";
import { nextId, rawAttribute } from "./ppen-common";
import { newSpecial } from "./ppen-special";
import type { CourseSettingDocument, OverprintPrimitive, SpecialObject } from "./types";
import { CourseSettingEditError } from "./types";

export type PaperCorner = "TOP_LEFT" | "TOP_RIGHT" | "BOTTOM_LEFT" | "BOTTOM_RIGHT";
export const PAPER_CORNERS: readonly PaperCorner[] = ["TOP_LEFT", "TOP_RIGHT", "BOTTOM_LEFT", "BOTTOM_RIGHT"];

/** En plats på papperet: avståndet (mm, inåt positivt) från ett hörn av kartramen till elementets motsvarande hörn. */
export interface PaperAnchor {
  readonly corner: PaperCorner;
  readonly x: number;
  readonly y: number;
}

/** Kontrollbeskrivningen på kartan. Saknas `at` placeras den automatiskt (eller där .ppen-filen har den). */
export interface PaperDescriptions {
  /** false = ingen beskrivning på kartan; saknas = på för banor, av för Alla kontroller. */
  readonly show?: boolean | undefined;
  readonly at?: PaperAnchor | undefined;
  /** Rutans sida i mm på papperet; saknas = filens eller 5 mm. */
  readonly boxMm?: number | undefined;
  /** Spalter (1–4); saknas = filens eller 1. */
  readonly columns?: number | undefined;
}

/** Papperet för en bana (eller "ALL_CONTROLS"). Nya element läggs till som fält här. */
export interface CoursePaperLayout {
  readonly descriptions?: PaperDescriptions | undefined;
}

/** Förvald rutstorlek (mm på papperet) för en beskrivning som O-Tid placerar. */
export const PAPER_DESCRIPTION_BOX_MM = 5;
export const PAPER_DESCRIPTION_LIMITS = { minBoxMm: 3, maxBoxMm: 10, maxColumns: 4 } as const;

const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
const invalid = (message: string) => new CourseSettingEditError("INVALID", `Papperet: ${message}`);

/** Kontrollerar och rensar en banas papper (okända fält tas bort). */
export function validatePaperLayout(value: CoursePaperLayout): CoursePaperLayout {
  if (typeof value !== "object" || value === null) throw invalid("ingen inställning");
  const descriptions = value.descriptions;
  if (descriptions === undefined) return {};
  if (typeof descriptions !== "object" || descriptions === null) throw invalid("beskrivningen");
  const out: { -readonly [K in keyof PaperDescriptions]: PaperDescriptions[K] } = {};
  if (descriptions.show !== undefined) {
    if (typeof descriptions.show !== "boolean") throw invalid("på eller av");
    out.show = descriptions.show;
  }
  if (descriptions.at !== undefined) {
    const at = descriptions.at;
    if (!PAPER_CORNERS.includes(at.corner) || !finite(at.x) || !finite(at.y) || Math.abs(at.x) > 2000 || Math.abs(at.y) > 2000) throw invalid("platsen");
    out.at = { corner: at.corner, x: at.x, y: at.y };
  }
  if (descriptions.boxMm !== undefined) {
    if (!finite(descriptions.boxMm) || descriptions.boxMm < PAPER_DESCRIPTION_LIMITS.minBoxMm || descriptions.boxMm > PAPER_DESCRIPTION_LIMITS.maxBoxMm) {
      throw invalid("rutans storlek");
    }
    out.boxMm = descriptions.boxMm;
  }
  if (descriptions.columns !== undefined) {
    if (!Number.isInteger(descriptions.columns) || descriptions.columns < 1 || descriptions.columns > PAPER_DESCRIPTION_LIMITS.maxColumns) throw invalid("spalterna");
    out.columns = descriptions.columns;
  }
  return { descriptions: out };
}

/** Banans papper (tomt om inget är inställt). */
export function paperLayoutOf(document: CourseSettingDocument, course: string): CoursePaperLayout {
  return document.event.paperLayouts?.[course] ?? {};
}

/** Purple Pens beskrivning på kartan för banan (specialobjektet ur .ppen), om den finns. */
export function fileDescription(document: CourseSettingDocument, course: string): SpecialObject | undefined {
  const id = course === "ALL_CONTROLS" ? "0" : course;
  return document.specialObjects.find(special => special.kind === "descriptions" && (special.courses.length === 0 || special.courses.includes(id)));
}

/** Om banan får en beskrivning på kartan: inställningen, annars på för banor (och för Alla kontroller bara med filens). */
export function descriptionShown(document: CourseSettingDocument, course: string): boolean {
  const show = paperLayoutOf(document, course).descriptions?.show;
  if (show !== undefined) return show;
  return course !== "ALL_CONTROLS" || fileDescription(document, course) !== undefined;
}

function descriptionKind(document: CourseSettingDocument, course: string): DescriptionKind {
  const raw = course === "ALL_CONTROLS" ? rawAttribute(document.event.raw, "all-controls", "description-kind")
    : rawAttribute(document.courses.find(item => item.id === course)?.raw, "options", "description-kind");
  return raw === "text" ? "TEXT" : raw === "symbols-and-text" ? "SYMBOLS_AND_TEXT" : "SYMBOLS";
}

export interface PaperRect { readonly x: number; readonly y: number; readonly width: number; readonly height: number }
type Transform = { readonly scale: number; readonly translateX: number; readonly translateY: number };

/** Ramen som beskrivningen läggs i: banan, varianten, kartramen på arket, transformen och banpåtrycket. */
export interface PaperFrame {
  readonly course: string;
  readonly variant?: string | undefined;
  readonly clip: PaperRect;
  readonly transform: Transform;
  readonly figures: readonly OverprintPrimitive[];
}

/** Beskrivningen på ett ark: övre vänstra hörnet i papperets mm, var den kom ifrån och hur många banfigurer den täcker. */
export interface SheetDescription {
  readonly x: number;
  readonly y: number;
  readonly layout: DescriptionLayout;
  readonly frame: number;
  readonly course?: string | undefined;
  readonly variant?: string | undefined;
  /** PLACED = utplacerad i förhandsvisningen, FILE = .ppen-filens, TEMPLATE = layoutmallens, AUTO = ett fritt hörn. */
  readonly source?: "PLACED" | "FILE" | "TEMPLATE" | "AUTO" | undefined;
  readonly corner?: PaperCorner | undefined;
  /** Kontroller, nummer och sträckor som rutan ligger över. */
  readonly overlaps?: number | undefined;
}

/** Elementets övre vänstra hörn på papperet ur förankringen. */
export function anchorToPaper(anchor: PaperAnchor, size: { width: number; height: number }, clip: PaperRect): { x: number; y: number } {
  const right = anchor.corner === "TOP_RIGHT" || anchor.corner === "BOTTOM_RIGHT";
  const bottom = anchor.corner === "BOTTOM_LEFT" || anchor.corner === "BOTTOM_RIGHT";
  return { x: right ? clip.x + clip.width - anchor.x - size.width : clip.x + anchor.x, y: bottom ? clip.y + clip.height - anchor.y - size.height : clip.y + anchor.y };
}

/** Förankringen för ett element på papperet: närmaste hörn av kartramen (efter elementets mitt). */
export function paperAnchorOf(rect: PaperRect, clip: PaperRect): PaperAnchor {
  const right = rect.x + rect.width / 2 > clip.x + clip.width / 2;
  const bottom = rect.y + rect.height / 2 > clip.y + clip.height / 2;
  const corner: PaperCorner = bottom ? (right ? "BOTTOM_RIGHT" : "BOTTOM_LEFT") : right ? "TOP_RIGHT" : "TOP_LEFT";
  const round = (value: number) => Math.round(value * 10) / 10;
  return { corner, x: round(right ? clip.x + clip.width - rect.x - rect.width : rect.x - clip.x),
    y: round(bottom ? clip.y + clip.height - rect.y - rect.height : rect.y - clip.y) };
}

const toPaper = (t: Transform, p: Point) => ({ x: t.scale * p.x + t.translateX, y: -t.scale * p.y + t.translateY });
const fromPaper = (t: Transform, p: { x: number; y: number }): Point => ({ x: (p.x - t.translateX) / t.scale, y: -(p.y - t.translateY) / t.scale });

const COURSE_ROLES = new Set(["START", "CONTROL", "FINISH", "CROSSING_POINT", "MAP_EXCHANGE", "NUMBER", "LEG", "FLAGGING"]);

function segmentHitsRect(a: { x: number; y: number }, b: { x: number; y: number }, r: PaperRect): boolean {
  // Liang–Barsky: delen av sträckan som ligger i rutan.
  let t0 = 0, t1 = 1;
  const dx = b.x - a.x, dy = b.y - a.y;
  const edges: [number, number][] = [[-dx, a.x - r.x], [dx, r.x + r.width - a.x], [-dy, a.y - r.y], [dy, r.y + r.height - a.y]];
  for (const [p, q] of edges) {
    if (p === 0) { if (q < 0) return false; continue; }
    const t = q / p;
    if (p < 0) { if (t > t1) return false; if (t > t0) t0 = t; } else { if (t < t0) return false; if (t < t1) t1 = t; }
  }
  return true;
}

const grow = (r: PaperRect, by: number): PaperRect => ({ x: r.x - by, y: r.y - by, width: r.width + 2 * by, height: r.height + 2 * by });

/** Hur många av banans figurer (kontroller, nummer, sträckor) som rutan på papperet ligger över. */
export function courseFiguresUnder(figures: readonly OverprintPrimitive[], transform: Transform, box: PaperRect): number {
  let count = 0;
  for (const figure of figures) {
    if (!COURSE_ROLES.has(figure.role)) continue;
    let hit = false;
    switch (figure.kind) {
      case "circle": {
        const c = toPaper(transform, figure.center), radius = (figure.diameter + figure.lineWidth) / 2 * transform.scale;
        const nx = Math.max(box.x, Math.min(c.x, box.x + box.width)), ny = Math.max(box.y, Math.min(c.y, box.y + box.height));
        hit = Math.hypot(c.x - nx, c.y - ny) <= radius;
        break;
      }
      case "polyline": {
        const points = figure.points.map(p => toPaper(transform, p));
        const wide = grow(box, figure.width * transform.scale / 2);
        for (let i = 0; i + 1 < points.length && !hit; i++) hit = segmentHitsRect(points[i]!, points[i + 1]!, wide);
        if (points.length === 1) hit = segmentHitsRect(points[0]!, points[0]!, wide);
        break;
      }
      case "polygon": {
        const points = figure.rings.flat().map(p => toPaper(transform, p));
        if (points.length === 0) break;
        const xs = points.map(p => p.x), ys = points.map(p => p.y);
        hit = Math.min(...xs) <= box.x + box.width && Math.max(...xs) >= box.x && Math.min(...ys) <= box.y + box.height && Math.max(...ys) >= box.y;
        break;
      }
      case "text": {
        const c = toPaper(transform, figure.at), h = figure.heightMm * transform.scale, w = h * Math.max(1, figure.text.length) * 0.6;
        const x = figure.align === "left" ? c.x : c.x - w / 2;
        hit = x <= box.x + box.width && x + w >= box.x && c.y - h / 2 <= box.y + box.height && c.y + h / 2 >= box.y;
        break;
      }
      default: break;
    }
    if (hit) count += 1;
  }
  return count;
}

/** Hur långt in från ramens kant en automatiskt placerad beskrivning ligger (mm). */
const AUTO_INSET_MM = 0;

/**
 * Beskrivningen i en kartram (eller ingen): banans utplacering, annars .ppen-filens, annars layoutmallens, annars det hörn
 * av ramen där den täcker minst av banan (övre vänstra först, som Purple Pen). Innehållet gäller ramens bana och variant.
 */
export function placeDescription(document: CourseSettingDocument, frame: PaperFrame, frameIndex: number,
  options: { readonly language?: string | undefined; readonly template?: { readonly x: number; readonly y: number; readonly boxMm: number } | undefined } = {}
): SheetDescription | undefined {
  const course = frame.course;
  if (!descriptionShown(document, course)) return undefined;
  const settings = paperLayoutOf(document, course).descriptions ?? {};
  const file = settings.at ? undefined : fileDescription(document, course);
  const fileCell = file && file.points.length >= 2 ? Math.hypot(file.points[1]!.x - file.points[0]!.x, file.points[1]!.y - file.points[0]!.y) * frame.transform.scale : undefined;
  const boxMm = settings.boxMm ?? (fileCell && fileCell > 0 ? fileCell : undefined) ?? options.template?.boxMm ?? PAPER_DESCRIPTION_BOX_MM;
  const columns = settings.columns ?? file?.columns ?? 1;
  const described = layoutDescriptionFigures(document, { course, ...(frame.variant ? { variant: frame.variant } : {}), kind: descriptionKind(document, course),
    language: options.language ?? document.event.descriptionLanguage ?? "sv", boxMm, columns });
  const size = { width: described.widthMm, height: described.heightMm };
  const under = (at: { x: number; y: number }) => courseFiguresUnder(frame.figures, frame.transform, { ...at, ...size });
  const base = { layout: described, frame: frameIndex, course, ...(frame.variant ? { variant: frame.variant } : {}) };
  if (settings.at) {
    const at = anchorToPaper(settings.at, size, frame.clip);
    return { ...base, ...at, source: "PLACED", corner: settings.at.corner, overlaps: under(at) };
  }
  if (file) {
    const at = toPaper(frame.transform, file.points[0]!);
    return { ...base, ...at, source: "FILE", overlaps: under(at) };
  }
  if (options.template) {
    const at = { x: options.template.x, y: options.template.y };
    return { ...base, ...at, source: "TEMPLATE", overlaps: under(at) };
  }
  let best: { corner: PaperCorner; at: { x: number; y: number }; overlaps: number } | undefined;
  for (const corner of PAPER_CORNERS) {
    const at = anchorToPaper({ corner, x: AUTO_INSET_MM, y: AUTO_INSET_MM }, size, frame.clip);
    const overlaps = under(at);
    if (!best || overlaps < best.overlaps) best = { corner, at, overlaps };
    if (overlaps === 0) break;
  }
  return { ...base, ...best!.at, source: "AUTO", corner: best!.corner, overlaps: best!.overlaps };
}

/**
 * Dokumentet för .ppen: varje bana med egen utplacering får ett Purple Pen-`descriptions`-objekt på motsvarande ställe i
 * kartan (`frameOf` ger banans sida, som Purple Pen skriver ut den), och en bana med beskrivningen avslagen tas bort ur
 * filens objekt. Banor utan egen inställning behåller filens objekt orört.
 */
export function ppenWithPaperLayout(document: CourseSettingDocument, frameOf: (course: string) => PaperFrame | undefined): CourseSettingDocument {
  const layouts = document.event.paperLayouts;
  if (!layouts || Object.keys(layouts).length === 0) return document;
  const allIds = ["0", ...document.courses.map(course => course.id)];
  let specials = [...document.specialObjects];
  const detach = (id: string) => {
    specials = specials.flatMap(special => {
      if (special.kind !== "descriptions") return [special];
      const covers = special.courses.length === 0 ? allIds : special.courses;
      if (!covers.includes(id)) return [special];
      const rest = covers.filter(item => item !== id);
      return rest.length === 0 ? [] : [{ ...special, courses: rest }];
    });
  };
  for (const [course, layout] of Object.entries(layouts)) {
    const id = course === "ALL_CONTROLS" ? "0" : course;
    if (id !== "0" && !document.courses.some(item => item.id === id)) continue;
    const settings = layout.descriptions;
    if (!settings) continue;
    if (settings.show === false) { detach(id); continue; }
    if (!settings.at) continue;
    const frame = frameOf(course);
    if (!frame) continue;
    const placed = placeDescription(document, frame, 0);
    if (!placed) continue;
    const cell = (settings.boxMm ?? PAPER_DESCRIPTION_BOX_MM) / frame.transform.scale;
    const topLeft = fromPaper(frame.transform, placed);
    detach(id);
    specials.push(newSpecial(nextId(specials.map(special => special.id)), { kind: "descriptions", courses: [id],
      points: [topLeft, { x: topLeft.x + cell, y: topLeft.y }], ...((settings.columns ?? 1) > 1 ? { columns: settings.columns } : {}) }));
  }
  return { ...document, specialObjects: specials };
}
