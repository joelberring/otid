/** ADR-0217 beslut 8: sparade lägen (spara, jämför, återställ, "Från Purple Pen") och samarbetet kring layouterna. */
import { describe, expect, it } from "vitest";
import {
  applyEdit, BUILT_IN_PRINT_PROFILES, compareLayoutState, documentChanges, MAIN_LAYOUT, objectPatch, replayEdits, withPpenState, type CourseSettingDocument, type CourseSettingEdit
} from "../src";
import { lineCourse } from "./build";

const apply = (document: CourseSettingDocument, ...edits: CourseSettingEdit[]) => edits.reduce((doc, edit) => applyEdit(doc, edit).document, document);
const A4 = { width: 827, height: 1169, margins: 28, landscape: false };

function setup() {
  const { b, course, controls } = lineCourse(3);
  const document = apply(b.document, { type: "ADD_LAYOUT", layout: { id: "aldre", name: "Äldre A4", scale: 7500, page: A4 } },
    { type: "SET_CLASS_LAYOUTS", classes: { H70: "aldre" } },
    { type: "PUT_PRINT_PROFILE", profile: { ...BUILT_IN_PRINT_PROFILES[0]!, id: "egen", name: "Egen" } },
    { type: "SET_EVENT", changes: { printProfileId: "egen" } });
  return { b, document, course, controls };
}

describe("sparade lägen", () => {
  it("spara, ändra, jämför och återställ (inte banorna); återställningen kan ångras", () => {
    const { b, document, course, controls } = setup();
    const saved = apply(document, { type: "SAVE_LAYOUT_STATE", id: "s1", name: "Före provtryck", savedAt: "2026-11-07T10:00:00Z" });
    expect(saved.event.layoutStates?.map(state => state.name)).toEqual(["Före provtryck"]);
    const state = saved.event.layoutStates![0]!;
    expect(compareLayoutState(saved, state)).toEqual([]);
    const cc = b.cc(course, controls[0]!);
    const changed = apply(saved,
      { type: "UPDATE_LAYOUT", layout: "aldre", changes: { scale: 5000 } },
      { type: "MOVE_NUMBER", course, courseControl: cc, at: { x: 1, y: 1 }, printLayout: "aldre" },
      { type: "SET_CLASS_LAYOUTS", classes: { H70: null, H75: "aldre" } },
      { type: "SET_PRINT_AREA", course, area: { automatic: false, restrictToPageSize: true, rect: { minX: 0, minY: 0, maxX: 50, maxY: 50 } } },
      { type: "SET_EVENT", changes: { printProfileId: "office" } },
      // Banan ändras också: den ingår inte i läget.
      { type: "UPDATE_COURSE", course, changes: { name: "Ny" } });
    const differences = compareLayoutState(changed, state);
    expect(differences).toEqual(expect.arrayContaining([
      { kind: "LAYOUT", layout: "aldre", name: "Äldre A4", change: "CHANGED" },
      { kind: "SHEET", layout: "aldre", course },
      { kind: "SHEET", layout: MAIN_LAYOUT, course },
      { kind: "CLASS", className: "H70", from: "aldre", to: MAIN_LAYOUT },
      { kind: "CLASS", className: "H75", from: MAIN_LAYOUT, to: "aldre" },
      { kind: "PROFILE" }
    ]));
    const restored = apply(changed, { type: "RESTORE_LAYOUT_STATE", id: "s1" });
    expect(compareLayoutState(restored, state)).toEqual([]);
    expect(restored.courses[0]!.name).toBe("Ny");
    expect(restored.event.printProfileId).toBe("egen");
    const undone = apply(restored, objectPatch(restored, changed)!);
    expect(compareLayoutState(undone, state)).toEqual(differences);
  });

  it("läget har färgprofilen: en ändrad profil kommer tillbaka", () => {
    const { document } = setup();
    const saved = apply(document, { type: "SAVE_LAYOUT_STATE", id: "s1", name: "Läge", savedAt: "2026-11-07T10:00:00Z" });
    const edited = apply(saved, { type: "PUT_PRINT_PROFILE", profile: { ...saved.event.printProfiles![0]!, name: "Ändrad" } });
    expect(compareLayoutState(edited, saved.event.layoutStates![0]!)).toEqual([{ kind: "PROFILE" }]);
    expect(apply(edited, { type: "RESTORE_LAYOUT_STATE", id: "s1" }).event.printProfiles![0]!.name).toBe("Egen");
  });

  it("\"Från Purple Pen\" ersätter det förra automatiska läget och står bredvid de egna", () => {
    const { document } = setup();
    const own = apply(document, { type: "SAVE_LAYOUT_STATE", id: "s1", name: "Eget", savedAt: "2026-11-07T10:00:00Z" });
    const first = withPpenState(own, "2026-11-07T11:00:00Z");
    const second = withPpenState(first, "2026-11-07T12:00:00Z");
    expect(second.event.layoutStates?.map(state => [state.name, state.savedAt])).toEqual([["Eget", "2026-11-07T10:00:00Z"], ["Från Purple Pen", "2026-11-07T12:00:00Z"]]);
    expect(apply(second, { type: "DELETE_LAYOUT_STATE", id: "ppen" }).event.layoutStates).toHaveLength(1);
  });
});

describe("samarbetet kring arken", () => {
  it("två som justerar olika nummer i samma ark krockar inte; samma nummer: den första vinner", () => {
    const { b, document, course, controls } = setup();
    const [first, second] = [b.cc(course, controls[0]!), b.cc(course, controls[1]!)];
    const theirs = apply(document, { type: "MOVE_NUMBER", course, courseControl: first, at: { x: 5, y: 5 }, printLayout: "aldre" });
    const mine: CourseSettingEdit[] = [{ type: "MOVE_NUMBER", course, courseControl: second, at: { x: 6, y: 6 }, printLayout: "aldre" }];
    const ok = replayEdits(theirs, mine, { conflict: documentChanges(document, theirs) });
    expect(ok.rejected).toEqual([]);
    expect(ok.document.event.layoutSheets!.aldre![course]!.numbers).toEqual({ [first]: { x: 5, y: 5 }, [second]: { x: 6, y: 6 } });
    const clash = replayEdits(theirs, [{ type: "MOVE_NUMBER", course, courseControl: first, at: { x: 7, y: 7 }, printLayout: "aldre" }],
      { conflict: documentChanges(document, theirs) });
    expect(clash.rejected.map(row => row.code)).toEqual(["CONFLICT"]);
    // Klasserna: olika klasser samtidigt går bra.
    const classes = apply(document, { type: "SET_CLASS_LAYOUTS", classes: { D70: "aldre" } });
    expect(replayEdits(classes, [{ type: "SET_CLASS_LAYOUTS", classes: { H75: "aldre" } }], { conflict: documentChanges(document, classes) }).rejected).toEqual([]);
  });
});
