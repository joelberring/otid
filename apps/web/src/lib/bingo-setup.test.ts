import { describe, expect, it } from "vitest";
import { applyEdit, type CourseSettingDocument, type CourseSettingEdit } from "@o-tid/course-setting";
import { addBingoGroupEdits, bingoAreaFrom, bingoGroups, setBingoAreaEdits, setBingoCellEdits } from "./bingo-setup";
import { testDocument } from "./course-setting-test-document";

const run = (document: CourseSettingDocument, edits: readonly CourseSettingEdit[]) => edits.reduce((doc, edit) => applyEdit(doc, edit).document, document);

describe("bingo i banläggningen", () => {
  it("området är rektangeln runt punkterna, klippt till kartan", () => {
    expect(bingoAreaFrom([{ x: 30, y: 5 }], undefined)).toBeUndefined();
    expect(bingoAreaFrom([{ x: 30, y: 5 }, { x: -10, y: 40 }], { minX: 0, minY: 0, maxX: 100, maxY: 100 })).toEqual({ minX: 0, minY: 5, maxX: 30, maxY: 40 });
    expect(bingoAreaFrom([{ x: 0, y: 0 }, { x: 0.5, y: 30 }], undefined)).toBeUndefined();
  });

  it("en grupp är en ny bana med rutnätet; området och rutan ändras för grupperna", () => {
    let document = testDocument();
    const area = { minX: 0, minY: 0, maxX: 30, maxY: 20 };
    const first = addBingoGroupEdits(document, "Gröna", 100, area, 7500);
    document = run(document, first.edits);
    const second = addBingoGroupEdits(document, "Blå", 250, area, undefined);
    document = run(document, second.edits);
    const groups = bingoGroups(document);
    expect(groups.map(group => [group.course, group.name, group.cells, group.printScale])).toEqual([[first.courseId, "Gröna", 6, 7500], [second.courseId, "Blå", 1, undefined]]);
    expect(document.courses.find(course => course.id === first.courseId)?.secondaryTitle).toBe("Bingo · rutor 100 m");
    document = run(document, setBingoAreaEdits(document, { minX: 0, minY: 0, maxX: 50, maxY: 50 }));
    expect(bingoGroups(document).map(group => group.cells)).toEqual([25, 4]);
    document = run(document, setBingoCellEdits(document, bingoGroups(document)[1]!, 500));
    expect(bingoGroups(document)[1]).toMatchObject({ cells: 1, bingo: { cellMeters: 500 } });
  });
});
