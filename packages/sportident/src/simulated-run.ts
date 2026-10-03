import { cardTypeFromSi8PlusNumber, type SiCardType } from "./card-types";
import { FakeSiStation, type SimulatedCard, type SimulatedTime } from "./simulator";
import { ReadoutSession, type SessionOutput } from "./readout-session";
import type { SiCardData } from "./decode";

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** Klockslag och veckodag i en tidszon, så som en station skulle stämpla. */
export function stationClock(at: Date, timeZone: string): SimulatedTime {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone, hourCycle: "h23", hour: "2-digit", minute: "2-digit", second: "2-digit", weekday: "short"
  }).formatToParts(at);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((value) => value.type === type)?.value ?? "0";
  return {
    secondsOfDay: Number(part("hour")) * 3600 + Number(part("minute")) * 60 + Number(part("second")),
    dayOfWeek: WEEKDAYS.indexOf(part("weekday"))
  };
}

/** Bricktyp för ett bricknummer, eller undefined om numret inte är en SPORTident-bricka. */
export function cardTypeForNumber(cardNumber: number): SiCardType | undefined {
  if (!Number.isInteger(cardNumber) || cardNumber <= 0) return undefined;
  // SI5 visar serie 1 som bara numret (1–65 535) och serie 2–4 som serie * 100 000 + nummer.
  if (cardNumber < 500_000) return cardNumber <= 65_535 || (cardNumber > 200_000 && cardNumber % 100_000 <= 65_535) ? "SI5" : undefined;
  if (cardNumber < 1_000_000) return "SI6";
  return cardTypeFromSi8PlusNumber(cardNumber);
}

export interface SimulatedRunOptions {
  readonly startAt: Date;
  readonly finishAt?: Date;
  readonly controlCodes: readonly number[];
  readonly timeZone: string;
}

/** En bricka för ett lopp med kontrollerna jämnt fördelade mellan start och mål. */
export function simulatedRun(cardNumber: number, options: SimulatedRunOptions): SimulatedCard {
  const cardType = cardTypeForNumber(cardNumber);
  if (!cardType) throw new Error("Bricknumret är inte en SPORTident-bricka");
  const start = options.startAt.getTime();
  const end = (options.finishAt ?? options.startAt).getTime();
  const step = (end - start) / (options.controlCodes.length + 1);
  const clock = (ms: number) => stationClock(new Date(Math.round(ms / 1000) * 1000), options.timeZone);
  return {
    cardType, cardNumber,
    start: clock(start),
    ...(options.finishAt ? { finish: clock(end) } : {}),
    punches: options.controlCodes.map((code, index) => ({ code, time: clock(start + step * (index + 1)) }))
  };
}

/**
 * Läser en simulerad bricka synkront genom samma protokollkod som en riktig
 * station: handskakning, upptäckt, blockläsning och avkodning.
 */
export function readSimulatedCard(card: SimulatedCard, station = new FakeSiStation()): { card: SiCardData; frames: readonly Uint8Array[] } {
  const session = new ReadoutSession();
  let result: { card: SiCardData; frames: readonly Uint8Array[] } | undefined;
  const pump = (output: SessionOutput): void => {
    for (const event of output.events) if (event.type === "card-read") result = { card: event.card, frames: event.frames };
    for (const bytes of output.send) for (const reply of station.receive(bytes)) pump(session.receive(reply));
  };
  pump(session.start());
  for (const frame of station.insert(card)) pump(session.receive(frame));
  if (!result) throw new Error("Den simulerade brickan kunde inte läsas");
  return result;
}
