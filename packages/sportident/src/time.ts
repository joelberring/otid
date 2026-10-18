import { NO_TIME } from "./constants";

/**
 * En tid så som den lagras på brickan: sekunder inom en 12-timmarsperiod,
 * plus (från SI6 och framåt) AM/PM och veckodag.
 */
export interface SiTime {
  readonly secondsIn12h: number;
  /** true = eftermiddag. Saknas på SI5. */
  readonly pm?: boolean;
  /** 0 = söndag … 6 = lördag. Saknas på SI5 och när stationen inte vet. */
  readonly dayOfWeek?: number;
}

/** Läser två tidsbyte och en valfri dagbyte. `undefined` betyder ingen tid. */
export function decodeSiTime(high: number, low: number, dayByte?: number): SiTime | undefined {
  const seconds = (high << 8) | low;
  if (seconds === NO_TIME || seconds >= 12 * 3600) return undefined;
  if (dayByte === undefined) return { secondsIn12h: seconds };
  const weekday = (dayByte >> 1) & 0b111;
  return {
    secondsIn12h: seconds,
    pm: (dayByte & 1) === 1,
    ...(weekday === 7 ? {} : { dayOfWeek: weekday })
  };
}

/** Stationskodens två höga bitar ligger i dagbyten (koder över 255). */
export function decodeControlCode(code: number, dayByte?: number): number {
  return dayByte === undefined ? code : ((dayByte & 0xc0) << 2) + code;
}

export interface ResolveTimeOptions {
  /**
   * När brickan lästes. Helst avläsningsstationens klocka (GET_TIME vid
   * handskakningen), eftersom kontrollenheterna normalt är ställda mot samma
   * klocka; annars datorns.
   */
  readonly reference: Date;
  /** Tävlingens tidszon, t.ex. "Europe/Stockholm". */
  readonly timeZone: string;
  /**
   * Hur långt efter referensen en tid får ligga, för att tåla att en kontroll-
   * enhets klocka går före referensen. Standard 2 timmar: en stämpling längre
   * fram i tiden än så tolkas som föregående dygn eller vecka.
   */
  readonly toleranceMs?: number;
}

/** Standardtoleransen för tider "i framtiden" i förhållande till referensen. */
export const DEFAULT_TIME_TOLERANCE_MS = 2 * 3_600_000;

/** Bricktiden går inte att placera i tiden utan motsägelse. */
export class SiTimeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SiTimeError";
  }
}

/**
 * Gör en bricktid till en absolut tidpunkt.
 *
 * Regel: välj den tolkning som ligger närmast före referensen (plus tolerans)
 * och som stämmer med brickans AM/PM och veckodag när de finns. För SI5, som
 * saknar AM/PM, prövas båda halvorna av dygnet. Ett lopp kan därmed vara
 * högst 12 timmar för SI5 och en vecka för övriga brickor. Motsägelsefull
 * data ger ett fel i stället för en rimlig men felaktig tid.
 */
export function resolveSiTime(time: SiTime, options: ResolveTimeOptions): Date {
  const tolerance = options.toleranceMs ?? DEFAULT_TIME_TOLERANCE_MS;
  if (!Number.isFinite(options.reference.getTime())) throw new SiTimeError("Referenstiden är ogiltig");
  if (!Number.isInteger(time.secondsIn12h) || time.secondsIn12h < 0 || time.secondsIn12h >= 12 * 3600 ||
    (time.dayOfWeek !== undefined && (!Number.isInteger(time.dayOfWeek) || time.dayOfWeek < 0 || time.dayOfWeek > 6))) {
    throw new SiTimeError("Bricktiden är ogiltig");
  }
  const limit = options.reference.getTime() + tolerance;
  const today = localDate(options.reference, options.timeZone);
  const halves = time.pm === undefined ? [1, 0] : [time.pm ? 1 : 0];
  for (let daysBack = 0; daysBack <= 8; daysBack += 1) {
    const day = new Date(Date.UTC(today.year, today.month - 1, today.day - daysBack));
    if (time.dayOfWeek !== undefined && day.getUTCDay() !== time.dayOfWeek) continue;
    for (const half of halves) {
      const secondsOfDay = half * 12 * 3600 + time.secondsIn12h;
      const candidate = wallClockToUtc(
        day.getUTCFullYear(),
        day.getUTCMonth() + 1,
        day.getUTCDate(),
        secondsOfDay,
        options.timeZone
      );
      if (candidate.getTime() <= limit) return candidate;
    }
  }
  throw new SiTimeError("Bricktiden kan inte placeras inom en vecka före avläsningen");
}

/** Stationens klocka så som GET_TIME svarar: lokal väggklocka (tidszon okänd för stationen). */
export interface StationClock {
  readonly year: number;
  readonly month: number;
  readonly day: number;
  /** Sekunder sedan midnatt, 0–86 399. */
  readonly secondsOfDay: number;
  /** Tusendelar inom sekunden (stationen räknar i 1/256 s). */
  readonly milliseconds: number;
}

/**
 * Tolkar datadelen i svaret på GET_TIME (0xF7): år (två siffror), månad, dag,
 * en byte med veckodag och AM/PM, två byte sekunder i halvdygnet och en byte
 * 1/256-dels sekunder. `undefined` när svaret är för kort eller orimligt.
 */
export function decodeStationClock(data: Uint8Array): StationClock | undefined {
  if (data.length < 7) return undefined;
  const [yy, month, day, halfDayByte, high, low, subSecond] = data as unknown as [number, number, number, number, number, number, number];
  const secondsIn12h = (high << 8) | low;
  if (month < 1 || month > 12 || day < 1 || day > 31 || secondsIn12h >= 12 * 3600) return undefined;
  const year = 2000 + yy;
  if (new Date(Date.UTC(year, month - 1, day)).getUTCDate() !== day) return undefined;
  return {
    year, month, day,
    secondsOfDay: (halfDayByte & 1) * 12 * 3600 + secondsIn12h,
    milliseconds: Math.round((subSecond * 1000) / 256)
  };
}

/** Kodar en klocka som datadelen i GET_TIME-svaret (för den falska stationen och tester). */
export function encodeStationClock(clock: StationClock, dayOfWeek: number): number[] {
  const pm = clock.secondsOfDay >= 12 * 3600 ? 1 : 0;
  const seconds = clock.secondsOfDay % (12 * 3600);
  return [clock.year % 100, clock.month, clock.day, (dayOfWeek << 1) | pm, (seconds >> 8) & 0xff, seconds & 0xff,
    Math.min(255, Math.round((clock.milliseconds * 256) / 1000))];
}

/** Stationens väggklocka tolkad i tävlingens tidszon. */
export function stationClockToDate(clock: StationClock, timeZone: string): Date {
  const date = wallClockToUtc(clock.year, clock.month, clock.day, clock.secondsOfDay, timeZone);
  return new Date(date.getTime() + clock.milliseconds);
}

/** En tidpunkt som stationsklocka i en tidszon (för den falska stationen). */
export function stationClockFromDate(instant: Date, timeZone: string): { clock: StationClock; dayOfWeek: number } {
  const p = wallClockParts(instant, timeZone);
  const day = new Date(Date.UTC(p.year, p.month - 1, p.day));
  return {
    clock: { year: p.year, month: p.month, day: p.day, secondsOfDay: p.hour * 3600 + p.minute * 60 + p.second,
      milliseconds: instant.getTime() % 1000 },
    dayOfWeek: day.getUTCDay()
  };
}

interface LocalDate {
  readonly year: number;
  readonly month: number;
  readonly day: number;
}

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatter(timeZone: string): Intl.DateTimeFormat {
  let existing = formatters.get(timeZone);
  if (!existing) {
    existing = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit"
    });
    formatters.set(timeZone, existing);
  }
  return existing;
}

function wallClockParts(instant: Date, timeZone: string) {
  const parts = Object.fromEntries(
    formatter(timeZone)
      .formatToParts(instant)
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, Number(part.value)])
  ) as Record<"year" | "month" | "day" | "hour" | "minute" | "second", number>;
  return parts;
}

function localDate(instant: Date, timeZone: string): LocalDate {
  const { year, month, day } = wallClockParts(instant, timeZone);
  return { year, month, day };
}

function offsetMs(instantMs: number, timeZone: string): number {
  const p = wallClockParts(new Date(instantMs), timeZone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asUtc - Math.floor(instantMs / 1000) * 1000;
}

/** Lokal väggklocka i en tidszon → absolut tidpunkt. */
export function wallClockToUtc(year: number, month: number, day: number, secondsOfDay: number, timeZone: string): Date {
  const naive = Date.UTC(year, month - 1, day) + secondsOfDay * 1000;
  let guess = naive - offsetMs(naive, timeZone);
  const corrected = naive - offsetMs(guess, timeZone);
  if (corrected !== guess) guess = corrected;
  return new Date(guess);
}
