/**
 * Papperet ("paper space", ägarens önskan 2026-11-03, ADR-0197): det som står på arket utanför kartbilden och banpåtrycket,
 * per bana. Kartan med banan är "model space" (kartans mm, editorn); här räknas allt i papperets mm relativt kartramen på
 * arket, så att samma inställning gäller i en sida per bana och i en layoutmalls ramar.
 *
 * Här: kontrollbeskrivningen på kartan (av, automatiskt i ett fritt hörn, eller utplacerad i förhandsvisningen) och .ppen.
 * Papperets övriga element (texter, bilder, skalstock, nordpil), klippningen och mallarna står i `paper-items.ts` med samma
 * förankring (`PaperAnchor`): ett hörn av kartramen och avståndet inåt. Ingenting här ritas i editorn.
 *
 * Purple Pens `descriptions`-specialobjekt (kartans mm) tolkas som beskrivningens plats när banan inte har en egen
 * utplacering (`source: "FILE"`), och skrivs tillbaka som specialobjekt i .ppen (`ppenWithPaperLayout`), så att Purple Pen
 * ser samma sak.
 */
import type { Point } from "@o-tid/map-file";
import { layout as layoutDescriptionFigures } from "./description-layout";
import type { DescriptionKind, DescriptionLayout } from "./description-types";
import { anchorToPaper, PAPER_CORNERS, type PaperCorner, type PaperRect } from "./paper-anchor";
import { effectivePaper, paperItemSize, paperTextForPpen, type PaperDescriptions } from "./paper-items";
import { nextId, rawAttribute } from "./ppen-common";
import { newSpecial } from "./ppen-special";
import { specialVisible } from "./specials";
import type { CourseSettingDocument, OverprintPrimitive, SpecialObject } from "./types";

export { anchorToPaper, paperAnchorOf, reanchor, PAPER_CORNERS, type PaperAnchor, type PaperCorner, type PaperRect } from "./paper-anchor";
export {
  paperLayoutOf, validatePaperLayout, PAPER_DESCRIPTION_LIMITS, type CoursePaperLayout, type PaperDescriptions
} from "./paper-items";

/** Förvald rutstorlek (mm på papperet) för en beskrivning som O-Tid placerar. */
export const PAPER_DESCRIPTION_BOX_MM = 5;

/** Kontrollbeskrivningens inställning för banan (banans fält före mallens, `effectivePaper`). */
export function paperDescriptionsOf(document: CourseSettingDocument, course: string, part?: number): PaperDescriptions {
  return effectivePaper(document, course, part).descriptions;
}

/** Purple Pens beskrivning på kartan för banan (specialobjektet ur .ppen), om den finns. */
export function fileDescription(document: CourseSettingDocument, course: string, part?: number): SpecialObject | undefined {
  // Kartbyten (ADR-0203): Purple Pens beskrivning för en del (`<course course part>`) eller för alla delar.
  return document.specialObjects.find(special => special.kind === "descriptions" && specialVisible(special, course, part));
}

/** Om banan får en beskrivning på kartan: inställningen, annars på för banor (och för Alla kontroller bara med filens). */
export function descriptionShown(document: CourseSettingDocument, course: string, part?: number): boolean {
  const show = paperDescriptionsOf(document, course, part).show;
  if (show !== undefined) return show;
  return course !== "ALL_CONTROLS" || fileDescription(document, course) !== undefined;
}

function descriptionKind(document: CourseSettingDocument, course: string): DescriptionKind {
  const raw = course === "ALL_CONTROLS" ? rawAttribute(document.event.raw, "all-controls", "description-kind")
    : rawAttribute(document.courses.find(item => item.id === course)?.raw, "options", "description-kind");
  return raw === "text" ? "TEXT" : raw === "symbols-and-text" ? "SYMBOLS_AND_TEXT" : "SYMBOLS";
}

type Transform = { readonly scale: number; readonly translateX: number; readonly translateY: number };

/** Ramen som beskrivningen läggs i: banan, varianten, kartramen på arket, transformen och banpåtrycket. */
export interface PaperFrame {
  readonly course: string;
  readonly variant?: string | undefined;
  /** Kartbyten (ADR-0203): delen av banan. */
  readonly part?: number | undefined;
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
  /** Kartbyten (ADR-0203): delen av banan. */
  readonly part?: number | undefined;
  /** PLACED = utplacerad i förhandsvisningen, FILE = .ppen-filens, TEMPLATE = layoutmallens, AUTO = ett fritt hörn. */
  readonly source?: "PLACED" | "FILE" | "TEMPLATE" | "AUTO" | undefined;
  readonly corner?: PaperCorner | undefined;
  /** Kontroller, nummer och sträckor som rutan ligger över. */
  readonly overlaps?: number | undefined;
  /** Rutans sida (mm på papperet) och spalterna som den lades ut med. */
  readonly boxMm?: number | undefined;
  readonly columns?: number | undefined;
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
  if (!descriptionShown(document, course, frame.part)) return undefined;
  const settings = paperDescriptionsOf(document, course, frame.part);
  const file = settings.at ? undefined : fileDescription(document, course, frame.part);
  const fileCell = file && file.points.length >= 2 ? Math.hypot(file.points[1]!.x - file.points[0]!.x, file.points[1]!.y - file.points[0]!.y) * frame.transform.scale : undefined;
  const boxMm = settings.boxMm ?? (fileCell && fileCell > 0 ? fileCell : undefined) ?? options.template?.boxMm ?? PAPER_DESCRIPTION_BOX_MM;
  const columns = settings.columns ?? file?.columns ?? 1;
  const described = layoutDescriptionFigures(document, { course, ...(frame.variant ? { variant: frame.variant } : {}), kind: descriptionKind(document, course),
    language: options.language ?? document.event.descriptionLanguage ?? "sv", boxMm, columns, ...(frame.part !== undefined ? { part: frame.part } : {}) });
  const size = { width: described.widthMm, height: described.heightMm };
  const under = (at: { x: number; y: number }) => courseFiguresUnder(frame.figures, frame.transform, { ...at, ...size });
  const base = { layout: described, frame: frameIndex, course, ...(frame.variant ? { variant: frame.variant } : {}), ...(frame.part !== undefined ? { part: frame.part } : {}), boxMm, columns };
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

/** Banans sida för .ppen: ramen och (för element förankrade i arket) arket. */
export type PpenPaperFrame = PaperFrame & { readonly page?: PaperRect | undefined };

/**
 * Dokumentet för .ppen (ADR-0197): varje bana med utplacerad beskrivning får ett Purple Pen-`descriptions`-objekt på
 * motsvarande ställe i kartan (`frameOf` ger banans första sida, som Purple Pen skriver ut den), och en bana med
 * beskrivningen avslagen tas bort ur filens objekt. Papperets texter blir Purple Pens textobjekt (variablerna som makron)
 * och bilderna bildobjekt (när `images` har bildens data) för banan. En bana med automatisk plats och utan beskrivning i filen
 * får också ett `descriptions`-objekt där O-Tid lägger den (`withoutAutomaticDescriptions` känner igen det vid inläsning). Skalstock, nordpil, täckning och klippning har ingen
 * motsvarighet och stannar i O-Tid. Banor utan egen inställning behåller filens objekt orört.
 */
export function ppenWithPaperLayout(document: CourseSettingDocument, frameOf: (course: string) => PpenPaperFrame | undefined,
  options: { readonly images?: ReadonlyMap<string, string> | undefined } = {}): CourseSettingDocument {
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
  const add = (input: Parameters<typeof newSpecial>[1]) => { specials.push(newSpecial(nextId(specials.map(special => special.id)), input)); };
  for (const course of ["ALL_CONTROLS", ...document.courses.map(item => item.id)]) {
    const id = course === "ALL_CONTROLS" ? "0" : course;
    const effective = effectivePaper(document, course);
    const settings = effective.descriptions;
    const items = effective.items.filter(row => row.item.kind === "TEXT" || (row.item.kind === "IMAGE" && options.images?.has(row.item.image)));
    if (settings.show === false) detach(id);
    // Automatisk plats (samordnaren 2026-11-03): en bana utan beskrivning i filen får den där O-Tid visar den, så att Purple
    // Pen skriver ut samma sak. En bana med filens beskrivning behåller den.
    const automatic = descriptionShown(document, course) && !settings.at && !fileDescription(document, course);
    if (!settings.at && !automatic && items.length === 0) continue;
    const frame = frameOf(course);
    if (!frame) continue;
    if (settings.show !== false && (settings.at || automatic)) {
      const placed = placeDescription(document, frame, 0);
      if (placed) {
        const cell = (settings.boxMm ?? PAPER_DESCRIPTION_BOX_MM) / frame.transform.scale;
        const topLeft = fromPaper(frame.transform, placed);
        detach(id);
        add({ kind: "descriptions", courses: [id], points: [topLeft, { x: topLeft.x + cell, y: topLeft.y }],
          ...((settings.columns ?? 1) > 1 ? { columns: settings.columns } : {}) });
      }
    }
    for (const { item } of items) {
      const text = item.kind === "TEXT" ? paperTextForPpen(item.text, document) : undefined;
      const size = paperItemSize(item);
      const at = anchorToPaper(item.at, size, item.relativeTo === "PAGE" && frame.page ? frame.page : frame.clip);
      const corners = [fromPaper(frame.transform, at), fromPaper(frame.transform, { x: at.x + size.width, y: at.y + size.height })];
      if (item.kind === "TEXT") {
        add({ kind: "text", courses: [id], points: corners, text: text!, color: "black",
          font: { name: "Arial", bold: item.bold === true, italic: false, height: item.sizeMm / frame.transform.scale } });
      } else if (item.kind === "IMAGE") {
        add({ kind: "image", courses: [id], points: corners, image: { format: item.mediaType === "image/png" ? "png" : "jpeg", data: options.images!.get(item.image)! } });
      }
    }
  }
  // Inget ändrat: dokumentet som det är (filen skrivs som den lästes).
  if (specials.length === document.specialObjects.length && specials.every((special, index) => special === document.specialObjects[index])) return document;
  return { ...document, specialObjects: specials };
}

/**
 * En ny .ppen läses in i en banläggning som redan har ett papper (ADR-0197): papperet och mallarna följer med (de står inte i
 * Purple Pens fil), och textobjekt och bildobjekt som O-Tid själv skrev ut för papperets texter och bilder (samma text,
 * respektive samma bild, för samma enda bana) tas bort ur filen så att de inte står två gånger. `imageHash` ger bildobjektets
 * sha256 (räknas av den som läser in filen).
 */
export function keepPaperOnImport(current: CourseSettingDocument, imported: CourseSettingDocument,
  imageHash: (special: SpecialObject) => string | undefined = () => undefined,
  frameOf?: (document: CourseSettingDocument, course: string) => PaperFrame | undefined): CourseSettingDocument {
  const layouts = current.event.paperLayouts ?? {};
  const kept: Record<string, NonNullable<CourseSettingDocument["event"]["paperLayouts"]>[string]> = {};
  for (const [course, layout] of Object.entries(layouts)) {
    if (course === "ALL_CONTROLS" || imported.courses.some(item => item.id === course)) kept[course] = layout;
  }
  const event = { ...imported.event,
    ...(Object.keys(kept).length > 0 ? { paperLayouts: kept } : {}),
    ...(current.event.paperTemplates ? { paperTemplates: current.event.paperTemplates } : {}),
    ...(current.event.paperValues ? { paperValues: current.event.paperValues } : {}),
    // ADR-0217: layouterna, arken för banor som finns kvar, klassernas val och lägena står bara i O-Tid.
    ...layoutFieldsOnImport(current, imported) };
  const ours = (special: SpecialObject): boolean => {
    if ((special.kind !== "text" && special.kind !== "image") || special.courses.length !== 1) return false;
    const id = special.courses[0]!;
    const course = id === "0" ? "ALL_CONTROLS" : id;
    if (!kept[course]) return false;
    return effectivePaper(current, course).items.some(({ item }) => special.kind === "text"
      ? item.kind === "TEXT" && paperTextForPpen(item.text, current) === special.text
      : item.kind === "IMAGE" && imageHash(special) === item.image);
  };
  const kept1: CourseSettingDocument = { ...imported, event, specialObjects: imported.specialObjects.filter(special => !ours(special)) };
  return frameOf ? withoutAutomaticDescriptions(kept1, frameOf) : kept1;
}

/**
 * En beskrivning i filen som står exakt där O-Tid själv skulle lägga den automatiskt (O-Tid skrev den så, `ppenWithPaperLayout`)
 * tas bort ur filens objekt, så att banan fortsätter med automatisk plats i stället för att få en fast (samordnaren 2026-11-03).
 * Bara objekt för en enda bana med en spalt och rutan som banan har; 0,05 mm räcker (talen i filen har avrundats).
 */
export function withoutAutomaticDescriptions(document: CourseSettingDocument, frameOf: (document: CourseSettingDocument, course: string) => PaperFrame | undefined)
  : CourseSettingDocument {
  let out = document;
  for (const special of document.specialObjects) {
    if (special.kind !== "descriptions" || special.courses.length !== 1 || special.points.length < 2) continue;
    const id = special.courses[0]!;
    const course = id === "0" ? "ALL_CONTROLS" : id;
    if (course !== "ALL_CONTROLS" && !document.courses.some(item => item.id === course)) continue;
    const settings = paperDescriptionsOf(out, course);
    if (settings.at || settings.show === false || (special.columns ?? 1) !== (settings.columns ?? 1)) continue;
    const without: CourseSettingDocument = { ...out, specialObjects: out.specialObjects.filter(item => item.id !== special.id) };
    // Alla kontroller har bara beskrivning när filen har en, om den inte satts på i O-Tid: då står filens kvar.
    if (course === "ALL_CONTROLS" && settings.show !== true) continue;
    const probe = without;
    let frame: PaperFrame | undefined;
    try { frame = frameOf(probe, course); } catch { frame = undefined; }
    if (!frame) continue;
    const auto = placeDescription(probe, frame, 0);
    if (!auto || auto.source !== "AUTO") continue;
    const topLeft = fromPaper(frame.transform, auto);
    const cell = (settings.boxMm ?? PAPER_DESCRIPTION_BOX_MM) / frame.transform.scale;
    const fileCell = Math.hypot(special.points[1]!.x - special.points[0]!.x, special.points[1]!.y - special.points[0]!.y);
    const near = (a: number, b: number) => Math.abs(a - b) <= 0.05;
    if (near(topLeft.x, special.points[0]!.x) && near(topLeft.y, special.points[0]!.y) && near(cell, fileCell)) out = without;
  }
  return out;
}

/** Layout-flikens fält (ADR-0217) som följer med en ny banfil: arken bara för banor som finns kvar. */
function layoutFieldsOnImport(current: CourseSettingDocument, imported: CourseSettingDocument): Partial<CourseSettingDocument["event"]> {
  const event = current.event;
  const courses = new Set(["ALL_CONTROLS", ...imported.courses.map(course => course.id)]);
  const sheets = Object.fromEntries(Object.entries(event.layoutSheets ?? {}).map(([layout, byCourse]) =>
    [layout, Object.fromEntries(Object.entries(byCourse).filter(([course]) => courses.has(course)))] as const).filter(([, byCourse]) => Object.keys(byCourse).length > 0));
  return { ...(event.layouts ? { layouts: event.layouts } : {}), ...(Object.keys(sheets).length > 0 ? { layoutSheets: sheets } : {}),
    ...(event.classLayouts ? { classLayouts: event.classLayouts } : {}), ...(event.mainLayout ? { mainLayout: event.mainLayout } : {}),
    ...(event.layoutStates ? { layoutStates: event.layoutStates } : {}) };
}
