/**
 * Textbeskrivningen av en kontroll ("SÖ stenen, 1m hög"), portad från Purple Pens Textifier.cs (BSD, Peter Golde):
 * huvudobjektet i D (med E som modifierare eller andra objekt), korsning/förgrening i F, mellan i G, mått i F, vilket av
 * flera i C, läge i G och extra i H, med plural, genus och kasus som symbols.xml anger dem.
 */
import { fromRaw, rawName } from "./ppen-common";
import { symbolDb, type SymbolData, type SymbolDb, type SymbolTextData } from "./description-symbols";
import type { ControlPoint, CourseSettingDocument } from "./types";
import { attr, childElements, textOf } from "./xml";

/** Det som beskrivningen behöver ur händelsen: standard, språk och egna symboltexter (`custom-symbol-text`). */
export interface DescriptionContext {
  readonly db: SymbolDb;
  readonly standard: string;
  readonly language: string;
  readonly customTexts: ReadonlyMap<string, readonly SymbolTextData[]>;
  /** Symboler vars egna text ska stå i en nyckel under beskrivningen (`show-key`). */
  readonly customKeys: ReadonlyMap<string, boolean>;
}

/** Händelsens egna symboltexter ur `<event>` (EventDB.cs, Event.ReadAttributesAndContent). */
function customSymbolTexts(document: CourseSettingDocument): { texts: Map<string, SymbolTextData[]>; keys: Map<string, boolean> } {
  const texts = new Map<string, SymbolTextData[]>();
  const keys = new Map<string, boolean>();
  for (const raw of document.event.raw ?? []) {
    if (rawName(raw) !== "custom-symbol-text") continue;
    const element = fromRaw(raw);
    const id = attr(element, "iof-2004-ref");
    if (id === undefined) continue;
    keys.set(id, (attr(element, "show-key") ?? "false").trim().toLowerCase() === "true");
    const children = childElements(element).filter(child => child.name === "text");
    if (children.length === 0) {
      // Gammal form: bara text, på engelska; modifierarna saknade {0}.
      texts.set(id, [{ lang: "en", text: textOf(element) + (id.startsWith("8.") ? " {0}" : "") }]);
      continue;
    }
    texts.set(id, children.map(child => {
      const gender = attr(child, "gender") ?? "";
      const nounCase = attr(child, "case") ?? "";
      const modifiedCase = attr(child, "modified-case") ?? "";
      return {
        lang: attr(child, "lang") ?? "", text: textOf(child),
        ...((attr(child, "plural") ?? "").trim().toLowerCase() === "true" ? { plural: true as const } : {}),
        ...(gender !== "" ? { gender } : {}), ...(nounCase !== "" ? { case: nounCase } : {}),
        ...(modifiedCase !== "" ? { modifiedCase } : {})
      };
    }));
  }
  return { texts, keys };
}

export function descriptionContext(document: CourseSettingDocument, language: string, db: SymbolDb = symbolDb()): DescriptionContext {
  const { texts, keys } = customSymbolTexts(document);
  return { db, standard: document.event.descriptionStandard, language: db.resolveLanguage(language), customTexts: texts, customKeys: keys };
}

/** Kontrollens symboler i Purple Pens form: sex rutor C–H, eller en ruta för mål, passage och kartutdelning. */
export function symbolIds(control: ControlPoint): (string | undefined)[] {
  const single = control.kind === "FINISH" || control.kind === "CROSSING_POINT" || control.kind === "MAP_ISSUE";
  const ids: (string | undefined)[] = new Array<string | undefined>(single ? 1 : 6).fill(undefined);
  for (const box of control.descriptions) {
    const index = box.box === "all" ? 0 : box.box.charCodeAt(0) - "C".charCodeAt(0);
    if (index >= 0 && index < ids.length) ids[index] = box.ref;
  }
  return ids;
}

/** Texten i ruta F (mått), om någon. */
export function columnFText(control: ControlPoint): string | undefined {
  const text = control.descriptions.find(box => box.box === "F")?.text;
  return text === undefined || text === "" ? undefined : text;
}

/** Kontrollens egen text i stället för den uträknade (`description-text`). */
export function customControlText(control: ControlPoint): string | undefined {
  for (const raw of control.raw ?? []) if (rawName(raw) === "description-text") return textOf(fromRaw(raw));
  return undefined;
}

/** Som .NET:s string.Format för {0}, {1} … */
export function format(template: string, ...args: readonly string[]): string {
  return template.replace(/\{(\d+)\}/g, (match, index: string) => args[Number(index)] ?? match);
}

export function capitalizeFirstLetter(text: string): string {
  return text.length >= 1 ? text.charAt(0).toUpperCase() + text.slice(1) : text;
}

/** Talet med språkets decimaltecken (Purple Pen använder datorns; här: punkt på engelska, annars komma). */
export function formatDecimal(value: string, language: string): string {
  return language === "en" || language.startsWith("en-") ? value : value.replace(".", ",");
}

const SIZE_NUMBER = /^\s*(?:\d+(?:[.,]\d*)?|[.,]\d+)\s*$/;

export class Textifier {
  constructor(private readonly context: DescriptionContext) {}

  private get language() { return this.context.language; }

  private symbol(id: string): SymbolData {
    return this.context.db.get(id, this.context.standard);
  }

  /** Texten för kontrollen; `distanceText` ("160 m" eller "") används av mål och snitslar. */
  createTextForControl(control: ControlPoint, distanceText: string): string {
    const custom = customControlText(control);
    if (custom !== undefined && custom !== "") return custom;
    let text: string;
    switch (control.kind) {
      case "NORMAL": text = this.createTextForNormalControl(control); break;
      case "START": case "MAP_EXCHANGE": text = this.createTextForStartControl(control); break;
      default: text = this.createTextForDirective(symbolIds(control)[0], distanceText) ?? ""; break;
    }
    return capitalizeFirstLetter(text);
  }

  /** Text för en riktningsrad (mål, passage, snitsel); null om symbolen saknas. */
  createTextForDirective(symbolId: string | undefined, distanceText: string): string | null {
    if (symbolId === undefined) return null;
    const symbol = this.context.db.find(symbolId, this.context.standard);
    if (!symbol) return null;
    const distance = distanceText !== "" ? `${distanceText} ` : "";
    return capitalizeFirstLetter(format(this.plainText(symbol, false, "", ""), distance));
  }

  private createTextForStartControl(control: ControlPoint): string {
    return `${this.symbolText(this.symbol("start"), "")}: ${this.createTextForNormalControl(control)}`;
  }

  private createTextForNormalControl(control: ControlPoint): string {
    const symbols = this.symbols(control);
    const main = this.mainFeatureText(control, symbols);
    let fullText = main.text;
    const sizeText = columnFText(control);
    if (sizeText !== undefined) fullText = `${fullText}, ${this.textFromColumnF(sizeText, symbols).text}`;
    fullText = this.addSymbolToCurrent(fullText, main.gender, symbols[0]);
    if (symbols[4] && symbols[4].id !== "11.15") fullText = this.addSymbolToCurrent(fullText, main.gender, symbols[4]);
    if (symbols[5]) fullText = `${fullText} (${this.symbolText(symbols[5], "")})`;
    return fullText;
  }

  private addSymbolToCurrent(current: string, gender: string, symbol: SymbolData | undefined): string {
    return symbol ? format(this.symbolText(symbol, gender), current) : current;
  }

  /** Symbolens text ur symbols.xml (Symbol.GetText / GetPluralText). */
  private plainText(symbol: SymbolData, plural: boolean, gender: string | null, nounCase: string): string {
    return this.context.db.bestText(symbol.texts, this.language, plural, gender, nounCase)?.text ?? "";
  }

  /** Händelsens egna texter före symbolens (GetSymbolText och vänner). */
  private customOrOwn(symbol: SymbolData): readonly SymbolTextData[] {
    const custom = this.context.customTexts.get(symbol.id);
    return custom && custom.some(text => text.lang === this.language) ? custom : symbol.texts;
  }

  private symbolText(symbol: SymbolData, gender: string, nounCase = ""): string {
    return this.context.db.bestText(this.customOrOwn(symbol), this.language, false, gender, nounCase)?.text ?? "";
  }

  private symbolPluralText(symbol: SymbolData, gender: string, nounCase = ""): string {
    return this.context.db.bestText(this.customOrOwn(symbol), this.language, true, gender, nounCase)?.text ?? "";
  }

  private symbolGender(symbol: SymbolData): string {
    return this.context.db.bestText(this.customOrOwn(symbol), this.language, false, "", "")?.gender ?? "";
  }

  private symbolModifiedCase(symbol: SymbolData): string {
    return this.context.db.bestText(this.customOrOwn(symbol), this.language, false, "", "")?.modifiedCase ?? "";
  }

  /** Korsning, förgrening eller mellan; ett och samma objekt ger "single"-varianten (CombineSymbols). */
  private combineSymbols(combo: SymbolData, main: string, mainPlural: string, secondary: string | null): { text: string; plural: string; gender: string } {
    const db = this.context.db;
    if (secondary === null) {
      const single = this.singleVersionOfCombo(combo);
      return {
        plural: format(this.plainText(single, true, null, ""), main, mainPlural),
        gender: db.bestText(single.texts, this.language, false, null, "")?.gender ?? "",
        text: format(this.plainText(single, false, null, ""), main, mainPlural)
      };
    }
    return {
      plural: format(this.plainText(combo, true, null, ""), main, secondary),
      gender: db.bestText(combo.texts, this.language, false, null, "")?.gender ?? "",
      text: format(this.plainText(combo, false, null, ""), main, secondary)
    };
  }

  private isDualMainSymbol(symbols: readonly (SymbolData | undefined)[]): boolean {
    return symbols[1] !== undefined && symbols[2] !== undefined && symbols[2].kind === "D" && symbols[2].id !== symbols[1].id;
  }

  private singleVersionOfCombo(combo: SymbolData): SymbolData {
    return combo.id === "10.1" || combo.id === "10.2" || combo.id === "11.15" ? this.symbol(`${combo.id}single`) : combo;
  }

  /** Huvudobjektet med modifierare och korsning/förgrening/mellan (GetMainFeatureText). */
  private mainFeatureText(control: ControlPoint, symbols: readonly (SymbolData | undefined)[]): { text: string; gender: string } {
    const [, first, second, third, fourth] = symbols;
    if (!first) return { text: "", gender: "" };
    const nounCase = this.nounCase(control, false, false, false);
    let main = this.symbolText(first, "", nounCase);
    let gender = this.symbolGender(first);
    let plural = this.symbolPluralText(first, "", nounCase);
    let secondary: string | null = null;
    let comboUsed = false;
    if (second) {
      if (second.kind === "D") {
        secondary = this.symbolText(second, "", nounCase);
        if (secondary === main) secondary = null;
      } else if (second.kind === "E") {
        main = format(this.symbolText(second, gender), main);
        plural = format(this.symbolPluralText(second, gender), plural);
      }
    }
    if (third) {
      ({ text: main, plural, gender } = this.combineSymbols(third, main, plural, secondary));
      secondary = null;
      comboUsed = true;
    }
    if (fourth && fourth.id === "11.15") {
      ({ text: main, plural, gender } = this.combineSymbols(fourth, main, plural, secondary));
      comboUsed = true;
    }
    if (!comboUsed && secondary !== null) ({ text: main, gender } = this.combineSymbols(this.symbol("basic_combo"), main, plural, secondary));
    return { text: main, gender };
  }

  /** Kasus för substantivet ur modifierarna, utifrån och in (GetNounCase). */
  private nounCase(control: ControlPoint, ignoreBetween: boolean, ignoreCrossJunction: boolean, ignoreColumnE: boolean): string {
    let nounCase = "";
    const symbols = this.symbols(control);
    const apply = (symbol: SymbolData) => {
      const modified = this.symbolModifiedCase(symbol);
      if (modified !== "") nounCase = modified;
    };
    if (symbols[5]) apply(symbols[5]);
    if (symbols[4] && symbols[4].id !== "11.15") apply(symbols[4]);
    if (symbols[0]) apply(symbols[0]);
    const sizeText = columnFText(control);
    if (sizeText !== undefined) {
      const controlling = this.textFromColumnF(sizeText, symbols).controlling;
      if (controlling) apply(controlling);
    }
    if (!ignoreBetween && symbols[4] && symbols[4].id === "11.15") apply(this.isDualMainSymbol(symbols) ? symbols[4] : this.singleVersionOfCombo(symbols[4]));
    if (!ignoreCrossJunction && symbols[3] && (symbols[3].id === "10.1" || symbols[3].id === "10.2")) {
      apply(this.isDualMainSymbol(symbols) ? symbols[3] : this.singleVersionOfCombo(symbols[3]));
    }
    if (!ignoreColumnE && symbols[2] && symbols[2].kind === "E") apply(symbols[2]);
    return nounCase;
  }

  private textFromColumnF(sizeText: string, symbols: readonly (SymbolData | undefined)[]): { text: string; controlling: SymbolData | undefined } {
    const first = symbols[1];
    const firstIsDeep = first?.sizeIsDepth === true;
    let secondIsDeep = firstIsDeep;
    const genderFirst = first ? this.symbolGender(first) : "";
    let genderSecond = "";
    if (symbols[2] && symbols[2].kind === "D") {
      secondIsDeep = symbols[2].sizeIsDepth === true;
      genderSecond = this.symbolGender(symbols[2]);
    }
    return this.textFromSize(sizeText, true, firstIsDeep, genderFirst, secondIsDeep, genderSecond);
  }

  /**
   * Måttet som text: "2x4" ger "2m by 4m", "5" ger "5m high", "0.5/3" "0.5m to 3m high", "2|3" två objekt (GetTextFromSize).
   * Ett mått i okänd form lämnas som det är.
   */
  textFromSize(size: string, useDeepOrHigh: boolean, firstIsDeep: boolean, genderFirst: string, secondIsDeep: boolean, genderSecond: string): { text: string; controlling: SymbolData | undefined } {
    let controlling: SymbolData | undefined;
    let combiner: SymbolData | undefined;
    let deepOrHigh = useDeepOrHigh;
    let index = size.indexOf("|");
    if (index >= 0) {
      combiner = this.symbol("9.4");
    } else {
      index = size.indexOf("/");
      if (index >= 0) {
        combiner = this.symbol(firstIsDeep ? "9.3deep" : "9.3high");
        controlling = combiner;
        deepOrHigh = false;
      } else {
        index = size.indexOf("x");
        if (index >= 0) {
          combiner = this.symbol("9.2");
          controlling = combiner;
          deepOrHigh = false;
        }
      }
    }
    if (combiner) {
      const firstPart = this.textFromSize(size.slice(0, index), deepOrHigh, firstIsDeep, genderFirst, firstIsDeep, genderFirst);
      const secondPart = this.textFromSize(size.slice(index + 1), deepOrHigh, secondIsDeep, genderSecond, secondIsDeep, genderSecond);
      if (firstPart.text === "" || secondPart.text === "") return { text: size, controlling };
      controlling ??= firstPart.controlling;
      return { text: format(this.plainText(combiner, false, genderFirst, ""), firstPart.text, secondPart.text), controlling };
    }
    let simple = size.trim();
    if (simple.endsWith("m")) simple = simple.slice(0, -1);
    if (!SIZE_NUMBER.test(simple)) return { text: size, controlling };
    const value = Number(simple.trim().replace(",", "."));
    const text = `${formatDecimal(String(value), this.language)}m`;
    if (!deepOrHigh) return { text, controlling };
    const symbol = this.symbol(firstIsDeep ? "9.1deep" : "9.1high");
    return { text: format(this.plainText(symbol, false, genderFirst, ""), text), controlling: symbol };
  }

  /** Kontrollens symboler i standarden; de som saknas i standarden blir tomma (GetSymbols). */
  symbols(control: ControlPoint): (SymbolData | undefined)[] {
    return symbolIds(control).map(id => (id !== undefined ? this.context.db.find(id, this.context.standard) : undefined));
  }
}
