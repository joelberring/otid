import { createRandom, shuffle } from "./seeded-random";
import type { CourseLegPoint } from "./course-variants";

/**
 * Gafflad stafett (steg 47, ADR-0174). En stafettgaffling är rättvis när alla lag totalt, över sina
 * sträckor, springer samma uppsättning kontrollsträckor (start–kontroll, kontroll–kontroll,
 * kontroll–mål). Varje sträcka kan ha egen bana; sträckor med samma gafflade bana bildar en grupp och
 * lagets varianter i gruppen ska tillsammans täcka gruppens sträckor lika många gånger som för alla
 * andra lag.
 *
 * - `EVEN` (utjämnad gaffling, förval): fördelningen väljer för varje lag en rättvis kombination av
 *   varianter (de kombinationer vars kontrollsträckor tillsammans är exakt gruppens genomsnitt) och
 *   lägger dem på sträckorna så att varje variant används så jämnt som möjligt per sträcka. Finns ingen
 *   rättvis kombination (t.ex. en enda sträcka på en bana med olika varianter) sprids varianterna som
 *   för fulgaffling, och kontrollen per lag varnar.
 * - `UNEVEN` (fulgaffling): varianterna behöver inte vara likvärdiga. De sprids jämnt per sträcka och
 *   över lagen (samma lag får helst olika varianter), och kontrollen per lag är bara en upplysning.
 *
 * Allt är deterministiskt med fröet. Fördelningen är stegvis: ett nytt lag får sina varianter utifrån
 * hur de befintliga lagen redan har dem, så att efteranmälda lag också fördelas jämnt.
 */
export type RelayForkingMode = "EVEN" | "UNEVEN";

export interface RelayVariantCourse {
  readonly code: string;
  readonly controlCodes: readonly number[];
}

export interface RelayLegCourse {
  readonly leg: number;
  /** Banan som sträckan springer (sträckans egen eller klassens). */
  readonly courseKey: string;
  /** Banans varianter i visningsordning; tom = inte gafflad. */
  readonly variants: readonly RelayVariantCourse[];
  /** Sträckans bestämda variant (alla lag springer den). */
  readonly fixedVariant?: string;
}

const MAX_COMBINATIONS = 5_000;
const MAX_SEARCH_STEPS = 200_000;
const MAX_PERMUTED_LEGS = 7;

function pairKey(from: CourseLegPoint, to: CourseLegPoint) {
  return `${from}>${to}`;
}

/** Kontrollsträckorna i en kontrollföljd, med start och mål. */
export function courseLegPairs(controlCodes: readonly number[]): string[] {
  const points: CourseLegPoint[] = ["START", ...controlCodes, "FINISH"];
  const pairs: string[] = [];
  for (let index = 1; index < points.length; index += 1) pairs.push(pairKey(points[index - 1]!, points[index]!));
  return pairs;
}

function countPairs(pairs: readonly string[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const pair of pairs) counts.set(pair, (counts.get(pair) ?? 0) + 1);
  return counts;
}

interface Group {
  readonly courseKey: string;
  readonly legs: readonly number[];
  readonly variants: readonly RelayVariantCourse[];
}

function groupsOf(legs: readonly RelayLegCourse[]): Group[] {
  const groups = new Map<string, { legs: number[]; variants: readonly RelayVariantCourse[] }>();
  for (const leg of [...legs].sort((left, right) => left.leg - right.leg)) {
    if (leg.variants.length === 0) continue;
    if (leg.fixedVariant !== undefined && leg.variants.some((variant) => variant.code === leg.fixedVariant)) continue;
    const group = groups.get(leg.courseKey) ?? { legs: [], variants: leg.variants };
    group.legs.push(leg.leg);
    groups.set(leg.courseKey, group);
  }
  return [...groups].sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
    .map(([courseKey, group]) => ({ courseKey, ...group }));
}

/**
 * Rättvisa kombinationer (multimängder av variantindex) för en grupp med `k` sträckor: summan av
 * kombinationens kontrollsträckor är exakt k/v gånger alla varianters summa. Tom lista när det inte går.
 */
export function fairRelayCombinations(variants: readonly RelayVariantCourse[], legCount: number): number[][] {
  const variantPairs = variants.map((variant) => countPairs(courseLegPairs(variant.controlCodes)));
  const total = new Map<string, number>();
  for (const pairs of variantPairs) for (const [pair, count] of pairs) total.set(pair, (total.get(pair) ?? 0) + count);
  const target = new Map<string, number>();
  for (const [pair, count] of total) {
    const value = (count * legCount) / variants.length;
    if (!Number.isInteger(value)) return [];
    target.set(pair, value);
  }
  const result: number[][] = [];
  const current = new Map<string, number>();
  const chosen: number[] = [];
  let steps = 0;
  const search = (from: number): boolean => {
    if (++steps > MAX_SEARCH_STEPS || result.length >= MAX_COMBINATIONS) return false;
    if (chosen.length === legCount) {
      for (const [pair, count] of target) if ((current.get(pair) ?? 0) !== count) return true;
      result.push([...chosen]);
      return true;
    }
    for (let index = from; index < variants.length; index += 1) {
      let fits = true;
      for (const [pair, count] of variantPairs[index]!) {
        const next = (current.get(pair) ?? 0) + count;
        current.set(pair, next);
        if (next > target.get(pair)!) fits = false;
      }
      chosen.push(index);
      const go = fits ? search(index) : true;
      chosen.pop();
      for (const [pair, count] of variantPairs[index]!) current.set(pair, current.get(pair)! - count);
      if (!go) return false;
    }
    return true;
  };
  search(0);
  return result;
}

/** Alla olika ordningar av en multimängd (för få sträckor). */
function permutations(items: readonly number[]): number[][] {
  if (items.length <= 1) return [[...items]];
  const result: number[][] = [];
  const seen = new Set<number>();
  for (const [index, item] of items.entries()) {
    if (seen.has(item)) continue;
    seen.add(item);
    const rest = [...items.slice(0, index), ...items.slice(index + 1)];
    for (const tail of permutations(rest)) result.push([item, ...tail]);
  }
  return result;
}

interface GroupUsage {
  /** Användning per sträcka och variantindex. */
  readonly perLeg: Map<number, number[]>;
  /** Användning per variantindex över gruppens sträckor. */
  readonly overall: number[];
}

function usageOf(group: Group, existing: readonly ReadonlyMap<number, string>[]): GroupUsage {
  const index = new Map(group.variants.map((variant, position) => [variant.code, position]));
  const perLeg = new Map(group.legs.map((leg) => [leg, group.variants.map(() => 0)]));
  const overall = group.variants.map(() => 0);
  for (const team of existing) {
    for (const leg of group.legs) {
      const position = index.get(team.get(leg) ?? "");
      if (position === undefined) continue;
      perLeg.get(leg)![position]! += 1;
      overall[position]! += 1;
    }
  }
  return { perLeg, overall };
}

/** Lägger kombinationen på gruppens sträckor så att varje variant används så jämnt som möjligt per sträcka. */
function placeCombination(group: Group, combination: readonly number[], usage: GroupUsage, rank: readonly number[]): number[] {
  const costOf = (order: readonly number[]) => order.reduce((sum, variant, position) => sum + usage.perLeg.get(group.legs[position]!)![variant]!, 0);
  if (combination.length <= MAX_PERMUTED_LEGS) {
    let best: { order: number[]; cost: number; tie: string } | undefined;
    for (const order of permutations(combination)) {
      const cost = costOf(order);
      const tie = order.map((variant) => String(rank[variant]!).padStart(4, "0")).join(",");
      if (!best || cost < best.cost || (cost === best.cost && tie < best.tie)) best = { order, cost, tie };
    }
    return best!.order;
  }
  const remaining = [...combination];
  return group.legs.map((leg) => {
    let pick = 0;
    for (let position = 1; position < remaining.length; position += 1) {
      const candidate = remaining[position]!, current = remaining[pick]!;
      const difference = usage.perLeg.get(leg)![candidate]! - usage.perLeg.get(leg)![current]!;
      if (difference < 0 || (difference === 0 && rank[candidate]! < rank[current]!)) pick = position;
    }
    return remaining.splice(pick, 1)[0]!;
  });
}

/** Fulgaffling (och reserv): per sträcka den minst använda varianten, helst en som laget inte redan har. */
function spreadVariants(group: Group, usage: GroupUsage, rank: readonly number[]): number[] {
  const own = group.variants.map(() => 0);
  return group.legs.map((leg) => {
    let pick = 0;
    const score = (variant: number) => [usage.perLeg.get(leg)![variant]!, own[variant]!, usage.overall[variant]!, rank[variant]!];
    for (let variant = 1; variant < group.variants.length; variant += 1) {
      const left = score(variant), right = score(pick);
      const index = left.findIndex((value, position) => value !== right[position]);
      if (index >= 0 && left[index]! < right[index]!) pick = variant;
    }
    own[pick]! += 1;
    return pick;
  });
}

/**
 * Varianterna per sträcka för ett nytt lag, givet de befintliga lagens varianter (samma klass).
 * Sträckor med bestämd variant får den; sträckor på en bana utan varianter får ingen.
 */
export function planRelayTeamVariants(input: {
  readonly seed: number;
  readonly legs: readonly RelayLegCourse[];
  readonly existing: readonly ReadonlyMap<number, string>[];
  readonly mode: RelayForkingMode;
}): Map<number, string> {
  const assigned = new Map<number, string>();
  for (const leg of input.legs) {
    if (leg.fixedVariant !== undefined && leg.variants.some((variant) => variant.code === leg.fixedVariant)) assigned.set(leg.leg, leg.fixedVariant);
  }
  const random = createRandom(input.seed);
  for (const group of groupsOf(input.legs)) {
    // Fröet ger en lottad variantordning och kombinationsordning per grupp; samma frö ger samma fördelning.
    const order = shuffle(group.variants.map((_, index) => index), random);
    const rank = group.variants.map(() => 0);
    order.forEach((variant, position) => { rank[variant] = position; });
    const usage = usageOf(group, input.existing);
    let placed: number[] | undefined;
    if (input.mode === "EVEN") {
      const combinations = shuffle(fairRelayCombinations(group.variants, group.legs.length), random);
      if (combinations.length > 0) {
        let best: { combination: number[]; score: number; position: number } | undefined;
        const offset = input.existing.length % combinations.length;
        for (let step = 0; step < combinations.length; step += 1) {
          const position = (offset + step) % combinations.length;
          const combination = combinations[position]!;
          // Jämnast användning: summan av kvadraterna på användningen efter laget (ger också olika varianter i laget).
          const added = new Map<number, number>();
          for (const variant of combination) added.set(variant, (added.get(variant) ?? 0) + 1);
          const score = [...added].reduce((sum, [variant, count]) => sum + (usage.overall[variant]! + count) ** 2 - usage.overall[variant]! ** 2, 0);
          if (!best || score < best.score) best = { combination, score, position };
        }
        placed = placeCombination(group, best!.combination, usage, rank);
      }
    }
    placed ??= spreadVariants(group, usage, rank);
    placed.forEach((variant, position) => assigned.set(group.legs[position]!, group.variants[variant]!.code));
  }
  return assigned;
}

/** Hela klassens fördelning för `teamCount` lag, lag för lag (samma som efteranmälan i tur och ordning). */
export function distributeRelayVariants(input: {
  readonly seed: number;
  readonly legs: readonly RelayLegCourse[];
  readonly teamCount: number;
  readonly mode: RelayForkingMode;
}): Map<number, string>[] {
  const teams: Map<number, string>[] = [];
  for (let team = 0; team < input.teamCount; team += 1) {
    teams.push(planRelayTeamVariants({ seed: input.seed, legs: input.legs, existing: teams, mode: input.mode }));
  }
  return teams;
}

export interface RelayFairnessTeam {
  readonly key: string;
  /** Lagets sträckor med kontrollföljden som laget springer (variant eller bana). */
  readonly legs: readonly { readonly leg: number; readonly controlCodes: readonly number[] }[];
}

export interface UnfairRelayTeam {
  readonly key: string;
  /** Kontrollsträckor som laget springer färre gånger än de flesta lag. */
  readonly missing: readonly { readonly from: CourseLegPoint; readonly to: CourseLegPoint }[];
  /** Kontrollsträckor som laget springer fler gånger än de flesta lag. */
  readonly extra: readonly { readonly from: CourseLegPoint; readonly to: CourseLegPoint }[];
}

function parsePair(pair: string): { from: CourseLegPoint; to: CourseLegPoint } {
  const [from, to] = pair.split(">") as [string, string];
  const point = (value: string): CourseLegPoint => value === "START" || value === "FINISH" ? value : Number(value);
  return { from: point(from), to: point(to) };
}

/**
 * Rättvisekontrollen per lag: lag vars kontrollsträckor över alla sträckor inte är desamma som de
 * flesta lags (vid lika många den första lagets). Tom lista = gafflingen är rättvis.
 */
export function unfairRelayTeams(teams: readonly RelayFairnessTeam[]): UnfairRelayTeam[] {
  if (teams.length < 2) return [];
  const signatures = teams.map((team) => {
    const counts = countPairs(team.legs.flatMap((leg) => courseLegPairs(leg.controlCodes)));
    return { team, counts, key: [...counts].sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
      .map(([pair, count]) => `${pair}*${count}`).join(",") };
  });
  const frequency = new Map<string, number>();
  for (const signature of signatures) frequency.set(signature.key, (frequency.get(signature.key) ?? 0) + 1);
  let reference = signatures[0]!;
  for (const signature of signatures) if (frequency.get(signature.key)! > frequency.get(reference.key)!) reference = signature;
  const unfair: UnfairRelayTeam[] = [];
  for (const signature of signatures) {
    if (signature.key === reference.key) continue;
    const pairs = new Set([...signature.counts.keys(), ...reference.counts.keys()]);
    const missing: string[] = [], extra: string[] = [];
    for (const pair of [...pairs].sort()) {
      const difference = (signature.counts.get(pair) ?? 0) - (reference.counts.get(pair) ?? 0);
      for (let count = 0; count < Math.abs(difference); count += 1) (difference < 0 ? missing : extra).push(pair);
    }
    unfair.push({ key: signature.team.key, missing: missing.map(parsePair), extra: extra.map(parsePair) });
  }
  return unfair;
}

/** Ett stabilt frö för en klass ur dess id (samma klass ger alltid samma fördelning). */
export function relaySeedOf(value: string): number {
  let hash = 2_166_136_261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619) >>> 0;
  }
  return hash === 0 ? 1 : hash;
}
