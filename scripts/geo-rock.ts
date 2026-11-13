/**
 * Stenar och berg i dagen ur laserns markraster (ägaren 2026-11-11: «jobba mot allt ovan»; Kungshatt-kedjans `s6_hall.py`).
 *
 * - **Stenar:** en cell som är högst i sin närhet och står minst `boulder` m över medianen i en ring 3–4 m bort, med branta
 *   sidor (två tredjedelar av höjden borta 2 m bort; en liten kulle sluttar jämnt) och en liten
 *   fot (högst `maxFootCells` celler över halva höjden inom 3 m; en brantkant eller en kulle har en stor fot), blir en sten
 *   (`sten`, 204), från `largeBoulder` m ett stort block (`stort_block`, 205). Två stenar närmare än 3 m blir den högsta.
 * - **Små kullar:** se `knolls`.
 * - **Berg i dagen** (också under vanlig skog, med strängare krav, se `bareRock`): ojämn mark (medelavvikelsen från en 3 × 3-utjämning över 5 × 5 celler minst `roughness` m) där
 *   vegetationen säger öppet, och som antingen ligger högre än omgivningen (8 m) eller lutar mer än 10°. Ett hygge är också
 *   ojämnt och öppet men ligger plant; det släpps oftast. (Gränserna sänktes 2026-11-11: 0,15 m över omgivningen eller 8°.) Lagret `berg_i_dagen_laser` (214) är kandidater att gå igenom.
 *
 * Bara Nodes egna moduler (filen körs direkt av Node i avbildningen `otid-geo`).
 */
import type { GroundGrid } from "./geo-cliffs.ts";
import { localRelief } from "./geo-ditches.ts";
import { cleanMask, encodePng, maskRings, simplify } from "./geo-moisture.ts";

export interface RockSettings { readonly boulder: number; readonly largeBoulder: number; readonly maxFootCells: number; readonly roughness: number; readonly minAreaM2: number }
// Markrastret är medelvärden i 1 m-celler, så stenen blir lägre och bredare än i verkligheten: 0,8 m räcker för en sten på 1 m.
// Ägaren 2026-11-11 («väldigt många stenar men inga punkthöjder», «finns mycket mer berg i dagen»): stenarna med brantare
// sidor och mindre fot (det som släpps blir oftare en liten kulle, se `knolls`), berg i dagen med lägre krav på ojämnhet.
// Högdalen som facit (33 stenar mot kartritarens 65): lite mildare igen, 0,7 av höjden borta 2 m bort och en fot på 16 celler.
export const DEFAULT_ROCK: RockSettings = { boulder: 0.8, largeBoulder: 1.8, maxFootCells: 16, roughness: 0.07, minAreaM2: 100 };

/**
 * Punkter i ett rutnät med `reach` m rutor, så att «finns någon närmare än reach» bara ser på de nio rutorna runt punkten.
 * Utan det växer arbetet med kvadraten på antalet (Djurgården 2026-11-11: stensteget blev aldrig klart i bebyggelse).
 */
function nearIndex(reach: number): { has: (x: number, y: number) => boolean; add: (x: number, y: number) => void } {
  const cells = new Map<string, [number, number][]>();
  const key = (cx: number, cy: number) => `${cx},${cy}`;
  return {
    has: (x, y) => {
      const cx = Math.floor(x / reach), cy = Math.floor(y / reach);
      for (let ax = -1; ax <= 1; ax += 1) for (let ay = -1; ay <= 1; ay += 1) {
        for (const [px, py] of cells.get(key(cx + ax, cy + ay)) ?? []) if (Math.hypot(px - x, py - y) < reach) return true;
      }
      return false;
    },
    add: (x, y) => {
      const k = key(Math.floor(x / reach), Math.floor(y / reach)), list = cells.get(k);
      if (list) list.push([x, y]); else cells.set(k, [[x, y]]);
    },
  };
}

const median = (values: number[]) => { values.sort((a, b) => a - b); return values[Math.floor(values.length / 2)]!; };

/** Stenarna som punkter (meter), med höjden över omgivningen. */
export function boulders(ground: GroundGrid, settings: RockSettings = DEFAULT_ROCK, blockedAt?: (x: number, y: number) => boolean)
  : { name: "sten" | "stort_block"; at: [number, number]; height: number }[] {
  const { width, height, cell, z } = ground;
  const at = (x: number, y: number) => x < 0 || y < 0 || x >= width || y >= height ? Number.NaN : z[x * height + y]!;
  const inner = Math.max(1, Math.round(3 / cell)), outer = Math.max(inner + 1, Math.round(4 / cell));
  const found: { name: "sten" | "stort_block"; at: [number, number]; height: number }[] = [];
  for (let x = outer; x < width - outer; x += 1) for (let y = outer; y < height - outer; y += 1) {
    const here = at(x, y);
    if (!Number.isFinite(here)) continue;
    let top = true;
    for (let dx = -1; dx <= 1 && top; dx += 1) for (let dy = -1; dy <= 1; dy += 1) if ((dx || dy) && !(here > at(x + dx, y + dy) || (here === at(x + dx, y + dy) && dx + dy > 0))) { top = false; break; }
    if (!top) continue;
    const ring: number[] = [];
    for (let dx = -outer; dx <= outer; dx += 1) for (let dy = -outer; dy <= outer; dy += 1) {
      const d = Math.max(Math.abs(dx), Math.abs(dy)), value = at(x + dx, y + dy);
      if (d >= inner && d <= outer && Number.isFinite(value)) ring.push(value);
    }
    if (ring.length < 12) continue;
    const base = median(ring), rise = here - base;
    if (rise < settings.boulder) continue;
    // En sten har branta sidor: redan 2 m bort är det mesta av höjden borta (en liten kulle sluttar jämnt).
    const near: number[] = [];
    const two = Math.max(1, Math.round(2 / cell));
    for (let dx = -two; dx <= two; dx += 1) for (let dy = -two; dy <= two; dy += 1) {
      const value = at(x + dx, y + dy);
      if (Math.max(Math.abs(dx), Math.abs(dy)) === two && Number.isFinite(value)) near.push(value);
    }
    if (near.length < 8 || here - median(near) < 0.7 * rise) continue;
    let foot = 0;
    for (let dx = -inner; dx <= inner; dx += 1) for (let dy = -inner; dy <= inner; dy += 1) if (at(x + dx, y + dy) > base + rise / 2) foot += 1;
    if (foot > settings.maxFootCells) continue;
    const point: [number, number] = [ground.minX + (x + 0.5) * cell, ground.minY + (y + 0.5) * cell];
    if (blockedAt?.(...point)) continue;
    found.push({ name: rise >= settings.largeBoulder ? "stort_block" : "sten", at: point, height: Math.round(rise * 10) / 10 });
  }
  // Den högsta av stenar närmare än 3 m.
  found.sort((a, b) => b.height - a.height);
  const kept: typeof found = [], near = nearIndex(3);
  for (const stone of found) if (!near.has(...stone.at)) { kept.push(stone); near.add(...stone.at); }
  return kept;
}

/** Ojämnheten per cell: medelavvikelsen (m) från utjämningen över 5 × 5 celler. NaN i kanten och där färre än 13 celler har data. */
export function roughnessGrid(ground: GroundGrid, fine: Float32Array = localRelief(ground, ground.cell)): Float32Array {
  const { width, height } = ground;
  const out = new Float32Array(width * height).fill(Number.NaN);
  for (let x = 2; x < width - 2; x += 1) for (let y = 2; y < height - 2; y += 1) {
    let sum = 0, count = 0;
    for (let dx = -2; dx <= 2; dx += 1) for (let dy = -2; dy <= 2; dy += 1) { const value = fine[(x + dx) * height + y + dy]!; if (Number.isFinite(value)) { sum += Math.abs(value); count += 1; } }
    if (count >= 13) out[x * height + y] = sum / count;
  }
  return out;
}

/** Berg i dagen som ringar (meter). `openAt` säger om vegetationen är öppen i punkten. */
export function bareRock(ground: GroundGrid, openAt: (x: number, y: number) => boolean, settings: RockSettings = DEFAULT_ROCK,
  blockedAt?: (x: number, y: number) => boolean, forestAt?: (x: number, y: number) => boolean): [number, number][][] {
  const { width, height, cell } = ground;
  const rough = roughnessGrid(ground), broad = localRelief(ground, 8);
  const at = (values: Float32Array | Float64Array, x: number, y: number) => x < 0 || y < 0 || x >= width || y >= height ? Number.NaN : values[x * height + y]!;
  const slopeLimit = Math.tan(8 * Math.PI / 180);
  const mask = new Uint8Array(width * height);
  for (let x = 2; x < width - 2; x += 1) for (let y = 2; y < height - 2; y += 1) {
    const roughness = rough[x * height + y]!;
    if (!(roughness >= settings.roughness)) continue;
    const slope = Math.hypot(at(ground.z, x + 1, y) - at(ground.z, x - 1, y), at(ground.z, x, y + 1) - at(ground.z, x, y - 1)) / (2 * cell);
    if (!(at(broad, x, y) > 0.15 || slope > slopeLimit)) continue;
    const point: [number, number] = [ground.minX + (x + 0.5) * cell, ground.minY + (y + 0.5) * cell];
    if (blockedAt?.(...point)) continue;
    // Öppet räcker med ojämnheten ovan; under vanlig skog krävs mer: ojämnare (×1,5) och tydligt upphöjt (0,3 m över omgivningen 8 m bort) (en häll på en kulle),
    // så att stenig skogsmark inte blir grå (ägaren 2026-11-11, Högdalen: hällarna ligger under tallarna).
    const open = openAt(...point);
    if (!open && !(forestAt?.(...point) && roughness >= settings.roughness * 1.5 && at(broad, x, y) > 0.3)) continue;
    mask[x * height + y] = 1;
  }
  const minCells = Math.max(4, Math.round(settings.minAreaM2 / (cell * cell)));
  const grid = { minX: ground.minX + cell / 2, minY: ground.minY + cell / 2, cell, width, height, z: new Float64Array(0) };
  return maskRings(cleanMask(mask, width, height, minCells), grid).map(ring => simplify(ring, cell * 0.75)).filter(ring => ring.length >= 4);
}

/**
 * Andelen av ringen som måste ligga lägre än kullen. Högdalenkartan 2026-11-11: med hela ringen (1) hittas 14–16 % av kartans
 * punkthöjder, med 0,8 hittas 36–48 % med ungefär samma träffsäkerhet; en lägre tröskel för höjden gav inget.
 */
export const KNOLL_LOWER_SHARE = 0.8;

/**
 * Små kullar (109) ur markrastret (ägaren 2026-11-11: «punkthöjder i likvärdig terräng» som Högdalenkartan): den högsta
 * punkten inom 3 m som står minst `minRise` m över medianen i en ring 6–8 m bort, med en fot (celler över halva höjden inom
 * 6 m) som är för liten för en egen höjdkurva (högst `maxFootM2`), och inte en sten. Lagret `dotknoll_laser` föreslås som 109.
 */
export function knolls(ground: GroundGrid, stones: readonly { at: readonly [number, number] }[], minRise = 1, maxFootM2 = 80,
  blockedAt?: (x: number, y: number) => boolean, lowerShare = KNOLL_LOWER_SHARE): [number, number][] {
  return chooseKnolls(knollCandidates(ground, stones, blockedAt, Math.min(minRise, KNOLL_LOOSE.minRise), Math.min(lowerShare, KNOLL_LOOSE.lowerShare),
    Math.max(maxFootM2, KNOLL_LOOSE.maxFootM2)), { minRise, lowerShare, maxFootM2, spacing: 10 });
}

/** En möjlig liten kulle med sina mått: höjden över omgivningen (m), andelen av ringen som ligger lägre och fotens yta (m²). */
export interface KnollCandidate { readonly at: [number, number]; readonly rise: number; readonly share: number; readonly footM2: number;
  /** Ligger i blöt eller fuktig mark enligt fuktigheten. */
  readonly wet?: boolean | undefined }
/**
 * Ägaren 2026-11-12 («spökpunkthöjder … som ligger i kärret», «ta bort spökpunkter mitt i kärr om de inte är uppenbara»): en
 * liten upphöjning i sankmark är oftast låg vegetation som lasern tagit för mark. I blöt eller fuktig mark tas en kulle bara
 * med om den står minst så här högt över omgivningen.
 */
export const KNOLL_OBVIOUS_RISE = 1.5;
/**
 * De lösa gränserna för `kullar.geojson` (ägaren 2026-11-12: «om man vill få färre punkthöjder … måste väl inte allt köras om»):
 * jobbet sparar alla möjliga kullar med sina mått, och reglagen i webbläsaren väljer bland dem utan ny körning.
 */
export const KNOLL_LOOSE = { minRise: 0.5, lowerShare: 0.5, maxFootM2: 160 } as const;

/** Valet bland kandidaterna: gränserna, och sedan de högsta först med minst `spacing` meter emellan. Samma regel i webbläsaren. */
export function chooseKnolls(candidates: readonly KnollCandidate[], limits: { minRise: number; lowerShare: number; maxFootM2: number; spacing: number }): [number, number][] {
  const found = candidates.filter(knoll => knoll.rise >= limits.minRise && knoll.share >= limits.lowerShare && knoll.footM2 <= limits.maxFootM2
    && (!knoll.wet || knoll.rise >= KNOLL_OBVIOUS_RISE))
    .sort((a, b) => b.rise - a.rise);
  const kept: [number, number][] = [], near = nearIndex(limits.spacing);
  for (const knoll of found) if (!near.has(...knoll.at)) { kept.push(knoll.at); near.add(...knoll.at); }
  return kept;
}

/** Alla lokala toppar som klarar gränserna, med sina mått (inte utglesade). */
export function knollCandidates(ground: GroundGrid, stones: readonly { at: readonly [number, number] }[], blockedAt?: (x: number, y: number) => boolean,
  minRise: number = KNOLL_LOOSE.minRise, lowerShare: number = KNOLL_LOOSE.lowerShare, maxFootM2: number = KNOLL_LOOSE.maxFootM2,
  wetAt?: (x: number, y: number) => boolean): KnollCandidate[] {
  const { width, height, cell, z } = ground;
  const at = (x: number, y: number) => x < 0 || y < 0 || x >= width || y >= height ? Number.NaN : z[x * height + y]!;
  const top = Math.max(1, Math.round(3 / cell)), inner = Math.max(top + 1, Math.round(6 / cell)), outer = Math.max(inner + 1, Math.round(8 / cell));
  const maxFoot = maxFootM2 / (cell * cell);
  const found: KnollCandidate[] = [];
  const stoneNear = nearIndex(4);
  for (const stone of stones) stoneNear.add(stone.at[0], stone.at[1]);
  for (let x = outer; x < width - outer; x += 1) for (let y = outer; y < height - outer; y += 1) {
    const here = at(x, y);
    if (!Number.isFinite(here)) continue;
    let highest = true;
    for (let dx = -top; dx <= top && highest; dx += 1) for (let dy = -top; dy <= top; dy += 1) {
      const value = at(x + dx, y + dy);
      if ((dx || dy) && (value > here || (value === here && dx + dy > 0))) { highest = false; break; }
    }
    if (!highest) continue;
    const ring: number[] = [];
    for (let dx = -outer; dx <= outer; dx += 1) for (let dy = -outer; dy <= outer; dy += 1) {
      const d = Math.max(Math.abs(dx), Math.abs(dy)), value = at(x + dx, y + dy);
      if (d >= inner && Number.isFinite(value)) ring.push(value);
    }
    if (ring.length < 24) continue;
    const base = median(ring), rise = here - base;
    if (rise < minRise) continue;
    // Det mesta av ringen ska ligga lägre: en udde på en sluttning har en sida som fortsätter uppåt, men kartritarens
    // punkthöjder ligger ofta på en näsa eller i en sluttning med lite högre mark åt ett håll.
    const limit = here - rise / 3, lower = ring.filter(value => value <= limit).length;
    if (lower < lowerShare * ring.length) continue;
    let foot = 0;
    for (let dx = -inner; dx <= inner; dx += 1) for (let dy = -inner; dy <= inner; dy += 1) if (at(x + dx, y + dy) > base + rise / 2) foot += 1;
    if (foot > maxFoot) continue;
    const point: [number, number] = [ground.minX + (x + 0.5) * cell, ground.minY + (y + 0.5) * cell];
    if (blockedAt?.(...point) || stoneNear.has(...point)) continue;
    // Andelen sparas som den minsta gräns kullen klarar (samma jämförelse som ovan), så att valet i efterhand blir lika.
    found.push({ at: point, rise, share: lower / ring.length, footM2: foot * cell * cell, ...(wetAt?.(...point) ? { wet: true } : {}) });
  }
  return found;
}

/** Avståndet (m) till närmaste markerade cell, rutavstånd med viktningen 3–4 (fel under 8 %); Infinity där ingen finns. Index x · höjd + y. */
export function distanceToMask(mask: Uint8Array, width: number, height: number, cell: number): Float32Array {
  const far = 1 << 28, d = new Int32Array(width * height);
  for (let i = 0; i < d.length; i += 1) d[i] = mask[i] ? 0 : far;
  const relax = (i: number, x: number, y: number, dx: number, dy: number, weight: number) => {
    const nx = x + dx, ny = y + dy;
    if (nx < 0 || ny < 0 || nx >= width || ny >= height) return;
    const value = d[nx * height + ny]! + weight;
    if (value < d[i]!) d[i] = value;
  };
  for (let x = 0; x < width; x += 1) for (let y = 0; y < height; y += 1) {
    const i = x * height + y;
    relax(i, x, y, -1, 0, 3); relax(i, x, y, 0, -1, 3); relax(i, x, y, -1, -1, 4); relax(i, x, y, -1, 1, 4);
  }
  for (let x = width - 1; x >= 0; x -= 1) for (let y = height - 1; y >= 0; y -= 1) {
    const i = x * height + y;
    relax(i, x, y, 1, 0, 3); relax(i, x, y, 0, 1, 3); relax(i, x, y, 1, 1, 4); relax(i, x, y, 1, -1, 4);
  }
  return Float32Array.from(d, value => value >= far ? Number.POSITIVE_INFINITY : value * cell / 3);
}

/**
 * Ägaren 2026-11-13 («flera inställningar … ett reglage att klassa fler/färre områden som berg»): en cell i `berg.png` som tre
 * kanaler, så att webbläsarens reglage kan välja bland cellerna utan ny körning (regeln finns i `rock-choice.ts` i map-revision).
 * R = ojämnheten i mm (0–255), G = 128 om vegetationen är öppen plus höjden över omgivningen 8 m bort i dm (0–127),
 * B = avståndet till vatten i m (0–254; 255 = inget vatten inom 254 m).
 */
export function encodeRockCell(roughness: number, open: boolean, rise: number, waterMeters: number): [number, number, number] {
  return [Math.min(255, Math.max(0, Math.round(roughness * 1000))), (open ? 128 : 0) + Math.min(127, Math.max(0, Math.round(rise * 10))),
    Number.isFinite(waterMeters) && waterMeters <= 254 ? Math.round(waterMeters) : 255];
}

/**
 * Bergbilden `berg.png` med världsfil (samma form som `hojd.png`): en bildpunkt per markcell, genomskinligt där ojämnheten
 * saknas (kanten, utan markdata) och i vatten. `open` och `water` är masker på markrastrets celler (index x · höjd + y).
 */
export function rockImage(ground: GroundGrid, open: Uint8Array | undefined, water: Uint8Array | undefined): { png: Buffer; world: string } {
  const { width, height, cell } = ground;
  const rough = roughnessGrid(ground), broad = localRelief(ground, 8);
  const toWater = water ? distanceToMask(water, width, height, cell) : undefined;
  const png = encodePng(width, height, (column, line) => {
    const i = column * height + (height - 1 - line), roughness = rough[i]!;
    if (!Number.isFinite(roughness) || water?.[i]) return [0, 0, 0, 0];
    const rise = broad[i]!;
    const [r, g, b] = encodeRockCell(roughness, open?.[i] === 1, Number.isFinite(rise) ? rise : 0, toWater?.[i] ?? Number.POSITIVE_INFINITY);
    return [r, g, b, 255];
  });
  return { png, world: `${cell}\n0\n0\n${-cell}\n${ground.minX + cell / 2}\n${ground.minY + (height - 0.5) * cell}\n` };
}
