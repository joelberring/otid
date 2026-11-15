/**
 * Sänka skepp (ADR-0225, ägaren 2026-11-15): samma rutnät som bingon, men varje löpare har egna skepp som slumpas ur ett frö
 * (sparat på servern). Löparen trycker på rutan hen tror sig stå i och skjuter; telefonen tar en position. Rena regler:
 * skeppens placering, skottets bedömning och poängen.
 */
import type { BingoCellArea } from "./bingo";

export const SHIP_RULES = {
  /** Skottet tas med en position som är minst så här noggrann. */
  shotAccuracyM: 20,
  /** Hur länge telefonen väntar på en sådan position. */
  shotWaitSeconds: 20,
  /** Marginalen utanför rutans kant: noggrannheten, men minst 10 m och högst 25 m. */
  minMarginM: 10,
  maxMarginM: 25,
  maxShips: 8,
  maxShipLength: 6
} as const;

/** Skeppen efter rutnätets storlek: litet (12–20 rutor) 2, 2 och 1; stort 4, 3, 3, 2 och 2. */
export function defaultShips(cellCount: number): number[] {
  if (cellCount < 12) return [2, 1];
  if (cellCount <= 20) return [2, 2, 1];
  if (cellCount <= 35) return [3, 2, 2];
  if (cellCount <= 60) return [3, 3, 2, 2];
  return [4, 3, 3, 2, 2];
}

/** Ett skepp: rutornas namn i ordning; `shared` = gruppens gemensamma skepp (samma för alla i gruppen). */
export interface Ship { readonly cells: readonly string[]; readonly shared?: true | undefined }

/**
 * Lagspelet (ägaren 2026-11-16): gemensamma skepp (de längre, samma för alla i gruppen) och egna (de korta, per löpare) efter
 * rutnätets storlek. Litet rutnät: gemensamt 2 och egna 1, 1; stort: gemensamma 4, 3 och egna 2, 2.
 */
export function defaultShipSplit(cellCount: number): { shared: number[]; own: number[] } {
  if (cellCount < 12) return { shared: [2], own: [1] };
  if (cellCount <= 20) return { shared: [2], own: [1, 1] };
  if (cellCount <= 35) return { shared: [3], own: [2, 1] };
  if (cellCount <= 60) return { shared: [3], own: [2, 2] };
  return { shared: [4, 3], own: [2, 2] };
}

/**
 * Gruppens uppsättning: båda fälten tomma ger förvalet (`defaultShipSplit`); annars gäller fälten som de står, och ett tomt
 * fält är inga skepp (det äldre fältet «Skepp» är egna skepp utan gemensamma).
 */
export function shipSplitFor(cellCount: number, shared: readonly number[] | undefined, own: readonly number[] | undefined): { shared: number[]; own: number[] } {
  if (shared === undefined && own === undefined) return defaultShipSplit(cellCount);
  return { shared: [...(shared ?? [])], own: [...(own ?? [])] };
}

/** Gruppens frö för de gemensamma skeppen: FNV-1a av tävlingens id och banans id (samma i telefonen och på servern). */
export function bingoGroupSeed(raceId: string, course: string): number {
  let hash = 0x811c9dc5;
  for (const ch of `${raceId}:${course}`) { hash ^= ch.charCodeAt(0); hash = Math.imul(hash, 0x01000193) >>> 0; }
  return hash >>> 0;
}

/** Gemensamma skepp ur gruppens frö, sedan löparens egna utanför dem och deras grannrutor. */
export function placeGroupShips(cellNames: readonly string[], split: { shared: readonly number[]; own: readonly number[] }, groupSeed: number,
  runnerSeed: number): Ship[] {
  const shared = placeShips(cellNames, split.shared, groupSeed).map(ship => ({ ...ship, shared: true as const }));
  return [...shared, ...placeShips(cellNames, split.own, runnerSeed, shared)];
}

/** Rutans kolumn och rad ur namnet ("AB12" → kolumn 27, rad 11). */
export function bingoCellPosition(name: string): { column: number; row: number } | undefined {
  const match = /^([A-Z]+)(\d+)$/.exec(name);
  if (!match) return undefined;
  let column = 0;
  for (const letter of match[1]!) column = column * 26 + (letter.charCodeAt(0) - 64);
  return { column: column - 1, row: Number(match[2]) - 1 };
}

/** Ett litet, välkänt slumptal ur fröet (mulberry32): samma frö ger samma skepp i telefonen och på servern. */
function random(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Skeppen för fröet: raka (vågräta eller lodräta), bara på rutor som finns och inte intill varandra (inte heller snett).
 * Längsta skeppet först. Går en uppsättning inte att lägga efter många försök tas det minsta skeppet bort och det prövas igen.
 */
export function placeShips(cellNames: readonly string[], lengths: readonly number[], seed: number, avoid: readonly Ship[] = []): Ship[] {
  const cells = new Map<string, string>();
  for (const name of cellNames) { const at = bingoCellPosition(name); if (at) cells.set(`${at.column},${at.row}`, name); }
  const columns = Math.max(0, ...[...cells.keys()].map(key => Number(key.split(",")[0]) + 1));
  const rows = Math.max(0, ...[...cells.keys()].map(key => Number(key.split(",")[1]) + 1));
  let wanted = [...lengths].filter(length => length >= 1).sort((a, b) => b - a).slice(0, SHIP_RULES.maxShips);
  while (wanted.length > 0) {
    const next = random(seed);
    for (let attempt = 0; attempt < 200; attempt++) {
      // Skepp som redan ligger (de gemensamma) och deras grannrutor är upptagna.
      const used = new Set<string>(avoid.flatMap(ship => ship.cells).flatMap(name => { const at = bingoCellPosition(name); return at ? [`${at.column},${at.row}`] : []; }));
      const ships: Ship[] = [];
      let ok = true;
      for (const length of wanted) {
        let placed = false;
        for (let tries = 0; tries < 100 && !placed; tries++) {
          const vertical = next() < 0.5;
          const column = Math.floor(next() * columns), row = Math.floor(next() * rows);
          const keys = Array.from({ length }, (_, i) => vertical ? `${column},${row + i}` : `${column + i},${row}`);
          if (!keys.every(key => cells.has(key))) continue;
          const blocked = keys.some(key => {
            const [c, r] = key.split(",").map(Number) as [number, number];
            for (let dc = -1; dc <= 1; dc++) for (let dr = -1; dr <= 1; dr++) if (used.has(`${c + dc},${r + dr}`)) return true;
            return false;
          });
          if (blocked) continue;
          keys.forEach(key => used.add(key));
          ships.push({ cells: keys.map(key => cells.get(key)!) });
          placed = true;
        }
        if (!placed) { ok = false; break; }
      }
      if (ok) return ships;
    }
    wanted = wanted.slice(0, -1);
  }
  return [];
}

export type ShotResult = "HIT" | "SUNK" | "WATER" | "WRONG";

/** Ett skott: rutan löparen valde, tiden (ms) och positionen (kartans mm) med noggrannheten. */
export interface Shot {
  readonly cell: string;
  readonly at: number;
  readonly x: number;
  readonly y: number;
  readonly accuracyM: number;
}

/** Stod löparen i rutan? Inne i rutan, eller inom max(10 m, noggrannheten) men högst 25 m från kanten. */
export function shotInCell(cell: BingoCellArea, shot: Pick<Shot, "x" | "y" | "accuracyM">, metersPerMm: number): boolean {
  const margin = Math.min(SHIP_RULES.maxMarginM, Math.max(SHIP_RULES.minMarginM, shot.accuracyM)) / metersPerMm;
  const r = cell.rect;
  return shot.x >= r.minX - margin && shot.x <= r.maxX + margin && shot.y >= r.minY - margin && shot.y <= r.maxY + margin;
}

export interface JudgedShot extends Shot { readonly result: ShotResult; readonly shared?: true | undefined }

export interface ShipScore {
  readonly points: number;
  readonly hits: number;
  readonly sunk: number;
  readonly wrong: number;
  /** Skott i rätt ruta utan skepp. */
  readonly water: number;
  /** Gemensamma skepp som löparen sänkt. */
  readonly sharedSunk: number;
  readonly lastShotAt: number | null;
}

/**
 * Skotten i tidsordning bedömda: fel ruta (positionen låg inte i den valda rutan) ger WRONG och tar inte rutan; annars
 * träff, sänkt (skeppets sista ruta) eller vatten. En ruta som redan är skjuten räknas inte igen. Skott med sämre
 * noggrannhet än regeln och skott på rutor som inte finns hoppas över.
 */
export function judgeShots(shots: readonly Shot[], cells: readonly BingoCellArea[], ships: readonly Ship[], metersPerMm: number): JudgedShot[] {
  const byName = new Map(cells.map(cell => [cell.name, cell]));
  const shipOf = new Map<string, Ship>();
  for (const ship of ships) for (const name of ship.cells) shipOf.set(name, ship);
  const fired = new Set<string>();
  const out: JudgedShot[] = [];
  for (const shot of [...shots].sort((a, b) => a.at - b.at || a.cell.localeCompare(b.cell))) {
    const cell = byName.get(shot.cell);
    if (!cell || fired.has(shot.cell) || !(shot.accuracyM <= SHIP_RULES.shotAccuracyM) || !Number.isFinite(shot.x) || !Number.isFinite(shot.y)) continue;
    if (!shotInCell(cell, shot, metersPerMm)) { out.push({ ...shot, result: "WRONG" }); continue; }
    fired.add(shot.cell);
    const ship = shipOf.get(shot.cell);
    out.push({ ...shot, result: !ship ? "WATER" : ship.cells.every(name => fired.has(name)) ? "SUNK" : "HIT", ...(ship?.shared ? { shared: true as const } : {}) });
  }
  return out;
}

/**
 * Poängen (ägaren 2026-11-16, «tröstpoäng om man tagit vatten rätt»): rätt ruta ger alltid minst 1. Vatten +1, träff +3
 * (också den som sänker), sänkt skepp +3 extra, fel ruta −2.
 */
export const SHIP_POINTS = { water: 1, hit: 3, sunkBonus: 3, wrong: -2 } as const;

/** Poängen för ett bedömt skott (beskedet efter skottet). */
export function shotPoints(result: ShotResult): number {
  return result === "WATER" ? SHIP_POINTS.water : result === "HIT" ? SHIP_POINTS.hit : result === "SUNK" ? SHIP_POINTS.hit + SHIP_POINTS.sunkBonus : SHIP_POINTS.wrong;
}

/** Poängen för skotten, se `SHIP_POINTS`.*/
export function scoreShots(judged: readonly JudgedShot[]): ShipScore {
  const hits = judged.filter(shot => shot.result === "HIT" || shot.result === "SUNK").length;
  const sunk = judged.filter(shot => shot.result === "SUNK").length;
  const wrong = judged.filter(shot => shot.result === "WRONG").length;
  const water = judged.filter(shot => shot.result === "WATER").length;
  const sharedSunk = judged.filter(shot => shot.result === "SUNK" && shot.shared).length;
  return { points: water * SHIP_POINTS.water + hits * SHIP_POINTS.hit + sunk * SHIP_POINTS.sunkBonus + wrong * SHIP_POINTS.wrong, hits, sunk, wrong, water, sharedSunk, lastShotAt: judged.length > 0 ? Math.max(...judged.map(shot => shot.at)) : null };
}

/** Skotten från servern och telefonen ihop: samma ruta och tid är samma skott. */
export function mergeShots(current: readonly Shot[], incoming: readonly Shot[]): Shot[] {
  const out = new Map<string, Shot>();
  for (const shot of [...current, ...incoming]) out.set(`${shot.cell}@${shot.at}`, shot);
  return [...out.values()].sort((a, b) => a.at - b.at || a.cell.localeCompare(b.cell));
}

export interface ShipStanding extends ShipScore { readonly name: string; readonly status: "RUNNING" | "FINISHED" | "ABANDONED" }

/** Topplistan i Sänka skepp: flest poäng, sedan flest sänkta, flest träffar, färst fel; avbrutna sist. */
export function rankShips<T extends ShipStanding>(rows: readonly T[]): T[] {
  return [...rows].sort((a, b) => Number(a.status === "ABANDONED") - Number(b.status === "ABANDONED") || b.points - a.points || b.sunk - a.sunk
    || b.hits - a.hits || a.wrong - b.wrong || (a.lastShotAt ?? Infinity) - (b.lastShotAt ?? Infinity) || a.name.localeCompare(b.name, "sv"));
}

/**
 * Prickarna på skottbrädet: hur många löpare i gruppen som skjutit på rutan och stått i den (vatten, träff eller sänkt, inte
 * fel ruta). Visar inte om det var en träff. `judgedPerRunner` = varje löpares bedömda skott.
 */
export function shotCellCounts(judgedPerRunner: readonly (readonly JudgedShot[])[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const judged of judgedPerRunner) {
    for (const cell of new Set(judged.filter(shot => shot.result !== "WRONG").map(shot => shot.cell))) out[cell] = (out[cell] ?? 0) + 1;
  }
  return out;
}

/** En position som telefonen fått: noggrannheten i meter och när den kom (ms). */
export interface ShotFix { readonly accuracyM: number; readonly receivedAt: number }

export const SHOT_FIX_RULES = { maxAgeMs: 2000, warmupMs: 3000 } as const;

/**
 * Positionen för skottet (ägaren 2026-11-16): den senaste som är högst 2 s gammal och ≤ 20 m noggrann, och som kom minst 3 s
 * efter att GPS:en började värmas upp (den första efter upplåsning kan vara gammal). Undefined = vänta.
 */
export function chooseShotFix<T extends ShotFix>(fixes: readonly T[], now: number, warmupStartedAt: number): T | undefined {
  for (let i = fixes.length - 1; i >= 0; i--) {
    const fix = fixes[i]!;
    if (now - fix.receivedAt > SHOT_FIX_RULES.maxAgeMs) return undefined;
    if (fix.receivedAt - warmupStartedAt < SHOT_FIX_RULES.warmupMs) return undefined;
    if (fix.accuracyM <= SHIP_RULES.shotAccuracyM) return fix;
  }
  return undefined;
}
