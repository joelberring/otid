/**
 * Sträcktidsanalys för en klass eller en variant (PLAN.md steg 13 och 16): sträcktid och placering per sträcka,
 * totaltid och placering vid varje kontroll, bästa sträcka och tidsförlust mot den.
 *
 * - Bara godkända löpare får placering och avgör bästa sträcka. Övriga (t.ex. felstämplade) visar sina tider
 *   och sin förlust mot bästa, men utan placering.
 * - En sträcktid räknas mellan två kolumner som löparen har tid vid. Saknas tiden vid föregående kontroll
 *   (missad stämpling, eller stämpling före start) är sträckan okänd, men totaltiden visas.
 * - En gafflad klass jämförs per variant (`splitTablesByVariant`): sträckorna är bara jämförbara inom samma variant.
 */

export type SplitTableSplit = { controlCode: number; occurrence: number; legMs: number; elapsedMs: number };
export type SplitTableRunner = { key: string; ok: boolean; elapsedMs?: number | undefined; splits: readonly SplitTableSplit[] };

/** En punkt i en sträcka: kontrollens kod och förekomst ("31.1"), "S" för start och "F" för mål. */
export type SplitPointKey = string;
export const START_KEY = "S";
export const FINISH_KEY = "F";
export const controlPointKey = (controlCode: number, occurrence: number): SplitPointKey => `${controlCode}.${occurrence}`;
/** En sträckas identitet: från-punkt och till-punkt ("S-31.1", "31.1-32.1", "33.1-F"). */
export const legKey = (from: SplitPointKey, to: SplitPointKey) => `${from}-${to}`;

export type SplitTableColumn = ({ kind: "CONTROL"; controlCode: number; occurrence: number } | { kind: "FINISH" }) & {
  /** Sträckans identitet (föregående kolumn till den här). */
  leg: string;
  /** Bästa sträcktid bland godkända, eller null om ingen godkänd har sträckan. */
  bestLegMs: number | null;
  /** Tabell per sträcka (gafflad klass, steg 49): sträckans från-kontroll ("START" för start). */
  fromCode?: number | "START";
};
export type SplitTableCell = {
  /** Sträcktiden, eller null när tiden vid föregående kontroll saknas. */
  legMs: number | null;
  elapsedMs: number;
  /** Placering på sträckan bland godkända (delad plats vid lika tid). */
  place: number | null;
  /** Placering på totaltiden vid kontrollen bland godkända. */
  elapsedPlace: number | null;
  best: boolean;
  /** Sträcktid minus bästa sträcktid (kan vara negativ för en felstämplad löpare som var snabbare). */
  lossMs: number | null;
};
export type SplitTableRow = { key: string; ok: boolean; cells: (SplitTableCell | null)[];
  /** Summan av förlusterna på alla sträckor, när löparen har alla sträckor. */
  totalLossMs: number | null };
export type SplitTable = { columns: SplitTableColumn[]; rows: SplitTableRow[];
  /** Summan av de bästa sträckorna ("idealtid"), när alla sträckor har en bästa tid. */
  idealMs: number | null };

type ControlRef = { controlCode: number; occurrence: number };

/**
 * Kontrollernas ordning: först den godkända löparen med flest sträcktider, sedan läggs kontroller som bara
 * andra har in efter sin föregångare i den löparens ordning.
 */
function controlOrder(runners: readonly SplitTableRunner[]): ControlRef[] {
  const byLength = [...runners].sort((a, b) => Number(b.ok) - Number(a.ok) || b.splits.length - a.splits.length);
  const order: ControlRef[] = [];
  const keys: string[] = [];
  for (const runner of byLength) {
    let previous: string | undefined;
    for (const split of runner.splits) {
      const key = controlPointKey(split.controlCode, split.occurrence);
      if (!keys.includes(key)) {
        const at = previous === undefined ? 0 : keys.indexOf(previous) + 1;
        keys.splice(at, 0, key);
        order.splice(at, 0, { controlCode: split.controlCode, occurrence: split.occurrence });
      }
      previous = key;
    }
  }
  return order;
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
  const pointKeys = [...controls.map(control => controlPointKey(control.controlCode, control.occurrence)), FINISH_KEY];
  const from = (index: number) => index === 0 ? START_KEY : pointKeys[index - 1]!;
  const columns: SplitTableColumn[] = [
    ...controls.map((control, index) => ({ kind: "CONTROL" as const, ...control, leg: legKey(from(index), pointKeys[index]!), bestLegMs: null })),
    { kind: "FINISH" as const, leg: legKey(from(controls.length), FINISH_KEY), bestLegMs: null }
  ];
  const rows: SplitTableRow[] = runners.map(runner => {
    const elapsedByKey = new Map(runner.splits.map(split => [controlPointKey(split.controlCode, split.occurrence), split.elapsedMs]));
    if (runner.elapsedMs !== undefined) elapsedByKey.set(FINISH_KEY, runner.elapsedMs);
    const cells = pointKeys.map((key, index): SplitTableCell | null => {
      const elapsedMs = elapsedByKey.get(key);
      if (elapsedMs === undefined) return null;
      const previousElapsed = index === 0 ? 0 : elapsedByKey.get(pointKeys[index - 1]!);
      const legMs = previousElapsed === undefined || elapsedMs < previousElapsed ? null : elapsedMs - previousElapsed;
      return { legMs, elapsedMs, place: null, elapsedPlace: null, best: false, lossMs: null };
    });
    return { key: runner.key, ok: runner.ok, cells, totalLossMs: null };
  });
  columns.forEach((column, index) => {
    const legs: { index: number; ms: number }[] = [];
    const totals: { index: number; ms: number }[] = [];
    rows.forEach((row, rowIndex) => {
      const cell = row.cells[index];
      if (!row.ok || !cell) return;
      totals.push({ index: rowIndex, ms: cell.elapsedMs });
      if (cell.legMs !== null) legs.push({ index: rowIndex, ms: cell.legMs });
    });
    for (const [rowIndex, place] of places(legs)) {
      const cell = rows[rowIndex]!.cells[index]!;
      cell.place = place;
      cell.best = place === 1;
    }
    for (const [rowIndex, place] of places(totals)) rows[rowIndex]!.cells[index]!.elapsedPlace = place;
    column.bestLegMs = legs.length === 0 ? null : Math.min(...legs.map(leg => leg.ms));
    for (const row of rows) {
      const cell = row.cells[index];
      if (cell && cell.legMs !== null && column.bestLegMs !== null) cell.lossMs = cell.legMs - column.bestLegMs;
    }
  });
  for (const row of rows) {
    const losses = row.cells.map(cell => cell?.lossMs ?? null);
    row.totalLossMs = losses.every(loss => loss !== null) ? losses.reduce<number>((sum, loss) => sum + Math.max(0, loss), 0) : null;
  }
  const bests = columns.map(column => column.bestLegMs);
  return { columns, rows, idealMs: bests.every(best => best !== null) ? bests.reduce<number>((sum, best) => sum + best, 0) : null };
}

export type SplitSort = { column: number; by: "LEG" | "ELAPSED" } | null;

/**
 * Radordningen när man sorterar på en sträcka (sträcktid) eller en kontroll (totaltid): snabbast först bland alla
 * som har tiden, även felstämplade (de har ingen placering men sprang sträckan), lika tid i ursprunglig ordning och
 * rader utan tid sist. Utan sortering: ursprunglig ordning (godkända först, felstämplade under).
 */
export function sortSplitRows(table: SplitTable, sort: SplitSort): number[] {
  const indexes = table.rows.map((_row, index) => index);
  if (!sort) return indexes;
  const value = (index: number) => {
    const cell = table.rows[index]!.cells[sort.column];
    const ms = sort.by === "LEG" ? cell?.legMs : cell?.elapsedMs;
    return ms ?? Number.POSITIVE_INFINITY;
  };
  return indexes.sort((a, b) => value(a) - value(b) || a - b);
}

/** Radordningen efter total tidsförlust (minst först); godkända först, löpare utan alla sträckor sist. */
export function sortByTotalLoss(table: SplitTable): number[] {
  const value = (index: number) => table.rows[index]!.totalLossMs ?? Number.POSITIVE_INFINITY;
  const group = (index: number) => table.rows[index]!.ok ? 0 : 1;
  return table.rows.map((_row, index) => index).sort((a, b) => group(a) - group(b) || value(a) - value(b) || a - b);
}

/** Löpare i en gafflad klass bär sin variant; null = ingen variant (ogafflad bana). */
export type VariantSplitRunner = SplitTableRunner & { variant: string | null };
export type VariantSplitTable = { variant: string | null; keys: string[]; table: SplitTable };

/**
 * En tabell per variant, i variantordning (ogafflat först). Sträckorna jämförs bara inom samma variant, eftersom
 * två varianter kan ha samma kontroll efter olika föregående kontroller.
 */
export function splitTablesByVariant(runners: readonly VariantSplitRunner[]): VariantSplitTable[] {
  const groups = new Map<string, VariantSplitRunner[]>();
  for (const runner of runners) {
    const key = runner.variant ?? "";
    groups.set(key, [...(groups.get(key) ?? []), runner]);
  }
  return [...groups.entries()].sort(([a], [b]) => a.localeCompare(b, "sv")).map(([variant, group]) => ({
    variant: variant || null, keys: group.map(runner => runner.key), table: buildSplitTable(group)
  }));
}

/**
 * Steg 49: en gafflad klass jämförs per sträcka (kontrollpar) mellan alla som sprungit den, oavsett variant. Kolumnerna
 * är sträckorna i banans ordning (löparnas följder flätas ihop, varianterna i kodordning); en löpare har tid bara på
 * sina egna sträckor. Totaltid vid kontrollen placeras inte, eftersom varianterna når kontrollerna i olika ordning.
 * En sträcka som samma löpare springer flera gånger (samma kontrollpar) blir en kolumn per gång.
 */
export function buildLegSplitTable(runners: readonly VariantSplitRunner[]): SplitTable {
  type Leg = { key: string; from: number | "START"; to: number | "FINISH"; legMs: number | null; elapsedMs: number };
  const legsOf = (runner: VariantSplitRunner): Leg[] => {
    const points: { code: number | "START" | "FINISH"; elapsedMs: number }[] = [{ code: "START", elapsedMs: 0 },
      ...runner.splits.map(split => ({ code: split.controlCode, elapsedMs: split.elapsedMs })),
      ...(runner.elapsedMs === undefined ? [] : [{ code: "FINISH" as const, elapsedMs: runner.elapsedMs }])];
    const seen = new Map<string, number>();
    const legs: Leg[] = [];
    for (let index = 1; index < points.length; index += 1) {
      const from = points[index - 1]!, to = points[index]!;
      const base = `${from.code === "START" ? START_KEY : from.code}-${to.code === "FINISH" ? FINISH_KEY : to.code}`;
      const count = (seen.get(base) ?? 0) + 1;
      seen.set(base, count);
      legs.push({ key: count === 1 ? base : `${base}#${count}`, from: from.code as number | "START", to: to.code as number | "FINISH",
        legMs: to.elapsedMs < from.elapsedMs ? null : to.elapsedMs - from.elapsedMs, elapsedMs: to.elapsedMs });
    }
    return legs;
  };
  const perRunner = runners.map(legsOf);
  const ordered = runners.map((runner, index) => ({ runner, index })).sort((a, b) => Number(b.runner.ok) - Number(a.runner.ok) ||
    (a.runner.variant ?? "").localeCompare(b.runner.variant ?? "", "sv") || b.runner.splits.length - a.runner.splits.length);
  const keys: string[] = [];
  const meta = new Map<string, Leg>();
  for (const { index } of ordered) {
    let previous: string | undefined;
    for (const leg of perRunner[index]!) {
      if (!keys.includes(leg.key)) {
        keys.splice(previous === undefined ? 0 : keys.indexOf(previous) + 1, 0, leg.key);
        meta.set(leg.key, leg);
      }
      previous = leg.key;
    }
  }
  // Mål sist.
  keys.sort((a, b) => Number(meta.get(a)!.to === "FINISH") - Number(meta.get(b)!.to === "FINISH"));
  const occurrences = new Map<number, number>();
  const columns: SplitTableColumn[] = keys.map(key => {
    const leg = meta.get(key)!;
    if (leg.to === "FINISH") return { kind: "FINISH" as const, leg: key, bestLegMs: null, fromCode: leg.from };
    const occurrence = (occurrences.get(leg.to) ?? 0) + 1;
    occurrences.set(leg.to, occurrence);
    return { kind: "CONTROL" as const, controlCode: leg.to, occurrence, leg: key, bestLegMs: null, fromCode: leg.from };
  });
  const rows: SplitTableRow[] = runners.map((runner, rowIndex) => {
    const byKey = new Map(perRunner[rowIndex]!.map(leg => [leg.key, leg]));
    return { key: runner.key, ok: runner.ok, totalLossMs: null, cells: keys.map(key => {
      const leg = byKey.get(key);
      return leg ? { legMs: leg.legMs, elapsedMs: leg.elapsedMs, place: null, elapsedPlace: null, best: false, lossMs: null } : null;
    }) };
  });
  columns.forEach((column, index) => {
    const legs = rows.flatMap((row, rowIndex) => row.ok && row.cells[index]?.legMs != null ? [{ index: rowIndex, ms: row.cells[index].legMs }] : []);
    for (const [rowIndex, place] of places(legs)) {
      const cell = rows[rowIndex]!.cells[index]!;
      cell.place = place;
      cell.best = place === 1;
    }
    column.bestLegMs = legs.length === 0 ? null : Math.min(...legs.map(leg => leg.ms));
    for (const row of rows) {
      const cell = row.cells[index];
      if (cell && cell.legMs !== null && column.bestLegMs !== null) cell.lossMs = cell.legMs - column.bestLegMs;
    }
  });
  for (const row of rows) {
    const own = row.cells.filter((cell): cell is SplitTableCell => cell !== null);
    row.totalLossMs = own.length > 0 && own.every(cell => cell.lossMs !== null)
      ? own.reduce((sum, cell) => sum + Math.max(0, cell.lossMs!), 0) : null;
  }
  return { columns, rows, idealMs: null };
}
