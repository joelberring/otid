import type { SheetItem } from "@o-tid/course-setting";
import { toCsv } from "@o-tid/domain";
import type { RunnerPrint, RunnerPrintProblem } from "./course-setting-runner-print";

/**
 * ADR-0213: vilka löpare som skrivs ut i en karta per löpare, och kontrollen av kopplingen mellan deltagare, klass och
 * variant före utskriften. Ren logik; sidan och PDF-jobbet får samma urval (framsida och baksida följer det).
 */
export type RunnerSelection =
  | { readonly kind: "ALL" }
  /** Klassernas namn: löparna och de lediga tiderna i klasserna (reserverna bara med "Alla"). */
  | { readonly kind: "CLASSES"; readonly classes: readonly string[] }
  /** Deltagarna (id). */
  | { readonly kind: "RUNNERS"; readonly entries: readonly string[] }
  /** Stafett: lagen (lagnummer) med alla sträckor eller en sträcka. */
  | { readonly kind: "TEAMS"; readonly teams: readonly number[]; readonly leg: number | "ALL" };

export const ALL_RUNNERS: RunnerSelection = { kind: "ALL" };

/** Kartorna i urvalet, i samma ordning som förut. */
export function selectRunnerItems(items: readonly SheetItem[], selection: RunnerSelection): SheetItem[] {
  switch (selection.kind) {
    case "ALL": return [...items];
    case "CLASSES": {
      const wanted = new Set(selection.classes);
      return items.filter(item => item.runner && item.runner.kind !== "RESERVE" && item.runner.className !== null && wanted.has(item.runner.className));
    }
    case "RUNNERS": {
      const wanted = new Set(selection.entries);
      return items.filter(item => item.runner?.entryId !== undefined && wanted.has(item.runner.entryId));
    }
    case "TEAMS": {
      const wanted = new Set(selection.teams);
      return items.filter(item => item.runner?.team !== undefined && wanted.has(item.runner.team.number)
        && (selection.leg === "ALL" || item.runner.leg === selection.leg));
    }
  }
}

/** Löparna att välja bland: namn eller nummer (startnummer, lagnummer) i sökningen. */
export function searchRunners(items: readonly SheetItem[], query: string, limit = 20): SheetItem[] {
  const text = query.trim().toLocaleLowerCase("sv-SE");
  if (!text) return [];
  return items.filter(item => {
    const runner = item.runner;
    if (!runner || runner.kind !== "RUNNER" || !runner.entryId) return false;
    if (/^\d+$/.test(text)) return String(runner.startNumber) === text || String(runner.team?.number) === text;
    return (runner.name ?? "").toLocaleLowerCase("sv-SE").includes(text) || (runner.team?.name ?? "").toLocaleLowerCase("sv-SE").includes(text);
  }).slice(0, limit);
}

export type CheckWarning = "NO_VARIANT" | "EXCLUDED_VARIANT" | "COUNT";

/** En rad i "Kontrollera kopplingen": en karta (med sidan i PDF:en) eller en löpare som inte får någon karta. */
export interface CheckRow {
  readonly key: string;
  /** Sidan i PDF:en (1-baserad); saknas = ingen karta (ingen variant, bortvald variant). */
  readonly page: number | undefined;
  /** Kartan i urvalet (index i de valda kartorna) för förhandsvisningen. */
  readonly item: number | undefined;
  readonly number: number | null;
  readonly name: string;
  readonly club: string;
  readonly className: string;
  readonly team: string;
  readonly courseName: string;
  readonly variant: string;
  readonly startTime: string;
  readonly warnings: readonly CheckWarning[];
}

/**
 * Raderna för kontrolltabellen. `pages[i]` är sidan i PDF:en för kartan `items[i]` (dubbelsidigt: framsidorna 1, 3, 5 …).
 * Varningar: ingen variant, bortvald variant (ADR-0198), antalet per variant stämmer inte med Kartor till starten, och
 * samma startnummer två gånger (inte samma lag, där sträckorna delar lagets nummer).
 */
export function runnerCheckRows(print: Pick<RunnerPrint, "excluded" | "problems">, items: readonly SheetItem[], pages: readonly (number | undefined)[],
  courseName: (course: string) => string, missingVariant: readonly { entryId: string; name: string; className: string; team?: { number: number; name: string } | undefined;
    leg?: number | undefined }[], text: { reserve: string; vacant: string; team: (team: { number: number; name: string }, leg: number | undefined) => string }): CheckRow[] {
  const countProblems = new Set(print.problems.filter((problem): problem is Extract<RunnerPrintProblem, { kind: "COUNT" }> => problem.kind === "COUNT")
    .map(problem => `${problem.courseName}|${problem.variantCode ?? ""}`));
  const rows: CheckRow[] = items.map((item, index) => {
    const runner = item.runner;
    const course = courseName(item.course);
    return { key: `i${index}`, page: pages[index], item: index, number: runner?.startNumber ?? null,
      name: runner?.name ?? (runner?.kind === "VACANT" ? text.vacant : text.reserve), club: runner?.club ?? "", className: runner?.className ?? "",
      team: runner?.team ? text.team(runner.team, runner.leg) : "", courseName: course, variant: item.variant ?? "", startTime: runner?.startTime ?? "",
      warnings: countProblems.has(`${course}|${item.variant ?? ""}`) ? ["COUNT"] : [] };
  });
  print.excluded.forEach((row, index) => rows.push({ key: `x${index}`, page: undefined, item: undefined, number: row.runner.startNumber, name: row.runner.name ?? text.vacant,
    club: row.runner.club ?? "", className: row.runner.className ?? "", team: row.runner.team ? text.team(row.runner.team, row.runner.leg) : "", courseName: row.courseName,
    variant: row.variantCode, startTime: row.runner.startTime ?? "", warnings: ["EXCLUDED_VARIANT"] }));
  missingVariant.forEach((row, index) => rows.push({ key: `m${index}`, page: undefined, item: undefined, number: null, name: row.name, club: "", className: row.className,
    team: row.team ? text.team(row.team, row.leg) : "", courseName: "", variant: "", startTime: "", warnings: ["NO_VARIANT"] }));
  // Startnumren är kartbuntens löpnummer (unika i planen); det finns inget eget nummerlappsfält att jämföra.
  return rows;
}

export type CheckColumn = "page" | "number" | "name" | "club" | "className" | "team" | "courseName" | "variant" | "startTime";
export const CHECK_COLUMNS: readonly CheckColumn[] = ["page", "number", "name", "club", "className", "team", "courseName", "variant", "startTime"];

/** Sortering (tal som tal, text på svenska) och filter (text i någon kolumn, eller bara rader med varning). */
export function sortCheckRows(rows: readonly CheckRow[], column: CheckColumn, descending: boolean, filter: string, warningsOnly: boolean): CheckRow[] {
  const query = filter.trim().toLocaleLowerCase("sv-SE");
  const value = (row: CheckRow) => row[column];
  return rows.filter(row => (!warningsOnly || row.warnings.length > 0)
    && (!query || CHECK_COLUMNS.some(key => String(row[key] ?? "").toLocaleLowerCase("sv-SE").includes(query))))
    .map((row, index) => ({ row, index }))
    .sort((a, b) => {
      const x = value(a.row), y = value(b.row);
      // Tomma (ingen sida, inget nummer) står sist åt båda hållen.
      const empty = (v: unknown) => v === undefined || v === null || v === "";
      if (empty(x) || empty(y)) return Number(empty(x)) - Number(empty(y)) || a.index - b.index;
      const order = typeof x === "number" && typeof y === "number" ? x - y : String(x).localeCompare(String(y), "sv-SE", { numeric: true });
      return (descending ? -order : order) || a.index - b.index;
    }).map(entry => entry.row);
}

/** CSV för Excel (`toCsv`: BOM, semikolon, formelskydd), rubrikerna och en rad per tabellrad; varningarna sist. */
export function checkRowsCsv(rows: readonly CheckRow[], header: readonly string[], warningText: (warning: CheckWarning) => string): string {
  return toCsv(header, rows.map(row => [...CHECK_COLUMNS.map(key => row[key]), row.warnings.map(warningText).join(", ")]));
}

/**
 * Sidan i PDF:en för varje karta: ett ark per löpare, dubbelsidigt med baksidan direkt efter (fram, bak, fram, bak …).
 * `sheetsPerItem` ger hur många ark varje karta blev (en karta som inte gick att lägga ut ger 0).
 */
export function runnerPages(sheetsPerItem: readonly number[]): (number | undefined)[] {
  let page = 1;
  return sheetsPerItem.map(count => { const at = count > 0 ? page : undefined; page += count; return at; });
}
