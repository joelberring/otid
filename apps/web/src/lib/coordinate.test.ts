import { describe, expect, it } from "vitest";
import { formatCoordinate, parseCoordinate } from "./coordinate";

describe("koordinat i georeferensen", () => {
  it("läser lat, lon som webbkartor kopierar dem", () => {
    expect(parseCoordinate("59.33012, 18.06021")).toEqual({ latitude: 59.33012, longitude: 18.06021 });
    expect(parseCoordinate(" 59.33012 18.06021 ")).toEqual({ latitude: 59.33012, longitude: 18.06021 });
    expect(parseCoordinate("-33.9;151.2")).toEqual({ latitude: -33.9, longitude: 151.2 });
  });

  it("läser decimalkomma med mellanslag eller semikolon", () => {
    expect(parseCoordinate("59,33012 18,06021")).toEqual({ latitude: 59.33012, longitude: 18.06021 });
    expect(parseCoordinate("59,33012; 18,06021")).toEqual({ latitude: 59.33012, longitude: 18.06021 });
  });

  it("avvisar ett tal, tre tal, text och värden utanför jorden", () => {
    for (const value of ["", "59.3", "59.3, 18.0, 4", "norr, söder", "91.0, 18.0", "59.0, 181.0"]) expect(parseCoordinate(value)).toBeUndefined();
  });

  it("skriver tillbaka samma form", () => {
    expect(parseCoordinate(formatCoordinate({ latitude: 59.1, longitude: 18.2 }))).toEqual({ latitude: 59.1, longitude: 18.2 });
  });
});
