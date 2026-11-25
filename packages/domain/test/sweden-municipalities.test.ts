import { describe, expect, it } from "vitest";
import {
  SWEDEN_COUNTIES,
  SWEDEN_MUNICIPALITIES,
  countiesForMunicipalities,
  countyByCode,
  municipalitiesForBounds,
  municipalityByCode,
  searchMunicipalities
} from "../src/sweden-municipalities";

describe("sweden-municipalities", () => {
  it("contains all 290 municipalities and 21 counties with valid unique SCB codes and bounds", () => {
    expect(SWEDEN_COUNTIES).toHaveLength(21);
    expect(SWEDEN_MUNICIPALITIES).toHaveLength(290);

    const countyCodes = new Set(SWEDEN_COUNTIES.map((c) => c.code));
    expect(countyCodes.size).toBe(21);

    const muniCodes = new Set<string>();
    for (const m of SWEDEN_MUNICIPALITIES) {
      expect(m.code).toMatch(/^\d{4}$/);
      expect(muniCodes.has(m.code)).toBe(false);
      muniCodes.add(m.code);
      expect(countyCodes.has(m.countyCode)).toBe(true);
      expect(m.countyName.length).toBeGreaterThan(0);
      expect(m.bounds.minLon).toBeLessThan(m.bounds.maxLon);
      expect(m.bounds.minLat).toBeLessThan(m.bounds.maxLat);
      expect(m.bounds.minLon).toBeGreaterThanOrEqual(10);
      expect(m.bounds.maxLon).toBeLessThanOrEqual(25);
      expect(m.bounds.minLat).toBeGreaterThanOrEqual(55);
      expect(m.bounds.maxLat).toBeLessThanOrEqual(70);
    }

    for (const c of SWEDEN_COUNTIES) {
      expect(c.code).toMatch(/^\d{2}$/);
      expect(c.bounds.minLon).toBeLessThan(c.bounds.maxLon);
      expect(c.bounds.minLat).toBeLessThan(c.bounds.maxLat);
    }
  });

  it("looks up municipalities and counties by SCB code", () => {
    expect(municipalityByCode("0180")).toMatchObject({
      code: "0180",
      name: "Stockholm",
      countyCode: "01",
      countyName: "Stockholms län"
    });
    expect(municipalityByCode("1480")?.name).toBe("Göteborg");
    expect(municipalityByCode("2584")?.name).toBe("Kiruna");
    expect(municipalityByCode("9999")).toBeUndefined();

    expect(countyByCode("09")?.name).toBe("Gotlands län");
    expect(countyByCode("99")).toBeUndefined();
    expect(countiesForMunicipalities(["0180", "0182", "1480", "9999"])).toEqual(["01", "14"]);
  });

  it("matches municipalities for map bounding boxes", () => {
    // Small map on Gotland sits solely in 0980 Gotland
    expect(
      municipalitiesForBounds({ minLon: 18.30, minLat: 57.60, maxLon: 18.35, maxLat: 57.65 })
    ).toEqual(["0980"]);

    // Central Stockholm ranks Stockholm first
    const stockholm = municipalitiesForBounds({
      minLon: 18.04,
      minLat: 59.32,
      maxLon: 18.08,
      maxLat: 59.34
    });
    expect(stockholm[0]).toBe("0180");
    expect(stockholm.length).toBeLessThanOrEqual(5);

    // Northern Kiruna (Abisko) sits solely in 2584 Kiruna
    expect(
      municipalitiesForBounds({ minLon: 18.75, minLat: 68.30, maxLon: 18.90, maxLat: 68.40 })
    ).toEqual(["2584"]);

    // Kiruna town ranks Kiruna first
    expect(
      municipalitiesForBounds({ minLon: 20.15, minLat: 67.82, maxLon: 20.30, maxLat: 67.90 })[0]
    ).toBe("2584");

    // Point bbox works
    expect(
      municipalitiesForBounds({ minLon: 18.32, minLat: 57.62, maxLon: 18.32, maxLat: 57.62 })
    ).toEqual(["0980"]);

    // Outside Sweden returns empty
    expect(
      municipalitiesForBounds({ minLon: -1.0, minLat: 51.0, maxLon: 0.0, maxLat: 52.0 })
    ).toEqual([]);

    // Respects max option
    const large = municipalitiesForBounds(
      { minLon: 17.0, minLat: 59.0, maxLon: 19.0, maxLat: 60.0 },
      { max: 3 }
    );
    expect(large).toHaveLength(3);
  });

  it("searches municipalities case- and diacritic-insensitively", () => {
    const goteborg = searchMunicipalities("goteborg");
    expect(goteborg[0]?.code).toBe("1480");

    const orebro = searchMunicipalities("OREBRO");
    expect(orebro[0]?.code).toBe("1880");

    const alvdalen = searchMunicipalities("alvdal");
    expect(alvdalen[0]?.code).toBe("2039");

    const byCode = searchMunicipalities("0180");
    expect(byCode[0]?.name).toBe("Stockholm");

    const byCounty = searchMunicipalities("blekinge");
    expect(byCounty.map((m) => m.countyCode)).toEqual(["10", "10", "10", "10", "10"]);
  });
});
