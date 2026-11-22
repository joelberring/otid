import { createHmac } from "node:crypto";

/**
 * Besöksstatistiken (ägaren 2026-11-22): var nya besökare faller bort, utan kakor och utan att spara IP-adresser. Den här filen
 * är ren (ingen I/O): stegen, robotfiltret, dygnets hash och veckorapportens avsnitt BESÖKARE. Registreringen, sammanräkningen
 * efter dygnet och läsningen finns i `visitor-stats.ts`.
 */
export const VISITOR_STEPS = ["HOME", "DEMO_RACE", "GUEST_DEMO", "SIGN_IN"] as const;
export type VisitorStep = typeof VISITOR_STEPS[number];

/**
 * Uppenbara robotar och verktyg: sökmotorer, länkförhandsvisningar (chattappar, sociala medier), övervakning och
 * kommandoradsverktyg. Tom webbläsare räknas också som robot. Det är bara ett grovt filter; vanliga webbläsare passerar.
 */
const ROBOT_WORDS = [
  "crawl", "spider", "slurp", "preview", "facebookexternalhit", "embedly", "whatsapp", "telegram", "discord", "skype", "slack",
  "vkshare", "pinterest", "monitor", "uptime", "pingdom", "statuscake", "healthcheck", "check_http", "curl/", "wget/", "httpie",
  "python-", "python/", "aiohttp", "go-http-client", "java/", "okhttp", "node-fetch", "undici", "axios", "libwww", "httpclient",
  "headless", "lighthouse", "pagespeed", "gtmetrix", "scrapy", "phantomjs", "puppeteer", "playwright", "selenium", "feedfetcher",
  "mediapartners", "apis-google", "semrush", "ahrefs", "yandex", "baiduspider", "bytespider", "chatgpt", "anthropic", "perplexity",
  "ccbot", "dataforseo", "archive.org"
];
const escape = (word: string) => word.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
/** "bot" som eget ord eller ändelse (Googlebot, bingbot/2.0, "bot;"), men inte inuti ett vanligt ord. */
const ROBOT = new RegExp(`bot(?![a-z])|${ROBOT_WORDS.map(escape).join("|")}`, "i");

/** Om webbläsaren (User-Agent) är tom eller ser ut som en robot. */
export function isLikelyRobot(userAgent: string | null | undefined): boolean {
  const value = userAgent?.trim() ?? "";
  return value.length === 0 || ROBOT.test(value);
}

/** Dygnets kod för en besökare: HMAC-SHA256 av adressen och webbläsaren med dygnets salt (hex). Går inte att vända. */
export function visitorHash(salt: string, address: string, userAgent: string): string {
  return createHmac("sha256", Buffer.from(salt, "hex")).update(`${address}\n${userAgent.slice(0, 512)}`).digest("hex");
}

export interface VisitorDay {
  /** Datumet i svensk tid (ÅÅÅÅ-MM-DD). */
  readonly day: string;
  readonly steps: Readonly<Record<VisitorStep, number>>;
  /** Nya konton (utan gästkonton) det dygnet. */
  readonly accounts: number;
}

const COLUMNS: readonly { readonly label: string; readonly value: (day: VisitorDay) => number }[] = [
  { label: "startsidan", value: day => day.steps.HOME },
  { label: "demotävlingen", value: day => day.steps.DEMO_RACE },
  { label: "provat arbetsytan", value: day => day.steps.GUEST_DEMO },
  { label: "Skapa konto/logga in", value: day => day.steps.SIGN_IN },
  { label: "nya konton", value: day => day.accounts }
];

const WEEKDAYS = ["sön", "mån", "tis", "ons", "tor", "fre", "lör"] as const;
/** "lör 21/11" ur ÅÅÅÅ-MM-DD. */
function shortDay(day: string): string {
  const date = new Date(`${day}T12:00:00Z`);
  return `${WEEKDAYS[date.getUTCDay()]} ${date.getUTCDate()}/${date.getUTCMonth() + 1}`;
}

/** Veckorapportens avsnitt BESÖKARE: en rad per dygn (äldst först) och veckans summa. `today` är det pågående dygnet. */
export function visitorLines(days: readonly VisitorDay[], today: string): string[] {
  const lines = ["BESÖKARE (unika per dygn, utan robotar)"];
  if (days.length === 0) return [...lines, "- Inga mätningar ännu."];
  lines.push(`- Kolumner: ${COLUMNS.map(column => column.label).join(" / ")}`);
  for (const day of days) {
    lines.push(`- ${shortDay(day.day)}${day.day === today ? " (hittills)" : ""}: ${COLUMNS.map(column => column.value(day)).join(" / ")}`);
  }
  lines.push(`- Veckan: ${COLUMNS.map(column => `${column.label} ${days.reduce((sum, day) => sum + column.value(day), 0)}`).join(", ")}.`,
    "  Veckans summa är summan av dygnens unika besökare: samma person räknas en gång per dygn och steg. Inga kakor och inga",
    "  IP-adresser sparas; dygnets koder tas bort när dygnet är slut och bara antalen finns kvar.");
  return lines;
}
