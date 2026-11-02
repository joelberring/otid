import { describe, expect, it } from "vitest";
import { applyEdit } from "@o-tid/course-setting";
import { applySteps, createEditor, undo, type EditorState } from "./course-setting-editor";
import { HISTORY_LIMIT, historyToKeep, restoreHistory, usableHistory } from "./course-setting-history";
import { memoryFieldStore } from "./course-setting-offline";
import { forgetAllCourseSettingCopies, forgetCourseSettingCopy } from "./course-setting-offline-forget";
import { testDocument } from "./course-setting-test-document";

const ME = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
const now = new Date("2026-11-02T20:00:00Z");

/** Två egna steg: flytta 31 och sätt stigningen. Sparat på servern (loggen tom), som efter en lyckad sparning. */
function session(): EditorState {
  let state = createEditor(testDocument());
  state = applySteps(state, [{ type: "MOVE_CONTROL", control: "a", at: { x: 12, y: 1 } }], applyEdit);
  state = applySteps(state, [{ type: "UPDATE_COURSE", course: "k", changes: { climbMeters: 60 } }], applyEdit);
  return { ...state, log: [] };
}

describe("ADR-0190: ångra efter omladdning", () => {
  it("historiken sparas och läggs tillbaka för samma konto; ångra gör samma sak som innan omladdningen", async () => {
    const store = memoryFieldStore();
    const before = session();
    await store.writeHistory(historyToKeep("race", ME, before, now)!);
    // Omladdning: editorn öppnas med serverns dokument (samma som editorns) och utan historik.
    const reopened = createEditor(before.document);
    const stored = usableHistory(await store.readHistory("race"), "race", ME)!;
    const { state, dropped } = restoreHistory(reopened, stored);
    expect(dropped).toBe(0);
    expect(state.past).toHaveLength(2);
    expect(state.nextSeq).toBeGreaterThan(Math.max(...before.past.flatMap(step => step.entries.map(entry => entry.seq))));
    const once = undo(state);
    expect(once.document.courses[0]!.climbMeters).toBeUndefined();
    expect(once.log.at(-1)!.edit.type).toBe("PUT_OBJECTS");
    expect(undo(once).document.controls.a!.at).toEqual({ x: 10, y: 0 });
    // Ett annat konto i samma webbläsare får ingen historik.
    expect(usableHistory(await store.readHistory("race"), "race", OTHER)).toBeUndefined();
    expect(usableHistory(await store.readHistory("race"), "annan", ME)).toBeUndefined();
  });

  it("steg som någon annan har ändrat sedan dess läggs inte tillbaka; de andra gör det", () => {
    const before = session();
    const stored = historyToKeep("race", ME, before, now)!;
    // Någon annan flyttade 31 medan sidan var stängd.
    const server = applyEdit(before.document, { type: "MOVE_CONTROL", control: "a", at: { x: 30, y: 30 } }).document;
    const { state, dropped } = restoreHistory(createEditor(server), stored);
    expect(dropped).toBe(1);
    expect(state.past).toHaveLength(1);
    const undone = undo(state);
    expect(undone.document.courses[0]!.climbMeters).toBeUndefined();
    // Den andras flytt står kvar.
    expect(undone.document.controls.a!.at).toEqual({ x: 30, y: 30 });
  });

  it("högst 200 steg; gjort om finns bara om inget ändrats sedan sidan öppnades; förslagsläget sparar inget", () => {
    let state = createEditor(testDocument());
    for (let i = 0; i < HISTORY_LIMIT + 20; i++) {
      state = applySteps(state, [{ type: "MOVE_CONTROL", control: "a", at: { x: 10 + i / 10, y: 0 } }], applyEdit);
    }
    const kept = historyToKeep("race", ME, undo(state), now)!;
    expect(kept.past.length + kept.future.length).toBeLessThanOrEqual(2 * HISTORY_LIMIT);
    expect(kept.past).toHaveLength(HISTORY_LIMIT - 1);
    expect(kept.future).toHaveLength(1);
    const reopened = createEditor(undo(state).document);
    expect(restoreHistory(reopened, kept).state.future).toHaveLength(1);
    const edited = applySteps(reopened, [{ type: "UPDATE_COURSE", course: "k", changes: { name: "Ny" } }], applyEdit);
    expect(restoreHistory(edited, kept).state.future).toHaveLength(0);
    expect(historyToKeep("race", ME, { ...state, suggesting: { base: state.document, baseVersion: 1 } }, now)).toBeUndefined();
    expect(historyToKeep("race", ME, createEditor(testDocument()), now)).toBeUndefined();
  });

  it("tas bort med tävlingens kopia och vid utloggning", async () => {
    const store = memoryFieldStore();
    await store.writeHistory(historyToKeep("race", ME, session(), now)!);
    await store.writeHistory({ ...historyToKeep("race", ME, session(), now)!, raceId: "annan" });
    await forgetCourseSettingCopy("race", store);
    expect(await store.readHistory("race")).toBeUndefined();
    expect(await store.readHistory("annan")).toBeDefined();
    await forgetAllCourseSettingCopies(store).catch(() => undefined);
    expect(await store.readHistory("annan")).toBeUndefined();
  });
});
