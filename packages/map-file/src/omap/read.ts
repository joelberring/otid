/**
 * OpenOrienteering Mapper .omap/.xmap (XML, `http://openorienteering.org/apps/mapper/xml/v2`).
 *
 * Huvudet (färger, georeferens, symboler) tolkas med fast-xml-parser. Objekten (`<parts>`), som är nästan hela filen,
 * läses med en egen linjär genomgång av texten: det är flera gånger snabbare och håller minnet nere för 60 MB-filer.
 */
import { XMLParser, XMLValidator } from "fast-xml-parser";
import { clamp01, rgbFromCmyk, spotName } from "../color";
import { crsFromEpsg } from "../georef";
import { boundsOf, normalizeAngle, openRing } from "../geometry";
import { MapFileError, type MapColor, type MapGeoreference, type MapObject, type MapSymbol, type ParsedMap } from "../model";
import { WarningCollector } from "../warnings";
import { coordsToParts, joinParts, parseCoordText } from "./coords";
import { readOmapSymbols } from "./symbols";
import { asArray, attr, child, decodeEntities, num, tagAttributes, text, type XmlNode } from "./xml";

export const MAPPER_NAMESPACE = "http://openorienteering.org/apps/mapper/xml/v2";

const ARRAY_TAGS = new Set(["color", "component", "symbol", "part", "element", "pattern", "border", "object", "coord", "namedcolor"]);

export function readOmap(textContent: string): ParsedMap {
  const partsStart = findTag(textContent, "<parts", 0);
  const partsEnd = partsStart < 0 ? -1 : textContent.indexOf("</parts>", partsStart);
  if (partsStart >= 0 && partsEnd < 0) throw new MapFileError("TRUNCATED", "Mapper-filen är avkortad (objekten tar slut mitt i).");
  const header = partsStart < 0
    ? textContent
    : textContent.slice(0, partsStart) + textContent.slice(partsEnd + "</parts>".length);

  const map = parseHeader(header);
  const version = attr(map, "version");
  const warnings = new WarningCollector();
  const colors = readColors(child(map, "colors"));
  const barrier = child(map, "barrier") ?? map;
  const { symbols, isArea } = readOmapSymbols(asArray(child(barrier, "symbols")?.symbol), warnings);
  const objects = partsStart < 0 ? [] : readObjects(textContent, partsStart, partsEnd, symbols, isArea, warnings);
  const { scale, georeference } = readGeoreference(child(map, "georeferencing"), warnings);
  return {
    format: "OMAP",
    version: version ? `Mapper v${version}` : "Mapper",
    colors,
    symbols,
    objects,
    scale,
    georeference,
    bounds: boundsOf(objects),
    warnings: warnings.list()
  };
}

function findTag(content: string, name: string, from: number): number {
  for (let index = content.indexOf(name, from); index >= 0; index = content.indexOf(name, index + 1)) {
    const next = content.charCodeAt(index + name.length);
    if (next === 62 || next === 32 || next === 9 || next === 10 || next === 13 || next === 47) return index;
  }
  return -1;
}

function parseHeader(header: string): XmlNode {
  // Ikonerna (base64-PNG per symbol) behövs inte och tas bort före tolkningen.
  const stripped = header.replace(/<icon\b[^>]*\/>/g, "");
  // Parsern godtar en del trasig XML; huvudet är litet (objekten är redan bortklippta), så det kontrolleras först.
  const valid = XMLValidator.validate(stripped);
  if (valid !== true) {
    throw new MapFileError("INVALID", `Mapper-filen går inte att tolka som XML (rad ${valid.err.line}: ${valid.err.msg}).`);
  }
  let document: XmlNode;
  try {
    const parser = new XMLParser({
      ignoreAttributes: false,
      attributeNamePrefix: "@",
      parseTagValue: false,
      parseAttributeValue: false,
      trimValues: false,
      processEntities: true,
      isArray: name => ARRAY_TAGS.has(name)
    });
    document = parser.parse(stripped) as XmlNode;
  } catch (error) {
    throw new MapFileError("INVALID", `Mapper-filen går inte att tolka som XML (${error instanceof Error ? error.message : String(error)}).`);
  }
  const map = child(document, "map");
  if (!map) throw new MapFileError("NOT_A_MAP_FILE", "Filen saknar Mappers <map>-element.");
  return map;
}

function readColors(colorsNode: XmlNode | undefined): MapColor[] {
  const nodes = asArray(colorsNode?.color);
  const names = new Map<number, string>();
  nodes.forEach((node, index) => {
    // <namedcolor> utan attribut blir en ren sträng i parsern, med attribut ett objekt med "#text".
    const own = child(node, "spotcolors")?.namedcolor;
    names.set(num(node, "priority", index), text(Array.isArray(own) ? own[0] : own).trim());
  });
  const colors = nodes.map((node, index): MapColor => {
    const id = num(node, "priority", index);
    const cmyk = { c: clamp01(num(node, "c", 0)), m: clamp01(num(node, "m", 0)), y: clamp01(num(node, "y", 0)), k: clamp01(num(node, "k", 0)) };
    const rgbNode = child(node, "rgb");
    const rgb = rgbNode
      ? { r: clamp01(num(rgbNode, "r", 0)), g: clamp01(num(rgbNode, "g", 0)), b: clamp01(num(rgbNode, "b", 0)) }
      : rgbFromCmyk(cmyk);
    const spotNode = child(node, "spotcolors");
    let spot: MapColor["spot"];
    if (spotNode) {
      const ownName = names.get(id) ?? "";
      const separations = ownName
        ? [{ name: ownName, factor: 1 }]
        : asArray(spotNode.component).map(part => ({ name: names.get(num(part, "spotcolor", -1)) ?? "", factor: num(part, "factor", 0) }));
      const name = spotName(separations);
      if (name) spot = { name, overprint: attr(spotNode, "knockout") !== "true" };
    }
    return { id, name: attr(node, "name") ?? "", rank: index, cmyk, rgb, opacity: clamp01(num(node, "opacity", 1)), spot };
  });
  // Mapper skriver färgerna i prioritetsordning; sortera ändå så att rank följer prioriteten.
  colors.sort((a, b) => a.id - b.id);
  return colors.map((color, rank) => ({ ...color, rank }));
}

function readGeoreference(node: XmlNode | undefined, warnings: WarningCollector): { scale: number; georeference: MapGeoreference | null } {
  const fileScale = num(node, "scale", 0);
  const scale = fileScale > 0 ? fileScale : 10000;
  if (fileScale <= 0) warnings.add("SCALE_MISSING");
  const projected = child(node, "projected_crs");
  if (!node || !projected) return { scale, georeference: null };
  const refPoint = child(projected, "ref_point");
  if (!refPoint) return { scale, georeference: null };
  const mapRef = child(node, "ref_point");
  const crs = crsFromEpsg(epsgOf(projected), describeCrs(projected));
  if (crs.kind === "UNKNOWN") warnings.add("CRS_UNKNOWN");
  const factor = num(node, "auxiliary_scale_factor", num(node, "grid_scale_factor", 1));
  return {
    scale,
    georeference: {
      scale,
      crs,
      refPoint: { easting: num(refPoint, "x", 0), northing: num(refPoint, "y", 0) },
      mapRefPoint: mapRef ? { x: num(mapRef, "x", 0) / 1000, y: (0 - num(mapRef, "y", 0)) / 1000 } : { x: 0, y: 0 },
      grivationDegrees: num(node, "grivation", 0),
      combinedScaleFactor: factor > 0 ? factor : 1
    }
  };
}

function epsgOf(projected: XmlNode): number | null {
  const id = attr(projected, "id");
  const parameter = text(asArray(projected.parameter)[0] ?? projected.parameter).trim();
  if (id === "EPSG" && /^\d+$/.test(parameter)) return Number(parameter);
  const spec = text(child(projected, "spec") ?? projected.spec);
  const match = /(?:epsg:|EPSG:)(\d+)/.exec(spec);
  return match ? Number(match[1]) : null;
}

function describeCrs(projected: XmlNode): string {
  const id = attr(projected, "id") ?? "okänt";
  const parameter = text(asArray(projected.parameter)[0] ?? projected.parameter).trim();
  const spec = text(child(projected, "spec") ?? projected.spec).trim();
  return [id, parameter, spec].filter(Boolean).join(" ");
}

/** Linjär genomgång av `<object …>…</object>` i `<parts>`. */
function readObjects(
  content: string, start: number, end: number, symbols: ReadonlyMap<string, MapSymbol>,
  isArea: (id: string) => boolean, warnings: WarningCollector
): MapObject[] {
  const objects: MapObject[] = [];
  let position = start;
  for (;;) {
    const open = findTag(content, "<object", position);
    if (open < 0 || open >= end) break;
    const tagEnd = content.indexOf(">", open);
    if (tagEnd < 0 || tagEnd > end) throw new MapFileError("TRUNCATED", "Mapper-filen är avkortad mitt i ett objekt.");
    const selfClosing = content.charCodeAt(tagEnd - 1) === 47;
    const close = selfClosing ? tagEnd : content.indexOf("</object>", tagEnd);
    if (close < 0 || close > end) throw new MapFileError("TRUNCATED", "Mapper-filen är avkortad mitt i ett objekt.");
    position = selfClosing ? tagEnd + 1 : close + "</object>".length;
    const attributes = tagAttributes(content.slice(open, tagEnd));
    const object = readObject(content, tagEnd + 1, selfClosing ? tagEnd + 1 : close, attributes, symbols, isArea, warnings);
    if (object) objects.push(object);
  }
  return objects;
}

function readObject(
  content: string, from: number, to: number, attributes: Map<string, string>, symbols: ReadonlyMap<string, MapSymbol>,
  isArea: (id: string) => boolean, warnings: WarningCollector
): MapObject | null {
  const type = attributes.get("type");
  const symbol = attributes.get("symbol") ?? "-1";
  if (type !== "0" && type !== "1" && type !== "4") { warnings.add("UNKNOWN_OBJECT_TYPE"); return null; }
  if (!symbols.has(symbol)) { warnings.add(symbol.startsWith("-") ? "OBJECT_WITHOUT_SYMBOL" : "UNKNOWN_SYMBOL"); return null; }
  const triples = readCoords(content, from, to);
  if (!triples || triples.length < 3) { warnings.add("BROKEN_OBJECT"); return null; }
  const rotation = normalizeAngle((Number(attributes.get("rotation") ?? "0") || 0) * (180 / Math.PI));
  const at = { x: triples[0]! / 1000, y: (0 - triples[1]!) / 1000 };
  if (type === "0") return { kind: "point", symbol, at, angle: rotation };
  if (type === "4") return { kind: "text", symbol, at, angle: rotation, text: readText(content, from, to) };
  const parts = coordsToParts(triples);
  if (parts.length === 0) { warnings.add("BROKEN_OBJECT"); return null; }
  if (isArea(symbol)) return { kind: "area", symbol, rings: parts.map(openRing), angle: patternRotation(content, from, to) };
  return { kind: "line", symbol, path: joinParts(parts) };
}

function readCoords(content: string, from: number, to: number): number[] | null {
  const open = content.indexOf("<coords", from);
  if (open < 0 || open >= to) return null;
  const tagEnd = content.indexOf(">", open);
  if (tagEnd < 0 || tagEnd >= to) return null;
  if (content.charCodeAt(tagEnd - 1) === 47) return [];
  const close = content.indexOf("</coords>", tagEnd);
  if (close < 0 || close > to) return null;
  const inner = content.indexOf("<coord", tagEnd);
  if (inner < 0 || inner > close) return parseCoordText(content, tagEnd + 1, close);
  // Äldre skrivsätt: <coord x="…" y="…" flags="…"/>.
  const out: number[] = [];
  const pattern = /<coord\b([^>]*)\/?>/g;
  pattern.lastIndex = inner;
  for (let match = pattern.exec(content); match && match.index < close; match = pattern.exec(content)) {
    const coord = tagAttributes(match[1]!);
    const x = Number(coord.get("x")), y = Number(coord.get("y")), flags = Number(coord.get("flags") ?? "0");
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
    out.push(x, y, Number.isFinite(flags) ? flags : 0);
  }
  return out;
}

function readText(content: string, from: number, to: number): string {
  const open = content.indexOf("<text", from);
  if (open < 0 || open >= to) return "";
  const tagEnd = content.indexOf(">", open);
  if (tagEnd < 0 || tagEnd >= to || content.charCodeAt(tagEnd - 1) === 47) return "";
  const close = content.indexOf("</text>", tagEnd);
  return close < 0 || close > to ? "" : decodeEntities(content.slice(tagEnd + 1, close));
}

function patternRotation(content: string, from: number, to: number): number {
  const open = content.indexOf("<pattern", from);
  if (open < 0 || open >= to) return 0;
  const tagEnd = content.indexOf(">", open);
  if (tagEnd < 0 || tagEnd > to) return 0;
  const rotation = Number(tagAttributes(content.slice(open, tagEnd)).get("rotation") ?? "0");
  return Number.isFinite(rotation) ? normalizeAngle(rotation * (180 / Math.PI)) : 0;
}
