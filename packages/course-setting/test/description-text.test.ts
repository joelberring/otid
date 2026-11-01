/**
 * Textbeskrivningen mot Purple Pens förväntade resultat (TextifierTests.cs, BSD, Peter Golde), med de riktiga
 * symbolerna och med Purple Pens testdatabaser med låtsasspråk för genus och kasus.
 */
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { describeControl, readPpen, type CourseSettingDocument } from "../src";
import { SymbolDb } from "../src/description-symbols";
import { descriptionContext, Textifier } from "../src/description-text";
import { parseSymbolsXml } from "../scripts/symbols-xml";
import { readText, testFilesDir } from "./helpers";

const load = (name: string): CourseSettingDocument => readPpen(readText(join(testFilesDir, name))).document;

function textifier(document: CourseSettingDocument, language: string, symbols?: string): { text: (id: string, distance?: string) => string; textifier: Textifier } {
  const db = symbols ? new SymbolDb(parseSymbolsXml(readText(join(testFilesDir, symbols)))) : undefined;
  const t = new Textifier(descriptionContext(document, language, db));
  return { textifier: t, text: (id, distance = "") => t.createTextForControl(document.controls[id]!, distance) };
}

describe("textbeskrivningen som Purple Pen (textifier)", () => {
  const document = load("textifier/sampleevent1.coursescribe");
  const { text, textifier: en } = textifier(document, "en");

  it("vanliga kontroller", () => {
    expect(text("2")).toBe("Upper boulder, 2m high");
    expect(text("16")).toBe("Overgrown pit, 3m deep");
    expect(text("17")).toBe("S side of pit");
    expect(text("18")).toBe("Reentrant, 4m deep");
    expect(text("28")).toBe("E edge of SE overgrown pond");
    expect(text("20")).toBe("Stony ground, 6m by 7m (manned)");
  });

  it("utan huvudobjekt", () => {
    expect(text("19")).toBe("S ");
    expect(text("21")).toBe("");
  });

  it("mellan", () => {
    expect(text("8")).toBe("Between building and statue");
    expect(text("9")).toBe("Between marshes, 4m by 4m and 5m by 6m");
    expect(text("11")).toBe("Between path crossings");
    expect(text("12")).toBe("Between boulders, 0.5m to 2.5m high");
  });

  it("korsning och förgrening", () => {
    expect(text("5")).toBe("N side of N power line and path crossing (radio)");
    expect(text("7")).toBe("Small gully junction");
    expect(text("10")).toBe("N side of road and power line crossing");
    expect(text("13")).toBe("N path junction");
  });

  it("två objekt, egen text och egna symboltexter", () => {
    expect(text("14")).toBe("Knoll and boulder");
    expect(text("4", "50 m")).toBe("very marshy spot");
    expect(text("25")).toBe("Wet man-made object");
    expect(text("26")).toBe("Slide (medical)");
    expect(text("27")).toBe("S side of light pole");
    expect(text("29")).toBe("Between slides");
  });

  it("egna symboltexter på ett annat språk", () => {
    const aa = textifier(document, "aa").text;
    expect(aa("25")).toBe("Marshy special item");
    expect(aa("26")).toBe("Smurf (first aid)");
    expect(aa("27")).toBe("S side of bigrash");
    expect(aa("29")).toBe("Between smurfella");
    expect(aa("14")).toBe("Knoll and boulder");
  });

  it("start och riktningsrader", () => {
    expect(text("1")).toBe("Start: open bare rock");
    expect(text("3")).toBe("Mandatory crossing point");
    expect(text("6", "160 m")).toBe("Navigate 160 m to finish funnel");
    expect(text("15", "160 m")).toBe("Mandatory crossing point");
    expect(text("6")).toBe("Navigate to finish funnel");
    expect(en.createTextForDirective("13.2", "230 m")).toBe("Follow tapes 230 m between controls");
  });

  it("mått i F", () => {
    const size = (s: string, deepFirst: boolean, deepSecond: boolean) => en.textFromSize(s, true, deepFirst, "", deepSecond, "").text;
    expect(size("5", false, false)).toBe("5m high");
    expect(size("5m", true, true)).toBe("5m deep");
    expect(size("5 m", true, true)).toBe("5m deep");
    expect(size("5.0m ", false, false)).toBe("5m high");
    expect(size(".6 ", false, false)).toBe("0.6m high");
    expect(size("4.0x3.0", false, false)).toBe("4m by 3m");
    expect(size("4x3", true, true)).toBe("4m by 3m");
    expect(size("0.5/3", false, false)).toBe("0.5m to 3m high");
    expect(size("0.5m/3m", true, true)).toBe("0.5m to 3m deep");
    expect(size("0.5|3", true, false)).toBe("0.5m deep and 3m high");
    expect(size("0,5|3.2", true, true)).toBe("0.5m deep and 3.2m deep");
    expect(size("2x3|5x7", false, false)).toBe("2m by 3m and 5m by 7m");
    expect(size("5,2", false, false)).toBe("5.2m high");
  });

  it("genus och plural (Purple Pens låtsastyska)", () => {
    const de = textifier(load("textifier/sampleevent2.coursescribe"), "de", "textifier/de_symbols.xml").text;
    expect(de("4")).toBe("De-marsh");
    expect(de("28")).toBe("De-overgrown-masc de-marsh");
    expect(de("12")).toBe("De-overgrown-fem de-reentrant, 4m de-deep-fem");
    expect(de("29")).toBe("De-overgrown-neut de-pit, 4m de-deep-neut");
    expect(de("7")).toBe("De-between de-pit and de-reentrant, 6m de-deep-neut and 3m de-deep-fem");
    expect(de("8")).toBe("De-N-masc side of de-upper-masc de-marsh");
    expect(de("11")).toBe("De-N-fem side of de-upper-fem de-reentrant");
    expect(de("10")).toBe("De-N-neut side of de-upper-neut de-pit");
    expect(de("18")).toBe("De-N-fem side of de-junction of de-overgrown-plural-neut de-roads");
    expect(de("9")).toBe("De-between de-overgrown-plural-neut de-pits");
    expect(de("13")).toBe("De-between de-overgrown-plural-masc de-marshes");
    expect(de("14")).toBe("De-between de-overgrown-plural-fem de-reentrants");
  });

  it("kasus (Purple Pens låtsaspolska)", () => {
    const pl = textifier(load("textifier/PolishTest.ppen"), "pl", "textifier/pl-symbols.xml").text;
    expect(pl("1")).toBe("Suchy row");
    expect(pl("2")).toBe("Polnocny suchy row");
    expect(pl("3")).toBe("Piaszczysty suchy row");
    expect(pl("4")).toBe("Skrzyzowanie suchych rowow");
    expect(pl("5")).toBe("Polnocna strona suchego rowu");
    // Purple Pen skriver decimaltecknet som datorn (testet körs med en-US); O-Tid som språket: komma utom på engelska.
    expect(pl("6")).toBe("Suchy row, gleboki na 1,5m");
    expect(pl("7")).toBe("Rozwidlenie suchego rowu oraz sciezki");
    expect(pl("8")).toBe("Mulda");
    expect(pl("9")).toBe("Zachodnia mulda");
    expect(pl("10")).toBe("Piaszczysta mulda");
    expect(pl("11")).toBe("Skrzyzowanie muld");
    expect(pl("12")).toBe("Polnocna strona muldy");
    expect(pl("14")).toBe("Rozwidlenie muldy oraz sciezki");
  });
});

describe("describeControl", () => {
  const document = load("textifier/sampleevent1.coursescribe");

  it("ger texten på svenska och engelska", () => {
    expect(describeControl(document, "2", "en")).toBe("Upper boulder, 2m high");
    expect(describeControl(document, "2", "sv")).toBe("Övre stenen, 2m hög");
    expect(describeControl(document, "16", "sv")).toBe("Lilla grävda gropen, bevuxen, 3m djup");
    expect(describeControl(document, "12", "sv")).toBe("Mellan stenarna, 0,5m/2,5m hög");
    expect(describeControl(document, "1", "sv")).toBe("Start: berg i dagen, öppen");
  });

  it("norska via nb, och okänt språk ger engelska", () => {
    expect(describeControl(document, "2", "nb")).toBe(describeControl(document, "2", "nb-NO"));
    expect(describeControl(document, "2", "xx")).toBe("Upper boulder, 2m high");
  });

  it("kastar för okänd kontroll", () => {
    expect(() => describeControl(document, "999", "sv")).toThrow(/finns inte/);
  });
});
