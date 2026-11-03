import { describe, expect, it } from "vitest";
import { acceptChecksEdit, applyEdit, checkDocument, type CourseSettingDocument } from "@o-tid/course-setting";
import { checkGroups, checkRows, forbiddenRouteLegs, legForbiddenNotice, legRouteLookup } from "./course-setting-checks";
import type { LegLength } from "./course-setting-route-length";
import { testDocument } from "./course-setting-test-document";

/** Testdokumentet med banorna Kort och Mellan likadana som Lång, och ett förbjudet område tvärs över sträckan 31–32. */
function threeCourses(): CourseSettingDocument {
  const base = testDocument();
  const copy = (id: string, name: string, order: number) => ({ id, name, kind: "NORMAL" as const, order, first: `${id}1`, labelKind: "SEQUENCE" as const });
  const chain = (id: string) => Object.fromEntries(["s", "a", "b", "f"].map((control, index, all) => [`${id}${index + 1}`,
    { id: `${id}${index + 1}`, control, ...(index < all.length - 1 ? { next: `${id}${index + 2}` } : {}) }]));
  const document = { ...base, courses: [...base.courses, copy("m", "Mellan", 2), copy("n", "Kort", 3)],
    courseControls: { ...base.courseControls, ...chain("m"), ...chain("n") } };
  return applyEdit(document, { type: "ADD_SPECIAL", special: { kind: "out-of-bounds", points: [{ x: 13, y: 3 }, { x: 17, y: 3 }, { x: 15, y: 8 }] } }).document;
}

describe("fliken Varningar (ADR-0199)", () => {
  it("samma sträcka på tre banor blir en rad med banorna i ordning; notisen räknas inte", () => {
    const document = threeCourses();
    const rows = checkRows(document, checkDocument(document)).filter(row => row.group === "LEG_THROUGH_FORBIDDEN");
    expect(rows).toHaveLength(1);
    expect(rows[0]!.text).toBe("Lång, Mellan, Kort: fågelvägen kontroll 31–kontroll 32 korsar ett förbjudet område; vägvalet är inte räknat.");
    expect(rows[0]!.checks).toHaveLength(3);
    expect(rows[0]!).toMatchObject({ level: "NOTICE", course: "k", leg: { from: "a", to: "b" }, acceptable: true, accepted: false });
    expect(checkGroups(rows).count).toBe(0);
  });

  it("vägvalen avgör: runt = inget, ingen väg = fel som räknas; godta tar alla banor och räknas inte", () => {
    const document = threeCourses();
    const legs = forbiddenRouteLegs(document);
    // En nyckel för alla tre banorna (samma spärrar).
    expect(legs).toHaveLength(1);
    const around = new Map<string, LegLength>([[legs[0]!.key, { best: 260, straight: 141 }]]);
    expect(checkDocument(document, { legRoute: legRouteLookup(document, around) }).filter(check => check.kind === "LEG_THROUGH_FORBIDDEN")).toEqual([]);
    expect(legForbiddenNotice(document, "k", "a", "b", { key: legs[0]!.key, straightMeters: 141, best: { points: [], meters: 323, climbMeters: 0, seconds: 100 },
      alternatives: [], verdict: "NO_CHOICE", warnings: [], milliseconds: 1, corridor: undefined }))
      .toBe("Fågelvägen korsar ett förbjudet område – vägvalet går runt (+182 m).");

    const boxed = new Map<string, LegLength>([[legs[0]!.key, { best: undefined, straight: 141 }]]);
    const checks = checkDocument(document, { legRoute: legRouteLookup(document, boxed) });
    const rows = checkRows(document, checks);
    const groups = checkGroups(rows);
    expect(groups.groups[0]).toMatchObject({ id: "ERROR:LEG_NO_ROUTE", heading: "Går inte att nå lagligt" });
    expect(groups.groups[0]!.rows[0]!.text).toBe("Lång, Mellan, Kort: kontroll 31–kontroll 32 har ingen väg runt ett förbjudet område.");
    const before = groups.count;
    expect(before).toBeGreaterThan(0);

    const accepted = applyEdit(document, acceptChecksEdit(document, groups.groups[0]!.rows.flatMap(row => row.checks))!).document;
    const after = checkGroups(checkRows(accepted, checkDocument(accepted, { legRoute: legRouteLookup(accepted, boxed) })));
    expect(after.count).toBe(before - 1);
    expect(after.accepted.map(row => row.group)).toEqual(["LEG_NO_ROUTE"]);
  });

  it("fel först, sedan varningar och notiser; fel som stoppar går inte att godta", () => {
    const document = threeCourses();
    const withDuplicate = { ...document, controls: { ...document.controls, b: { ...document.controls.b!, code: "31" } },
      specialObjects: [] };
    const near = applyEdit(withDuplicate, { type: "ADD_CONTROL", kind: "NORMAL", at: { x: 12, y: 0 }, code: "40" }).document;
    const { groups } = checkGroups(checkRows(near, checkDocument(near)));
    expect(groups.map(group => group.id)).toEqual(["ERROR:DUPLICATE_CODE", "WARNING:CONTROLS_TOO_CLOSE", "NOTICE:UNUSED_CONTROL"]);
    expect(groups[0]!.rows[0]!.acceptable).toBe(false);
  });
});
