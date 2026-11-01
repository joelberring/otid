/**
 * Steg 64: specialobjekten som figurer i kartans mm. Formerna, måtten och färgerna (övre/undre lila) följer Purple Pens
 * CourseObject.cs (FirstAidCourseObj, WaterCourseObj, CrossingCourseObj, ForbiddenCourseObj, RegMarkCourseObj,
 * BoundaryCourseObj, OOBCourseObj, DangerousCourseObj, TempConstructionCourseObj, WhiteOutCourseObj, BasicTextCourseObj,
 * LineSpecialCourseObj, RectSpecialCourseObj, ImageCourseObj, DescriptionCourseObj) och CourseFormatter.ExpandText (BSD,
 * Peter Golde). Måtten är ISOM 2017-2 och ISSprOM 2019-2 (IOF; omapwiki.orienteering.sport, symbolerna 707–714, 717):
 * förbjudet område och farligt område (709, 710) som korsraster 0,2 mm med 1,2 mm mellan linjerna (ändrat 2022, tidigare
 * 0,25/0,8), gräns 0,7 mm (ISSprOM 1,0 mm), tillfällig konstruktion 50 % lila med kant 0,1 mm, förbjuden väg som kryss
 * 0,35 mm, första hjälpen och vatten enligt ISOM 2017. Punktobjekten och rastren skalas med utskriftsskalan som
 * banpåtrycket; text, linje, rektangel, ellips, bild och beskrivning är i kartans mm (som Purple Pen).
 */
import type { Point } from "@o-tid/map-file";
import { appearanceOf, type Sizes } from "./appearance";
import { layout as layoutDescriptionFigures } from "./description-layout";
import type { DescriptionKind } from "./description-types";
import { distance, place } from "./geometry";
import { rawAttribute } from "./ppen-common";
import { specialImage } from "./ppen-special";
import { ellipsePoints, hatchLines, offsetLine, rectOf, roundedRectPoints, symPath } from "./special-shapes";
import type { CourseSettingDocument, OverprintColor, OverprintPrimitive, SpecialLine, SpecialObject } from "./types";
import { measuredLengthMeters, variations } from "./walk";

type Paint = { color: OverprintColor; cmyk?: readonly [number, number, number, number] };

/** Purple Pens SpecialColor till färgroll. */
export function specialPaint(color: string | undefined): Paint {
  if (color === undefined || color === "purple") return { color: "COURSE" };
  if (color === "lower-purple") return { color: "COURSE_LOWER" };
  if (color === "black") return { color: "BLACK" };
  const parts = color.split(",").map(Number);
  if (parts.length === 4 && parts.every(value => Number.isFinite(value))) return { color: "CUSTOM", cmyk: parts as unknown as [number, number, number, number] };
  return { color: "COURSE" };
}

/** Syns specialobjektet på banan ("ALL_CONTROLS" = Alla kontroller, i filen bana 0)? */
export function specialVisible(special: SpecialObject, course: string): boolean {
  if (special.courses.length === 0) return true;
  return special.courses.includes(course === "ALL_CONTROLS" ? "0" : course);
}

export interface SpecialContext {
  readonly document: CourseSettingDocument;
  readonly course: string;
  readonly variant?: string | undefined;
  readonly printScale: number;
  readonly sizes: Sizes;
}

const MEDIA_TYPES: Readonly<Record<string, string>> = { png: "image/png", jpeg: "image/jpeg", jpg: "image/jpeg", gif: "image/gif", bmp: "image/bmp", tiff: "image/tiff" };

/** Siffrans höjd i em (Arial och Roboto: en siffra är ungefär 0,716 em). */
export const DIGIT_HEIGHT_EM = 0.716;
/** Radens höjd i em (Arial: stigning + fall). */
export const TEXT_LINE_EM = 1.15;

/** Ungefärlig bredd i em (paketet har inga typsnittsmått; används för att fylla en ruta med text). */
export function approximateTextWidth(text: string, bold: boolean): number {
  let width = 0;
  for (const ch of text) width += " .,:;'|!ijlI".includes(ch) ? 0.28 : "frt()-/[]".includes(ch) ? 0.34 : "mwMW".includes(ch) ? 0.84
    : /[0-9]/.test(ch) ? 0.556 : ch !== ch.toLowerCase() ? 0.67 : 0.53;
  return width * (bold ? 1.06 : 1);
}

/** Purple Pens textmakron (CourseFormatter.ExpandText). */
export function expandText(context: SpecialContext, text: string): string {
  if (!text.includes("$(")) return text;
  const { document, course } = context;
  const found = course === "ALL_CONTROLS" ? undefined : document.courses.find(item => item.id === course);
  const lengthText = () => {
    if (!found) return "";
    if (found.lengthOverrideMeters !== undefined) return km(found.lengthOverrideMeters, found.lengthOverrideMeters);
    const all = variations(document, found.id);
    const chosen = context.variant !== undefined ? all.filter(item => item.code === context.variant) : all;
    const lengths = chosen.length > 0 ? chosen.map(item => measuredLengthMeters(document, found.id, item.choices)) : [measuredLengthMeters(document, found.id, null)];
    return km(Math.min(...lengths), Math.max(...lengths));
  };
  const map = (document.event.raw ?? []).find(raw => raw.xml.startsWith("<map"))?.xml.match(/>([^<]*)</)?.[1] ?? "";
  const climb = found?.climbMeters;
  const replacements: Record<string, () => string> = {
    "$(EventTitle)": () => document.event.title.replace(/\|/g, " "),
    "$(CourseName)": () => found?.name ?? "Alla kontroller",
    "$(CoursePart)": () => "",
    "$(Variation)": () => context.variant ?? "",
    "$(RelayTeam)": () => "--",
    "$(RelayLeg)": () => "-",
    "$(CourseLength)": lengthText,
    "$(CourseClimb)": () => climb === undefined || climb < 0 ? "" : String(Math.round(climb / 5) * 5),
    "$(PrintScale)": () => `1:${Math.round(context.printScale).toLocaleString("sv-SE").replace(/\s/g, " ")}`,
    "$(ClassList)": () => (found?.secondaryTitle ?? "").replace(/\|/g, " "),
    "$(FileName)": () => "",
    "$(MapFileName)": () => map.split(/[\\/]/).pop() ?? ""
  };
  let out = text;
  for (const [macro, value] of Object.entries(replacements)) if (out.includes(macro)) out = out.split(macro).join(value());
  return out;
}

function km(min: number, max: number): string {
  const format = (meters: number) => (Math.round(meters / 100) / 10).toFixed(1).replace(".", ",");
  return format(min) === format(max) ? format(min) : `${format(min)}–${format(max)}`;
}

/** Linje, dubbel linje eller streckad (LineSpecialCourseObj.CreateLineSpecialSymDef). */
function linePrimitives(points: readonly Point[], line: SpecialLine, paint: Paint, ref: string, closed: boolean): OverprintPrimitive[] {
  const base = { kind: "polyline" as const, role: "SPECIAL" as const, ...paint, ref, ...(closed ? { closed: true } : {}) };
  if (line.kind === "double") {
    const offset = (line.gapSize + line.width) / 2;
    return [offsetLine(points, offset, closed), offsetLine(points, -offset, closed)].map(pts => ({ ...base, points: pts, width: line.width }));
  }
  if (line.kind === "dashed" && line.dashSize > 0 && line.gapSize > 0) return [{ ...base, points, width: line.width, dash: [line.dashSize, line.gapSize] }];
  return [{ ...base, points, width: line.width }];
}

/** Valfri passage (CrossingCourseObj med förlängning). */
function crossing(at: Point, orientation: number, stretch: number, sizes: Sizes, width: number, ref: string): OverprintPrimitive[] {
  const shift = sizes.sprint ? 0.175 : 0;
  const scale = sizes.crossingRadius / 2.5;
  const left: Point[] = stretch <= 0
    ? [{ x: -0.85, y: -1.5 }, { x: -0.35, y: -0.65 }, { x: -0.35, y: 0.65 }, { x: -0.85, y: 1.5 }]
    : [{ x: -0.85, y: -1.5 - stretch / 2 }, { x: -0.6, y: -1.08 - stretch / 2 }, { x: -0.48, y: -0.5 - stretch / 2 }, { x: -0.48, y: -stretch / 2 },
      { x: -0.48, y: stretch / 2 }, { x: -0.48, y: 0.5 + stretch / 2 }, { x: -0.6, y: 1.08 + stretch / 2 }, { x: -0.85, y: 1.5 + stretch / 2 }];
  const kinds = stretch <= 0 ? "NBBN" : "NBBNNBBN";
  const shape = (side: 1 | -1) => symPath(left.map(p => ({ x: side * (p.x - shift), y: p.y })), kinds).map(p => place(p, at, orientation, scale));
  return [1, -1].map(side => ({ kind: "polyline" as const, role: "SPECIAL" as const, color: "COURSE_LOWER" as const, points: shape(side as 1 | -1), width, ref }));
}

const FIRST_AID: readonly [number, number][] = [
  [-0.667, 2], [0.667, 2], [0.667, 0.667], [2, 0.667], [2, -0.667], [0.667, -0.667], [0.667, -2], [-0.667, -2], [-0.667, -0.667],
  [-2, -0.667], [-2, 0.667], [-0.667, 0.667]
];

/** Vattnet (WaterCourseObj, ISOM 2017): bägarens kanter och sidor. */
function water(at: Point, k: number, width: number, ref: string): OverprintPrimitive[] {
  const ax = 0.5522847498 * 1.55, ay = 0.5522847498 * 0.35, bx = 0.5522847498 * 0.85, by = 0.5522847498 * 0.15, g = by * 0.23;
  const p = (x: number, y: number) => ({ x: at.x + x * k, y: at.y + y * k });
  const top = [p(1.55, 1.071), p(1.55, 1.071 + ay), p(ax, 1.421), p(0, 1.421), p(-ax, 1.421), p(-1.55, 1.071 + ay), p(-1.55, 1.071),
    p(-1.55, 1.071 - ay), p(-ax, 0.721), p(0, 0.721), p(ax, 0.721), p(1.55, 1.071 - ay), p(1.55, 1.071)];
  const bottom = [p(0.85, -1.529), p(0.85 - g, -1.529 - by), p(bx, -1.679), p(0, -1.679), p(-bx, -1.679), p(-0.85, -1.529 - by), p(-0.85 + g, -1.529)];
  const paths = [symPath(top, "NBBNBBNBBNBBN"), symPath(bottom, "NBBNBBN"), [p(1.55, 1.071), p(0.85, -1.529)], [p(-1.55, 1.071), p(-0.85, -1.529)]];
  return paths.map(points => ({ kind: "polyline" as const, role: "SPECIAL" as const, color: "COURSE_LOWER" as const, points, width, cap: "round" as const, ref }));
}

function cross(at: Point, half: number, width: number, color: OverprintColor, ref: string): OverprintPrimitive[] {
  return [[{ x: -half, y: -half }, { x: half, y: half }], [{ x: half, y: -half }, { x: -half, y: half }]]
    .map(([a, b]) => ({ kind: "polyline" as const, role: "SPECIAL" as const, color, points: [{ x: at.x + a!.x, y: at.y + a!.y }, { x: at.x + b!.x, y: at.y + b!.y }], width, ref }));
}

/** Text i rutan (BasicTextCourseObj): fast siffhöjd eller så stor att texten fyller rutan; vänsterställd från övre hörnet. */
function textPrimitives(context: SpecialContext, special: SpecialObject, ref: string): OverprintPrimitive[] {
  const rect = rectOf(special.points[0]!, special.points[1]!);
  const lines = expandText(context, special.text ?? "").split(/\r?\n/);
  const font = special.font ?? { name: "Arial", bold: false, italic: false };
  let em: number;
  if (font.height !== undefined && font.height > 0) em = font.height / DIGIT_HEIGHT_EM;
  else {
    const width = Math.max(...lines.map(line => approximateTextWidth(line, font.bold)));
    const height = lines.length * TEXT_LINE_EM;
    const w = rect.maxX - rect.minX, h = rect.maxY - rect.minY;
    em = width === 0 || w === 0 ? h / Math.max(1, height) : Math.min(w / width, h / height);
  }
  if (!(em > 0)) return [];
  const paint = specialPaint(special.color);
  return lines.flatMap((line, index) => line === "" ? [] : [{
    kind: "text" as const, role: "SPECIAL" as const, ...paint, ref, text: line, heightMm: em, align: "left" as const,
    at: { x: rect.minX, y: rect.maxY - (index + 0.5) * TEXT_LINE_EM * em }, font: { family: font.name, bold: font.bold, italic: font.italic }
  }]);
}

/** Beskrivningens visningssätt för banan (Purple Pens description-kind på banan eller Alla kontroller). */
function descriptionKind(document: CourseSettingDocument, course: string): DescriptionKind {
  const raw = course === "ALL_CONTROLS" ? rawAttribute(document.event.raw, "all-controls", "description-kind")
    : rawAttribute(document.courses.find(item => item.id === course)?.raw, "options", "description-kind");
  return raw === "text" ? "TEXT" : raw === "symbols-and-text" ? "SYMBOLS_AND_TEXT" : "SYMBOLS";
}

/** Beskrivningen på kartan (DescriptionCourseObj): rutans sida = avståndet mellan punkterna, vit bakgrund under. */
function descriptionPrimitives(context: SpecialContext, special: SpecialObject, ref: string): OverprintPrimitive[] {
  const { document, course } = context;
  const topLeft = special.points[0]!;
  const cell = distance(special.points[0]!, special.points[1]!);
  if (!(cell > 0)) return [];
  const layout = layoutDescriptionFigures(document, {
    course, ...(context.variant ? { variant: context.variant } : {}), kind: descriptionKind(document, course),
    language: document.event.descriptionLanguage ?? "sv", boxMm: cell, columns: special.columns ?? 1
  });
  const purple = rawAttribute(document.event.raw, "descriptions", "color") === "purple";
  const ring = [topLeft, { x: topLeft.x + layout.widthMm, y: topLeft.y }, { x: topLeft.x + layout.widthMm, y: topLeft.y - layout.heightMm },
    { x: topLeft.x, y: topLeft.y - layout.heightMm }];
  return [
    { kind: "polygon", role: "SPECIAL", color: "WHITE", rings: [ring], ref },
    { kind: "description", role: "SPECIAL", color: purple ? "COURSE" : "BLACK", topLeft, layout, ref }
  ];
}

/** Figurerna för ett specialobjekt. */
export function specialPrimitives(context: SpecialContext, special: SpecialObject): OverprintPrimitive[] {
  const { sizes } = context;
  const appearance = appearanceOf(context.document);
  const k = sizes.ratio * appearance.circleSize;
  const ref = special.id;
  const at = special.points[0]!;
  const area = special.points;
  switch (special.kind) {
    case "first-aid":
      return [{ kind: "polygon", role: "SPECIAL", color: "COURSE_LOWER", rings: [FIRST_AID.map(([x, y]) => ({ x: at.x + x * k, y: at.y + y * k }))], ref }];
    case "water": return water(at, k, 0.4 * sizes.ratio, ref);
    case "optional-crossing-point": return crossing(at, special.orientation ?? 0, special.stretch ?? 0, sizes, sizes.line, ref);
    case "forbidden-route": return cross(at, 1.06 * k, 0.35 * k, "COURSE", ref);
    case "registration-mark":
      return [[{ x: -2, y: 0 }, { x: 2, y: 0 }], [{ x: 0, y: -2 }, { x: 0, y: 2 }]].map(([a, b]) => ({ kind: "polyline" as const, role: "SPECIAL" as const,
        color: "COURSE" as const, points: [{ x: at.x + a!.x * k, y: at.y + a!.y * k }, { x: at.x + b!.x * k, y: at.y + b!.y * k }],
        width: 0.1 * sizes.ratio * appearance.lineWidth, ref }));
    case "boundary":
      return [{ kind: "polyline", role: "SPECIAL", color: "COURSE_LOWER", points: area, width: (sizes.sprint ? 1.0 : 0.7) * sizes.ratio * appearance.lineWidth, ref }];
    case "out-of-bounds": case "dangerous-area":
      return [45, 135].flatMap(degrees => hatchLines(area, degrees, 1.2 * sizes.ratio)).map(points => ({
        kind: "polyline" as const, role: "SPECIAL" as const, color: "COURSE" as const, points, width: 0.2 * sizes.ratio, ref
      }));
    case "temporary-construction":
      return [
        { kind: "polygon", role: "SPECIAL", color: "COURSE", rings: [area], tint: 0.5, ref },
        { kind: "polyline", role: "SPECIAL", color: "COURSE", points: area, width: 0.1 * sizes.ratio, closed: true, ref }
      ];
    case "white-out": return [{ kind: "polygon", role: "SPECIAL", color: "WHITE", rings: [area], ref }];
    case "text": return textPrimitives(context, special, ref);
    case "descriptions": return descriptionPrimitives(context, special, ref);
    case "image": {
      const image = specialImage(special);
      if (!image) return [];
      return [{ kind: "image", role: "SPECIAL", rect: rectOf(special.points[0]!, special.points[1]!), ref, data: image.data,
        mediaType: MEDIA_TYPES[image.format.toLowerCase()] ?? `image/${image.format.toLowerCase()}` }];
    }
    case "line":
      return linePrimitives(area, special.line ?? { kind: "single", width: 0.35, gapSize: 0, dashSize: 0 }, specialPaint(special.color), ref, false);
    case "rectangle": case "ellipse": {
      const rect = rectOf(special.points[0]!, special.points[1]!);
      const line = special.line ?? { kind: "single", width: 0.35, gapSize: 0, dashSize: 0 };
      const points = special.kind === "ellipse" ? ellipsePoints(rect) : roundedRectPoints(rect, line.cornerRadius ?? 0);
      return linePrimitives(points, line, specialPaint(special.color), ref, true);
    }
    default: return [];
  }
}

/** Målningsordningen (Purple Pens färgordning): vitt underst, sedan bilder, egna färger, svart, undre och övre lila. */
export function paintRank(primitive: OverprintPrimitive): number {
  if (primitive.kind === "image") return 1;
  switch (primitive.color) {
    case "WHITE": return 0;
    case "CUSTOM": return 2;
    case "BLACK": return 3;
    case "COURSE_LOWER": return 4;
    default: return 5;
  }
}

/** Figurerna i målningsordning (stabil). */
export function inPaintOrder(primitives: readonly OverprintPrimitive[]): OverprintPrimitive[] {
  return primitives.map((primitive, index) => ({ primitive, index }))
    .sort((a, b) => paintRank(a.primitive) - paintRank(b.primitive) || a.index - b.index).map(entry => entry.primitive);
}
