import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { CONTROL_DISTANCE_LIMITS, checkDocument, courseVariants, readPpen, symbolsForBox, writePpen } from "../src";
import { testFilesDir } from "./helpers";
import { Builder, lineCourse } from "./build";

const kinds = (checks: readonly { kind: string }[]) => checks.map(check => check.kind).sort();

describe("checkDocument", () => {
  it("har IOF:s gränser som konstanter", () => {
    expect(CONTROL_DISTANCE_LIMITS).toEqual({ forest: { minMeters: 30, similarMeters: 60 }, sprint: { minMeters: 15, similarMeters: 30 } });
  });

  it("en bra bana ger inga anmärkningar", () => {
    expect(checkDocument(lineCourse(3).b.document)).toEqual([]);
  });

  it("för nära kontroller: under 30 m alltid, under 60 m för granskning", () => {
    const b = new Builder({ mapScale: 10000 });
    const a = b.control("NORMAL", 0, 0);
    const near = b.control("NORMAL", 2.5, 0); // 25 m
    const similar = b.control("NORMAL", 0, 4.5); // 45 m från a
    const checks = checkDocument(b.document).filter(check => check.kind === "CONTROLS_TOO_CLOSE");
    expect(checks).toContainEqual({ kind: "CONTROLS_TOO_CLOSE", controls: [a, near], meters: 25, limitMeters: 30 });
    expect(checks).toContainEqual({ kind: "CONTROLS_TOO_CLOSE", controls: [a, similar], meters: 45, limitMeters: 60, feature: "UNKNOWN" });
    expect(checkDocument(b.document, { minMeters: 20, similarMeters: 40 }).filter(check => check.kind === "CONTROLS_TOO_CLOSE"))
      .toEqual([{ kind: "CONTROLS_TOO_CLOSE", controls: [a, near], meters: 25, limitMeters: 40, feature: "UNKNOWN" }]);
  });

  it("sprint har 15/30 m", () => {
    const b = new Builder({ mapScale: 4000, sprint: true });
    const a = b.control("NORMAL", 0, 0);
    const near = b.control("NORMAL", 3, 0); // 12 m
    const similar = b.control("NORMAL", 0, 6); // 24 m
    const checks = checkDocument(b.document).filter(check => check.kind === "CONTROLS_TOO_CLOSE");
    expect(checks).toContainEqual(expect.objectContaining({ controls: [a, near], limitMeters: 15 }));
    expect(checks).toContainEqual(expect.objectContaining({ controls: [a, similar], limitMeters: 30 }));
  });

  it("samma kod, omvändbar kod, saknad kod och oanvända kontroller", () => {
    const b = new Builder();
    const a = b.control("NORMAL", 0, 0, "66");
    // Samma kod och saknad kod går inte att göra med ändringarna; de kan komma från en fil.
    const xml = writePpen(b.document)
      .replace("</course-scribe-event>", `  <control id="7" kind="normal"><code>66</code><location x="100" y="0" /></control>
  <control id="8" kind="normal"><code></code><location x="200" y="0" /></control>
</course-scribe-event>`);
    const document = readPpen(xml).document;
    const checks = checkDocument(document);
    expect(checks).toContainEqual({ kind: "DUPLICATE_CODE", code: "66", controls: [a, "7"] });
    expect(checks).toContainEqual({ kind: "INVERTIBLE_CODE", code: "66", control: a });
    expect(checks).toContainEqual({ kind: "MISSING_CODE", control: "8" });
    expect(kinds(checks).filter(kind => kind === "UNUSED_CONTROL")).toHaveLength(3);
  });

  it("samma kontroll två gånger i rad och bana utan mål", () => {
    const { b, course, controls, finish } = lineCourse(2);
    b.insert(course, controls[1]!, b.cc(course, controls[1]!));
    b.edit({ type: "REMOVE_COURSE_CONTROL", course, courseControl: b.cc(course, finish) });
    const checks = checkDocument(b.document);
    expect(checks).toContainEqual({ kind: "SAME_CONTROL_TWICE_IN_ROW", course, control: controls[1] });
    expect(checks).toContainEqual({ kind: "COURSE_WITHOUT_START_OR_FINISH", course });
    expect(checks).toContainEqual({ kind: "UNUSED_CONTROL", control: finish });
  });

  it("sträcka genom en annan kontrolls ring", () => {
    const { b, course, controls } = lineCourse(3);
    // 31 (0,0) → 32 (20,0) → 33 (40,0); en brytpunkt får sträckan 31→32 att gå genom 33:s ring.
    b.edit({ type: "SET_LEG_BENDS", from: controls[0]!, to: controls[1]!, bends: [{ x: 40, y: 1 }] });
    expect(checkDocument(b.document)).toContainEqual({ kind: "LEG_THROUGH_CONTROL", course, from: controls[0], to: controls[1], control: controls[2] });
  });

  it("mellan 30 och 60 m: kolumn D avgör (olika objekt går bra, samma eller okänt granskas)", () => {
    const b = new Builder({ mapScale: 10000 });
    const a = b.control("NORMAL", 0, 0);
    const c = b.control("NORMAL", 4.5, 0); // 45 m
    const [first, second] = symbolsForBox("D", "2018").map(symbol => symbol.id);
    const tooClose = () => checkDocument(b.document).filter(check => check.kind === "CONTROLS_TOO_CLOSE");
    b.edit({ type: "SET_DESCRIPTION", control: a, boxes: [{ box: "D", ref: first! }] });
    expect(tooClose()).toEqual([{ kind: "CONTROLS_TOO_CLOSE", controls: [a, c], meters: 45, limitMeters: 60, feature: "UNKNOWN" }]);
    b.edit({ type: "SET_DESCRIPTION", control: c, boxes: [{ box: "D", ref: second! }] });
    expect(tooClose()).toEqual([]);
    b.edit({ type: "SET_DESCRIPTION", control: c, boxes: [{ box: "D", ref: first! }] });
    expect(tooClose()).toEqual([{ kind: "CONTROLS_TOO_CLOSE", controls: [a, c], meters: 45, limitMeters: 60, feature: "SAME" }]);
  });

  it("gafflad bana: en sträcka varnas bara för ringar i samma variant (andra grenar syns inte på löparens karta)", () => {
    let read = 0;
    for (const name of ["variations.ppen", "relay/gaffle.ppen", "relay/harper.ppen", "selectiondescriber/mapexchange1.ppen"]) {
      let xml: string;
      try { xml = readFileSync(join(testFilesDir, name), "utf8"); read++; } catch { continue; }
      const document = readPpen(xml).document;
      for (const check of checkDocument(document)) {
        if (check.kind !== "LEG_THROUGH_CONTROL") continue;
        const ok = courseVariants(document, check.course).some(variant => {
          const ids = variant.courseControls.map(id => document.courseControls[id]!.control);
          const leg = ids.some((id, index) => index > 0 && ids[index - 1] === check.from && id === check.to);
          return leg && ids.includes(check.control);
        });
        expect(ok, `${name}: ${check.from}-${check.to} genom ${check.control}`).toBe(true);
      }
    }
    expect(read).toBe(4);
  });
});
