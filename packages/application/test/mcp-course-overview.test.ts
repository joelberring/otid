import { describe, expect, it } from "vitest";
import { applyEdit, emptyDocument, type CourseSettingDocument, type CourseSettingEdit } from "@o-tid/course-setting";
import { courseOverviewOf, MCP_COURSE_TOOLS } from "../src/mcp-course-setting";

/**
 * Steg G1 (ägaren 2026-11-21, A9): AI-kopplingens översikt av en gafflad bana. Förut gjordes sträckorna ur den platta listan
 * över alla grenar (SBN-banan fick «56→56, 0 m» och sträckor mellan grenarna).
 */
function forked(): { document: CourseSettingDocument; course: string } {
  let document = emptyDocument({ title: "Test", mapScale: 10000, sprint: false });
  const run = (edit: CourseSettingEdit) => { const result = applyEdit(document, edit); document = result.document; return result.created ?? ""; };
  const control = (code: string, x: number, y: number) => run({ type: "ADD_CONTROL", kind: "NORMAL", at: { x, y }, code });
  run({ type: "ADD_CONTROL", kind: "START", at: { x: 0, y: 0 } });
  run({ type: "ADD_CONTROL", kind: "FINISH", at: { x: 80, y: 0 } });
  const c31 = control("31", 20, 0), c32 = control("32", 60, 0), c41 = control("41", 40, 10), c42 = control("42", 40, -10);
  const course = run({ type: "ADD_COURSE", name: "SBN" });
  run({ type: "INSERT_COURSE_CONTROL", course, control: c31 });
  run({ type: "INSERT_COURSE_CONTROL", course, control: c32 });
  const at = Object.values(document.courseControls).find(item => item.control === c31)!.id;
  run({ type: "ADD_SPLIT", course, at, kind: "FORK", branches: 2 });
  const [a, b] = document.courseControls[at]!.split!.branches as [string, string];
  run({ type: "INSERT_COURSE_CONTROL", course, control: c41, after: a });
  run({ type: "INSERT_COURSE_CONTROL", course, control: c42, after: b });
  return { document, course };
}

describe("course_overview för en gafflad bana", () => {
  it("varje sträcka en gång ur banans länkar, inga sträckor mellan grenarna, och varianterna", () => {
    const { document, course } = forked();
    const [overview] = courseOverviewOf(document, course).courses;
    const legs = overview!.legs.map(leg => `${leg.from}→${leg.to}`);
    expect(legs.sort()).toEqual(["31→41", "31→42", "41→32", "42→32", "32→FINISH", "START→31"].sort());
    expect(overview!.legs.every(leg => leg.straightMeters > 0)).toBe(true);
    expect(overview!.controls.map(control => control.code ?? control.kind)).toEqual(["START", "31", "42", "41", "32", "FINISH"]);
    expect(overview!.variants?.map(variant => [variant.code, variant.controls.join(" ")])).toEqual([["A", "31 41 32"], ["B", "31 42 32"]]);
    expect(overview!.variants?.every(variant => variant.lengthMeters > 0)).toBe(true);
  });

  it("en ogafflad bana har inga varianter och sträckorna i ordning", () => {
    let document = emptyDocument({ title: "Test", mapScale: 10000, sprint: false });
    const run = (edit: CourseSettingEdit) => { const result = applyEdit(document, edit); document = result.document; return result.created ?? ""; };
    run({ type: "ADD_CONTROL", kind: "START", at: { x: 0, y: 0 } });
    run({ type: "ADD_CONTROL", kind: "FINISH", at: { x: 40, y: 0 } });
    const c31 = run({ type: "ADD_CONTROL", kind: "NORMAL", at: { x: 20, y: 0 }, code: "31" });
    const course = run({ type: "ADD_COURSE", name: "Kort" });
    run({ type: "INSERT_COURSE_CONTROL", course, control: c31 });
    const [overview] = courseOverviewOf(document, course).courses;
    expect(overview!.legs.map(leg => `${leg.from}→${leg.to}`)).toEqual(["START→31", "31→FINISH"]);
    expect(overview).not.toHaveProperty("variants");
  });

  it("verktygets beskrivning nämner varianterna", () => {
    expect(MCP_COURSE_TOOLS.find(tool => tool.name === "course_overview")!.description).toMatch(/varianterna för gafflade banor/);
  });
});
