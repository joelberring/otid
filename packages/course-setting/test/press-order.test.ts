/** ADR-0211 beslut 3: färgordningen i trycket enligt IOF:s bilaga (ISOM 2017-2 och ISSprOM 2019-2), övre och undre lila. */
import type { ColorUsage } from "@o-tid/map-file";
import { describe, expect, it } from "vitest";
import {
  BUILT_IN_PRINT_PROFILES, courseLayerOf, detectPressNorm, lowerPurple, mapColorAdjust, officePrintProfile, overColorBands, pressColorKind, pressOrder,
  type OverprintPrimitive, type PrintProfile, type SourceMapColor
} from "../src";

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

  it("PMS299-blå (87/18,5/0/0) känns igen som BLUE, ren röd (0/100/100/0) som MAGENTA, och delad sprint-grön (417+410.1 utan yta) som GREEN_POINT", () => {
    order = 0;
    expect(pressColorKind(color("PMS299 Blå linje", [87, 18.5, 0, 0], usage(["LINE", "POINT"], [304, 305])))).toBe("BLUE_LINE");
    expect(pressColorKind(color("PMS299 Blå yta", [87, 18.5, 0, 0], usage(["AREA"], [301])))).toBe("BLUE_AREA");
    expect(pressColorKind(color("Röd", [0, 100, 100, 0], usage(["LINE"], [709])))).toBe("MAGENTA");
    expect(pressColorKind(color("Grön 100% punkt+häck", [76, 0, 91, 0], usage(["LINE", "POINT"], [410, 417, 418])))).toBe("GREEN_POINT");
    expect(pressColorKind(color("Grön 100% yta+punkt", [76, 0, 91, 0], usage(["AREA", "POINT"], [410, 417])))).toBe("GREEN");
  });
});

describe("ordningen per norm (pressOrder)", () => {
  const over = (colors: readonly SourceMapColor[], norm: "ISOM" | "ISSPROM") => {
    const result = pressOrder(colors, norm).over;
    return colors.filter(item => result.has(item.ocadId)).map(item => item.name);
  };

  it("ISOM: monoton snittpunkt vid Brun 100%; solida svarta byggnader (K >= 90) stannar UNDER även över kurvor", () => {
    expect(over(forestColors(), "ISOM")).toEqual(["Brun 100%", "Blå 100%", "Svart 100%", "Vit"]);
    order = 0;
    const withHighBuilding = [
      color("Gul 100%", [0, 27, 79, 0], usage(["AREA"], [401])),
      color("Brun 100%", [0, 56, 100, 18], usage(["LINE"], [101])),
      color("Svart 100% stora byggnader", [0, 0, 0, 100], usage(["AREA"], [521])),
      color("Svart 100%", [0, 0, 0, 100], usage(["LINE"], [505]))
    ];
    expect(over(withHighBuilding, "ISOM")).toEqual(["Brun 100%", "Svart 100%"]);
    expect(over(withHighBuilding, "ISSPROM")).toEqual(["Svart 100% stora byggnader", "Svart 100%"]);
  });

  it("ISSprOM: grönt för punkter (även med 410.1 linje), svart 100 %, vitt och rött över banan; brunt, blått och grå byggnader under", () => {
    order = 0;
    const sprintColors = [
      color("Gul 100%", [0, 27, 94, 0], usage(["AREA"], [401])),
      color("Grön 100% yta", [74, 0, 91, 0], usage(["AREA"], [410])),
      color("Blå 100% yta", [100, 0, 0, 0], usage(["AREA"], [301])),
      color("Brun 50%", [0, 28, 45, 12], usage(["AREA"], [501])),
      color("Brun 100%", [0, 80, 100, 25], usage(["LINE"], [101])),
      color("Blå 100%", [100, 0, 0, 0], usage(["LINE"], [304])),
      color("Svart 60% byggnad", [0, 0, 0, 60], usage(["AREA"], [521])),
      color("Grön 100% punkt", [76, 0, 91, 0], usage(["LINE", "POINT"], [410, 417, 418])),
      color("Svart 100%", [0, 0, 0, 100], usage(["LINE", "POINT"], [505, 515])),
      color("Vit", [0, 0, 0, 0], usage(["LINE"], [512])),
      color("Röd", [0, 100, 100, 0], usage(["LINE"], [709]))
    ];
    expect(over(sprintColors, "ISSPROM")).toEqual(["Grön 100% punkt", "Svart 100%", "Vit", "Röd"]);
  });

  it("Högdalen (ISOM): snittpunkt vid Brun 100% - Linjeobjekt, så kurvor, bäckar, vägar och Svart 65% stannar i obruten ritordning i OVER", () => {
    order = 0;
    const hogdalen = [
      color("Gul 50% - Ytobjekt", [0, 10, 35, 0], usage(["AREA"], [403])),
      color("Svart för odlad mark", [0, 0, 0, 100], usage(["AREA"], [213])),
      color("Grön 100% - Ytobjekt", [80, 0, 100, 0], usage(["AREA", "LINE"], [410, 413])),
      color("Gul 100% + Grön 50%", [40, 30, 90, 0], usage(["AREA"], [520])),
      color("Vit för Grön", [0, 0, 0, 0], usage(["AREA", "POINT"], [406, 417])),
      color("Brun 50% - Ytobjekt", [10, 35, 50, 0], usage(["AREA", "LINE"], [501, 502])),
      color("Blå 100% - Ytobjekt", [95, 30, 0, 0], usage(["AREA", "POINT"], [301, 308, 310])),
      color("Vit för blå", [0, 0, 0, 0], usage(["LINE"], [508])),
      color("Brun 100% - Linjeobjekt", [20, 70, 100, 0], usage(["LINE", "POINT"], [101, 102, 103])),
      color("Blå 100% - Linjeobjekt", [95, 30, 0, 0], usage(["LINE"], [304, 305])),
      color("Svart 20% - Ytobjekt", [0, 0, 0, 20], usage(["AREA"], [522])),
      color("Svart 65% - Ytobjekt", [0, 0, 0, 65], usage(["AREA"], [521])),
      color("Svart 100% - Vägar", [0, 0, 0, 100], usage(["LINE"], [502, 505, 509])),
      color("Vit för järnväg", [0, 0, 0, 0], usage(["LINE"], [509])),
      color("Brun 50% - Vägfyllning", [10, 35, 50, 0], usage(["LINE"], [502])),
      color("Grön 100% - Punktobjekt", [80, 0, 100, 0], usage(["POINT"], [417, 418])),
      color("Svart 100%", [0, 0, 0, 100], usage(["AREA", "LINE", "POINT"], [201, 202])),
      color("vit", [0, 0, 0, 0], usage(["POINT"], [418])),
      color("Röd", [0, 100, 100, 0], usage(["AREA", "LINE"], [302, 305])),
      color("Vit för röd", [0, 0, 0, 0], usage(["TEXT"], [602]))
    ];
    const result = pressOrder(hogdalen, "ISOM");
    expect(pressColorKind(hogdalen[6]!)).toBe("BLUE_AREA");
    expect(over(hogdalen, "ISOM")).toEqual([
      "Brun 100% - Linjeobjekt", "Blå 100% - Linjeobjekt", "Svart 20% - Ytobjekt", "Svart 65% - Ytobjekt",
      "Svart 100% - Vägar", "Vit för järnväg", "Brun 50% - Vägfyllning", "Grön 100% - Punktobjekt",
      "Svart 100%", "vit", "Röd", "Vit för röd"
    ]);
    // Blå yta, asfalt (Brun 50% - Ytobjekt), tomtmark, gröna/gula ytor och Vit för blå stannar UNDER.
    for (const underName of ["Gul 50% - Ytobjekt", "Svart för odlad mark", "Brun 50% - Ytobjekt", "Blå 100% - Ytobjekt", "Vit för blå"]) {
      expect(result.classes.find(item => item.name === underName)?.side, underName).toBe("UNDER");
    }
  });

  it("PMS299-blå bäck (87/18,5/0/0) blir BLUE_LINE i OVER och sänker aldrig kurvorna", () => {
    order = 0;
    const pms299 = [
      color("Gul 100%", [0, 25, 95, 0], usage(["AREA"], [401])),
      color("Blå 100% vatten", [87, 18.5, 0, 0], usage(["AREA"], [301])),
      color("Brun 100%", [0, 56, 100, 18], usage(["LINE"], [101])),
      color("Blå 100% bäck", [87, 18.5, 0, 0], usage(["LINE"], [304])),
      color("Svart 100%", [0, 0, 0, 100], usage(["LINE"], [505]))
    ];
    expect(over(pms299, "ISOM")).toEqual(["Brun 100%", "Blå 100% bäck", "Svart 100%"]);
  });

  it("Stockholm by Night (monoton vit+grön): vitt över grön och grön punkt följs åt i exakt ordning i OVER, odlad mark och vit över gul stannar UNDER", () => {
    order = 0;
    const colors = [
      color("Gul 100%", [0, 27, 79, 0], usage(["AREA"], [401])),
      color("Svart för odlad mark", [0, 0, 0, 100], usage(["AREA"], [412])),
      color("Grön 30%", [23, 0, 27, 0], usage(["AREA"], [406])),
      color("Vit över gul", [0, 0, 0, 0], usage(["AREA"], [402])),
      color("Vit för järnväg", [0, 0, 0, 0], usage(["LINE"], [509])),
      color("Svart 100% vägkant och järnväg", [0, 0, 0, 100], usage(["LINE"], [509])),
      color("Brun 100%", [0, 56, 100, 18], usage(["LINE"], [101])),
      color("Blå 100%", [100, 0, 0, 0], usage(["LINE"], [304])),
      color("Svart 100%", [0, 0, 0, 100], usage(["LINE", "POINT"], [505, 509])),
      color("Vit över grön", [0, 0, 0, 0], usage(["POINT"], [417])),
      color("Grön 100% – Punktobjekt", [76, 0, 91, 0], usage(["POINT"], [417])),
      color("Vit för röd", [0, 0, 0, 0], usage(["AREA"], [709])),
      color("Röd", [0, 100, 0, 0], usage(["AREA"], [709]))
    ];
    const result = pressOrder(colors, "ISOM");
    const side = Object.fromEntries(result.classes.map(item => [item.name, item.side]));
    expect(side["Svart för odlad mark"]).toBe("UNDER");
    expect(result.classes.find(item => item.name === "Svart för odlad mark")?.kind).toBe("BLACK_PATTERN");
    expect(side["Vit över gul"]).toBe("UNDER");
    expect(side["Vit för järnväg"]).toBe("UNDER");
    expect(side["Svart 100% vägkant och järnväg"]).toBe("UNDER");
    // Monoton snittpunkt vid Brun 100%: både Vit över grön och Grön 100% – Punktobjekt hamnar i OVER i obruten ordning (vitt före grönt).
    expect(side["Vit över grön"]).toBe("OVER");
    expect(side["Grön 100% – Punktobjekt"]).toBe("OVER");
    expect(side["Vit för röd"]).toBe("OVER");
    expect(side["Röd"]).toBe("OVER");
    const sprint = Object.fromEntries(pressOrder(colors, "ISSPROM").classes.map(item => [item.name, item.side]));
    expect(sprint["Svart 100% vägkant och järnväg"]).toBe("OVER");
    expect(sprint["Grön 100% – Punktobjekt"]).toBe("OVER");
    expect(sprint["Vit över grön"]).toBe("OVER");
  });

  it("Getapulien (ISOM): Olivgrön, Blå 70 %, Svart 20 % och alla gröna/gula ytor ligger UNDER; Brun, Blå, Svart och Violett i OVER", () => {
    order = 0;
    const getapulien = [
      color("Gul 50 %", [0, 13.5, 39.5, 0], usage(["AREA"], [403, 404])),
      color("Gul", [0, 27, 79, 0], usage(["AREA"], [401, 412])),
      color("Grön 30 %", [23, 0, 27, 0], usage(["AREA"], [406])),
      color("Grön 60 %", [46, 0, 55, 0], usage(["AREA"], [408])),
      color("Grön", [76, 0, 91, 0], usage(["AREA"], [407, 409, 410])),
      color("Vit (prickar)", [0, 0, 0, 0], usage(["AREA"], [404])),
      color("Olivgrön", [35, 0, 100, 50], usage(["AREA"], [520])),
      color("Blå 70 %", [70, 0, 0, 0], usage(["AREA"], [301])),
      color("Svart 20 %", [0, 0, 0, 20], usage(["AREA"], [214])),
      color("Brun", [0, 56, 100, 18], usage(["LINE", "POINT"], [101, 102, 109])),
      color("Blå", [100, 0, 0, 0], usage(["AREA", "LINE"], [306, 308, 310])),
      color("Svart", [0, 0, 0, 100], usage(["AREA", "LINE", "POINT", "TEXT"], [201, 505])),
      color("Violett (bana)", [35, 85, 0, 0], usage(["POINT"], [991]))
    ];
    expect(over(getapulien, "ISOM")).toEqual(["Brun", "Blå", "Svart", "Violett (bana)"]);
  });

  it("vitt under de fulla färgerna i kartfilen (vit för grönt) ligger under banan; oanvända färger flyttar inte snittpunkten", () => {
    order = 0;
    const colors = [
      color("Oanvänd Svart 100%", [0, 0, 0, 100]),
      color("Vit för grön", [0, 0, 0, 0], usage(["AREA"], [406])),
      color("Svart 100%", [0, 0, 0, 100], usage(["LINE"], [505])),
      color("Oanvänd Gul 50%", [0, 14, 40, 0])
    ];
    expect([...pressOrder(colors, "ISOM").over]).toEqual([2, 3]);
  });
});

describe("band i OVER-lagret (overColorBands)", () => {
  it("delar OVER i sammanhängande INK- och WHITE-band i ritordning (högst rank först → rank 0 sist), utan hidden och med efterjusterad vit", () => {
    const mapColors = [
      { id: 10, rank: 0, cmyk: { c: 0, m: 1, y: 1, k: 0 } },       // Röd (överst)
      { id: 9, rank: 1, cmyk: { c: 0, m: 0, y: 0, k: 0 } },        // Vit för röd
      { id: 8, rank: 2, cmyk: { c: 0.76, m: 0, y: 0.91, k: 0 } },  // Grön punkt
      { id: 7, rank: 3, cmyk: { c: 0, m: 0, y: 0, k: 0 } },        // Vit över grön
      { id: 6, rank: 4, cmyk: { c: 0, m: 0, y: 0, k: 1 } },        // Svart 100%
      { id: 5, rank: 5, cmyk: { c: 0, m: 0.56, y: 1, k: 0.18 } },  // Brun 100%
      { id: 4, rank: 6, cmyk: { c: 0, m: 0.27, y: 0.79, k: 0 } }   // Gul (UNDER)
    ];
    const over = new Set([5, 6, 7, 8, 9, 10]);
    expect(overColorBands(mapColors, over)).toEqual([
      { kind: "INK", ids: [5, 6] },
      { kind: "WHITE", ids: [7] },
      { kind: "INK", ids: [8] },
      { kind: "WHITE", ids: [9] },
      { kind: "INK", ids: [10] }
    ]);
    // Dold färg (7) och vit som justerats till svart (9) samt brun som blekts 100 % till vit (5).
    expect(overColorBands(mapColors, over, {
      5: { lighten: 1 },
      7: { hidden: true },
      9: { cmyk: { c: 0, m: 0, y: 0, k: 1 } }
    })).toEqual([
      { kind: "WHITE", ids: [5] },
      { kind: "INK", ids: [6, 8, 9, 10] }
    ]);
  });
});

describe("normen ur kartan (detectPressNorm)", () => {
  it("1:3 000, 1:4 000 och 1:5 000 är sprint, 1:15 000 är alltid skog (ISOM); 501.1 och 521.1 räknas inte som sprintsymboler", () => {
    expect(detectPressNorm({ scale: 3000 })).toBe("ISSPROM");
    expect(detectPressNorm({ scale: 4000 })).toBe("ISSPROM");
    expect(detectPressNorm({ scale: 5000 })).toBe("ISSPROM");
    expect(detectPressNorm({ scale: 10000, codes: ["101", "505"] })).toBe("ISOM");
    expect(detectPressNorm({ scale: 10000, codes: ["501.1", "521.1", "101"] })).toBe("ISOM");
    expect(detectPressNorm({ scale: 10000, codes: ["501.2", "509.2", "101"] })).toBe("ISSPROM");
    expect(detectPressNorm({ scale: 15000, codes: ["541"] })).toBe("ISOM");
    expect(detectPressNorm({ scale: 15000, codes: ["501.2", "509.1", "522.1", "103"] })).toBe("ISOM");
  });
});

describe("övre och undre lila (lowerPurple)", () => {
  const figure = (role: OverprintPrimitive["role"], kind: "circle" | "text" | "polyline" | "polygon", colorRole: "COURSE" | "COURSE_LOWER" = "COURSE"): OverprintPrimitive =>
    kind === "circle" ? { kind, role, color: colorRole, center: { x: 0, y: 0 }, diameter: 5, lineWidth: 0.35 }
      : kind === "text" ? { kind, role, color: colorRole, at: { x: 0, y: 0 }, text: "1", heightMm: 4, align: "center" }
        : kind === "polyline" ? { kind, role, color: colorRole, points: [{ x: 0, y: 0 }, { x: 1, y: 1 }], width: 0.35 }
          : { kind, role, color: colorRole, rings: [[{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }]] };

  it("701, 703, 705, 706, 708, 710.1 och COURSE_LOWER-specialobjekt är undre lila; övriga markeringar övre", () => {
    for (const norm of ["ISOM", "ISSPROM"] as const) {
      expect(lowerPurple(figure("CONTROL", "circle"), norm)).toBe(true);
      expect(lowerPurple(figure("START", "polyline"), norm)).toBe(true);
      expect(lowerPurple(figure("FINISH", "circle"), norm)).toBe(true);
      expect(lowerPurple(figure("LEG", "polyline"), norm)).toBe(true);
      expect(lowerPurple(figure("FLAGGING", "polyline"), norm)).toBe(true);
      expect(lowerPurple(figure("CROSSING_POINT", "polyline"), norm)).toBe(true);
      expect(lowerPurple(figure("NUMBER", "text"), norm, true)).toBe(false);
      expect(lowerPurple(figure("SPECIAL", "polygon"), norm)).toBe(false);
      // 710.1 optional-crossing-point, first-aid, water och lower-purple-linjer/texter:
      expect(lowerPurple(figure("SPECIAL", "polyline", "COURSE_LOWER"), norm, true)).toBe(true);
      expect(lowerPurple(figure("SPECIAL", "polygon", "COURSE_LOWER"), norm, true)).toBe(true);
      expect(lowerPurple(figure("SPECIAL", "text", "COURSE_LOWER"), norm, true)).toBe(true);
    }
  });

  it("ISOM: numren i undre lila som i bilagan (förval), så att kurvorna korsar dem; \"Kontrollnummer och texter överst\" lägger dem överst", () => {
    expect(lowerPurple(figure("NUMBER", "text"), "ISOM")).toBe(true);
    expect(lowerPurple(figure("NUMBER", "text"), "ISOM", true)).toBe(false);
  });

  it("ISSprOM: numren alltid i övre lila (704 finns inte i listan för undre lila)", () => {
    expect(lowerPurple(figure("NUMBER", "text"), "ISSPROM")).toBe(false);
    expect(lowerPurple(figure("NUMBER", "text"), "ISSPROM", false)).toBe(false);
  });
});

describe("vita specialobjekt och bilder under banan (courseLayerOf, städrundan 2026-11-07)", () => {
  it("white-out och bilder under banan; COURSE_LOWER undre lila, andra markeringar övre lila, ringar undre", () => {
    const whiteOut: OverprintPrimitive = { kind: "polygon", role: "SPECIAL", color: "WHITE", rings: [[{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }]], ref: "1" };
    const image: OverprintPrimitive = { kind: "image", role: "SPECIAL", rect: { minX: 0, minY: 0, maxX: 1, maxY: 1 }, mediaType: "image/png", data: "", ref: "2" };
    const hatch: OverprintPrimitive = { kind: "polyline", role: "SPECIAL", color: "COURSE", points: [{ x: 0, y: 0 }, { x: 1, y: 1 }], width: 0.2, ref: "3" };
    const crossing: OverprintPrimitive = { kind: "polyline", role: "SPECIAL", color: "COURSE_LOWER", points: [{ x: 0, y: 0 }, { x: 1, y: 1 }], width: 0.35, ref: "4" };
    const ring: OverprintPrimitive = { kind: "circle", role: "CONTROL", color: "COURSE", center: { x: 0, y: 0 }, diameter: 5, lineWidth: 0.35 };
    for (const norm of ["ISOM", "ISSPROM"] as const) for (const top of [false, true]) {
      expect(courseLayerOf(whiteOut, norm, top)).toBe("BENEATH");
      expect(courseLayerOf(image, norm, top)).toBe("BENEATH");
      expect(courseLayerOf(hatch, norm, top)).toBe("UPPER");
      expect(courseLayerOf(crossing, norm, top)).toBe("LOWER");
      expect(courseLayerOf(ring, norm, top)).toBe("LOWER");
    }
  });
});

describe("kontorsskrivarens profil (officePrintProfile)", () => {
  const blForest = BUILT_IN_PRINT_PROFILES.find(item => item.id === "bl-forest-2026-11-02")!;
  const custom: PrintProfile = {
    ...blForest,
    id: "egen-bl",
    name: "Egen BL",
    pressNorm: "ISOM",
    numbersOnTop: true,
    colorDecisions: [{ ocadId: 26, name: "Grön 100% - Ytobjekt", cmyk: { c: 80, m: 0, y: 100, k: 0 }, row: "green-100" }],
    mapColors: [{ match: { ocadIds: [32] }, lighten: 0 }, { match: { ocadIds: [2] }, hidden: true }],
    requirements: { pdfX: true, icc: true, trueOverprint: true }
  };

  it("bevarar hela tävlingsprofilen (färger, BL-beslut, banfärg, ordning) utan påtvingad ljusning, och rensar tryckerikrav", () => {
    const plain = officePrintProfile(custom);
    expect(plain.id).toBe("egen-bl");
    expect(plain.course).toEqual(custom.course);
    expect(plain.colorDecisions).toEqual(custom.colorDecisions);
    expect(plain.mapColors).toEqual(custom.mapColors);
    expect(plain.reference).toBe(custom.reference);
    expect(plain.courseLayer).toBe("REFERENCE");
    expect(plain.pressNorm).toBe("ISOM");
    expect(plain.numbersOnTop).toBe(true);
    expect(plain.rules).toEqual([]);
    expect(plain.requirements).toEqual({ pdfX: false, icc: false, trueOverprint: false });
  });

  it("med lighten: true läggs skärpt kontorsljusning till som fallback efter egna rader (BL-CMYK bevaras och egen lighten: 0 vinner)", () => {
    const lightened = officePrintProfile(custom, { lighten: true });
    const adjust = mapColorAdjust(lightened, [
      { id: 26, name: "Grön 100% - Ytobjekt" },
      { id: 32, name: "Gul 100% - Ytobjekt" },
      { id: 11, name: "Olivgrön" },
      { id: 2, name: "Svart 100%" }
    ]);
    // BL-CMYK (76/0/91/0) bevaras OCH ljusas 30 % av fallback-mönstret; egen lighten: 0 stoppar gul-ljusning; Olivgrön orörd.
    expect(adjust[26]).toEqual({ cmyk: { c: 0.76, m: 0, y: 0.91, k: 0 }, lighten: 0.3 });
    expect(adjust[32]).toEqual({ lighten: 0 });
    expect(adjust[11]).toBeUndefined();
    expect(adjust[2]).toEqual({ hidden: true });
  });
});
