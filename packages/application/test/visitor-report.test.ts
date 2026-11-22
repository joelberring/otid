import { describe, expect, it } from "vitest";
import { serverWatchSettings, weeklyReport, type ServerSnapshot } from "../src/server-report";
import { isLikelyRobot, visitorHash, visitorLines, VISITOR_STEPS, type VisitorDay } from "../src/visitor-report";

/** Besöksstatistiken (ägaren 2026-11-22): robotfiltret, dygnets hash och veckorapportens avsnitt BESÖKARE. */
const SALT_A = "a".repeat(64), SALT_B = "b".repeat(64);
const SAFARI = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1";
const FIREFOX = "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:133.0) Gecko/20100101 Firefox/133.0";

describe("robotfiltret", () => {
  it("släpper igenom vanliga webbläsare", () => {
    expect(isLikelyRobot(SAFARI)).toBe(false);
    expect(isLikelyRobot(FIREFOX)).toBe(false);
    expect(isLikelyRobot("Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Mobile Safari/537.36")).toBe(false);
  });

  it("stoppar tom webbläsare, sökmotorer, förhandsvisningar, hälsokontroller och verktyg", () => {
    for (const agent of [null, undefined, "", "   ",
      "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)",
      "Mozilla/5.0 (compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm)",
      "facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)",
      "Slackbot-LinkExpanding 1.0 (+https://api.slack.com/robots)",
      "WhatsApp/2.23.20.0", "TelegramBot (like TwitterBot)", "Mozilla/5.0 (compatible; Discordbot/2.0)",
      "Mozilla/5.0 (compatible; YandexBot/3.0)", "GPTBot/1.1", "Mozilla/5.0 (X11; Linux x86_64) HeadlessChrome/131.0 Safari/537.36",
      "curl/8.5.0", "Wget/1.21", "python-requests/2.32", "Go-http-client/2.0", "UptimeRobot/2.0", "node-fetch/1.0", "Some link preview service"]) {
      expect(isLikelyRobot(agent), String(agent)).toBe(true);
    }
  });
});

describe("dygnets hash", () => {
  it("är samma för samma adress och webbläsare samma dygn, men byts med saltet och skiljer adresser och webbläsare åt", () => {
    const one = visitorHash(SALT_A, "203.0.113.5", SAFARI);
    expect(one).toMatch(/^[0-9a-f]{64}$/);
    expect(visitorHash(SALT_A, "203.0.113.5", SAFARI)).toBe(one);
    expect(visitorHash(SALT_B, "203.0.113.5", SAFARI)).not.toBe(one);
    expect(visitorHash(SALT_A, "203.0.113.6", SAFARI)).not.toBe(one);
    expect(visitorHash(SALT_A, "203.0.113.5", FIREFOX)).not.toBe(one);
    expect(one).not.toContain("203");
  });
});

const day = (date: string, values: [number, number, number, number], accounts: number): VisitorDay =>
  ({ day: date, steps: Object.fromEntries(VISITOR_STEPS.map((step, index) => [step, values[index]])) as VisitorDay["steps"], accounts });

describe("avsnittet BESÖKARE", () => {
  const days = [day("2026-11-16", [3, 1, 0, 1], 0), day("2026-11-17", [0, 0, 0, 0], 0), day("2026-11-18", [5, 2, 1, 2], 1),
    day("2026-11-19", [1, 0, 0, 0], 0), day("2026-11-20", [2, 2, 0, 0], 0), day("2026-11-21", [10, 10, 2, 3], 0),
    day("2026-11-22", [4, 1, 0, 1], 0)];

  it("har en rad per dygn, i dag hittills, veckans summa och förklaringen", () => {
    const lines = visitorLines(days, "2026-11-22");
    expect(lines[0]).toBe("BESÖKARE (unika per dygn, utan robotar)");
    expect(lines[1]).toBe("- Kolumner: startsidan / demotävlingen / provat arbetsytan / Skapa konto/logga in / nya konton");
    expect(lines).toContain("- lör 21/11: 10 / 10 / 2 / 3 / 0");
    expect(lines).toContain("- sön 22/11 (hittills): 4 / 1 / 0 / 1 / 0");
    expect(lines).toContain("- Veckan: startsidan 25, demotävlingen 16, provat arbetsytan 3, Skapa konto/logga in 7, nya konton 1.");
    const text = lines.join("\n");
    expect(text).toMatch(/summan av dygnens unika besökare: samma person räknas en gång per dygn/);
    expect(text).toMatch(/Inga kakor och inga\s+IP-adresser sparas/);
  });

  it("säger när det inte finns några mätningar", () => {
    expect(visitorLines([], "2026-11-22")).toEqual(["BESÖKARE (unika per dygn, utan robotar)", "- Inga mätningar ännu."]);
  });

  it("står i veckorapporten efter användningen när besökarna är lästa", () => {
    const snapshot: ServerSnapshot = { at: new Date("2026-11-22T18:05:00Z"), disk: null, memory: null, load: null,
      database: { totalBytes: 0, mapBytes: 0, imageBytes: 0, printBytes: 0 }, maps: { storedBytes: 0, quotaBytes: null }, backups: null, monitor: null,
      counts: { accounts: 1, accountsNew: 1, clubs: 0, events: 0, races: 0, upcomingRaces: 0, upcomingPublished: 0, upcomingEntries: 0, upcomingMaxEntries: 0 } };
    const text = weeklyReport(snapshot, { samples: [], log: [], visitors: { today: "2026-11-22", days } }, serverWatchSettings({}), "x").text;
    expect(text.indexOf("BESÖKARE")).toBeGreaterThan(text.indexOf("ANVÄNDNING"));
    expect(text.indexOf("BESÖKARE")).toBeLessThan(text.indexOf("LARM OCH FEL"));
    expect(weeklyReport(snapshot, { samples: [], log: [] }, serverWatchSettings({}), "x").text).not.toContain("BESÖKARE");
  });
});
