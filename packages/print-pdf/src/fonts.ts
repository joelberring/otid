/**
 * Steg 65: typsnitten i PDF:en. Roboto och Roboto Condensed (SIL Open Font License 1.1, `fonts/OFL.txt`; inbäddning och
 * delmängd är tillåtna) bäddas in som delmängder, så att tryckeriet inte behöver ha dem. Purple Pen använder samma
 * typsnitt för banpåtrycket och beskrivningarna; kartans texter (ofta Arial) skrivs också med Roboto.
 */
import fontkit from "@pdf-lib/fontkit";
import type { PDFDocument, PDFFont } from "pdf-lib";

export type FontVariant = "regular" | "bold" | "italic" | "boldItalic" | "condensed" | "condensedBold";
export const FONT_VARIANTS: readonly FontVariant[] = ["regular", "bold", "italic", "boldItalic", "condensed", "condensedBold"];

/** TrueType-filerna (bytes) per variant; anroparen läser dem (paketet gör ingen I/O). */
export type FontFiles = Readonly<Record<FontVariant, Uint8Array>>;

/** Filnamnen i `packages/print-pdf/fonts/`. */
export const FONT_FILE_NAMES: Readonly<Record<FontVariant, string>> = {
  regular: "Roboto-Regular.ttf", bold: "Roboto-Bold.ttf", italic: "Roboto-Italic.ttf", boldItalic: "Roboto-BoldItalic.ttf",
  condensed: "RobotoCondensed-Regular.ttf", condensedBold: "RobotoCondensed-Bold.ttf"
};

export function fontVariant(options: { bold?: boolean | undefined; italic?: boolean | undefined; condensed?: boolean | undefined }): FontVariant {
  if (options.condensed) return options.bold ? "condensedBold" : "condensed";
  if (options.italic) return options.bold ? "boldItalic" : "italic";
  return options.bold ? "bold" : "regular";
}

/** Typsnittsfamiljen i en figur eller kartsymbol ("Roboto Condensed", "Arial Narrow" …) som variant. */
export function variantForFamily(family: string | undefined, bold: boolean, italic: boolean): FontVariant {
  const condensed = /condensed|narrow/i.test(family ?? "");
  return fontVariant({ bold, italic: italic && !condensed, condensed });
}

export interface EmbeddedFont {
  readonly name: string;
  readonly font: PDFFont;
  /** Över- och underhäng i em (Roboto: 0,928 och −0,244). */
  readonly ascent: number;
  readonly descent: number;
}

/** De inbäddade typsnitten; bara de varianter som behövs bäddas in (`embed`). */
export class Fonts {
  private readonly embedded = new Map<FontVariant, EmbeddedFont>();
  readonly used = new Set<FontVariant>();
  constructor(private readonly files: FontFiles) {}

  async embed(document: PDFDocument, variants: Iterable<FontVariant>): Promise<void> {
    document.registerFontkit(fontkit);
    for (const variant of variants) {
      if (this.embedded.has(variant)) continue;
      const bytes = this.files[variant];
      const metrics = fontkit.create(bytes);
      // Delmängden får en etikett med sex versaler och "+" före namnet (PDF 9.6.4), som tryckeriernas kontroller väntar sig.
      const tag = `OTIDA${String.fromCharCode(65 + this.embedded.size)}`;
      const font = await document.embedFont(bytes, { subset: true, customName: `${tag}+${metrics.postscriptName}` });
      this.embedded.set(variant, { name: `F${this.embedded.size}`, font, ascent: metrics.ascent / metrics.unitsPerEm, descent: metrics.descent / metrics.unitsPerEm });
    }
  }

  /** Typsnittet för varianten (vanlig Roboto om varianten inte bäddats in). */
  get(variant: FontVariant): EmbeddedFont {
    const found = this.embedded.get(variant) ?? this.embedded.get("regular") ?? [...this.embedded.values()][0];
    if (!found) throw new Error("Inga typsnitt är inbäddade");
    this.used.add(variant);
    return found;
  }

  all(): EmbeddedFont[] { return [...this.embedded.values()]; }
}

/** Texten med tecken som typsnittet saknar ersatta (pdf-lib kastar annars), och utan styrtecken. */
export function printable(text: string): string {
  return [...text].map(character => { const code = character.charCodeAt(0); return code < 32 || code === 127 ? " " : character; }).join("");
}
