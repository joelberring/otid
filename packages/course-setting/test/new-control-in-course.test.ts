import { describe, expect, it } from "vitest";
import {
  applyEdit, CourseSettingEditError, courseControlOrder, courseSummaries, createdIdsBetween, editTouches, objectPatch, readPpen, replayEdits,
  writePpen, type CourseSettingDocument
} from "../src";
import { Builder } from "./build";

const codes = (document: CourseSettingDocument, course: string) =>
  courseControlOrder(document, course).map(id => document.controls[document.courseControls[id]!.control]!.code ?? document.controls[document.courseControls[id]!.control]!.kind);

/** Två banor A och B som båda har 31 (mitt i), 1:10 000 (1 mm = 10 m). */
function shared() {
  const b = new Builder();
  const start = b.control("START", 0, 0);
  const finish = b.control("FINISH", 100, 0);
  const c31 = b.control("NORMAL", 50, 0, "31");
  const c32 = b.control("NORMAL", 20, 0, "32");
  const a = b.course("A");
  const bb = b.course("B");
  b.insert(a, c32); b.insert(a, c31);
  b.insert(bb, c31);
  return { b, start, finish, c31, c32, a, bb };
}

describe("ny kontroll bara i en bana (frågan när en delad kontroll flyttas långt)", () => {
  it("A får en ny kontroll med nästa lediga kod; B har kvar 31 på det gamla läget", () => {
    const { b, c31, a, bb } = shared();
    const cc = courseControlOrder(b.document, a).find(id => b.document.courseControls[id]!.control === c31)!;
    const before = b.document;
    const result = applyEdit(before, { type: "NEW_CONTROL_IN_COURSE", course: a, control: c31, at: { x: 50, y: 10 }, courseControls: [cc], code: "33" });
    const created = result.created!;
    expect(result.document.controls[created]).toMatchObject({ kind: "NORMAL", code: "33", at: { x: 50, y: 10 }, descriptions: [] });
    expect(codes(result.document, a)).toEqual(["START", "32", "33", "FINISH"]);
    expect(codes(result.document, bb)).toEqual(["START", "31", "FINISH"]);
    expect(result.document.controls[c31]!.at).toEqual({ x: 50, y: 0 });
    // Längden räknas om för A men inte för B.
    const length = (document: CourseSettingDocument, course: string) => courseSummaries(document).find(row => row.course === course)!.lengthMeters;
    expect(length(result.document, a)).toBeGreaterThan(length(before, a));
    expect(length(result.document, bb)).toBe(length(before, bb));
    // Ett steg: ångra med objectPatch ger tillbaka dokumentet.
    const undo = objectPatch(result.document, before)!;
    expect(applyEdit(result.document, undo).document.controls[created]).toBeUndefined();
    expect(codes(applyEdit(result.document, undo).document, a)).toEqual(["START", "32", "31", "FINISH"]);
    expect(createdIdsBetween(before, result.document).controls).toEqual([created]);
  });

  it("en upptagen kod (någon annan hann före) ger nästa lediga, och numrets läge blir förvalt", () => {
    const { b, c31, a } = shared();
    const cc = courseControlOrder(b.document, a).find(id => b.document.courseControls[id]!.control === c31)!;
    b.edit({ type: "MOVE_NUMBER", course: a, courseControl: cc, at: { x: 55, y: 5 } });
    b.control("NORMAL", 80, 80, "33");
    const result = applyEdit(b.document, { type: "NEW_CONTROL_IN_COURSE", course: a, control: c31, at: { x: 50, y: 10 }, courseControls: [cc], code: "33" });
    const code = result.document.controls[result.created!]!.code;
    expect(code).not.toBe("33");
    expect(code).not.toBe("31");
    expect(result.document.courseControls[cc]!.numberAt).toBeUndefined();
  });

  it("fjäril: kontrollen flera gånger på banan byts där den anges, andra förekomster står kvar", () => {
    const b = new Builder();
    b.control("START", 0, 0); b.control("FINISH", 100, 0);
    const center = b.control("NORMAL", 50, 0, "31");
    const spoke1 = b.control("NORMAL", 50, 30, "32");
    const spoke2 = b.control("NORMAL", 50, -30, "34");
    const a = b.course("A"), other = b.course("B");
    b.insert(a, center); b.insert(a, spoke1); b.insert(a, center); b.insert(a, spoke2); b.insert(a, center);
    b.insert(other, center);
    const all = courseControlOrder(b.document, a).filter(id => b.document.courseControls[id]!.control === center);
    expect(all).toHaveLength(3);
    const every = applyEdit(b.document, { type: "NEW_CONTROL_IN_COURSE", course: a, control: center, at: { x: 60, y: 0 }, courseControls: all });
    const code = every.document.controls[every.created!]!.code!;
    expect(codes(every.document, a)).toEqual(["START", code, "32", code, "34", code, "FINISH"]);
    expect(codes(every.document, other)).toEqual(["START", "31", "FINISH"]);
    const one = applyEdit(b.document, { type: "NEW_CONTROL_IN_COURSE", course: a, control: center, at: { x: 60, y: 0 }, courseControls: [all[1]!] });
    const oneCode = one.document.controls[one.created!]!.code!;
    expect(codes(one.document, a)).toEqual(["START", "31", "32", oneCode, "34", "31", "FINISH"]);
  });

  it("slinga: grenarnas kontroll byts i alla grenar och slingan står kvar", () => {
    const b = new Builder();
    b.control("START", 0, 0); b.control("FINISH", 100, 0);
    const center = b.control("NORMAL", 50, 0, "31");
    const a = b.course("A"), other = b.course("B");
    const at = b.insert(a, center);
    b.insert(other, center);
    b.edit({ type: "ADD_SPLIT", course: a, at, kind: "LOOP", branches: 2 });
    const branches = b.document.courseControls[at]!.split!.branches;
    const result = applyEdit(b.document, { type: "NEW_CONTROL_IN_COURSE", course: a, control: center, at: { x: 60, y: 0 }, courseControls: [...branches] });
    for (const id of branches) {
      expect(result.document.courseControls[id]!.control).toBe(result.created);
      expect(result.document.courseControls[id]!.split?.kind).toBe("LOOP");
    }
    expect(codes(result.document, other)).toEqual(["START", "31", "FINISH"]);
  });

  it("nekas för start, för en banas kontroll som inte är kontrollen och för en annan bana", () => {
    const { b, start, c31, c32, a, bb } = shared();
    const order = courseControlOrder(b.document, a);
    const cc31 = order.find(id => b.document.courseControls[id]!.control === c31)!;
    const cc32 = order.find(id => b.document.courseControls[id]!.control === c32)!;
    const startCc = order.find(id => b.document.courseControls[id]!.control === start)!;
    const at = { x: 1, y: 1 };
    expect(() => applyEdit(b.document, { type: "NEW_CONTROL_IN_COURSE", course: a, control: start, at, courseControls: [startCc] })).toThrow(CourseSettingEditError);
    expect(() => applyEdit(b.document, { type: "NEW_CONTROL_IN_COURSE", course: a, control: c31, at, courseControls: [cc32] })).toThrow(CourseSettingEditError);
    expect(() => applyEdit(b.document, { type: "NEW_CONTROL_IN_COURSE", course: bb, control: c31, at, courseControls: [cc31] })).toThrow(CourseSettingEditError);
    expect(() => applyEdit(b.document, { type: "NEW_CONTROL_IN_COURSE", course: a, control: c31, at, courseControls: [] })).toThrow(CourseSettingEditError);
  });

  it("spelas upp på en nyare version (samarbete) och följer med till .ppen", () => {
    const { b, c31, a, bb } = shared();
    const cc = courseControlOrder(b.document, a).find(id => b.document.courseControls[id]!.control === c31)!;
    const edit = { type: "NEW_CONTROL_IN_COURSE", course: a, control: c31, at: { x: 50, y: 10 }, courseControls: [cc], code: "33" } as const;
    expect(editTouches(edit)).toEqual([`courseControl:${cc}:control`]);
    // Någon annan lade till en kontroll (tog nästa id) under tiden.
    const remote = applyEdit(b.document, { type: "ADD_CONTROL", kind: "NORMAL", at: { x: 5, y: 5 }, code: "40" }).document;
    const authored = applyEdit(b.document, edit);
    const replay = replayEdits(remote, [edit], { created: [createdIdsBetween(b.document, authored.document)] });
    expect(replay.rejected).toEqual([]);
    expect(codes(replay.document, a)).toEqual(["START", "32", "33", "FINISH"]);
    const read = readPpen(writePpen(replay.document)).document;
    expect(codes(read, a)).toEqual(["START", "32", "33", "FINISH"]);
    expect(codes(read, bb)).toEqual(["START", "31", "FINISH"]);
    expect(Object.values(read.controls).find(control => control.code === "33")!.at).toEqual({ x: 50, y: 10 });
  });
});
