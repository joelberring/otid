// Geo-arbetarens tunga steg i en egen tråd (ägaren 2026-11-12: «går det att lägga till generella regler?»). Djurgården och
// Nåttarö 2026-11-11 visade att ett steg som växer för fort över ett stort område fäller hela jobbet, och att arbetaren då
// inte hinner skicka livstecken. Reglerna här gäller alla steg som körs genom runStep:
//   1. Steget körs i en egen tråd med tidsgräns. Går det över, eller kastar det, hoppas just det lagret över; resten av
//      jobbet blir klart, och sammanfattningen säger vilket steg som saknas (skippedSteps).
//   2. Huvudtråden är ledig under tiden, så livstecknen går fram och «Avbryt» fungerar mitt i ett steg.
//   3. Antalet punkter per km² har ett tak (de tydligaste behålls): tiotusentals stenar är bebyggelse eller brus.
// Stegen får bara data (raster och masker, gärna i SharedArrayBuffer så parallella trådar slipper klona dem), aldrig funktioner.
import { cpus } from "node:os";
import { isMainThread, parentPort, Worker, workerData } from "node:worker_threads";
import type { GroundGrid } from "./geo-cliffs.ts";
import { DEFAULT_DITCHES, ditchLines, localRelief, reliefImage } from "./geo-ditches.ts";
import { trackLines } from "./geo-tracks.ts";
import { bareRock, boulders, chooseKnolls, KNOLL_LOWER_SHARE, KNOLL_MAX_FOOT_M2, KNOLL_MIN_RISE, KNOLL_SPACING, knollCandidates, rockImage, roughnessGrid } from "./geo-rock.ts";
import { waterAt, type WaterGrid } from "./geo-water.ts";

/** Tidsgränsen per steg. En ruta på 2 × 2 km tar sekunder; tio minuter är långt över det rimliga även för 5 × 5 km. */
export const STEP_TIMEOUT_MS = 10 * 60_000;
/** Tak för punkter per km². Tätaste provkartan (Gömmaren) har 155 punkthöjder och Lida 130 stenar per km². */
export const MAX_POINTS_PER_KM2 = 400;

export interface StepInput {
  readonly ground: GroundGrid;
  readonly water?: { readonly grid: WaterGrid; readonly mask: Uint8Array } | undefined;
  /** Masker på markrastrets celler (index x · höjd + y): öppen vegetation, vanlig skog, fuktigt. */
  readonly open?: Uint8Array | undefined;
  readonly forest?: Uint8Array | undefined;
  readonly wet?: Uint8Array | undefined;
  readonly stones?: readonly { readonly at: readonly [number, number] }[] | undefined;
  /** Andelen av ringen som ska ligga lägre än en liten kulle (förval i geo-rock.ts). */
  readonly knollShare?: number | undefined;
  /** För `rockAndMap`: om även berg-i-dagen-ytor (`bareRock`) ska räknas utöver `berg.png` (förval true). */
  readonly includeRock?: boolean | undefined;
}

/** Hur många oberoende arbetartrådssteg som körs parallellt (begränsat till 1–3 så minnet räcker). */
export function stepPoolConcurrency(cores = cpus().length): number {
  return Math.max(1, Math.min(cores, 3));
}

/** Lägger markrastrets höjder i en `SharedArrayBuffer` så parallella arbetartrådar delar dem utan kloning. */
export function shareGround(ground: GroundGrid): GroundGrid {
  if (ground.z.buffer instanceof SharedArrayBuffer) return ground;
  const z = new Float32Array(new SharedArrayBuffer(ground.z.byteLength));
  z.set(ground.z);
  return { ...ground, z };
}

/** Lägger en byte-mask i en `SharedArrayBuffer` så parallella arbetartrådar delar den utan kloning. */
export function shareBytes(bytes: Uint8Array): Uint8Array {
  if (bytes.buffer instanceof SharedArrayBuffer) return bytes;
  const shared = new Uint8Array(new SharedArrayBuffer(bytes.byteLength));
  shared.set(bytes);
  return shared;
}

/** En funktion (x, y) → sant/falskt som delad mask (`SharedArrayBuffer`) på markrastret, provad i cellernas mitt. */
export function maskOf(ground: GroundGrid, at: (x: number, y: number) => boolean): Uint8Array {
  const mask = new Uint8Array(new SharedArrayBuffer(ground.width * ground.height));
  for (let x = 0; x < ground.width; x += 1) for (let y = 0; y < ground.height; y += 1) {
    if (at(ground.minX + (x + 0.5) * ground.cell, ground.minY + (y + 0.5) * ground.cell)) mask[x * ground.height + y] = 1;
  }
  return mask;
}

const lookup = (ground: GroundGrid, mask: Uint8Array | undefined) => mask ? (x: number, y: number) => {
  const column = Math.floor((x - ground.minX) / ground.cell), row = Math.floor((y - ground.minY) / ground.cell);
  return column >= 0 && row >= 0 && column < ground.width && row < ground.height && mask[column * ground.height + row] === 1;
} : undefined;

/** Taket för antalet punkter över markrastrets yta med data. Listorna är redan ordnade med de tydligaste först. */
export function pointCap(ground: GroundGrid): number {
  let cells = 0;
  for (let i = 0; i < ground.z.length; i += 1) if (Number.isFinite(ground.z[i]!)) cells += 1;
  return Math.max(50, Math.round(cells * ground.cell * ground.cell / 1e6 * MAX_POINTS_PER_KM2));
}

export const STEPS = {
  ditches(input: StepInput) {
    const { ground } = input, water = input.water ? waterAt(input.water.grid, input.water.mask) : undefined;
    const relief = localRelief(ground, DEFAULT_DITCHES.radius), image = reliefImage(ground, relief);
    return { png: image.png, world: image.world, lines: ditchLines(ground, relief, DEFAULT_DITCHES, lookup(ground, input.wet), water) };
  },
  /** Släpstigar och spår ur reliefen (geo-tracks.ts, ägaren 2026-11-17). */
  tracks(input: StepInput) {
    const { ground } = input, water = input.water ? waterAt(input.water.grid, input.water.mask) : undefined;
    return { lines: trackLines(ground, localRelief(ground, DEFAULT_DITCHES.radius), undefined, lookup(ground, input.wet), water) };
  },
  /** Diken + släpstigar i samma steg: delar en enda `localRelief(ground, 4)`-beräkning. */
  ditchesAndTracks(input: StepInput) {
    const { ground } = input, water = input.water ? waterAt(input.water.grid, input.water.mask) : undefined;
    const wet = lookup(ground, input.wet);
    const relief = localRelief(ground, DEFAULT_DITCHES.radius), image = reliefImage(ground, relief);
    return {
      png: image.png,
      world: image.world,
      lines: ditchLines(ground, relief, DEFAULT_DITCHES, wet, water),
      tracks: trackLines(ground, relief, undefined, wet, water),
    };
  },
  stones(input: StepInput) {
    const water = input.water ? waterAt(input.water.grid, input.water.mask) : undefined;
    const all = boulders(input.ground, undefined, water), cap = pointCap(input.ground);
    return { stones: all.slice(0, cap), capped: Math.max(0, all.length - cap) };
  },
  rock(input: StepInput) {
    const { ground } = input, water = input.water ? waterAt(input.water.grid, input.water.mask) : undefined;
    const open = lookup(ground, input.open);
    return { rock: open ? bareRock(ground, open, undefined, water, lookup(ground, input.forest)) : [] };
  },
  /** Bergbilden (ojämnhet, öppenhet, höjd över omgivningen och avstånd till vatten) som reglaget «Berg i dagen med reglage» läser. */
  rockmap(input: StepInput) {
    const { ground } = input, water = input.water ? waterAt(input.water.grid, input.water.mask) : undefined;
    return rockImage(ground, input.open, water ? maskOf(ground, water) : undefined);
  },
  /** Berg i dagen + bergbilden i samma arbetartråd: delar en enda `roughnessGrid` + `localRelief(8)`. */
  rockAndMap(input: StepInput) {
    const { ground } = input, water = input.water ? waterAt(input.water.grid, input.water.mask) : undefined;
    const open = lookup(ground, input.open);
    const precomputed = { rough: roughnessGrid(ground), broad: localRelief(ground, 8) };
    const rock = input.includeRock !== false && open ? bareRock(ground, open, undefined, water, lookup(ground, input.forest), precomputed) : [];
    const map = rockImage(ground, input.open, water ? maskOf(ground, water) : undefined, precomputed);
    return { rock, png: map.png, world: map.world };
  },
  knolls(input: StepInput) {
    const water = input.water ? waterAt(input.water.grid, input.water.mask) : undefined;
    // Alla möjliga kullar med sina mått sparas (för reglagen i webbläsaren); jobbets egna kullar är valet med förvalen.
    // Laserns stenar läggs inte i grundkartan (`merge.ts`), så de blockerar inte skarpa bergkullar här — `KNOLL_MIN_FOOT_M2`
    // (8 m²) rensar 1–2 m block och brus direkt utan att kasta bort skarpa riktiga kullar.
    const candidates = knollCandidates(input.ground, [], water, undefined, undefined, undefined, lookup(input.ground, input.wet)).sort((a, b) => b.rise - a.rise);
    const all = chooseKnolls(candidates, { minRise: KNOLL_MIN_RISE, lowerShare: input.knollShare ?? KNOLL_LOWER_SHARE, maxFootM2: KNOLL_MAX_FOOT_M2, spacing: KNOLL_SPACING }), cap = pointCap(input.ground);
    return { knolls: all.slice(0, cap), capped: Math.max(0, all.length - cap), candidates: candidates.slice(0, cap * 6) };
  },
} as const;
export type StepName = keyof typeof STEPS;

// Fälten deklareras för sig: Node tar bara bort typerna och klarar inte egenskaper i konstruktorns parametrar.
export class StepSkipped extends Error {
  readonly step: StepName;
  constructor(step: StepName, reason: string) { super(`${step}: ${reason}`); this.step = step; }
}

/**
 * Kör ett steg i en egen tråd. Kastar StepSkipped när tiden går ut eller steget kastar, och AbortError när `signal` avbryts.
 * `file` är den här filen (i testerna en annan sökväg än import.meta.url).
 */
export function runStep<K extends StepName>(name: K, input: StepInput, signal?: AbortSignal, timeoutMs = STEP_TIMEOUT_MS,
  file: string | URL = new URL(import.meta.url)): Promise<ReturnType<(typeof STEPS)[K]>> {
  return new Promise((resolve, reject) => {
    const thread = new Worker(file, { workerData: { geoStep: name, input } });
    let settled = false;
    const finish = (act: () => void) => { if (settled) return; settled = true; clearTimeout(timer); signal?.removeEventListener("abort", abort); void thread.terminate(); act(); };
    const timer = setTimeout(() => finish(() => reject(new StepSkipped(name, `tog längre än ${Math.round(timeoutMs / 60_000)} min`))), timeoutMs);
    const abort = () => finish(() => reject(signal?.reason instanceof Error ? signal.reason : new Error("Avbrutet")));
    if (signal?.aborted) { abort(); return; }
    signal?.addEventListener("abort", abort, { once: true });
    thread.once("message", (result: ReturnType<(typeof STEPS)[K]>) => finish(() => resolve(result)));
    thread.once("error", (error: Error) => finish(() => reject(new StepSkipped(name, error.message.slice(0, 200)))));
    thread.once("exit", code => finish(() => reject(new StepSkipped(name, `tråden avslutades (${code})`))));
  });
}

const request = workerData as { geoStep?: StepName; input?: StepInput } | null;
if (!isMainThread && request?.geoStep && request.input) {
  parentPort!.postMessage((STEPS[request.geoStep] as (input: StepInput) => unknown)(request.input));
}
