/**
 * ADR-0210 beslut 1: troliga dubbletter bland klubbarkivets kartor. Samma karta finns ofta under flera namn
 * ("Älvsjöskogen 2019.ocd", "alvsjoskogen_ny.ocd", "Älvsjöskogen rev 2021.omap"). Varje par av kartor jämförs på
 * georeferensen (överlappet av ytorna i terrängen), namnet, innehållet (kartytan i kartans mm, symbolerna, skalan) och
 * träningarna som använder båda. Paren blir grupper med en säkerhet; inget slås ihop utan att någon väljer det.
 * Ren funktion utan I/O.
 */
export interface MapExtent { readonly minX: number; readonly minY: number; readonly maxX: number; readonly maxY: number }

/** Det som sparas när en kartversion kontrolleras (ritas i webbläsaren), så att servern aldrig läser om stora filer. */
export interface MapFingerprint {
  readonly scale: number;
  /** Kartans yta i kartans mm. */
  readonly bounds: MapExtent;
  /** Ytan i terrängen (meter i koordinatsystemet), när kartan är georefererad med känt koordinatsystem. */
  readonly projected: { readonly epsg: number; readonly extent: MapExtent } | null;
  /** Symbolerna som används (koder som "101.0"), sorterade, och deras hash. */
  readonly symbols: readonly string[];
  readonly symbolHash: string;
  readonly objectCount: number;
}

export interface DuplicateCandidate {
  readonly mapId: string;
  readonly name: string;
  /** Versionernas filnamn (också de jämförs, ett filnamn säger ofta mer än kartans namn). */
  readonly fileNames: readonly string[];
  /** En per kontrollerad version. */
  readonly fingerprints: readonly MapFingerprint[];
  /** Träningarna som använder någon av kartans versioner. */
  readonly entryIds: readonly string[];
}

export type DuplicateReason =
  /** `overlap` är skärning genom union; `contained` skärningen av den mindre ytan. */
  | { readonly kind: "AREA"; readonly overlap: number; readonly contained: number }
  | { readonly kind: "SAME_NAME" }
  | { readonly kind: "SIMILAR_NAME" }
  | { readonly kind: "SAME_EXTENT" }
  | { readonly kind: "SAME_SYMBOLS" }
  | { readonly kind: "SIMILAR_SYMBOLS" }
  | { readonly kind: "SAME_SCALE" }
  | { readonly kind: "SHARED_TRAININGS"; readonly count: number };

export type DuplicateLevel = "HIGH" | "MEDIUM";

export interface DuplicatePair {
  readonly a: string;
  readonly b: string;
  readonly score: number;
  readonly level: DuplicateLevel;
  readonly reasons: readonly DuplicateReason[];
}

export interface DuplicateCluster {
  readonly mapIds: readonly string[];
  readonly level: DuplicateLevel;
  readonly reasons: readonly DuplicateReason[];
  readonly score: number;
}

/** Gränserna (ADR-0210, provade mot klubbarkivets riktiga kartor lokalt). */
export const DUPLICATE_THRESHOLDS = {
  high: 0.75,
  medium: 0.45,
  /** Överlapp (skärning genom union) som räknas som samma område. */
  sameArea: 0.5,
  /** Skärningen av den mindre ytan som räknas som samma område (en utökad karta täcker den gamla). */
  sameAreaContained: 0.85,
  someArea: 0.2,
  someAreaContained: 0.5,
  /** Under detta är det olika områden, oavsett namnet. */
  differentArea: 0.05,
  sameName: 0.999,
  similarName: 0.75,
  weakName: 0.5,
  sameExtent: 0.6,
  sameSymbols: 0.95,
  similarSymbols: 0.8,
  maxCluster: 8
} as const;

const WEIGHTS = {
  sameArea: 0.6, someArea: 0.3, sameName: 0.45, similarName: 0.35, weakName: 0.15, sameExtent: 0.3, someExtent: 0.1,
  sameSymbols: 0.15, similarSymbols: 0.1, sameScale: 0.05, sharedTraining: 0.1, manySharedTrainings: 0.05
} as const;

/** Ord som inte säger något om vilket område kartan visar. */
const NOISE_TOKENS = new Set(["ny", "nya", "nyare", "rev", "reviderad", "reviderat", "revidering", "revision", "version", "ver", "karta", "kartan",
  "kartor", "ocad", "omap", "xmap", "mapper", "final", "slutlig", "kopia", "kopie", "copy", "av", "of", "orig", "original"]);
const NOISE_PATTERN = /^(?:v|ver|rev|r)\d+$|^\d+$/;
const EXTENSION = /\.(?:ocd|omap|xmap|ocad|ppen|xml|zip)$/i;
const DATES = [/(?<!\d)(?:19|20)\d{2}[-_.]?\d{2}[-_.]?\d{2}(?!\d)/g, /(?<!\d)\d{1,2}[-_.]\d{1,2}(?!\d)/g, /(?<!\d)(?:19|20)\d{2}(?!\d)/g];

/** Bokstäverna utan accenter: å, ä → a, ö → o, é → e. */
export function stripAccents(text: string): string {
  return text.normalize("NFD").replace(/\p{M}+/gu, "").replace(/ø/g, "o").replace(/æ/g, "ae").replace(/ß/g, "ss");
}

/**
 * Namnets ord: gemener, utan accenter, filändelse, datum och år, och utan ord som ny, rev, reviderad, version, v2, karta,
 * ocad, final, kopia och siffror. "Älvsjöskogen rev 2021.omap" → ["alvsjoskogen"].
 */
export function normalizeMapName(name: string): string[] {
  let text = stripAccents(name.normalize("NFC").trim().replace(/^.*[\\/]/, "").replace(EXTENSION, "").toLocaleLowerCase("sv-SE"));
  for (const pattern of DATES) text = text.replace(pattern, " ");
  return text.split(/[^\p{L}\p{N}]+/u).filter(token => token.length > 0 && !NOISE_TOKENS.has(token) && !NOISE_PATTERN.test(token));
}

function bigrams(text: string): Map<string, number> {
  const grams = new Map<string, number>();
  for (let index = 0; index < text.length - 1; index++) {
    const gram = text.slice(index, index + 2);
    grams.set(gram, (grams.get(gram) ?? 0) + 1);
  }
  return grams;
}

/** Sørensen–Dice på teckenpar (tål "alvsjo skogen" mot "alvsjoskogen" och ett stavfel). */
function dice(a: string, b: string): number {
  if (a === b) return a.length > 0 ? 1 : 0;
  if (a.length < 2 || b.length < 2) return 0;
  const left = bigrams(a);
  const right = bigrams(b);
  let shared = 0;
  for (const [gram, count] of left) shared += Math.min(count, right.get(gram) ?? 0);
  return (2 * shared) / (a.length - 1 + b.length - 1);
}

/** Likheten mellan två namn (0–1): ordens överlapp eller teckenparen i de hopskrivna orden, det som är störst. */
export function nameSimilarity(a: string, b: string): number {
  const left = normalizeMapName(a);
  const right = normalizeMapName(b);
  if (left.length === 0 || right.length === 0) return 0;
  const leftSet = new Set(left);
  const rightSet = new Set(right);
  const shared = [...leftSet].filter(token => rightSet.has(token)).length;
  const tokens = shared / new Set([...leftSet, ...rightSet]).size;
  const joined = dice(left.join(""), right.join(""));
  // Har båda namnen ett eget ord som inte liknar det andra ("Skogen norra" mot "Skogen södra") är det troligen olika kartor.
  const ownLeft = [...leftSet].filter(token => !rightSet.has(token)).join("");
  const ownRight = [...rightSet].filter(token => !leftSet.has(token)).join("");
  if (ownLeft && ownRight && dice(ownLeft, ownRight) < 0.5) return Math.max(tokens, Math.min(joined, 0.6));
  return Math.max(tokens, joined);
}

const area = (extent: MapExtent) => Math.max(0, extent.maxX - extent.minX) * Math.max(0, extent.maxY - extent.minY);

/** Skärning genom union och skärningen av den mindre ytan (0–1). */
export function extentOverlap(a: MapExtent, b: MapExtent): { iou: number; contained: number } {
  const width = Math.min(a.maxX, b.maxX) - Math.max(a.minX, b.minX);
  const height = Math.min(a.maxY, b.maxY) - Math.max(a.minY, b.minY);
  const intersection = width > 0 && height > 0 ? width * height : 0;
  const union = area(a) + area(b) - intersection;
  const smaller = Math.min(area(a), area(b));
  return { iou: union > 0 ? intersection / union : 0, contained: smaller > 0 ? intersection / smaller : 0 };
}

/** Skärning genom union av ytorna, som `extentOverlap(a, b).iou`. */
export const extentIoU = (a: MapExtent, b: MapExtent): number => extentOverlap(a, b).iou;

function jaccard(a: readonly string[], b: readonly string[]): number {
  if (a.length === 0 || b.length === 0) return 0;
  const right = new Set(b);
  const shared = new Set(a.filter(item => right.has(item))).size;
  return shared / new Set([...a, ...b]).size;
}

/** Bästa jämförelsen av två kartors innehåll (alla par av kontrollerade versioner). */
function compareContent(a: readonly MapFingerprint[], b: readonly MapFingerprint[]) {
  let geo: { iou: number; contained: number } | null = null;
  let extent = 0;
  let symbols = 0;
  let sameHash = false;
  let sameScale = false;
  for (const left of a) {
    for (const right of b) {
      if (left.projected && right.projected && left.projected.epsg === right.projected.epsg) {
        const overlap = extentOverlap(left.projected.extent, right.projected.extent);
        if (!geo || overlap.iou > geo.iou || (overlap.iou === geo.iou && overlap.contained > geo.contained)) geo = overlap;
      }
      const scale = left.scale === right.scale;
      sameScale ||= scale;
      if (scale) extent = Math.max(extent, extentIoU(left.bounds, right.bounds));
      sameHash ||= left.symbolHash === right.symbolHash && left.symbols.length > 0;
      symbols = Math.max(symbols, jaccard(left.symbols, right.symbols));
    }
  }
  return { geo, extent, symbols: sameHash ? 1 : symbols, sameHash, sameScale };
}

/** Bästa likheten mellan kartornas namn och versionernas filnamn. */
function bestName(a: DuplicateCandidate, b: DuplicateCandidate): number {
  const left = [a.name, ...a.fileNames];
  const right = [b.name, ...b.fileNames];
  let best = 0;
  for (const x of left) for (const y of right) best = Math.max(best, nameSimilarity(x, y));
  return best;
}

const round = (value: number) => Math.round(value * 100) / 100;

/** Ett par: poängen, säkerheten och skälen, eller null när det inte är en trolig dubblett (eller olika områden). */
export function scoreDuplicatePair(a: DuplicateCandidate, b: DuplicateCandidate): DuplicatePair | null {
  const t = DUPLICATE_THRESHOLDS;
  const reasons: DuplicateReason[] = [];
  let score = 0;
  const content = compareContent(a.fingerprints, b.fingerprints);
  if (content.geo) {
    const { iou, contained } = content.geo;
    // Båda georefererade i samma koordinatsystem utan att mötas: olika områden, vad de än heter.
    if (iou < t.differentArea && contained < t.differentArea * 2) return null;
    if (iou >= t.sameArea || contained >= t.sameAreaContained) score += WEIGHTS.sameArea;
    else if (iou >= t.someArea || contained >= t.someAreaContained) score += WEIGHTS.someArea;
    if (iou >= t.someArea || contained >= t.someAreaContained) reasons.push({ kind: "AREA", overlap: round(iou), contained: round(Math.min(contained, 1)) });
  } else if (content.extent >= t.sameExtent) {
    score += WEIGHTS.sameExtent;
    reasons.push({ kind: "SAME_EXTENT" });
  } else if (content.extent >= t.sameExtent / 2) {
    score += WEIGHTS.someExtent;
  }
  const name = bestName(a, b);
  if (name >= t.sameName) { score += WEIGHTS.sameName; reasons.push({ kind: "SAME_NAME" }); }
  else if (name >= t.similarName) { score += WEIGHTS.similarName; reasons.push({ kind: "SIMILAR_NAME" }); }
  else if (name >= t.weakName) score += WEIGHTS.weakName;
  if (content.symbols >= t.sameSymbols) { score += WEIGHTS.sameSymbols; reasons.push({ kind: "SAME_SYMBOLS" }); }
  else if (content.symbols >= t.similarSymbols) { score += WEIGHTS.similarSymbols; reasons.push({ kind: "SIMILAR_SYMBOLS" }); }
  if (content.sameScale) { score += WEIGHTS.sameScale; reasons.push({ kind: "SAME_SCALE" }); }
  const right = new Set(b.entryIds);
  const shared = new Set(a.entryIds.filter(id => right.has(id))).size;
  if (shared > 0) {
    score += WEIGHTS.sharedTraining + (shared >= 3 ? WEIGHTS.manySharedTrainings : 0);
    reasons.push({ kind: "SHARED_TRAININGS", count: shared });
  }
  score = round(score);
  const level: DuplicateLevel | null = score >= t.high ? "HIGH" : score >= t.medium ? "MEDIUM" : null;
  if (!level) return null;
  const [first, second] = a.mapId < b.mapId ? [a.mapId, b.mapId] : [b.mapId, a.mapId];
  return { a: first, b: second, score, level, reasons };
}

/** Nyckeln för ett par (samma åt båda håll), som de bortvalda paren sparas med. */
export const duplicatePairKey = (a: string, b: string) => a < b ? `${a}|${b}` : `${b}|${a}`;

/** Alla par i klubben utom de bortvalda ("Inte samma karta"). */
export function findDuplicatePairs(candidates: readonly DuplicateCandidate[], dismissed: ReadonlySet<string> = new Set()): DuplicatePair[] {
  const pairs: DuplicatePair[] = [];
  for (let i = 0; i < candidates.length; i++) {
    for (let j = i + 1; j < candidates.length; j++) {
      const a = candidates[i]!;
      const b = candidates[j]!;
      if (dismissed.has(duplicatePairKey(a.mapId, b.mapId))) continue;
      const pair = scoreDuplicatePair(a, b);
      if (pair) pairs.push(pair);
    }
  }
  return pairs;
}

function components(ids: readonly string[], pairs: readonly DuplicatePair[]): string[][] {
  const parent = new Map(ids.map(id => [id, id]));
  const find = (id: string): string => {
    let root = id;
    while (parent.get(root) !== root) root = parent.get(root)!;
    parent.set(id, root);
    return root;
  };
  for (const pair of pairs) {
    const left = find(pair.a);
    const right = find(pair.b);
    if (left !== right) parent.set(left, right);
  }
  const groups = new Map<string, string[]>();
  for (const id of ids) groups.set(find(id), [...(groups.get(find(id)) ?? []), id]);
  return [...groups.values()].filter(group => group.length > 1);
}

/** Skälen för en grupp: varje slag en gång, med det minsta överlappet och flest gemensamma träningar. */
function clusterReasons(pairs: readonly DuplicatePair[]): DuplicateReason[] {
  const order: DuplicateReason["kind"][] = ["AREA", "SAME_EXTENT", "SAME_NAME", "SIMILAR_NAME", "SAME_SYMBOLS", "SIMILAR_SYMBOLS", "SAME_SCALE",
    "SHARED_TRAININGS"];
  const all = pairs.flatMap(pair => pair.reasons);
  const reasons: DuplicateReason[] = [];
  for (const kind of order) {
    const found = all.filter(reason => reason.kind === kind);
    if (found.length === 0) continue;
    if (kind === "AREA") {
      const areas = found.flatMap(reason => reason.kind === "AREA" ? [reason] : []);
      reasons.push({ kind, overlap: Math.min(...areas.map(reason => reason.overlap)), contained: Math.min(...areas.map(reason => reason.contained)) });
    }
    else if (kind === "SHARED_TRAININGS") reasons.push({ kind, count: Math.max(...found.map(reason => reason.kind === kind ? reason.count : 0)) });
    else reasons.push(found[0]!);
  }
  // "Samma namn" säger mer än "Liknande namn", och samma symboler mer än liknande.
  return reasons.filter(reason => !(reason.kind === "SIMILAR_NAME" && reasons.some(other => other.kind === "SAME_NAME"))
    && !(reason.kind === "SIMILAR_SYMBOLS" && reasons.some(other => other.kind === "SAME_SYMBOLS")));
}

function cluster(mapIds: readonly string[], pairs: readonly DuplicatePair[]): DuplicateCluster {
  const inside = new Set(mapIds);
  const own = pairs.filter(pair => inside.has(pair.a) && inside.has(pair.b));
  const high = own.filter(pair => pair.level === "HIGH");
  // Troligen samma karta när de säkra paren ensamma binder ihop hela gruppen.
  const level: DuplicateLevel = components(mapIds, high).some(group => group.length === mapIds.length) ? "HIGH" : "MEDIUM";
  return { mapIds: [...mapIds].sort(), level, reasons: clusterReasons(own), score: Math.max(...own.map(pair => pair.score)) };
}

/**
 * Paren blir grupper (sammanhängande par). En grupp som blir större än `maxCluster` delas: de säkra paren för sig och de
 * osäkra som egna par, så att en kedja av liknande namn inte drar ihop halva arkivet. Säkrast först.
 */
export function clusterDuplicates(pairs: readonly DuplicatePair[], maxCluster: number = DUPLICATE_THRESHOLDS.maxCluster): DuplicateCluster[] {
  const ids = [...new Set(pairs.flatMap(pair => [pair.a, pair.b]))];
  const clusters: DuplicateCluster[] = [];
  for (const group of components(ids, pairs)) {
    if (group.length <= maxCluster) { clusters.push(cluster(group, pairs)); continue; }
    const inside = new Set(group);
    const own = pairs.filter(pair => inside.has(pair.a));
    const high = own.filter(pair => pair.level === "HIGH");
    const highGroups = components(group, high);
    const covered = new Map(highGroups.flatMap((members, index) => members.map(id => [id, index] as const)));
    for (const members of highGroups) clusters.push(cluster(members.slice(0, maxCluster), high));
    for (const pair of own.filter(candidate => candidate.level === "MEDIUM")) {
      const left = covered.get(pair.a);
      if (left !== undefined && left === covered.get(pair.b)) continue;
      clusters.push(cluster([pair.a, pair.b], [pair]));
    }
  }
  return clusters.sort((a, b) => (a.level === b.level ? 0 : a.level === "HIGH" ? -1 : 1) || b.score - a.score || a.mapIds[0]!.localeCompare(b.mapIds[0]!));
}

/** FNV-1a (32 bitar) som hex: symbolernas hash i fingeravtrycket. */
export function symbolSetHash(symbols: readonly string[]): string {
  let hash = 0x811c9dc5;
  for (const char of [...new Set(symbols)].sort().join(",")) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}
