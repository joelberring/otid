import { describe, expect, it } from "vitest";
import { BUILT_IN_PRINT_PROFILES, BUILT_IN_TEMPLATES, layoutTemplateSheets, mapColorAdjust } from "@o-tid/course-setting";
import type { MapBundleResponse } from "@o-tid/contracts";
import { gridOf, parseCmyk, regrid, withColorRow } from "./course-setting-print-settings";
import { runnerPrintItems } from "./course-setting-runner-print";
import { testDocument } from "./course-setting-test-document";

const asFile = BUILT_IN_PRINT_PROFILES.find(profile => profile.id === "as-file")!;

describe("utskriftsprofilen på utskriftssidan (steg 64)", () => {
  it("läser CMYK som c/m/y/k 0–100", () => {
    expect(parseCmyk("35/95/0/0")).toEqual({ c: 35, m: 95, y: 0, k: 0 });
    expect(parseCmyk("35, 95, 0, 10")).toEqual({ c: 35, m: 95, y: 0, k: 10 });
    expect(parseCmyk("35/95/0")).toBeUndefined();
    expect(parseCmyk("120/0/0/0")).toBeUndefined();
  });

  it("ändrar en kartfärg utan att röra kartfilen och tar bort raden när allt är som i filen", () => {
    const colors = [{ id: 7, name: "Grön 60%" }, { id: 8, name: "Gul" }];
    let profile = withColorRow(asFile, 7, { lighten: 30 });
    profile = withColorRow(profile, 8, { hidden: true });
    expect(mapColorAdjust(profile, colors)).toEqual({ 7: { lighten: 0.3 }, 8: { hidden: true } });
    profile = withColorRow(profile, 7, { cmyk: { c: 50, m: 0, y: 80, k: 0 } });
    expect(mapColorAdjust(profile, colors)[7]).toEqual({ lighten: 0.3, cmyk: { c: 0.5, m: 0, y: 0.8, k: 0 } });
    profile = withColorRow(profile, 8, { hidden: false });
    expect(profile.mapColors.find(row => row.match.ocadIds?.[0] === 8)).toEqual({ match: { ocadIds: [8] } });
    expect(mapColorAdjust(withColorRow(profile, 7, null), colors)[7]).toBeUndefined();
  });
});

describe("layoutmallen på utskriftssidan (steg 64)", () => {
  it("lägger om rutnätet och rubrikerna när papper, rader eller kolumner ändras", () => {
    const four = BUILT_IN_TEMPLATES.find(template => template.id === "a4-four")!;
    expect(gridOf(four)).toEqual({ rows: 2, columns: 2 });
    const six = regrid(four, { rows: 3 });
    expect(gridOf(six)).toEqual({ rows: 3, columns: 2 });
    expect(six.frames).toHaveLength(6);
    expect(six.texts.filter(text => text.frame !== undefined)).toHaveLength(6);
    const a3 = regrid(four, { paper: "A3", landscape: true });
    expect(a3.paper).toMatchObject({ name: "A3", landscape: true });
    expect(a3.frames[1]!.x).toBeGreaterThan(200);
  });
});

type Bundles = Pick<MapBundleResponse, "groups" | "missingVariant">;
const bundles = (printCount: number): Bundles => ({
  missingVariant: [{ entryId: "00000000-0000-4000-8000-000000000009", name: "Utan Variant", className: "H21" }],
  groups: [{
    courseVersionId: "00000000-0000-4000-8000-000000000001", courseName: "Lång", variantCode: null, runnerCount: 1, vacancyCount: 1, reserveCount: 1, printCount,
    items: [
      { kind: "RUNNER", number: 101, entryId: "00000000-0000-4000-8000-000000000002", name: "Anna Andersson", club: "OK Ravinen", className: "D21",
        startTime: "2026-11-01T10:32:00.000Z" },
      { kind: "VACANT", number: 102, className: "D21", startTime: "2026-11-01T10:30:00.000Z" }
    ]
  }]
} as unknown as Bundles);

describe("en karta per löpare (steg 64)", () => {
  const clock = (instant: string | null) => instant ? instant.slice(11, 16) : "";

  it("ger löpare, lediga och reserver i buntordning och kontrollerar varianter och antal", () => {
    const result = runnerPrintItems(testDocument(), bundles(3), clock);
    expect(result.items.map(item => item.runner?.kind)).toEqual(["RUNNER", "VACANT", "RESERVE"]);
    expect(result.items[0]).toMatchObject({ course: "k", runner: { name: "Anna Andersson", className: "D21", startTime: "10:32", startNumber: 101 } });
    expect(result.counts).toEqual([{ courseName: "Lång", variantCode: null, count: 3 }]);
    expect(result.problems).toEqual([{ kind: "MISSING_VARIANT", name: "Utan Variant", className: "H21" }]);
  });

  it("sorterar i startordning med reserverna sist", () => {
    const result = runnerPrintItems(testDocument(), bundles(3), clock, "START");
    expect(result.items.map(item => item.runner?.kind)).toEqual(["VACANT", "RUNNER", "RESERVE"]);
  });

  it("varnar när en bana saknas i banläggningen eller varianten inte finns", () => {
    const base = bundles(3);
    const other = { missingVariant: [], groups: [{ ...base.groups[0]!, courseName: "Kort" }] } as unknown as Bundles;
    expect(runnerPrintItems(testDocument(), other, clock).problems).toEqual([{ kind: "UNKNOWN_COURSE", courseName: "Kort" }]);
    const forked = { missingVariant: [], groups: [{ ...base.groups[0]!, variantCode: "AB" }] } as unknown as Bundles;
    expect(runnerPrintItems(testDocument(), forked, clock).problems).toEqual([{ kind: "UNKNOWN_VARIANT", courseName: "Lång", variantCode: "AB" }]);
  });

  it("ger remsan med löparens uppgifter enkelsidigt och en baksida dubbelsidigt", () => {
    const document = testDocument();
    const { items } = runnerPrintItems(document, bundles(3), clock);
    const strip = BUILT_IN_TEMPLATES.find(template => template.id === "a4-strip")!;
    const [single] = layoutTemplateSheets(document, strip, [items[0]!]);
    expect(single!.boxes).toHaveLength(1);
    expect(single!.texts.map(text => text.text)).toContain("Anna Andersson  D21  10:32  nr 101");
    const one = BUILT_IN_TEMPLATES.find(template => template.id === "a4-one")!;
    const duplex = layoutTemplateSheets(document, one, [items[1]!], { duplexBacks: true });
    expect(duplex).toHaveLength(2);
    expect(duplex[1]!.back).toBe(true);
    // ADR-0213: baksidan är papperets element (förvalet som Kartor till startens baksida).
    expect((duplex[1]!.paperItems ?? []).map(item => item.parts.flatMap(part => part.kind === "text" ? [part.text] : []).join(""))).toEqual(["102", "Ledig", "D21  10:30"]);
  });
});
