import { describe, expect, it } from "vitest";
import {
  applyEdit, BUILT_IN_TEMPLATES, defaultRunnerBack, expandPaperText, layoutCoursePage, layoutTemplateSheets, paperTemplateFromCourse, printSheetGroups,
  runnerBackSheet, RUNNER_BACK, validateRunnerBack, type PaperItem, type RunnerInfo, type Sheet
} from "../src";
import { lineCourse } from "./build";

/**
 * ADR-0213: löparens variabler på papperet (också stafett), platshållarna i förhandsvisningen av banor, baksidan som eget
 * ark i samma PDF (fram, bak, fram, bak …) och att löparna aldrig hamnar i dokumentet eller mallen.
 */
const anna: RunnerInfo = { kind: "RUNNER", name: "Anna Andersson", club: "OK Ravinen", className: "D21", startTime: "18:32", startNumber: 112, entryId: "e1" };
const leg2: RunnerInfo = { kind: "RUNNER", name: "Bo Berg", club: "IFK Lidingö", className: "H21", startTime: null, startNumber: 31, entryId: "e2",
  team: { number: 12, name: "IFK Lidingö 1" }, leg: 2 };
const front: PaperItem = { id: "t1", kind: "TEXT", at: { corner: "TOP_LEFT", x: 2, y: 3 }, text: "Lag {lagnummer} · Sträcka {sträcka} · {variant}", sizeMm: 4, widthMm: 80 };
const texts = (sheet: Sheet) => (sheet.paperItems ?? []).map(item => item.parts.flatMap(part => part.kind === "text" ? [part.text] : []).join("\n"));

describe("löparens variabler och baksidan (ADR-0213)", () => {
  it("fyller i löparens variabler, också lag, lagnummer och sträcka", () => {
    const { b, course } = lineCourse(3);
    const frame = (runner: RunnerInfo) => ({ course, variant: "ABD", printScale: 10000, runner });
    expect(expandPaperText("{namn} {startnummer} {klubb} {klass} {starttid} {variant}", b.document, frame(anna))).toBe("Anna Andersson 112 OK Ravinen D21 18:32 ABD");
    expect(expandPaperText("Lag {lagnummer} · Sträcka {sträcka} · {variant}", b.document, frame(leg2))).toBe("Lag 12 · Sträcka 2 · ABD");
    expect(expandPaperText("{lag}", b.document, frame(leg2))).toBe("IFK Lidingö 1");
    // En reserv: namnet "Reserv", inget nummer.
    expect(expandPaperText("{namn} {startnummer}", b.document, frame({ kind: "RESERVE", name: null, className: null, startTime: null, startNumber: null }))).toBe("Reserv");
  });

  it("utan löpare: platshållare i förhandsvisningen av banor, tomt annars; {klass} och {variant} är banans", () => {
    const { b, course } = lineCourse(3);
    const plain = { course, printScale: 10000 };
    expect(expandPaperText("{namn} {startnummer} {lag}", b.document, { ...plain, runnerPlaceholders: true })).toBe("{namn} {startnummer} {lag}");
    expect(expandPaperText("Nr {startnummer} {namn}", b.document, plain)).toBe("Nr");
    const document = applyEdit(b.document, { type: "SET_PAPER_LAYOUT", course, layout: { items: [{ ...front, text: "{namn} {startnummer}" }] } }).document;
    const preview = layoutCoursePage(document, { course, runnerPlaceholders: true })[0]!;
    expect(preview.paperItems?.[0]?.parts.find(part => part.kind === "text")).toMatchObject({ text: "{namn} {startnummer}" });
    // PDF:en av banor (utan platshållare): texten blir tom och står inte.
    expect(layoutCoursePage(document, { course })[0]!.paperItems ?? []).toHaveLength(0);
  });

  it("dubbelsidigt: framsida och baksida i följd för varje löpare, baksidan med löparens uppgifter och samma papper", () => {
    const { b, course } = lineCourse(3);
    const document = applyEdit(b.document, { type: "SET_PAPER_LAYOUT", course, layout: { items: [{ ...front, text: "Lag {lagnummer} · Sträcka {sträcka}" }] } }).document;
    const runners = [anna, leg2, { ...anna, name: "Cecilia Carlsson", startNumber: 113, entryId: "e3" }];
    const template = BUILT_IN_TEMPLATES.find(item => item.id === "a4-one")!;
    const groups = printSheetGroups(document, { kind: "TEMPLATE", template, perRunner: true, duplex: true }, runners.map(runner => ({ course, runner })));
    const sheets = groups.flatMap(group => group.sheets);
    expect(sheets.map(sheet => sheet.back === true)).toEqual([false, true, false, true, false, true]);
    expect(groups.map(group => group.sheets.length)).toEqual([2, 2, 2]);
    expect(texts(sheets[2]!)).toEqual(["Lag 12 · Sträcka 2"]);
    expect(texts(sheets[1]!)).toEqual(["112", "Anna Andersson", "OK Ravinen", "D21  18:32"]);
    expect(texts(sheets[3]!)).toContain("Lag 12 · Sträcka 2");
    expect(texts(sheets[5]!)).toContain("Cecilia Carlsson");
    for (const index of [1, 3, 5]) expect(sheets[index]!.paper).toEqual(sheets[index - 1]!.paper);
  });

  it("en egen baksida ersätter förvalet; elementen står i arket och mallen har bara variablerna", () => {
    const { b, course } = lineCourse(3);
    const back = { items: [{ ...front, id: "x1", text: "{namn} · {klass}" }] };
    const document = applyEdit(b.document, { type: "SET_RUNNER_BACK", back }).document;
    expect(document.event.runnerBack?.items[0]).toMatchObject({ relativeTo: "PAGE", text: "{namn} · {klass}" });
    const sheet = runnerBackSheet(document, { widthMm: 210, heightMm: 297, landscape: false, marginMm: 7 }, { course, printScale: 10000, runner: anna });
    expect(texts(sheet)).toEqual(["Anna Andersson · D21"]);
    expect(sheet.paperItems![0]!.course).toBe(RUNNER_BACK);
    expect(applyEdit(document, { type: "SET_RUNNER_BACK", back: null }).document.event.runnerBack).toBeUndefined();
    expect(() => validateRunnerBack({ items: [front, front] })).toThrow(/samma id/);
    // Integriteten: dokumentet och mallen har aldrig löparens namn, bara variablerna.
    const withFront = applyEdit(document, { type: "SET_PAPER_LAYOUT", course, layout: { items: [{ ...front, text: "{namn}" }] } }).document;
    layoutTemplateSheets(withFront, BUILT_IN_TEMPLATES.find(item => item.id === "a4-one")!, [{ course, runner: anna }], { duplexBacks: true });
    expect(JSON.stringify(withFront)).not.toContain("Anna");
    expect(JSON.stringify(paperTemplateFromCourse(withFront, course, "t", "Mall"))).not.toContain("Anna");
    expect(defaultRunnerBack(true).items.map(item => item.kind === "TEXT" ? item.text : "")).toContain("Lag {lagnummer} · Sträcka {sträcka}");
  });
});
