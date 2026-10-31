import { leastUsedCourseVariant } from "./course-variants";

/**
 * Kartor till starten (PLAN.md steg 61). En plan som tryckantalet, kartbuntslistan och baksidorna läser, så att de tre
 * alltid har samma ordning och samma räkning:
 *
 * - En grupp per bana och variant (gafflad bana) eller per bana (ogafflad), i banans och variantens ordning. Gruppen har
 *   löparna med varianten sorterade på starttid, de lediga starttiderna (vakanser) med den variant en efteranmäld skulle
 *   få, och reservkartor. Tryckantalet är löpare + lediga tider + reserv, och baksidorna är exakt så många sidor.
 * - Varje karta har ett startnummer: löpande nummer i startordningen (starttid, klass, variant, namn), där lediga tider
 *   också får ett nummer så att en efteranmäld inte flyttar de andras nummer. Fri start sist, per klass.
 * - En ledig tid i en gafflad klass får den minst använda varianten i klassen, samma regel som efteranmälan
 *   (`leastUsedCourseVariant`), i tidsordning.
 *
 * Löpare i en gafflad klass utan giltig variant ingår inte i någon grupp; de står i `missingVariant` (fördela först).
 * Allt här är rent.
 */

export type MapBundleStartMode = "MINUTE" | "MASS" | "FREE";

export interface MapBundleClassInput {
  readonly id: string;
  readonly name: string;
  readonly courseVersionId: string;
  readonly courseName: string;
  /** Banans varianter i visningsordning; tom = inte gafflad. */
  readonly variantCodes: readonly string[];
  readonly startMode: MapBundleStartMode;
  /** Lediga lottade starttider (ISO). */
  readonly vacancies: readonly string[];
}

export interface MapBundleEntryInput {
  readonly id: string;
  readonly name: string;
  readonly club: string | null;
  readonly classId: string;
  /** Lottad tid; null vid fri start eller saknad tid. */
  readonly startTime: string | null;
  readonly variantCode: string | null;
}

export type MapReserve = { readonly kind: "PERCENT" | "COUNT"; readonly value: number };
export const DEFAULT_MAP_RESERVE: MapReserve = { kind: "PERCENT", value: 10 };

export interface MapBundleRunnerItem {
  readonly kind: "RUNNER";
  readonly number: number;
  readonly entryId: string;
  readonly name: string;
  readonly club: string | null;
  readonly className: string;
  readonly startTime: string | null;
}
export interface MapBundleVacantItem {
  readonly kind: "VACANT";
  readonly number: number;
  readonly className: string;
  readonly startTime: string;
}
export type MapBundleItem = MapBundleRunnerItem | MapBundleVacantItem;

export interface MapBundleGroup {
  readonly courseVersionId: string;
  readonly courseName: string;
  /** Null för en ogafflad bana. */
  readonly variantCode: string | null;
  /** Löpare och lediga tider i kartbuntens ordning (starttid, sedan startnummer). */
  readonly items: readonly MapBundleItem[];
  readonly runnerCount: number;
  readonly vacancyCount: number;
  readonly reserveCount: number;
  /** Tryckantal = löpare + lediga tider + reserv. */
  readonly printCount: number;
}

/** En rad i kartbuntslistan: en karta som ska ligga i bunten. */
export interface MapBundleRow {
  readonly number: number;
  readonly entryId: string | null;
  readonly name: string | null;
  readonly club: string | null;
  readonly classId: string;
  readonly className: string;
  readonly courseName: string;
  readonly variantCode: string | null;
  readonly startTime: string | null;
  readonly startMode: MapBundleStartMode;
}

export interface MapBundlePlan {
  readonly groups: readonly MapBundleGroup[];
  /** Alla kartor i startnummerordning. */
  readonly rows: readonly MapBundleRow[];
  readonly missingVariant: readonly { readonly entryId: string; readonly name: string; readonly className: string }[];
}

const compare = (left: string, right: string) => left.localeCompare(right, "sv-SE");
const timeOf = (instant: string | null) => instant === null ? Infinity : Date.parse(instant);

/** Reservkartor för en grupp med `base` kartor. */
export function mapReserveCount(base: number, reserve: MapReserve): number {
  const value = Math.max(0, Math.floor(reserve.value));
  return reserve.kind === "COUNT" ? value : Math.ceil(base * value / 100);
}

interface Slot { readonly entry?: MapBundleEntryInput; readonly vacancy?: string; readonly raceClass: MapBundleClassInput;
  readonly variantCode: string | null }

export function planMapBundles(input: {
  readonly classes: readonly MapBundleClassInput[];
  readonly entries: readonly MapBundleEntryInput[];
  readonly reserve: MapReserve;
}): MapBundlePlan {
  const slots: Slot[] = [];
  const missingVariant: { entryId: string; name: string; className: string }[] = [];
  const classes = [...input.classes].sort((left, right) => compare(left.name, right.name) || compare(left.id, right.id));
  for (const raceClass of classes) {
    const entries = input.entries.filter((entry) => entry.classId === raceClass.id);
    const forked = raceClass.variantCodes.length > 0;
    const used: (string | null)[] = [];
    for (const entry of entries) {
      const time = raceClass.startMode === "FREE" ? null : entry.startTime;
      if (!forked) { slots.push({ entry: { ...entry, startTime: time }, raceClass, variantCode: null }); continue; }
      if (entry.variantCode === null || !raceClass.variantCodes.includes(entry.variantCode)) {
        missingVariant.push({ entryId: entry.id, name: entry.name, className: raceClass.name });
        continue;
      }
      used.push(entry.variantCode);
      slots.push({ entry: { ...entry, startTime: time }, raceClass, variantCode: entry.variantCode });
    }
    if (raceClass.startMode !== "MINUTE") continue;
    for (const vacancy of [...raceClass.vacancies].sort((left, right) => Date.parse(left) - Date.parse(right))) {
      const code = forked ? leastUsedCourseVariant(raceClass.variantCodes, used) ?? null : null;
      used.push(code);
      slots.push({ vacancy, raceClass, variantCode: code });
    }
  }
  // Startordning: tid, klass, namn (lediga tider efter löparna samma minut); fri start sist per klass. Varianten ingår inte,
  // så att ett byte av variant inte flyttar startnumren.
  const sortKey = (slot: Slot) => slot.entry ? slot.entry.startTime : slot.vacancy!;
  slots.sort((left, right) => timeOf(sortKey(left)) - timeOf(sortKey(right)) ||
    compare(left.raceClass.name, right.raceClass.name) || compare(left.raceClass.id, right.raceClass.id) ||
    Number(!left.entry) - Number(!right.entry) ||
    compare(left.entry?.name ?? "", right.entry?.name ?? "") || compare(left.entry?.id ?? "", right.entry?.id ?? ""));
  const rows: MapBundleRow[] = slots.map((slot, index) => ({ number: index + 1, entryId: slot.entry?.id ?? null,
    name: slot.entry?.name ?? null, club: slot.entry?.club ?? null, classId: slot.raceClass.id, className: slot.raceClass.name,
    courseName: slot.raceClass.courseName, variantCode: slot.variantCode, startTime: slot.entry ? slot.entry.startTime : slot.vacancy!,
    startMode: slot.raceClass.startMode }));

  const groups = new Map<string, { courseVersionId: string; courseName: string; variantCode: string | null; order: number; items: MapBundleItem[] }>();
  const variantOrder = new Map<string, readonly string[]>(classes.map((row) => [row.courseVersionId, row.variantCodes]));
  for (const [index, slot] of slots.entries()) {
    const row = rows[index]!;
    const key = `${slot.raceClass.courseVersionId}:${slot.variantCode ?? ""}`;
    const group = groups.get(key) ?? { courseVersionId: slot.raceClass.courseVersionId, courseName: slot.raceClass.courseName,
      variantCode: slot.variantCode, order: (variantOrder.get(slot.raceClass.courseVersionId) ?? []).indexOf(slot.variantCode ?? ""), items: [] };
    group.items.push(slot.entry ? { kind: "RUNNER", number: row.number, entryId: slot.entry.id, name: slot.entry.name,
      club: slot.entry.club, className: slot.raceClass.name, startTime: row.startTime }
      : { kind: "VACANT", number: row.number, className: slot.raceClass.name, startTime: slot.vacancy! });
    groups.set(key, group);
  }
  // Gafflade varianter utan löpare får också en grupp, så att tryckantalet visar dem (reserv eller noll).
  for (const raceClass of classes) for (const code of raceClass.variantCodes) {
    const key = `${raceClass.courseVersionId}:${code}`;
    if (!groups.has(key)) groups.set(key, { courseVersionId: raceClass.courseVersionId, courseName: raceClass.courseName,
      variantCode: code, order: raceClass.variantCodes.indexOf(code), items: [] });
  }
  const ordered = [...groups.values()].sort((left, right) => compare(left.courseName, right.courseName) ||
    compare(left.courseVersionId, right.courseVersionId) || left.order - right.order);
  return {
    groups: ordered.map((group) => {
      const runnerCount = group.items.filter((item) => item.kind === "RUNNER").length;
      const vacancyCount = group.items.length - runnerCount;
      const reserveCount = mapReserveCount(group.items.length, input.reserve);
      return { courseVersionId: group.courseVersionId, courseName: group.courseName, variantCode: group.variantCode, items: group.items,
        runnerCount, vacancyCount, reserveCount, printCount: group.items.length + reserveCount };
    }),
    rows,
    missingVariant: missingVariant.sort((left, right) => compare(left.className, right.className) || compare(left.name, right.name))
  };
}

/** Kartbuntslistan per starttid: en grupp per minut; fri start sist, en grupp per klass. */
export function mapBundlesByTime(rows: readonly MapBundleRow[]): { readonly startTime: string | null; readonly rows: readonly MapBundleRow[] }[] {
  const result: { startTime: string | null; classId: string | null; rows: MapBundleRow[] }[] = [];
  for (const row of rows) {
    const minute = row.startTime === null ? null : new Date(Math.floor(Date.parse(row.startTime) / 60_000) * 60_000).toISOString();
    const classId = minute === null ? row.classId : null;
    const last = result.at(-1);
    if (last && last.startTime === minute && last.classId === classId) last.rows.push(row);
    else result.push({ startTime: minute, classId, rows: [row] });
  }
  return result.map(({ startTime, rows: groupRows }) => ({ startTime, rows: groupRows }));
}

/** Kartbuntslistan per klass och variant (masstart): klasserna i namnordning, varianterna i banans ordning. */
export function mapBundlesByClass(rows: readonly MapBundleRow[], variantOrder: (className: string) => readonly string[] = () => []):
  { readonly className: string; readonly courseName: string; readonly variantCode: string | null; readonly rows: readonly MapBundleRow[] }[] {
  const groups = new Map<string, { className: string; courseName: string; variantCode: string | null; rows: MapBundleRow[] }>();
  for (const row of rows) {
    const key = `${row.classId}\u0000${row.variantCode ?? ""}`;
    const group = groups.get(key) ?? { className: row.className, courseName: row.courseName, variantCode: row.variantCode, rows: [] };
    group.rows.push(row);
    groups.set(key, group);
  }
  return [...groups.values()].sort((left, right) => compare(left.className, right.className) ||
    variantOrder(left.className).indexOf(left.variantCode ?? "") - variantOrder(right.className).indexOf(right.variantCode ?? "") ||
    compare(left.variantCode ?? "", right.variantCode ?? ""));
}

/** En sida i baksidesutskriften: avdelare före varje variant, en sida per karta och reservsidor. */
export type MapBackPage =
  | { readonly kind: "DIVIDER"; readonly courseName: string; readonly variantCode: string | null; readonly printCount: number }
  | { readonly kind: "RUNNER"; readonly courseName: string; readonly variantCode: string | null; readonly item: MapBundleRunnerItem }
  | { readonly kind: "VACANT"; readonly courseName: string; readonly variantCode: string | null; readonly item: MapBundleVacantItem }
  | { readonly kind: "RESERVE"; readonly courseName: string; readonly variantCode: string | null; readonly index: number };

/** Baksidorna i kartbuntens ordning: per variant en avdelare och sedan exakt tryckantalet sidor. */
export function mapBackPages(groups: readonly Pick<MapBundleGroup, "courseName" | "variantCode" | "items" | "reserveCount" | "printCount">[]):
  MapBackPage[] {
  const pages: MapBackPage[] = [];
  for (const group of groups) {
    if (group.printCount === 0) continue;
    const base = { courseName: group.courseName, variantCode: group.variantCode };
    pages.push({ kind: "DIVIDER", ...base, printCount: group.printCount });
    for (const item of group.items) pages.push(item.kind === "RUNNER" ? { kind: "RUNNER", ...base, item } : { kind: "VACANT", ...base, item });
    for (let index = 1; index <= group.reserveCount; index += 1) pages.push({ kind: "RESERVE", ...base, index });
  }
  return pages;
}

// ── Ändringar sedan utskriften ──────────────────────────────────────────────────────────────────────────────

/** Det som sparas när en lista skrivs ut: varje löpares karta och tryckantalet per grupp. */
export interface PrintedMapRow {
  readonly entryId: string;
  readonly number: number;
  readonly name: string;
  readonly className: string;
  readonly courseName: string;
  readonly variantCode: string | null;
  readonly startTime: string | null;
}
export interface PrintedMapCount { readonly courseName: string; readonly variantCode: string | null; readonly printCount: number }
export interface PrintedMapState { readonly rows: readonly PrintedMapRow[]; readonly counts: readonly PrintedMapCount[] }

export function printedMapState(plan: MapBundlePlan): PrintedMapState {
  return {
    rows: plan.rows.flatMap((row) => row.entryId === null || row.name === null ? [] : [{ entryId: row.entryId, number: row.number, name: row.name,
      className: row.className, courseName: row.courseName, variantCode: row.variantCode, startTime: row.startTime }]),
    counts: plan.groups.map((group) => ({ courseName: group.courseName, variantCode: group.variantCode, printCount: group.printCount }))
  };
}

export type MapPrintChange =
  | { readonly kind: "ADDED"; readonly name: string; readonly className: string; readonly variantCode: string | null }
  | { readonly kind: "REMOVED"; readonly name: string; readonly className: string; readonly variantCode: string | null }
  | { readonly kind: "VARIANT"; readonly name: string; readonly className: string; readonly from: string | null; readonly to: string | null }
  | { readonly kind: "CLASS"; readonly name: string; readonly from: string; readonly to: string; readonly variantCode: string | null }
  | { readonly kind: "START_TIME"; readonly name: string; readonly className: string; readonly from: string | null; readonly to: string | null }
  | { readonly kind: "COUNT"; readonly courseName: string; readonly variantCode: string | null; readonly from: number; readonly to: number }
  /** Startnumret har flyttats för så många löpare som fanns förut (t.ex. efter en efteranmälan med fri start). */
  | { readonly kind: "NUMBERS"; readonly count: number };

/**
 * Vad som ändrats sedan listan skrevs ut: nya och borttagna löpare, ändrad variant, klass eller starttid, och (med
 * `counts`) ändrat tryckantal. Flyttade startnummer räknas ihop till en rad.
 */
export function mapPrintChanges(printed: PrintedMapState, current: PrintedMapState, options: { readonly counts?: boolean } = {}): MapPrintChange[] {
  const before = new Map(printed.rows.map((row) => [row.entryId, row]));
  const after = new Map(current.rows.map((row) => [row.entryId, row]));
  const changes: MapPrintChange[] = [];
  for (const row of current.rows) {
    const old = before.get(row.entryId);
    if (!old) { changes.push({ kind: "ADDED", name: row.name, className: row.className, variantCode: row.variantCode }); continue; }
    if (old.className !== row.className) changes.push({ kind: "CLASS", name: row.name, from: old.className, to: row.className, variantCode: row.variantCode });
    else if (old.variantCode !== row.variantCode) changes.push({ kind: "VARIANT", name: row.name, className: row.className, from: old.variantCode, to: row.variantCode });
    if (timeOf(old.startTime) !== timeOf(row.startTime)) changes.push({ kind: "START_TIME", name: row.name, className: row.className,
      from: old.startTime, to: row.startTime });
  }
  const moved = current.rows.filter((row) => before.has(row.entryId) && before.get(row.entryId)!.number !== row.number).length;
  if (moved > 0) changes.push({ kind: "NUMBERS", count: moved });
  for (const row of printed.rows) {
    if (!after.has(row.entryId)) changes.push({ kind: "REMOVED", name: row.name, className: row.className, variantCode: row.variantCode });
  }
  if (options.counts) {
    const key = (row: PrintedMapCount) => `${row.courseName}\u0000${row.variantCode ?? ""}`;
    const old = new Map(printed.counts.map((row) => [key(row), row.printCount]));
    for (const row of current.counts) {
      const from = old.get(key(row)) ?? 0;
      if (from !== row.printCount) changes.push({ kind: "COUNT", courseName: row.courseName, variantCode: row.variantCode, from, to: row.printCount });
    }
    const now = new Set(current.counts.map(key));
    for (const row of printed.counts) if (!now.has(key(row)) && row.printCount > 0) {
      changes.push({ kind: "COUNT", courseName: row.courseName, variantCode: row.variantCode, from: row.printCount, to: 0 });
    }
  }
  return changes;
}
