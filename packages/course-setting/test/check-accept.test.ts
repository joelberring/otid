import { describe, expect, it } from "vitest";
import {
  acceptChecksEdit, applyEdit, checkAcceptable, checkDocument, checkKey, checkLevel, editTouches, isAccepted, keepAcceptedChecks, objectPatch,
  unacceptChecksEdit, type CourseCheck, type CourseSettingDocument
} from "../src";
import { lineCourse } from "./build";

/** Kontrollerna 0, 20, 40 mm i rad (1:10 000, 1 mm = 10 m); ett förbjudet område tvärs över sträckan 20–40. */
function forbiddenCourse() {
  const { b, course, controls } = lineCourse(3);
  const area = b.edit({ type: "ADD_SPECIAL", special: { kind: "out-of-bounds", points: [{ x: 25, y: -5 }, { x: 35, y: -5 }, { x: 30, y: 5 }] } });
  return { b, course, controls, area };
}

const forbidden = (checks: readonly CourseCheck[]) => checks.filter(check => check.kind === "LEG_THROUGH_FORBIDDEN" || check.kind === "CONTROL_IN_FORBIDDEN");

describe("förbjudna områden med och utan vägval (ADR-0199)", () => {
  it("fågelvägen genom området är en notis när vägvalet inte är räknat", () => {
    const { b, course, controls, area } = forbiddenCourse();
    const checks = forbidden(checkDocument(b.document));
    expect(checks).toEqual([{ kind: "LEG_THROUGH_FORBIDDEN", course, from: controls[1], to: controls[2], special: area, route: "UNKNOWN", specials: [area] }]);
    expect(checkLevel(checks[0]!)).toBe("NOTICE");
  });

  it("ingen varning när vägvalet går runt, fel när ingen laglig väg finns", () => {
    const { b, course, controls, area } = forbiddenCourse();
    const asked: string[] = [];
    const around = checkDocument(b.document, { legRoute: (c, from, to) => { asked.push(`${c}:${from}-${to}`); return { reachable: true }; } });
    expect(forbidden(around)).toEqual([]);
    expect(asked).toEqual([`${course}:${controls[1]}-${controls[2]}`]);
    const boxed = forbidden(checkDocument(b.document, { legRoute: () => ({ reachable: false }) }));
    expect(boxed).toEqual([{ kind: "LEG_THROUGH_FORBIDDEN", course, from: controls[1], to: controls[2], special: area, route: "NO_ROUTE", specials: [area] }]);
    expect(checkLevel(boxed[0]!)).toBe("ERROR");
    expect(checkAcceptable(boxed[0]!)).toBe(true);
  });

  it("en kontroll i området är ett fel och sträckorna dit räknas inte en gång till", () => {
    const { b, course, controls } = lineCourse(3);
    const area = b.edit({ type: "ADD_SPECIAL", special: { kind: "out-of-bounds", points: [{ x: 15, y: -5 }, { x: 25, y: -5 }, { x: 25, y: 5 }, { x: 15, y: 5 }] } });
    const checks = forbidden(checkDocument(b.document, { legRoute: () => undefined }));
    expect(checks).toEqual([{ kind: "CONTROL_IN_FORBIDDEN", course, control: controls[1], special: area }]);
    expect(checkLevel(checks[0]!)).toBe("ERROR");
  });

  it("samma sträcka på två banor har samma nyckel", () => {
    const { b, controls } = forbiddenCourse();
    const other = b.course("B");
    for (const control of controls) b.insert(other, control);
    const checks = forbidden(checkDocument(b.document));
    expect(checks).toHaveLength(2);
    expect(new Set(checks.map(checkKey)).size).toBe(1);
    expect(checkKey(checks[0]!)).toBe(`LEG_THROUGH_FORBIDDEN/${controls[1]}/${controls[2]}`);
  });

  it("en sträcka genom två spärrar är en notis, inte två", () => {
    const { b, controls, area } = forbiddenCourse();
    const line = b.edit({ type: "ADD_SPECIAL", special: { kind: "boundary", points: [{ x: 26, y: -10 }, { x: 26, y: 10 }] } });
    const checks = forbidden(checkDocument(b.document));
    expect(checks).toHaveLength(1);
    expect(checks[0]).toMatchObject({ from: controls[1], to: controls[2] });
    expect(checks[0]!.kind === "LEG_THROUGH_FORBIDDEN" ? [...(checks[0]!.specials ?? [])].sort() : []).toEqual([area, line].sort());
  });
});

describe("godtagna varningar (ADR-0199)", () => {
  function closeControls() {
    const { b, course, controls } = lineCourse(2);
    // 25 m från kontroll 1 (1:10 000): under riktvärdet 30 m.
    const near = b.control("NORMAL", 22.5, 0);
    b.insert(course, near);
    const check = checkDocument(b.document).find(row => row.kind === "CONTROLS_TOO_CLOSE")!;
    return { b, course, controls, near, check };
  }

  it("godta, flytta lite, flytta långt, ersätt och ångra", () => {
    const { b, near, check } = closeControls();
    expect(checkLevel(check)).toBe("WARNING");
    const before = b.document;
    b.edit(acceptChecksEdit(b.document, [check])!);
    expect(isAccepted(b.document, check)).toBe(true);
    expect(isAccepted(before, check)).toBe(false);
    // En liten flytt (10 m) gäller fortfarande.
    b.edit({ type: "MOVE_CONTROL", control: near, at: { x: 22.5, y: 1 } });
    const moved = checkDocument(b.document).find(row => row.kind === "CONTROLS_TOO_CLOSE")!;
    expect(checkKey(moved)).toBe(checkKey(check));
    expect(isAccepted(b.document, moved)).toBe(true);
    // Långt (över 25 m från där den godtogs) men fortfarande för nära någon: den visas igen.
    b.edit({ type: "MOVE_CONTROL", control: near, at: { x: 22.5, y: -2 } });
    b.edit({ type: "MOVE_CONTROL", control: near, at: { x: 20, y: -2.6 } });
    const far = checkDocument(b.document).find(row => row.kind === "CONTROLS_TOO_CLOSE" && row.controls.includes(near))!;
    expect(isAccepted(b.document, far)).toBe(false);
    // Ångra godtagandet.
    b.edit(unacceptChecksEdit([checkKey(check)])!);
    expect(b.document.event.acceptedChecks).toBeUndefined();
  });

  it("ångra (objectPatch) tar bort godtagandet och touches är per varning", () => {
    const { b, check } = closeControls();
    const before = b.document;
    const edit = acceptChecksEdit(b.document, [check])!;
    expect(editTouches(edit)).toEqual([`event:acceptedChecks:${checkKey(check)}`]);
    b.edit(edit);
    const undo = objectPatch(b.document, before)!;
    expect(isAccepted(applyEdit(b.document, undo).document, check)).toBe(false);
  });

  it("fel som stoppar tidtagningen går inte att godta", () => {
    const { b, controls } = lineCourse(2);
    // Som i en inläst .ppen: två kontroller med samma kod (editorn tillåter det inte).
    const second = b.document.controls[controls[1]!]!;
    b.document = { ...b.document, controls: { ...b.document.controls, [second.id]: { ...second, code: b.code(controls[0]!) } } };
    const duplicate = checkDocument(b.document).find(row => row.kind === "DUPLICATE_CODE")!;
    expect(checkLevel(duplicate)).toBe("ERROR");
    expect(checkAcceptable(duplicate)).toBe(false);
    expect(acceptChecksEdit(b.document, [duplicate])).toBeUndefined();
  });

  it("nyckeln och lägena kontrolleras", () => {
    const { b } = lineCourse(1);
    expect(() => applyEdit(b.document, { type: "SET_ACCEPTED_CHECKS", checks: { "fel nyckel": { at: {} } } })).toThrow();
    expect(() => applyEdit(b.document, { type: "SET_ACCEPTED_CHECKS", checks: { "UNUSED_CONTROL/1": { at: { "c:1": { x: Number.NaN, y: 0 } } } } })).toThrow();
  });

  it("en ny .ppen behåller de godtagna vars kontroller och objekt finns kvar", () => {
    const { b, check, near } = closeControls();
    b.edit(acceptChecksEdit(b.document, [check])!);
    const unused = b.control("NORMAL", 100, 100);
    const unusedCheck = checkDocument(b.document).find(row => row.kind === "UNUSED_CONTROL")!;
    b.edit(acceptChecksEdit(b.document, [unusedCheck])!);
    const accepted = b.document.event.acceptedChecks;
    expect(Object.keys(accepted!)).toHaveLength(2);
    // Den nya filen saknar den oanvända kontrollen.
    const reread: CourseSettingDocument = applyEdit(b.document, { type: "DELETE_CONTROL", control: unused }).document;
    const kept = keepAcceptedChecks(accepted, { ...reread, event: { ...reread.event, acceptedChecks: undefined } });
    expect(Object.keys(kept!)).toEqual([checkKey(check)]);
    expect(isAccepted({ ...reread, event: { ...reread.event, acceptedChecks: kept } }, check)).toBe(true);
    expect(near).toBeTruthy();
  });
});
