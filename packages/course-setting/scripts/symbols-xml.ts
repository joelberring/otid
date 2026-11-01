/**
 * Läser Purple Pens `symbols.xml` (BSD, Peter Golde) till paketets symboldata. Används av
 * `generate-description-symbols.ts` (som skriver `src/description-symbols.data.ts`) och av testerna, som läser Purple Pens
 * testdatabaser med låtsasspråk. Tolkningen följer SymbolDB.cs (Symbol.ReadXml, SymbolLanguage.ReadXml, SymbolText.ReadXml).
 */
import type { SymbolShape } from "../src/description-types";
import type { SymbolDbData, SymbolData, SymbolLanguageData, SymbolTextData } from "../src/description-symbols";
import { attr, childElements, parseXml, textOf, type XmlElement } from "../src/xml";

type Point = { x: number; y: number };

const number = (element: XmlElement, name: string): number => {
  const value = Number(attr(element, name));
  if (!Number.isFinite(value)) throw new Error(`${element.name} saknar ${name}`);
  return value;
};

const bool = (element: XmlElement, name: string): boolean => (attr(element, name) ?? "false").trim().toLowerCase() === "true";

const points = (element: XmlElement): Point[] =>
  childElements(element).filter(child => child.name === "point").map(child => ({ x: number(child, "x"), y: number(child, "y") }));

function language(element: XmlElement): SymbolLanguageData {
  const genders = attr(element, "genders") ?? "";
  const cases = attr(element, "cases") ?? "";
  return {
    id: attr(element, "lang")!,
    name: textOf(element),
    pluralNouns: bool(element, "plural-nouns"),
    pluralModifiers: bool(element, "plural-modifiers"),
    genderModifiers: bool(element, "gender-modifiers"),
    // Purple Pen läser "case-modifiers" (filerna stavar ofta "case-modifers", som då inte gäller).
    caseModifiers: bool(element, "case-modifiers"),
    ...(genders !== "" ? { genders: genders.split(",") } : {}),
    ...(cases !== "" ? { cases: cases.split(",") } : {})
  };
}

function text(element: XmlElement): SymbolTextData {
  const gender = attr(element, "gender") ?? "";
  const nounCase = attr(element, "case") ?? "";
  const modifiedCase = attr(element, "modified-case") ?? "";
  return {
    lang: attr(element, "lang")!,
    text: textOf(element),
    ...(bool(element, "plural") ? { plural: true as const } : {}),
    ...(gender !== "" ? { gender } : {}),
    ...(nounCase !== "" ? { case: nounCase } : {}),
    ...(modifiedCase !== "" ? { modifiedCase } : {})
  };
}

/** En figur i symbolen; `null` för namn och texter. */
function shape(element: XmlElement): SymbolShape | null {
  const ends = attr(element, "ends") === "flat" ? { ends: "flat" as const } : {};
  const corners = attr(element, "corners") === "sharp" ? { corners: "sharp" as const } : {};
  switch (element.name) {
    case "lines": return { kind: "polyline", points: points(element), width: number(element, "thickness"), ...ends, ...corners };
    case "polygon": return { kind: "polyline", points: points(element), width: number(element, "thickness"), closed: true, ...corners };
    case "filled-polygon": return { kind: "polygon", points: points(element) };
    case "circle": return { kind: "circle", center: points(element)[0]!, radius: number(element, "radius"), width: number(element, "thickness") };
    case "filled-circle": return { kind: "disc", center: points(element)[0]!, radius: number(element, "radius") };
    case "beziers": return { kind: "bezier", points: points(element), width: number(element, "thickness"), ...ends };
    case "filled-beziers": return { kind: "bezier", points: points(element), width: 0, filled: true };
    case "name": case "text": return null;
    default: throw new Error(`okänd del ${element.name} i symbolen`);
  }
}

function symbol(element: XmlElement, keep: (lang: string) => boolean): SymbolData {
  const names: Record<string, string> = {};
  const texts: SymbolTextData[] = [];
  const shapes: SymbolShape[] = [];
  for (const child of childElements(element)) {
    if (child.name === "name") {
      const lang = attr(child, "lang")!;
      if (keep(lang)) names[lang] = textOf(child);
    } else if (child.name === "text") {
      const parsed = text(child);
      if (keep(parsed.lang)) texts.push(parsed);
    } else {
      const parsed = shape(child);
      if (parsed) shapes.push(parsed);
    }
  }
  const standard = attr(element, "standard") ?? "";
  const replacementId = attr(element, "replacement-id");
  return {
    id: attr(element, "id")!,
    kind: attr(element, "kind")!.charAt(0),
    ...(standard !== "" ? { standards: standard.split(",") } : {}),
    ...(replacementId !== undefined ? { replacementId } : {}),
    ...(bool(element, "size-is-depth") ? { sizeIsDepth: true as const } : {}),
    names, texts, shapes
  };
}

/** Hela databasen, eller bara språken i `languages` (engelska tas alltid med, som reserv). */
export function parseSymbolsXml(xml: string, languages?: readonly string[]): SymbolDbData {
  const root = parseXml(xml).root;
  if (root.name !== "symbols") throw new Error("inte en symbols.xml");
  const keep = (lang: string) => languages === undefined || lang === "en" || languages.includes(lang);
  const out: { languages: SymbolLanguageData[]; symbols: SymbolData[] } = { languages: [], symbols: [] };
  for (const child of childElements(root)) {
    if (child.name === "language") {
      const parsed = language(child);
      if (keep(parsed.id)) out.languages.push(parsed);
    } else if (child.name === "symbol") {
      out.symbols.push(symbol(child, keep));
    }
  }
  return out;
}
