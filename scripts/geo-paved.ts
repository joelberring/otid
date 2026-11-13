/**
 * Belagd yta ur laserns intensitet, för sprintkartor (ägaren 2026-11-13). Laserns intensitet på markträffar skiljer asfalt
 * (mörk) från gräs (ljus). Mätt mot sprintkartan Bandhagen–Hagsätra (ISSprOM 2019): regeln här ger belagd yta med precision
 * 0,75 och täckning 0,52 per 2 m-cell; 11 % av det utpekade är tomtmark (uppfarter). OpenStreetMap ger var gatorna går men
 * bara med antagen bredd; lasern ger den verkliga ytan. Resultatet är kandidater (`belagt.dxf`, lagret `belagd_yta_laser`).
 *
 * Regeln, i punktstatistikens 2 m-celler (geo-points.ts, samma mått som bilderna lasveg och lasmark):
 * 1. Öppen cell: har punkter, markträffarnas andel minst 200/255, vegetationens höjd högst 0,6 m, inte vatten. Hus faller
 *    bort av samma villkor: under ett tak finns inga markträffar (cellen saknar punkter eller har markandelen 0 och allt över 3 m).
 * 2. Intensiteten (markträffarnas medel / 64, 0–255) medianfiltreras 3 × 3 över cellerna som har markträffar.
 * 3. Gränsen anpassas till skanningen (intensitetens skala skiljer mellan skannrar): den mörka toppen är värdet med flest
 *    öppna celler på den mörka sidan om Otsu-gränsen för de öppna cellernas histogram, och gränsen är 2,5 × toppen, aldrig
 *    över Otsu-gränsen och aldrig under 1,5 × toppen (Bandhagen: topp 23, Otsu 90, gräns 57). Utan tydliga två toppar (för
 *    få öppna celler, Otsu-gränsen under 1,5 × toppen eller för få mörka celler) ges ingen belagd yta alls.
 * 4. Belagd = öppen med filtrerad intensitet under gränsen; öppnas ett steg, hål under 20 m² fylls, ytor under 40 m² tas bort.
 * 5. Ytorna blir ringar (ytterkanter moturs, hål medurs) i SWEREF 99 TM med jämna kanter (`pavedRings`).
 *
 * Bara Nodes egna moduler (filen körs direkt av Node i avbildningen `otid-geo`).
 */
import { openMask } from "./geo-generalize.ts";
import { maskRings, simplify } from "./geo-moisture.ts";
import { smoothMaskRings } from "./geo-paved-contour.ts";
import { generalizePavedRing, signedArea } from "./geo-paved-generalize.ts";
import { POINT_BANDS, type PointStats } from "./geo-points.ts";

export interface PavedSettings {
  /** Markträffarnas andel (0–255) och vegetationens högsta höjd (m) för en öppen cell. */
  readonly groundShare: number; readonly maxHeightM: number;
  /** Gränsen som faktor på den mörka toppen, och dess golv. */
  readonly peakFactor: number; readonly minPeakFactor: number;
  /** Färre öppna celler än så, eller en mindre andel mörka celler, räknas inte som två toppar. */
  readonly minOpenCells: number; readonly minDarkShare: number;
  readonly fillHoleM2: number; readonly minAreaM2: number;
}
export const DEFAULT_PAVED: PavedSettings = { groundShare: 200, maxHeightM: 0.6, peakFactor: 2.5, minPeakFactor: 1.5, minOpenCells: 2000,
  minDarkShare: 0.05, fillHoleM2: 20, minAreaM2: 40 };

/**
 * Otsu-gränsen för ett histogram: värdet t som bäst delar det i «högst t» och «över t»; inget när allt ligger i ett värde.
 * Ger flera värden samma delning (inget ligger mellan topparna) tas det mittersta.
 */
export function otsuThreshold(histogram: ArrayLike<number>): number | undefined {
  let total = 0, sum = 0;
  for (let value = 0; value < histogram.length; value += 1) { total += histogram[value]!; sum += value * histogram[value]!; }
  let best = -1, first: number | undefined, last = 0, below = 0, belowSum = 0;
  for (let value = 0; value < histogram.length - 1; value += 1) {
    below += histogram[value]!; belowSum += value * histogram[value]!;
    const above = total - below;
    if (below === 0 || above === 0) continue;
    const between = below * above * (belowSum / below - (sum - belowSum) / above) ** 2;
    if (between > best * (1 + 1e-12)) { best = between; first = value; last = value; }
    else if (between >= best * (1 - 1e-12)) last = value;
  }
  return first === undefined ? undefined : Math.floor((first + last) / 2);
}

/** Gränsen för belagd yta ur de öppna cellernas histogram (punkt 3 ovan), eller varför ingen gräns går att sätta. */
export function pavedLimit(histogram: ArrayLike<number>, settings: PavedSettings = DEFAULT_PAVED)
  : { readonly limit: number; readonly darkPeak: number; readonly otsu: number } | { readonly limit: undefined; readonly reason: string } {
  let open = 0;
  for (let value = 0; value < histogram.length; value += 1) open += histogram[value]!;
  if (open < settings.minOpenCells) return { limit: undefined, reason: "för få öppna celler" };
  const otsu = otsuThreshold(histogram);
  if (otsu === undefined) return { limit: undefined, reason: "en enda intensitet" };
  let darkPeak = 0;
  for (let value = 1; value <= otsu; value += 1) if (histogram[value]! > histogram[darkPeak]!) darkPeak = value;
  // Golvet över taket: Otsu-gränsen ligger i toppens egen sluttning, alltså en topp och inte två.
  if (darkPeak <= 0 || settings.minPeakFactor * darkPeak > otsu) return { limit: undefined, reason: "ingen mörk topp" };
  const limit = Math.max(settings.minPeakFactor * darkPeak, Math.min(settings.peakFactor * darkPeak, otsu));
  let dark = 0;
  for (let value = 0; value <= limit; value += 1) dark += histogram[value]!;
  if (dark < settings.minDarkShare * open) return { limit: undefined, reason: "för få mörka celler" };
  return { limit, darkPeak, otsu };
}

/**
 * Sammanhängande delar (fyra grannar) av cellerna med `mask[i] === value`. `each` får delens celler (de första `count` i
 * `queue`) och om delen når bildens kant.
 */
function components(mask: Uint8Array, width: number, height: number, value: number, each: (queue: Int32Array, count: number, edge: boolean) => void): void {
  const seen = new Uint8Array(mask.length), queue = new Int32Array(mask.length);
  for (let start = 0; start < mask.length; start += 1) {
    if (mask[start] !== value || seen[start]) continue;
    let head = 0, tail = 1, edge = false;
    queue[0] = start; seen[start] = 1;
    while (head < tail) {
      const i = queue[head]!; head += 1;
      const x = Math.floor(i / height), y = i - x * height;
      if (x === 0 || y === 0 || x + 1 === width || y + 1 === height) edge = true;
      for (const n of [x > 0 ? i - height : -1, x + 1 < width ? i + height : -1, y > 0 ? i - 1 : -1, y + 1 < height ? i + 1 : -1]) {
        if (n >= 0 && mask[n] === value && !seen[n]) { seen[n] = 1; queue[tail] = n; tail += 1; }
      }
    }
    each(queue, tail, edge);
  }
}

export type PavedRingSource = "generalized" | "smoothed" | "raster";
/** Ringarnas sammanlagda yta (ytterkanter minus hål) får avvika så här mycket från maskens. */
export const PAVED_AREA_TOLERANCE = 0.1;
const ringsArea = (rings: readonly (readonly (readonly [number, number])[])[]) => rings.reduce((sum, ring) => sum + signedArea(ring), 0);

/**
 * Maskens ytor som ringar i meter (ytterkanter moturs, hål medurs). Kanten jämnas ut och dras mellan cellerna
 * (geo-paved-contour.ts), förenklas, och ringar under minsta ytan eller med färre än fyra punkter tas bort; sedan räta
 * vinklar och rektanglar där ytan är sådan (geo-paved-generalize.ts). Skydd på helheten: avviker ringarnas sammanlagda yta
 * mer än 10 % från maskens används ringarna utan räta vinklar och rektanglar («smoothed»), och avviker också de används
 * rasterkanten («raster», som berg i dagen). `minX`, `minY` är mitten av cellen (0, 0).
 */
export function pavedRings(mask: Uint8Array, grid: { readonly minX: number; readonly minY: number; readonly cell: number; readonly width: number; readonly height: number },
  settings: Pick<PavedSettings, "minAreaM2"> = DEFAULT_PAVED): { rings: [number, number][][]; source: PavedRingSource; maskM2: number } {
  let cells = 0;
  for (let i = 0; i < mask.length; i += 1) cells += mask[i]!;
  const maskM2 = cells * grid.cell * grid.cell;
  if (cells === 0) return { rings: [], source: "generalized", maskM2 };
  const close = (rings: readonly (readonly (readonly [number, number])[])[]) => Math.abs(ringsArea(rings) - maskM2) <= PAVED_AREA_TOLERANCE * maskM2;
  const smooth = smoothMaskRings(mask, grid);
  for (const source of ["generalized", "smoothed"] as const) {
    const rings = smooth.map(ring => generalizePavedRing(ring, undefined, source === "generalized"))
      .filter(ring => ring.length >= 4 && Math.abs(signedArea(ring)) >= settings.minAreaM2);
    if (close(rings)) return { rings, source, maskM2 };
  }
  const raster = maskRings(mask, { ...grid, z: new Float64Array(0) }).map(ring => simplify(ring, grid.cell * 0.75)).filter(ring => ring.length >= 4);
  return { rings: raster, source: "raster", maskM2 };
}

export interface PavedResult {
  /** Ringarna i meter (SWEREF 99 TM): ytterkanter moturs, hål medurs; och hur de togs fram (`pavedRings`). */
  readonly rings: [number, number][][]; readonly source: PavedRingSource;
  /** Masken på statistikens celler (index x · höjd + y), för tester och summering. */
  readonly mask: Uint8Array;
  readonly pavedHa: number; readonly openCells: number;
  /** Den valda gränsen (intensitet / 64), den mörka toppen och Otsu-gränsen; saknas när ingen belagd yta ges. */
  readonly limit?: number | undefined; readonly darkPeak?: number | undefined; readonly otsu?: number | undefined;
  readonly reason?: string | undefined;
}

/** Belagd yta ur punktstatistiken. `water` säger om punkten (meter) ligger i vatten. */
export function pavedFromPoints(stats: PointStats, water?: (x: number, y: number) => boolean, settings: PavedSettings = DEFAULT_PAVED): PavedResult {
  const { width, height, cell, values } = stats, size = width * height;
  // Intensiteten som i lasmark-bildens gröna kanal; -1 där cellen saknar markträffar.
  const intensity = new Int16Array(size).fill(-1), open = new Uint8Array(size);
  for (let x = 0; x < width; x += 1) for (let y = 0; y < height; y += 1) {
    const i = x * height + y, o = i * POINT_BANDS, n = values[o + 1]!, ground = values[o + 2]!;
    if (!(n > 0) || !(ground > 0) || !Number.isFinite(values[o + 6]!)) continue;
    intensity[i] = Math.max(0, Math.min(255, Math.round(values[o + 6]! / 64)));
    const top = Number.isFinite(values[o]!) ? values[o]! : 0;
    if (Math.round(255 * ground / n) >= settings.groundShare && top <= settings.maxHeightM
      && !water?.(stats.minX + (x + 0.5) * cell, stats.minY + (y + 0.5) * cell)) open[i] = 1;
  }
  const filtered = new Uint8Array(size), histogram = new Uint32Array(256), near: number[] = [];
  let openCells = 0;
  for (let x = 0; x < width; x += 1) for (let y = 0; y < height; y += 1) {
    const i = x * height + y;
    if (!open[i]) continue;
    near.length = 0;
    for (let dx = -1; dx <= 1; dx += 1) for (let dy = -1; dy <= 1; dy += 1) {
      const nx = x + dx, ny = y + dy;
      if (nx >= 0 && ny >= 0 && nx < width && ny < height && intensity[nx * height + ny]! >= 0) near.push(intensity[nx * height + ny]!);
    }
    near.sort((a, b) => a - b);
    const median = near[Math.floor(near.length / 2)]!;
    filtered[i] = median; histogram[median] = histogram[median]! + 1; openCells += 1;
  }
  const chosen = pavedLimit(histogram, settings);
  if (chosen.limit === undefined) return { rings: [], source: "generalized", mask: new Uint8Array(size), pavedHa: 0, openCells, reason: chosen.reason };
  const raw = new Uint8Array(size);
  for (let i = 0; i < size; i += 1) if (open[i] && filtered[i]! <= chosen.limit) raw[i] = 1;
  // Ett steg öppning tar bort enstaka celler; sedan fylls små hål och små ytor tas bort.
  const mask = openMask(raw, width, height, 1), area = cell * cell;
  components(mask, width, height, 0, (queue, count, edge) => {
    if (!edge && count * area < settings.fillHoleM2) for (let k = 0; k < count; k += 1) mask[queue[k]!] = 1;
  });
  components(mask, width, height, 1, (queue, count) => {
    if (count * area < settings.minAreaM2) for (let k = 0; k < count; k += 1) mask[queue[k]!] = 0;
  });
  let cells = 0;
  for (let i = 0; i < size; i += 1) cells += mask[i]!;
  // Rutnätet med cellernas mitt i origo (statistikens origo är cellens hörn).
  const { rings, source } = pavedRings(mask, { minX: stats.minX + cell / 2, minY: stats.minY + cell / 2, cell, width, height }, settings);
  return { rings, source, mask, pavedHa: Math.round(cells * area / 100) / 100, openCells, limit: Math.round(chosen.limit * 10) / 10, darkPeak: chosen.darkPeak, otsu: chosen.otsu };
}
