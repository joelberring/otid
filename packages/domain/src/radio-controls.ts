/**
 * Mellantider vid radiokontroller (ADR-0172 beslut 5, PLAN.md steg 20). Rena regler över starttid,
 * radiostämplingar och (för avlästa) avläsningens stämplingstider. Avläsningen i mål avgör resultatet;
 * radion ger bara mellantider och preliminära placeringar.
 *
 * - Tiden vid kontrollen kommer från avläsningen när löparen är avläst och har stämplat där, annars från
 *   den första radiostämplingen vid kontrollen efter start. En radiostämpling före start räknas inte.
 * - Utan känd starttid (fri start som inte lästs av) finns passagen med klockslag men utan tid och placering.
 * - Placering räknas på hela sekunder inom klassen; lika tid ger delad placering (1, 1, 3). Avlästa löpare som
 *   inte är godkända (t.ex. felstämplade) visas med sin tid men utan placering.
 */

export interface RadioRunnerPunch { readonly controlCode: number; readonly punchedAtMs: number }

export interface RadioRunner {
  readonly key: string;
  /** Starttiden som ögonblick (ms), eller null när den inte är känd. */
  readonly startMs: number | null;
  /** Avläst med publicerat resultat: status och stämplingstider (ms från start) från avläsningen. */
  readonly finished?: {
    readonly status: string;
    readonly splits: readonly { readonly controlCode: number; readonly elapsedMs: number }[];
  } | undefined;
  /** Radiostämplingar för löparens bricka, i valfri ordning och ev. med dubbletter. */
  readonly punches: readonly RadioRunnerPunch[];
}

export interface RadioPassage {
  readonly key: string;
  readonly controlCode: number;
  /** När löparen passerade (ms), om det är känt. */
  readonly passedAtMs: number | null;
  /** Tid sedan start (ms), om starttiden är känd. */
  readonly elapsedMs: number | null;
  /** Varifrån tiden kommer. */
  readonly source: "RADIO" | "READOUT";
  /** Löparen är avläst (har ett publicerat resultat). */
  readonly finished: boolean;
  /** Placering vid kontrollen i klassen, eller null utan tid eller för en avläst som inte är godkänd. */
  readonly place: number | null;
}

export interface RadioClassStandings {
  /** Per radiokontroll (i den givna ordningen): passagerna, placerade först. */
  readonly controls: readonly { readonly controlCode: number; readonly passages: readonly RadioPassage[] }[];
  /**
   * Löpare som passerat en radiokontroll men inte är avlästa: deras senaste passage. Längst fram på banan
   * först, sedan placering och klockslag.
   */
  readonly onTheWay: readonly RadioPassage[];
}

type Unranked = Omit<RadioPassage, "place">;

/** Löparens passage vid en kontroll, utan placering. */
export function radioPassage(runner: RadioRunner, controlCode: number): Unranked | undefined {
  const finished = runner.finished !== undefined;
  const split = runner.finished?.splits.find(row => row.controlCode === controlCode);
  if (split) {
    return { key: runner.key, controlCode, source: "READOUT", finished, elapsedMs: split.elapsedMs,
      passedAtMs: runner.startMs === null ? null : runner.startMs + split.elapsedMs };
  }
  let first = Number.POSITIVE_INFINITY;
  for (const punch of runner.punches) {
    if (punch.controlCode !== controlCode || !Number.isFinite(punch.punchedAtMs)) continue;
    if (runner.startMs !== null && punch.punchedAtMs < runner.startMs) continue;
    if (punch.punchedAtMs < first) first = punch.punchedAtMs;
  }
  if (!Number.isFinite(first)) return undefined;
  return { key: runner.key, controlCode, source: "RADIO", finished, passedAtMs: first,
    elapsedMs: runner.startMs === null ? null : first - runner.startMs };
}

const seconds = (ms: number) => Math.floor(ms / 1_000);

function rankable(passage: Unranked, runner: RadioRunner | undefined): boolean {
  return passage.elapsedMs !== null && (runner?.finished === undefined || runner.finished.status === "OK");
}

function compareUnranked(a: Unranked, b: Unranked): number {
  if ((a.elapsedMs === null) !== (b.elapsedMs === null)) return a.elapsedMs === null ? 1 : -1;
  if (a.elapsedMs !== null && b.elapsedMs !== null && a.elapsedMs !== b.elapsedMs) return a.elapsedMs - b.elapsedMs;
  return (a.passedAtMs ?? Infinity) - (b.passedAtMs ?? Infinity) || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0);
}

/** Placerar passagerna vid en kontroll: delad placering vid lika hela sekunder. */
export function rankRadioPassages(passages: readonly Unranked[], runners: ReadonlyMap<string, RadioRunner>): RadioPassage[] {
  const rankableItems: Unranked[] = [];
  const unrankableItems: Unranked[] = [];
  for (const passage of passages) {
    if (rankable(passage, runners.get(passage.key))) rankableItems.push(passage);
    else unrankableItems.push(passage);
  }
  rankableItems.sort(compareUnranked);
  unrankableItems.sort(compareUnranked);
  const result: RadioPassage[] = [];
  let place = 0;
  let prevSeconds: number | undefined;
  for (let index = 0; index < rankableItems.length; index += 1) {
    const passage = rankableItems[index]!;
    const sec = seconds(passage.elapsedMs!);
    if (sec !== prevSeconds) {
      place = index + 1;
      prevSeconds = sec;
    }
    result.push({ ...passage, place });
  }
  for (const passage of unrankableItems) result.push({ ...passage, place: null });
  return result;
}

/** Klassens mellantider vid radiokontrollerna (koderna i banans ordning). */
export function radioClassStandings(runners: readonly RadioRunner[], controlCodes: readonly number[]): RadioClassStandings {
  const byKey = new Map(runners.map(runner => [runner.key, runner]));
  const codes = [...new Set(controlCodes)];
  const controls = codes.map(controlCode => ({ controlCode, passages: rankRadioPassages(
    runners.flatMap(runner => { const passage = radioPassage(runner, controlCode); return passage ? [passage] : []; }), byKey) }));
  const latest = new Map<string, { passage: RadioPassage; index: number }>();
  controls.forEach(({ passages }, index) => {
    for (const passage of passages) {
      if (passage.finished) continue;
      const current = latest.get(passage.key);
      // Den senaste passagen i tid; utan klockslag den som ligger längst fram på banan.
      const later = !current || (passage.passedAtMs !== null && current.passage.passedAtMs !== null
        ? passage.passedAtMs > current.passage.passedAtMs : index > current.index);
      if (later) latest.set(passage.key, { passage, index });
    }
  });
  const onTheWay = [...latest.values()].sort((a, b) => b.index - a.index ||
    (a.passage.place ?? Infinity) - (b.passage.place ?? Infinity) ||
    (a.passage.passedAtMs ?? Infinity) - (b.passage.passedAtMs ?? Infinity) ||
    (a.passage.key < b.passage.key ? -1 : a.passage.key > b.passage.key ? 1 : 0)).map(row => row.passage);
  return { controls, onTheWay };
}
