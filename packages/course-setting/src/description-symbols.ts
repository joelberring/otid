/**
 * Symboldatabasen för kontrollbeskrivningarna: Purple Pens `symbols.xml` (BSD, Peter Golde) som data i
 * `description-symbols.data.ts`. Uppslag per standard och textval med plural, genus och kasus är portade från SymbolDB.cs
 * (Symbol.FindBestText, GetName, InStandard, SymbolDB.this[], SymbolExistsInStandard).
 */
import { SYMBOL_DATA } from "./description-symbols.data";
import type { DescriptionSymbol, SymbolShape } from "./description-types";
import type { DescriptionStandard } from "./types";

export interface SymbolTextData {
  readonly lang: string;
  readonly text: string;
  readonly plural?: true;
  readonly gender?: string;
  readonly case?: string;
  readonly modifiedCase?: string;
}

export interface SymbolLanguageData {
  readonly id: string;
  /** Språkets namn på språket självt. */
  readonly name: string;
  readonly pluralNouns: boolean;
  readonly pluralModifiers: boolean;
  readonly genderModifiers: boolean;
  readonly caseModifiers: boolean;
  readonly genders?: readonly string[];
  readonly cases?: readonly string[];
}

export interface SymbolData {
  readonly id: string;
  /** Kolumnen ("C"–"H"), "A" för start, "@" för texter utan symbol, "V"–"Z" för hela rader. */
  readonly kind: string;
  /** Saknas = båda standarderna. */
  readonly standards?: readonly string[];
  readonly replacementId?: string;
  /** Ett mått i F är ett djup (inte en höjd). */
  readonly sizeIsDepth?: true;
  readonly names: Readonly<Record<string, string>>;
  readonly texts: readonly SymbolTextData[];
  readonly shapes: readonly SymbolShape[];
}

export interface SymbolDbData {
  readonly languages: readonly SymbolLanguageData[];
  readonly symbols: readonly SymbolData[];
}

const inStandard = (symbol: SymbolData, standard: string) => symbol.standards === undefined || symbol.standards.includes(standard);

export class SymbolDb {
  private readonly byId = new Map<string, SymbolData[]>();
  private readonly languageById = new Map<string, SymbolLanguageData>();

  constructor(readonly data: SymbolDbData) {
    for (const symbol of data.symbols) this.byId.set(symbol.id, [...(this.byId.get(symbol.id) ?? []), symbol]);
    for (const language of data.languages) this.languageById.set(language.id, language);
  }

  /** Symbolen i standarden (den första som gäller, som SymbolDB.SymbolFromId). */
  find(id: string, standard: string): SymbolData | undefined {
    return this.byId.get(id)?.find(symbol => inStandard(symbol, standard));
  }

  /** Som `find` men kastar (SymbolDB.this[]); för de symboler som alltid finns. */
  get(id: string, standard: string): SymbolData {
    const found = this.find(id, standard);
    if (!found) throw new Error(`Symbolen ${id} finns inte i standarden ${standard}`);
    return found;
  }

  all(standard: string): SymbolData[] {
    return this.data.symbols.filter(symbol => inStandard(symbol, standard));
  }

  language(id: string): SymbolLanguageData | undefined {
    return this.languageById.get(id);
  }

  /** Språkets id i databasen: "nb" blir "nb-NO" om bara det finns; annars som det är (texterna faller då på engelska). */
  resolveLanguage(language: string): string {
    if (this.languageById.has(language)) return language;
    const prefixed = this.data.languages.find(candidate => candidate.id.startsWith(`${language}-`));
    return prefixed?.id ?? language;
  }

  /** Namnet i väljaren (Symbol.GetName): språket, språket utan region, engelska. */
  name(symbol: SymbolData, language: string): string | undefined {
    if (symbol.names[language] !== undefined) return symbol.names[language];
    const base = language.includes("-") ? language.slice(0, language.indexOf("-")) : language;
    return symbol.names[base] ?? symbol.names.en;
  }

  /** Bästa texten (Symbol.FindBestText): språket före engelska, sedan plural, genus och kasus. */
  bestText(texts: readonly SymbolTextData[], language: string, plural: boolean, gender: string | null, nounCase: string): SymbolTextData | undefined {
    let best = 99999;
    let bestText: SymbolTextData | undefined;
    const wantedGender = gender ?? "";
    let defaultNounCase = "";
    const symbolLanguage = this.languageById.get(language);
    if (symbolLanguage && symbolLanguage.caseModifiers && (symbolLanguage.cases?.length ?? 0) > 0) defaultNounCase = symbolLanguage.cases![0]!;
    for (const text of texts) {
      let metric = 0;
      if (text.lang !== language && text.lang !== "en") metric += 100;
      if (text.lang !== language && text.lang === "en") metric += 50;
      if ((text.plural ?? false) !== plural) metric += 10;
      if (wantedGender !== "" && (text.gender ?? "") !== wantedGender) metric += 5;
      if (nounCase !== "" && (text.case ?? "") !== nounCase) metric += 3;
      if (nounCase === "" && (text.case ?? "") !== defaultNounCase) metric += 1;
      if (metric < best) {
        best = metric;
        bestText = text;
      }
    }
    return bestText;
  }
}

let shared: SymbolDb | undefined;

/** Databasen med paketets symboldata. */
export function symbolDb(): SymbolDb {
  shared ??= new SymbolDb(SYMBOL_DATA);
  return shared;
}

/** Symbolen har en ritning (Symbol.HasVisualImage); texterna "@" och hjälpsymbolerna för F och G har ingen. */
export const hasImage = (symbol: SymbolData) => symbol.shapes.length > 0;

const cache = new Map<string, readonly DescriptionSymbol[]>();

/** Symbolerna med ritning i standarden, i Purple Pens ordning, i kontraktets form. */
export function symbolsInStandard(standard: DescriptionStandard): readonly DescriptionSymbol[] {
  const cached = cache.get(standard);
  if (cached) return cached;
  const list = symbolDb().all(standard).filter(hasImage).map((symbol): DescriptionSymbol => ({
    id: symbol.id,
    kind: symbol.kind,
    ...(symbol.standards?.length === 1 ? { standard: symbol.standards[0] as DescriptionStandard } : {}),
    names: symbol.names,
    shapes: symbol.shapes
  }));
  cache.set(standard, list);
  return list;
}

/** Vilka slag som får stå i en ruta (Purple Pens DescriptionControl: E visar E och sedan D; "X"–"Z" för riktningsrader). */
export const BOX_KINDS: Readonly<Record<string, readonly string[]>> = {
  C: ["C"], D: ["D"], E: ["E", "D"], F: ["F"], G: ["G"], H: ["H"], V: ["V"], W: ["W"], X: ["X"], Y: ["Y"], Z: ["Z"]
};

export function symbolsOfBox(box: string, standard: DescriptionStandard): readonly DescriptionSymbol[] {
  const kinds = BOX_KINDS[box];
  if (!kinds) return [];
  const all = symbolsInStandard(standard);
  return kinds.flatMap(kind => all.filter(symbol => symbol.kind === kind));
}
