/** Väggklockan i tidszonen för ett ögonblick, uttryckt som om den vore UTC (ms). */
function wallClock(ms: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("sv-SE", { timeZone, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" }).formatToParts(new Date(ms));
  const value = (type: string) => Number(parts.find(part => part.type === type)?.value);
  return Date.UTC(value("year"), value("month") - 1, value("day"), value("hour"), value("minute"), value("second"));
}

/**
 * Ett skrivet klockslag som "HH:MM" eller "HH:MM:SS", eller null. Godtar kolon eller punkt (18:30, 7.25, 18:30:15) och,
 * sedan användartestet 2026-11-12, bara siffror när de är entydiga: "0725" och "725" = 07:25, "18" och "7" = hela timmen.
 */
export function normalizeClock(clock: string): string | null {
  const text = clock.trim();
  const separated = /^(\d{1,2})[:.](\d{2})(?:[:.](\d{2}))?$/.exec(text);
  const digits = /^\d{1,4}$/.test(text) ? text : undefined;
  const [hour, minute, second] = separated ? [separated[1]!, separated[2]!, separated[3]]
    : digits === undefined ? [] : digits.length <= 2 ? [digits, "00", undefined] : [digits.slice(0, -2), digits.slice(-2), undefined];
  if (hour === undefined || minute === undefined) return null;
  if (Number(hour) > 23 || Number(minute) > 59 || Number(second ?? 0) > 59) return null;
  return `${hour.padStart(2, "0")}:${minute}${second === undefined ? "" : `:${second}`}`;
}

/**
 * Ett klockslag (se `normalizeClock`) på ett visst datum i tävlingens tidszon som ISO-ögonblick (UTC).
 * Användaren skriver bara klockslaget; appen räknar ut tidszonens förskjutning. Ett klockslag som inte finns
 * (vid övergång till sommartid) ger null. Ett dubbeltydigt klockslag (vid övergång till vintertid) ger det första.
 */
export function parseRaceClock(date: string, clock: string, timeZone: string): string | null {
  const day = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date.trim());
  const normalized = normalizeClock(clock);
  if (!day || !normalized) return null;
  const [hour, minute, second] = normalized.split(":").map(Number) as [number, number, number?];
  const wanted = Date.UTC(Number(day[1]), Number(day[2]) - 1, Number(day[3]), hour, minute, second ?? 0);
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

/** Antal dagar från `from` till `to` (ÅÅÅÅ-MM-DD). */
function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

/** Datumet `days` dagar efter (ÅÅÅÅ-MM-DD). */
function addDays(date: string, days: number): string {
  const [year, month, day] = date.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}

/**
 * ADR-0188 beslut 3: en starttid flyttad till tävlingens nya datum med samma klockslag i tävlingens tidszon. En tid efter
 * midnatt (dagen efter tävlingsdagen, ADR-0178) hamnar dagen efter det nya datumet. Sommartid räknas om: 10:00 är 10:00 också
 * när förskjutningen mot UTC är en annan. Ett klockslag som inte finns det nya datumet (övergången till sommartid) flyttas
 * en timme fram, som klockan gör. Null om datumen inte går att läsa.
 */
export function moveToRaceDate(instant: Date, fromDate: string, toDate: string, timeZone: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fromDate) || !/^\d{4}-\d{2}-\d{2}$/.test(toDate) || !Number.isFinite(instant.getTime())) return null;
  const localDate = localRaceDate(instant, timeZone);
  const clock = new Intl.DateTimeFormat("sv-SE", { timeZone, hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" })
    .format(instant);
  const targetDate = addDays(toDate, daysBetween(fromDate, localDate));
  const moved = parseRaceClock(targetDate, clock, timeZone);
  if (moved) return new Date(Date.parse(moved) + instant.getMilliseconds());
  const [hour, minute, second] = clock.split(":").map(Number) as [number, number, number];
  const pad = (value: number) => String(value).padStart(2, "0");
  const later = hour < 23 ? parseRaceClock(targetDate, `${pad(hour + 1)}:${pad(minute)}:${pad(second)}`, timeZone) : null;
  return later ? new Date(Date.parse(later) + instant.getMilliseconds()) : null;
}
