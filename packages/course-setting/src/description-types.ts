/**
 * Steg 63 (ADR-0180): kontrollbeskrivningar. Symbolerna och texterna kommer ur Purple Pens `symbols.xml` (BSD, se
 * NOTICE.md). Beskrivningen läggs ut som enkla figurer i millimeter på papperet, med y NEDÅT (som SVG och en utskriven
 * sida), så att samma figurer kan ritas på skärmen, i en SVG för utskrift och senare i PDF (steg 65).
 */
import type { DescriptionBox } from "./types";

/**
 * Språk för texter och textbeskrivningar: "sv", "en", "nb-NO" (även "nb"), "fi" och "de" finns (`DESCRIPTION_LANGUAGES`).
 * Ett annat språk ger engelska.
 */
export type DescriptionLanguage = "sv" | "en" | (string & {});

/** Hur beskrivningen visas: symboler, text eller båda (Purple Pens symbols / text / symbols-and-text). */
export type DescriptionKind = "SYMBOLS" | "TEXT" | "SYMBOLS_AND_TEXT";

/**
 * En figur i en symbol, i symbolens ruta: 200 × 200 enheter med (0,0) i mitten och y UPPÅT (som symbols.xml). Symboler
 * för hela rader (slag "V"–"Z": mål, passage, snitslar, kartbyte) är 1600 × 200 enheter, alltså åtta rutor breda.
 * Linjerna har runda ändar och hörn om inte `ends: "flat"` eller `corners: "sharp"` (gering, gräns 5) anges. `bezier` är
 * punkt, styrpunkt, styrpunkt, punkt … (3n + 1 punkter); `filled` fylls (bredd 0). `polygon` fylls (jämn–udda).
 */
export type SymbolShape =
  | { readonly kind: "polyline"; readonly points: readonly { readonly x: number; readonly y: number }[]; readonly width: number; readonly closed?: boolean | undefined; readonly ends?: "flat" | undefined; readonly corners?: "sharp" | undefined }
  | { readonly kind: "polygon"; readonly points: readonly { readonly x: number; readonly y: number }[] }
  | { readonly kind: "circle"; readonly center: { readonly x: number; readonly y: number }; readonly radius: number; readonly width: number }
  | { readonly kind: "disc"; readonly center: { readonly x: number; readonly y: number }; readonly radius: number }
  | { readonly kind: "bezier"; readonly points: readonly { readonly x: number; readonly y: number }[]; readonly width: number; readonly filled?: boolean | undefined; readonly ends?: "flat" | undefined };

/** En symbol i kontrollbeskrivningen (IOF 2004/2018). */
export interface DescriptionSymbol {
  /** Purple Pens id, samma som `DescriptionBox.ref` ("2.4", "0.1N", "14.2" …). */
  readonly id: string;
  /** Purple Pens `kind`: vilken ruta symbolen hör till ("C"–"H"), eller "T"/"X"/"Y"/"Z" för hela rader. */
  readonly kind: string;
  /** Saknas = gäller båda standarderna; annars ritningen för den standarden. */
  readonly standard?: "2004" | "2018" | undefined;
  /** Namn i väljaren per språk. */
  readonly names: Readonly<Record<string, string>>;
  readonly shapes: readonly SymbolShape[];
}

/**
 * En figur i en utlagd beskrivning, i mm på papperet med y nedåt; hela beskrivningen ryms i (0,0)–(widthMm,heightMm).
 * - `line`: rak linje med platta ändar (`width` i mm).
 * - `symbol`: symbolen `symbol` (id i `descriptionSymbols`) med rutans mitt i `at` och rutans sida `size` mm; en
 *   symbolenhet blir `size / 200` mm (y vänds), så en radsymbol (1600 enheter) blir åtta rutor bred.
 * - `text`: `at.x` är vänsterkant, mitt eller högerkant enligt `align`, `at.y` är BASLINJEN; `heightMm` är em-höjden
 *   (font-size). `condensed` = smalt typsnitt (Purple Pen: Roboto Condensed, annars Roboto). Bredden är uppskattad:
 *   blir texten bredare än `maxWidth` ska ritaren trycka ihop den (t.ex. SVG `textLength`).
 * - `hit`: markerbar yta för editorn, ritas inte. `ref` = kontrollens id; `box` = "C"–"H" för en ruta, "all" för
 *   riktningsradens symbol (mål, passage), "before"/"after" för kontrollens textrader; utan `box` = hela raden.
 * `ref` på symbol och text = kontrollen raden hör till.
 */
export type DescriptionPrimitive =
  | { readonly kind: "line"; readonly from: { readonly x: number; readonly y: number }; readonly to: { readonly x: number; readonly y: number }; readonly width: number }
  | { readonly kind: "symbol"; readonly symbol: string; readonly at: { readonly x: number; readonly y: number }; readonly size: number; readonly ref?: string | undefined }
  | { readonly kind: "text"; readonly at: { readonly x: number; readonly y: number }; readonly text: string; readonly heightMm: number; readonly bold?: boolean | undefined; readonly condensed?: boolean | undefined; readonly align: "left" | "center" | "right"; readonly maxWidth?: number | undefined; readonly ref?: string | undefined }
  /** En markerbar yta (kontrollens rad, en ruta) för editorn; ritas inte. */
  | { readonly kind: "hit"; readonly x: number; readonly y: number; readonly width: number; readonly height: number; readonly ref: string; readonly box?: string | undefined };

export interface DescriptionLayoutOptions {
  /** Banans id, eller "ALL_CONTROLS". */
  readonly course: string;
  /** Variant för gafflad bana; saknas = alla grenar som Purple Pen skriver dem. */
  readonly variant?: string | undefined;
  readonly kind: DescriptionKind;
  readonly language: DescriptionLanguage;
  /** Rutans storlek i mm (IOF: 5–7 mm, Purple Pen 6 mm som standard). */
  readonly boxMm?: number | undefined;
  /** Steg 64: antal spalter (beskrivningen på kartan, Purple Pens `<appearance columns>`); saknas = 1. */
  readonly columns?: number | undefined;
  /** Kartbyten (ADR-0203): en del av banan; saknas = hela banan. */
  readonly part?: number | undefined;
}

export interface DescriptionLayout {
  readonly widthMm: number;
  readonly heightMm: number;
  readonly primitives: readonly DescriptionPrimitive[];
}

/** Ändringar i beskrivningen (läggs till i `CourseSettingEdit`). */
export type DescriptionEdit =
  | { readonly type: "SET_DESCRIPTION"; readonly control: string; readonly boxes: readonly DescriptionBox[] }
  /** Textrad före eller efter kontrollens rad (Purple Pens description-text-line), null tar bort. */
  | { readonly type: "SET_DESCRIPTION_TEXT_LINE"; readonly control: string; readonly location: "before" | "after"; readonly text: string | null };
