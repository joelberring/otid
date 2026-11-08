/**
 * ADR-0219 (K1, nya kartor): O-Tids egna symbolset i en kompakt form. Måtten är i mm på kartan vid normens grundskala
 * (ISOM 1:15 000, ISSprOM 1:4 000) med y uppåt; `new-map.ts` skalar dem och skriver Mapper-XML. Tabellerna är O-Tids
 * tolkning av normerna (IOF ISOM 2017-2 och ISSprOM 2019-2), inte Mappers symbolfiler (GPL), och ska kontrolleras mot normen
 * innan en karta trycks skarpt.
 */
export interface ColorDef {
  readonly key: string;
  readonly name: string;
  /** CMYK 0–1. */
  readonly cmyk: readonly [number, number, number, number];
}

export type XY = readonly [number, number];

/** Delar av en punktsymbol (mm, y uppåt, mitt i 0,0). */
export type ElementDef =
  | { readonly kind: "dot"; readonly color: string; readonly diameter: number; readonly at?: XY }
  | { readonly kind: "ring"; readonly color: string; readonly diameter: number; readonly width: number; readonly at?: XY }
  | { readonly kind: "line"; readonly color: string; readonly width: number; readonly points: readonly XY[]; readonly round?: boolean }
  | { readonly kind: "area"; readonly color: string; readonly points: readonly XY[] };

export interface HatchDef { readonly color: string; readonly width: number; readonly spacing: number; readonly angle?: number }
export interface DotPatternDef { readonly elements: readonly ElementDef[]; readonly dx: number; readonly dy: number; readonly angle?: number;
  /** Varannan rad (`dy` isär) förskjuten en halv ruta (som OCAD:s förskjutna rader). */
  readonly staggered?: boolean }

interface Base { readonly code: string; readonly name: string }
export type SymbolDef = Base & (
  | { readonly kind: "point"; readonly elements: readonly ElementDef[]; readonly rotatable?: boolean }
  | {
    readonly kind: "line"; readonly color?: string; readonly width?: number;
    /** Streck och mellanrum (mm). */
    readonly dash?: readonly [number, number];
    readonly cap?: "butt" | "round" | "square"; readonly join?: "miter" | "round" | "bevel";
    /** Kantlinjer på båda sidor (dubbellinje), `width` är då ytan mellan dem. */
    readonly border?: { readonly color: string; readonly width: number; readonly dash?: readonly [number, number] };
    /** Upprepad punktsymbol längs linjen, `spacing` mm isär (för en streckad linje: mitt i strecken). */
    readonly mid?: { readonly elements: readonly ElementDef[]; readonly spacing: number };
  }
  | { readonly kind: "area"; readonly fill?: string; readonly hatches?: readonly HatchDef[]; readonly dots?: DotPatternDef }
  | { readonly kind: "text"; readonly color: string; readonly size: number; readonly bold?: boolean; readonly italic?: boolean }
);

export interface SymbolSetDef {
  readonly id: "ISOM2017-2" | "ISSPROM2019-2";
  readonly name: string;
  /** Skalorna normen tillåter och hur mycket måtten förstoras vid var och en (ISOM 1:10 000 = 1,5). */
  readonly scales: readonly { readonly scale: number; readonly factor: number }[];
  /** Färgerna överst först (Mappers ordning: första färgen ritas överst). */
  readonly colors: readonly ColorDef[];
  readonly symbols: readonly SymbolDef[];
}

// Små byggstenar för tabellerna.
export const dot = (color: string, diameter: number, at?: XY): ElementDef => ({ kind: "dot", color, diameter, ...(at ? { at } : {}) });
export const ring = (color: string, diameter: number, width: number, at?: XY): ElementDef =>
  ({ kind: "ring", color, diameter, width, ...(at ? { at } : {}) });
export const stroke = (color: string, width: number, ...points: XY[]): ElementDef => ({ kind: "line", color, width, points });
export const fill = (color: string, ...points: XY[]): ElementDef => ({ kind: "area", color, points });
/** Kryss med armar `size` långa. */
export const cross = (color: string, size: number, width: number): ElementDef[] => {
  const half = size / 2;
  return [stroke(color, width, [-half, -half], [half, half]), stroke(color, width, [-half, half], [half, -half])];
};
/** Liksidig triangel med spetsen uppåt och sidan `side`. */
export const triangle = (color: string, side: number): ElementDef => {
  const h = side * Math.sqrt(3) / 2;
  return fill(color, [-side / 2, -h / 3], [side / 2, -h / 3], [0, 2 * h / 3]);
};
/** Ellips som månghörning. */
export const ellipse = (color: string, width: number, height: number): ElementDef =>
  fill(color, ...Array.from({ length: 16 }, (_, index): XY => {
    const angle = index / 16 * Math.PI * 2;
    return [Math.cos(angle) * width / 2, Math.sin(angle) * height / 2];
  }));
/** Båge (halvcirkel öppen uppåt eller nedåt). */
export const arc = (color: string, diameter: number, width: number, opening: "up" | "down"): ElementDef => {
  const sign = opening === "up" ? -1 : 1;
  return stroke(color, width, ...Array.from({ length: 9 }, (_, index): XY => {
    const angle = index / 8 * Math.PI;
    return [Math.cos(angle) * diameter / 2, sign * Math.sin(angle) * diameter / 2];
  }));
};
