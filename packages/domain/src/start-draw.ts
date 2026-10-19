import type { RaceSnapshot } from "./types";
import { MAX_UINT32 } from "./seeded-random";
import { classRandom, runnerOrder, vacancyCount, vacancyPositions, type StartDrawRunner, type StartDrawSeeding,
  type StartDrawVacancies } from "./start-draw-order";

export * from "./start-draw-order";

/**
 * Lottning av starttider (PLAN.md steg 9 och 26). Ren och deterministisk: samma
 * underlag och samma slumpfrö ger alltid samma starttider.
 *
 * - Lottad minutstart: löparna blandas med fröet och får var sin tid med
 *   klassens intervall. Vakanser sprids jämnt i klassen. Seedade lottas sist
 *   (bäst sist) eller jämnt utspridda.
 * - Masstart: alla löpare i klassen får samma tid.
 * - Klubbseparering: två löpare från samma klubb startar inte efter varandra
 *   när det går att undvika.
 * - Startgrupper: klasser vars banor börjar med samma `groupControls` (1–3) kontroller
 *   startar aldrig samma minut. En gafflad bana har en följd per variant; två klasser
 *   hör till samma startgrupp om någon variant delar början (den säkra regeln), och
 *   grupperna slås ihop i kedja (A delar med B, B med C ⇒ A, B och C).
 * - Startfålla: klasser vars banor (någon variant) har samma första kontroll. Med fler
 *   än en kontroll som avgör startgruppen kan flera grupper i samma fålla starta samma
 *   minut; taket per fålla begränsar hur många.
 * - Tak per minut, totalt och per fålla. Varje minutstart och varje vakant tid räknas;
 *   en masstart räknas som en start.
 * - Klasser med senare start (klockslag eller förskjutning) placeras först, på sin tid
 *   eller första tillåtna minut efter; övriga fyller runt dem. Utan egen ordning packas
 *   klasserna masstart först, sedan största klassen först; med egen ordning i den ordningen.
 * - Befintliga tider (klasser som inte lottas nu) rörs inte; nya tider läggs runt dem.
 * - Regelbrott som lottningen inte kan undvika blir varningar, aldrig fel.
 */
export type StartDrawMethod = "MINUTE" | "MASS";

/** Senare start för en klass: eget klockslag eller minuter efter tävlingens första start. */
export type StartDrawLaterStart =
  | { readonly kind: "CLOCK"; readonly startMs: number }
  | { readonly kind: "OFFSET"; readonly minutes: number };

export interface StartDrawClass {
  readonly classId: string;
  readonly name: string;
  /**
   * Banans första kontroller (koder i ordning, högst tre behövs), en följd per variant för en gafflad bana.
   * Tom lista = banan saknar kontroller och klassen bildar en egen startgrupp.
   */
  readonly startControls: readonly (readonly number[])[];
  readonly method: StartDrawMethod;
  readonly intervalMinutes: number;
  readonly vacancies: StartDrawVacancies;
  readonly runners: readonly StartDrawRunner[];
  readonly laterStart?: StartDrawLaterStart | null;
}

/** En klass som inte lottas nu men har tider (löpare och vakanta tider) som nya tider ska läggas runt. */
export interface StartDrawExistingClass {
  readonly classId: string;
  readonly startControls: readonly (readonly number[])[];
  readonly startTimesMs: readonly number[];
}

export interface StartDrawRules {
  /** Hur många av banans första kontroller som avgör startgruppen (1–3). Standard 1. */
  readonly groupControls?: number;
  /** Högst så många starter per minut totalt. null = ingen gräns. */
  readonly maxPerMinute?: number | null;
  /** Högst så många starter per minut och startfålla. null = ingen gräns. */
  readonly maxPerMinutePerPen?: number | null;
  /** Sista start: senare tider ger en varning med den sista start som behövs. */
  readonly lastStartMs?: number | null;
  readonly seeding?: StartDrawSeeding;
  /** Egen startordning mellan klasserna (klass-id). null = automatisk. */
  readonly classOrder?: readonly string[] | null;
}

export interface StartDrawInput {
  readonly seed: number;
  readonly firstStartMs: number;
  readonly clubSeparation: boolean;
  readonly classes: readonly StartDrawClass[];
  readonly existing?: readonly StartDrawExistingClass[];
  readonly rules?: StartDrawRules;
}

export interface StartDrawSlot {
  readonly startMs: number;
  /** null = vakant tid. */
  readonly entryId: string | null;
}

export interface StartDrawClassResult {
  readonly classId: string;
  readonly method: StartDrawMethod;
  readonly firstStartMs: number;
  readonly intervalMinutes: number;
  readonly vacancyCount: number;
  /** Minutstart: tider i startordning. Masstart: en rad per löpare med samma tid. */
  readonly slots: readonly StartDrawSlot[];
}

export interface StartDrawGroup {
  /** Kontrollerna som klasserna delar (den början som flest av dem har). */
  readonly controlCodes: readonly number[];
  readonly classIds: readonly string[];
}

export type StartDrawWarning =
  /** Starter efter sista start; `neededLastStartMs` är den sista start som behövs. */
  | { readonly code: "AFTER_LAST_START"; readonly classIds: readonly string[]; readonly firstAfterMs: number; readonly neededLastStartMs: number }
  /** Klassen kunde inte starta på sin senare start och fick första tillåtna minut efter. */
  | { readonly code: "LATER_START_MOVED"; readonly classId: string; readonly wantedMs: number; readonly actualMs: number }
  /** Befintliga tider har redan fler starter per minut än taket. */
  | { readonly code: "EXISTING_OVER_LIMIT"; readonly scope: "TOTAL" | "PEN"; readonly limit: number; readonly firstMs: number; readonly minuteCount: number }
  /** Befintliga tider i samma startgrupp startar samma minut. */
  | { readonly code: "EXISTING_GROUP_CLASH"; readonly classIds: readonly string[]; readonly firstMs: number; readonly minuteCount: number };

export interface StartDrawResult {
  readonly classes: readonly StartDrawClassResult[];
  /** Startgrupper med minst två klasser: först de som lottas nu, sedan klasser som redan har tider. */
  readonly groups: readonly StartDrawGroup[];
  readonly warnings: readonly StartDrawWarning[];
}

export type StartDrawErrorCode = "INVALID_SEED" | "INVALID_FIRST_START" | "INVALID_CLASS" | "INVALID_RULES" | "DUPLICATE" | "TOO_LARGE";

export class StartDrawError extends Error {
  readonly code: StartDrawErrorCode;
  constructor(code: StartDrawErrorCode, message: string) {
    super(message);
    this.name = "StartDrawError";
    this.code = code;
  }
}

const MINUTE_MS = 60_000;
const MAX_INTERVAL_MINUTES = 60;
const MAX_ENTRIES = 10_000;
const MAX_OFFSET_MINUTES = 7 * 24 * 60;
const MAX_LIMIT = 1_000;
const MAX_SEED_RANK = 10_000;

export function isValidStartDrawSeed(seed: number): boolean {
  return Number.isSafeInteger(seed) && seed >= 1 && seed <= MAX_UINT32;
}

const isLimit = (value: number | null | undefined) => value == null || (Number.isInteger(value) && value >= 1 && value <= MAX_LIMIT);
const isMinute = (value: number) => Number.isSafeInteger(value) && value % MINUTE_MS === 0;

function validate(input: StartDrawInput) {
  if (!isValidStartDrawSeed(input.seed)) throw new StartDrawError("INVALID_SEED", "Ogiltigt slumpfrö");
  if (!isMinute(input.firstStartMs)) throw new StartDrawError("INVALID_FIRST_START", "Första start måste vara en hel minut");
  const rules = input.rules ?? {};
  if (rules.groupControls !== undefined && (!Number.isInteger(rules.groupControls) || rules.groupControls < 1 || rules.groupControls > 3) ||
    !isLimit(rules.maxPerMinute) || !isLimit(rules.maxPerMinutePerPen) || (rules.lastStartMs != null && !isMinute(rules.lastStartMs))) {
    throw new StartDrawError("INVALID_RULES", "Ogiltiga regler för lottningen");
  }
  const classIds = new Set<string>();
  const entryIds = new Set<string>();
  for (const raceClass of input.classes) {
    if (classIds.has(raceClass.classId)) throw new StartDrawError("DUPLICATE", "Samma klass förekommer två gånger");
    classIds.add(raceClass.classId);
    const vacancies = raceClass.vacancies;
    const later = raceClass.laterStart;
    if (!Number.isInteger(raceClass.intervalMinutes) || raceClass.intervalMinutes < 1 || raceClass.intervalMinutes > MAX_INTERVAL_MINUTES ||
      !Number.isInteger(vacancies.value) || vacancies.value < 0 || vacancies.value > (vacancies.kind === "COUNT" ? 1_000 : 100) ||
      (later && (later.kind === "CLOCK" ? !isMinute(later.startMs)
        : !Number.isInteger(later.minutes) || later.minutes < 0 || later.minutes > MAX_OFFSET_MINUTES))) {
      throw new StartDrawError("INVALID_CLASS", "Ogiltigt intervall, antal vakanser eller senare start");
    }
    for (const runner of raceClass.runners) {
      if (entryIds.has(runner.entryId)) throw new StartDrawError("DUPLICATE", "Samma löpare förekommer två gånger");
      if (runner.seedRank != null && (!Number.isInteger(runner.seedRank) || runner.seedRank < 1 || runner.seedRank > MAX_SEED_RANK)) {
        throw new StartDrawError("INVALID_CLASS", "Ogiltig seedning");
      }
      entryIds.add(runner.entryId);
    }
  }
  for (const existing of input.existing ?? []) {
    if (classIds.has(existing.classId)) throw new StartDrawError("DUPLICATE", "Klassen lottas och har samtidigt befintliga tider");
    classIds.add(existing.classId);
  }
  if (entryIds.size > MAX_ENTRIES) throw new StartDrawError("TOO_LARGE", "För många löpare");
}

/** Union–find över klasser och nycklar (kontrollföljder eller första kontroll). */
class Union {
  private readonly parent = new Map<string, string>();
  find(node: string): string {
    let root = node;
    while (this.parent.has(root) && this.parent.get(root) !== root) root = this.parent.get(root)!;
    if (!this.parent.has(root)) this.parent.set(root, root);
    let current = node;
    while (current !== root) { const next = this.parent.get(current) ?? root; this.parent.set(current, root); current = next; }
    return root;
  }
  union(a: string, b: string) {
    const rootA = this.find(a), rootB = this.find(b);
    if (rootA !== rootB) this.parent.set(rootA < rootB ? rootB : rootA, rootA < rootB ? rootA : rootB);
  }
}

/** Startgruppens nycklar: varje variants första `count` kontroller. */
const groupKeys = (controls: readonly (readonly number[])[], count: number) =>
  [...new Set(controls.filter(codes => codes.length > 0).map(codes => codes.slice(0, count).join(",")))];
const penKeys = (controls: readonly (readonly number[])[]) =>
  [...new Set(controls.filter(codes => codes.length > 0).map(codes => String(codes[0])))];

type Planned = { raceClass: StartDrawClass; order: (string | null)[] };

/** Ordningen i klassen: blandad, klubbseparerad, seedad och med vakanser. Masstart har ingen ordning att lotta. */
function planOrder(raceClass: StartDrawClass, input: StartDrawInput): Planned {
  if (raceClass.method === "MASS") {
    return { raceClass, order: [...raceClass.runners].map(runner => runner.entryId).sort() };
  }
  const runners = runnerOrder(raceClass.runners, { random: classRandom(input.seed, raceClass.classId),
    clubSeparation: input.clubSeparation, seeding: input.rules?.seeding ?? "LAST" });
  const vacancies = vacancyCount(runners.length, raceClass.vacancies);
  const total = runners.length + vacancies;
  const vacant = new Set(vacancyPositions(total, vacancies));
  const order: (string | null)[] = [];
  let next = 0;
  for (let position = 0; position < total; position += 1) order.push(vacant.has(position) ? null : runners[next++]!.entryId);
  return { raceClass, order };
}

/** Minuter (räknat från första start) som klassen upptar med förskjutningen `offset`. */
function minutesAt(planned: Planned, offset: number): number[] {
  if (planned.raceClass.method === "MASS") return [offset];
  const count = Math.max(planned.order.length, 1);
  return Array.from({ length: count }, (_, index) => offset + index * planned.raceClass.intervalMinutes);
}

const compareIds = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
const add = (counts: Map<number, number>, minute: number) => counts.set(minute, (counts.get(minute) ?? 0) + 1);

/** Var startgruppernas och fållornas minuter och antal per minut hålls under lottningen. */
class Occupancy {
  readonly busy = new Map<string, Map<number, Set<string>>>();
  readonly pens = new Map<string, Map<number, number>>();
  readonly total = new Map<number, number>();
  constructor(private readonly penLimit: number | null, private readonly totalLimit: number | null) {}
  fits(minutes: readonly number[], group: string, pens: readonly string[]): boolean {
    const busy = this.busy.get(group);
    return minutes.every(minute => !busy?.has(minute) &&
      (this.totalLimit === null || (this.total.get(minute) ?? 0) < this.totalLimit) &&
      (this.penLimit === null || pens.every(pen => (this.pens.get(pen)?.get(minute) ?? 0) < this.penLimit!)));
  }
  occupy(minutes: readonly number[], classId: string, group: string, pens: readonly string[]) {
    const busy = this.busy.get(group) ?? new Map<number, Set<string>>();
    this.busy.set(group, busy);
    for (const minute of minutes) {
      busy.set(minute, (busy.get(minute) ?? new Set()).add(classId));
      add(this.total, minute);
      for (const pen of pens) { const counts = this.pens.get(pen) ?? new Map<number, number>(); this.pens.set(pen, counts); add(counts, minute); }
    }
  }
}

/** Sammanfattar minuter som bryter en regel: första minuten och antalet. */
function summarize(minutes: readonly number[], firstStartMs: number) {
  const sorted = [...new Set(minutes)].sort((a, b) => a - b);
  return { firstMs: firstStartMs + sorted[0]! * MINUTE_MS, minuteCount: sorted.length };
}

export function drawStartTimes(input: StartDrawInput): StartDrawResult {
  validate(input);
  const rules = input.rules ?? {};
  const groupControls = rules.groupControls ?? 1;
  const planned = input.classes.map(raceClass => planOrder(raceClass, input));
  const existing = input.existing ?? [];

  // Startgrupper och fållor över både klasser som lottas och klasser med befintliga tider.
  const groups = new Union(), pens = new Union();
  const all = [...input.classes.map(row => ({ classId: row.classId, startControls: row.startControls })), ...existing];
  for (const row of all) {
    groups.find(`class:${row.classId}`); pens.find(`class:${row.classId}`);
    for (const key of groupKeys(row.startControls, groupControls)) groups.union(`class:${row.classId}`, `key:${key}`);
    for (const key of penKeys(row.startControls)) pens.union(`class:${row.classId}`, `pen:${key}`);
  }
  const groupOf = (classId: string) => groups.find(`class:${classId}`);
  const pensOf = (row: { classId: string; startControls: readonly (readonly number[])[] }) =>
    penKeys(row.startControls).length === 0 ? [] : [pens.find(`class:${row.classId}`)];

  const occupancy = new Occupancy(rules.maxPerMinutePerPen ?? null, rules.maxPerMinute ?? null);
  const warnings: StartDrawWarning[] = [];
  for (const row of existing) {
    const minutes = [...new Set(row.startTimesMs.map(time => Math.floor((time - input.firstStartMs) / MINUTE_MS)))];
    occupancy.occupy(minutes, row.classId, groupOf(row.classId), pensOf(row));
  }
  // Befintliga tider som redan bryter mot reglerna (t.ex. efter att fler kontroller börjat avgöra startgruppen).
  for (const busy of occupancy.busy.values()) {
    const clashes = [...busy].filter(([, classIds]) => classIds.size > 1);
    if (clashes.length === 0) continue;
    warnings.push({ code: "EXISTING_GROUP_CLASH", classIds: [...new Set(clashes.flatMap(([, ids]) => [...ids]))].sort(compareIds),
      ...summarize(clashes.map(([minute]) => minute), input.firstStartMs) });
  }
  if (rules.maxPerMinute != null) {
    const over = [...occupancy.total].filter(([, count]) => count > rules.maxPerMinute!).map(([minute]) => minute);
    if (over.length > 0) warnings.push({ code: "EXISTING_OVER_LIMIT", scope: "TOTAL", limit: rules.maxPerMinute, ...summarize(over, input.firstStartMs) });
  }
  if (rules.maxPerMinutePerPen != null) {
    const over = [...occupancy.pens.values()].flatMap(counts => [...counts].filter(([, count]) => count > rules.maxPerMinutePerPen!)
      .map(([minute]) => minute));
    if (over.length > 0) warnings.push({ code: "EXISTING_OVER_LIMIT", scope: "PEN", limit: rules.maxPerMinutePerPen, ...summarize(over, input.firstStartMs) });
  }

  // Ordningen klasserna placeras i: senare start först (tidigast först), sedan egen ordning eller den automatiska.
  const wanted = new Map(planned.map(({ raceClass }) => {
    const later = raceClass.laterStart;
    if (!later) return [raceClass.classId, null];
    return [raceClass.classId, later.kind === "OFFSET" ? later.minutes : (later.startMs - input.firstStartMs) / MINUTE_MS];
  }));
  const custom = new Map((rules.classOrder ?? []).map((classId, index) => [classId, index]));
  const automatic = (a: Planned, b: Planned) =>
    (a.raceClass.method === "MASS" ? 0 : 1) - (b.raceClass.method === "MASS" ? 0 : 1) ||
    b.order.length - a.order.length || a.raceClass.name.localeCompare(b.raceClass.name, "sv-SE") ||
    compareIds(a.raceClass.classId, b.raceClass.classId);
  const ordered = [...planned].sort((a, b) => {
    const wantA = wanted.get(a.raceClass.classId), wantB = wanted.get(b.raceClass.classId);
    if ((wantA === null) !== (wantB === null)) return wantA === null ? 1 : -1;
    if (wantA !== null && wantB !== null && wantA !== wantB) return wantA! - wantB!;
    if (rules.classOrder) {
      const orderA = custom.get(a.raceClass.classId) ?? Number.MAX_SAFE_INTEGER, orderB = custom.get(b.raceClass.classId) ?? Number.MAX_SAFE_INTEGER;
      if (orderA !== orderB) return orderA - orderB;
    }
    return automatic(a, b);
  });

  const offsets = new Map<string, number>();
  for (const item of ordered) {
    const { classId } = item.raceClass;
    const want = wanted.get(classId) ?? null;
    let offset = Math.max(want ?? 0, 0);
    const group = groupOf(classId), itemPens = pensOf(item.raceClass);
    while (!occupancy.fits(minutesAt(item, offset), group, itemPens)) {
      offset += 1;
      if (offset > MAX_OFFSET_MINUTES) throw new StartDrawError("TOO_LARGE", "Startgruppen får inte plats");
    }
    // En tom klass utan vakanser upptar ingen minut men får ändå en första start.
    if (item.order.length > 0) occupancy.occupy(minutesAt(item, offset), classId, group, itemPens);
    offsets.set(classId, offset);
    if (want !== null && want !== offset) {
      warnings.push({ code: "LATER_START_MOVED", classId, wantedMs: input.firstStartMs + want * MINUTE_MS,
        actualMs: input.firstStartMs + offset * MINUTE_MS });
    }
  }

  const classes = planned.map(({ raceClass, order }): StartDrawClassResult => {
    const firstStartMs = input.firstStartMs + offsets.get(raceClass.classId)! * MINUTE_MS;
    const step = raceClass.intervalMinutes * MINUTE_MS;
    return { classId: raceClass.classId, method: raceClass.method, firstStartMs, intervalMinutes: raceClass.intervalMinutes,
      vacancyCount: order.filter(entryId => entryId === null).length,
      slots: order.map((entryId, index) => ({ entryId, startMs: raceClass.method === "MASS" ? firstStartMs : firstStartMs + index * step })) };
  });

  if (rules.lastStartMs != null) {
    const late = classes.flatMap(row => {
      const after = row.slots.filter(slot => slot.startMs > rules.lastStartMs!).map(slot => slot.startMs);
      return after.length === 0 ? [] : [{ classId: row.classId, first: Math.min(...after), last: Math.max(...after) }];
    }).sort((a, b) => a.first - b.first || compareIds(a.classId, b.classId));
    if (late.length > 0) {
      warnings.push({ code: "AFTER_LAST_START", classIds: late.map(row => row.classId), firstAfterMs: late[0]!.first,
        neededLastStartMs: Math.max(...late.map(row => row.last)) });
    }
  }

  return { classes, groups: startGroups(planned, existing, groupControls, groupOf), warnings };
}

/** Startgrupper med minst två klasser, i den ordning de lottade klasserna kommer, med de delade kontrollerna. */
function startGroups(planned: readonly Planned[], existing: readonly StartDrawExistingClass[], count: number,
  groupOf: (classId: string) => string): StartDrawGroup[] {
  const members = new Map<string, { drawn: string[]; others: string[]; keys: Map<string, number> }>();
  const note = (classId: string, controls: readonly (readonly number[])[], drawn: boolean) => {
    const keys = groupKeys(controls, count);
    if (keys.length === 0) return;
    const group = members.get(groupOf(classId)) ?? { drawn: [], others: [], keys: new Map<string, number>() };
    members.set(groupOf(classId), group);
    (drawn ? group.drawn : group.others).push(classId);
    for (const key of keys) group.keys.set(key, (group.keys.get(key) ?? 0) + 1);
  };
  for (const { raceClass } of planned) note(raceClass.classId, raceClass.startControls, true);
  for (const row of existing) note(row.classId, row.startControls, false);
  return [...members.values()].filter(group => group.drawn.length > 0 && group.drawn.length + group.others.length > 1).map(group => {
    const [key] = [...group.keys].sort((a, b) => b[1] - a[1] || compareIds(a[0], b[0]))[0]!;
    return { controlCodes: key.split(",").map(Number), classIds: [...group.drawn, ...group.others.sort(compareIds)] };
  });
}

export interface LateEntryPlacementInput {
  readonly method: StartDrawMethod;
  readonly firstStartMs: number;
  readonly intervalMinutes: number;
  /** Klassens lottade tider (även vakanta). */
  readonly slotTimesMs: readonly number[];
  /** Tider som löpare i klassen har just nu. */
  readonly classTimesMs: readonly number[];
  /** Tider som andra klasser i samma startfålla använder (löpare och vakanser). */
  readonly groupTimesMs: readonly number[];
  readonly nowMs: number;
}

/**
 * Efteranmäld i en lottad klass: masstart får klassens tid. Minutstart får första
 * lediga vakanta tid efter nu, annars första lediga minut efter klassens sista
 * start (med klassens intervall) som ingen annan klass i startfållan använder.
 */
export function placeLateEntry(input: LateEntryPlacementInput): number {
  if (input.method === "MASS") return input.firstStartMs;
  const taken = new Set(input.classTimesMs);
  const vacant = [...input.slotTimesMs].sort((a, b) => a - b).find(time => time > input.nowMs && !taken.has(time));
  if (vacant !== undefined) return vacant;
  const step = input.intervalMinutes * MINUTE_MS;
  const groupMinutes = new Set(input.groupTimesMs.map(time => Math.floor(time / MINUTE_MS)));
  const last = Math.max(...input.slotTimesMs, ...input.classTimesMs, input.firstStartMs - step);
  let candidate = last + step;
  if (candidate <= input.nowMs) candidate += Math.ceil((input.nowMs - candidate + 1) / step) * step;
  for (let attempt = 0; attempt < MAX_OFFSET_MINUTES; attempt += 1) {
    if (!taken.has(candidate) && !groupMinutes.has(Math.floor(candidate / MINUTE_MS))) return candidate;
    candidate += step;
  }
  throw new StartDrawError("TOO_LARGE", "Ingen ledig starttid hittades");
}

/**
 * Ögonblicksbilden som resultatmotorn ska pröva avläsningarna mot när lottningen
 * sparas: klassernas startsätt och löparnas nya fasta starttider (null tar bort tiden).
 */
export function withProposedStartTimes(snapshot: RaceSnapshot, proposed: {
  readonly classes: readonly { readonly classId: string; readonly startRule: "FIXED" | "PUNCH" }[];
  readonly entryTimes: ReadonlyMap<string, string | null>;
}): RaceSnapshot {
  const rules = new Map(proposed.classes.map(row => [row.classId, row.startRule]));
  return {
    ...snapshot,
    classes: snapshot.classes.map(raceClass => rules.has(raceClass.id) ? { ...raceClass, startRule: rules.get(raceClass.id)! } : raceClass),
    entries: snapshot.entries.map(entry => {
      if (!proposed.entryTimes.has(entry.id)) return entry;
      const time = proposed.entryTimes.get(entry.id)!;
      const rest = { ...entry };
      delete (rest as { fixedStartTime?: string }).fixedStartTime;
      return time === null ? rest : { ...rest, fixedStartTime: time };
    })
  };
}
