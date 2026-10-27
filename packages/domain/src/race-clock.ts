/** Väggklockan i tidszonen för ett ögonblick, uttryckt som om den vore UTC (ms). */
function wallClock(ms: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("sv-SE", { timeZone, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" }).formatToParts(new Date(ms));
  const value = (type: string) => Number(parts.find(part => part.type === type)?.value);
  return Date.UTC(value("year"), value("month") - 1, value("day"), value("hour"), value("minute"), value("second"));
}

/**
 * Ett klockslag ("HH:MM" eller "HH:MM:SS") på ett visst datum i tävlingens tidszon som ISO-ögonblick (UTC).
 * Användaren skriver bara klockslaget; appen räknar ut tidszonens förskjutning. Ett klockslag som inte finns
 * (vid övergång till sommartid) ger null. Ett dubbeltydigt klockslag (vid övergång till vintertid) ger det första.
 */
export function parseRaceClock(date: string, clock: string, timeZone: string): string | null {
  const day = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date.trim());
  const time = /^(\d{1,2})[:.](\d{2})(?:[:.](\d{2}))?$/.exec(clock.trim());
  if (!day || !time) return null;
  const [hour, minute, second] = [Number(time[1]), Number(time[2]), Number(time[3] ?? 0)];
  if (hour > 23 || minute > 59 || second > 59) return null;
  const wanted = Date.UTC(Number(day[1]), Number(day[2]) - 1, Number(day[3]), hour, minute, second);
  if (!Number.isFinite(wanted)) return null;
  // Från gissningar på båda sidor om klockslaget konvergerar förskjutningen till varje möjlig tolkning.
  const candidates = [wanted - 14 * 3_600_000, wanted, wanted + 14 * 3_600_000].map(guess => {
    let instant = guess;
    for (let round = 0; round < 3; round += 1) instant = wanted - (wallClock(instant, timeZone) - instant);
    return instant;
  }).filter(instant => wallClock(instant, timeZone) === wanted).sort((a, b) => a - b);
  return candidates.length ? new Date(candidates[0]!).toISOString() : null;
}

/** Tävlingsdagens datum i tävlingens tidszon för ett ögonblick, som "ÅÅÅÅ-MM-DD". */
export function localRaceDate(instant: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("sv-SE", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(instant);
  const value = (type: string) => parts.find(part => part.type === type)?.value ?? "";
  return `${value("year")}-${value("month")}-${value("day")}`;
}

/**
 * Sant från midnatt på tävlingsdagen i tävlingens tidszon (PLAN.md steg 22). Före det är ingen "kvar i skogen":
 * anmälda som inte lästs av räknas först när tävlingen kan ha börjat.
 */
export function raceDayStarted(raceDate: string, timeZone: string, now: Date): boolean {
  return localRaceDate(now, timeZone) >= raceDate;
}

/**
 * Steg 58 (ADR-0178): tävlingsdygnet. En tävling som börjar på kvällen och går över midnatt (nattstafett, Tiomila, Jukola,
 * natt-KM) hör till tävlingsdagen fram till kl 12 dagen efter i tävlingens tidszon. Stämplingar, avläsningar och
 * klockslag i det fönstret räknas till tävlingen; "annan dag" gäller bara utanför det.
 */
export const RACE_DAY_END_HOUR_NEXT_DAY = 12;

/** Datumet efter (ÅÅÅÅ-MM-DD). */
export function nextRaceDate(date: string): string {
  const [year, month, day] = date.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(year, month - 1, day + 1)).toISOString().slice(0, 10);
}

/** Tävlingsdygnets början och slut som ögonblick (ms): 00:00 tävlingsdagen till kl 12 dagen efter. */
export function raceDayWindow(raceDate: string, timeZone: string): { readonly startMs: number; readonly endMs: number } | null {
  const start = parseRaceClock(raceDate, "00:00", timeZone);
  const end = parseRaceClock(nextRaceDate(raceDate), `${String(RACE_DAY_END_HOUR_NEXT_DAY).padStart(2, "0")}:00`, timeZone);
  return start && end ? { startMs: Date.parse(start), endMs: Date.parse(end) } : null;
}

/** Sant när ögonblicket ligger i tävlingsdygnet. */
export function inRaceDay(instant: Date, raceDate: string, timeZone: string): boolean {
  const window = raceDayWindow(raceDate, timeZone);
  const ms = instant.getTime();
  return window !== null && Number.isFinite(ms) && ms >= window.startMs && ms < window.endMs;
}

/**
 * Ett klockslag som hör till tävlingen, nära en känd tid i den (klassens masstart, första start, löparens start): det av
 * tävlingsdagen och dagen efter som ligger inom tolv timmar från referensen. En omstart kl 00:30 i en stafett med masstart
 * kl 22:00 blir alltså natten efter, inte morgonen före. Utan referens, eller när inget av dem ligger inom tolv timmar,
 * gäller tävlingsdagen (som `parseRaceClock`).
 */
export function parseRaceClockNear(date: string, clock: string, timeZone: string, reference?: string | null): string | null {
  const sameDay = parseRaceClock(date, clock, timeZone);
  const referenceMs = reference ? Date.parse(reference) : Number.NaN;
  if (!sameDay || !Number.isFinite(referenceMs)) return sameDay;
  const window = 12 * 3_600_000;
  const near = (value: string | null) => value !== null && Math.abs(Date.parse(value) - referenceMs) < window;
  if (near(sameDay)) return sameDay;
  const nextDay = parseRaceClock(nextRaceDate(date), clock, timeZone);
  return near(nextDay) ? nextDay : sameDay;
}
