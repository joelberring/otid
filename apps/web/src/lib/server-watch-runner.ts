import {
  hostPaths, readHost, readMemory, runServerWatch, serverWatchSettings, type HostReadings, type ServerMailer
} from "@o-tid/application";
import { loadavg } from "node:os";
import { db } from "./db";
import { mailEnabled, mailErrorSummary, sendMessage, type TransportFactory } from "./mail";

/**
 * ADR-0216: serverns bevakning i webbprocessen (som underhållet, startas från `instrumentation.ts`), bara i tävlingens instans.
 * Tio minuter efter start och sedan var OTID_HEALTH_INTERVAL_MINUTES:e minut (förval 15): mätningen sparas, larm och "löst" mejlas
 * till superadmin (högst ett per sort och dygn) och veckorapporten går söndag kl. 19 (OTID_SERVER_REPORT_DAY/_HOUR). Mellan varven
 * mäts belastningen och det lediga minnet varje minut, så att rapporten får topparna. Stängs av med `OTID_SERVER_WATCH=off`.
 * Utan e-post (`OTID_SMTP_URL`) skrivs larmen och rapporten i loggen i stället.
 */
type Env = Partial<Record<string, string | undefined>>;
type WatchState = { started: boolean; running: boolean; loadMax: number; loadMaxAt: Date; memoryMin: { totalBytes: number; availableBytes: number } | null };
const globalWatch = globalThis as typeof globalThis & { oTidServerWatch?: WatchState };

/** Mejlar meddelandet till varje mottagare för sig (adresserna syns inte för varandra). Kastar bara om inget mejl gick iväg. */
export function serverMailer(environment: Env, send: typeof sendMessage = sendMessage, createTransport?: TransportFactory): ServerMailer {
  return async (message, recipients) => {
    const configuration = mailEnabled(environment);
    if (!configuration || recipients.length === 0) {
      console.info(`Serverbevakning (${configuration ? "ingen superadmin att mejla" : "e-post avstängd"}): ${message.subject}\n${message.text}`);
      return 0;
    }
    let sent = 0;
    let lastError: unknown;
    for (const to of recipients) {
      try { await send(configuration, to, message, createTransport); sent += 1; }
      catch (error) { lastError = error; console.error(`Serverbevakningens mejl kunde inte skickas (${mailErrorSummary(error)}).`); }
    }
    if (sent === 0) throw lastError instanceof Error ? lastError : new Error("Inget mejl kunde skickas");
    return sent;
  };
}

export function serverName(environment: Env): string {
  try { return new URL(environment.O_TID_PUBLIC_ORIGIN ?? "").host || "servern"; } catch { return "servern"; }
}

async function tick(state: WatchState, environment: Env): Promise<void> {
  if (state.running) return;
  state.running = true;
  const now = new Date();
  try {
    const host: HostReadings = await readHost(hostPaths(environment), now);
    const measured: HostReadings = { ...host,
      load: host.load ? { ...host.load, ...(state.loadMax > host.load.max ? { max: state.loadMax, at: state.loadMaxAt } : {}) } : null,
      memory: state.memoryMin && host.memory && state.memoryMin.availableBytes < host.memory.availableBytes ? state.memoryMin : host.memory };
    const result = await runServerWatch(db, { host: measured, now, settings: serverWatchSettings(environment), serverName: serverName(environment),
      send: serverMailer(environment), env: environment });
    for (const alert of result.alerts) console.info(`Serverbevakning: ${alert.status === "ALERT" ? "larm" : "löst"} (${alert.kind})`);
    if (result.report === "sent") console.info("Serverbevakning: veckorapporten skickad");
    state.loadMax = 0;
    state.memoryMin = null;
  } catch (error) {
    console.error(`Serverbevakningen avbröts av ett fel: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    state.running = false;
  }
}

/** Belastningen och minnet varje minut (ingen I/O utöver /proc/meminfo). */
async function sampleMinute(state: WatchState): Promise<void> {
  const load = loadavg()[0] ?? 0;
  if (load >= state.loadMax) { state.loadMax = load; state.loadMaxAt = new Date(); }
  const memory = await readMemory();
  if (!state.memoryMin || memory.availableBytes < state.memoryMin.availableBytes) state.memoryMin = memory;
}

export function startServerWatch(environment: Env = process.env): void {
  if (environment.OTID_INSTANCE_ROLE?.trim().toLowerCase() === "public" || environment.OTID_SERVER_WATCH?.trim().toLowerCase() === "off") return;
  const state = globalWatch.oTidServerWatch ??= { started: false, running: false, loadMax: 0, loadMaxAt: new Date(), memoryMin: null };
  if (state.started) return;
  state.started = true;
  const settings = serverWatchSettings(environment);
  const days = ["", "måndag", "tisdag", "onsdag", "torsdag", "fredag", "lördag", "söndag"];
  console.info(`Serverbevakning: var ${settings.intervalMinutes}:e minut; larm ${settings.alerts ? "på" : "av"}; veckorapport ` +
    `${settings.report ? `${days[settings.report.day]} kl. ${settings.report.hour}` : "av"} (ADR-0216)`);
  setInterval(() => void sampleMinute(state).catch(() => undefined), 60_000).unref();
  setTimeout(() => {
    void tick(state, environment);
    setInterval(() => void tick(state, environment), settings.intervalMinutes * 60_000).unref();
  }, 10 * 60_000).unref();
}
