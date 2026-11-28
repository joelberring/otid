import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { RaceMapSourceMetadata } from "@o-tid/contracts";
import { readPpen } from "@o-tid/course-setting";
import { alignedDocument, checkAlignment, controlsOutside, type VersionFacts } from "./club-archive-align";
import { activeFilters, archiveFacets, archiveGroups, EMPTY_FILTER, filterArchive, filterFromSearch, filterToSearch, levelsFromCourseNames } from "./club-archive-filter";

/** ADR-0194 beslut 4: "Flytta banorna till senaste kartversionen" och arkivets filter. */
const georeference = (easting: number, grivationDegrees = 0): NonNullable<RaceMapSourceMetadata["georeference"]> => ({
  scale: 10_000, crs: { kind: "EPSG", code: 3006 }, refPoint: { easting, northing: 6_580_000 }, mapRefPoint: { x: 0, y: 0 }, grivationDegrees,
  combinedScaleFactor: 1 });
const bounds = { minX: 0, minY: 0, maxX: 120, maxY: 100 };
const facts = (georef: VersionFacts["georeference"], area = bounds): VersionFacts => ({ bounds: area, georeference: georef });
const ppen = readPpen(readFileSync(new URL("../../../../fixtures/course-setting/kartfil.ppen", import.meta.url), "utf8")).document;
const first = Object.values(ppen.controls)[0]!;

describe("kartversionerna jämförs", () => {
  it("samma georeferens: kontrollerna behåller sina lägen (också om ytan växt)", () => {
    const check = checkAlignment(facts(georeference(675_000)), facts(georeference(675_000), { ...bounds, maxX: 150 }));
    expect(check.alignment).toEqual({ kind: "SAME" });
    expect(check.extentChanged).toBe(true);
    expect(alignedDocument(ppen, check, { dx: 0, dy: 0 })).toBe(ppen);
  });

  it("olika georeferens i samma koordinatsystem: lägena räknas om via terrängen", () => {
    // Den nya kartans referenspunkt ligger 100 m längre österut: samma terräng hamnar 10 mm längre västerut (1:10 000).
    const check = checkAlignment(facts(georeference(675_000)), facts(georeference(675_100)));
    expect(check.alignment).toEqual({ kind: "GEOREFERENCED" });
    const moved = alignedDocument(ppen, check, { dx: 0, dy: 0 });
    const control = moved.controls[first.id]!;
    expect(control.at.x).toBeCloseTo(first.at.x - 10, 6);
    expect(control.at.y).toBeCloseTo(first.at.y, 6);
    // Sträckornas brytpunkter och specialobjekten följer med.
    for (const [key, leg] of Object.entries(ppen.legs)) leg.bends.forEach((bend, index) => expect(moved.legs[key]!.bends[index]!.x).toBeCloseTo(bend.x - 10, 6));
  });

  it("utan georeferens eller med olika koordinatsystem: förskjutning för hand och varning utanför kartan", () => {
    expect(checkAlignment(facts(null), facts(georeference(675_000))).alignment).toEqual({ kind: "MANUAL", reason: "NO_GEOREFERENCE" });
    const other = { ...georeference(675_000), crs: { kind: "EPSG" as const, code: 3011 } };
    const check = checkAlignment(facts(georeference(675_000)), facts(other));
    expect(check.alignment).toEqual({ kind: "MANUAL", reason: "DIFFERENT_CRS" });
    const moved = alignedDocument(ppen, check, { dx: 2.5, dy: -1 });
    expect(moved.controls[first.id]!.at).toEqual({ x: first.at.x + 2.5, y: first.at.y - 1 });
    expect(controlsOutside(moved, bounds)).toBe(false);
    expect(controlsOutside(alignedDocument(ppen, check, { dx: 500, dy: 0 }), bounds)).toBe(true);
  });

  it("okänt koordinatsystem (OCAD 8, OCAD 9–11 utan kod): kontrollera själv, även när beskrivningen är samma", () => {
    const unknown = (easting: number) => ({ ...georeference(easting), crs: { kind: "UNKNOWN" as const, description: "okänt" } });
    for (const [from, to] of [[unknown(675_000), unknown(675_100)], [unknown(675_000), unknown(675_000)], [georeference(675_000), unknown(675_000)]] as const) {
      const check = checkAlignment(facts(from), facts(to));
      expect(check.alignment).toEqual({ kind: "MANUAL", reason: "UNKNOWN_CRS" });
      expect(alignedDocument(ppen, check, { dx: 0, dy: 0 }).controls[first.id]!.at).toEqual(first.at);
    }
  });
});

describe("arkivets sökning och filter", () => {
  const entries = [
    { entryId: "a", trainingDate: "2019-04-02", year: 2019, place: "Älvsjöskogen", title: "Älvsjöskogen räv", leader: "Anna", tags: ["Rävorientering"],
      moments: ["KURVBILD" as const, "VAGVAL" as const], levels: ["GUL" as const], courseNames: ["Lång"], courseFiles: 1, maps: [{ mapId: "m1", name: "Älvsjöskogen" }], status: "COMPLETE" as const,
      thumbnail: null, thumbnailSource: null, added: { name: "Ada", at: "2026-01-01T00:00:00.000Z", via: "ARCHIVE" as const } },
    { entryId: "b", trainingDate: null, year: 2020, place: "Parken", title: "Sprint", leader: null, tags: ["Sprint"], moments: ["SPRINT" as const],
      levels: ["ORANGE" as const, "VIOLETT" as const], courseNames: [], courseFiles: 0,
      maps: [], status: "MAP_ONLY" as const, thumbnail: null, thumbnailSource: null, added: { name: "Joel Berring", at: "2026-11-12T10:00:00.000Z", via: "RACE" as const } }
  ];
  it("söker utan accenter och versaler, filtrerar på år, karta, tagg, ledare och läge", () => {
    expect(filterArchive(entries, { ...EMPTY_FILTER, text: "alvsjo rav" }).map(entry => entry.entryId)).toEqual(["a"]);
    expect(filterArchive(entries, { ...EMPTY_FILTER, year: "2020" }).map(entry => entry.entryId)).toEqual(["b"]);
    expect(filterArchive(entries, { ...EMPTY_FILTER, mapId: "m1", tags: ["Rävorientering"], leader: "Anna" })).toHaveLength(1);
    expect(filterArchive(entries, { ...EMPTY_FILTER, status: "MAP_MISSING" })).toHaveLength(0);
    expect(archiveFacets(entries)).toEqual({ years: ["2020", "2019"], tags: ["Rävorientering", "Sprint"], moments: ["KURVBILD", "VAGVAL", "SPRINT"],
      leaders: ["Anna"], addedBy: ["Ada", "Joel Berring"] });
  });

  it("ägaren 2026-11-17: vem som lade in träningen går att söka och filtrera på", () => {
    expect(filterArchive(entries, { ...EMPTY_FILTER, addedBy: "Joel Berring" }).map(entry => entry.entryId)).toEqual(["b"]);
    expect(filterArchive(entries, { ...EMPTY_FILTER, text: "berring" }).map(entry => entry.entryId)).toEqual(["b"]);
    expect(filterFromSearch("?inlagd=Ada").addedBy).toBe("Ada");
  });

  it("ADR-0222: alla valda moment, någon av nivåerna, momentens namn i sökningen och ett äldre sparat filter", () => {
    const ids = (filter: Partial<typeof EMPTY_FILTER>) => filterArchive(entries, { ...EMPTY_FILTER, ...filter }, moment => moment === "VAGVAL" ? "Vägval" : moment)
      .map(entry => entry.entryId);
    expect(ids({ moments: ["KURVBILD", "VAGVAL"] })).toEqual(["a"]);
    expect(ids({ moments: ["KURVBILD", "SPRINT"] })).toEqual([]);
    expect(ids({ levels: ["GUL", "VIOLETT"] })).toEqual(["a", "b"]);
    expect(ids({ levels: ["SVART"] })).toEqual([]);
    expect(ids({ text: "vagval" })).toEqual(["a"]);
    expect(filterFromSearch("?ord=Sprint&ar=2020&moment=NATT&moment=OKAND&visa=FEL")).toEqual({ ...EMPTY_FILTER, year: "2020", tags: ["Sprint"],
      moments: ["NATT"] });
  });
});

describe("steg F2: filtret i adressen och grupperna", () => {
  it("fram och tillbaka genom adressen, andra parametrar orörda", () => {
    const filter = { ...EMPTY_FILTER, text: "natt sprint", year: "2026", tags: ["natt", "a,b"], levels: ["GUL" as const], status: "MAP_MISSING" as const };
    const search = filterToSearch(filter, "?flik=1&ar=2019");
    expect(search).toBe("?flik=1&sok=natt+sprint&ar=2026&visa=MAP_MISSING&niva=GUL&ord=natt&ord=a%2Cb");
    expect(filterFromSearch(search)).toEqual(filter);
    expect(filterToSearch(EMPTY_FILTER)).toBe("");
    expect(activeFilters(filter)).toBe(5);
    expect(activeFilters(filter, { withTags: false })).toBe(3);
  });

  it("per månad i år och i fjol, per år för äldre, odaterade sist", () => {
    const rows = ["2026-11-20", "2026-11-03", null, "2025-01-09", "2024-10-15", "2019-04-02", "2024-03-01"].map(trainingDate => ({ trainingDate }));
    expect(archiveGroups(rows, "2026-11-28").map(group => [group.key, group.kind, group.entries.length])).toEqual([
      ["2026-11", "month", 2], ["2025-01", "month", 1], ["2024", "year", 2], ["2019", "year", 1], ["", "undated", 1]]);
  });
});

describe("ADR-0222: nivåerna ur banornas namn", () => {
  it("färgerna, klasserna och de öppna klasserna, i färgernas ordning", () => {
    expect(levelsFromCourseNames(["Orange", "Gul 2", "Lång", "H12", "Inskolning"])).toEqual(["GRON", "GUL", "ORANGE"]);
    expect(levelsFromCourseNames(["Bana 1", "Sprint"])).toEqual([]);
  });
});
