import React from "react";
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { applyEdit, courseSummaries, emptyDocument, type CourseSettingDocument, type CourseSettingEdit } from "@o-tid/course-setting";
import { ControlList } from "./course-setting-controls";

// Komponenterna använder JSX utan att importera React (Next); testet ger dem React (vitest kompilerar klassiskt).
(globalThis as { React?: typeof React }).React = React;

function forked() {
  let document: CourseSettingDocument = emptyDocument({ title: "Gaffling", mapScale: 10000 });
  const edit = (change: CourseSettingEdit) => { const result = applyEdit(document, change); document = result.document; return result.created ?? ""; };
  const ids = [edit({ type: "ADD_CONTROL", kind: "START", at: { x: 0, y: 0 } }), edit({ type: "ADD_CONTROL", kind: "NORMAL", at: { x: 10, y: 0 }, code: "36" }),
    edit({ type: "ADD_CONTROL", kind: "NORMAL", at: { x: 20, y: 0 }, code: "57" }), edit({ type: "ADD_CONTROL", kind: "FINISH", at: { x: 30, y: 0 } })];
  const course = edit({ type: "ADD_COURSE", name: "A" });
  const ccs = ids.map(id => edit({ type: "INSERT_COURSE_CONTROL", course, control: id }));
  edit({ type: "ADD_SPLIT", course, at: ccs[1]!, kind: "FORK", branches: 2 });
  return { document, course };
}

describe("grenträdet (ägaren 2026-11-17)", () => {
  it("visar gren till, ta bort gren och flytta gafflingen när banan går att ändra, inget av det skrivskyddat", () => {
    const { document, course } = forked();
    const render = (readOnly: boolean) => renderToStaticMarkup(<ControlList document={document} summaries={courseSummaries(document)} view={course}
      variant={undefined} branch={undefined} selected={undefined} unused={[]} readOnly={readOnly} onSelect={() => undefined}
      onBranch={() => undefined} onVariant={() => undefined} onRemoveUnused={() => undefined} onEdits={() => undefined} />);
    const html = render(false);
    expect(html).toContain("+ gren");
    expect(html).toContain("Ta bort gren A");
    expect(html).toContain("Ta bort gren B");
    expect(html).toContain("Börja en kontroll senare");
    expect(html).toContain("Gå ihop en kontroll senare");
    const locked = render(true);
    expect(locked).not.toContain("+ gren");
    expect(locked).not.toContain("Ta bort gren");
  });
});
