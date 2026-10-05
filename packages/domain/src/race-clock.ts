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
