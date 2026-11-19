import { useCallback, useEffect, useRef, useState } from "react";
import { mastermindStationResponseSchema, mastermindSyncResponseSchema } from "@o-tid/contracts";
import { DEFAULT_SETTINGS, mergeMastermindState, normalizeGame, readSettings, type MastermindState } from "@o-tid/domain/mastermind";
import { accountCsrf } from "../readout/api";
import type { SavedState } from "./saved-state";

/**
 * Kön mot servern (ADR-0228), som bingons: läget sparas i webbläsaren vid varje ändring och skickas helt tills servern har
 * tagit emot den senaste versionen. Svaret är serverns sammanslagna läge, som slås ihop med det som har hänt här under tiden.
 *
 * Två sätt: `staff` (arrangören och funktionären, inloggad: hela träningen, också andra datorers spel) och `station`
 * ("Spela på egen dator" från tävlingssidan, utan inloggning: datorns egna spel och träningens inställningar). En station
 * skickar alltid (också utan ändringar), så att den får träningens inställningar och vet om spelet är öppet.
 */
export type SyncMode = "staff" | "station";
export type SyncStatus = "saved" | "pending" | "offline" | "unauthorized" | "failed" | "closed";

/** Det servern säger om träningen utöver spelen. */
export type SyncInfo =
  | { readonly mode: "staff"; readonly openStations: boolean; readonly canOpen: boolean }
  | { readonly mode: "station"; readonly eventName: string; readonly raceName: string; readonly shortCode: string };

export type SyncOutcome =
  | { readonly kind: "ok"; readonly state: MastermindState; readonly info: SyncInfo }
  | { readonly kind: "unauthorized" | "offline" | "closed" }
  | { readonly kind: "failed"; readonly status: number };

export interface SyncDependencies {
  readonly fetch: typeof fetch;
  /** Kontots CSRF-värde ur kakan; saknas det är ingen inloggad. */
  readonly csrf: () => string | undefined;
}

const staffPath = (raceId: string) => `/api/admin/races/${encodeURIComponent(raceId)}/administrator/mastermind`;
const stationPath = (raceId: string) => `/api/public/races/${encodeURIComponent(raceId)}/mastermind`;

/** Spelen som servern skickar, med samma kontroll som servern gör: ett spel som inte passar sina inställningar tas inte in. */
const checkedGames = (games: readonly unknown[]) => games.flatMap((game) => normalizeGame(game) ?? []);

async function receive(raceId: string, response: Response, mode: SyncMode): Promise<SyncOutcome> {
  if (mode === "station" && response.status === 403) {
    const body = await response.json().catch(() => undefined) as { error?: string } | undefined;
    return body?.error === "CLOSED" ? { kind: "closed" } : { kind: "failed", status: 403 };
  }
  if (response.status === 401 || response.status === 403) return { kind: "unauthorized" };
  if (!response.ok) return { kind: "failed", status: response.status };
  const json: unknown = await response.json();
  if (mode === "station") {
    const body = mastermindStationResponseSchema.parse(json);
    if (body.raceId !== raceId) throw new Error("Mastermind: svaret gäller en annan träning");
    return { kind: "ok", state: { settings: readSettings(body.settings) ?? DEFAULT_SETTINGS, games: checkedGames(body.games), names: body.names },
      info: { mode, eventName: body.eventName, raceName: body.raceName, shortCode: body.shortCode } };
  }
  const body = mastermindSyncResponseSchema.parse(json);
  if (body.raceId !== raceId) throw new Error("Mastermind: svaret gäller en annan träning");
  return { kind: "ok", state: { settings: readSettings(body.settings) ?? DEFAULT_SETTINGS, ...(body.settingsAt ? { settingsAt: body.settingsAt } : {}),
    games: checkedGames(body.games), names: body.names }, info: { mode, openStations: body.openStations, canOpen: body.canOpen } };
}

async function send(path: string, init: RequestInit, deps: SyncDependencies): Promise<Response | undefined> {
  try { return await deps.fetch(path, { credentials: "same-origin", cache: "no-store", ...init }); }
  catch { return undefined; }
}

/** Arrangörens dator: skickar hela läget och får tillbaka serverns sammanslagna läge. */
export async function pushMastermind(raceId: string, state: MastermindState, deps: SyncDependencies): Promise<SyncOutcome> {
  const csrf = deps.csrf();
  if (!csrf) return { kind: "unauthorized" };
  const body = { formatVersion: 1, settings: state.settings, ...(state.settingsAt ? { settingsAt: state.settingsAt } : {}), games: state.games,
    names: state.names };
  const response = await send(staffPath(raceId), { method: "POST", headers: { "content-type": "application/json", "x-otid-csrf": csrf },
    body: JSON.stringify(body) }, deps);
  return response ? receive(raceId, response, "staff") : { kind: "offline" };
}

/** Arrangörens dator: serverns läge för träningen. */
export async function pullMastermind(raceId: string, deps: Pick<SyncDependencies, "fetch">): Promise<SyncOutcome> {
  const response = await send(staffPath(raceId), {}, { ...deps, csrf: () => undefined });
  return response ? receive(raceId, response, "staff") : { kind: "offline" };
}

/** "Spela på egen dator": datorns spel in (med datorns nyckel), träningens inställningar och datorns spel ut. */
export async function pushStation(raceId: string, stationKey: string, state: MastermindState, deps: Pick<SyncDependencies, "fetch">): Promise<SyncOutcome> {
  const response = await send(stationPath(raceId), { method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ formatVersion: 1, stationKey, games: state.games, names: state.names }) }, { ...deps, csrf: () => undefined });
  return response ? receive(raceId, response, "station") : { kind: "offline" };
}

/** Administratören slår på eller av "Spela på egen dator". Ger det nya läget, eller undefined om det inte gick. */
export async function setOpenStations(raceId: string, open: boolean, deps: SyncDependencies): Promise<SyncOutcome> {
  const csrf = deps.csrf();
  if (!csrf) return { kind: "unauthorized" };
  const response = await send(staffPath(raceId), { method: "PUT", headers: { "content-type": "application/json", "x-otid-csrf": csrf },
    body: JSON.stringify({ formatVersion: 1, open }) }, deps);
  return response ? receive(raceId, response, "staff") : { kind: "offline" };
}

/**
 * Serverns läge in i det lokala. Servern först (det som inte ändras under ett spel tas därifrån), sedan det lokala, så att
 * inget som hänt här går förlorat. Versionen ändras inte: det lokala som servern saknar skickas ändå, eftersom `acked` inte
 * har flyttats fram. En station tar alltid träningens inställningar.
 */
export function withServer(local: SavedState, server: MastermindState, sentVersion?: number, mode: SyncMode = "staff"): SavedState {
  const merged = mergeMastermindState(server, local);
  const settings = mode === "station" ? { settings: server.settings } : {};
  return { ...merged, ...settings, version: local.version, acked: sentVersion === undefined ? local.acked : Math.max(local.acked, sentVersion) };
}

/** Datorns nyckel för träningen ("Spela på egen dator"), slumpad en gång och sparad i webbläsaren. */
export function stationKey(raceId: string, storage: Pick<Storage, "getItem" | "setItem"> | undefined = globalThis.localStorage): string {
  const name = `otid.mastermind.station.${raceId}`;
  try {
    const known = storage?.getItem(name);
    if (known && /^[A-Za-z0-9_-]{32,64}$/.test(known)) return known;
  } catch { /* lagringen går inte att läsa: en ny nyckel för den här sidan */ }
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  const key = btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  try { storage?.setItem(name, key); } catch { /* som ovan */ }
  return key;
}

const INTERVAL_MS = 10_000;
/** Kort väntan efter en ändring, så att flera utläsningar i rad skickas tillsammans. */
const AFTER_CHANGE_MS = 1_500;

/**
 * Håller läget i takt med servern för träningen `raceId` (utan träning: inget). `version` och `acked` är det lokala lägets
 * (en ändring som servern inte har kvitterat visas som "sparar"), `read` ger det senaste lokala läget och `apply` sparar det
 * sammanslagna (utan att räkna upp versionen).
 */
export function useMastermindSync(raceId: string | undefined, mode: SyncMode, version: number, acked: number, read: () => SavedState,
  apply: (next: SavedState) => void): { status: SyncStatus | undefined; info: SyncInfo | undefined; setInfo: (info: SyncInfo) => void } {
  const [status, setStatus] = useState<SyncStatus>("pending");
  const [info, setInfo] = useState<SyncInfo>();
  const busy = useRef(false);
  const readRef = useRef(read);
  const applyRef = useRef(apply);
  useEffect(() => { readRef.current = read; applyRef.current = apply; });

  const run = useCallback(async () => {
    if (!raceId || busy.current) return;
    busy.current = true;
    try {
      const before = readRef.current();
      const sending = mode === "station" || before.version > before.acked;
      const deps = { fetch: (...args: Parameters<typeof fetch>) => fetch(...args), csrf: accountCsrf };
      const outcome = mode === "station" ? await pushStation(raceId, stationKey(raceId), before, deps)
        : sending ? await pushMastermind(raceId, before, deps) : await pullMastermind(raceId, deps);
      if (outcome.kind !== "ok") {
        setStatus(outcome.kind === "failed" ? "failed" : outcome.kind);
        if (outcome.kind === "failed") console.warn("Mastermind: servern svarade", outcome.status);
        return;
      }
      const next = withServer(readRef.current(), outcome.state, sending ? before.version : undefined, mode);
      applyRef.current(next);
      setInfo(outcome.info);
      setStatus(next.version > next.acked ? "pending" : "saved");
    } catch (error) {
      console.warn("Mastermind: läget kunde inte skickas; försöker igen", error);
      setStatus("failed");
    } finally {
      busy.current = false;
    }
  }, [raceId, mode]);

  useEffect(() => {
    if (!raceId) return undefined;
    const timer = window.setInterval(() => { if (document.visibilityState === "visible") void run(); }, INTERVAL_MS);
    const online = () => void run();
    window.addEventListener("online", online);
    return () => { window.clearInterval(timer); window.removeEventListener("online", online); };
  }, [raceId, run]);

  // Vid start och strax efter varje ändring här.
  useEffect(() => {
    if (!raceId) return undefined;
    const timer = window.setTimeout(() => void run(), version === 0 ? 0 : AFTER_CHANGE_MS);
    return () => window.clearTimeout(timer);
  }, [raceId, version, run]);

  // Det senaste svaret kan vara äldre än en ändring här: då är inte allt sparat än.
  const shown: SyncStatus = status === "saved" && version > acked ? "pending" : status;
  return { status: raceId ? shown : undefined, info, setInfo };
}
