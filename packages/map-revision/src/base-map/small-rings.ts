import type { SourceFeature } from "../index";

/**
 * Grundkartan G3, små slutna kurvor (ägaren 2026-11-11: «många små höjder borde ritats som punkthöjder i stället, för att minska
 * på antal täta kurvor», «kolla på standarden … orienteringskartor ska kunna läsas i fart»). Måtten är ISOM 2017-2:s minsta,
 * räknade på kartan och yttermått:
 * - höjdkurva (101): en kulle minst 0,9 mm lång och 0,6 mm bred, en grop minst 1,1 × 0,7 mm (gropen ska rymma ett lutningsstreck);
 * - formlinje (103): en kulle eller grop minst 1,1 mm lång; en mindre formlinjering tas bort;
 * - stödkurva (102): små kullar och gropar ritas normalt inte med stödkurvan, så en liten sådan ring blir en vanlig höjdkurva.
 * En för liten höjdkurva blir liten kulle (`dotknoll`, 109) eller liten grop (`udepression`, 111), utan dubblett där
 * Karttapullautins egen knoll eller grop redan ligger. Kulle eller grop avgörs av lagret (Karttapullautins `depression`) eller av
 * den närmaste omslutande kurvan, annars av närmaste kurva med annan höjd inom 40 m. Mellankurvorna (`_intermed`) visas inte och
 * rörs inte. Måtten räknas med en marginal (`GENERALIZE`, 20 %) över normens minsta, så att kartan generaliseras något och går att
 * läsa i fart (ägaren 2026-11-11).
 */
export const GENERALIZE = 1.2;
const CONTOUR = /^(contour|depression)(_index)?$/;
const FORMLINE = /^formline$/;
const ANY = /^(contour|depression)(_index|_intermed)?$/;
const NEAR_METERS = 40;
/** Minsta längd och bredd i mm för kulle och grop. */
export const ISOM_RINGS = { knoll: [0.9, 0.6], depression: [1.1, 0.7], formline: [1.1, 0] } as const;
type Ring = readonly (readonly [number, number])[];

/** Ringens yta (i koordinaternas enhet i kvadrat). */
export const ringArea = (ring: Ring) => Math.abs(ring.reduce((sum, [x, y], i) => { const [nx, ny] = ring[(i + 1) % ring.length]!; return sum + x * ny - nx * y; }, 0)) / 2;
const centreOf = (ring: Ring): [number, number] => [ring.reduce((sum, p) => sum + p[0], 0) / ring.length, ring.reduce((sum, p) => sum + p[1], 0) / ring.length];
function inside(ring: Ring, x: number, y: number): boolean {
  let hit = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const [xi, yi] = ring[i]!, [xj, yj] = ring[j]!;
    if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) hit = !hit;
  }
  return hit;
}
/** Längd och bredd: största och minsta utsträckning över riktningar var femte grad. */
export function extentOf(ring: Ring): { length: number; width: number } {
  let length = 0, width = Infinity;
  for (let degree = 0; degree < 180; degree += 5) {
    const [c, s] = [Math.cos(degree * Math.PI / 180), Math.sin(degree * Math.PI / 180)];
    const along = ring.map(([x, y]) => x * c + y * s);
    const span = Math.max(...along) - Math.min(...along);
    length = Math.max(length, span); width = Math.min(width, span);
  }
  return { length, width };
}

/**
 * Ägaren 2026-11-13 («små höjder sluts aldrig i form»): Karttapullautins formlinjer slutar där marken planar ut, så en liten kulle
 * blir en krok som nästan når runt. En kort öppen formlinje (högst 8 mm på kartan) vars ändar ligger nära varandra (högst 1 mm
 * och högst en tredjedel av längden) sluts.
 */
export function closeFormlineHooks(features: readonly SourceFeature[], scale: number): SourceFeature[] {
  const mm = (value: number) => value * scale / 1000;
  return features.map(feature => {
    const geometry = feature.geometry;
    if (!FORMLINE.test(feature.layer) || geometry.kind !== "line" || geometry.closed || geometry.points.length < 4) return feature;
    const points = geometry.points, first = points[0]!, last = points[points.length - 1]!;
    const length = points.reduce((sum, point, i) => i === 0 ? 0 : sum + Math.hypot(point[0] - points[i - 1]![0], point[1] - points[i - 1]![1]), 0);
    const gap = Math.hypot(last[0] - first[0], last[1] - first[1]);
    return length <= mm(8) && gap <= mm(1) && gap <= length / 3 ? { ...feature, geometry: { ...geometry, closed: true } } : feature;
  });
}

const POINT_AT = (feature: SourceFeature) => (feature.geometry as { at: readonly [number, number] }).at;
/** Punkthöjder (109) i grundkartan: Karttapullautins och laserns. */
const KNOLL_POINT = /^dotknoll(_laser)?$/i;
const STONE = /^(sten|stort_block)$/;

/**
 * Ägaren 2026-11-13: «punkthöjder hamnar ofta på små vanliga höjder … det vanliga ska bort om de redovisas som punkthöjd» och
 * «sten och punkthöjd på varandra kan inte stämma, programmet måste välja».
 * - En liten sluten kurva eller formlinje (högst 2,5 mm lång på kartan, utan någon annan kurva inuti) som har en punkthöjd i sig
 *   tas bort: kullen visas med punkten.
 * - En sten och en punkthöjd inom 0,4 mm på kartan är samma upphöjning. Laserns kulle (prövad mot markmodellen med fot och
 *   höjd) vinner över stenen; stenen vinner över Karttapullautins knoll, som också tar små block.
 */
export function oneMarkPerKnoll(features: readonly SourceFeature[], scale: number): SourceFeature[] {
  const mm = (value: number) => value * scale / 1000;
  const knolls = features.filter(feature => feature.geometry.kind === "point" && KNOLL_POINT.test(feature.layer));
  const stones = features.filter(feature => feature.geometry.kind === "point" && STONE.test(feature.layer));
  const near = (a: SourceFeature, b: SourceFeature) => { const [ax, ay] = POINT_AT(a), [bx, by] = POINT_AT(b); return Math.hypot(ax - bx, ay - by) <= mm(0.4); };
  const dropped = new Set<SourceFeature>();
  for (const stone of stones) {
    const hit = knolls.find(knoll => near(stone, knoll));
    if (!hit) continue;
    dropped.add(/_laser$/i.test(hit.layer) ? stone : hit);
  }
  const marks = knolls.filter(knoll => !dropped.has(knoll)).map(POINT_AT);
  const rings = features.filter(feature => feature.geometry.kind === "line" && feature.geometry.closed && (CONTOUR.test(feature.layer) || FORMLINE.test(feature.layer)));
  const ringOf = (feature: SourceFeature) => (feature.geometry as { points: Ring }).points;
  for (const feature of rings) {
    const ring = ringOf(feature);
    if (extentOf(ring).length > mm(2.5) || !marks.some(([x, y]) => inside(ring, x, y))) continue;
    // En ring med en annan ring inuti är en del av en större form, inte en enskild liten kulle.
    if (rings.some(other => other !== feature && ringOf(other).every(([x, y]) => inside(ring, x, y)))) continue;
    dropped.add(feature);
  }
  return features.filter(feature => !dropped.has(feature));
}

/** `scale` är kartans skala (t.ex. 10000); kurvorna i meter. */
export function smallRingsToPoints(input: readonly SourceFeature[], scale: number, generalize = GENERALIZE): SourceFeature[] {
  const features = closeFormlineHooks(input, scale);
  const meters = (mm: number) => mm * generalize * scale / 1000;
  const ringOf = (feature: SourceFeature) => (feature.geometry as { points: Ring }).points;
  const levelled = features.filter(feature => feature.geometry.kind === "line" && ANY.test(feature.layer) && feature.elevation !== undefined);
  const rings = levelled.filter(feature => feature.geometry.kind === "line" && feature.geometry.closed)
    .map(feature => ({ feature, ring: ringOf(feature), area: ringArea(ringOf(feature)) }));
  const marks: (readonly [number, number])[] = features.filter(feature => feature.geometry.kind === "point" && /DOTKNOLL|DEPRESSION/i.test(feature.layer))
    .map(feature => (feature.geometry as { at: readonly [number, number] }).at);
  const replaced = new Map<SourceFeature, SourceFeature | undefined>(), added: SourceFeature[] = [];

  /** Kulle (sant), grop (falskt) eller okänt. */
  const isKnoll = (feature: SourceFeature, ring: Ring): boolean | undefined => {
    if (/^depression/.test(feature.layer)) return false;
    const height = feature.elevation;
    if (height === undefined) return undefined;
    const [cx, cy] = centreOf(ring), area = ringArea(ring);
    const around = rings.filter(other => other.area > area && other.feature.elevation !== height && inside(other.ring, cx, cy))
      .sort((a, b) => a.area - b.area)[0];
    let outside = around?.feature.elevation;
    if (outside === undefined) {
      let best = NEAR_METERS;
      for (const other of levelled) {
        if (other.elevation === height) continue;
        for (const [x, y] of ringOf(other)) {
          const distance = Math.hypot(x - cx, y - cy);
          if (distance < best) { best = distance; outside = other.elevation; }
        }
      }
    }
    return outside === undefined ? undefined : outside < height;
  };

  for (const feature of features) {
    if (feature.geometry.kind !== "line" || !feature.geometry.closed || feature.geometry.points.length < 3) continue;
    const contour = CONTOUR.test(feature.layer), formline = FORMLINE.test(feature.layer);
    if (!contour && !formline) continue;
    const ring = ringOf(feature);
    const { length, width } = extentOf(ring);
    if (formline) { if (length < meters(ISOM_RINGS.formline[0])) replaced.set(feature, undefined); continue; }
    const knoll = isKnoll(feature, ring);
    const [minLength, minWidth] = knoll === false ? ISOM_RINGS.depression : ISOM_RINGS.knoll;
    if (length >= meters(minLength) && width >= meters(minWidth)) {
      // En stödkurva runt en liten kulle eller grop (kortare än 2,2 mm) blir en vanlig höjdkurva (ISOM 102).
      if (/_index$/.test(feature.layer) && length < meters(2 * ISOM_RINGS.depression[0])) replaced.set(feature, { ...feature, layer: feature.layer.replace(/_index$/, "") });
      continue;
    }
    if (knoll === undefined) continue;
    replaced.set(feature, undefined);
    if (marks.some(([x, y]) => inside(ring, x, y))) continue;
    const centre = centreOf(ring);
    marks.push(centre);
    added.push({ layer: knoll ? "dotknoll" : "udepression", geometry: { kind: "point", at: centre } });
  }
  // Laserns egna små kullar (scripts/geo-rock.ts, `dotknoll_laser`) tas bort där Karttapullautin redan har en inom 6 m eller
  // där en kvarvarande liten höjdkurva (under 3 000 m²) redan visar toppen.
  const kept = features.flatMap(feature => !replaced.has(feature) ? [feature] : replaced.get(feature) ? [replaced.get(feature)!] : []);
  const summits = kept.filter(feature => feature.geometry.kind === "line" && feature.geometry.closed && CONTOUR.test(feature.layer) && ringArea(ringOf(feature)) < 3000).map(ringOf);
  const others = [...kept, ...added].filter(feature => feature.geometry.kind === "point" && /DOTKNOLL/i.test(feature.layer) && feature.layer !== "dotknoll_laser")
    .map(feature => (feature.geometry as { at: readonly [number, number] }).at);
  // Kvar: en liten kurva som har en punkthöjd i sig tas bort (punkten visar kullen), och sten eller punkthöjd väljs (`oneMarkPerKnoll`).
  const small = (ring: Ring) => extentOf(ring).length <= scale * 2.5 / 1000;
  return oneMarkPerKnoll([...kept.filter(feature => {
    if (feature.layer !== "dotknoll_laser" || feature.geometry.kind !== "point") return true;
    const [x, y] = feature.geometry.at;
    return !others.some(([ox, oy]) => Math.hypot(ox - x, oy - y) < 6) && !summits.some(ring => !small(ring) && inside(ring, x, y));
  }), ...added], scale);
}
