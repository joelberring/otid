import { expect, test, type Page } from "@playwright/test";
import { FAKE_ROC_PORT } from "./fake-roc";
import { addCourseAndClass, addEntry, createRace, ongoingRaceTimeZone, openStep, publishRace, registerAccount, sendReadout, unique,
  warmRoute } from "./helpers";

/**
 * PLAN.md steg 30: Live för publiken. En anonym besökare har Live öppen före första målgången (lugnt tomläge). Admin läser
 * av i sin egen webbläsare och avläsningen syns i Live inom några sekunder, utan omladdning: senast i mål, ledare med "Ny
 * ledare", felstämplad utan placering och en radiopassage. Besökaren följer en klubb och en löpare; de hamnar överst
 * ("Följer") och står kvar efter omladdning, och stjärnorna syns i resultatlistan. Inga bricknummer; 390 px utan vågrät rullning.
 */
const TIME_ZONE = ongoingRaceTimeZone();
const RUNNERS = {
  anna: { className: "H21", givenName: "Anna", familyName: "Ek", club: "OK Ek", card: "8601001" },
  bo: { className: "H21", givenName: "Bo", familyName: "Lind", club: "IFK Lidingö", card: "8601002" },
  cia: { className: "D21", givenName: "Cia", familyName: "Berg", club: "OK Ek", card: "8601003" },
  dan: { className: "H21", givenName: "Dan", familyName: "Holm", club: "IFK Lidingö", card: "8601004" }
} as const;
const name = (runner: { givenName: string; familyName: string }) => `${runner.givenName} ${runner.familyName}`;
const zoned = (date: Date, options: Intl.DateTimeFormatOptions) =>
  new Intl.DateTimeFormat("sv-SE", { timeZone: TIME_ZONE, hourCycle: "h23", ...options }).format(date);
/** ROC:s tidsformat: lokal tid "YYYY-MM-DD HH:MM:SS". */
const rocTime = (ms: number) => zoned(new Date(ms), { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit",
  second: "2-digit" });
/** Avläsningarnas tider räknas från en hel sekund när testet körs. */
const base = Math.floor(Date.now() / 1_000) * 1_000;
const ago = (minutes: number) => new Date(base - minutes * 60_000).toISOString();

async function screenshots(page: Page, shot: string) {
  const directory = process.env.E2E_SCREENSHOT_DIR;
  if (!directory) return;
  for (const width of [1280, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({ path: `${directory}/step30-${shot}-${width}.png`, fullPage: true });
  }
  await page.setViewportSize({ width: 1280, height: 720 });
}

async function expectNoHorizontalScroll(page: Page) {
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
  await page.setViewportSize({ width: 1280, height: 720 });
}

test("Live: avläsning syns hos en anonym besökare, följd klubb hamnar överst och står kvar", async ({ browser, request }) => {
  test.setTimeout(360_000);
  const suffix = unique();
  const unitId = `live-${suffix}`;
  const eventName = `Live ${suffix}`;
  const raceDate = zoned(new Date(), { year: "numeric", month: "2-digit", day: "2-digit" });
  const owner = await registerAccount(browser, `live.${suffix}@exempel.se`, "Lisa Live");
  const raceId = await createRace(owner, eventName, raceDate, "Tävling", TIME_ZONE);
  await publishRace(owner);
  await addCourseAndClass(owner, "Lång", "H21", "31 50 33");
  await addCourseAndClass(owner, "Kort", "D21", "31 33");
  for (const runner of Object.values(RUNNERS)) await addEntry(owner, runner);
  for (const path of [`/api/public/races/${raceId}/live`, `/api/public/races/${raceId}/radio`, `/api/admin/races/${raceId}/administrator/radio`,
    `/api/admin/races/${raceId}/administrator/readouts`]) await warmRoute(owner, path);
  await warmRoute(owner, `/api/admin/races/${raceId}/administrator/radio/fetch`, "POST");

  // Besökaren hittar Live från resultatlistan, innan någon är i mål: ett lugnt tomläge.
  const visitor = await (await browser.newContext()).newPage();
  await visitor.goto(`/results/${raceId}`);
  await visitor.locator(".public-list-heading").getByRole("link", { name: "Live", exact: true }).click();
  await visitor.waitForURL(/\/t\/[2-9a-hjkmnp-z]{6}\/live$/);
  const livePath = new URL(visitor.url()).pathname;
  await expect(visitor.getByRole("heading", { name: eventName, level: 1 })).toBeVisible();
  await expect(visitor.getByRole("heading", { name: "Inga målgångar än – sidan uppdateras av sig själv." })).toBeVisible();
  await expect(visitor.getByText(/^Uppdaterad \d\d:\d\d:\d\d$/)).toBeVisible();
  await screenshots(visitor, "empty");

  // Tävlingssidan har Live.
  await visitor.goto(livePath.replace(/\/live$/, ""));
  await expect(visitor.getByRole("list", { name: "Tävlingssidan" }).getByRole("link", { name: /^Live/ })).toHaveAttribute("href", livePath);
  await visitor.goto(livePath);

  // Radiokontroll 50 ("Radio 1") via falsk OResults; Bo passerar den.
  await openStep(owner, "Inställningar");
  const radio = owner.getByRole("region", { name: "Radiokontroller" });
  // Arbetsytan kan läsa in delen på nytt strax efter att den visats; fyll i tills formuläret håller värdena.
  await expect(async () => {
    await radio.getByLabel("Källa").selectOption("ORESULTS");
    await radio.getByLabel("ROC-id").fill(unitId);
    await radio.getByRole("checkbox", { name: /^Kontroll 50\b/ }).check();
    await radio.getByLabel("Namn på kontroll 50").fill("Radio 1");
    await expect(radio.getByRole("button", { name: "Spara" })).toBeEnabled({ timeout: 2_000 });
    await expect(radio.getByLabel("ROC-id")).toHaveValue(unitId, { timeout: 1_000 });
  }).toPass({ timeout: 60_000 });
  await radio.getByRole("button", { name: "Spara" }).click();
  await expect(radio.getByText("Radioinställningarna är sparade.")).toBeVisible();
  expect((await request.post(`http://127.0.0.1:${FAKE_ROC_PORT}/__fixture/units/${unitId}`,
    { data: `1;50;${RUNNERS.bo.card};${rocTime(base - 20 * 60_000)}` })).status()).toBe(204);
  await radio.getByRole("button", { name: "Hämta nu" }).click();
  await expect(radio.getByText(/^1 stämpling/)).toBeVisible({ timeout: 30_000 });

  // Anna läser av hos admin: hon syns i Live inom några sekunder, utan omladdning, som ny ledare i H21.
  const punches = (codes: number[], from: number) => codes.map((code, index) => ({ code, punchedAt: ago(from - (index + 1) * 8) }));
  await sendReadout(owner, raceId, { cardNumber: RUNNERS.anna.card, startPunchedAt: ago(40), finishPunchedAt: ago(5), punches: punches([31, 50, 33], 40) });
  const latest = visitor.getByRole("region", { name: "Senast i mål" });
  const annaRow = latest.getByRole("listitem").filter({ hasText: name(RUNNERS.anna) });
  await expect(annaRow).toBeVisible({ timeout: 10_000 });
  await expect(annaRow).toContainText("35:00");
  await expect(annaRow).toContainText("1:a");
  await expect(annaRow).toContainText("OK Ek · H21");
  const leaders = visitor.getByRole("region", { name: "Ledare per klass" });
  await expect(leaders.getByRole("listitem").filter({ hasText: name(RUNNERS.anna) })).toContainText("Ny ledare");

  // Dan missar Radio 1: felstämplad utan placering. Cia vinner D21.
  await sendReadout(owner, raceId, { cardNumber: RUNNERS.dan.card, startPunchedAt: ago(38), finishPunchedAt: ago(4), punches: punches([31, 33], 38) });
  await sendReadout(owner, raceId, { cardNumber: RUNNERS.cia.card, startPunchedAt: ago(36), finishPunchedAt: ago(3), punches: punches([31, 33], 36) });
  const danRow = latest.getByRole("listitem").filter({ hasText: name(RUNNERS.dan) });
  await expect(danRow).toContainText("Felstämplad", { timeout: 10_000 });
  await expect(danRow).not.toContainText(/\d+:[ae]\b/);
  await expect(latest.getByRole("listitem").first()).toContainText(name(RUNNERS.cia), { timeout: 10_000 });
  await expect(leaders.getByRole("listitem").filter({ hasText: name(RUNNERS.cia) })).toBeVisible();
  const passages = visitor.getByRole("region", { name: "Vid radiokontrollerna" });
  await expect(passages.getByRole("listitem").filter({ hasText: name(RUNNERS.bo) })).toContainText(/passerade Radio 1(, 1:a)?/);
  const html = await visitor.content();
  for (const runner of Object.values(RUNNERS)) expect(html).not.toContain(runner.card);
  await screenshots(visitor, "live");

  // Följ en klubb och en löpare: de hamnar överst och står kvar efter omladdning.
  const following = visitor.getByRole("region", { name: "Följer" });
  await following.getByLabel("Följ en klubb").selectOption("IFK Lidingö");
  await following.getByRole("button", { name: "Följ", exact: true }).click();
  await latest.getByRole("button", { name: `Följ ${name(RUNNERS.cia)}` }).click();
  await visitor.reload();
  const club = following.getByRole("region", { name: "Klubb IFK Lidingö" });
  await expect(club.getByRole("listitem").filter({ hasText: name(RUNNERS.dan) })).toContainText("Felstämplad");
  await expect(club.getByRole("listitem").filter({ hasText: name(RUNNERS.bo) })).toContainText("passerade Radio 1");
  await expect(following.getByRole("listitem").filter({ hasText: name(RUNNERS.cia) }).first()).toBeVisible();
  const [followBox, latestBox] = [await following.boundingBox(), await latest.boundingBox()];
  expect(followBox!.y).toBeLessThan(latestBox!.y);
  await screenshots(visitor, "following");
  await expectNoHorizontalScroll(visitor);

  // Sluta följa löparen; klubben står kvar. Stjärnorna finns i resultatlistan med samma val.
  await following.getByRole("button", { name: `Sluta följa ${name(RUNNERS.cia)}` }).first().click();
  await expect(following.getByRole("listitem").filter({ hasText: name(RUNNERS.cia) })).toHaveCount(0);
  await visitor.goto(`/results/${raceId}`);
  await expect(visitor.getByRole("region", { name: "H21", exact: true }).getByRole("button", { name: `Följ ${name(RUNNERS.anna)}` })).toBeVisible();
  await visitor.getByRole("button", { name: "Per klubb" }).click();
  await expect(visitor.getByRole("region", { name: "IFK Lidingö" }).getByRole("button", { name: "Sluta följa IFK Lidingö" })).toBeVisible();
  await visitor.getByRole("region", { name: "OK Ek" }).getByRole("button", { name: "Följ OK Ek" }).click();
  await visitor.goto(livePath);
  await expect(following.getByRole("region", { name: "Klubb OK Ek" }).getByRole("listitem").filter({ hasText: name(RUNNERS.anna) })).toBeVisible();
});
