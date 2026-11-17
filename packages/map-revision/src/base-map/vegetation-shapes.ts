/**
 * Ägaren 2026-11-17 («gränserna mellan olika grönt, skog och öppen mark blir rätt fula, antingen för detaljerade eller
 * blobbiga … ofta blir det också små smala mellanzoner mellan ytor som är konstiga»): vegetationen generaliseras som en
 * indelning av marken, inte lager för lager.
 *
 * Förut jämnades varje lager (401, 406, 408 …) för sig med en åttkant (stäng och öppna) och kanten blev cellkanten förenklad
 * med 0,75 celler. Det gav trappsteg och små «popcorn»-bucklor, vita strimlor mellan gult och grönt (lagren rör sig var för
 * sig) och smala band av ljusare grönt runt det mörkare. Här:
 *
 * 1. Varje cell har en etikett (öppet, halvöppet, skog, 406, 408, 410). Grönt utjämnas som kapslade nivåer (≥ 406, ≥ 408,
 *    ≥ 410) med samma gauss och tröskeln 0,5, så att nivåerna aldrig korsar varandra och strödda pixlar försvinner.
 * 2. Smala delar under normens minsta bredd ges till grannen. Ett mellanband (406 mellan skog och 408, halvöppet mellan öppet
 *    och skog …) får en större gräns: det är de «konstiga mellanzonerna».
 * 3. Små ytor slås ihop med den granne som ligger närmast, så att det inte blir hål i kartan.
 * 4. Kanten jämnas med upprepad mjuk majoritet (ett kurvaturflöde): småvågor försvinner men stora former och raka
 *    beståndskanter står kvar, i stället för en stor utjämning som gör allt runt.
 * 5. Linjerna: Douglas–Peucker med en tolerans i kartans mm och sedan hörnklippning (Chaikin), som en ritad kurva.
 *
 * Alla mått är i kartans mm (skalan avgör meter), så att samma läge ger samma intryck på 1:10 000 och 1:15 000.
 *
 * Mätt 2026-11-17 mot Gömmaren och Lida (kartritarens kartor som facit, samma laserkörning, läge 4): kant per hektar 160–220 m
 * (facit 200–270, förut ~400), ytor per km² 70–110 (facit 130–220), grön andel 7–10 % (facit 6,5–7 %, förut ~20 %), med
 * samma träff för grönt (F 0,30–0,42) och gult som förut.
 *
 * Ren TypeScript utan beroenden: geo-arbetaren (scripts/geo-vegetation.ts) kopierar filen till sin avbildning. Masker
 * kolumnvis: index = kolumn · rader + rad.
 */

/** Etiketterna. 0 = ingen yta (vatten, utanför); ordningen öppet < halvöppet < skog < 406 < 408 < 410 används för mellanband. */
export const VEG_NONE = 0, VEG_OPEN = 1, VEG_SEMI = 2, VEG_FOREST = 3, VEG_SLOW = 4, VEG_DIFFICULT = 5, VEG_FIGHT = 6;
const LABELS = [VEG_OPEN, VEG_SEMI, VEG_FOREST, VEG_SLOW, VEG_DIFFICULT, VEG_FIGHT] as const;

/** Förvalt läge 1–10 för generaliseringen; 0 är ingen (de gamla reglerna gäller då). */
export const DEFAULT_VEGETATION_LEVEL = 4;

export interface VegetationShapeOptions {
  /** Cellens sida i meter (2 för laserns klassbild). */
  readonly cellMeters: number;
  /** Kartans skala, t.ex. 15 000. */
  readonly scale: number;
  /** 1–10; högre ger enklare former. */
  readonly level: number;
  /** Gläntornas reglage: minsta ytan för öppen mark gånger detta (förval 1). */
  readonly openAreaFactor?: number | undefined;
}

/** Måtten för ett läge, i celler. Exporteras för tester och för att visa vad läget betyder. */
export function vegetationShapeSteps(options: VegetationShapeOptions) {
  const level = Math.max(1, Math.min(10, options.level));
  const perMm = options.scale / 1000 / options.cellMeters;
  const mm2 = (options.scale / 1000) ** 2 / (options.cellMeters * options.cellMeters);
  const minCells = Math.max(2, Math.round((0.5 + 0.25 * level) * mm2));
  return {
    /** Första utjämningen (gauss, sigma i celler). */
    sigma: (0.2 + 0.03 * level) * perMm,
    /** Kurvaturflödets steg (sigma) och antal varv. */
    flowSigma: (0.15 + 0.02 * level) * perMm, flowRounds: 3,
    /** Minsta bredd (celler) och minsta bredd för ett mellanband. */
    minWidth: (0.3 + 0.02 * level) * perMm, bandWidth: (0.5 + 0.08 * level) * perMm,
    /** Minsta yta per etikett (celler): 406 och halvöppet större, eftersom de lätt blir småfläckar. */
    minCells: { [VEG_OPEN]: Math.max(2, Math.round(minCells * (options.openAreaFactor ?? 1))), [VEG_SEMI]: minCells * 2, [VEG_FOREST]: Math.round(minCells * 1.5), [VEG_SLOW]: minCells * 2,
      [VEG_DIFFICULT]: Math.round(minCells * 1.5), [VEG_FIGHT]: minCells } as Readonly<Record<number, number>>,
    /** Linjernas förenkling (celler) och hörnklippningens varv. */
    tolerance: (0.1 + 0.03 * level) * perMm, rounds: 3
  };
}

/** Gauss ungefärligt som tre lådfilter (lika breda) åt varje håll; kanten upprepas. Tiden växer inte med sigma. */
function blur(source: Float32Array, columns: number, rows: number, sigma: number): Float32Array {
  if (sigma <= 0.3) return Float32Array.from(source);
  // Bredden för tre lika lådor med samma varians som gaussen: w = sqrt(12 σ² / 3 + 1).
  const radius = Math.max(1, Math.round((Math.sqrt(4 * sigma * sigma + 1) - 1) / 2));
  let a = Float32Array.from(source), b = new Float32Array(source.length);
  const size = 2 * radius + 1;
  for (let pass = 0; pass < 3; pass += 1) {
    // Längs raderna (inom en kolumn: index i följd).
    for (let c = 0; c < columns; c += 1) {
      const base = c * rows;
      let sum = 0;
      for (let k = -radius; k <= radius; k += 1) sum += a[base + Math.min(rows - 1, Math.max(0, k))]!;
      for (let r = 0; r < rows; r += 1) {
        b[base + r] = sum / size;
        const add = r + radius + 1, drop = r - radius;
        sum += a[base + (add < rows ? add : rows - 1)]! - a[base + (drop > 0 ? drop : 0)]!;
      }
    }
    [a, b] = [b, a];
    // Längs kolumnerna: en löpande summa per rad, så att minnet läses i följd.
    const sums = new Float32Array(rows);
    for (let k = -radius; k <= radius; k += 1) {
      const base = Math.min(columns - 1, Math.max(0, k)) * rows;
      for (let r = 0; r < rows; r += 1) sums[r] = sums[r]! + a[base + r]!;
    }
    for (let c = 0; c < columns; c += 1) {
      const target = c * rows, add = Math.min(columns - 1, c + radius + 1) * rows, drop = Math.max(0, c - radius) * rows;
      for (let r = 0; r < rows; r += 1) {
        const sum = sums[r]!;
        b[target + r] = sum / size;
        sums[r] = sum + a[add + r]! - a[drop + r]!;
      }
    }
    [a, b] = [b, a];
  }
  return a;
}

/**
 * Mjuk majoritet: grönt som kapslade nivåer, öppet och halvöppet som egna, alla utjämnade med samma gauss och tröskeln 0,5,
 * normerat med de kända cellerna (vatten drar inte ner andelen vid stranden).
 */
function softMajority(labels: Uint8Array, columns: number, rows: number, sigma: number): Uint8Array {
  let any = false;
  for (let i = 0; i < labels.length && !any; i += 1) if (!labels[i]) any = true;
  const known = new Float32Array(labels.length);
  for (let i = 0; i < labels.length; i += 1) known[i] = labels[i] ? 1 : 0;
  // Utan celler utan yta är vikten 1 överallt.
  const weight = any ? blur(known, columns, rows, sigma) : known;
  const field = (test: (label: number) => boolean) => {
    const m = new Float32Array(labels.length);
    for (let i = 0; i < labels.length; i += 1) m[i] = test(labels[i]!) ? 1 : 0;
    const out = blur(m, columns, rows, sigma);
    for (let i = 0; i < out.length; i += 1) out[i] = out[i]! / (weight[i]! + 1e-6);
    return out;
  };
  const open = field(label => label === VEG_OPEN), semi = field(label => label === VEG_SEMI);
  const greens = [VEG_SLOW, VEG_DIFFICULT, VEG_FIGHT].map(level => field(label => label >= level));
  const out = new Uint8Array(labels.length);
  for (let i = 0; i < labels.length; i += 1) {
    if (!labels[i]) continue;
    const g0 = greens[0]![i]!, o = open[i]!, s = semi[i]!;
    let label: number = VEG_FOREST;
    if (g0 > 0.5) label = greens[2]![i]! > 0.5 ? VEG_FIGHT : greens[1]![i]! > 0.5 ? VEG_DIFFICULT : VEG_SLOW;
    if (s > 0.5 && s > g0) label = VEG_SEMI;
    if (o > 0.5 && o > g0) label = VEG_OPEN;
    // Blandat öppet och halvöppet utan grönt: det som är mest av dem.
    if (label === VEG_FOREST && o + s > 0.5) label = o > s ? VEG_OPEN : VEG_SEMI;
    out[i] = label;
  }
  return out;
}

const FAR = 0xffff;
/** Avståndet i tredjedels celler (3 rakt, 4 snett) från varje cell till närmaste cell där `target` är sant; två svep. */
function chamfer(target: Uint8Array, columns: number, rows: number): Uint16Array {
  const out = new Uint16Array(columns * rows);
  for (let i = 0; i < out.length; i += 1) out[i] = target[i] ? 0 : FAR;
  for (let x = 0; x < columns; x += 1) for (let y = 0; y < rows; y += 1) {
    const i = x * rows + y;
    let best = out[i]!;
    if (best === 0) continue;
    if (y > 0) best = Math.min(best, out[i - 1]! + 3);
    if (x > 0) {
      best = Math.min(best, out[i - rows]! + 3);
      if (y > 0) best = Math.min(best, out[i - rows - 1]! + 4);
      if (y + 1 < rows) best = Math.min(best, out[i - rows + 1]! + 4);
    }
    out[i] = Math.min(best, FAR);
  }
  for (let x = columns - 1; x >= 0; x -= 1) for (let y = rows - 1; y >= 0; y -= 1) {
    const i = x * rows + y;
    let best = out[i]!;
    if (best === 0) continue;
    if (y + 1 < rows) best = Math.min(best, out[i + 1]! + 3);
    if (x + 1 < columns) {
      best = Math.min(best, out[i + rows]! + 3);
      if (y + 1 < rows) best = Math.min(best, out[i + rows + 1]! + 4);
      if (y > 0) best = Math.min(best, out[i + rows - 1]! + 4);
    }
    out[i] = Math.min(best, FAR);
  }
  return out;
}

/**
 * Celler som en öppning med en skiva med radien `radius` celler tar bort, för alla etiketter på en gång (`inside` är avståndet
 * till närmaste annan etikett). En kärncell (längre än radien från kanten) når bara celler med sin egen etikett inom radien,
 * så att ett avstånd till närmaste kärna räcker.
 */
function thinCells(labels: Uint8Array, inside: Uint16Array, columns: number, rows: number, radius: number): Uint8Array {
  const limit = Math.max(1, Math.round(radius * 3)), size = columns * rows;
  const core = new Uint8Array(size);
  // `inside` räknas från cellerna längst ut i ytan, som ligger en cell (3) från grannen.
  for (let i = 0; i < size; i += 1) core[i] = labels[i] && inside[i]! + 3 > limit ? 1 : 0;
  const back = chamfer(core, columns, rows);
  const out = new Uint8Array(size);
  for (let i = 0; i < size; i += 1) if (labels[i] && back[i]! > limit) out[i] = 1;
  return out;
}

/** Högsta och lägsta etiketten (utom 0) inom en kvadrat med sidan 2 · `radius` + 1 runt varje cell, med räknare per etikett. */
function labelRange(labels: Uint8Array, columns: number, rows: number, radius: number): { high: Uint8Array; low: Uint8Array } {
  const pass = (source: Uint8Array, along: "rows" | "columns", high: boolean) => {
    const out = new Uint8Array(source.length), counts = new Int32Array(8);
    const lines = along === "rows" ? columns : rows, length = along === "rows" ? rows : columns;
    const at = (line: number, k: number) => along === "rows" ? line * rows + k : k * rows + line;
    for (let line = 0; line < lines; line += 1) {
      counts.fill(0);
      for (let k = 0; k <= Math.min(radius, length - 1); k += 1) counts[source[at(line, k)]!]! += 1;
      for (let k = 0; k < length; k += 1) {
        let value = 0;
        if (high) { for (let v = 7; v >= 1; v -= 1) if (counts[v]) { value = v; break; } }
        else { for (let v = 1; v <= 7; v += 1) if (counts[v]) { value = v; break; } }
        out[at(line, k)] = value;
        const add = k + radius + 1, drop = k - radius;
        if (add < length) counts[source[at(line, add)]!]! += 1;
        if (drop >= 0) counts[source[at(line, drop)]!]! -= 1;
      }
    }
    return out;
  };
  return { high: pass(pass(labels, "rows", true), "columns", true), low: pass(pass(labels, "rows", false), "columns", false) };
}

const NEIGHBOURS = (i: number, columns: number, rows: number, visit: (n: number) => void) => {
  const x = Math.floor(i / rows), y = i - x * rows;
  if (x > 0) visit(i - rows);
  if (x + 1 < columns) visit(i + rows);
  if (y > 0) visit(i - 1);
  if (y + 1 < rows) visit(i + 1);
};

/**
 * Cellerna i `candidate` får etiketten hos den närmaste cellen utanför `candidate` som har en annan etikett än cellen själv
 * (bredden först genom kandidaterna). En smal arm går alltså till grannen, inte tillbaka till ytan den sitter på.
 */
function reassign(labels: Uint8Array, candidate: Uint8Array, columns: number, rows: number): Uint8Array {
  const out = Uint8Array.from(labels), queue = new Int32Array(labels.length), owner = new Uint8Array(labels.length);
  const list: number[] = [];
  for (let i = 0; i < labels.length; i += 1) if (candidate[i]) list.push(i);
  for (const label of LABELS) {
    let head = 0, tail = 0, any = false;
    for (const i of list) {
      if (labels[i] !== label) continue;
      any = true;
      let best = 0;
      NEIGHBOURS(i, columns, rows, n => { if (!best && !candidate[n] && labels[n] && labels[n] !== label) best = labels[n]!; });
      if (best) { owner[i] = best; queue[tail] = i; tail += 1; }
    }
    if (!any) continue;
    while (head < tail) {
      const i = queue[head]!; head += 1;
      out[i] = owner[i]!;
      NEIGHBOURS(i, columns, rows, n => { if (candidate[n] && labels[n] === label && !owner[n]) { owner[n] = owner[i]!; queue[tail] = n; tail += 1; } });
    }
    for (let k = 0; k < tail; k += 1) owner[queue[k]!] = 0;
  }
  return out;
}

/** Smala delar och mellanband (se ovan) till grannen. */
function removeThin(labels: Uint8Array, columns: number, rows: number, minWidth: number, bandWidth: number): Uint8Array {
  const size = labels.length, edge = new Uint8Array(size);
  // Kanten: celler utan yta eller med en granne med annan etikett. Bildens kant räknas inte.
  for (let i = 0; i < size; i += 1) {
    const label = labels[i]!;
    if (!label) { edge[i] = 1; continue; }
    NEIGHBOURS(i, columns, rows, n => { if (labels[n] !== label) edge[i] = 1; });
  }
  const inside = chamfer(edge, columns, rows);
  const thin = thinCells(labels, inside, columns, rows, Math.max(0.5, minWidth / 2));
  const band = thinCells(labels, inside, columns, rows, Math.max(0.5, bandWidth / 2));
  // Ett mellanband har både en högre och en lägre etikett nära (öppet, skog och 410 kan inte vara mellanband).
  const { high, low } = labelRange(labels, columns, rows, Math.ceil(bandWidth / 2) + 1);
  const candidate = new Uint8Array(size);
  for (let i = 0; i < size; i += 1) {
    const label = labels[i]!;
    if (thin[i]) candidate[i] = 1;
    else if (band[i] && (label === VEG_SEMI || label === VEG_SLOW || label === VEG_DIFFICULT) && high[i]! > label && low[i]! < label) candidate[i] = 1;
  }
  return reassign(labels, candidate, columns, rows);
}

/** Sammanhängande ytor (fyrgrannar) mindre än sin etiketts minsta yta slås ihop med grannen, `rounds` varv. */
function removeSmall(labels: Uint8Array, columns: number, rows: number, minCells: Readonly<Record<number, number>>, rounds = 3): Uint8Array {
  let current = labels;
  const seen = new Uint8Array(labels.length), queue = new Int32Array(labels.length);
  for (let round = 0; round < rounds; round += 1) {
    seen.fill(0);
    const candidate = new Uint8Array(labels.length);
    let found = false;
    for (let start = 0; start < current.length; start += 1) {
      const label = current[start]!;
      if (!label || seen[start]) continue;
      let head = 0, tail = 1;
      queue[0] = start; seen[start] = 1;
      while (head < tail) {
        const i = queue[head]!; head += 1;
        NEIGHBOURS(i, columns, rows, n => { if (!seen[n] && current[n] === label) { seen[n] = 1; queue[tail] = n; tail += 1; } });
      }
      if (tail < (minCells[label] ?? 0)) { found = true; for (let k = 0; k < tail; k += 1) candidate[queue[k]!] = 1; }
    }
    if (!found) break;
    current = reassign(current, candidate, columns, rows);
  }
  return current;
}

/** Hela generaliseringen (punkterna 1–4 ovan). Etiketter 0 (ingen yta) rörs inte och tar inget. */
export function generalizeVegetation(labels: Uint8Array, columns: number, rows: number, options: VegetationShapeOptions): Uint8Array {
  if (options.level <= 0 || columns < 3 || rows < 3) return labels;
  const steps = vegetationShapeSteps(options);
  let current = softMajority(labels, columns, rows, steps.sigma);
  current = removeThin(current, columns, rows, steps.minWidth, steps.bandWidth);
  current = removeSmall(current, columns, rows, steps.minCells);
  for (let round = 0; round < steps.flowRounds; round += 1) current = softMajority(current, columns, rows, steps.flowSigma);
  current = removeThin(current, columns, rows, steps.minWidth, steps.bandWidth);
  return removeSmall(current, columns, rows, steps.minCells, 2);
}

/**
 * Masken för ett lager ur etiketterna. Grönt är kapslat (408 ligger inom 406). Öppet och halvöppet sträcker sig en cell in
 * under grönt, som ritas ovanpå: annars syns en vit strimma mellan gult och grönt där linjerna förenklats var för sig.
 */
export function vegetationLayerMask(labels: Uint8Array, columns: number, rows: number, layer: number): Uint8Array {
  const out = new Uint8Array(labels.length);
  if (layer >= VEG_SLOW) { for (let i = 0; i < labels.length; i += 1) if (labels[i]! >= layer) out[i] = 1; return out; }
  for (let i = 0; i < labels.length; i += 1) {
    if (labels[i] === layer) out[i] = 1;
    else if (labels[i]! >= VEG_SLOW) NEIGHBOURS(i, columns, rows, n => { if (labels[n] === layer) out[i] = 1; });
  }
  return out;
}

type Point = [number, number];
/** Douglas–Peucker för en sluten ring (utan upprepad slutpunkt): delas vid punkten längst från den första. */
export function simplifyClosed(ring: readonly Point[], tolerance: number): Point[] {
  const n = ring.length;
  if (n <= 4) return ring.slice();
  let far = 0, farDistance = -1;
  for (let i = 1; i < n; i += 1) {
    const d = Math.hypot(ring[i]![0] - ring[0]![0], ring[i]![1] - ring[0]![1]);
    if (d > farDistance) { farDistance = d; far = i; }
  }
  const keep = new Uint8Array(n + 1);
  keep[0] = 1; keep[far] = 1; keep[n] = 1;
  const at = (i: number) => ring[i % n]!;
  const stack: [number, number][] = [[0, far], [far, n]];
  while (stack.length) {
    const [from, to] = stack.pop()!;
    const [ax, ay] = at(from), [bx, by] = at(to), length = Math.hypot(bx - ax, by - ay);
    let worst = -1, distance = tolerance;
    for (let i = from + 1; i < to; i += 1) {
      const [px, py] = at(i);
      const d = length > 0 ? Math.abs((bx - ax) * (ay - py) - (ax - px) * (by - ay)) / length : Math.hypot(px - ax, py - ay);
      if (d > distance) { distance = d; worst = i; }
    }
    if (worst > 0) { keep[worst] = 1; stack.push([from, worst], [worst, to]); }
  }
  const out: Point[] = [];
  for (let i = 0; i < n; i += 1) if (keep[i]) out.push(ring[i]!);
  return out;
}

/** Hörnklippning (Chaikin) för en sluten ring utan upprepad slutpunkt. */
export function chaikinClosed(ring: readonly Point[], rounds: number): Point[] {
  let current = ring.slice();
  for (let round = 0; round < rounds; round += 1) {
    const next: Point[] = [];
    for (let i = 0; i < current.length; i += 1) {
      const [ax, ay] = current[i]!, [bx, by] = current[(i + 1) % current.length]!;
      next.push([ax * 0.75 + bx * 0.25, ay * 0.75 + by * 0.25], [ax * 0.25 + bx * 0.75, ay * 0.25 + by * 0.75]);
    }
    current = next;
  }
  return current;
}

/**
 * En ring ur maskens cellkanter (i valfria koordinater) som en ritad kurva: förenklad med `tolerance` och hörnklippt.
 * Den sista punkten upprepas inte. Tomt om ringen blir för liten.
 */
export function vegetationRing(ring: readonly Point[], tolerance: number, rounds: number): Point[] {
  const open = ring.length > 1 && ring[0]![0] === ring[ring.length - 1]![0] && ring[0]![1] === ring[ring.length - 1]![1] ? ring.slice(0, -1) : ring.slice();
  const simple = simplifyClosed(open, tolerance);
  return simple.length >= 3 ? chaikinClosed(simple, rounds) : [];
}
