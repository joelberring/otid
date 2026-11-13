/**
 * Sprintvarianten av grundkartans regler (ägaren 2026-11-13): kartans norm ur skalan och symbolerna, och förslagen
 * lager → symbol på sprintkartor i O-Tids mall, i en OCAD-uppsättning efter ISSprOM 2019-2 och i den äldre normen ISSOM 2007.
 */
import { describe, expect, it } from "vitest";
import { SYMBOL_SETS } from "@o-tid/map-file";
import { codeParts, isSprintNorm, mapNorm, suggestSymbol, type MapNorm } from "../src";

type Row = { id: string; code: string; kind: string; name?: string };
const template = (id: keyof typeof SYMBOL_SETS): Row[] => SYMBOL_SETS[id].symbols.map(symbol => ({ id: `${symbol.kind}${symbol.code}`, code: symbol.code, kind: symbol.kind, name: symbol.name }));
const rows = (list: readonly (readonly [string, string, string])[]): Row[] => list.map(([code, kind, name]) => ({ id: `${kind}${code}`, code, kind, name }));

/** Ett urval ur en OCAD-uppsättning efter ISSprOM 2019-2 (numren och namnen som i en riktig karta 1:4 000). */
const OCAD_ISSPROM = rows([
  ["101.0", "line", "Contour"], ["301.0", "area", "Uncrossable body of water (area & border line)"], ["302.0", "area", "Crossable body of water"],
  ["306.0", "line", "Minor / seasonal watercourse"], ["401.0", "area", "Open land"], ["406.2", "line", "Vegetation: slow running, hedge"],
  ["408.0", "area", "Vegetation: walk"], ["408.2", "line", "Vegetation: walk, hedge"], ["410.0", "area", "Skog, svårframkomlig"],
  ["411.0", "area", "Opasserbar vegetation"], ["411.1", "line", " Uncrossable vegetation, hedge"], ["411.2", "line", "Opasserbar vegetation, häck (linje)"],
  ["417.0", "point", "Tydligt stort träd"], ["418.0", "point", "Prominent bush or small tree"],
  ["501.0", "area", "Paved area, upper (light traffic), (area & boundary)"], ["501.1", "area", "Paved area, upper (light traffic), (area"],
  ["501.2", "area", "Paved area, lower (light traffic)"], ["501.10", "line", "Paved footpath 1.4 m"], ["501.11", "line", "Paved footpath, 2 m"],
  ["501.100", "line", "Step or edge of paved area"], ["501.200", "line", "Steg eller kant för belagd yta på lägre nivån"],
  ["505.0", "line", "Unpaved footpath or track, 1.4 m"], ["506.0", "line", "Small unpaved footpath or track"], ["509.100", "line", "Railway"],
  ["512.100", "line", "Bro eller tunnelmynning"], ["512.200", "line", "Undergång eller tunnel"],
  ["513.100", "line", "Passable wall"], ["513.101", "line", "Passable wall, not dotted"], ["513.200", "line", "Passable retained wall"],
  ["515.0", "line", "Opasserbar mur eller stödmur"], ["516.0", "line", "Passable fence or railing"], ["516.2", "line", "Passable fence or railing"],
  ["518.0", "line", "Opasserbart staket, stängsel eller räcke"], ["520.0", "area", "Area that shall not be entered (area & boundary)"],
  ["520.2", "line", "Area that shall not be entered (boundary line)"], ["521.0", "area", "Building"], ["521.2", "line", "Building (outline)"],
  ["522.0", "area", "Canopy"], ["522.1", "line", "Canopy (outline)"], ["532.0", "line", "Stairway, 1.6 m"], ["532.1", "line", "Stairway, 2.8 m"]
]);
/** Ett urval ur en uppsättning efter den äldre sprintnormen ISSOM 2007 (1:5 000). */
const OCAD_ISSOM = rows([
  ["101.0", "line", "Höjdkurva"], ["104.0", "point", "Lutningsstreck"], ["106.0", "line", "Skärning"], ["204.0", "point", "Stenbrott"], ["206.0", "point", "Sten"],
  ["304.1", "area", "Opasserbar vattenyta"], ["307.0", "line", "Mindre dike"], ["401.0", "area", "Öppen lättlöpt mark"], ["410.1", "line", "Vegetation. mycket svårlöpt"],
  ["418.0", "point", "Enskilt stort träd"], ["419.0", "point", "Buske eller litet träd"], ["421.0", "area", "Opasserbar vegetation"], ["421.1", "line", "Opasserbar vegetation"],
  ["506.1", "line", "Icke belagd stig i stadsmiljö"], ["507.0", "line", "Liten obelagd stig"], ["509.0", "line", "Rågång / Drivningsväg"], ["512.1", "line", "Bro / Spång"],
  ["515.1", "line", "Järnväg"], ["516.0", "line", "Kraftledning eller skidlift"], ["519.1", "line", "Passerbar mur"], ["521.1", "line", "Opasserbar mur"],
  ["522.0", "line", "Passerbart staket el. ledstång"], ["524.0", "line", "Opasserbart staket"], ["526.0", "area", "Byggnad"], ["526.1", "area", "Byggnad (fyllning)"],
  ["526.2", "area", "Skärmtak el. överbyggnad"], ["526.4", "line", "Byggnad (konturlinje)"], ["527.1", "area", "Förbjudet område"], ["529.0", "area", "Belagd yta (stadsmiljö)"],
  ["529.1", "line", "Konturlinje och trappa"], ["529.2", "line", "Trappa"], ["529.3", "line", "Trappa"]
]);
const layer = (name: string, shape: Partial<Record<"points" | "lines" | "closedLines" | "areas", number>>) =>
  ({ name, count: 1, points: 0, lines: 0, closedLines: 0, areas: 0, ...shape });
const line = { lines: 3 }, area = { areas: 3 }, point = { points: 3 };

describe("kartans norm", () => {
  it("mallarna: ISOM 2017-2 är en skogskarta i alla sina skalor, ISSPROM 2019-2 alltid en sprintkarta", () => {
    for (const { scale } of SYMBOL_SETS["ISOM2017-2"].scales) expect(mapNorm({ scale, symbols: template("ISOM2017-2") }), String(scale)).toBe("ISOM");
    for (const { scale } of SYMBOL_SETS["ISSPROM2019-2"].scales) expect(mapNorm({ scale, symbols: template("ISSPROM2019-2") }), String(scale)).toBe("ISSPROM");
    expect(isSprintNorm("ISOM")).toBe(false);
    expect(isSprintNorm("ISSPROM")).toBe(true);
    expect(isSprintNorm("ISSOM")).toBe(true);
  });

  it("skalan 1:5 000 eller större ger sprint; okänd skala ger skog om inte symbolerna säger annat", () => {
    expect(mapNorm({ scale: 5000, symbols: [] })).toBe("ISSPROM");
    expect(mapNorm({ scale: 4000, symbols: [] })).toBe("ISSPROM");
    expect(mapNorm({ scale: 7500, symbols: [] })).toBe("ISOM");
    expect(mapNorm({ scale: undefined, symbols: [] })).toBe("ISOM");
    expect(mapNorm({ scale: 0, symbols: template("ISOM2017-2") })).toBe("ISOM");
    // Skogsnormens 501, 515, 518, 520 och 521 räcker inte: ISOM 2017-2 har dem också.
    expect(mapNorm({ scale: 10000, symbols: template("ISOM2017-2") })).toBe("ISOM");
  });

  it("symbolerna: en ISSprOM-uppsättning utan skogsnormens vägar är sprint också i en förstorad skala", () => {
    expect(mapNorm({ scale: 4000, symbols: OCAD_ISSPROM })).toBe("ISSPROM");
    expect(mapNorm({ scale: 7500, symbols: OCAD_ISSPROM })).toBe("ISSPROM");
    expect(mapNorm({ scale: 7500, symbols: [...OCAD_ISSPROM, { code: "503.0", kind: "line" }] })).toBe("ISOM");
  });

  it("den äldre sprintnormen känns igen på ytorna 526 och 529 med 421 eller kantlinjen 529.1; en äldre skogskarta är skog", () => {
    expect(mapNorm({ scale: 5000, symbols: OCAD_ISSOM })).toBe("ISSOM");
    expect(mapNorm({ scale: 10000, symbols: OCAD_ISSOM })).toBe("ISSOM");
    const forest2000 = rows([["526.0", "area", "Byggnad"], ["527.0", "area", "Tomtmark"], ["529.0", "area", "Hårdgjord yta"], ["522.0", "line", "Staket"]]);
    expect(mapNorm({ scale: 10000, symbols: forest2000 })).toBe("ISOM");
    expect(mapNorm({ scale: 5000, symbols: forest2000 })).toBe("ISSOM");
    // Mapper-filens former (versaler, sammansatta symboler) räknas som i katalogen.
    expect(mapNorm({ scale: 0, symbols: [{ code: "526.1", kind: "AREA" }, { code: "529.1", kind: "COMBINED" }] })).toBe("ISSOM");
  });

  it("numrets delar", () => {
    expect(codeParts("521")).toEqual({ main: 521, sub: 0 });
    expect(codeParts("521.0")).toEqual({ main: 521, sub: 0 });
    expect(codeParts("501.100")).toEqual({ main: 501, sub: 100 });
    expect(codeParts("501.1")).toEqual({ main: 501, sub: 1 });
  });
});

describe("lager → symbol på sprintkartor", () => {
  const suggest = (symbols: Row[], norm: MapNorm) => (name: string, shape: Parameters<typeof layer>[1]) => suggestSymbol(layer(name, shape), symbols, norm);

  it("skogskartan är som förut, också med sprintmallens symboler när normen inte anges", () => {
    const forest = suggest(template("ISOM2017-2"), "ISOM");
    expect(forest("STAKET", line)).toBe("line516");
    expect(forest("Bullerskydd", line)).toBeUndefined();
    expect(forest("VÄGKANT", line)).toBe("line503");
    expect(forest("OSM stig", line)).toBe("line505");
    expect(forest("Träd", point)).toBe("point417");
    expect(suggestSymbol(layer("VÄGKANT", line), template("ISSPROM2019-2"))).toBe("line503");
  });

  it("O-Tids sprintmall: bebyggelse, avgränsningar, belagda ytor och kanter", () => {
    const sprint = suggest(template("ISSPROM2019-2"), "ISSPROM");
    const expected: [string, Parameters<typeof layer>[1], string | undefined][] = [
      ["Byggnad", area, "area521"], ["BostadsbyggnadFlerbostadshusgyBBefintl", area, "area521"], ["HUS", { closedLines: 3 }, "area521"], ["BYG_LINJE", { closedLines: 2 }, "area521"],
      ["Skärmtak", area, "area522"], ["CARPORT", area, "area522"], ["TAK", area, "area522"], ["ByggnadsanlaggningSkarmtakgyBBefintl", area, "area522"],
      ["STAKET", line, "line516"], ["Stängsel", line, "line516"], ["RÄCKE", line, "line516"], ["A-STK", line, "line516"], ["MarkanlaggningStaketglBBefintl", line, "line516"],
      ["Bullerskydd", line, "line518"], ["MarkanlaggningBullerskyddglBBefintl", line, "line518"], ["PLANK", line, "line518"], ["HÖGT_STAKET", line, "line518"],
      ["Staket opasserbart", line, "line518"],
      ["MUR", line, "line513"], ["Stödmur", line, "line513"], ["MarkanlaggningStenmurglBBefintl", line, "line513"], ["HÖG_MUR", line, "line515"], ["Mur, opasserbar", line, "line515"],
      ["Trappa", line, "line532"], ["TrafikanlaggningTerrangtrappaglBBefintl", line, "line532"], ["ByggnadsanlaggningTrappaglBBefintl", line, "line532"],
      ["VÄGKANT", line, "line501.1"], ["Kantsten", line, "line501.1"], ["VagavgransningInfartglBBefintl", line, "line501.1"], ["VagavgransningRefugglBBefintl", line, "line501.1"],
      ["M-KS", line, "line501.1"], ["VK", line, "line501.1"], ["VagutbredningVagutbredningglBBefintl", line, "line501.1"], ["VagutbredningParkvagsutbredningglBBefintl", line, "line501.1"],
      // En sluten kantlinje fylls inte som yta.
      ["VÄGKANT", { closedLines: 4 }, "line501.1"],
      ["VagutbredningVagutbredninggyBBefintl", area, "area501"], ["Gångyta", area, "area501"], ["TORG", area, "area501"], ["Parkering", area, "area501"], ["VÄGYTA", area, "area501"],
      ["Perrong", area, "area501"],
      ["Tomtmark", area, "area520"], ["tomtmark_osm", area, "area520"], ["tomtmark_hus", { closedLines: 3 }, "area520"],
      ["Träd", point, "point418"], ["Stora träd", point, "point417"], ["VegetationTradsBBefintl", point, "point418"],
      // Mallen har ingen grön linjesymbol: häcklinjen får inget förslag (och blir inte en yta); häcken som yta blir det tätaste gröna.
      ["HÄCK", line, undefined], ["Plantering", area, "area410"],
      // Ingen symbol: slänt, altan, okänd byggnadsanläggning, marktäckets bebyggelse, text och det skymda.
      ["SLÄNT", line, undefined], ["MarkanlaggningSlantglBBefintl", line, undefined], ["ByggnadsanlaggningAltangyBBefintl", area, undefined],
      ["ByggnadsanlaggningOvriggyBBefintl", area, undefined], ["bebyggelse", area, undefined], ["BostadsbyggnadBostadsbyggnadglBBefintl", { closedLines: 5 }, undefined],
      ["TrafikanlaggningBroglBBefintl", line, "line512.1"], ["BRO", line, "line512.1"], ["TeknikanlaggningBassanggyBBefintl", area, "area301"],
      // Det som är lika i normerna går genom skogskartans regler.
      ["contour", line, "line101"], ["oppen_mark", area, "area401"], ["VattendragDikeglBBefintl", line, "line306"], ["vatten", area, "area301"]
    ];
    for (const [name, shape, symbol] of expected) expect(sprint(name, shape), name).toBe(symbol);
  });

  it("OpenStreetMaps lager på en sprintkarta", () => {
    const sprint = suggest(template("ISSPROM2019-2"), "ISSPROM");
    expect(Object.fromEntries(([["OSM byggnad", area], ["OSM skärmtak (building=roof)", area], ["OSM staket", line], ["OSM mur", line], ["OSM stödmur", line],
      ["OSM trappa", line], ["OSM gångyta (highway=pedestrian)", area], ["OSM parkering", area], ["OSM kantsten", line], ["OSM belagd yta (antagen bredd)", area],
      ["OSM kant belagd yta (antagen bredd)", { closedLines: 3 }], ["OSM stig", line], ["OSM traktorväg (track)", line], ["OSM obelagd väg (residential)", line],
      ["OSM träd", point], ["OSM träd (stort)", point], ["OSM trädrad (tree_row)", line], ["OSM järnväg", line], ["OSM tunnel eller passage", line],
      ["OSM anläggning (bridge)", { closedLines: 1 }]] as const).map(([name, shape]) => [name, sprint(name, shape)]))).toEqual({
      "OSM byggnad": "area521", "OSM skärmtak (building=roof)": "area522", "OSM staket": "line516", "OSM mur": "line513", "OSM stödmur": "line513",
      "OSM trappa": "line532", "OSM gångyta (highway=pedestrian)": "area501", "OSM parkering": "area501", "OSM kantsten": "line501.1",
      "OSM belagd yta (antagen bredd)": "area501", "OSM kant belagd yta (antagen bredd)": "line501.1", "OSM stig": "line506", "OSM traktorväg (track)": "line505",
      "OSM obelagd väg (residential)": "line505", "OSM träd": "point418", "OSM träd (stort)": "point417", "OSM trädrad (tree_row)": undefined,
      "OSM järnväg": "line509", "OSM tunnel eller passage": undefined, "OSM anläggning (bridge)": "line512.1" });
  });

  it("en OCAD-uppsättning efter ISSprOM: kanten väljs på namnet (501.100, inte ytan 501.1 eller gångvägen 501.10), muren på underkoden", () => {
    const sprint = suggest(OCAD_ISSPROM, "ISSPROM");
    expect(sprint("VÄGKANT", line)).toBe("line501.100");
    expect(sprint("Gångyta", area)).toBe("area501.0");
    expect(sprint("MUR", line)).toBe("line513.100");
    expect(sprint("Stödmur", line)).toBe("line513.200");
    expect(sprint("HÖG_MUR", line)).toBe("line515.0");
    expect(sprint("HÄCK", line)).toBe("line411.1");
    expect(sprint("OSM häck", line)).toBe("line411.1");
    expect(sprint("Plantering", area)).toBe("area411.0");
    expect(sprint("STAKET", line)).toBe("line516.0");
    expect(sprint("BRO", line)).toBe("line512.100");
    expect(sprint("OSM järnväg", line)).toBe("line509.100");
    expect(sprint("Byggnad", area)).toBe("area521.0");
    expect(sprint("Trappa", line)).toBe("line532.0");
    // Utan namn (servern skickar ibland bara nummer och form) hittas kanten på underkoden .100.
    const bare = OCAD_ISSPROM.map(({ id, code, kind }) => ({ id, code, kind }));
    expect(suggestSymbol(layer("VÄGKANT", line), bare, "ISSPROM")).toBe("line501.100");
  });

  it("den äldre sprintnormen: samma roller med ISSOM 2007:s nummer, och skogsreglernas nummer översatta eller utan förslag", () => {
    const sprint = suggest(OCAD_ISSOM, "ISSOM");
    expect(Object.fromEntries(([["Byggnad", area], ["Skärmtak", area], ["STAKET", line], ["Bullerskydd", line], ["MUR", line], ["HÖG_MUR", line], ["Trappa", line],
      ["VÄGKANT", line], ["Gångyta", area], ["Tomtmark", area], ["Träd", point], ["Stora träd", point], ["HÄCK", line], ["Plantering", area], ["OSM stig", line],
      ["contour", line], ["oppen_mark", area], ["OSM järnväg", line], ["OSM kraftledning", line], ["dike", line], ["sten", point], ["vatten", area]] as const)
      .map(([name, shape]) => [name, sprint(name, shape)]))).toEqual({
      Byggnad: "area526.1", Skärmtak: "area526.2", STAKET: "line522.0", Bullerskydd: "line524.0", MUR: "line519.1", HÖG_MUR: "line521.1", Trappa: "line529.2",
      VÄGKANT: "line529.1", Gångyta: "area529.0", Tomtmark: "area527.1", Träd: "point419.0", "Stora träd": "point418.0", HÄCK: "line421.1", Plantering: "area421.0",
      "OSM stig": "line507.0", contour: "line101.0", oppen_mark: "area401.0", "OSM järnväg": "line515.1", "OSM kraftledning": "line516.0", dike: "line307.0",
      sten: "point206.0", vatten: "area304.1" });
  });
});
