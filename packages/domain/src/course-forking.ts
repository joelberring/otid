/**
 * Gafflingsstruktur (PLAN.md steg 49, ADR-0175). En gafflad bana byggs av en grundföljd med gafflingspunkter, i
 * Purple Pens begrepp "variation" av två slag:
 *
 * - `FORK` (Purple Pen "Fork", enkel gaffling/fulgaffling): mellan två kontroller väljer löparen ett av 2–4
 *   alternativ, vart och ett en kontrollföljd.
 * - `LOOP` (Purple Pen "Loop", fjäril/bon): från en central kontroll springer löparen alla 2–4 slingor i någon
 *   ordning och kommer tillbaka till den centrala kontrollen efter varje slinga.
 *
 * Gafflingspunkterna står i följd (ingen gaffling inuti en annan). Varianterna genereras ur strukturen. Koderna följer
 * OCAD/Purple Pen-stil: bokstäverna delas ut i följd över gafflingspunkterna (första gafflingen A, B; nästa C, D …).
 * En enkel gaffling bidrar med det valda alternativets bokstav, en fjäril med slingornas bokstäver i den ordning de
 * springs utom den sista (den är given): fjäril A/B och fjäril C/D ger "AC", "AD", "BC" och "BD".
 *
 * Allt här är rent och generellt, så att stafetten kan använda samma struktur och bild.
 */

export type ForkingItem =
  | { readonly kind: "CONTROL"; readonly code: number }
  | { readonly kind: "FORK"; readonly branches: readonly (readonly number[])[] }
  | { readonly kind: "LOOP"; readonly center: number; readonly loops: readonly (readonly number[])[] };

export interface CourseForking {
  readonly items: readonly ForkingItem[];
}

/** Löparens val vid en gafflingspunkt: alternativets index (FORK), slingornas ordning (LOOP), null för en kontroll. */
export type ForkingChoice = number | readonly number[] | null;

export interface GeneratedForkingVariant {
  readonly code: string;
  readonly controlCodes: readonly number[];
  readonly choices: readonly ForkingChoice[];
}

export const MAX_FORKING_BRANCHES = 4;
export const MAX_FORKING_VARIANTS = 100;
const LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";

export type ForkingProblem =
  | { readonly kind: "EMPTY_COURSE" }
  | { readonly kind: "TOO_FEW_BRANCHES"; readonly item: number }
  | { readonly kind: "TOO_MANY_BRANCHES"; readonly item: number }
  | { readonly kind: "EMPTY_BRANCH"; readonly item: number; readonly branch: number }
  | { readonly kind: "SAME_BRANCHES"; readonly item: number }
  | { readonly kind: "LOOP_CONTAINS_CENTER"; readonly item: number; readonly branch: number }
  | { readonly kind: "TOO_MANY_LETTERS" }
  | { readonly kind: "TOO_MANY_VARIANTS"; readonly count: number };

const branchesOf = (item: ForkingItem): readonly (readonly number[])[] =>
  item.kind === "FORK" ? item.branches : item.kind === "LOOP" ? item.loops : [];

/** Antal gafflingspunkter (enkla gafflingar och fjärilar). */
export function forkingPointCount(forking: CourseForking): number {
  return forking.items.filter((item) => item.kind !== "CONTROL").length;
}

function factorial(value: number): number {
  let result = 1;
  for (let index = 2; index <= value; index += 1) result *= index;
  return result;
}

/** Antal varianter som strukturen ger (alternativ gånger slingornas ordningar). */
export function forkingVariantCount(forking: CourseForking): number {
  let count = 1;
  for (const item of forking.items) {
    if (item.kind === "FORK") count *= Math.max(1, item.branches.length);
    if (item.kind === "LOOP") count *= factorial(Math.max(1, item.loops.length));
  }
  return count;
}

/** Bokstäverna per gafflingspunkt (null för en kontroll). Saknas bokstäver blir resten null. */
export function forkingLetters(forking: CourseForking): (readonly string[] | null)[] {
  let next = 0;
  return forking.items.map((item) => {
    if (item.kind === "CONTROL") return null;
    const count = branchesOf(item).length;
    const letters = Array.from({ length: count }, (_value, index) => LETTERS[next + index] ?? "?");
    next += count;
    return letters;
  });
}

/** Strukturens regler för att kunna sparas: 2–4 alternativ/slingor med kontroller, olika, högst 100 varianter. */
export function validateCourseForking(forking: CourseForking): ForkingProblem[] {
  const problems: ForkingProblem[] = [];
  if (forking.items.length === 0) problems.push({ kind: "EMPTY_COURSE" });
  let letters = 0;
  forking.items.forEach((item, index) => {
    if (item.kind === "CONTROL") return;
    const branches = branchesOf(item);
    letters += branches.length;
    if (branches.length < 2) problems.push({ kind: "TOO_FEW_BRANCHES", item: index });
    if (branches.length > MAX_FORKING_BRANCHES) problems.push({ kind: "TOO_MANY_BRANCHES", item: index });
    branches.forEach((branch, branchIndex) => {
      if (branch.length === 0) problems.push({ kind: "EMPTY_BRANCH", item: index, branch: branchIndex });
      if (item.kind === "LOOP" && branch.includes(item.center)) problems.push({ kind: "LOOP_CONTAINS_CENTER", item: index, branch: branchIndex });
    });
    const keys = branches.filter((branch) => branch.length > 0).map((branch) => branch.join(" "));
    if (new Set(keys).size !== keys.length) problems.push({ kind: "SAME_BRANCHES", item: index });
  });
  if (letters > LETTERS.length) problems.push({ kind: "TOO_MANY_LETTERS" });
  const count = forkingVariantCount(forking);
  if (count > MAX_FORKING_VARIANTS) problems.push({ kind: "TOO_MANY_VARIANTS", count });
  return problems;
}

/** Alla ordningar av 0..n-1 i lexikografisk ordning. */
function permutations(count: number): number[][] {
  if (count <= 1) return [Array.from({ length: count }, (_value, index) => index)];
  const result: number[][] = [];
  const walk = (prefix: number[], rest: number[]) => {
    if (rest.length === 0) { result.push(prefix); return; }
    for (const [index, value] of rest.entries()) walk([...prefix, value], [...rest.slice(0, index), ...rest.slice(index + 1)]);
  };
  walk([], Array.from({ length: count }, (_value, index) => index));
  return result;
}

/** Kontrollföljden för ett val per gafflingspunkt. */
export function forkingControlCodes(forking: CourseForking, choices: readonly ForkingChoice[]): number[] {
  const codes: number[] = [];
  forking.items.forEach((item, index) => {
    const choice = choices[index];
    if (item.kind === "CONTROL") codes.push(item.code);
    else if (item.kind === "FORK") codes.push(...(item.branches[typeof choice === "number" ? choice : 0] ?? []));
    else {
      const order: readonly number[] = Array.isArray(choice) ? choice as readonly number[] : item.loops.map((_loop, loopIndex) => loopIndex);
      codes.push(item.center);
      for (const loop of order) codes.push(...(item.loops[loop] ?? []), item.center);
    }
  });
  return codes;
}

/** Variantens kod för valen (se modulens beskrivning). */
export function forkingVariantCode(forking: CourseForking, choices: readonly ForkingChoice[]): string {
  const letters = forkingLetters(forking);
  return forking.items.map((item, index) => {
    const own = letters[index];
    const choice = choices[index];
    if (!own) return "";
    if (item.kind === "FORK") return own[typeof choice === "number" ? choice : 0] ?? "";
    const order: readonly number[] = Array.isArray(choice) ? choice as readonly number[] : item.kind === "LOOP" ? item.loops.map((_loop, loopIndex) => loopIndex) : [];
    return order.slice(0, -1).map((loop) => own[loop] ?? "").join("");
  }).join("");
}

/**
 * Varianterna som strukturen ger, i kodordning. Strukturen ska först klara `validateCourseForking`; annars ger
 * funktionen högst `MAX_FORKING_VARIANTS` varianter.
 */
export function generateForkingVariants(forking: CourseForking): GeneratedForkingVariant[] {
  let combos: ForkingChoice[][] = [[]];
  for (const item of forking.items) {
    const options: ForkingChoice[] = item.kind === "CONTROL" ? [null]
      : item.kind === "FORK" ? item.branches.map((_branch, index) => index)
        : permutations(item.loops.length);
    const next: ForkingChoice[][] = [];
    for (const combo of combos) for (const option of options) {
      if (next.length >= MAX_FORKING_VARIANTS) break;
      next.push([...combo, option]);
    }
    combos = next;
  }
  if (forkingPointCount(forking) === 0) return [];
  return combos.map((choices) => ({ code: forkingVariantCode(forking, choices), controlCodes: forkingControlCodes(forking, choices), choices }));
}

const sequenceKey = (codes: readonly number[]) => codes.join(" ");

export interface DerivedCourseForking {
  readonly forking: CourseForking;
  /** Varje befintlig variants val i strukturen (samma kontrollföljd). */
  readonly choices: ReadonlyMap<string, readonly ForkingChoice[]>;
  /** Strukturen klarar reglerna och ger alla befintliga varianter ("Gör om till struktur" går). */
  readonly convertible: boolean;
  /** Varianter som strukturen ger utöver de befintliga (när den görs om). */
  readonly addedCount: number;
}

interface DerivationRow { readonly code: string; readonly rest: readonly number[]; readonly choices: ForkingChoice[] }

/**
 * Försöker läsa en fjäril vid den centrala kontrollen `center`: varje variant springer samma slingor (delar som
 * slutar med `center`) i någon ordning. Ger slingorna och ordningen per variant, eller undefined.
 */
function readLoop(rows: readonly DerivationRow[], center: number) {
  const parts = rows.map((row) => {
    const result: number[][] = [];
    let current: number[] = [];
    for (const code of row.rest) {
      if (code === center) { result.push(current); current = []; } else current.push(code);
    }
    return result;
  });
  const most = Math.min(...parts.map((list) => list.length));
  for (let count = most; count >= 2; count -= 1) {
    const reference = parts[0]!.slice(0, count).map(sequenceKey);
    if (reference.some((key) => key === "") || new Set(reference).size !== count) continue;
    const sorted = [...reference].sort().join("|");
    if (!parts.every((list) => list.slice(0, count).map(sequenceKey).sort().join("|") === sorted)) continue;
    // Slingorna i ordningen de först förekommer (variant för variant), så att A är den som oftast springs först.
    const loops: number[][] = [];
    for (const list of parts) for (const loop of list.slice(0, count)) {
      if (!loops.some((known) => sequenceKey(known) === sequenceKey(loop))) loops.push(loop);
    }
    const orders = parts.map((list) => list.slice(0, count).map((loop) => loops.findIndex((known) => sequenceKey(known) === sequenceKey(loop))));
    const consumed = parts.map((list) => list.slice(0, count).reduce((sum, loop) => sum + loop.length + 1, 0));
    return { loops, orders, consumed };
  }
  return undefined;
}

/**
 * Härleder en struktur ur importerade varianter (banfil utan struktur). Lika början blir kontroller; där varianterna
 * skiljer sig blir det en fjäril om den föregående kontrollen återkommer som central kontroll med samma slingor i
 * alla varianter, annars en enkel gaffling fram till första kontroll som alla varianter har. Varje befintlig variant
 * är en väg genom strukturen, så bilden fungerar alltid; `convertible` säger om strukturen klarar reglerna.
 */
export function deriveCourseForking(variants: readonly { readonly code: string; readonly controlCodes: readonly number[] }[]): DerivedCourseForking {
  const items: ForkingItem[] = [];
  let rows: DerivationRow[] = variants.map((variant) => ({ code: variant.code, rest: [...variant.controlCodes], choices: [] }));
  let guard = 0;
  while (rows.length > 0 && rows.some((row) => row.rest.length > 0) && guard < 10_000) {
    guard += 1;
    const first = rows[0]!.rest[0];
    if (first !== undefined && rows.every((row) => row.rest[0] === first)) {
      items.push({ kind: "CONTROL", code: first });
      rows = rows.map((row) => ({ ...row, rest: row.rest.slice(1), choices: [...row.choices, null] }));
      continue;
    }
    const previous = items[items.length - 1];
    const loop = previous?.kind === "CONTROL" ? readLoop(rows, previous.code) : undefined;
    if (previous?.kind === "CONTROL" && loop) {
      // Den centrala kontrollen står redan som kontroll; den blir fjärilens mitt.
      items[items.length - 1] = { kind: "LOOP", center: previous.code, loops: loop.loops };
      rows = rows.map((row, index) => ({ ...row, rest: row.rest.slice(loop.consumed[index]),
        choices: [...row.choices.slice(0, -1), loop.orders[index]!] }));
      continue;
    }
    // Enkel gaffling fram till den första kontroll i första variantens rest som alla varianter har.
    const join = rows[0]!.rest.find((code) => rows.every((row) => row.rest.includes(code)));
    const cut = rows.map((row) => join === undefined ? row.rest.length : row.rest.indexOf(join));
    const branches: number[][] = [];
    const picks = rows.map((row, index) => {
      const branch = row.rest.slice(0, cut[index]);
      let found = branches.findIndex((known) => sequenceKey(known) === sequenceKey(branch));
      if (found < 0) { branches.push(branch); found = branches.length - 1; }
      return found;
    });
    items.push({ kind: "FORK", branches });
    rows = rows.map((row, index) => ({ ...row, rest: row.rest.slice(cut[index]), choices: [...row.choices, picks[index]!] }));
  }
  const forking: CourseForking = { items };
  const choices = new Map(rows.map((row) => [row.code, row.choices] as const));
  const valid = validateCourseForking(forking).length === 0 && forkingPointCount(forking) > 0;
  const generated = valid ? new Set(generateForkingVariants(forking).map((variant) => sequenceKey(variant.controlCodes))) : new Set<string>();
  const existing = new Set(variants.map((variant) => sequenceKey(variant.controlCodes)));
  const convertible = valid && [...existing].every((key) => generated.has(key));
  return { forking, choices, convertible, addedCount: convertible ? generated.size - existing.size : 0 };
}

/** Valen för en kontrollföljd i strukturen, om följden är en av strukturens varianter. */
export function forkingChoicesFor(forking: CourseForking, controlCodes: readonly number[]): readonly ForkingChoice[] | undefined {
  const key = sequenceKey(controlCodes);
  return generateForkingVariants(forking).find((variant) => sequenceKey(variant.controlCodes) === key)?.choices;
}

/** Strukturens kontrollkoder i ordning (grundföljd, alternativ och slingor), utan dubbletter. */
export function forkingControlSet(forking: CourseForking): number[] {
  const codes: number[] = [];
  const add = (code: number) => { if (!codes.includes(code)) codes.push(code); };
  for (const item of forking.items) {
    if (item.kind === "CONTROL") add(item.code);
    else if (item.kind === "LOOP") add(item.center);
    for (const branch of branchesOf(item)) for (const code of branch) add(code);
  }
  return codes;
}

/** Kontrollerna som bara finns i enkla gafflingars alternativ. */
export function forkBranchControls(forking: CourseForking): Set<number> {
  const result = new Set<number>();
  for (const item of forking.items) if (item.kind === "FORK") for (const branch of item.branches) for (const code of branch) result.add(code);
  return result;
}

// ── Graf ─────────────────────────────────────────────────────────────────────────────────────────────────────

export type ForkingGraphPoint = "START" | "FINISH" | number;

export interface ForkingGraphEdge {
  readonly from: ForkingGraphPoint;
  readonly to: ForkingGraphPoint;
  /** Varianterna som har sträckan (en kod per förekomst). */
  readonly variantCodes: readonly string[];
}

/**
 * Banan som graf: start, kontroller och mål som noder och sträckor som kanter med varianterna som springer dem.
 * Används för banor utan struktur och för sträcktidsanalysen per sträcka.
 */
export function courseVariantGraph(variants: readonly { readonly code: string; readonly controlCodes: readonly number[] }[]):
  { readonly nodes: readonly ForkingGraphPoint[]; readonly edges: readonly ForkingGraphEdge[] } {
  const nodes: ForkingGraphPoint[] = ["START"];
  const edges = new Map<string, { from: ForkingGraphPoint; to: ForkingGraphPoint; variantCodes: string[] }>();
  for (const variant of variants) {
    const points: ForkingGraphPoint[] = ["START", ...variant.controlCodes, "FINISH"];
    for (const point of points) if (!nodes.includes(point) && point !== "FINISH") nodes.push(point);
    for (let index = 1; index < points.length; index += 1) {
      const key = `${points[index - 1]}>${points[index]}`;
      const edge = edges.get(key) ?? { from: points[index - 1]!, to: points[index]!, variantCodes: [] };
      edge.variantCodes.push(variant.code);
      edges.set(key, edge);
    }
  }
  return { nodes: [...nodes, "FINISH"], edges: [...edges.values()] };
}

// ── Rättvisa och längder ─────────────────────────────────────────────────────────────────────────────────────

/** Banans gafflingssätt: utjämnad (alla varianter samma sträckor) eller fulgaffling (alternativen får skilja). */
export type ForkingMode = "BALANCED" | "UNEQUAL";

export interface ForkingLeg {
  readonly from: ForkingGraphPoint;
  readonly to: ForkingGraphPoint;
  readonly variantCodes: readonly string[];
}

export interface ForkingFairness {
  readonly mode: ForkingMode;
  /**
   * WARNING: varianterna ger inte samma sträckor där de borde (utjämnad bana, eller en fjäril/slinga i en
   * fulgaffling). NOTICE: fulgaffling där alternativen skiljer sig, bara en upplysning. NONE: samma sträckor.
   * Kontrollen stoppar aldrig att banan sparas eller används.
   */
  readonly level: "NONE" | "NOTICE" | "WARNING";
  /** Sträckor som inte förekommer lika många gånger i alla varianter och som ger en varning. */
  readonly warningLegs: readonly ForkingLeg[];
  /** Sträckor i enkla gafflingars alternativ (fulgaffling), bara som upplysning. */
  readonly noticeLegs: readonly ForkingLeg[];
  /** Längd per variant och skillnad mot den kortaste, när längderna är kända. */
  readonly lengths: readonly { readonly code: string; readonly lengthMeters: number | null; readonly differenceMeters: number | null }[];
  readonly shortestMeters: number | null;
  readonly longestMeters: number | null;
}

/**
 * Rättvisekontroll per gafflingssätt, generell för individuella banor och stafett. Utjämnad: varje sträcka som inte
 * förekommer lika många gånger i alla varianter är en varning. Fulgaffling: sträckor till, i och från enkla
 * gafflingars alternativ är bara en upplysning, men fjärilar och slingor ska fortfarande ge samma sträckor.
 */
export function courseForkingFairness(input: {
  readonly mode: ForkingMode;
  readonly variants: readonly { readonly code: string; readonly controlCodes: readonly number[]; readonly lengthMeters?: number | null }[];
  /** Strukturen om den finns; annars härleds den ur varianterna. */
  readonly forking?: CourseForking | null;
}): ForkingFairness {
  const counts = input.variants.length;
  const graph = courseVariantGraph(input.variants);
  const uneven = counts < 2 ? [] : graph.edges.filter((edge) => {
    const per = input.variants.map((variant) => edge.variantCodes.filter((code) => code === variant.code).length);
    return per.some((count) => count !== per[0]);
  });
  const forking = input.forking ?? (counts > 0 ? deriveCourseForking(input.variants).forking : { items: [] });
  const branchControls = forkBranchControls(forking);
  const inFork = (leg: ForkingLeg) => (typeof leg.from === "number" && branchControls.has(leg.from)) ||
    (typeof leg.to === "number" && branchControls.has(leg.to));
  const warningLegs = input.mode === "BALANCED" ? uneven : uneven.filter((leg) => !inFork(leg));
  const noticeLegs = input.mode === "BALANCED" ? [] : uneven.filter(inFork);
  const known = input.variants.map((variant) => variant.lengthMeters ?? null);
  const all = known.every((value): value is number => value !== null) && known.length > 0;
  const shortestMeters = all ? Math.min(...known) : null;
  const longestMeters = all ? Math.max(...known) : null;
  return {
    mode: input.mode,
    level: warningLegs.length > 0 ? "WARNING" : noticeLegs.length > 0 ? "NOTICE" : "NONE",
    warningLegs, noticeLegs, shortestMeters, longestMeters,
    lengths: input.variants.map((variant) => ({ code: variant.code, lengthMeters: variant.lengthMeters ?? null,
      differenceMeters: shortestMeters === null || variant.lengthMeters == null ? null : variant.lengthMeters - shortestMeters }))
  };
}

/** Raka avståndet i meter mellan punkter med kända lägen (kontrollernas lägen ur banfilen). Null om något läge saknas. */
export function courseLengthMeters(points: readonly ({ readonly x: number; readonly y: number } | undefined)[]): number | null {
  let sum = 0;
  for (let index = 1; index < points.length; index += 1) {
    const from = points[index - 1], to = points[index];
    if (!from || !to) return null;
    sum += Math.hypot(to.x - from.x, to.y - from.y);
  }
  return Math.round(sum);
}

/** Ett läge i WGS 84. */
export interface ForkingGeoPoint { readonly latitude: number; readonly longitude: number }

/**
 * Steg 49: längden i meter (storcirkel) genom start, kontroller och mål när alla lägen är kända; annars null. Används
 * för varianter utan längd i banfilen, t.ex. de som genereras ur en struktur.
 */
export function geoLengthMeters(points: readonly (ForkingGeoPoint | undefined)[]): number | null {
  if (points.length < 2 || points.some(point => point === undefined)) return null;
  const rad = Math.PI / 180, earth = 6_371_008.8;
  let sum = 0;
  for (let index = 1; index < points.length; index += 1) {
    const from = points[index - 1]!, to = points[index]!;
    const dLat = (to.latitude - from.latitude) * rad, dLng = (to.longitude - from.longitude) * rad;
    const a = Math.sin(dLat / 2) ** 2 + Math.cos(from.latitude * rad) * Math.cos(to.latitude * rad) * Math.sin(dLng / 2) ** 2;
    sum += 2 * earth * Math.asin(Math.min(1, Math.sqrt(a)));
  }
  return sum < 1 ? null : Math.round(sum);
}
