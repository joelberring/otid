/** ADR-0211 beslut 3: färgordningen i trycket enligt IOF:s bilaga (ISOM 2017-2 och ISSprOM 2019-2), övre och undre lila. */
import type { ColorUsage } from "@o-tid/map-file";
import { describe, expect, it } from "vitest";
import { detectPressNorm, lowerPurple, pressColorKind, pressOrder, type OverprintPrimitive, type SourceMapColor } from "../src";

const usage = (kinds: ColorUsage["kinds"], mains: number[]): ColorUsage =>
  ({ objects: 3, kinds, codes: mains.map(main => `${main}`), mains });

let order = 0;
/** En kartfärg som i OCAD:s färgtabeller (CMYK i procent), ritad i ordningen de skapas (senare = högre). */
const color = (name: string, cmyk: [number, number, number, number], used?: ColorUsage): SourceMapColor =>
  ({ ocadId: order, name, cmyk: { c: cmyk[0], m: cmyk[1], y: cmyk[2], k: cmyk[3] }, overprint: false, drawOrder: order++, ...(used ? { usage: used } : {}) });

/** En skogskarta som OCAD:s ISOM-tabell, underst först. */
function forestColors(): SourceMapColor[] {
  order = 0;
  return [
    color("Gul 100%", [0, 27, 79, 0], usage(["AREA"], [401])),
    color("Grön 30%", [23, 0, 27, 0], usage(["AREA"], [406])),
    color("Blå 50%", [50, 0, 0, 0], usage(["AREA"], [301])),
    color("Brun 50%", [0, 28, 45, 12], usage(["AREA"], [529])),
    color("Asfalt", [0, 28, 45, 12], usage(["AREA"], [501])),
    color("Hårdgjord yta", [0, 20, 35, 0], usage(["AREA"], [501])),
    color("Svart 100% stora byggnader", [0, 0, 0, 100], usage(["AREA"], [521])),
    color("Blå 100% vatten", [100, 0, 0, 0], usage(["AREA"], [301, 302])),
    color("Brun 100%", [0, 56, 100, 18], usage(["LINE", "POINT"], [101, 109])),
    color("Blå 100%", [100, 0, 0, 0], usage(["LINE", "POINT"], [304, 312])),
    color("Svart 100%", [0, 0, 0, 100], usage(["LINE", "POINT"], [505, 521, 526])),
    color("Vit", [0, 0, 0, 0], usage(["AREA"], [999]))
  ];
}

describe("färgslagen (pressColorKind)", () => {
  it("bara 100 %-färger är fulla; skärmar och ytor med andel under 90 % är skärm", () => {
    const kinds = Object.fromEntries(forestColors().map(item => [item.name, pressColorKind(item)]));
    expect(kinds).toEqual({
      "Gul 100%": "SCREEN", "Grön 30%": "SCREEN", "Blå 50%": "SCREEN", "Brun 50%": "SCREEN", "Asfalt": "SCREEN", "Hårdgjord yta": "SCREEN",
      "Svart 100% stora byggnader": "BLACK_BUILDING", "Blå 100% vatten": "BLUE_AREA", "Brun 100%": "BROWN", "Blå 100%": "BLUE_LINE",
      "Svart 100%": "BLACK", "Vit": "WHITE"
    });
  });

  it("utan användning avgör namnet: asfalt och vägfyllning är skärm även med brunt namn", () => {
    order = 0;
    expect(pressColorKind(color("Brun 100% vägfyllning", [0, 56, 100, 18]))).toBe("SCREEN");
    expect(pressColorKind(color("Svart byggnad", [0, 0, 0, 100]))).toBe("BLACK_BUILDING");
    expect(pressColorKind(color("Svart vägkant", [0, 0, 0, 100]))).toBe("BLACK_ROAD_EDGE");
  });
});

describe("ordningen per norm (pressOrder)", () => {
  const over = (norm: "ISOM" | "ISSPROM") => {
    const colors = forestColors();
    const result = pressOrder(colors, norm).over;
    return colors.filter(item => result.has(item.ocadId)).map(item => item.name);
  };

  it("ISOM: svart (utom stora byggnader), blått 100 % för linjer och punkter, brunt 100 % och vitt överst ligger över banan", () => {
    expect(over("ISOM")).toEqual(["Brun 100%", "Blå 100%", "Svart 100%", "Vit"]);
  });

  it("ISSprOM: svart 100 % (också byggnaderna) ligger över banan; blått och brunt 100 % under", () => {
    expect(over("ISSPROM")).toEqual(["Svart 100% stora byggnader", "Svart 100%", "Vit"]);
  });

  it("asfalt, brunt 50 % och alla skärmar ligger aldrig över banan", () => {
    for (const norm of ["ISOM", "ISSPROM"] as const) {
      expect(over(norm)).not.toEqual(expect.arrayContaining(["Asfalt"]));
      expect(over(norm).some(name => /50%|30%|Asfalt|Hårdgjord|Gul/.test(name))).toBe(false);
    }
  });

  it("vitt under de fulla färgerna i kartfilen (vit för grönt) ligger under banan", () => {
    order = 0;
    const colors = [color("Vit för grön", [0, 0, 0, 0], usage(["AREA"], [406])), color("Svart 100%", [0, 0, 0, 100], usage(["LINE"], [505]))];
    expect([...pressOrder(colors, "ISOM").over]).toEqual([1]);
  });
});

describe("normen ur kartan (detectPressNorm)", () => {
  it("1:4 000 och 1:5 000 är sprint, annars sprintens egna symbolnummer", () => {
    expect(detectPressNorm({ scale: 4000 })).toBe("ISSPROM");
    expect(detectPressNorm({ scale: 5000 })).toBe("ISSPROM");
    expect(detectPressNorm({ scale: 10000, codes: ["101", "505"] })).toBe("ISOM");
    expect(detectPressNorm({ scale: 10000, codes: ["501.1", "509.2", "101"] })).toBe("ISSPROM");
    expect(detectPressNorm({ scale: 15000, codes: ["541"] })).toBe("ISOM");
  });
});

describe("övre och undre lila (lowerPurple)", () => {
  const figure = (role: OverprintPrimitive["role"], kind: "circle" | "text" | "polyline" | "polygon"): OverprintPrimitive =>
    kind === "circle" ? { kind, role, color: "COURSE", center: { x: 0, y: 0 }, diameter: 5, lineWidth: 0.35 }
      : kind === "text" ? { kind, role, color: "COURSE", at: { x: 0, y: 0 }, text: "1", heightMm: 4, align: "center" }
        : kind === "polyline" ? { kind, role, color: "COURSE", points: [{ x: 0, y: 0 }, { x: 1, y: 1 }], width: 0.35 }
          : { kind, role, color: "COURSE", rings: [[{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }]] };

  it("701, 703, 705, 706, 708 och 710.1 är undre lila; nummer och markeringar övre", () => {
    for (const norm of ["ISOM", "ISSPROM"] as const) {
      expect(lowerPurple(figure("CONTROL", "circle"), norm)).toBe(true);
      expect(lowerPurple(figure("START", "polyline"), norm)).toBe(true);
      expect(lowerPurple(figure("FINISH", "circle"), norm)).toBe(true);
      expect(lowerPurple(figure("LEG", "polyline"), norm)).toBe(true);
      expect(lowerPurple(figure("FLAGGING", "polyline"), norm)).toBe(true);
      expect(lowerPurple(figure("CROSSING_POINT", "polyline"), norm)).toBe(true);
      expect(lowerPurple(figure("NUMBER", "text"), norm)).toBe(false);
      expect(lowerPurple(figure("SPECIAL", "polygon"), norm)).toBe(false);
    }
  });

  it("ISOM med \"Kontrollnummer och texter överst\" av: numren i undre lila som i bilagan; sprint alltid överst", () => {
    expect(lowerPurple(figure("NUMBER", "text"), "ISOM", false)).toBe(true);
    expect(lowerPurple(figure("NUMBER", "text"), "ISSPROM", false)).toBe(false);
  });
});
