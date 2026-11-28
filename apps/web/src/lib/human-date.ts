import { zonedDate } from "@o-tid/domain";

/**
 * Steg F2 (ADR-0170 tillägg 2026-11-28): datum som människor säger dem i listorna – «ons 9 dec», «Wed 9 Dec» – med år bara när
 * det inte är innevarande år («tis 15 okt 2024»). Rena funktioner utan klocka: «i dag» anges av den som anropar (ÅÅÅÅ-MM-DD), och
 * ett ögonblick räknas om till datum i en angiven tidszon. Ingen tidszon står i texten.
 */
export type DateLanguage = "sv" | "en";

const LOCALES: Record<DateLanguage, string> = { sv: "sv-SE", en: "en-GB" };
const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Kalenderdatumet mitt på dagen i UTC (så att ingen tidszon flyttar det), eller null för något som inte är ÅÅÅÅ-MM-DD. */
function calendar(date: string): Date | null {
  if (!DATE.test(date)) return null;
  const value = new Date(`${date}T12:00:00Z`);
  return Number.isFinite(value.getTime()) && value.toISOString().slice(0, 10) === date ? value : null;
}

/** Delarna ur Intl utan förkortningspunkter («dec.» → «dec»). */
function parts(value: Date, language: DateLanguage, options: Intl.DateTimeFormatOptions): Partial<Record<Intl.DateTimeFormatPartTypes, string>> {
  const found: Partial<Record<Intl.DateTimeFormatPartTypes, string>> = {};
  for (const part of new Intl.DateTimeFormat(LOCALES[language], { timeZone: "UTC", ...options }).formatToParts(value)) {
    if (part.type !== "literal") found[part.type] = part.value.replace(/\.$/, "");
  }
  return found;
}

/**
 * «ons 9 dec» (svenska) eller «Wed 9 Dec» (engelska); året läggs till när det inte är samma som i `today`. `weekday: false` ger
 * «9 dec». Något som inte är ett datum (ÅÅÅÅ-MM-DD) kommer tillbaka som det var.
 */
export function humanDate(date: string, language: DateLanguage, today: string, { weekday = true }: { weekday?: boolean } = {}): string {
  const value = calendar(date);
  if (!value) return date;
  const found = parts(value, language, { weekday: "short", day: "numeric", month: "short" });
  const year = date.slice(0, 4) === today.slice(0, 4) ? "" : ` ${date.slice(0, 4)}`;
  return `${weekday ? `${found.weekday} ` : ""}${found.day} ${found.month}${year}`;
}

/** Hela dagar från `date` till `today` (positivt = tidigare); null om något inte är ett datum. */
export function daysBefore(date: string, today: string): number | null {
  const from = calendar(date), to = calendar(today);
  return from && to ? Math.round((to.getTime() - from.getTime()) / 86_400_000) : null;
}

/**
 * När något senast hände, för en uppgiftsrad: «today», «yesterday» eller datumet utan veckodag («27 nov», med år när det är ett
 * annat år). Ögonblicket och «nu» räknas till datum i `timeZone`. Orden för i dag och i går väljer den som visar texten.
 */
export function recentDay(instant: string, language: DateLanguage, timeZone: string, now: Date):
  { kind: "today" | "yesterday" } | { kind: "date"; text: string } {
  const at = new Date(instant);
  if (!Number.isFinite(at.getTime())) return { kind: "date", text: "–" };
  const date = zonedDate(at, timeZone), today = zonedDate(now, timeZone);
  const days = daysBefore(date, today);
  if (days === 0) return { kind: "today" };
  if (days === 1) return { kind: "yesterday" };
  return { kind: "date", text: humanDate(date, language, today, { weekday: false }) };
}

/** Datumbrickans delar: veckodag, dag, månad, år och hela datumet i klartext för skärmläsare («onsdag 9 december 2026»). */
export function dateTileParts(date: string, language: DateLanguage): { weekday: string; day: string; month: string; year: string; full: string } | null {
  const value = calendar(date);
  if (!value) return null;
  const short = parts(value, language, { weekday: "short", day: "numeric", month: "short" });
  const long = parts(value, language, { weekday: "long", day: "numeric", month: "long", year: "numeric" });
  return { weekday: short.weekday ?? "", day: short.day ?? "", month: short.month ?? "", year: date.slice(0, 4),
    full: `${long.weekday} ${long.day} ${long.month} ${long.year}` };
}

/** Rubriken för en månad i en lista: «November 2026» / «November 2026». */
export function monthHeading(date: string, language: DateLanguage): string {
  const value = calendar(`${date.slice(0, 7)}-01`);
  if (!value) return date;
  const found = parts(value, language, { month: "long", year: "numeric" });
  const month = found.month ?? "";
  return `${month.charAt(0).toLocaleUpperCase(LOCALES[language])}${month.slice(1)} ${found.year}`;
}
