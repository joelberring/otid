import type { RaceSnapshot } from "./types";

/**
 * Lottning av starttider (PLAN.md steg 9). Ren och deterministisk: samma
 * underlag och samma slumpfrö ger alltid samma starttider.
 *
 * - Lottad minutstart: löparna blandas med fröet och får var sin tid med
 *   klassens intervall. Vakanser sprids jämnt i klassen.
 * - Masstart: alla löpare i klassen får samma tid.
 * - Klubbseparering: två löpare från samma klubb startar inte efter varandra
 *   när det går att undvika.
 * - Startfållor: klasser vars banor har samma första kontroll startar aldrig
 *   samma minut. Klasserna packas så att fållan blir klar så tidigt som möjligt
 *   (masstarter först, sedan största klassen först, första lediga förskjutning).
 *   Olika fållor startar parallellt från första start.
 */
export type StartDrawMethod = "MINUTE" | "MASS";

export type StartDrawVacancies =
  | { readonly kind: "COUNT"; readonly value: number }
  | { readonly kind: "PERCENT"; readonly value: number };

export interface StartDrawRunner {
  readonly entryId: string;
  readonly club: string | null;
}

export interface StartDrawClass {
  readonly classId: string;
  readonly name: string;
  /** Kod för banans första kontroll. Klasser med samma kod hör till samma startfålla. */
  readonly firstControlCode: number | null;
  readonly method: StartDrawMethod;
  readonly intervalMinutes: number;
  readonly vacancies: StartDrawVacancies;
  readonly runners: readonly StartDrawRunner[];
}

export interface StartDrawInput {
  readonly seed: number;
  readonly firstStartMs: number;
  readonly clubSeparation: boolean;
  readonly classes: readonly StartDrawClass[];
  /** Starttider som redan används av klasser som inte lottas nu, per första kontroll. */
  readonly occupied?: readonly { readonly classId: string; readonly firstControlCode: number; readonly startMs: number }[];
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
  readonly firstControlCode: number;
  readonly classIds: readonly string[];
}

export interface StartDrawResult {
  readonly classes: readonly StartDrawClassResult[];
  /** Startfållor med minst två klasser: först de som lottas nu, sedan klasser som redan har tider. */
  readonly groups: readonly StartDrawGroup[];
}

export type StartDrawErrorCode = "INVALID_SEED" | "INVALID_FIRST_START" | "INVALID_CLASS" | "DUPLICATE" | "TOO_LARGE";

export class StartDrawError extends Error {
  readonly code: StartDrawErrorCode;
  constructor(code: StartDrawErrorCode, message: string) {
    super(message);
    this.name = "StartDrawError";
    this.code = code;
  }
}

const MINUTE_MS = 60_000;
const MAX_UINT32 = 4_294_967_295;
const MAX_INTERVAL_MINUTES = 60;
const MAX_ENTRIES = 10_000;
const MAX_OFFSET_MINUTES = 7 * 24 * 60;

export function isValidStartDrawSeed(seed: number): boolean {
  return Number.isSafeInteger(seed) && seed >= 1 && seed <= MAX_UINT32;
}

function nextXorshift32(state: number): number {
  let next = state >>> 0;
  next ^= next << 13; next >>>= 0;
  next ^= next >>> 17; next >>>= 0;
  next ^= next << 5;
  return next >>> 0;
}

/** Slumptalsgenerator med fröet; ger heltal i [0, bound) utan skevhet. */
function createRandom(seed: number) {
  let state = seed >>> 0;
  return (bound: number): number => {
    const limit = Math.floor(MAX_UINT32 / bound) * bound;
    let value: number;
    do { state = nextXorshift32(state); value = state - 1; } while (value >= limit);
    return value % bound;
  };
}

function shuffle<T>(items: readonly T[], random: (bound: number) => number): T[] {
  const result = [...items];
  for (let last = result.length - 1; last > 0; last -= 1) {
    const pick = random(last + 1);
    const value = result[last]!;
    result[last] = result[pick]!;
    result[pick] = value;
  }
  return result;
}

function clubKey(club: string | null): string | null {
  const value = club?.trim().toLocaleLowerCase("sv-SE") ?? "";
  return value === "" ? null : value;
}

/**
 * Klubbseparering efter blandningen: väljer i blandad ordning nästa löpare vars
 * klubb skiljer sig från föregående. Om en klubb har fler kvar än alla andra
 * tillsammans måste den läggas först, annars blir den stående sist. Löpare utan
 * klubb krockar aldrig.
 */
export function separateClubs(runners: readonly StartDrawRunner[]): StartDrawRunner[] {
  const remaining = [...runners];
  const result: StartDrawRunner[] = [];
  let previous: string | null = null;
  while (remaining.length > 0) {
    const counts = new Map<string, number>();
    for (const runner of remaining) {
      const key = clubKey(runner.club);
      if (key !== null) counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    let largest: string | null = null;
    let largestCount = 0;
    for (const runner of remaining) {
      const key = clubKey(runner.club);
      if (key !== null && counts.get(key)! > largestCount) { largest = key; largestCount = counts.get(key)!; }
    }
    let index = -1;
    if (largest !== null && largest !== previous && largestCount > remaining.length - largestCount) {
      index = remaining.findIndex(runner => clubKey(runner.club) === largest);
    }
    if (index < 0) index = remaining.findIndex(runner => clubKey(runner.club) === null || clubKey(runner.club) !== previous);
    if (index < 0) index = 0; // Bara samma klubb kvar: går inte att undvika.
    const [picked] = remaining.splice(index, 1);
    result.push(picked!);
    previous = clubKey(picked!.club);
  }
  return result;
}

/** Antal vakanser i klassen. Procent avrundas uppåt så att en vakans begärd i procent alltid blir minst en. */
export function vacancyCount(runnerCount: number, vacancies: StartDrawVacancies): number {
  if (vacancies.kind === "COUNT") return vacancies.value;
  return vacancies.value === 0 ? 0 : Math.ceil(runnerCount * vacancies.value / 100);
}

/** Positioner (0-baserade) för vakanserna bland `total` tider: jämnt spridda, aldrig alla sist. */
export function vacancyPositions(total: number, vacancies: number): number[] {
  const positions: number[] = [];
  for (let index = 0; index < vacancies; index += 1) positions.push(Math.floor((2 * index + 1) * total / (2 * vacancies)));
  return positions;
}

function validate(input: StartDrawInput) {
  if (!isValidStartDrawSeed(input.seed)) throw new StartDrawError("INVALID_SEED", "Ogiltigt slumpfrö");
  if (!Number.isSafeInteger(input.firstStartMs) || input.firstStartMs % MINUTE_MS !== 0) {
    throw new StartDrawError("INVALID_FIRST_START", "Första start måste vara en hel minut");
  }
  const classIds = new Set<string>();
  const entryIds = new Set<string>();
  for (const raceClass of input.classes) {
    if (classIds.has(raceClass.classId)) throw new StartDrawError("DUPLICATE", "Samma klass förekommer två gånger");
    classIds.add(raceClass.classId);
    const vacancies = raceClass.vacancies;
    if (!Number.isInteger(raceClass.intervalMinutes) || raceClass.intervalMinutes < 1 || raceClass.intervalMinutes > MAX_INTERVAL_MINUTES ||
      !Number.isInteger(vacancies.value) || vacancies.value < 0 || vacancies.value > (vacancies.kind === "COUNT" ? 1_000 : 100)) {
      throw new StartDrawError("INVALID_CLASS", "Ogiltigt intervall eller antal vakanser");
    }
    for (const runner of raceClass.runners) {
      if (entryIds.has(runner.entryId)) throw new StartDrawError("DUPLICATE", "Samma löpare förekommer två gånger");
      entryIds.add(runner.entryId);
    }
  }
  if (entryIds.size > MAX_ENTRIES) throw new StartDrawError("TOO_LARGE", "För många löpare");
}

type Planned = { raceClass: StartDrawClass; order: (string | null)[] };

/** Ordningen i klassen: blandad, klubbseparerad och med vakanser. Masstart har ingen ordning att lotta. */
function planOrder(raceClass: StartDrawClass, input: StartDrawInput): Planned {
  // Varje klass får en egen ström ur fröet så att en klass lottning inte beror på andra klassers storlek.
  let classSeed = input.seed;
  for (const character of raceClass.classId) classSeed = (Math.imul(classSeed ^ character.charCodeAt(0), 2_654_435_761) >>> 0) || 1;
  const random = createRandom(classSeed);
  const sorted = [...raceClass.runners].sort((a, b) => a.entryId < b.entryId ? -1 : a.entryId > b.entryId ? 1 : 0);
  if (raceClass.method === "MASS") return { raceClass, order: sorted.map(runner => runner.entryId) };
  const shuffled = shuffle(sorted, random);
  const runners = input.clubSeparation ? separateClubs(shuffled) : shuffled;
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

function placeGroup(planned: readonly Planned[], busy: Set<number>): Map<string, number> {
  const ordered = [...planned].sort((a, b) =>
    (a.raceClass.method === "MASS" ? 0 : 1) - (b.raceClass.method === "MASS" ? 0 : 1) ||
    b.order.length - a.order.length || a.raceClass.name.localeCompare(b.raceClass.name, "sv-SE") ||
    (a.raceClass.classId < b.raceClass.classId ? -1 : a.raceClass.classId > b.raceClass.classId ? 1 : 0));
  const offsets = new Map<string, number>();
  for (const item of ordered) {
    let offset = 0;
    while (minutesAt(item, offset).some(minute => busy.has(minute))) {
      offset += 1;
      if (offset > MAX_OFFSET_MINUTES) throw new StartDrawError("TOO_LARGE", "Startfållan får inte plats");
    }
    // En tom klass utan vakanser upptar ingen minut men får ändå en första start.
    if (item.order.length > 0) for (const minute of minutesAt(item, offset)) busy.add(minute);
    offsets.set(item.raceClass.classId, offset);
  }
  return offsets;
}

export function drawStartTimes(input: StartDrawInput): StartDrawResult {
  validate(input);
  const planned = input.classes.map(raceClass => planOrder(raceClass, input));
  const groups = new Map<string, Planned[]>();
  for (const item of planned) {
    const key = item.raceClass.firstControlCode === null ? `class:${item.raceClass.classId}` : `code:${item.raceClass.firstControlCode}`;
    groups.set(key, [...groups.get(key) ?? [], item]);
  }
  const occupiedByCode = new Map<number, Set<number>>();
  const occupiedClasses = new Map<number, Set<string>>();
  for (const row of input.occupied ?? []) {
    occupiedClasses.set(row.firstControlCode, (occupiedClasses.get(row.firstControlCode) ?? new Set()).add(row.classId));
    const minute = Math.floor((row.startMs - input.firstStartMs) / MINUTE_MS);
    if (minute < 0) continue;
    const set = occupiedByCode.get(row.firstControlCode) ?? new Set<number>();
    set.add(minute);
    occupiedByCode.set(row.firstControlCode, set);
  }
  const offsets = new Map<string, number>();
  const resultGroups: StartDrawGroup[] = [];
  for (const items of groups.values()) {
    const code = items[0]!.raceClass.firstControlCode;
    const busy = new Set(code === null ? [] : occupiedByCode.get(code) ?? []);
    for (const [classId, offset] of placeGroup(items, busy)) offsets.set(classId, offset);
    const others = code === null ? [] : [...occupiedClasses.get(code) ?? []].filter(id => !items.some(item => item.raceClass.classId === id));
    if (code !== null && items.length + others.length > 1) {
      resultGroups.push({ firstControlCode: code, classIds: [...items.map(item => item.raceClass.classId), ...others.sort()] });
    }
  }
  return {
    groups: resultGroups,
    classes: planned.map(({ raceClass, order }) => {
      const firstStartMs = input.firstStartMs + offsets.get(raceClass.classId)! * MINUTE_MS;
      const step = raceClass.intervalMinutes * MINUTE_MS;
      return { classId: raceClass.classId, method: raceClass.method, firstStartMs, intervalMinutes: raceClass.intervalMinutes,
        vacancyCount: order.filter(entryId => entryId === null).length,
        slots: order.map((entryId, index) => ({ entryId, startMs: raceClass.method === "MASS" ? firstStartMs : firstStartMs + index * step })) };
    })
  };
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
