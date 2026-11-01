import { describe, expect, it, vi } from "vitest";
import type { CourseSettingNote } from "@o-tid/contracts";
import { applyEdit, createdIdsBetween, type CourseSettingEdit } from "@o-tid/course-setting";
import { ALL_CONTROLS } from "./course-setting-hit";
import {
  filterNotes, hitNoteMark, noteInView, noteMarkGeometry, noteMarks, notePosition, noteTargetAt, scaledSize
} from "./course-setting-note-marks";
import { handleStreamEvent } from "./course-setting-stream-client";
import { describeEdit, previewSuggestion, suggestionOverlay } from "./course-setting-suggestion";
import { testDocument } from "./course-setting-test-document";

/** Steg 66: notisernas lägen och träff-test, förslagens skillnader och text, och strömmens besked. */
const actor = { accountId: "10000000-0000-4000-8000-000000000001", displayName: "Anna" };
function note(id: string, target: CourseSettingNote["target"], status: "OPEN" | "DONE" = "OPEN", course: string | null = null): CourseSettingNote {
  return { id, target, at: { x: 99, y: 99 }, course, text: "x", status, createdAt: "2026-11-01T10:00:00.000Z", createdBy: actor,
    resolvedAt: null, resolvedBy: null, photo: null, replies: [] };
}

describe("notiserna på kartan", () => {
  const document = testDocument();
  it("står vid punkten, kontrollen (där den är nu), sträckans mitt eller det sparade läget", () => {
    expect(notePosition(note("1", { kind: "POINT", at: { x: 1, y: 2 } }), document)).toEqual({ x: 1, y: 2 });
    expect(notePosition(note("2", { kind: "CONTROL", control: "a" }), document)).toEqual({ x: 10, y: 0 });
    expect(notePosition(note("3", { kind: "CONTROL", control: "borta" }), document)).toEqual({ x: 99, y: 99 });
    expect(notePosition(note("4", { kind: "LEG", from: "a", to: "b" }), document)).toEqual({ x: 15, y: 5 });
    const bent = applyEdit(document, { type: "SET_LEG_BENDS", from: "s", to: "a", bends: [{ x: 5, y: 5 }] }).document;
    expect(notePosition(note("5", { kind: "LEG", from: "s", to: "a" }), bent)).toEqual({ x: 5, y: 5 });
  });

  it("filtrerar öppna och klara, visar bara banans notiser i en bana och slår ihop markeringar på samma ställe", () => {
    const notes = [note("1", { kind: "CONTROL", control: "a" }), note("2", { kind: "CONTROL", control: "a" }, "DONE"),
      note("3", { kind: "COURSE", course: "k" }), note("4", { kind: "POINT", at: { x: 5, y: 5 } }, "OPEN", "annan")];
    expect(filterNotes(notes, "OPEN").map(row => row.id)).toEqual(["1", "3", "4"]);
    expect(filterNotes(notes, "DONE").map(row => row.id)).toEqual(["2"]);
    const inCourse = new Set(["s", "a", "b", "f"]);
    expect(notes.filter(row => noteInView(row, "k", inCourse)).map(row => row.id)).toEqual(["1", "2", "3"]);
    expect(notes.filter(row => noteInView(row, ALL_CONTROLS, inCourse))).toHaveLength(4);
    const marks = noteMarks(notes.slice(0, 2), document);
    expect(marks).toEqual([{ id: "1", at: { x: 10, y: 0 }, status: "OPEN", count: 2 }]);
  });

  it("träffar markeringen (en ruta upp till höger om punkten) med fingrets tolerans, och ett klick fäster en ny notis", () => {
    const geometry = noteMarkGeometry(4);
    expect(geometry.sizePx).toBe(14);
    const marks = noteMarks([note("1", { kind: "POINT", at: { x: 10, y: 10 } })], document);
    const center = { x: 10 + geometry.offsetMm.x, y: 10 + geometry.offsetMm.y };
    expect(hitNoteMark(marks, center, 0.5, geometry)?.id).toBe("1");
    expect(hitNoteMark(marks, { x: 10, y: 10 }, 0.1, geometry)).toBeUndefined();
    expect(noteTargetAt({ kind: "control", control: "a", courseControl: "c2" }, { x: 0, y: 0 })).toEqual({ kind: "CONTROL", control: "a" });
    expect(noteTargetAt({ kind: "leg", from: "a", to: "b" }, { x: 0, y: 0 })).toEqual({ kind: "LEG", from: "a", to: "b" });
    expect(noteTargetAt(undefined, { x: 1.234, y: 5.678 })).toEqual({ kind: "POINT", at: { x: 1.23, y: 5.68 } });
  });

  it("förminskar fotot med proportionerna kvar", () => {
    expect(scaledSize(4000, 3000)).toEqual({ width: 1600, height: 1200 });
    expect(scaledSize(800, 600)).toEqual({ width: 800, height: 600 });
    expect(scaledSize(3000, 4000, 900)).toEqual({ width: 675, height: 900 });
  });
});

describe("förslagen", () => {
  it("spelas upp på den aktuella versionen och ritas som flyttade, nya och borttagna kontroller", () => {
    const base = testDocument();
    const edits: CourseSettingEdit[] = [{ type: "MOVE_CONTROL", control: "a", at: { x: 12, y: 3 } },
      { type: "ADD_CONTROL", kind: "NORMAL", at: { x: 40, y: 40 }, code: "50" }, { type: "DELETE_CONTROL", control: "b" }];
    let document = base;
    const created = edits.map(edit => { const next = applyEdit(document, edit).document; const ids = createdIdsBetween(document, next); document = next; return ids; });
    const preview = previewSuggestion(base, { edits: edits as never, created: created.map(row => ({ ...row, controls: [...row.controls],
      courseControls: [...row.courseControls], courses: [...row.courses] })) });
    expect(preview.rejected).toEqual([]);
    const overlay = suggestionOverlay(base, preview.document);
    expect(overlay.moved).toEqual([{ control: "a", from: { x: 10, y: 0 }, to: { x: 12, y: 3 } }]);
    expect(overlay.added.map(row => row.at)).toEqual([{ x: 40, y: 40 }]);
    expect(overlay.removed).toEqual([{ control: "b", at: { x: 20, y: 10 } }]);
    // Utan den andra åtgärden (inte godkänd) finns ingen ny kontroll.
    expect(suggestionOverlay(base, previewSuggestion(base, { edits: edits as never, created: created as never }, new Set([1])).document).added).toEqual([]);
    expect(describeEdit(edits[0]!, base)).toBe("Flytta kontroll 31 36 m");
    expect(describeEdit(edits[2]!, base)).toBe("Ta bort kontroll 32");
    expect(describeEdit({ type: "INSERT_COURSE_CONTROL", course: "k", control: "a" }, base)).toBe("Lägg in kontroll 31 på Lång");
  });
});

describe("banläggningens ström", () => {
  it("lämnar besked om ny version, notiser och närvaro och avvisar trasiga", () => {
    const handlers = { version: vi.fn(), notes: vi.fn(), suggestions: vi.fn(), mode: vi.fn(), presence: vi.fn(), reconnected: vi.fn() };
    expect(handleStreamEvent("version", JSON.stringify({ version: 7, by: actor.accountId }), handlers)).toBe(true);
    expect(handlers.version).toHaveBeenCalledWith(7, actor.accountId);
    expect(handleStreamEvent("notes", JSON.stringify({ by: "x" }), handlers)).toBe(true);
    expect(handlers.notes).toHaveBeenCalledWith("x");
    expect(handleStreamEvent("presence", JSON.stringify([{ ...actor, level: "EDIT" }]), handlers)).toBe(true);
    expect(handlers.presence).toHaveBeenCalledWith([{ ...actor, level: "EDIT" }]);
    expect(handleStreamEvent("version", "{inte json", handlers)).toBe(false);
    expect(handleStreamEvent("version", JSON.stringify({ version: -1, by: "x" }), handlers)).toBe(false);
    expect(handleStreamEvent("okänd", "{}", handlers)).toBe(false);
  });
});
