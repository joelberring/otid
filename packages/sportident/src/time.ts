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
  /** När brickan lästes, enligt datorns klocka. */
  readonly reference: Date;
  /** Tävlingens tidszon, t.ex. "Europe/Stockholm". */
  readonly timeZone: string;
  /**
   * Hur långt efter referensen en tid får ligga, för att tåla att stationens
   * klocka går lite före datorns. Standard 10 minuter.
   */
  readonly toleranceMs?: number;
}

const DAY_MS = 86_400_000;

/**
 * Gör en bricktid till en absolut tidpunkt.
 *
 * Regel: välj den tolkning som ligger närmast före avläsningstidpunkten
 * (plus tolerans) och som stämmer med brickans AM/PM och veckodag när de finns.
 * För SI5, som saknar AM/PM, prövas båda halvorna av dygnet. Ett lopp kan
 * därmed vara högst 12 timmar för SI5 och en vecka för övriga brickor.
 */
export function resolveSiTime(time: SiTime, options: ResolveTimeOptions): Date {
  const tolerance = options.toleranceMs ?? 10 * 60_000;
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
  // Kan bara hända med motsägelsefull data; använd närmaste dag ändå.
  return new Date(limit - DAY_MS);
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
