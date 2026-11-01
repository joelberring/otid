/**
 * Steg 63 (ADR-0180): kontrollbeskrivningar. Symbolerna och texterna kommer ur Purple Pens `symbols.xml` (BSD, se
 * NOTICE.md). Beskrivningen läggs ut som enkla figurer i millimeter på papperet, med y NEDÅT (som SVG och en utskriven
 * sida), så att samma figurer kan ritas på skärmen, i en SVG för utskrift och senare i PDF (steg 65).
 */
import type { DescriptionBox } from "./types";

/** Språk för texter och textbeskrivningar. Svenska och engelska krävs; fler får finnas. */
export type DescriptionLanguage = "sv" | "en" | (string & {});

/** Hur beskrivningen visas: symboler, text eller båda (Purple Pens symbols / text / symbols-and-text). */
export type DescriptionKind = "SYMBOLS" | "TEXT" | "SYMBOLS_AND_TEXT";

/** En figur i en symbol, i symbolens ruta: 200 × 200 enheter med (0,0) i mitten och y UPPÅT (som symbols.xml). */
export type SymbolShape =
  | { readonly kind: "polyline"; readonly points: readonly { readonly x: number; readonly y: number }[]; readonly width: number; readonly closed?: boolean | undefined }
  | { readonly kind: "polygon"; readonly points: readonly { readonly x: number; readonly y: number }[] }
  | { readonly kind: "circle"; readonly center: { readonly x: number; readonly y: number }; readonly radius: number; readonly width: number }
  | { readonly kind: "disc"; readonly center: { readonly x: number; readonly y: number }; readonly radius: number }
  | { readonly kind: "bezier"; readonly points: readonly { readonly x: number; readonly y: number }[]; readonly width: number; readonly filled?: boolean | undefined };

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

/** En figur i en utlagd beskrivning, i mm på papperet med y nedåt. */
export type DescriptionPrimitive =
  | { readonly kind: "line"; readonly from: { readonly x: number; readonly y: number }; readonly to: { readonly x: number; readonly y: number }; readonly width: number }
  | { readonly kind: "symbol"; readonly symbol: string; readonly at: { readonly x: number; readonly y: number }; readonly size: number; readonly ref?: string | undefined }
  | { readonly kind: "text"; readonly at: { readonly x: number; readonly y: number }; readonly text: string; readonly heightMm: number; readonly bold?: boolean | undefined; readonly align: "left" | "center" | "right"; readonly maxWidth?: number | undefined; readonly ref?: string | undefined }
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
