import { describe, expect, it } from "vitest";
import { guessVersionYear, versionYearSpan, yearInText } from "../src/map-version-year";

/** ADR-0210 beslut 3: versionens år gissas ur filnamnet, mapparna, årsmappen, datumet och uppladdningen. */
const base = { sourcePath: null, versionDate: null, uploadedAt: "2026-11-03T10:00:00Z" } as const;

describe("guessVersionYear", () => {
  it("tar året ur filnamnet först (det senaste om det finns flera)", () => {
    expect(guessVersionYear({ ...base, fileName: "Älvsjöskogen 2019.ocd", sourcePath: "2023/05-12 Skogen/Älvsjöskogen 2019.ocd" }))
      .toEqual({ year: 2019, source: "FILE_NAME" });
    expect(guessVersionYear({ ...base, fileName: "Älvsjöskogen 2018-08-12 V11.ocd" })).toEqual({ year: 2018, source: "FILE_NAME" });
    expect(guessVersionYear({ ...base, fileName: "Skogen 2014 rev 2021.omap" })).toEqual({ year: 2021, source: "FILE_NAME" });
  });

  it("sedan en mapp med år i namnet, närmast filen först", () => {
    expect(guessVersionYear({ ...base, fileName: "skogen.ocd", sourcePath: "2022/Älvsjöskogen 2017/skogen.ocd" }))
      .toEqual({ year: 2017, source: "FOLDER" });
    expect(guessVersionYear({ ...base, fileName: "skogen.ocd", sourcePath: "Träningar/2019-05-12 Älvsjö/skogen.ocd" }))
      .toEqual({ year: 2019, source: "FOLDER" });
  });

  it("sedan importens årsmapp, versionens datum och sist uppladdningen", () => {
    expect(guessVersionYear({ ...base, fileName: "skogen.ocd", sourcePath: "2020/04-26 Skogen [Åsa]/skogen.ocd", versionDate: "2021-01-01" }))
      .toEqual({ year: 2020, source: "YEAR_FOLDER" });
    expect(guessVersionYear({ ...base, fileName: "skogen.ocd", sourcePath: "2016 träningar/Skogen/skogen.ocd" }))
      .toEqual({ year: 2016, source: "YEAR_FOLDER" });
    expect(guessVersionYear({ ...base, fileName: "skogen.ocd", versionDate: "2015-06-01" })).toEqual({ year: 2015, source: "DATE" });
    expect(guessVersionYear({ ...base, fileName: "skogen.ocd" })).toEqual({ year: 2026, source: "UPLOAD" });
    expect(guessVersionYear({ ...base, fileName: "skogen.ocd", uploadedAt: new Date("2024-02-02T00:00:00Z") }).year).toBe(2024);
  });

  it("ett inskrivet år gäller före gissningen; orimliga år räknas inte", () => {
    expect(guessVersionYear({ ...base, fileName: "Skogen 2019.ocd", manualYear: 2014 })).toEqual({ year: 2014, source: "MANUAL" });
    expect(guessVersionYear({ ...base, fileName: "Skogen 2019.ocd", manualYear: 1800 }).source).toBe("FILE_NAME");
    expect(yearInText("Karta 1:10000 20190512")).toBeNull();
    expect(yearInText("Karta 1945 och 2031")).toBe(2031);
  });
});

describe("versionYearSpan", () => {
  it("ger första och sista året", () => {
    expect(versionYearSpan([2019, 2014, 2023])).toEqual({ from: 2014, to: 2023 });
    expect(versionYearSpan([])).toBeNull();
  });
});
