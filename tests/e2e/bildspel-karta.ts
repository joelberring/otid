import { applyMapRevision, newMapFile, readMapFile, sha256Hex, type Path, type RevisionGeometry } from "../../packages/map-file/src/index";

/**
 * En påhittad skogskarta för bildspelet på startsidan (`bildspel.spec.ts`): «Tallbacken», ISOM 2017-2 i 1:10 000, 240 × 170 mm.
 * Terrängen är en räknad höjdmodell (kullar, en sänka med en sjö och en tjärn, lite brus), så kurvorna, sjöarna, branterna och
 * stenarna hänger ihop. Grönt, öppen mark, sankmark, vägar och stigar är utlagda för hand. Inget av det finns på riktigt;
 * georeferensen är bara till för att fältläget ska kunna visa en position. Samma fil varje gång (ingen slump utan frö).
 */

/** Kartans område i mm (y uppåt) runt referenspunkten. */
export const DEMO_MAP_BOUNDS = { minX: -120, maxX: 120, minY: -85, maxY: 85 } as const;
/** Referenspunkten i SWEREF 99 TM (påhittat område i Mälardalen). */
export const DEMO_MAP_REF = { easting: 648_000, northing: 6_590_000 } as const;
export const DEMO_MAP_SCALE = 10_000;

type XY = readonly [number, number];

const HILLS: readonly (readonly [number, number, number, number])[] = [
  [-70, 40, 34, 22], [-20, -38, 26, 17], [48, 45, 40, 24], [88, -30, 30, 19], [8, 62, 16, 11], [-96, -52, 22, 14],
  [62, -70, 16, 12], [-48, -6, 12, 9], [100, 30, 14, 10], [-5, -70, 12, 10], [30, -20, 10, 8],
  // Sänkorna: sjön och tjärnen.
  [-6, 12, -30, 17], [16, 4, -26, 13], [-68, -16, -18, 7]
];

/** Höjden i meter i en punkt (kartans mm). */
export function demoHeight(x: number, y: number): number {
  let h = 40 + 0.05 * x;
  for (const [cx, cy, amp, sigma] of HILLS) h += amp * Math.exp(-((x - cx) ** 2 + (y - cy) ** 2) / (2 * sigma * sigma));
  h += 1.8 * Math.sin(x / 6.3 + 1.1) * Math.cos(y / 7.7 - 0.4) + 1.2 * Math.sin((x + y) / 4.1) + 0.8 * Math.cos((x - 2 * y) / 3.3 + 0.7);
  return h;
}

/** Sjön och tjärnen: mittpunkten och vattenytan (meter över botten). */
const WATERS: readonly { at: XY; depth: number }[] = [{ at: [2, 8], depth: 9 }, { at: [-68, -16], depth: 3.5 }];

/** Fröat slumptal (0–1), samma följd varje gång. */
function random(seed: number): () => number {
  let state = seed >>> 0;
  return () => { state = (state * 1_664_525 + 1_013_904_223) >>> 0; return state / 2 ** 32; };
}

/** Kurvorna för en nivå med marching squares på ett rutnät (steg i mm); slutna ringar och öppna linjer mot kanten. */
function isolines(level: number, step = 1): { closed: boolean; points: XY[] }[] {
  const { minX, maxX, minY, maxY } = DEMO_MAP_BOUNDS;
  const nx = Math.round((maxX - minX) / step), ny = Math.round((maxY - minY) / step);
  const value: number[][] = [];
  for (let i = 0; i <= nx; i += 1) {
    value.push([]);
    for (let j = 0; j <= ny; j += 1) value[i]!.push(demoHeight(minX + i * step, minY + j * step) - level);
  }
  const at = (i: number, j: number): XY => [minX + i * step, minY + j * step];
  const cut = (a: XY, b: XY, va: number, vb: number): XY => { const t = va / (va - vb); return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]; };
  // Kantpunkterna: h = vågrät kant (i,j)-(i+1,j), v = lodrät kant (i,j)-(i,j+1).
  const point = new Map<string, XY>();
  const edgePoint = (key: string): XY => {
    const known = point.get(key);
    if (known) return known;
    const [kind, si, sj] = key.split(",");
    const i = Number(si), j = Number(sj);
    const found = kind === "h" ? cut(at(i, j), at(i + 1, j), value[i]![j]!, value[i + 1]![j]!) : cut(at(i, j), at(i, j + 1), value[i]![j]!, value[i]![j + 1]!);
    point.set(key, found);
    return found;
  };
  const links = new Map<string, string[]>();
  const link = (a: string, b: string) => {
    for (const [from, to] of [[a, b], [b, a]] as const) { const list = links.get(from) ?? []; list.push(to); links.set(from, list); }
  };
  for (let i = 0; i < nx; i += 1) {
    for (let j = 0; j < ny; j += 1) {
      const v0 = value[i]![j]!, v1 = value[i + 1]![j]!, v2 = value[i + 1]![j + 1]!, v3 = value[i]![j + 1]!;
      const bottom = `h,${i},${j}`, right = `v,${i + 1},${j}`, top = `h,${i},${j + 1}`, left = `v,${i},${j}`;
      const code = (v0 > 0 ? 1 : 0) | (v1 > 0 ? 2 : 0) | (v2 > 0 ? 4 : 0) | (v3 > 0 ? 8 : 0);
      const center = (v0 + v1 + v2 + v3) / 4 > 0;
      switch (code) {
        case 1: case 14: link(left, bottom); break;
        case 2: case 13: link(bottom, right); break;
        case 3: case 12: link(left, right); break;
        case 4: case 11: link(right, top); break;
        case 6: case 9: link(bottom, top); break;
        case 7: case 8: link(left, top); break;
        case 5: if (center) { link(left, top); link(bottom, right); } else { link(left, bottom); link(right, top); } break;
        case 10: if (center) { link(left, bottom); link(right, top); } else { link(left, top); link(bottom, right); } break;
        default: break;
      }
    }
  }
  const used = new Set<string>();
  const lines: { closed: boolean; points: XY[] }[] = [];
  const walk = (start: string): { closed: boolean; keys: string[] } => {
    const keys = [start];
    used.add(start);
    let current = start;
    for (;;) {
      const next = (links.get(current) ?? []).find(key => !used.has(key));
      if (!next) break;
      used.add(next);
      keys.push(next);
      current = next;
    }
    const closed = keys.length > 2 && (links.get(current) ?? []).includes(start);
    return { closed, keys };
  };
  // Öppna linjer börjar i en ände (en enda granne), sedan de slutna.
  for (const [key, list] of links) if (list.length === 1 && !used.has(key)) { const { keys } = walk(key); lines.push({ closed: false, points: keys.map(edgePoint) }); }
  for (const key of links.keys()) if (!used.has(key)) { const { closed, keys } = walk(key); lines.push({ closed, points: keys.map(edgePoint) }); }
  return lines.filter(line => line.points.length >= 4);
}

/** Chaikins utjämning (öppen eller sluten). */
function smooth(points: readonly XY[], closed: boolean, rounds = 2): XY[] {
  let current = [...points];
  for (let round = 0; round < rounds; round += 1) {
    const next: XY[] = closed ? [] : [current[0]!];
    const count = closed ? current.length : current.length - 1;
    for (let index = 0; index < count; index += 1) {
      const a = current[index]!, b = current[(index + 1) % current.length]!;
      next.push([a[0] * 0.75 + b[0] * 0.25, a[1] * 0.75 + b[1] * 0.25], [a[0] * 0.25 + b[0] * 0.75, a[1] * 0.25 + b[1] * 0.75]);
    }
    if (!closed) next.push(current.at(-1)!);
    current = next;
  }
  return current;
}

/** Glesa ut: en punkt per `spacing` mm. */
function thin(points: readonly XY[], spacing = 0.6): XY[] {
  const kept: XY[] = [points[0]!];
  for (const point of points.slice(1, -1)) {
    const last = kept.at(-1)!;
    if (Math.hypot(point[0] - last[0], point[1] - last[1]) >= spacing) kept.push(point);
  }
  kept.push(points.at(-1)!);
  return kept;
}

const pathOf = (points: readonly XY[]): Path => points.map(([x, y], index) => ({ type: index === 0 ? "M" as const : "L" as const, x: round(x), y: round(y) }));
const round = (value: number) => Math.round(value * 100) / 100;

/** En klump: en cirkel vars radie varierar mjukt runt om. */
function blob(cx: number, cy: number, radius: number, seed: number, stretch = 1): XY[] {
  const next = random(seed);
  const waves = [1, 2, 3, 5].map(k => ({ k, amp: (0.07 + next() * 0.14) / Math.sqrt(k), phase: next() * Math.PI * 2 }));
  const angle = next() * Math.PI;
  const points: XY[] = [];
  for (let step = 0; step < 72; step += 1) {
    const t = (step / 72) * Math.PI * 2;
    const r = radius * (1 + waves.reduce((sum, wave) => sum + wave.amp * Math.sin(wave.k * t + wave.phase), 0));
    const px = Math.cos(t) * r * stretch, py = Math.sin(t) * r;
    points.push([cx + px * Math.cos(angle) - py * Math.sin(angle), cy + px * Math.sin(angle) + py * Math.cos(angle)]);
  }
  return points;
}

/** En linje genom stödpunkterna, mjukad och med en liten slingring. */
function trail(points: readonly XY[], seed: number, wiggle = 1.2): XY[] {
  const next = random(seed);
  const dense: XY[] = [];
  for (let index = 0; index < points.length - 1; index += 1) {
    const a = points[index]!, b = points[index + 1]!;
    const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const steps = Math.max(2, Math.round(length / 3));
    for (let step = 0; step < steps; step += 1) {
      const t = step / steps;
      const side = index === 0 && step === 0 ? 0 : (next() - 0.5) * wiggle;
      dense.push([a[0] + (b[0] - a[0]) * t - ((b[1] - a[1]) / length) * side, a[1] + (b[1] - a[1]) * t + ((b[0] - a[0]) / length) * side]);
    }
  }
  dense.push(points.at(-1)!);
  return smooth(dense, false, 3);
}

const rectangle = (cx: number, cy: number, w: number, h: number, angle: number): XY[] => {
  const c = Math.cos(angle), s = Math.sin(angle);
  return [[-w / 2, -h / 2], [w / 2, -h / 2], [w / 2, h / 2], [-w / 2, h / 2]].map(([x, y]) => [cx + x! * c - y! * s, cy + x! * s + y! * c] as XY);
};

const inside = (point: XY, ring: readonly XY[]) => {
  let hit = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const [xi, yi] = ring[i]!, [xj, yj] = ring[j]!;
    if ((yi > point[1]) !== (yj > point[1]) && point[0] < ((xj - xi) * (point[1] - yi)) / (yj - yi) + xi) hit = !hit;
  }
  return hit;
};

/**
 * Kartfilen (.omap) med alla objekt. Med `terrain: false` bara det som en ny grundkarta börjar med före laserkörningen (vägar,
 * stigar, gården, åkern, sjöarna och bäcken, som ur OpenStreetMap och Lantmäteriet): bildspelets bild av guiden Ny grundkarta.
 */
export function demoMapFile({ terrain = true }: { terrain?: boolean } = {}): Uint8Array {
  const base = newMapFile({ symbolSet: "ISOM2017-2", scale: DEMO_MAP_SCALE, refPoint: DEMO_MAP_REF,
    notes: "Påhittad karta «Tallbacken» för O-Tids bildspel. Terrängen är räknad och finns inte på riktigt." });
  const map = readMapFile(base, "tallbacken.omap");
  const symbolOf = (code: string) => {
    const [main, sub = "0"] = code.split(".");
    const found = [...map.symbols.values()].find(entry => entry.code.main === Number(main) && entry.code.sub === Number(sub));
    if (!found) throw new Error(`Symbolen ${code} saknas`);
    return found.id;
  };
  const changes: Parameters<typeof applyMapRevision>[1]["changes"][number][] = [];
  const add = (code: string, geometry: RevisionGeometry) => changes.push({ kind: "add", id: `o${changes.length}`, author: "bildspel",
    at: "2026-11-24T00:00:00.000Z", symbol: symbolOf(code), geometry });
  const area = (code: string, ring: readonly XY[]) => add(code, { kind: "area", rings: [pathOf(ring)] });
  const line = (code: string, points: readonly XY[]) => add(code, { kind: "line", path: pathOf(points) });
  const point = (code: string, [x, y]: XY) => add(code, { kind: "point", at: { x: round(x), y: round(y) } });

  // Vegetationen först (ligger under i färgordningen ändå).
  const field = blob(-98, 58, 16, 11, 1.4);
  area("401", field);
  area("401", blob(-30, 72, 7, 12, 1.6));
  if (terrain) {
    for (const [x, y, r, seed] of [[96, 58, 10, 21], [32, -62, 7, 22], [-62, -70, 6, 23], [74, 8, 5, 24]] as const) area("403", blob(x, y, r, seed, 1.3));
    for (const [x, y, r, seed] of [[-40, 30, 9, 31], [20, 40, 11, 32], [70, -50, 12, 33], [-85, 10, 8, 34], [100, -5, 9, 35], [-10, -55, 8, 36],
      [40, 75, 7, 37], [-110, -30, 7, 38], [55, -10, 6, 39], [-60, -40, 7, 40]] as const) area("406", blob(x, y, r, seed, 1.5));
    for (const [x, y, r, seed] of [[18, 36, 5, 41], [72, -54, 5, 42], [-38, 34, 4, 43], [102, -2, 4, 44], [-8, -58, 3.5, 45], [88, 70, 4, 46]] as const) {
      area("408", blob(x, y, r, seed, 1.4));
  }
  area("410", blob(73, -57, 2, 47));
  // Sankmark vid stränderna och i en svacka.
  for (const [x, y, r, seed] of [[-22, 0, 6, 51], [20, 22, 6, 52], [-68, -23, 4, 53], [50, 15, 4, 54], [-55, 60, 5, 55]] as const) {
    area("310", blob(x, y, r, seed, 1.6));
  }
  area("308", blob(14, -12, 4, 56, 1.8));
  }

  // Sjön och tjärnen: den slutna kurvan vid vattenytan runt sänkans mitt.
  const lakes: XY[][] = [];
  for (const water of WATERS) {
    const level = demoHeight(water.at[0], water.at[1]) + water.depth;
    const lake = isolines(level, 0.5).filter(entry => entry.closed && inside(water.at, entry.points))
      .sort((a, b) => a.points.length - b.points.length)[0];
    if (!lake) throw new Error("Sjön blev inte sluten");
    const ring = thin(smooth(lake.points, true), 0.5);
    lakes.push(ring);
    area("301", ring);
    line("301.1", [...ring, ring[0]!]);
  }
  const wet = (p: XY) => lakes.some(ring => inside(p, ring));

  if (terrain) {
    // Kurvorna var 5:e meter, stödkurvor var 25:e; inga under vattnet.
    for (let level = 5; level < 140; level += 5) {
      for (const contour of isolines(level)) {
        const points = thin(smooth(contour.points, contour.closed), 0.7);
        if (points.length < 4 || points.every(wet)) continue;
        const length = points.reduce((sum, p, index) => index === 0 ? 0 : sum + Math.hypot(p[0] - points[index - 1]![0], p[1] - points[index - 1]![1]), 0);
        if (contour.closed && length < 4) { point("109", points[0]!); continue; }
        line(level % 25 === 0 ? "102" : "101", contour.closed ? [...points, points[0]!] : points);
      }
  }

  // Branter där det lutar mest (en per 9 mm), tvärs över lutningen.
  const next = random(7);
  const cliffs: XY[] = [];
  for (let x = DEMO_MAP_BOUNDS.minX + 4; x < DEMO_MAP_BOUNDS.maxX - 4; x += 1.5) {
    for (let y = DEMO_MAP_BOUNDS.minY + 4; y < DEMO_MAP_BOUNDS.maxY - 4; y += 1.5) {
      const gx = demoHeight(x + 0.5, y) - demoHeight(x - 0.5, y), gy = demoHeight(x, y + 0.5) - demoHeight(x, y - 0.5);
      if (Math.hypot(gx, gy) < 2.2 || wet([x, y]) || next() > 0.5 || cliffs.some(c => Math.hypot(c[0] - x, c[1] - y) < 9)) continue;
      cliffs.push([x, y]);
      const length = 1.5 + next() * 2.5, ux = -gy / Math.hypot(gx, gy), uy = gx / Math.hypot(gx, gy);
      line("202", [[x - ux * length / 2, y - uy * length / 2], [x + ux * length / 2, y + uy * length / 2]]);
    }
  }
  // Stenar och några stora stenar på torr mark.
  for (let count = 0; count < 120; count += 1) {
    const at: XY = [DEMO_MAP_BOUNDS.minX + 3 + next() * 234, DEMO_MAP_BOUNDS.minY + 3 + next() * 164];
    if (wet(at) || inside(at, field)) continue;
    point(count % 5 === 0 ? "205" : "204", at);
  }
  for (const at of [[-64, 22], [36, 55], [82, -18], [-14, -44], [58, 60]] as const) point("207", at);
  }

  // Vägen till gården, körvägen söderut och stigarna runt sjön.
  line("503", trail([[-120, 72], [-104, 64], [-84, 66], [-62, 78], [-48, 85]], 61, 0.4));
  line("504", trail([[-100, 58], [-102, 30], [-96, 4], [-74, -30], [-50, -58], [-30, -85]], 62, 0.8));
  line("505", trail([[-62, 78], [-48, 56], [-38, 36], [-34, 14], [-36, -6], [-28, -24], [-6, -30], [24, -30], [44, -12], [52, 14], [64, 40],
    [80, 62], [96, 85]], 63));
  line("505", trail([[-96, 4], [-70, 4], [-50, 10], [-34, 14]], 64));
  line("505", trail([[24, -30], [40, -50], [52, -85]], 65));
  line("506", trail([[-48, 56], [-20, 54], [8, 46], [30, 52], [64, 40]], 66));
  line("506", trail([[52, 14], [80, 12], [100, -10], [120, -14]], 67));
  line("506", trail([[-74, -30], [-60, -56], [-80, -84]], 68));
  // Bäcken ur sjön ned mot tjärnen.
  line("305", trail([[-16, -6], [-30, -12], [-48, -14], [-66, -16]], 69, 0.6));
  // Gården.
  for (const [x, y, w, h, angle] of [[-98, 66, 4, 2.4, 0.2], [-92, 62, 2.6, 1.8, 0.2], [-101, 61, 1.8, 1.4, 0.2]] as const) area("521", rectangle(x, y, w, h, angle));

  const result = applyMapRevision(base, { baseFileSha256: sha256Hex(base), format: "OMAP", changes });
  if (!result.ok) throw new Error(`Demokartan kunde inte skrivas: ${JSON.stringify(result.refusals.slice(0, 3))}`);
  return result.bytes;
}
