import { describe, expect, it } from "vitest";
import {
  applyEdit, CourseSettingEditError, defaultScorePoints, emptyDocument, scorePoints, courseSummaries, expandText, layoutCoursePage, createdIdsBetween, documentChanges, editTouches, layoutDescription, objectPatch, readPpen,
  replayEdits, touchedConflict, writePpen, type CourseSettingDocument, type CourseSettingEdit
} from "../src";
import { lineCourse } from "./build";

const names = (document: CourseSettingDocument) => [...document.courses].sort((a, b) => a.order - b.order).map(course => course.name);
const apply = (document: CourseSettingDocument, edit: CourseSettingEdit) => applyEdit(document, edit).document;

/** Tre banor A, B, C och poängbanan P med två kontroller. */
function fourCourses() {
  const { b, course, controls } = lineCourse(3);
  const second = b.course("B");
  b.insert(second, controls[0]!);
  b.course("C");
  const score = b.edit({ type: "ADD_COURSE", name: "P", kind: "SCORE" });
  b.insert(score, controls[1]!);
  b.insert(score, controls[2]!);
  return { b, course, second, score, controls };
}

describe("ADR-0190: banans egenskaper", () => {
  it("stigning och fast längd sätts och tas bort med null, och följer med till .ppen och tillbaka", () => {
    const { b, course } = lineCourse(2);
    let document = apply(b.document, { type: "UPDATE_COURSE", course, changes: { climbMeters: 85, lengthOverrideMeters: 4300 } });
    expect(courseSummaries(document)[0]).toMatchObject({ lengthMeters: 4300, climbMeters: 85 });
    const back = readPpen(writePpen(document)).document;
    expect(back.courses[0]).toMatchObject({ climbMeters: 85, lengthOverrideMeters: 4300 });
    // Beskrivningens huvud visar längden och stigningen (avrundat som Purple Pen).
    const header = layoutDescription(document, { course, kind: "SYMBOLS", language: "sv" });
    expect(JSON.stringify(header)).toContain('"4,3 km"');
    expect(JSON.stringify(header)).toContain('"85 m"');
    // Text på kartan med Purple Pens makron (t.ex. under banans namn).
    expect(expandText({ document, course, printScale: 10000 } as never, "$(CourseLength) km, $(CourseClimb) m")).toBe("4,3 km, 85 m");
    // Utskriftens rubrik (förhandsvisningen och PDF:en).
    expect(layoutCoursePage(document, { course, header: true })[0]!.texts[0]!.text).toContain("4,3 km, 85 m");
    document = apply(document, { type: "UPDATE_COURSE", course, changes: { climbMeters: null, lengthOverrideMeters: null } });
    expect(document.courses[0]!.climbMeters).toBeUndefined();
    expect(document.courses[0]!.lengthOverrideMeters).toBeUndefined();
    expect(writePpen(document)).not.toMatch(/climb="85"|course-length/);
    expect(() => apply(document, { type: "UPDATE_COURSE", course, changes: { climbMeters: -5 } })).toThrow(CourseSettingEditError);
    expect(() => apply(document, { type: "UPDATE_COURSE", course, changes: { lengthOverrideMeters: 0 } })).toThrow(CourseSettingEditError);
  });

  it("banslaget: poängbana utan gafflingar, etiketten följer med, poängen står kvar och skrivs till .ppen", () => {
    const { b, course, controls } = lineCourse(3);
    let document = apply(b.document, { type: "UPDATE_COURSE", course, changes: { kind: "SCORE" } });
    expect(document.courses[0]).toMatchObject({ kind: "SCORE", labelKind: "CODE" });
    const cc = Object.values(document.courseControls).find(item => item.control === controls[1])!.id;
    document = apply(document, { type: "SET_POINTS", course, courseControl: cc, points: 30 });
    expect(document.courseControls[cc]!.points).toBe(30);
    expect(writePpen(document)).toMatch(/kind="score"/);
    expect(readPpen(writePpen(document)).document.courseControls[cc]!.points).toBe(30);
    document = apply(document, { type: "UPDATE_COURSE", course, changes: { labelKind: "CODE_AND_SCORE" } });
    document = apply(document, { type: "UPDATE_COURSE", course, changes: { kind: "NORMAL" } });
    expect(document.courses[0]).toMatchObject({ kind: "NORMAL", labelKind: "CODE" });
    expect(document.courseControls[cc]!.points).toBe(30);
    // Poäng bara på poängbanor och vanliga kontroller.
    expect(() => apply(document, { type: "SET_POINTS", course, courseControl: cc, points: 10 })).toThrow(/poängbanor/);
    // En gafflad bana kan inte bli poängbana.
    const forked = apply(document, { type: "ADD_SPLIT", course, at: cc, kind: "LOOP", branches: 1 });
    expect(() => apply(forked, { type: "UPDATE_COURSE", course, changes: { kind: "SCORE" } })).toThrow(/gafflingar/);
  });

  it("poäng 0 eller null tar bort poängen; start och mål har ingen poäng", () => {
    const { b, score, controls } = fourCourses();
    const cc = Object.values(b.document.courseControls).filter(item => item.control === controls[1]).at(-1)!.id;
    let document = apply(b.document, { type: "SET_POINTS", course: score, courseControl: cc, points: 20 });
    document = apply(document, { type: "SET_POINTS", course: score, courseControl: cc, points: 0 });
    expect(document.courseControls[cc]!.points).toBeUndefined();
    const startCc = Object.values(document.courseControls).find(item => document.controls[item.control]!.kind === "START")!.id;
    expect(() => apply(document, { type: "SET_POINTS", course: score, courseControl: startCc, points: 5 })).toThrow(CourseSettingEditError);
    expect(() => apply(document, { type: "SET_POINTS", course: score, courseControl: cc, points: 1.5 })).toThrow(CourseSettingEditError);
  });

  it("ordningen: flytta upp och ned numrerar om 1, 2, 3 … och syns i .ppen", () => {
    const { b, score } = fourCourses();
    expect(names(b.document)).toEqual(["A", "B", "C", "P"]);
    let document = apply(b.document, { type: "UPDATE_COURSE", course: score, changes: { order: 1 } });
    expect(names(document)).toEqual(["P", "A", "B", "C"]);
    expect([...document.courses].map(course => course.order).sort()).toEqual([1, 2, 3, 4]);
    document = apply(document, { type: "UPDATE_COURSE", course: score, changes: { order: 99 } });
    expect(names(document)).toEqual(["A", "B", "C", "P"]);
    document = apply(document, { type: "UPDATE_COURSE", course: score, changes: { order: 3 } });
    expect(names(readPpen(writePpen(document)).document)).toEqual(["A", "B", "P", "C"]);
  });

  it("ångra en flytt sätter bara tillbaka ordningen (courseOrder), inte hela banorna", () => {
    const { b, score, second } = fourCourses();
    const moved = apply(b.document, { type: "UPDATE_COURSE", course: score, changes: { order: 1 } });
    const undo = objectPatch(moved, b.document)!;
    expect(undo.courses).toBeUndefined();
    expect(Object.keys(undo.courseOrder ?? {}).length).toBe(4);
    // Någon annan byter namn på B under tiden: ångra flyttar tillbaka utan att ta bort namnet.
    const renamed = apply(moved, { type: "UPDATE_COURSE", course: second, changes: { name: "Bana B" } });
    const back = apply(renamed, undo);
    expect(names(back)).toEqual(["A", "Bana B", "C", "P"]);
    // Ångra av ett namnbyte flyttar inte tillbaka en bana som någon annan flyttat.
    const rename = apply(b.document, { type: "UPDATE_COURSE", course: second, changes: { name: "B2" } });
    const undoRename = objectPatch(rename, b.document)!;
    expect(undoRename.courseOrder).toBeUndefined();
    const otherMoved = apply(rename, { type: "UPDATE_COURSE", course: second, changes: { order: 4 } });
    expect(names(apply(otherMoved, undoRename))).toEqual(["A", "C", "P", "B"]);
  });

  it("samarbete: touches per fält, och samma bana flyttad eller ändrad av två krockar", () => {
    const { b, course, score } = fourCourses();
    expect(editTouches({ type: "UPDATE_COURSE", course, changes: { climbMeters: 10, kind: "SCORE" } })).toEqual([`course:${course}:climbMeters`, `course:${course}:kind`]);
    expect(editTouches({ type: "SET_POINTS", course: score, courseControl: "9", points: 3 })).toEqual(["courseControl:9:points"]);
    const base = b.document;
    // Någon annan satte stigningen; min ändring av stigningen krockar, min fasta längd gör det inte.
    const current = apply(base, { type: "UPDATE_COURSE", course, changes: { climbMeters: 40 } });
    const mine: CourseSettingEdit[] = [
      { type: "UPDATE_COURSE", course, changes: { climbMeters: 55 } },
      { type: "UPDATE_COURSE", course, changes: { lengthOverrideMeters: 3000 } }
    ];
    const result = replayEdits(current, mine, { conflict: documentChanges(base, current) });
    expect(result.rejected.map(row => [row.index, row.code])).toEqual([[0, "CONFLICT"]]);
    expect(result.document.courses.find(row => row.id === course)).toMatchObject({ climbMeters: 40, lengthOverrideMeters: 3000 });
    // Servern: touches ur loggen.
    const server = replayEdits(current, [{ type: "UPDATE_COURSE", course: score, changes: { order: 1 } }],
      { conflict: touchedConflict([`course:${score}:order`]) });
    expect(server.rejected[0]?.code).toBe("CONFLICT");
    // Poängen per kontroll: två som sätter samma kontrolls poäng krockar.
    const cc = Object.values(base.courseControls).filter(item => base.controls[item.control]!.kind === "NORMAL").at(-1)!.id;
    const points = apply(base, { type: "SET_POINTS", course: score, courseControl: cc, points: 10 });
    const replay = replayEdits(points, [{ type: "SET_POINTS", course: score, courseControl: cc, points: 20 }], { conflict: documentChanges(base, points) });
    expect(replay.rejected[0]?.code).toBe("CONFLICT");
    // En bana som skapats av någon annan efter min version: id översätts och ordningen gäller dokumentets bana.
    const local = apply(base, { type: "ADD_COURSE", name: "Ny" });
    const created = createdIdsBetween(base, local).courses[0]!;
    const remote = apply(base, { type: "ADD_COURSE", name: "Annan" });
    const replayed = replayEdits(remote, [{ type: "ADD_COURSE", name: "Ny" }, { type: "UPDATE_COURSE", course: created, changes: { order: 1 } }],
      { created: [createdIdsBetween(base, local), { controls: [], courseControls: [], courses: [] }], conflict: documentChanges(base, remote) });
    expect(replayed.rejected).toEqual([]);
    expect(names(replayed.document)[0]).toBe("Ny");
  });
});

describe("poängbanans förval (som tävlingens rogaining)", () => {
  it("kodens tiotal, som mest 1000; samma tal som domänens defaultRogainingPoints", () => {
    // Samma fall som packages/domain/test/rogaining.test.ts.
    expect(["31", "39", "45", "100", "102", "109", "110", "255", "99999"].map(defaultScorePoints)).toEqual([3, 3, 4, 10, 10, 10, 11, 25, 1_000]);
    expect([undefined, "", "S1", "3a"].map(defaultScorePoints)).toEqual([0, 0, 0, 0]);
  });

  it("banläggarens poäng gäller, annars förvalet", () => {
    let document = emptyDocument({ title: "Poäng", mapScale: 10000 });
    const step = (edit: Parameters<typeof applyEdit>[1]) => { const result = applyEdit(document, edit); document = result.document; return result.created!; };
    const c47 = step({ type: "ADD_CONTROL", kind: "NORMAL", at: { x: 1, y: 1 }, code: "47" });
    const c52 = step({ type: "ADD_CONTROL", kind: "NORMAL", at: { x: 2, y: 2 }, code: "52" });
    const course = step({ type: "ADD_COURSE", name: "Rogaining", kind: "SCORE" });
    const a = step({ type: "INSERT_COURSE_CONTROL", course, control: c47 });
    const b = step({ type: "INSERT_COURSE_CONTROL", course, control: c52 });
    step({ type: "SET_POINTS", course, courseControl: b, points: 9 });
    expect([scorePoints(document, a), scorePoints(document, b)]).toEqual([4, 9]);
  });
});
