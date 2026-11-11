/**
 * Stenar och berg i dagen ur laserns markraster (ägaren 2026-11-11: «jobba mot allt ovan»; Kungshatt-kedjans `s6_hall.py`).
 *
 * - **Stenar:** en cell som är högst i sin närhet och står minst `boulder` m över medianen i en ring 3–4 m bort, med branta
 *   sidor (två tredjedelar av höjden borta 2 m bort; en liten kulle sluttar jämnt) och en liten
 *   fot (högst `maxFootCells` celler över halva höjden inom 3 m; en brantkant eller en kulle har en stor fot), blir en sten
 *   (`sten`, 204), från `largeBoulder` m ett stort block (`stort_block`, 205). Två stenar närmare än 3 m blir den högsta.
 * - **Små kullar:** se `knolls`.
 * - **Berg i dagen:** ojämn mark (medelavvikelsen från en 3 × 3-utjämning över 5 × 5 celler minst `roughness` m) där
 *   vegetationen säger öppet, och som antingen ligger högre än omgivningen (8 m) eller lutar mer än 10°. Ett hygge är också
 *   ojämnt och öppet men ligger plant; det släpps oftast. (Gränserna sänktes 2026-11-11: 0,15 m över omgivningen eller 8°.) Lagret `berg_i_dagen_laser` (214) är kandidater att gå igenom.
 *
 * Bara Nodes egna moduler (filen körs direkt av Node i avbildningen `otid-geo`).
 */
import type { GroundGrid } from "./geo-cliffs.ts";
import { localRelief } from "./geo-ditches.ts";
import { cleanMask, maskRings, simplify } from "./geo-moisture.ts";

export interface RockSettings { readonly boulder: number; readonly largeBoulder: number; readonly maxFootCells: number; readonly roughness: number; readonly minAreaM2: number }
// Markrastret är medelvärden i 1 m-celler, så stenen blir lägre och bredare än i verkligheten: 0,8 m räcker för en sten på 1 m.
// Ägaren 2026-11-11 («väldigt många stenar men inga punkthöjder», «finns mycket mer berg i dagen»): stenarna med brantare
// sidor och mindre fot (det som släpps blir oftare en liten kulle, se `knolls`), berg i dagen med lägre krav på ojämnhet.
export const DEFAULT_ROCK: RockSettings = { boulder: 0.8, largeBoulder: 1.8, maxFootCells: 12, roughness: 0.07, minAreaM2: 100 };

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
    if (near.length < 8 || here - median(near) < 0.75 * rise) continue;
    let foot = 0;
    for (let dx = -inner; dx <= inner; dx += 1) for (let dy = -inner; dy <= inner; dy += 1) if (at(x + dx, y + dy) > base + rise / 2) foot += 1;
    if (foot > settings.maxFootCells) continue;
    const point: [number, number] = [ground.minX + (x + 0.5) * cell, ground.minY + (y + 0.5) * cell];
    if (blockedAt?.(...point)) continue;
    found.push({ name: rise >= settings.largeBoulder ? "stort_block" : "sten", at: point, height: Math.round(rise * 10) / 10 });
  }
  // Den högsta av stenar närmare än 3 m.
  found.sort((a, b) => b.height - a.height);
  const kept: typeof found = [];
  for (const stone of found) if (!kept.some(other => Math.hypot(other.at[0] - stone.at[0], other.at[1] - stone.at[1]) < 3)) kept.push(stone);
  return kept;
}

/** Berg i dagen som ringar (meter). `openAt` säger om vegetationen är öppen i punkten. */
export function bareRock(ground: GroundGrid, openAt: (x: number, y: number) => boolean, settings: RockSettings = DEFAULT_ROCK,
  blockedAt?: (x: number, y: number) => boolean): [number, number][][] {
  const { width, height, cell } = ground;
  const fine = localRelief(ground, cell), broad = localRelief(ground, 8);
  const at = (values: Float32Array | Float64Array, x: number, y: number) => x < 0 || y < 0 || x >= width || y >= height ? Number.NaN : values[x * height + y]!;
  const slopeLimit = Math.tan(8 * Math.PI / 180);
  const mask = new Uint8Array(width * height);
  for (let x = 2; x < width - 2; x += 1) for (let y = 2; y < height - 2; y += 1) {
    let sum = 0, count = 0;
    for (let dx = -2; dx <= 2; dx += 1) for (let dy = -2; dy <= 2; dy += 1) { const value = at(fine, x + dx, y + dy); if (Number.isFinite(value)) { sum += Math.abs(value); count += 1; } }
    if (count < 13 || sum / count < settings.roughness) continue;
    const slope = Math.hypot(at(ground.z, x + 1, y) - at(ground.z, x - 1, y), at(ground.z, x, y + 1) - at(ground.z, x, y - 1)) / (2 * cell);
    if (!(at(broad, x, y) > 0.15 || slope > slopeLimit)) continue;
    const point: [number, number] = [ground.minX + (x + 0.5) * cell, ground.minY + (y + 0.5) * cell];
    if (!openAt(...point) || blockedAt?.(...point)) continue;
    mask[x * height + y] = 1;
  }
  const minCells = Math.max(4, Math.round(settings.minAreaM2 / (cell * cell)));
  const grid = { minX: ground.minX + cell / 2, minY: ground.minY + cell / 2, cell, width, height, z: new Float64Array(0) };
  return maskRings(cleanMask(mask, width, height, minCells), grid).map(ring => simplify(ring, cell * 0.75)).filter(ring => ring.length >= 4);
}

/**
 * Små kullar (109) ur markrastret (ägaren 2026-11-11: «punkthöjder i likvärdig terräng» som Högdalenkartan): den högsta
 * punkten inom 3 m som står minst `minRise` m över medianen i en ring 6–8 m bort, med en fot (celler över halva höjden inom
 * 6 m) som är för liten för en egen höjdkurva (högst `maxFootM2`), och inte en sten. Lagret `dotknoll_laser` föreslås som 109.
 */
export function knolls(ground: GroundGrid, stones: readonly { at: readonly [number, number] }[], minRise = 1, maxFootM2 = 80,
  blockedAt?: (x: number, y: number) => boolean): [number, number][] {
  const { width, height, cell, z } = ground;
  const at = (x: number, y: number) => x < 0 || y < 0 || x >= width || y >= height ? Number.NaN : z[x * height + y]!;
  const top = Math.max(1, Math.round(3 / cell)), inner = Math.max(top + 1, Math.round(6 / cell)), outer = Math.max(inner + 1, Math.round(8 / cell));
  const maxFoot = maxFootM2 / (cell * cell);
  const found: { at: [number, number]; rise: number }[] = [];
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
    // Hela ringen ska ligga lägre: en udde på en sluttning har en sida som fortsätter uppåt.
    if (Math.max(...ring) > here - rise / 3) continue;
    let foot = 0;
    for (let dx = -inner; dx <= inner; dx += 1) for (let dy = -inner; dy <= inner; dy += 1) if (at(x + dx, y + dy) > base + rise / 2) foot += 1;
    if (foot > maxFoot) continue;
    const point: [number, number] = [ground.minX + (x + 0.5) * cell, ground.minY + (y + 0.5) * cell];
    if (blockedAt?.(...point) || stones.some(stone => Math.hypot(stone.at[0] - point[0], stone.at[1] - point[1]) < 4)) continue;
    found.push({ at: point, rise });
  }
  found.sort((a, b) => b.rise - a.rise);
  const kept: [number, number][] = [];
  for (const knoll of found) if (!kept.some(other => Math.hypot(other[0] - knoll.at[0], other[1] - knoll.at[1]) < 10)) kept.push(knoll.at);
  return kept;
}
