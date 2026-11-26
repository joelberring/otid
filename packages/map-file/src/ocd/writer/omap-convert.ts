/**
 * Etapp 5B (OCAD Steg 3): konverterar valfri inläst `ParsedMap` (t.ex. från `.ocd`) till en giltig
 * OpenOrienteering Mapper XML v9 `.omap`-fil + strukturerad formatgapsrapport (`MapConversionReport`).
 * 100 % clean-room-kod.
 */
import { rgbFromCmyk } from "../../color";
import { isSupportedEpsg, projectedToWgs84 } from "../../georef";
import { openRing } from "../../geometry";
import type {
  AreaSymbol, LineSymbol, MapColor, MapSymbol, ParsedMap, Path, PathCommand, PointElement, StrokeStyle, TextSymbol
} from "../../model";
import { gridConvergenceDegrees } from "../../template/new-map";
import { ConversionWarningCollector, type ConvertMapResult } from "./convert-report";

export interface ConvertToOmapOptions {
  /** Valfri anteckning i `<notes>`. */
  readonly notes?: string | undefined;
}

const CAP = { butt: 0, round: 1, square: 2 } as const;
const JOIN = { bevel: 0, miter: 1, round: 2 } as const;
const CURVE_START = 1;
const CLOSE_POINT = 2;
const HOLE_POINT = 16;
const DASH_POINT = 32;

const um = (mm: number): number => Math.round(mm * 1000);
const mx = (x: number): number => Math.round(x * 1000);
const my = (y: number): number => Math.round(-y * 1000);

function round(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  const result = Math.round(value * factor) / factor;
  return Object.is(result, -0) ? 0 : result;
}

function radians(degrees: number): number {
  return round((degrees * Math.PI) / 180, 6);
}

function escapeXml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function splitParts(path: Path): Path[] {
  const parts: Path[] = [];
  let current: PathCommand[] = [];
  for (const cmd of path) {
    if (cmd.type === "M" && current.length > 0) {
      parts.push(current);
      current = [];
    }
    current.push(cmd);
  }
  if (current.length > 0) parts.push(current);
  return parts;
}

function pathHasGaps(parts: readonly Path[]): boolean {
  for (const part of parts) {
    for (const cmd of part) {
      if (cmd.gap) return true;
    }
  }
  return false;
}

function mapperCoords(parts: readonly Path[], closed: boolean): { count: number; text: string } {
  const out: { x: number; y: number; flags: number }[] = [];
  parts.forEach((rawPart, partIndex) => {
    const part = closed ? openRing(rawPart) : rawPart;
    if (part.length === 0) return;
    const start = out.length;
    for (const cmd of part) {
      if (cmd.type === "C") {
        if (out.length > start) out[out.length - 1]!.flags |= CURVE_START;
        out.push({ x: cmd.x1, y: cmd.y1, flags: 0 }, { x: cmd.x2, y: cmd.y2, flags: 0 });
      }
      out.push({ x: cmd.x, y: cmd.y, flags: cmd.corner || cmd.dash ? DASH_POINT : 0 });
    }
    if (closed && out.length > start) {
      const first = out[start]!;
      const last = out[out.length - 1]!;
      if (Math.abs(first.x - last.x) > 1e-9 || Math.abs(first.y - last.y) > 1e-9) {
        out.push({ x: first.x, y: first.y, flags: 0 });
      }
      out[out.length - 1]!.flags |= CLOSE_POINT;
    }
    if (partIndex < parts.length - 1 && out.length > 0) {
      out[out.length - 1]!.flags |= HOLE_POINT;
    }
  });
  return {
    count: out.length,
    text: out.map(pt => `${mx(pt.x)} ${my(pt.y)}${pt.flags ? ` ${pt.flags}` : ""};`).join("")
  };
}

function symbolCodeText(symbol: MapSymbol): string {
  if (symbol.code.text) return symbol.code.text;
  if (symbol.code.main > 0) return symbol.code.sub ? `${symbol.code.main}.${symbol.code.sub}` : String(symbol.code.main);
  return "";
}

function buildColorsXml(colors: readonly MapColor[]): { xml: string[]; idToPriority: Map<number, number> } {
  const sorted = [...colors].sort((a, b) => a.rank - b.rank);
  const idToPriority = new Map<number, number>();
  sorted.forEach((color, priority) => idToPriority.set(color.id, priority));

  // Förpass: hitta första 100 %-färgen som kan äga respektive dekorfärgsnamn (<namedcolor>), så att toningar kan peka på den.
  const spotOwner = new Map<string, number>();
  sorted.forEach((color, priority) => {
    const seps = color.spot?.separations;
    if (seps && seps.length === 1 && seps[0]!.factor >= 0.999 && seps[0]!.name && !spotOwner.has(seps[0]!.name)) {
      spotOwner.set(seps[0]!.name, priority);
    }
  });

  const xml = sorted.map((color, priority) => {
    const c = round(color.cmyk.c, 4);
    const m = round(color.cmyk.m, 4);
    const y = round(color.cmyk.y, 4);
    const k = round(color.cmyk.k, 4);
    const rgb = color.rgb ?? rgbFromCmyk(color.cmyk);
    const opacity = round(color.opacity, 4);

    let spotXml = "";
    const seps = color.spot?.separations;
    if (seps && seps.length > 0) {
      const knockoutAttr = color.spot?.overprint ? "" : ` knockout="true"`;
      if (seps.length === 1 && spotOwner.get(seps[0]!.name) === priority) {
        spotXml = `<spotcolors${knockoutAttr}><namedcolor>${escapeXml(seps[0]!.name)}</namedcolor></spotcolors>`;
      } else {
        const comps = seps
          .map(sep => {
            const ref = spotOwner.get(sep.name);
            return ref !== undefined ? `<component spotcolor="${ref}" factor="${round(sep.factor, 4)}"/>` : "";
          })
          .filter(Boolean);
        if (comps.length > 0) spotXml = `<spotcolors${knockoutAttr}>${comps.join("")}</spotcolors>`;
      }
    }

    const overprintAttr = !spotXml && color.overprint ? ` overprint="true"` : "";
    return `<color priority="${priority}" name="${escapeXml(color.name)}" c="${c}" m="${m}" y="${y}" k="${k}" opacity="${opacity}"${overprintAttr}>` +
      `${spotXml}<cmyk method="custom"/><rgb method="cmyk" r="${round(rgb.r, 3)}" g="${round(rgb.g, 3)}" b="${round(rgb.b, 3)}"/></color>`;
  });

  return { xml, idToPriority };
}

class OmapSymbolSerializer {
  constructor(
    private readonly colorOf: (id: number | undefined) => number,
    private readonly warnings: ConversionWarningCollector
  ) {}

  pointBody(elements: readonly PointElement[], rotatable: boolean): string {
    if (elements.length === 1) {
      const only = elements[0]!;
      if ((only.kind === "dot" || only.kind === "circle") && Math.abs(only.center.x) < 1e-6 && Math.abs(only.center.y) < 1e-6) {
        if (only.kind === "dot") {
          return `<point_symbol rotatable="${rotatable}" inner_radius="${um(only.diameter / 2)}" inner_color="${this.colorOf(only.color)}" outer_width="0" outer_color="-1" elements="0"/>`;
        }
        // MapSymbol circle.diameter = mittlinjens diameter = 2 * inner_radius + outer_width => inner_radius = (diameter - lineWidth) / 2.
        const innerRadius = Math.max(0, (only.diameter - only.lineWidth) / 2);
        return `<point_symbol rotatable="${rotatable}" inner_radius="${um(innerRadius)}" inner_color="-1" outer_width="${um(only.lineWidth)}" outer_color="${this.colorOf(only.color)}" elements="0"/>`;
      }
    }
    const items = elements.map(el => `<element>${this.element(el)}</element>`).join("");
    return `<point_symbol rotatable="${rotatable}" inner_radius="0" inner_color="-1" outer_width="0" outer_color="-1" elements="${elements.length}">${items}</point_symbol>`;
  }

  private element(el: PointElement): string {
    if (el.kind === "dot" || el.kind === "circle") {
      const centered: PointElement = el.kind === "dot"
        ? { kind: "dot", color: el.color, center: { x: 0, y: 0 }, diameter: el.diameter }
        : { kind: "circle", color: el.color, center: { x: 0, y: 0 }, diameter: el.diameter, lineWidth: el.lineWidth };
      return `<symbol type="1">${this.pointBody([centered], false)}</symbol>` +
        `<object type="0"><coords count="1">${mx(el.center.x)} ${my(el.center.y)};</coords></object>`;
    }
    if (el.kind === "line") {
      const coords = mapperCoords(splitParts(el.path), false);
      const stroke: StrokeStyle = { color: el.color, width: el.width, cap: el.cap, join: el.join };
      return `<symbol type="2">${this.singleLineBody([stroke])}</symbol>` +
        `<object type="1"><coords count="${coords.count}">${coords.text}</coords></object>`;
    }
    const coords = mapperCoords(el.rings, true);
    return `<symbol type="4"><area_symbol inner_color="${this.colorOf(el.color)}" min_area="0" patterns="0"/></symbol>` +
      `<object type="1"><coords count="${coords.count}">${coords.text}</coords></object>`;
  }

  lineSymbolXml(symbol: LineSymbol, id: string, code: string, name: string, hidden: boolean): string {
    if (symbol.between) this.warnings.add("SECONDARY_SYMBOL_DROPPED", 1);
    const centerStrokes = symbol.strokes.filter(s => !s.offset);
    const hiddenAttr = hidden ? ` is_hidden="true"` : "";
    // Om linjen har 2 centrerade streck (t.ex. OCAD framing + huvudlinje): kombinerad symbol med 2 privata linjedelar.
    if (centerStrokes.length >= 2) {
      const borders = symbol.strokes.filter(s => Boolean(s.offset));
      const parts = centerStrokes.map((st, idx) => {
        const isLast = idx === centerStrokes.length - 1;
        const body = isLast
          ? this.singleLineBody([st, ...borders], symbol)
          : this.singleLineBody([st]);
        return `<part private="true"><symbol type="2" code="" name="">${body}</symbol></part>`;
      });
      return `<symbol type="16" id="${id}" code="${escapeXml(code)}" name="${escapeXml(name)}"${hiddenAttr}><combined_symbol parts="${parts.length}">${parts.join("")}</combined_symbol></symbol>`;
    }
    return `<symbol type="2" id="${id}" code="${escapeXml(code)}" name="${escapeXml(name)}"${hiddenAttr}>${this.singleLineBody(symbol.strokes, symbol)}</symbol>`;
  }

  singleLineBody(
    strokes: readonly StrokeStyle[],
    decorations?: Pick<LineSymbol, "repeated" | "between" | "corner" | "start" | "end">
  ): string {
    const main = strokes.find(s => !s.offset);
    const left = strokes.find(s => (s.offset ?? 0) > 0);
    const right = strokes.find(s => (s.offset ?? 0) < 0);
    const hasBorders = Boolean(left || right);

    const cap = CAP[main?.cap ?? left?.cap ?? right?.cap ?? "butt"];
    const join = JOIN[main?.join ?? left?.join ?? right?.join ?? "miter"];
    const mainWidth = main ? main.width : hasBorders ? (left && right ? Math.abs(left.offset!) + Math.abs(right.offset!) : Math.abs((left ?? right)!.offset!) * 2) : 0;

    let dashed = false;
    let dashLength = 4000;
    let breakLength = 1000;
    let dashesInGroup = 1;
    let inGroupBreak = 500;
    let halfOuter = false;

    if (main?.dashSpec) {
      dashed = true;
      const spec = main.dashSpec;
      if (spec.secondaryGap && spec.secondaryGap > 0) {
        dashesInGroup = 2;
        inGroupBreak = um(spec.secondaryGap);
        dashLength = Math.max(10, um((spec.mainLength - spec.secondaryGap) / 2));
      } else {
        dashLength = Math.max(10, um(spec.mainLength));
      }
      breakLength = Math.max(0, um(spec.mainGap));
      halfOuter = spec.endLength < spec.mainLength * 0.75;
    } else if (main?.dash && main.dash.length >= 2) {
      dashed = true;
      if (main.dash.length >= 4) {
        dashesInGroup = 2;
        dashLength = Math.max(10, um(main.dash[0]!));
        inGroupBreak = Math.max(0, um(main.dash[1]!));
        breakLength = Math.max(0, um(main.dash[3]!));
      } else {
        dashLength = Math.max(10, um(main.dash[0]!));
        breakLength = Math.max(0, um(main.dash[1]!));
      }
    }

    const rep = decorations?.repeated;
    const count = Math.max(1, rep?.count ?? 1);
    const groupDist = rep?.groupSpacing ?? 0;
    const spread = (count - 1) * groupDist;
    const segmentLen = rep ? Math.max(0, rep.spacing - spread) : 0;
    const endLen = rep ? Math.max(0, (rep.endLength ?? rep.spacing / 2) - spread / 2) : 0;

    const attrs = [
      `color="${main ? this.colorOf(main.color) : -1}"`,
      `line_width="${um(mainWidth)}"`,
      `minimum_length="0"`,
      `join_style="${join}"`,
      `cap_style="${cap}"`,
      `start_offset="0"`,
      `end_offset="0"`,
      ...(dashed ? [`dashed="true"`] : []),
      ...(dashed && halfOuter ? [`half_outer_dashes="true"`] : []),
      `segment_length="${um(segmentLen)}"`,
      `end_length="${um(endLen)}"`,
      `show_at_least_one_symbol="${rep && (rep.minimum ?? 0) > 0 ? "true" : "false"}"`,
      `minimum_mid_symbol_count="${rep?.minimum ?? 0}"`,
      `minimum_mid_symbol_count_when_closed="0"`,
      ...(rep && dashed ? [`mid_symbol_placement="2"`] : []),
      `dash_length="${dashLength}"`,
      `break_length="${breakLength}"`,
      `dashes_in_group="${dashesInGroup}"`,
      `in_group_break_length="${inGroupBreak}"`,
      `mid_symbols_per_spot="${count}"`,
      `mid_symbol_distance="${um(groupDist)}"`,
      ...(decorations?.corner?.stretch === false ? [`scale_dash_symbol="false"`] : []),
      ...(decorations?.corner?.skipEnds ? [`suppress_dash_symbol_at_ends="true"`] : []),
      ...(hasBorders ? [`have_border_lines="true"`] : [])
    ];

    const children: string[] = [];
    if (decorations?.start) {
      children.push(`<start_symbol><symbol type="1">${this.pointBody(decorations.start.elements, true)}</symbol></start_symbol>`);
    }
    if (rep) {
      children.push(`<mid_symbol><symbol type="1">${this.pointBody(rep.elements, true)}</symbol></mid_symbol>`);
    }
    if (decorations?.end) {
      children.push(`<end_symbol><symbol type="1">${this.pointBody(decorations.end.elements, true)}</symbol></end_symbol>`);
    }
    if (decorations?.corner) {
      children.push(`<dash_symbol><symbol type="1">${this.pointBody(decorations.corner.elements, true)}</symbol></dash_symbol>`);
    }
    if (hasBorders) {
      const borderTag = (b: StrokeStyle) => {
        const shift = Math.abs(b.offset ?? 0) - mainWidth / 2;
        const bDashed = Boolean(b.dash && b.dash.length >= 2);
        return `<border color="${this.colorOf(b.color)}" width="${um(b.width)}" shift="${um(shift)}" dashed="${bDashed}" ` +
          `dash_length="${bDashed ? um(b.dash![0]!) : 2000}" break_length="${bDashed ? um(b.dash![1]!) : 1000}"/>`;
      };
      const sameBoth = left && right && left.color === right.color && Math.abs(left.width - right.width) < 1e-4
        && Math.abs(Math.abs(left.offset!) - Math.abs(right.offset!)) < 1e-4
        && JSON.stringify(left.dash ?? null) === JSON.stringify(right.dash ?? null);
      if (sameBoth) {
        children.push(`<borders>${borderTag(left)}</borders>`);
      } else {
        const list = [
          left ? borderTag(left) : `<border color="-1" width="0" shift="0" dashed="false" dash_length="2000" break_length="1000"/>`,
          right ? borderTag(right) : `<border color="-1" width="0" shift="0" dashed="false" dash_length="2000" break_length="1000"/>`
        ];
        children.push(`<borders>${list.join("")}</borders>`);
      }
    }
    return `<line_symbol ${attrs.join(" ")}>${children.join("")}</line_symbol>`;
  }

  areaSymbolXml(symbol: AreaSymbol, id: string, code: string, name: string, hidden: boolean): string {
    const patterns: string[] = [];
    for (const hatch of symbol.hatches) {
      patterns.push(
        `<pattern type="1" angle="${radians(hatch.angle)}" line_spacing="${um(hatch.spacing)}" ` +
          `line_offset="0" offset_along_line="0" color="${this.colorOf(hatch.color)}" line_width="${um(hatch.width)}"/>`
      );
    }
    if (symbol.pattern && symbol.pattern.elements.length > 0 && symbol.pattern.dx > 0 && symbol.pattern.dy > 0) {
      if (symbol.pattern.irregular) this.warnings.add("IRREGULAR_PATTERN_REGULARIZED", 1);
      patterns.push(
        `<pattern type="2" angle="${radians(symbol.pattern.angle ?? 0)}" line_spacing="${um(symbol.pattern.dy)}" ` +
          `line_offset="0" offset_along_line="0" point_distance="${um(symbol.pattern.dx)}">` +
          `<symbol type="1">${this.pointBody(symbol.pattern.elements, false)}</symbol></pattern>`
      );
    }
    const areaBody = `<area_symbol inner_color="${this.colorOf(symbol.fill)}" min_area="0" patterns="${patterns.length}">${patterns.join("")}</area_symbol>`;
    const hiddenAttr = hidden ? ` is_hidden="true"` : "";
    const hasBorder = Boolean(symbol.border && symbol.border.length > 0) || Boolean(symbol.borderDecorations);
    if (!hasBorder) {
      return `<symbol type="4" id="${id}" code="${escapeXml(code)}" name="${escapeXml(name)}"${hiddenAttr}>${areaBody}</symbol>`;
    }
    if (symbol.borderDecorations?.between) this.warnings.add("SECONDARY_SYMBOL_DROPPED", 1);
    const borderBody = this.singleLineBody(symbol.border ?? [], symbol.borderDecorations);
    return `<symbol type="16" id="${id}" code="${escapeXml(code)}" name="${escapeXml(name)}"${hiddenAttr}><combined_symbol parts="2">` +
      `<part private="true"><symbol type="4" code="" name="">${areaBody}</symbol></part>` +
      `<part private="true"><symbol type="2" code="" name="">${borderBody}</symbol></part>` +
      `</combined_symbol></symbol>`;
  }

  textSymbolXml(symbol: TextSymbol, id: string, code: string, name: string, hidden: boolean): string {
    const hiddenAttr = hidden ? ` is_hidden="true"` : "";
    const framingXml = symbol.framing && symbol.framing.width > 0
      ? `<framing mode="1" color="${this.colorOf(symbol.framing.color)}" line_half_width="${um(symbol.framing.width / 2)}"/>`
      : "";
    return `<symbol type="8" id="${id}" code="${escapeXml(code)}" name="${escapeXml(name)}"${hiddenAttr}><text_symbol icon_text="A">` +
      `<font family="${escapeXml(symbol.fontFamily || "Arial")}" size="${um(symbol.size)}"${symbol.bold ? ` bold="true"` : ""}${symbol.italic ? ` italic="true"` : ""}/>` +
      `<text color="${this.colorOf(symbol.color)}" line_spacing="${round(symbol.lineSpacing ?? 1.15, 3)}" paragraph_spacing="0" character_spacing="0"/>` +
      `${framingXml}</text_symbol></symbol>`;
  }
}

/**
 * Konverterar valfri `ParsedMap` (t.ex. från `.ocd`) till en giltig OpenOrienteering Mapper XML v9 `.omap`-fil
 * + `MapConversionReport` med eventuella formatgapsvarningar.
 */
export function convertMapToOmap(map: ParsedMap, options: ConvertToOmapOptions = {}): ConvertMapResult {
  const warnings = new ConversionWarningCollector();
  const { xml: colorXmlLines, idToPriority } = buildColorsXml(map.colors);
  const colorOf = (id: number | undefined): number => {
    if (id === undefined) return -1;
    return idToPriority.get(id) ?? -1;
  };

  // 1. Georeferens.
  let georefXml: string;
  if (map.georeference) {
    const g = map.georeference;
    const grivation = round(g.grivationDegrees, 4);
    const auxFactor = round(g.combinedScaleFactor, 6);
    const mapRefXml = `<ref_point x="${round(g.mapRefPoint.x, 4)}" y="${round(-g.mapRefPoint.y, 4)}"/>`;
    if (g.crs.kind === "EPSG") {
      const code = g.crs.code;
      let declination = grivation;
      let geographicXml = "";
      if (isSupportedEpsg(code)) {
        const wgs = projectedToWgs84(g.crs, g.refPoint.easting, g.refPoint.northing);
        if (code === 3006) declination = round(grivation + gridConvergenceDegrees(g.refPoint), 4);
        geographicXml = `<geographic_crs id="Geographic coordinates"><spec language="PROJ.4">+proj=latlong +datum=WGS84</spec>` +
          `<ref_point_deg lat="${round(wgs.latitude, 8)}" lon="${round(wgs.longitude, 8)}"/></geographic_crs>`;
      }
      georefXml = `<georeferencing scale="${g.scale}" auxiliary_scale_factor="${auxFactor}" declination="${declination}" grivation="${grivation}">` +
        `${mapRefXml}<projected_crs id="EPSG"><spec language="PROJ.4">+init=epsg:${code}</spec><parameter>${code}</parameter>` +
        `<ref_point x="${round(g.refPoint.easting, 3)}" y="${round(g.refPoint.northing, 3)}"/></projected_crs>${geographicXml}</georeferencing>`;
    } else {
      warnings.add("CRS_UNKNOWN", 1);
      georefXml = `<georeferencing scale="${g.scale}" auxiliary_scale_factor="${auxFactor}" declination="${grivation}" grivation="${grivation}">` +
        `${mapRefXml}<projected_crs id="Local"><spec language="PROJ.4">${escapeXml(g.crs.description)}</spec>` +
        `<ref_point x="${round(g.refPoint.easting, 3)}" y="${round(g.refPoint.northing, 3)}"/></projected_crs></georeferencing>`;
    }
  } else {
    georefXml = `<georeferencing scale="${map.scale}" auxiliary_scale_factor="1" declination="0" grivation="0"><ref_point x="0" y="0"/></georeferencing>`;
  }

  // 2. Symboler (tilldela rena sekventiella id:n 0..M-1; vänta med COMBINED tills delsymboler har id).
  const directUsed = new Set(map.objects.map(obj => obj.symbol));
  const privateSubIds = new Set<string>();
  for (const sym of map.symbols.values()) {
    if (sym.kind !== "COMBINED") continue;
    for (const partId of sym.parts) {
      if (partId.startsWith(`${sym.id}.`) && !directUsed.has(partId)) privateSubIds.add(partId);
    }
  }

  const orderedSymbols = [...map.symbols.values()].filter(sym => !privateSubIds.has(sym.id));
  const symbolIdMap = new Map<string, string>();
  orderedSymbols.forEach((sym, idx) => symbolIdMap.set(sym.id, String(idx)));
  // Om någon COMBINED pekar på en privat subsymbol, ge den ett eget id efter de ordinarie.
  let extraId = orderedSymbols.length;
  for (const sym of map.symbols.values()) {
    if (!symbolIdMap.has(sym.id)) symbolIdMap.set(sym.id, String(extraId++));
  }

  const serializer = new OmapSymbolSerializer(colorOf, warnings);
  const symbolXmlLines: string[] = [];
  const emittedSymbolIds = new Set<string>();

  const emitSymbol = (sym: MapSymbol) => {
    const mappedId = symbolIdMap.get(sym.id)!;
    if (emittedSymbolIds.has(mappedId)) return;
    emittedSymbolIds.add(mappedId);
    const code = symbolCodeText(sym);
    if (sym.kind === "POINT") {
      const hiddenAttr = sym.hidden ? ` is_hidden="true"` : "";
      symbolXmlLines.push(`<symbol type="1" id="${mappedId}" code="${escapeXml(code)}" name="${escapeXml(sym.name)}"${hiddenAttr}>${serializer.pointBody(sym.elements, true)}</symbol>`);
    } else if (sym.kind === "LINE") {
      symbolXmlLines.push(serializer.lineSymbolXml(sym, mappedId, code, sym.name, sym.hidden));
    } else if (sym.kind === "AREA") {
      symbolXmlLines.push(serializer.areaSymbolXml(sym, mappedId, code, sym.name, sym.hidden));
    } else if (sym.kind === "TEXT") {
      symbolXmlLines.push(serializer.textSymbolXml(sym, mappedId, code, sym.name, sym.hidden));
    } else {
      const hiddenAttr = sym.hidden ? ` is_hidden="true"` : "";
      const partsXml = sym.parts
        .map(partId => {
          const partSym = map.symbols.get(partId);
          if (!partSym) return "";
          emitSymbol(partSym);
          return `<part symbol="${symbolIdMap.get(partId)!}"/>`;
        })
        .filter(Boolean);
      symbolXmlLines.push(`<symbol type="16" id="${mappedId}" code="${escapeXml(code)}" name="${escapeXml(sym.name)}"${hiddenAttr}><combined_symbol parts="${partsXml.length}">${partsXml.join("")}</combined_symbol></symbol>`);
    }
  };

  for (const sym of orderedSymbols) emitSymbol(sym);

  // 3. Objekt.
  const objectXmlLines: string[] = [];
  let skippedObjects = 0;

  for (const obj of map.objects) {
    const symId = symbolIdMap.get(obj.symbol);
    const sym = map.symbols.get(obj.symbol);
    if (!symId || !sym) {
      skippedObjects += 1;
      warnings.add("OBJECT_SKIPPED", 1);
      continue;
    }

    if (obj.kind === "point") {
      const rot = obj.angle ? ` rotation="${radians(obj.angle)}"` : "";
      objectXmlLines.push(`<object type="0" symbol="${symId}"${rot}><coords count="1">${mx(obj.at.x)} ${my(obj.at.y)};</coords></object>`);
    } else if (obj.kind === "text") {
      if (sym.kind === "TEXT" && sym.lineText) warnings.add("LINE_TEXT_SIMPLIFIED", 1);
      const rot = obj.angle ? ` rotation="${radians(obj.angle)}"` : "";
      const hAlign = sym.kind === "TEXT" ? (sym.align === "center" ? 1 : sym.align === "right" ? 2 : 0) : 0;
      const vAlign = sym.kind === "TEXT" ? (sym.baseline === "top" ? 1 : sym.baseline === "middle" ? 2 : 0) : 0;
      objectXmlLines.push(
        `<object type="4" symbol="${symId}"${rot} h_align="${hAlign}" v_align="${vAlign}">` +
          `<coords count="1">${mx(obj.at.x)} ${my(obj.at.y)};</coords><text>${escapeXml(obj.text)}</text></object>`
      );
    } else if (obj.kind === "line") {
      const parts = splitParts(obj.path).filter(p => p.length > 1);
      if (parts.length === 0) {
        skippedObjects += 1;
        warnings.add("OBJECT_SKIPPED", 1);
        continue;
      }
      if (pathHasGaps(parts)) warnings.add("OCAD_GAPS_DROPPED", 1);
      const coords = mapperCoords(parts, false);
      objectXmlLines.push(`<object type="1" symbol="${symId}"><coords count="${coords.count}">${coords.text}</coords></object>`);
    } else {
      const rings = obj.rings.filter(r => r.length >= 2);
      if (rings.length === 0) {
        skippedObjects += 1;
        warnings.add("OBJECT_SKIPPED", 1);
        continue;
      }
      if (pathHasGaps(rings)) warnings.add("OCAD_GAPS_DROPPED", 1);
      const coords = mapperCoords(rings, true);
      const pattern = obj.angle ? `<pattern rotation="${radians(obj.angle)}"><coord x="0" y="0"/></pattern>` : "";
      objectXmlLines.push(`<object type="1" symbol="${symId}"><coords count="${coords.count}">${coords.text}</coords>${pattern}</object>`);
    }
  }

  // 4. Sätt ihop komplett Mapper XML v9.
  const cx = map.bounds ? (map.bounds.minX + map.bounds.maxX) / 2 : 0;
  const cy = map.bounds ? (map.bounds.minY + map.bounds.maxY) / 2 : 0;
  const notes = options.notes ?? `Konverterad från ${map.version} i O-Tid.`;

  const xml = [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<map xmlns="http://openorienteering.org/apps/mapper/xml/v2" version="9">`,
    `<notes>${escapeXml(notes)}</notes>`,
    georefXml,
    `<colors count="${colorXmlLines.length}">`,
    ...colorXmlLines,
    `</colors>`,
    `<barrier version="6" required="0.6.0">`,
    `<symbols count="${symbolXmlLines.length}">`,
    ...symbolXmlLines,
    `</symbols>`,
    `<parts count="1" current="0"><part name="Karta"><objects count="${objectXmlLines.length}">`,
    ...objectXmlLines,
    `</objects></part></parts>`,
    `<templates count="0" first_front_template="0"><defaults use_meters_per_pixel="true" meters_per_pixel="0" dpi="0" scale="0"/></templates>`,
    `<view><grid color="#80646464" display="0" alignment="0" additional_rotation="0" unit="1" h_spacing="500" v_spacing="500" ` +
      `h_offset="0" v_offset="0" snapping_enabled="true"/><map_view zoom="1" position_x="${mx(cx)}" position_y="${my(cy)}"><map opacity="1" visible="true"/>` +
      `<templates count="0"/></map_view></view>`,
    `</barrier>`,
    `</map>`,
    ``
  ].join("\n");

  return {
    bytes: new TextEncoder().encode(xml),
    report: {
      sourceFormat: map.format,
      targetFormat: "OMAP",
      colors: colorXmlLines.length,
      symbols: symbolXmlLines.length,
      objects: objectXmlLines.length,
      skippedObjects,
      warnings: warnings.list()
    }
  };
}
