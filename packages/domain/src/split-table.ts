/**
 * Sträcktidstabell för en klass eller en variant (PLAN.md steg 13): sträcktid och placering per sträcka,
 * totaltid vid varje kontroll och bästa sträcka. Bara godkända löpare jämförs; övriga visar sina tider utan placering.
 * En gafflad klass delas upp per variant av anroparen, eftersom sträckorna bara är jämförbara inom samma variant.
 */

export type SplitTableSplit = { controlCode: number; occurrence: number; legMs: number; elapsedMs: number };
export type SplitTableRunner = { key: string; ok: boolean; elapsedMs?: number | undefined; splits: readonly SplitTableSplit[] };

export type SplitTableColumn = { kind: "CONTROL"; controlCode: number; occurrence: number } | { kind: "FINISH" };
export type SplitTableCell = { legMs: number; elapsedMs: number; place: number | null; best: boolean };
export type SplitTableRow = { key: string; cells: (SplitTableCell | null)[] };
export type SplitTable = { columns: SplitTableColumn[]; rows: SplitTableRow[] };

const controlKey = (controlCode: number, occurrence: number) => `${controlCode}:${occurrence}`;

/** Kontrollernas ordning: från den godkända löparen med flest sträcktider (annars vem som helst), sedan övriga i den ordning de dyker upp. */
function controlOrder(runners: readonly SplitTableRunner[]): { controlCode: number; occurrence: number }[] {
  const byLength = [...runners].sort((a, b) => Number(b.ok) - Number(a.ok) || b.splits.length - a.splits.length);
  const seen = new Set<string>();
  const columns: { controlCode: number; occurrence: number }[] = [];
  for (const runner of byLength) {
    for (const split of runner.splits) {
      const key = controlKey(split.controlCode, split.occurrence);
      if (seen.has(key)) continue;
      seen.add(key);
      columns.push({ controlCode: split.controlCode, occurrence: split.occurrence });
    }
  }
  return columns;
}

/** Placering med delad plats vid lika tid (1, 1, 3). */
function places(values: readonly { index: number; ms: number }[]): Map<number, number> {
  const sorted = [...values].sort((a, b) => a.ms - b.ms);
  const result = new Map<number, number>();
  sorted.forEach((value, position) => {
    const previous = sorted[position - 1];
    result.set(value.index, previous && previous.ms === value.ms ? result.get(previous.index)! : position + 1);
  });
  return result;
}

export function buildSplitTable(runners: readonly SplitTableRunner[]): SplitTable {
  const controls = controlOrder(runners);
  const columns: SplitTableColumn[] = [...controls.map(control => ({ kind: "CONTROL" as const, ...control })), { kind: "FINISH" }];
  const rows: SplitTableRow[] = runners.map(runner => {
    const byKey = new Map(runner.splits.map(split => [controlKey(split.controlCode, split.occurrence), split]));
    const cells: (SplitTableCell | null)[] = controls.map(control => {
      const split = byKey.get(controlKey(control.controlCode, control.occurrence));
      return split ? { legMs: split.legMs, elapsedMs: split.elapsedMs, place: null, best: false } : null;
    });
    const last = runner.splits.at(-1);
    cells.push(runner.elapsedMs === undefined ? null : {
      legMs: runner.elapsedMs - (last?.elapsedMs ?? 0), elapsedMs: runner.elapsedMs, place: null, best: false
    });
    return { key: runner.key, cells };
  });
  columns.forEach((_column, column) => {
    const compared = rows.flatMap((row, index) => {
      const cell = row.cells[column];
      return runners[index]!.ok && cell ? [{ index, ms: cell.legMs }] : [];
    });
    for (const [index, place] of places(compared)) {
      const cell = rows[index]!.cells[column]!;
      cell.place = place;
      cell.best = place === 1;
    }
  });
  return { columns, rows };
}
