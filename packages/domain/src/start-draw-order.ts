import { createRandom, shuffle } from "./seeded-random";

/**
 * Ordningen inom en klass i lottningen (PLAN.md steg 9 och 26): blandning med fröet,
 * klubbseparering, vakanser och seedade löpare.
 */
export type StartDrawVacancies =
  | { readonly kind: "COUNT"; readonly value: number }
  | { readonly kind: "PERCENT"; readonly value: number };

/** Seedade löpare: sist i klassen (bäst sist) eller jämnt utspridda (bäst sist). */
export type StartDrawSeeding = "LAST" | "SPREAD";

export interface StartDrawRunner {
  readonly entryId: string;
  readonly club: string | null;
  /** Seedning: 1 = bäst. Seedade lottas efter de oseedade (eller jämnt utspridda) med bäst sist. */
  readonly seedRank?: number | null;
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

/**
 * Positioner (0-baserade) för `seeded` seedade bland `total` löpare när de sprids jämnt: lika långt mellan dem
 * och den bästa sist, t.ex. 3 av 9 på plats 3, 6 och 9.
 */
export function seededPositions(total: number, seeded: number): number[] {
  return Array.from({ length: seeded }, (_, index) => Math.floor((index + 1) * total / seeded) - 1);
}

const byEntryId = (a: StartDrawRunner, b: StartDrawRunner) => a.entryId < b.entryId ? -1 : a.entryId > b.entryId ? 1 : 0;

/** Ett eget slumpfrö per klass, så att en klass lottning inte beror på andra klassers storlek. */
export function classRandom(seed: number, classId: string) {
  let classSeed = seed;
  for (const character of classId) classSeed = (Math.imul(classSeed ^ character.charCodeAt(0), 2_654_435_761) >>> 0) || 1;
  return createRandom(classSeed);
}

/**
 * Löparna i startordning (utan vakanser): de oseedade blandade (och klubbseparerade), de seedade sist
 * med bäst rank sist, eller jämnt utspridda bland de andra med bäst rank sist.
 */
export function runnerOrder(runners: readonly StartDrawRunner[], options: {
  readonly random: (bound: number) => number; readonly clubSeparation: boolean; readonly seeding: StartDrawSeeding;
}): StartDrawRunner[] {
  const sorted = [...runners].sort(byEntryId);
  const seeded = sorted.filter(runner => runner.seedRank != null)
    // Sämst rank först, bäst sist; lika rank ordnas efter id så att lottningen är deterministisk.
    .sort((a, b) => b.seedRank! - a.seedRank! || byEntryId(a, b));
  const shuffled = shuffle(sorted.filter(runner => runner.seedRank == null), options.random);
  const free = options.clubSeparation ? separateClubs(shuffled) : shuffled;
  if (seeded.length === 0) return free;
  if (options.seeding === "LAST") return [...free, ...seeded];
  const total = free.length + seeded.length;
  const positions = new Set(seededPositions(total, seeded.length));
  const order: StartDrawRunner[] = [];
  let nextFree = 0, nextSeeded = 0;
  for (let position = 0; position < total; position += 1) order.push(positions.has(position) ? seeded[nextSeeded++]! : free[nextFree++]!);
  return order;
}
