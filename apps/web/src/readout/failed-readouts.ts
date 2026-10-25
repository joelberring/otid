import { uninterpretedReadoutReceiptSchema, type UninterpretedReadoutRequest } from "@o-tid/contracts";
import type { SyncDependencies } from "./sync";

/**
 * Steg 31: avläsningar vars tider inte gick att tolka ens med datorns klocka. De kan inte köas som vanliga avläsningar
 * (servern kräver tolkade tider) men får inte försvinna: kortnummer, tid och råramar sparas i webbläsaren och visas tills
 * funktionären tagit bort dem. Steg 45: de skickas också till servern (`uninterpreted-readouts`), så att råramarna finns
 * kvar även om webbläsaren rensas, och administratören kan läsa om dem under Avläsning.
 */
export interface FailedReadout {
  readonly cardNumber: string;
  readonly at: string;
  readonly message: string;
  readonly frames: readonly string[];
  /** Steg 45: stabil per avläsning (idempotens på servern). Saknas i rader från före steg 45 och läggs till då. */
  readonly requestId?: string;
  readonly deviceId?: string;
  readonly sessionId?: string;
  readonly packageVersion?: number;
  readonly stationSerial?: number;
  readonly clockSource?: "station" | "device";
  readonly clockOffsetMs?: number;
  readonly simulated?: boolean;
  /** Servern har kvitterat råramarna. */
  readonly storedAt?: string;
}

const key = (raceId: string) => `otid-readout-failed:${raceId}`;

export function loadFailedReadouts(raceId: string): FailedReadout[] {
  try {
    const value: unknown = JSON.parse(window.localStorage.getItem(key(raceId)) ?? "[]");
    return Array.isArray(value) ? value.filter((row): row is FailedReadout => typeof row === "object" && row !== null &&
      typeof (row as FailedReadout).cardNumber === "string" && typeof (row as FailedReadout).at === "string") : [];
  } catch (error) {
    console.warn("Avläsningar som inte kunde tolkas kunde inte läsas", error);
    return [];
  }
}

export function saveFailedReadouts(raceId: string, rows: readonly FailedReadout[]): void {
  try { window.localStorage.setItem(key(raceId), JSON.stringify(rows.slice(-50))); }
  catch (error) { console.warn("Avläsningen som inte kunde tolkas kunde inte sparas", error); }
}

/** Begäran till servern, eller undefined när raden inte går att skicka (inga råramar eller ogiltigt bricknummer). */
export function failedReadoutRequest(row: FailedReadout, identity: { deviceId: string; sessionId: string }, packageVersion: number):
  UninterpretedReadoutRequest | undefined {
  if (!row.requestId || row.frames.length === 0 || row.frames.length > 12 || !/^[1-9][0-9]{0,8}$/.test(row.cardNumber)) return undefined;
  return { formatVersion: 1, requestId: row.requestId, deviceId: row.deviceId ?? identity.deviceId,
    sessionId: row.sessionId ?? identity.sessionId, packageVersion: row.packageVersion ?? packageVersion, stationReceivedAt: row.at,
    payload: { cardNumber: row.cardNumber, frames: [...row.frames], error: row.message.trim().slice(0, 300) || "SiTimeError",
      ...(row.stationSerial !== undefined ? { stationSerial: row.stationSerial } : {}),
      ...(row.clockSource !== undefined ? { clockSource: row.clockSource } : {}),
      ...(row.clockOffsetMs !== undefined ? { clockOffsetMs: Math.round(row.clockOffsetMs) } : {}),
      simulated: row.simulated ?? false } };
}

export type FailedSyncOutcome = { readonly kind: "done"; readonly stored: number } | { readonly kind: "offline" | "unauthorized" } |
  { readonly kind: "failed"; readonly status: number };

/**
 * Skickar de otolkade avläsningar som servern inte kvitterat. En rad markeras först när servern svarat med kvitto; vid
 * nätfel eller serverfel ligger den kvar och skickas igen vid nästa synk. Rader utan `requestId` (före steg 45) får ett.
 */
export async function syncFailedReadouts(raceId: string, identity: { deviceId: string; sessionId: string }, packageVersion: number,
  deps: SyncDependencies, storage: { load: (raceId: string) => FailedReadout[]; save: (raceId: string, rows: readonly FailedReadout[]) => void } =
  { load: loadFailedReadouts, save: saveFailedReadouts }, newId: () => string = () => crypto.randomUUID()): Promise<FailedSyncOutcome> {
  let rows = storage.load(raceId);
  if (rows.some((row) => !row.requestId)) {
    rows = rows.map((row) => row.requestId ? row : { ...row, requestId: newId() });
    storage.save(raceId, rows);
  }
  let stored = 0;
  for (const row of rows.filter((candidate) => !candidate.storedAt)) {
    const request = failedReadoutRequest(row, identity, packageVersion);
    if (!request) continue;
    const csrf = deps.csrf();
    if (!csrf) return { kind: "unauthorized" };
    let response: Response;
    try {
      response = await deps.fetch(`/api/admin/races/${encodeURIComponent(raceId)}/administrator/uninterpreted-readouts`, {
        method: "POST", credentials: "same-origin", cache: "no-store",
        headers: { "content-type": "application/json", "x-otid-csrf": csrf }, body: JSON.stringify(request)
      });
    } catch {
      return { kind: "offline" };
    }
    if (response.status === 401 || response.status === 403) return { kind: "unauthorized" };
    if (!response.ok) return { kind: "failed", status: response.status };
    const receipt = uninterpretedReadoutReceiptSchema.parse(await response.json());
    if (receipt.requestId !== row.requestId || receipt.raceId !== raceId) throw new Error("Kvittot gäller en annan avläsning");
    // Läs om listan: funktionären kan ha rensat den under tiden.
    const current = storage.load(raceId);
    storage.save(raceId, current.map((candidate) => candidate.requestId === row.requestId
      ? { ...candidate, storedAt: new Date().toISOString() } : candidate));
    stored += 1;
  }
  return { kind: "done", stored };
}

/** "Ladda ner": listan med råramar som en JSON-fil, för den som driver O-Tid. */
export function failedReadoutsFile(raceId: string, rows: readonly FailedReadout[]): string {
  return JSON.stringify({ format: "otid-failed-readouts", formatVersion: 1, raceId, exportedAt: new Date().toISOString(), readouts: rows },
    null, 2);
}
