import { describe, expect, it } from "vitest";
import { applyEdit, type CourseSettingDocument, type CourseSettingEdit } from "@o-tid/course-setting";
import { addBingoGroupEdits, bingoAreaFrom, bingoGroups, rerollSharedEdits, setBingoAreaEdits, setBingoCellEdits, setGroupAreaEdits, setShipsEdits, sharedShipRects } from "./bingo-setup";
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

  it("gemensamma och egna skepp: ett ändrat fält behåller det andra förvalet; båda tomma blir förval igen", () => {
    let document = testDocument();
    document = run(document, addBingoGroupEdits(document, "Gröna", 100, { minX: 0, minY: 0, maxX: 100, maxY: 80 }, undefined).edits);
    const group = () => bingoGroups(document)[0]!;
    document = run(document, setShipsEdits(document, group(), "shared", [4]));
    expect(group().bingo).toMatchObject({ sharedShips: [4], ships: [2, 2] });
    document = run(document, setShipsEdits(document, group(), "own", null));
    expect(group().bingo).toMatchObject({ sharedShips: [4], ships: [] });
    document = run(document, setShipsEdits(document, group(), "shared", null));
    expect(group().bingo.sharedShips).toBeUndefined();
    expect(group().bingo.ships).toBeUndefined();
  });

  it("ledarens gemensamma skepp i editorn följer gruppens frö; «Slumpa om» byter fröet och behålls när annat ändras", () => {
    let document = testDocument();
    document = run(document, addBingoGroupEdits(document, "Gröna", 100, { minX: 0, minY: 0, maxX: 100, maxY: 80 }, undefined).edits);
    const raceId = "10000000-0000-4000-8000-000000000001";
    const before = sharedShipRects(document, raceId, bingoGroups(document)[0]!.course);
    expect(before.map(ship => ship.length)).toEqual([4, 3]);
    document = run(document, rerollSharedEdits(document, bingoGroups(document)[0]!, 12345));
    document = run(document, setShipsEdits(document, bingoGroups(document)[0]!, "own", [2]));
    document = run(document, setGroupAreaEdits(document, bingoGroups(document)[0]!, { minX: 0, minY: 0, maxX: 100, maxY: 80 }, true));
    expect(bingoGroups(document)[0]!.bingo).toMatchObject({ sharedSeed: 12345, ships: [2], sharedShips: [4, 3] });
    expect(sharedShipRects(document, raceId, bingoGroups(document)[0]!.course)).not.toEqual(before);
  });
});
