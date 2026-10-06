import { listRadioRacesDue, pollRadioRace, RADIO_POLL_INTERVAL_MS } from "@o-tid/application";
import type { PoolClient } from "@o-tid/database";
import { db, pool } from "./db";
import { radioRuntime } from "./radio-runtime";

/**
 * Pollern för radiokontroller (ADR-0172 beslut 5). Körs i webbprocessen (startas från `instrumentation.ts`)
 * var tionde sekund. Bara den instans som håller PostgreSQL-låset frågar ROC/OResults; låset hålls av en egen
 * anslutning och släpps när den stängs, så en annan instans tar över om den här dör. Varje tävling hämtas med
 * sitt lastId och sin väntan efter fel (`listRadioRacesDue`). Fel för en tävling sparas och visas för admin;
 * programfel loggas utan personuppgifter och stoppar inte de andra tävlingarna.
 *
 * Stängs av med `OTID_RADIO_POLLER=off` (t.ex. när en annan process ska hämta). Startar aldrig under `next build`.
 */
const LOCK = "select pg_try_advisory_lock(hashtextextended('otid.radio-poller', 0)) as locked";

type PollerState = { started: boolean; running: boolean; lock: PoolClient | undefined; timer: ReturnType<typeof setTimeout> | undefined };
const globalPoller = globalThis as typeof globalThis & { oTidRadioPoller?: PollerState };

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Stänger låsets anslutning; PostgreSQL släpper då låset och nästa varv försöker ta det igen. */
function releaseLock(state: PollerState): void {
  const client = state.lock;
  state.lock = undefined;
  client?.release(true);
}

/** Tar eller behåller låset. Falskt om en annan instans har det. */
async function holdLock(state: PollerState): Promise<boolean> {
  if (state.lock) return true;
  const client = await pool.connect();
  let locked = false;
  try {
    locked = (await client.query<{ locked: boolean }>(LOCK)).rows[0]?.locked === true;
  } catch (error) {
    client.release(true);
    throw error;
  }
  if (!locked) { client.release(); return false; }
  client.on("error", error => {
    console.error(`Radiokontroller: låsets anslutning bröts (${message(error)}); försöker igen`);
    if (state.lock === client) releaseLock(state);
  });
  state.lock = client;
  console.info("Radiokontroller: den här instansen hämtar radiostämplingar");
  return true;
}

async function tick(state: PollerState): Promise<void> {
  if (state.running) return;
  state.running = true;
  try {
    if (!await holdLock(state)) return;
    const due = await listRadioRacesDue(db, new Date());
    for (const raceId of due) {
      try {
        await pollRadioRace(db, raceId, radioRuntime(), new Date());
      } catch (error) {
        console.error(`Radiokontroller: hämtningen för lopp ${raceId} avbröts av ett fel: ${message(error)}`);
      }
    }
  } catch (error) {
    console.error(`Radiokontroller: pollern kunde inte läsa databasen: ${message(error)}`);
    releaseLock(state);
  } finally {
    state.running = false;
    schedule(state, RADIO_POLL_INTERVAL_MS);
  }
}

function schedule(state: PollerState, delayMs: number): void {
  state.timer = setTimeout(() => { void tick(state); }, delayMs);
  state.timer.unref?.();
}

/** Startar pollern en gång per process (utvecklingsserverns omladdningar ger ingen andra). */
export function startRadioPoller(environment: Record<string, string | undefined> = process.env): void {
  if (environment.OTID_RADIO_POLLER?.trim().toLowerCase() === "off") {
    console.info("Radiokontroller: hämtningen är avstängd (OTID_RADIO_POLLER=off)");
    return;
  }
  const state = globalPoller.oTidRadioPoller ??= { started: false, running: false, lock: undefined, timer: undefined };
  if (state.started) return;
  state.started = true;
  schedule(state, 3_000);
}
