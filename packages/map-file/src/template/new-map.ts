import { geodeticToGrid, gridToGeodetic, transverseMercatorFor, type ProjectedPoint } from "../georef";
import { ISOM_2017_2 } from "./isom-2017-2";
import { ISSPROM_2019_2 } from "./issprom-2019-2";
import type { ElementDef, SymbolDef, SymbolSetDef, XY } from "./symbol-def";

/**
 * ADR-0219 (K1, nya kartor): en tom Mapper-karta (.omap, XML version 9) med O-Tids symbolset, skala och georeferens i
 * SWEREF 99 TM. Kartans 0,0 är referenspunkten (områdets mitt). Kartan vrids mot magnetisk nord: grivationen är
 * missvisningen minus meridiankonvergensen i referenspunkten. Ren funktion utan I/O.
 */
export const SYMBOL_SETS = { "ISOM2017-2": ISOM_2017_2, "ISSPROM2019-2": ISSPROM_2019_2 } as const;
export type SymbolSetId = keyof typeof SYMBOL_SETS;

export interface NewMapOptions {
  readonly symbolSet: SymbolSetId;
  /** En av symbolsetets skalor. */
  readonly scale: number;
  /** Referenspunkten i SWEREF 99 TM (EPSG:3006). */
  readonly refPoint: ProjectedPoint;
  /** Magnetisk missvisning i grader (östlig positiv); 0 ger en karta mot nätnord. */
  readonly declinationDegrees?: number | undefined;
  /** Kort text i kartans anteckningar. */
  readonly notes?: string | undefined;
}

export class NewMapError extends Error {
  constructor(readonly code: "SCALE" | "POINT", message: string) { super(message); this.name = "NewMapError"; }
}

const SWEREF99TM = 3006;

/**
 * Meridiankonvergensen γ (grader) i en punkt i SWEREF 99 TM: vinkeln medurs från sann nord till nätnord, positiv öster om
 * medelmeridianen (15° Ö), där meridianen lutar mot väster norrut.
 */
export function gridConvergenceDegrees(point: ProjectedPoint): number {
  const projection = transverseMercatorFor(SWEREF99TM)!;
  const here = gridToGeodetic(projection, point.easting, point.northing);
  // Ett steg norrut längs meridianen: sann nords riktning i nätet, medurs från nätets y-axel.
  const north = geodeticToGrid(projection, here.latitude + 0.001, here.longitude);
  return -Math.atan2(north.easting - point.easting, north.northing - point.northing) * 180 / Math.PI;
}

export function newMapFile(options: NewMapOptions): Uint8Array {
  const set: SymbolSetDef = SYMBOL_SETS[options.symbolSet];
  const scale = set.scales.find(entry => entry.scale === options.scale);
  if (!scale) throw new NewMapError("SCALE", `${set.name} har inte skalan 1:${options.scale}`);
  const { easting, northing } = options.refPoint;
  if (!Number.isFinite(easting) || !Number.isFinite(northing) || easting < 100_000 || easting > 1_000_000 || northing < 6_000_000 || northing > 7_800_000) {
    throw new NewMapError("POINT", "Referenspunkten ligger inte i Sverige (SWEREF 99 TM)");
  }
  const colorIndex = new Map(set.colors.map((color, index) => [color.key, index]));
  const writer = new SymbolWriter(scale.factor, colorIndex);
  const declination = options.declinationDegrees ?? 0;
  const grivation = round(declination - gridConvergenceDegrees(options.refPoint), 2);
  const deg = gridToGeodetic(transverseMercatorFor(SWEREF99TM)!, easting, northing);

  const xml = [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<map xmlns="http://openorienteering.org/apps/mapper/xml/v2" version="9">`,
    `<notes>${escapeXml(options.notes ?? `Ny karta från O-Tid, ${set.name} 1:${options.scale}.`)}</notes>`,
    `<georeferencing scale="${options.scale}" auxiliary_scale_factor="1" declination="${round(declination, 2)}" grivation="${grivation}">` +
      `<ref_point x="0" y="0"/>` +
      `<projected_crs id="EPSG"><spec language="PROJ.4">+init=epsg:3006</spec><parameter>3006</parameter>` +
      `<ref_point x="${round(easting, 2)}" y="${round(northing, 2)}"/></projected_crs>` +
      `<geographic_crs id="Geographic coordinates"><spec language="PROJ.4">+proj=latlong +datum=WGS84</spec>` +
      `<ref_point_deg lat="${round(deg.latitude, 8)}" lon="${round(deg.longitude, 8)}"/></geographic_crs></georeferencing>`,
    `<colors count="${set.colors.length}">`,
    ...set.colors.map((color, index) => {
      const [c, m, y, k] = color.cmyk;
      const rgb = [c, m, y].map(value => round((1 - value) * (1 - k), 3));
      return `<color priority="${index}" name="${escapeXml(color.name)}" c="${c}" m="${m}" y="${y}" k="${k}" opacity="1">` +
        `<cmyk method="custom"/><rgb method="cmyk" r="${rgb[0]}" g="${rgb[1]}" b="${rgb[2]}"/></color>`;
    }),
    `</colors>`,
    `<barrier version="6" required="0.6.0">`,
    `<symbols count="${set.symbols.length}" id="${set.id}">`,
    ...set.symbols.map((symbol, index) => writer.symbol(symbol, String(index))),
    `</symbols>`,
    `<parts count="1" current="0"><part name="förvald del"><objects count="0"></objects></part></parts>`,
    `<templates count="0" first_front_template="0"><defaults use_meters_per_pixel="true" meters_per_pixel="0" dpi="0" scale="0"/></templates>`,
    `<view><grid color="#80646464" display="0" alignment="0" additional_rotation="0" unit="1" h_spacing="500" v_spacing="500" ` +
      `h_offset="0" v_offset="0" snapping_enabled="true"/><map_view zoom="1" position_x="0" position_y="0"><map opacity="1" visible="true"/>` +
      `<templates count="0"/></map_view></view>`,
    `</barrier>`,
    `</map>`,
    ``
  ].join("\n");
  return new TextEncoder().encode(xml);
}

function round(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

function escapeXml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

const CAP = { butt: 0, round: 1, square: 2 } as const;
const JOIN = { bevel: 0, miter: 1, round: 2 } as const;

/** Skriver symbolerna som Mapper-XML; mått i 0,001 mm förstorade med skalans faktor. */
class SymbolWriter {
  constructor(private readonly factor: number, private readonly colors: ReadonlyMap<string, number>) {}

  private um(mm: number): number { return Math.round(mm * this.factor * 1000); }
  private color(key: string | undefined): number {
    if (key === undefined) return -1;
    const index = this.colors.get(key);
    if (index === undefined) throw new Error(`Okänd färg ${key}`);
    return index;
  }
  private coords(points: readonly XY[], closed: boolean): string {
    const all = closed ? [...points, points[0]!] : points;
    return `<coords count="${all.length}">${all.map(([x, y], index) =>
      `${this.um(x)} ${this.um(-y)}${closed && index === all.length - 1 ? " 18" : ""};`).join("")}</coords>`;
  }

  symbol(symbol: SymbolDef, id: string): string {
    const head = `type="${typeNumber(symbol)}" id="${id}" code="${symbol.code}" name="${escapeXml(symbol.name)}"`;
    switch (symbol.kind) {
      case "point": return `<symbol ${head}>${this.point(symbol.elements, symbol.rotatable ?? false)}</symbol>`;
      case "line": return `<symbol ${head}>${this.line(symbol)}</symbol>`;
      case "area": return `<symbol ${head}>${this.area(symbol)}</symbol>`;
      case "text":
        return `<symbol ${head}><text_symbol icon_text="A"><font family="Arial" size="${this.um(symbol.size)}"` +
          `${symbol.bold ? ` bold="true"` : ""}${symbol.italic ? ` italic="true"` : ""}/>` +
          `<text color="${this.color(symbol.color)}" line_spacing="1" paragraph_spacing="0" character_spacing="0"/></text_symbol></symbol>`;
    }
  }

  /** Punktsymbol: en ensam prick eller ring som mittcirkeln, annars element. */
  private point(elements: readonly ElementDef[], rotatable: boolean): string {
    const [only] = elements;
    if (elements.length === 1 && only && (only.kind === "dot" || only.kind === "ring") && !only.at) {
      const inner = only.kind === "dot" ? this.um(only.diameter / 2) : this.um((only.diameter - only.width) / 2);
      return `<point_symbol rotatable="${rotatable}" inner_radius="${inner}" inner_color="${only.kind === "dot" ? this.color(only.color) : -1}" ` +
        `outer_width="${only.kind === "ring" ? this.um(only.width) : 0}" outer_color="${only.kind === "ring" ? this.color(only.color) : -1}" elements="0"/>`;
    }
    return `<point_symbol rotatable="${rotatable}" inner_radius="0" inner_color="-1" outer_width="0" outer_color="-1" elements="${elements.length}">` +
      elements.map(element => `<element>${this.element(element)}</element>`).join("") + `</point_symbol>`;
  }

  private element(element: ElementDef): string {
    const [x, y] = element.kind === "dot" || element.kind === "ring" ? element.at ?? [0, 0] : [0, 0];
    switch (element.kind) {
      case "dot":
      case "ring":
        return `<symbol type="1">${this.point([centered(element)], false)}</symbol>` +
          `<object type="0"><coords count="1">${this.um(x)} ${this.um(-y)};</coords></object>`;
      case "line":
        return `<symbol type="2">${this.lineSymbol({ color: element.color, width: element.width, cap: element.round ? "round" : "butt", join: "miter" })}</symbol>` +
          `<object type="1">${this.coords(element.points, false)}</object>`;
      case "area":
        return `<symbol type="4"><area_symbol inner_color="${this.color(element.color)}" min_area="0" patterns="0"/></symbol>` +
          `<object type="1">${this.coords(element.points, true)}</object>`;
    }
  }

  private line(symbol: Extract<SymbolDef, { kind: "line" }>): string {
    return this.lineSymbol(symbol);
  }

  private lineSymbol(line: { color?: string | undefined; width?: number | undefined; dash?: readonly [number, number] | undefined;
    cap?: "butt" | "round" | "square" | undefined; join?: "miter" | "round" | "bevel" | undefined;
    border?: { color: string; width: number; dash?: readonly [number, number] | undefined } | undefined;
    mid?: { elements: readonly ElementDef[]; spacing: number } | undefined }): string {
    const dashed = !!line.dash;
    const attributes = [
      `color="${this.color(line.color)}"`, `line_width="${line.color ? this.um(line.width ?? 0) : 0}"`, `minimum_length="0"`,
      `join_style="${JOIN[line.join ?? "miter"]}"`, `cap_style="${CAP[line.cap ?? "butt"]}"`, `start_offset="0"`, `end_offset="0"`,
      ...(dashed ? [`dashed="true"`] : []),
      `segment_length="${line.mid ? this.um(line.mid.spacing) : 0}"`, `end_length="${line.mid ? this.um(line.mid.spacing / 2) : 0}"`,
      `show_at_least_one_symbol="true"`, `minimum_mid_symbol_count="0"`, `minimum_mid_symbol_count_when_closed="0"`,
      `dash_length="${dashed ? this.um(line.dash![0]) : 4000}"`, `break_length="${dashed ? this.um(line.dash![1]) : 1000}"`,
      `dashes_in_group="1"`, `in_group_break_length="500"`, `mid_symbols_per_spot="1"`, `mid_symbol_distance="0"`,
      ...(line.border ? [`have_border_lines="true"`] : [])
    ];
    const mid = line.mid ? `<mid_symbol><symbol type="1">${this.point(line.mid.elements, true)}</symbol></mid_symbol>` : "";
    const border = line.border
      ? `<borders><border color="${this.color(line.border.color)}" width="${this.um(line.border.width)}" shift="0" ` +
        `dashed="${!!line.border.dash}" dash_length="${line.border.dash ? this.um(line.border.dash[0]) : 2000}" ` +
        `break_length="${line.border.dash ? this.um(line.border.dash[1]) : 1000}"/></borders>`
      : "";
    return `<line_symbol ${attributes.join(" ")}>${mid}${border}</line_symbol>`;
  }

  private area(symbol: Extract<SymbolDef, { kind: "area" }>): string {
    const patterns: string[] = [];
    for (const hatch of symbol.hatches ?? []) {
      patterns.push(`<pattern type="1" angle="${round((hatch.angle ?? 0) * Math.PI / 180, 6)}" line_spacing="${this.um(hatch.spacing)}" ` +
        `line_offset="0" offset_along_line="0" color="${this.color(hatch.color)}" line_width="${this.um(hatch.width)}"/>`);
    }
    const dots = symbol.dots;
    if (dots) {
      const angle = round((dots.angle ?? 0) * Math.PI / 180, 6);
      // Förskjutna rader: två mönster med dubbla radavståndet, det andra en rad och en halv ruta förskjutet.
      const rows = dots.staggered ? [[0, 0], [dots.dx / 2, dots.dy]] as const : [[0, 0]] as const;
      const spacing = dots.staggered ? dots.dy * 2 : dots.dy;
      for (const [along, across] of rows) {
        patterns.push(`<pattern type="2" angle="${angle}" line_spacing="${this.um(spacing)}" ` +
          `line_offset="${this.um(across)}" offset_along_line="${this.um(along)}" point_distance="${this.um(dots.dx)}">` +
          `<symbol type="1">${this.point(dots.elements, false)}</symbol></pattern>`);
      }
    }
    return `<area_symbol inner_color="${this.color(symbol.fill)}" min_area="0" patterns="${patterns.length}">${patterns.join("")}</area_symbol>`;
  }
}

/** Pricken eller ringen utan egen plats (platsen blir elementets objekt). */
function centered(element: Extract<ElementDef, { kind: "dot" | "ring" }>): ElementDef {
  return element.kind === "dot" ? { kind: "dot", color: element.color, diameter: element.diameter }
    : { kind: "ring", color: element.color, diameter: element.diameter, width: element.width };
}

function typeNumber(symbol: SymbolDef): number {
  switch (symbol.kind) {
    case "point": return 1;
    case "line": return 2;
    case "area": return 4;
    case "text": return 8;
  }
}
