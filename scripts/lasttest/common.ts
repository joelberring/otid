/**
 * Gemensamt för lasttestet (PLAN.md steg 51): påhittade namn, brickor och avläsningar som avläsningssidan skickar dem.
 * Endast syntetiska namn. Körs aldrig mot produktionsdata.
 */
import { createHash } from "node:crypto";
import type { DeviceBatch, SportidentReadoutPayload } from "../../packages/contracts/src/index.ts";
import { normalizeCard, readSimulatedCard, simulatedRun } from "../../packages/sportident/src/index.ts";

export const TIME_ZONE = "Europe/Stockholm";
export const EMAIL = "lasttest@o-tid.local";
export const PASSWORD = "lasttest-lösen-1";

const GIVEN = ["Alva", "Bertil", "Cecilia", "Dag", "Ebba", "Folke", "Greta", "Hampus", "Ines", "Jarl", "Karin", "Lage", "Maja",
  "Nils", "Olga", "Pelle", "Rut", "Sixten", "Tyra", "Ulf", "Vera", "Wilmer", "Ylva", "Åke", "Ester", "Gösta", "Hedda", "Ivar",
  "Juni", "Krister", "Lova", "Mio", "Nora", "Otto", "Petra", "Rune", "Saga", "Tor", "Uma", "Viggo", "Alfons", "Britta", "Conny",
  "Doris", "Einar", "Frida", "Gunnar", "Hjördis", "Ingvar", "Jenny", "Kalle", "Lisen", "Måns", "Nanna", "Orvar", "Pia", "Ragnar",
  "Sonja", "Tage", "Ulla"] as const;
const FAMILY = ["Ask", "Björk", "Clason", "Dahl", "Ek", "Fors", "Gran", "Hägg", "Is", "Järv", "Kärr", "Lind", "Myr", "Näs",
  "Olm", "Pil", "Rönn", "Sälg", "Tall", "Ulv", "Vass", "Wall", "Ystad", "Åkerö", "Ängs", "Öberg", "Backe", "Dunge", "Eneby",
  "Fjäll", "Glänta", "Hed", "Klint", "Lund", "Mosse", "Nord", "Ström", "Torp", "Udd", "Vik", "Ås", "Bäck", "Dal", "Fall",
  "Grund", "Holm", "Kulle", "Lid", "Moberg", "Nyhem", "Ref", "Sand", "Tjärn", "Uggla", "Varg", "Älv", "Ö", "Brink", "Ekdal", "Höjd"] as const;
const CLUB_PARTS = ["Granen", "Tallen", "Mossen", "Kärret", "Sjön", "Åsen", "Berget", "Dalen", "Näset", "Udden"] as const;

/** Unikt namn för index < 3 600 (namnet används för att se när en löpare syns i resultatlistan). */
export function runnerName(index: number): { givenName: string; familyName: string } {
  return { givenName: GIVEN[index % GIVEN.length]!, familyName: FAMILY[Math.floor(index / GIVEN.length) % FAMILY.length]! };
}

export function clubName(index: number): string {
  return `OK ${CLUB_PARTS[index % CLUB_PARTS.length]!} ${1 + Math.floor(index / CLUB_PARTS.length) % 12}`;
}

/** Deterministisk slump (mulberry32), så att samma frö ger samma tävling. */
export function random(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296;
  };
}

export type ReadoutRun = { cardNumber: number; startAt: Date; finishAt: Date; controlCodes: readonly number[] };

/** En avläsning precis som avläsningssidan bygger den (riktiga SPORTident-ramar från den simulerade stationen). */
export function readoutEvent(run: ReadoutRun, localSequence: number, readAt: Date): DeviceBatch["events"][number] {
  const read = readSimulatedCard(simulatedRun(run.cardNumber, { startAt: run.startAt, finishAt: run.finishAt,
    controlCodes: run.controlCodes, timeZone: TIME_ZONE }));
  const card = normalizeCard(read.card, { reference: readAt, timeZone: TIME_ZONE });
  const payload: SportidentReadoutPayload = {
    cardNumber: card.cardNumber, cardType: card.cardType,
    ...(card.startPunchedAt ? { startPunchedAt: card.startPunchedAt } : {}),
    ...(card.finishPunchedAt ? { finishPunchedAt: card.finishPunchedAt } : {}),
    punches: card.punches.map((punch) => ({ code: punch.code, punchedAt: punch.punchedAt })),
    untimedPunchCodes: [...card.untimedPunchCodes],
    frames: read.frames.map((frame) => Buffer.from(frame).toString("hex")),
    stationSerial: 999_051, simulated: true
  };
  return { localSequence, stationReceivedAt: readAt.toISOString(), transport: "sportident", payload,
    contentHash: createHash("sha256").update(JSON.stringify(payload)).digest("hex") };
}

export function fail(message: string): never {
  throw new Error(message);
}

export function describe(error: unknown): string {
  if (!(error instanceof Error)) return String(error);
  const cause = error.cause instanceof Error ? `: ${error.cause.message}` : "";
  return `${error.message}${cause}`;
}
