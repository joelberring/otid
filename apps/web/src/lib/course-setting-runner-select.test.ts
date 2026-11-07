import { describe, expect, it } from "vitest";
import type { SheetItem } from "@o-tid/course-setting";
import { checkRowsCsv, runnerCheckRows, runnerPages, searchRunners, selectRunnerItems, sortCheckRows } from "./course-setting-runner-select";

/** ADR-0213: urvalet av löpare, sidorna i PDF:en (dubbelsidigt) och kontrolltabellens varningar. */
const runner = (entryId: string, name: string, className: string, startNumber: number, extra: Partial<NonNullable<SheetItem["runner"]>> = {}): SheetItem =>
  ({ course: "1", variant: "AC", runner: { kind: "RUNNER", name, club: "OK Natt", className, startTime: "18:30", startNumber, entryId, ...extra } });
const items: SheetItem[] = [
  runner("e1", "Ada Ek", "H21", 141), runner("e2", "Bo Lind", "D21", 142), runner("e3", "Cia Holm", "H21", 143),
  { course: "1", variant: "AD", runner: { kind: "VACANT", name: null, className: "H21", startTime: "18:40", startNumber: 144 } },
  { course: "1", variant: "AC", runner: { kind: "RESERVE", name: null, className: null, startTime: null, startNumber: null } },
  runner("r1", "Dan Berg", "H21 stafett", 145, { team: { number: 12, name: "OK Natt 1" }, leg: 1 }),
  runner("r2", "Eva Sjö", "H21 stafett", 146, { team: { number: 12, name: "OK Natt 1" }, leg: 2 }),
  runner("r3", "Fia Strand", "H21 stafett", 147, { team: { number: 13, name: "OK Natt 2" }, leg: 2 })
];
const names = (list: readonly SheetItem[]) => list.map(item => item.runner?.name ?? item.runner?.kind);

describe("urvalet av löpare", () => {
  it("alla, klasser (med lediga, utan reserver), löpare och lag med alla eller en sträcka", () => {
    expect(selectRunnerItems(items, { kind: "ALL" })).toHaveLength(items.length);
    expect(names(selectRunnerItems(items, { kind: "CLASSES", classes: ["H21"] }))).toEqual(["Ada Ek", "Cia Holm", "VACANT"]);
    expect(names(selectRunnerItems(items, { kind: "RUNNERS", entries: ["e3"] }))).toEqual(["Cia Holm"]);
    expect(names(selectRunnerItems(items, { kind: "TEAMS", teams: [12], leg: 2 }))).toEqual(["Eva Sjö"]);
    expect(names(selectRunnerItems(items, { kind: "TEAMS", teams: [12, 13], leg: "ALL" }))).toEqual(["Dan Berg", "Eva Sjö", "Fia Strand"]);
  });

  it("söker på namn, startnummer och lagnummer", () => {
    expect(names(searchRunners(items, "143"))).toEqual(["Cia Holm"]);
    expect(names(searchRunners(items, "12"))).toEqual(["Dan Berg", "Eva Sjö"]);
    expect(names(searchRunners(items, "lind"))).toEqual(["Bo Lind"]);
    expect(searchRunners(items, " ")).toEqual([]);
  });

  it("sidorna i PDF:en: dubbelsidigt fram och bak i följd, en karta som inte gick saknar sida", () => {
    expect(runnerPages([2, 2, 2])).toEqual([1, 3, 5]);
    expect(runnerPages([1, 0, 1])).toEqual([1, undefined, 2]);
  });
});

describe("Kontrollera kopplingen", () => {
  const text = { reserve: "Reserv", vacant: "Ledig", team: (team: { number: number }, leg: number | undefined) => `Lag ${team.number} · Sträcka ${leg}` };
  const chosen = selectRunnerItems(items, { kind: "ALL" });
  const rows = runnerCheckRows({
    excluded: [{ courseName: "Lång", variantCode: "BD", runner: { kind: "RUNNER", name: "Gun Ek", club: null, className: "H21", startTime: "18:50", startNumber: 141 } }],
    problems: [{ kind: "COUNT", courseName: "Lång", variantCode: "AD", expected: 2, actual: 1 }]
  }, chosen, runnerPages(chosen.map(() => 2)), () => "Lång", [{ entryId: "m1", name: "Hans Holm", className: "H21" }], text);

  it("en rad per karta med sidan, och raderna för löpare utan karta med varningen", () => {
    expect(rows.map(row => row.page)).toEqual([1, 3, 5, 7, 9, 11, 13, 15, undefined, undefined]);
    expect(rows[5]).toMatchObject({ team: "Lag 12 · Sträcka 1", number: 145 });
    expect(rows.find(row => row.name === "Gun Ek")!.warnings).toContain("EXCLUDED_VARIANT");
    expect(rows.find(row => row.name === "Hans Holm")!.warnings).toEqual(["NO_VARIANT"]);
    // Antalet för Lång AD stämmer inte med Kartor till starten.
    expect(rows.find(row => row.variant === "AD")!.warnings).toContain("COUNT");
    // Numren är kartbuntens löpnummer (unika); ingen egen varning för samma nummer, bara de tre ovan.
    expect(rows.find(row => row.name === "Ada Ek")!.warnings).toEqual([]);
    expect(new Set(rows.flatMap(row => row.warnings))).toEqual(new Set(["EXCLUDED_VARIANT", "NO_VARIANT", "COUNT"]));
  });

  it("sorteras, filtreras och sparas som CSV", () => {
    expect(sortCheckRows(rows, "name", false, "", false).slice(0, 3).map(row => row.name)).toEqual(["Ada Ek", "Bo Lind", "Cia Holm"]);
    expect(sortCheckRows(rows, "number", true, "", false)[0]!.number).toBe(147);
    expect(sortCheckRows(rows, "page", false, "stafett", false).map(row => row.name)).toEqual(["Dan Berg", "Eva Sjö", "Fia Strand"]);
    expect(sortCheckRows(rows, "page", false, "", true).map(row => row.name)).toEqual(["Ledig", "Gun Ek", "Hans Holm"]);
    const csv = checkRowsCsv(rows.slice(0, 1), ["PDF-sida", "Nr", "Namn", "Klubb", "Klass", "Lag/Sträcka", "Bana", "Variant", "Starttid", "Varningar"], warning => warning);
    expect(csv).toBe("PDF-sida;Nr;Namn;Klubb;Klass;Lag/Sträcka;Bana;Variant;Starttid;Varningar\r\n1;141;Ada Ek;OK Natt;H21;;Lång;AC;18:30;\r\n");
  });
});
