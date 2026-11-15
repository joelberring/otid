/**
 * Bingo med telefonen (ADR-0225), löparens sida: loppet som det sparas i telefonen (localStorage), det som skickas till
 * servern och hjälp för brickan. Telefonen sparar hela loppet efter varje ändring och raderar det aldrig förrän servern har
 * kvitterat den senaste versionen (AGENTS.md).
 */
import { EMPTY_BINGO_RUN, type BingoRunState, type Shot } from "@o-tid/domain";
import type { BingoProgressRequest } from "@o-tid/contracts";

export interface StoredBingoRun {
  readonly formatVersion: 1;
  readonly runnerId: string;
  readonly name: string;
  readonly group: string;
  readonly status: "RUNNING" | "FINISHED" | "ABANDONED";
  readonly startedAt: number;
  readonly finishedAt: number | null;
  readonly run: BingoRunState;
  /** Sänka skepp: fröet för löparens skepp och skotten. */
  readonly seed?: number | undefined;
  readonly shots?: readonly Shot[] | undefined;
  /** Ökar vid varje ändring; `acked` är den version servern senast kvitterade. */
  readonly version: number;
  readonly acked: number;
}

export const bingoStorageKey = (raceId: string) => `otid-bingo:${raceId}`;
const NAME_KEY = "otid-bingo-name";

export function newBingoRun(name: string, group: string, now: number, runnerId: string, seed?: number): StoredBingoRun {
  return { formatVersion: 1, runnerId, name, group, status: "RUNNING", startedAt: now, finishedAt: null, run: EMPTY_BINGO_RUN, version: 1, acked: 0,
    ...(seed !== undefined ? { seed, shots: [] } : {}) };
}

/** Loppet ur telefonen; undefined om inget finns eller om det har fel form. */
export function parseStoredBingoRun(text: string | null): StoredBingoRun | undefined {
  if (!text) return undefined;
  try {
    const value = JSON.parse(text) as Partial<StoredBingoRun>;
    if (value.formatVersion !== 1 || typeof value.runnerId !== "string" || typeof value.name !== "string" || typeof value.group !== "string"
      || typeof value.startedAt !== "number" || typeof value.version !== "number" || typeof value.acked !== "number" || !value.run
      || !Array.isArray(value.run.taken) || !Array.isArray(value.run.track) || !Array.isArray(value.run.gaps)) return undefined;
    return value as StoredBingoRun;
  } catch { return undefined; }
}

export function readBingoRun(raceId: string): StoredBingoRun | undefined {
  try { return parseStoredBingoRun(window.localStorage.getItem(bingoStorageKey(raceId))); } catch { return undefined; }
}

/** Sparar loppet; false om telefonen inte gick att skriva till (privat läge, fullt). */
export function saveBingoRun(raceId: string, run: StoredBingoRun): boolean {
  try { window.localStorage.setItem(bingoStorageKey(raceId), JSON.stringify(run)); return true; } catch { return false; }
}

/** Tar bort loppet ur telefonen, bara när servern har kvitterat den senaste versionen. */
export function forgetBingoRun(raceId: string, run: StoredBingoRun): boolean {
  if (run.acked < run.version) return false;
  try { window.localStorage.removeItem(bingoStorageKey(raceId)); return true; } catch { return false; }
}

export function readBingoName(): string {
  try { return window.localStorage.getItem(NAME_KEY) ?? ""; } catch { return ""; }
}
export function saveBingoName(name: string): void {
  try { window.localStorage.setItem(NAME_KEY, name.trim()); } catch { /* bara en bekvämlighet: namnet föreslås nästa gång */ }
}

/** Det som skickas: hela läget, spåret med två decimaler i kartans mm. */
export function bingoProgressRequest(run: StoredBingoRun): BingoProgressRequest {
  return { formatVersion: 1, runnerId: run.runnerId, name: run.name, group: run.group, status: run.status, startedAt: run.startedAt,
    finishedAt: run.finishedAt, distanceM: Math.round(run.run.distanceM), taken: run.run.taken.map(row => ({ cell: row.cell, at: row.at })),
    track: run.run.track.map(([x, y, t]) => [Math.round(x * 100) / 100, Math.round(y * 100) / 100, t] as [number, number, number]),
    gaps: run.run.gaps.map(([from, to]) => [from, to] as [number, number]),
    ...(run.seed !== undefined ? { seed: run.seed, shots: (run.shots ?? []).map(shot => ({ cell: shot.cell, at: shot.at,
      x: Math.round(shot.x * 100) / 100, y: Math.round(shot.y * 100) / 100, accuracyM: Math.round(shot.accuracyM * 10) / 10 })) } : {}) };
}

/** Tiden som m:ss eller h:mm:ss. */
export function formatBingoTime(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60;
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${String(r).padStart(2, "0")}` : `${m}:${String(r).padStart(2, "0")}`;
}

/** Sträckan: meter under en kilometer, annars km med en decimal (svensk decimal). */
export function formatBingoDistance(meters: number): string {
  return meters < 1000 ? `${Math.round(meters)} m` : `${(Math.round(meters / 100) / 10).toFixed(1).replace(".", ",")} km`;
}

/** Glappet i tiden från start: "12:03–14:40". */
export function formatBingoGap(gap: readonly [number, number], startedAt: number): string {
  return `${formatBingoTime((gap[0] - startedAt) / 1000)}–${formatBingoTime((gap[1] - startedAt) / 1000)}`;
}
