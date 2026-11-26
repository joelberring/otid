import { describe, expect, it } from "vitest";
import { applyEdit, BUILT_IN_PRINT_PROFILES, BUILT_IN_SHEET_LAYOUTS, sheetLayoutSheets, mapColorAdjust, printSheetGroups } from "@o-tid/course-setting";
import type { MapBundleResponse } from "@o-tid/contracts";
import { gridOf, parseCmyk, prepareImportedProfile, ProfileDraftTracker, regrid, uniqueProfileId, withColorRow } from "./course-setting-print-settings";
import { editableCopy } from "../components/course-setting/course-setting-print-colors";
import { runnerPrintItems } from "./course-setting-runner-print";
import { testDocument } from "./course-setting-test-document";

const asFile = BUILT_IN_PRINT_PROFILES.find(profile => profile.id === "as-file")!;
const office = BUILT_IN_PRINT_PROFILES.find(profile => profile.id === "office")!;
const mapOwn = BUILT_IN_PRINT_PROFILES.find(profile => profile.id === "map-own")!;

describe("utskriftsprofilen på utskriftssidan (steg 64)", () => {
  it("läser CMYK som c/m/y/k 0–100", () => {
    expect(parseCmyk("35/95/0/0")).toEqual({ c: 35, m: 95, y: 0, k: 0 });
    expect(parseCmyk("35, 95, 0, 10")).toEqual({ c: 35, m: 95, y: 0, k: 10 });
    expect(parseCmyk("35/95/0")).toBeUndefined();
    expect(parseCmyk("120/0/0/0")).toBeUndefined();
  });

  it("ändrar en kartfärg utan att röra kartfilen och tar bort zombieraden när allt återställts", () => {
    const colors = [{ id: 7, name: "Grön 60%" }, { id: 8, name: "Gul" }];
    let profile = withColorRow(asFile, 7, { lighten: 30 });
    profile = withColorRow(profile, 8, { hidden: true });
    expect(mapColorAdjust(profile, colors)).toEqual({ 7: { lighten: 0.3 }, 8: { hidden: true } });
    profile = withColorRow(profile, 7, { cmyk: { c: 50, m: 0, y: 80, k: 0 } });
    expect(mapColorAdjust(profile, colors)[7]).toEqual({ lighten: 0.3, cmyk: { c: 0.5, m: 0, y: 0.8, k: 0 } });
    profile = withColorRow(profile, 8, { hidden: false });
    expect(profile.mapColors.find(row => row.match.ocadIds?.[0] === 8)).toBeUndefined();
    expect(mapColorAdjust(withColorRow(profile, 7, null), colors)[7]).toBeUndefined();
  });

  it("sparar explicit lighten: 0 (mot mönsterregel) och spot: null (stänger av filens dekorfärg) och rensar tomma rader", () => {
    const colors = [{ id: 7, name: "Grön 60%" }];
    const zeroed = withColorRow(office, 7, { lighten: 0 });
    expect(zeroed.mapColors[0]).toEqual({ match: { ocadIds: [7] }, lighten: 0 });
    expect(mapColorAdjust(zeroed, colors)[7]?.lighten).toBe(0);
    const spotOff = withColorRow(asFile, 7, { spot: null });
    expect(spotOff.mapColors[0]).toEqual({ match: { ocadIds: [7] }, spot: null });
    expect(mapColorAdjust(spotOff, colors)[7]?.spot).toBeNull();
    // Återställning av spot och lighten tar bort hela raden (ingen tom zombierad).
    expect(withColorRow(spotOff, 7, { spot: undefined }).mapColors).toEqual([]);
    expect(withColorRow(withColorRow(asFile, 7, { cmyk: { c: 10, m: 0, y: 0, k: 0 } }), 7, { cmyk: undefined }).mapColors).toEqual([]);
  });

  it("JSON-import av en inbyggd profil ger automatiskt ett unikt id ≤ 64 tecken som accepteras av PUT_PRINT_PROFILE", () => {
    const imported = prepareImportedProfile(mapOwn, new Set(["map-own-import-1000"]), BUILT_IN_PRINT_PROFILES, 1000);
    expect(imported.id).not.toBe(mapOwn.id);
    expect(imported.id).not.toBe("map-own-import-1000");
    expect(imported.id.length).toBeLessThanOrEqual(64);
    expect(imported.basedOn).toBe(mapOwn.id);
    const savedDoc = applyEdit(testDocument(), { type: "PUT_PRINT_PROFILE", profile: imported }).document;
    expect(savedDoc.event.printProfiles?.some(item => item.id === imported.id)).toBe(true);
    const longId = uniqueProfileId("a".repeat(80), new Set(), 1234567890);
    expect(longId.length).toBeLessThanOrEqual(64);
  });

  it("ProfileDraftTracker serialiserar två snabba klick utan överskrivning eller dubblett-id", () => {
    const tracker = new ProfileDraftTracker(mapOwn);
    const ids = new Set(BUILT_IN_PRINT_PROFILES.map(item => item.id));
    let clock = 1000;
    const copyOf = (current: typeof mapOwn, existing: ReadonlySet<string>) => editableCopy(current, BUILT_IN_PRINT_PROFILES, clock++, existing);
    const first = tracker.begin(ids, current => withColorRow(current, 7, { hidden: true }), copyOf);
    // Klick 2 innan klick 1 hunnit sparas tillbaka från servern:
    const second = tracker.begin(ids, current => withColorRow(current, 8, { lighten: 20 }), copyOf);
    expect(second.id).toBe(first.id);
    expect(second.mapColors).toEqual([
      { match: { ocadIds: [8] }, lighten: 20 },
      { match: { ocadIds: [7] }, hidden: true }
    ]);
    // Mellanliggande prop-uppdatering från klick 1 skriver inte över klick 2 medan klick 2 pågår.
    expect(tracker.sync(first)).toBe(false);
    expect(tracker.finish(true)).toEqual({ reverted: false });
    expect(tracker.finish(true)).toEqual({ reverted: false });
    expect(tracker.isIdle()).toBe(true);
    // Ett misslyckat ensamt sparande återställer utkastet.
    tracker.sync(second);
    tracker.begin(ids, current => withColorRow(current, 9, { hidden: true }), copyOf);
    expect(tracker.finish(false)).toEqual({ reverted: true });
  });
});

describe("layoutmallen på utskriftssidan (steg 64)", () => {
  it("lägger om rutnätet och rubrikerna när papper, rader eller kolumner ändras", () => {
    const four = BUILT_IN_SHEET_LAYOUTS.find(template => template.id === "a4-four")!;
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

  it("rogaining: poängbanan (ogafflad grupp) ger löparkartor utan problem", () => {
    const document = testDocument();
    const score = { ...document, courses: document.courses.map(course => ({ ...course, kind: "SCORE" as const, labelKind: "CODE" as const })) };
    const result = runnerPrintItems(score, { ...bundles(3), missingVariant: [] }, clock);
    expect(result.problems).toEqual([]);
    expect(result.items.map(item => [item.course, item.variant, item.runner?.kind])).toEqual([["k", undefined, "RUNNER"], ["k", undefined, "VACANT"],
      ["k", undefined, "RESERVE"]]);
    const strip = BUILT_IN_SHEET_LAYOUTS.find(template => template.id === "a4-strip")!;
    expect(sheetLayoutSheets(score, strip, [result.items[0]!])[0]!.texts.map(text => text.text)).toContain("Anna Andersson  D21  10:32  nr 101");
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
    const strip = BUILT_IN_SHEET_LAYOUTS.find(template => template.id === "a4-strip")!;
    const [single] = sheetLayoutSheets(document, strip, [items[0]!]);
    expect(single!.boxes).toHaveLength(1);
    expect(single!.texts.map(text => text.text)).toContain("Anna Andersson  D21  10:32  nr 101");
    const one = BUILT_IN_SHEET_LAYOUTS.find(template => template.id === "a4-one")!;
    const duplex = sheetLayoutSheets(document, one, [items[1]!], { duplexBacks: true });
    expect(duplex).toHaveLength(2);
    expect(duplex[1]!.back).toBe(true);
    // ADR-0213: baksidan är papperets element (förvalet som Kartor till startens baksida).
    expect((duplex[1]!.paperItems ?? []).map(item => item.parts.flatMap(part => part.kind === "text" ? [part.text] : []).join(""))).toEqual(["102", "Ledig", "D21  10:30"]);
  });
});

/** ADR-0217: klassens layout styr löparkartorna (skala och papper) via Kartor till startens grupper. */
describe("löparkartor per layout", () => {
  const clock = (instant: string | null) => instant ? instant.slice(11, 16) : "";
  it("en grupp i en annan layout ger kartor i den layouten med layoutens skala; tryckantalet per layout", () => {
    const document = applyEdit(testDocument(), { type: "ADD_LAYOUT", layout: { id: "aldre", name: "Äldre A4", scale: 7500,
      page: { width: 827, height: 1169, margins: 28, landscape: false } } }).document;
    const base = bundles(3).groups[0]!;
    const layered = { missingVariant: [], groups: [base, { ...base, layout: { id: "aldre", name: "Äldre A4" }, printCount: 3 }] } as unknown as Bundles;
    const result = runnerPrintItems(document, layered, clock);
    expect(result.items.map(item => item.layout ?? "")).toEqual(["", "", "", "aldre", "aldre", "aldre"]);
    expect(result.counts).toEqual([{ courseName: "Lång", variantCode: null, count: 3 }, { courseName: "Lång", variantCode: null, count: 3, layout: "Äldre A4" }]);
    expect(result.problems).toEqual([]);
    const one = BUILT_IN_SHEET_LAYOUTS.find(template => template.id === "a4-one")!;
    const groups = printSheetGroups(document, { kind: "TEMPLATE", template: one, perRunner: true }, result.items);
    expect(groups.map(group => group.sheets[0]!.frames[0]!.printScale)).toEqual([document.event.mapScale, document.event.mapScale, document.event.mapScale, 7500, 7500, 7500]);
  });
});

