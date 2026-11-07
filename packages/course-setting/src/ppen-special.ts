/**
 * Steg 64: specialobjektens och tryckytans fält i .ppen, som Purple Pens Special.ReadAttributesAndContent /
 * WriteAttributesAndContent och PrintArea i EventDB.cs (BSD, Peter Golde). Fälten tolkas bredvid det råa elementet; är de
 * oförändrade skrivs elementet orört, annars som Purple Pen skriver det, med det som O-Tid inte tolkar kvar.
 */
import type { Point } from "@o-tid/map-file";
import { formatNumber, fromRaw, invalid, parseBool, parseNumber, toRaw } from "./ppen-common";
import type { PrintArea, RawXml, SpecialFields, SpecialInput, SpecialLine, SpecialObject } from "./types";
import { attr, childElements, el, textOf, type XmlElement, type XmlNode } from "./xml";

/** Slagen som har färg (och linje utom text) i `<appearance>`. */
const COLORED = new Set(["text", "line", "rectangle", "ellipse"]);
const LINED = new Set(["line", "rectangle", "ellipse"]);
const LINE_KINDS = new Set(["single", "double", "dashed"]);
const SPECIAL_CHILDREN = new Set(["text", "font", "location", "appearance", "courses", "image-data"]);

const num = (value: string | undefined, what: string, fallback: number) => value === undefined ? fallback : parseNumber(value, what);

/** JSON med nycklarna i ordning och utan `undefined`, för att jämföra fält. */
export function sameFields(a: unknown, b: unknown): boolean {
  const canonical = (value: unknown): string => {
    if (value === undefined) return "u";
    if (value === null || typeof value !== "object") return JSON.stringify(value);
    if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
    return `{${Object.entries(value as Record<string, unknown>).filter(([, item]) => item !== undefined).sort(([x], [y]) => (x < y ? -1 : 1))
      .map(([key, item]) => `${key}:${canonical(item)}`).join(",")}}`;
  };
  return canonical(a) === canonical(b);
}

/** De tolkade fälten ur elementet (Purple Pens förval där attributen saknas). */
export function readSpecialFields(element: XmlElement, kind: string): SpecialFields & { imageFormat?: string } {
  const out: { -readonly [K in keyof SpecialFields]: SpecialFields[K] } & { imageFormat?: string } = {};
  if (kind === "optional-crossing-point") {
    out.orientation = parseNumber(attr(element, "orientation"), "orientation");
    const stretch = attr(element, "stretch");
    if (stretch !== undefined) out.stretch = parseNumber(stretch, "stretch");
  }
  if (COLORED.has(kind)) out.color = "purple";
  if (LINED.has(kind)) out.line = { kind: "single", width: 0, gapSize: 0, dashSize: 0, ...(kind === "rectangle" ? { cornerRadius: 0 } : {}) };
  for (const child of childElements(element)) {
    switch (child.name) {
      case "text": out.text = textOf(child); break;
      case "font": {
        const height = attr(child, "height");
        const value = height === undefined ? -1 : parseNumber(height, "font height");
        out.font = { name: attr(child, "name") ?? "", bold: parseBool(attr(child, "bold") ?? "false", "bold"),
          italic: parseBool(attr(child, "italic") ?? "false", "italic"), ...(value > 0 ? { height: value } : {}) };
        break;
      }
      case "appearance": {
        const columns = attr(child, "columns");
        if (kind === "descriptions" && columns !== undefined) out.columns = parseNumber(columns, "columns");
        if (COLORED.has(kind)) out.color = attr(child, "color") ?? "purple";
        if (LINED.has(kind)) {
          const lineKind = attr(child, "line-kind");
          out.line = {
            kind: lineKind !== undefined && LINE_KINDS.has(lineKind) ? lineKind as SpecialLine["kind"] : "single",
            width: num(attr(child, "line-width"), "line-width", 0),
            gapSize: num(attr(child, "gap-size"), "gap-size", 0),
            dashSize: num(attr(child, "dash-size"), "dash-size", 0),
            ...(kind === "rectangle" ? { cornerRadius: num(attr(child, "corner-radius"), "corner-radius", 0) } : {})
          };
        }
        break;
      }
      case "image-data": {
        const format = attr(child, "format");
        if (format !== undefined) out.imageFormat = format;
        break;
      }
      default: break;
    }
  }
  return out;
}

/** Fälten som modellen har dem. */
export function fieldsOf(special: SpecialObject): SpecialFields & { imageFormat?: string } {
  const { orientation, stretch, text, font, color, line, columns, imageFormat } = special;
  return { orientation, stretch, text, font, color, line, columns, ...(imageFormat !== undefined ? { imageFormat } : {}) };
}

const location = (p: Point) => el("location", [["x", formatNumber(p.x)], ["y", formatNumber(p.y)]]);

/** Banorna som `<courses>`; befintliga `<course>` (med `part`) behålls. */
function coursesElement(courses: readonly string[], old: XmlElement | undefined): XmlElement {
  if (courses.length === 0) return el("courses", [["all", "true"]]);
  return el("courses", [], courses.map(id => (old ? childElements(old).find(c => attr(c, "course") === id) : undefined) ?? el("course", [["course", id]])));
}

/**
 * Elementet som Purple Pen skriver det (Special.WriteAttributesAndContent) ur modellens fält; okända attribut och barn ur
 * `old` följer med, liksom bildens data.
 */
export function buildSpecialElement(special: Omit<SpecialObject, "raw">, old: XmlElement | undefined, image?: { format: string; data: string }): XmlElement {
  const attrs: [string, string][] = [["id", special.id], ["kind", special.kind]];
  if (special.kind === "optional-crossing-point") {
    attrs.push(["orientation", formatNumber(special.orientation ?? 0)]);
    if ((special.stretch ?? 0) > 0) attrs.push(["stretch", formatNumber(special.stretch!)]);
  }
  for (const [name, value] of old?.attrs ?? []) if (!["id", "kind", "orientation", "stretch"].includes(name)) attrs.push([name, value]);
  const kids: XmlNode[] = [];
  if (special.text !== undefined) kids.push(el("text", [], special.text === "" ? [] : [special.text]));
  const oldImage = old ? childElements(old).find(c => c.name === "image-data") : undefined;
  if (image) kids.push(el("image-data", [["format", image.format]], [image.data]));
  else if (oldImage) kids.push(special.imageFormat !== undefined && special.imageFormat !== attr(oldImage, "format")
    ? el("image-data", [["format", special.imageFormat]], oldImage.children) : oldImage);
  if (special.kind === "descriptions" && (special.columns ?? 1) > 1) kids.push(el("appearance", [["columns", formatNumber(special.columns!)]]));
  if (special.kind === "text") {
    const font = special.font ?? { name: "Arial", bold: false, italic: false };
    kids.push(el("font", [["name", font.name], ["bold", String(font.bold)], ["italic", String(font.italic)],
      ...(font.height !== undefined && font.height > 0 ? [["height", formatNumber(font.height)] as [string, string]] : [])]));
    kids.push(el("appearance", [["color", special.color ?? "purple"]]));
  }
  if (LINED.has(special.kind)) {
    const line = special.line ?? { kind: "single", width: 0.35, gapSize: 0, dashSize: 0 };
    const a: [string, string][] = [["line-kind", line.kind], ["color", special.color ?? "purple"], ["line-width", formatNumber(line.width)]];
    if (line.kind === "double" || line.kind === "dashed") a.push(["gap-size", formatNumber(line.gapSize)]);
    if (line.kind === "dashed") a.push(["dash-size", formatNumber(line.dashSize)]);
    if (special.kind === "rectangle") a.push(["corner-radius", formatNumber(line.cornerRadius ?? 0)]);
    kids.push(el("appearance", a));
  }
  kids.push(...special.points.map(location));
  kids.push(coursesElement(special.courses, old ? childElements(old).find(c => c.name === "courses") : undefined));
  for (const child of old ? childElements(old) : []) if (!SPECIAL_CHILDREN.has(child.name)) kids.push(child);
  return el("special-object", attrs, kids);
}

/** Ett nytt specialobjekt med `raw` som Purple Pen skulle skriva det. */
export function newSpecial(id: string, input: SpecialInput): SpecialObject {
  const { image, courses, ...rest } = input;
  const fields = { ...rest, courses: [...(courses ?? [])], id, ...(image ? { imageFormat: image.format } : {}) };
  const element = buildSpecialElement(fields, undefined, image);
  return { ...fields, ...readSpecialFields(element, input.kind), raw: toRaw(element) };
}

/** Bildens data (base64) och format ur `raw`. */
export function specialImage(special: SpecialObject): { format: string; data: string } | undefined {
  const element = fromRaw(special.raw);
  const data = childElements(element).find(c => c.name === "image-data");
  if (!data) return undefined;
  return { format: attr(data, "format") ?? special.imageFormat ?? "png", data: textOf(data).replace(/\s+/g, "") };
}

/** Tryckytan (PrintArea.ReadAttributesAndContent): saknas ytan blir den automatisk. */
export function readPrintArea(element: XmlElement): PrintArea {
  const bool = (name: string) => { const value = attr(element, name); return value === undefined ? false : parseBool(value, name); };
  const n = (name: string) => { const value = attr(element, name); return value === undefined ? NaN : parseNumber(value, name); };
  const [left, top, right, bottom] = [n("left"), n("top"), n("right"), n("bottom")];
  // Purple Pen skriver en automatisk tryckyta med rektangeln 0,0,0,0 (RectangleF.Empty); en rektangel utan yta är ingen
  // rektangel (förut blev den {0,0,0,0} och "Tryckytan är ingen rektangel" vid nästa ändring efter export och import).
  const hasRect = [left, top, right, bottom].every(Number.isFinite) && left !== right && top !== bottom;
  const width = n("page-width"), height = n("page-height");
  const page = Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0
    ? { width, height, margins: Number.isFinite(n("page-margins")) ? n("page-margins") : 0, landscape: bool("page-landscape") } : undefined;
  if (page && (!Number.isInteger(page.width) || !Number.isInteger(page.height) || !Number.isInteger(page.margins))) {
    throw invalid("papperets storlek i <print-area> är inte heltal");
  }
  return {
    automatic: hasRect ? bool("automatic") : true,
    restrictToPageSize: bool("restrict-to-page-size"),
    // I filen är "top" det största y (kartans y uppåt), som Purple Pen skriver det.
    ...(hasRect ? { rect: { minX: Math.min(left, right), maxX: Math.max(left, right), minY: Math.min(top, bottom), maxY: Math.max(top, bottom) } } : {}),
    ...(page ? { page } : {})
  };
}

/**
 * `<print-area>` som Purple Pen skriver den (PrintArea.WriteAttributesAndContent): alltid med rektangeln, 0,0,0,0 för en
 * automatisk yta utan rektangel (som Purple Pens egna filer); okända attribut ur `old` följer med.
 */
export function printAreaElement(area: PrintArea, old: XmlElement | undefined): XmlElement {
  const attrs: [string, string][] = [];
  const part = old ? attr(old, "part") : undefined;
  if (part !== undefined) attrs.push(["part", part]);
  attrs.push(["automatic", String(area.automatic)], ["restrict-to-page-size", String(area.restrictToPageSize)]);
  const rect = area.rect ?? { minX: 0, minY: 0, maxX: 0, maxY: 0 };
  attrs.push(["left", formatNumber(rect.minX)], ["top", formatNumber(rect.maxY)], ["right", formatNumber(rect.maxX)], ["bottom", formatNumber(rect.minY)]);
  if (area.page) {
    attrs.push(["page-width", String(area.page.width)], ["page-height", String(area.page.height)], ["page-margins", String(area.page.margins)],
      ["page-landscape", String(area.page.landscape)]);
  }
  const known = new Set(["part", "automatic", "restrict-to-page-size", "left", "top", "right", "bottom", "page-width", "page-height", "page-margins", "page-landscape"]);
  for (const [name, value] of old?.attrs ?? []) if (!known.has(name)) attrs.push([name, value]);
  return el("print-area", attrs, old?.children ?? []);
}

const isMain = (element: XmlElement) => element.name === "print-area" && attr(element, "part") === undefined;

/** Tryckytan (utan `part`) ur de råa elementen. */
export function rawPrintArea(raws: readonly RawXml[] | undefined): PrintArea | undefined {
  for (const raw of raws ?? []) {
    if (!raw.xml.startsWith("<print-area")) continue;
    const element = fromRaw(raw);
    if (isMain(element)) return readPrintArea(element);
  }
  return undefined;
}

/** Delarnas tryckytor (`<print-area part="n">`, ADR-0203) ur de råa elementen, per del ("0", "1" …). */
export function rawPartPrintAreas(raws: readonly RawXml[] | undefined): Record<string, PrintArea> {
  const out: Record<string, PrintArea> = {};
  for (const raw of raws ?? []) {
    if (!raw.xml.startsWith("<print-area")) continue;
    const element = fromRaw(raw);
    const part = attr(element, "part");
    if (part !== undefined && /^\d+$/.test(part)) out[part] = readPrintArea(element);
  }
  return out;
}

/** De råa elementen med delarnas tryckytor som modellen har dem (orörda om de är desamma, borttagna om de saknas). */
export function withPartPrintAreas(raws: readonly RawXml[] | undefined, areas: Readonly<Record<string, PrintArea>> | undefined): RawXml[] {
  const list: RawXml[] = [];
  const done = new Set<string>();
  for (const raw of raws ?? []) {
    const element = raw.xml.startsWith("<print-area") ? fromRaw(raw) : undefined;
    const part = element ? attr(element, "part") : undefined;
    if (!element || part === undefined) { list.push(raw); continue; }
    const area = areas?.[part];
    if (!area) continue;
    done.add(part);
    list.push(sameFields(readPrintArea(element), area) ? raw : toRaw(printAreaElement(area, element)));
  }
  for (const [part, area] of Object.entries(areas ?? {})) {
    if (done.has(part)) continue;
    list.push(toRaw(printAreaElement(area, el("print-area", [["part", part]]))));
  }
  return list;
}

/** De råa elementen med tryckytan som modellen har den (orörd om den är densamma). */
export function withPrintArea(raws: readonly RawXml[] | undefined, area: PrintArea | undefined): RawXml[] {
  const list = [...(raws ?? [])];
  const index = list.findIndex(raw => raw.xml.startsWith("<print-area") && isMain(fromRaw(raw)));
  const old = index >= 0 ? fromRaw(list[index]!) : undefined;
  if (old && area && sameFields(readPrintArea(old), area)) return list;
  if (!area) return index >= 0 ? list.filter((_, i) => i !== index) : list;
  const next = toRaw(printAreaElement(area, old));
  if (index >= 0) list[index] = next; else list.push(next);
  return list;
}
