import { describe, expect, it } from "vitest";
import {
  applyEdit, BUILT_IN_SHEET_LAYOUTS, defaultRunnerBack, expandPaperText, layoutCoursePage, sheetLayoutSheets, paperTemplateFromCourse, printSheetGroups,
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
    const template = BUILT_IN_SHEET_LAYOUTS.find(item => item.id === "a4-one")!;
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
    sheetLayoutSheets(withFront, BUILT_IN_SHEET_LAYOUTS.find(item => item.id === "a4-one")!, [{ course, runner: anna }], { duplexBacks: true });
    expect(JSON.stringify(withFront)).not.toContain("Anna");
    expect(JSON.stringify(paperTemplateFromCourse(withFront, course, "t", "Mall"))).not.toContain("Anna");
    expect(defaultRunnerBack(true).items.map(item => item.kind === "TEXT" ? item.text : "")).toContain("Lag {lagnummer} · Sträcka {sträcka}");
  });

  it("baksidans förhandsvisning visar {variant} som platshållare, utskriften med löpare fyller i eller utelämnar den", () => {
    const { b, course } = lineCourse(3);
    const paper = { widthMm: 210, heightMm: 297, landscape: false, marginMm: 7 };
    expect(texts(runnerBackSheet(b.document, paper, { course, printScale: 10000 }, { runnerPlaceholders: true }))[0]).toBe("{variant}");
    expect(texts(runnerBackSheet(b.document, paper, { course, variant: "ACEG", printScale: 10000, runner: anna }))[0]).toBe("ACEG");
    expect(texts(runnerBackSheet(b.document, paper, { course, printScale: 10000, runner: anna }))).not.toContain("{variant}");
  });

  it("dubbelsidig baksida per klass: {klass}/{variant}/{bana}/{längd}/{tävling}/{datum}/logga/QR fylls i, löparvariabler blir tomma, klassens layout och papper bevaras", () => {
    const { b, course, controls } = lineCourse(3);
    const at = b.cc(course, controls[0]!);
    b.edit({ type: "ADD_SPLIT", course, at, kind: "FORK", branches: 2 });
    const [branchA, branchB] = b.document.courseControls[at]!.split!.branches;
    b.insert(course, b.control("NORMAL", 10, 15), branchA);
    b.insert(course, b.control("NORMAL", 10, -15), branchB);
    // Huvudlayout: banan på liggande A4; egen layout "aldre": stående A4 i 1:7 500.
    const landscapeMain = { ...b.document, courses: b.document.courses.map(row => row.id === course
      ? { ...row, printArea: { automatic: true, restrictToPageSize: true, page: { width: 827, height: 1169, margins: 28, landscape: true } } } : row) };
    const logoHash = "a".repeat(64);
    const customBack = { items: [
      { id: "c1", kind: "TEXT" as const, at: { corner: "TOP_RIGHT" as const, x: 10, y: 10 }, relativeTo: "PAGE" as const, text: "{tävling} · {datum}", sizeMm: 6, widthMm: 120 },
      { id: "c2", kind: "TEXT" as const, at: { corner: "TOP_RIGHT" as const, x: 10, y: 20 }, relativeTo: "PAGE" as const, text: "{klass} · {variant} · {bana} · {längd} · {skala}", sizeMm: 5, widthMm: 140 },
      { id: "c3", kind: "TEXT" as const, at: { corner: "TOP_RIGHT" as const, x: 10, y: 32 }, relativeTo: "PAGE" as const, text: "{namn}", sizeMm: 6, widthMm: 100 },
      { id: "c4", kind: "TEXT" as const, at: { corner: "TOP_RIGHT" as const, x: 10, y: 40 }, relativeTo: "PAGE" as const, text: "{klubb} {startnummer} {starttid}", sizeMm: 5, widthMm: 100 },
      { id: "c5", kind: "IMAGE" as const, at: { corner: "BOTTOM_RIGHT" as const, x: 10, y: 10 }, relativeTo: "PAGE" as const, image: logoHash, mediaType: "image/png" as const, widthMm: 20, aspect: 1 },
      { id: "c6", kind: "QR_CODE" as const, at: { corner: "BOTTOM_LEFT" as const, x: 10, y: 10 }, relativeTo: "PAGE" as const, target: "RACE" as const, sizeMm: 18 }
    ] };
    let document = applyEdit(landscapeMain, { type: "ADD_LAYOUT", layout: { id: "aldre", name: "Äldre A4", scale: 7500,
      page: { width: 827, height: 1169, margins: 28, landscape: false } } }).document;
    document = applyEdit(document, { type: "SET_PAPER_LAYOUT", course, layout: { items: [
      { ...front, id: "f1", text: "{klass}" },
      { ...front, id: "f2", at: { corner: "TOP_LEFT", x: 2, y: 12 }, text: "{namn} {startnummer}" }
    ] } }).document;
    document = applyEdit(document, { type: "SET_RUNNER_BACK", back: customBack }).document;

    const a4One = BUILT_IN_SHEET_LAYOUTS.find(item => item.id === "a4-one")!;
    const items = [
      { course, variant: "A", className: "H21" },
      { course, variant: "B", layout: "aldre", className: "H70" }
    ];
    const links = { site: "https://otid.example", race: "https://otid.example/r/demo" };
    // Även om runnerPlaceholders råkar skickas in får baksidan aldrig löparplatshållare.
    const groups = printSheetGroups(document, { kind: "TEMPLATE", template: a4One, perRunner: true, duplex: true, ownPage: true }, items,
      { date: "2026-12-09", raceTitle: "Vårtävlingen", paperLinks: links, runnerPlaceholders: false });
    const sheets = groups.flatMap(group => group.sheets);
    expect(groups.map(group => group.sheets.length)).toEqual([2, 2]);
    expect(sheets.map(sheet => sheet.back === true)).toEqual([false, true, false, true]);

    // H21 (huvudlayout, liggande A4): framsida och baksida är båda liggande och har riktiga klass-/banvärden.
    expect(sheets[0]!.paper.landscape).toBe(true);
    expect(sheets[0]!.paper.widthMm).toBeGreaterThan(sheets[0]!.paper.heightMm);
    expect(sheets[1]!.paper).toEqual(sheets[0]!.paper);
    expect(texts(sheets[0]!)).toEqual(["H21"]);
    const textItems = (sheet: Sheet) => (sheet.paperItems ?? []).filter(item => item.kind === "TEXT")
      .map(item => item.parts.flatMap(part => part.kind === "text" ? [part.text] : []).join("\n"));
    const back1Texts = textItems(sheets[1]!);
    expect(back1Texts[0]).toBe("Vårtävlingen · 2026-12-09");
    expect(back1Texts[1]).toMatch(/^H21 · A · A · \d+,\d km · 1:10 000$/);
    // Inga tomma löparrader, inga platshållare ({namn}, Anna Lind m.m.).
    expect(back1Texts).toHaveLength(2);
    expect(JSON.stringify(sheets[1]!)).not.toMatch(/\{namn\}|\{klubb\}|\{startnummer\}|\{starttid\}|Anna Lind/);
    expect((sheets[1]!.paperItems ?? []).map(item => item.kind)).toEqual(["TEXT", "TEXT", "IMAGE", "QR_CODE"]);

    // H70 (egen layout "aldre", stående A4 i 1:7 500): papper, riktning och skala bevaras på fram- och baksida.
    expect(sheets[2]!.paper.landscape).toBe(false);
    expect(sheets[2]!.paper.heightMm).toBeGreaterThan(sheets[2]!.paper.widthMm);
    expect(sheets[3]!.paper).toEqual(sheets[2]!.paper);
    expect(sheets[2]!.frames[0]!.printScale).toBe(7500);
    const back2Texts = textItems(sheets[3]!);
    expect(back2Texts[0]).toBe("Vårtävlingen · 2026-12-09");
    expect(back2Texts[1]).toMatch(/^H70 · B · A · \d+,\d km · 1:7 500$/);
    expect(back2Texts).toHaveLength(2);

    // Även om runnerPlaceholders: true skickas in får baksidan aldrig löparplatshållare.
    const withFlag = printSheetGroups(document, { kind: "TEMPLATE", template: a4One, perRunner: true, duplex: true, ownPage: true }, [items[0]!],
      { date: "2026-12-09", raceTitle: "Vårtävlingen", paperLinks: links, runnerPlaceholders: true }).flatMap(group => group.sheets);
    expect(textItems(withFlag[1]!)).toHaveLength(2);
    expect(JSON.stringify(withFlag[1]!)).not.toMatch(/\{namn\}|\{klubb\}|\{startnummer\}|\{starttid\}/);

    // Enkelsidig klassutskrift (COURSE-läge): {klass} fylls också i på framsidan.
    const single = printSheetGroups(document, { kind: "COURSE" }, [{ course, className: "D21" }], { runnerPlaceholders: false });
    expect(texts(single[0]!.sheets[0]!)).toEqual(["D21"]);
  });
});
