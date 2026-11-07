import { describe, expect, it } from "vitest";
import { guessVersionYear } from "../src/map-version-year";
import { yearOfYearFolder } from "../src/year-folder";

/** Städrundan C4: en regel för årsmappar (importen, träningens mapp och kartversionens år). */
describe("yearOfYearFolder", () => {
  it("bara året eller året och ord är en årsmapp", () => {
    expect(yearOfYearFolder("2019")).toBe(2019);
    expect(yearOfYearFolder(" 2019  träningar ")).toBe(2019);
    expect(yearOfYearFolder("2019 [Anna]")).toBe(2019);
  });

  it("ett datum efter året är en träning, inte en årsmapp", () => {
    expect(yearOfYearFolder("2019 04-02 Skogen")).toBeNull();
    expect(yearOfYearFolder("2019-04-02 Skogen")).toBeNull();
    expect(yearOfYearFolder("20190402 Skogen")).toBeNull();
    expect(yearOfYearFolder("2019-träningar")).toBeNull();
    expect(yearOfYearFolder("Skogen 2019")).toBeNull();
  });

  it("orimliga år räknas inte", () => {
    expect(yearOfYearFolder("1949")).toBeNull();
    expect(yearOfYearFolder("1950")).toBe(1950);
    expect(yearOfYearFolder("2101")).toBeNull();
  });

  it("kartversionens år: \"2019 04-02 Skogen\" är en mapp med år, inte en årsmapp", () => {
    const base = { fileName: "skogen.ocd", versionDate: null, uploadedAt: "2026-11-03T10:00:00Z" };
    expect(guessVersionYear({ ...base, sourcePath: "2019 04-02 Skogen/skogen.ocd" })).toEqual({ year: 2019, source: "FOLDER" });
    expect(guessVersionYear({ ...base, sourcePath: "2019 träningar/04-02 Skogen/skogen.ocd" })).toEqual({ year: 2019, source: "YEAR_FOLDER" });
  });
});
