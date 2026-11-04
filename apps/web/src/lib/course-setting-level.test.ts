import { describe, expect, it } from "vitest";
import {
  ALL_LEVEL_RULES, applyEdit, assessLevel, COURSE_LEVELS, emptyDocument, levelChecks, type ControlLevelFeatures, type CourseSettingDocument,
  type CourseSettingEdit
} from "@o-tid/course-setting";
import { LEVEL_REASONS, LEVEL_TIPS } from "../i18n/course-setting-level-sv";
import { levelGuideArticle } from "../i18n/help-course-setting-sv";
import { helpArticles } from "../i18n/help-sv";
import { checkGroups, checkRows } from "./course-setting-checks";
import { levelCheckText, levelRequest, levelRows, levelSignature, levelSprint } from "./course-setting-level";

/** Nivåstödet (ADR-0212) i editorn: texterna per regel, raderna, signaturen och notiserna i Varningar. */
function documentWith(edits: readonly CourseSettingEdit[]): { document: CourseSettingDocument; ids: string[] } {
  let document = emptyDocument({ title: "Test", mapScale: 10000, sprint: false });
  const ids: string[] = [];
  for (const edit of edits) { const result = applyEdit(document, edit); document = result.document; ids.push(result.created ?? ""); }
  return { document, ids };
}

const far = (control: string): ControlLevelFeatures => ({ control, strongMeters: 60, handrailMeters: 60, feature: { size: "BIG", source: "DESCRIPTION" },
  attackMeters: 10, relocationMeters: 10, candidates: { handrail: { x: 1, y: 1 } } });

describe("nivåstödets texter", () => {
  it("varje regel har ett tips, och varje nivåregel ett skäl", () => {
    for (const rule of ALL_LEVEL_RULES) {
      expect(LEVEL_TIPS[rule], rule).toMatch(/\S{3}/);
      if (!rule.startsWith("E_")) expect((LEVEL_REASONS as Record<string, (values: Record<string, number>) => string>)[rule]?.({ meters: 80, limit: 50 }), rule).toMatch(/\S{3}/);
    }
  });

  it("varje nivå har en guide i hjälpen (Blå och Svart en gemensam)", () => {
    const ids = new Set(helpArticles.map(article => article.id));
    for (const level of COURSE_LEVELS) expect(ids.has(levelGuideArticle(level)), level).toBe(true);
    expect(levelGuideArticle("BLA")).toBe(levelGuideArticle("SVART"));
    expect(ids.has(levelGuideArticle(undefined))).toBe(true);
  });
});

describe("nivåstödets rader och notiser", () => {
  const { document, ids } = documentWith([
    { type: "ADD_COURSE", name: "Ungdom" },
    { type: "ADD_CONTROL", kind: "START", at: { x: 0, y: 0 } },
    { type: "ADD_CONTROL", kind: "NORMAL", at: { x: 10, y: 0 }, code: "34" },
    { type: "ADD_CONTROL", kind: "FINISH", at: { x: 20, y: 0 } }
  ]);
  const [course, start, control, finish] = ids as [string, string, string, string];
  let doc = document;
  for (const id of [start, control, finish]) doc = applyEdit(doc, { type: "INSERT_COURSE_CONTROL", course, control: id }).document;
  doc = applyEdit(doc, { type: "UPDATE_COURSE", course, changes: { level: "VIT" } }).document;

  it("visar skälet och tipset mot målnivån: en stor sten 60 m från stigen är Gul, mer än Vit tillåter", () => {
    const rows = levelRows(doc, assessLevel([far(control)], []), "VIT");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ kind: "control", label: "Kontroll 34", rank: 2 });
    expect(rows[0]!.reason).toBe("ligger 60 m från närmaste stig eller annan ledstång – mer än Vit tillåter (50 m)");
    expect(rows[0]!.tip).toBe("Flytta kontrollen närmare stigen (inom ~20 m) eller välj ett större föremål");
    expect(rows[0]!.candidates.map(item => item.kind)).toEqual(["handrail"]);
  });

  it("signaturen ändras när en kontroll flyttas eller beskrivningen ändras", () => {
    const before = levelSignature(levelRequest(doc, course), "abc");
    const moved = applyEdit(doc, { type: "MOVE_CONTROL", control, at: { x: 12, y: 0 } }).document;
    expect(levelSignature(levelRequest(moved, course), "abc")).not.toBe(before);
    const described = applyEdit(doc, { type: "SET_DESCRIPTION", control, boxes: [{ box: "D", ref: "2.4" }] }).document;
    expect(levelSignature(levelRequest(described, course), "abc")).not.toBe(before);
    expect(levelSignature(levelRequest(doc, course), "annan karta")).not.toBe(before);
    expect(levelSignature(levelRequest(doc, course), "abc")).toBe(before);
  });

  it("ger notiser i Varningar bara med valet, och de går att godta", () => {
    const assessment = assessLevel([far(control)], []);
    expect(levelChecks(doc, course, assessment)).toEqual([]);
    const on = applyEdit(doc, { type: "SET_EVENT", changes: { levelNotices: true } }).document;
    const checks = levelChecks(on, course, assessment);
    const rows = checkRows(on, checks, check => levelCheckText(on, check, assessment));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ level: "NOTICE", acceptable: true, group: "LEVEL_DEVIATION", controls: [control] });
    expect(rows[0]!.text).toContain("Ungdom: Kontroll 34: ligger 60 m");
    expect(rows[0]!.text).toContain("Flytta kontrollen närmare stigen");
    // Notiser räknas inte i fliken.
    expect(checkGroups(rows).count).toBe(0);
  });
});

describe("nivåstödets sprintgräns", () => {
  it("ISSprOM-påtryck på en skogskarta bedöms; sprint bara med sprintskala", () => {
    const issprom = (mapScale: number) => ({ ...emptyDocument({ title: "Natt", mapScale, sprint: false }),
      event: { ...emptyDocument({ title: "Natt", mapScale, sprint: false }).event, overprintStandard: "ISSPROM2019" as const } });
    expect(levelSprint(issprom(10000))).toBe(false);
    expect(levelSprint(issprom(7500))).toBe(false);
    expect(levelSprint(issprom(4000))).toBe(true);
    expect(levelSprint(emptyDocument({ title: "Skog", mapScale: 4000, sprint: false }))).toBe(false);
  });
});
