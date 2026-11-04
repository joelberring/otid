/** ADR-0211 beslut 3: färgordningen i trycket enligt IOF:s bilaga (ISOM 2017-2 och ISSprOM 2019-2), övre och undre lila. */
import type { ColorUsage } from "@o-tid/map-file";
import { describe, expect, it } from "vitest";
import { detectPressNorm, lowerPurple, officePrintProfile, pressColorKind, pressOrder, type OverprintPrimitive, type SourceMapColor } from "../src";

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

  it("Stockholm by Night: vitt under det gröna trädet följer trädet under banan (gröna ringen försvann under sin vita gloria)", () => {
    // Som ägarens OCAD-karta, underst först: vitt över grön ritas direkt under grönt 100 % för punkter, och båda över svart.
    order = 0;
    const colors = [
      color("Gul 100%", [0, 27, 79, 0], usage(["AREA"], [401])),
      color("Svart för odlad mark", [0, 0, 0, 100], usage(["AREA"], [412])),
      color("Grön 30%", [23, 0, 27, 0], usage(["AREA"], [406])),
      color("Vit över gul", [0, 0, 0, 0], usage(["AREA"], [402])),
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
    // Förut: allt vitt över den lägsta färgen över banan lyftes över banan, men grönt för punkter ligger under i ISOM,
    // så skivan låg över sin egen ring.
    expect(side["Grön 100% – Punktobjekt"]).toBe("UNDER");
    expect(side["Vit över grön"]).toBe("UNDER");
    expect(side["Vit över gul"]).toBe("UNDER");
    // Äkta övre vitt: över all svart och inget under banan ritas över det.
    expect(side["Vit för röd"]).toBe("OVER");
    expect(side["Svart för odlad mark"]).toBe("UNDER");
    expect(result.classes.find(item => item.name === "Svart för odlad mark")?.kind).toBe("BLACK_PATTERN");
    // Inom varje sida ritas färgerna i kartfilens ordning: vitt direkt under ringen också under banan.
    const under = colors.filter(item => !result.over.has(item.ocadId)).map(item => item.name);
    expect(under.slice(-2)).toEqual(["Vit över grön", "Grön 100% – Punktobjekt"]);
    // ISSprOM: grönt för punkter ligger över banan, och vitet följer med.
    const sprint = Object.fromEntries(pressOrder(colors, "ISSPROM").classes.map(item => [item.name, item.side]));
    expect(sprint["Grön 100% – Punktobjekt"]).toBe("OVER");
    expect(sprint["Vit över grön"]).toBe("OVER");
  });

  it("järnvägen: vitt under de svarta strecken stannar under dem (vita streck över svart på ägarens utskrift)", () => {
    order = 0;
    const colors = [
      color("Gul 100%", [0, 27, 79, 0], usage(["AREA"], [401])),
      color("Brun 100%", [0, 56, 100, 18], usage(["LINE"], [101])),
      color("Vit för järnväg", [0, 0, 0, 0], usage(["LINE"], [509])),
      color("Svart 100%", [0, 0, 0, 100], usage(["LINE"], [505, 509])),
      color("Grön 100% – Punktobjekt", [76, 0, 91, 0], usage(["POINT"], [417]))
    ];
    const result = pressOrder(colors, "ISOM");
    // Vitet ligger under all svart i filen: inte övre vitt. Under banan ritas det före svart (över banan), som i filen.
    expect(result.over.has(2)).toBe(false);
    expect(result.over.has(3)).toBe(true);
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
      expect(lowerPurple(figure("NUMBER", "text"), norm, true)).toBe(false);
      expect(lowerPurple(figure("SPECIAL", "polygon"), norm)).toBe(false);
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

describe("kontorsskrivarens profil (officePrintProfile)", () => {
  it("kontorsskrivarens färger med tävlingsprofilens färgordning", () => {
    const office = officePrintProfile({ courseLayer: "REFERENCE", pressNorm: "ISOM", numbersOnTop: true });
    expect(office.id).toBe("office");
    expect(office.courseLayer).toBe("REFERENCE");
    expect(office.numbersOnTop).toBe(true);
    expect(office.mapColors.length).toBeGreaterThan(0);
    expect(officePrintProfile({}).courseLayer).toBeUndefined();
  });
});
