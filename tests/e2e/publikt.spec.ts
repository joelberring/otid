import { randomUUID } from "node:crypto";
import { expect, test, type Browser, type Page } from "@playwright/test";
import { createRace, openStep, publishRace, publishRaceViaApi, registerAccount, unique, warmRoute } from "./helpers";

/**
 * Steg 19 (ADR-0172 beslut 4): en ny tävling är dold tills admin publicerar den. Besökare ser publicerade tävlingar
 * på startsidan under Pågår nu, Kommande och Senaste, kan söka och når tävlingssidan med kort adress. Admin
 * förhandsvisar en opublicerad tävling och skriver ut en QR-kod till tävlingssidan. Allt fungerar på 390 px.
 */
async function screenshots(page: Page, name: string, widths = [1280, 390]) {
  const directory = process.env.E2E_SCREENSHOT_DIR;
  if (!directory) return;
  const viewport = page.viewportSize();
  for (const width of widths) {
    await page.setViewportSize({ width, height: 900 });
    await page.screenshot({ path: `${directory}/step19-${name}-${width}.png`, fullPage: true });
  }
  if (viewport) await page.setViewportSize(viewport);
}

const zone = "Europe/Stockholm";
const today = new Intl.DateTimeFormat("sv-SE", { timeZone: zone }).format(new Date());
const shift = (days: number) => new Date(Date.parse(`${today}T12:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);

/** Fler tävlingar på startsidan, skapade och publicerade med samma API:er som arbetsytan använder. */
async function createPublishedRaceViaApi(page: Page, eventName: string, raceDate: string, raceType: string): Promise<void> {
  const origin = new URL(page.url()).origin;
  const csrf = (await page.context().cookies()).find(cookie => /otid[-_]organizer[-_]csrf$/.test(cookie.name))?.value ?? "";
  const response = await page.request.post("/api/organizer/events", {
    headers: { origin, "x-otid-csrf": csrf, "idempotency-key": `organizer-event-create:${randomUUID()}` },
    data: { formatVersion: 1, eventName, raceName: "Huvudlopp", raceDate, timeZone: zone, raceType } });
  expect(response.status()).toBe(201);
  await publishRaceViaApi(page, (await response.json() as { raceId: string }).raceId);
}

async function anonymous(browser: Browser): Promise<Page> {
  return (await browser.newContext({ viewport: { width: 1280, height: 844 } })).newPage();
}

/** Ingen vågrät rullning av hela sidan. */
async function expectNoHorizontalScroll(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
}

test("opublicerad tävling syns inte, publicerad syns under rätt rubrik, kort adress och QR-kod", async ({ browser }) => {
  test.setTimeout(300_000);
  const suffix = unique();
  const owner = await registerAccount(browser, `publik.${suffix}@exempel.se`, "Petra Publik");
  for (const path of ["/", "/t/aaaaaa", "/t/aaaaaa/qr"]) await warmRoute(owner, path);

  // Fler tävlingar: kommande och tidigare, så att varje rubrik har innehåll. De skapas före arbetsytan, eftersom
  // varje publicering via API:t öppnar en tävlingssession (en per webbläsare).
  const upcomingName = `Höstsprinten ${suffix}`;
  const recentName = `Klubbmästerskap ${suffix}`;
  await createPublishedRaceViaApi(owner, upcomingName, shift(12), "STANDARD");
  await createPublishedRaceViaApi(owner, recentName, shift(-9), "SMALL");
  await createPublishedRaceViaApi(owner, `Nattcupen ${suffix}`, shift(3), "FORKED");
  await createPublishedRaceViaApi(owner, `Stafettdagen ${suffix}`, shift(-2), "RELAY");
  await createPublishedRaceViaApi(owner, `Poängjakten ${suffix}`, today, "ROGAINING");

  // Tävlingen i dag: ny och opublicerad.
  const todayName = `Kvällsträning ${suffix}`;
  const raceId = await createRace(owner, todayName, today, "Träning");
  await warmRoute(owner, `/api/admin/races/${raceId}/administrator/race-publication`, "POST");
  await openStep(owner, "Publicera");
  await expect(owner.getByText("Inte publicerad. Bara du och andra med behörighet ser tävlingssidan")).toBeVisible();
  const hubPath = await owner.getByRole("link", { name: "Förhandsvisa tävlingssidan" }).getAttribute("href");
  expect(hubPath).toMatch(/^\/t\/[2-9a-hjkmnp-z]{6}$/);

  // Besökaren ser den inte: inte på startsidan, resultatlistan, tävlingssidan, QR-sidan eller i API:t, och inget namn läcker.
  const visitor = await anonymous(browser);
  await visitor.goto("/");
  await expect(visitor.getByRole("heading", { name: "Tävlingar", level: 1 })).toBeVisible();
  await expect(visitor.getByText(todayName)).toHaveCount(0);
  for (const path of [`/results/${raceId}`, hubPath!, `${hubPath!}/qr`]) {
    const response = await visitor.goto(path);
    expect(response?.status(), path).toBe(404);
    await expect(visitor.getByRole("heading", { name: "Tävlingen är inte publicerad" })).toBeVisible();
    expect(await visitor.content()).not.toContain(todayName);
  }
  for (const path of [`/api/public/races/${raceId}/results`, `/api/public/races/${raceId}/result-events`]) {
    expect((await visitor.request.get(path)).status(), path).toBe(404);
  }

  // Admin förhandsvisar de publika sidorna med en tydlig banner.
  await owner.goto(hubPath!);
  await expect(owner.getByText("Förhandsvisning – inte publicerad")).toBeVisible();
  await expect(owner.getByRole("heading", { name: todayName, level: 1 })).toBeVisible();
  await screenshots(owner, "forhandsvisning");
  await owner.goto(`/results/${raceId}`);
  await expect(owner.getByText("Förhandsvisning – inte publicerad")).toBeVisible();
  await expect(owner.getByRole("link", { name: "‹ Tävlingssidan" })).toHaveAttribute("href", hubPath!);

  // Publicera i arbetsytan.
  await owner.goto(`/admin/${raceId}/manage`);
  await publishRace(owner);
  await expect(owner.getByText(/^Publicerad .*Tävlingssidan syns för alla\.$/)).toBeVisible();

  // Startsidan: inga adminlänkar. Rubrikerna kontrolleras med sök på testets egna tävlingar, eftersom testdatabasen
  // har tävlingar från andra flöden och "Senaste" visar tio i taget.
  await visitor.goto("/");
  await expect(visitor.locator('a[href*="/admin/"]')).toHaveCount(0);
  await visitor.goto(`/?q=${suffix}`);
  const section = (name: string) => visitor.getByRole("region", { name: new RegExp(`^${name}`) });
  await expect(section("Pågår nu").getByRole("link", { name: todayName })).toHaveAttribute("href", hubPath!);
  await expect(section("Kommande").getByRole("link", { name: upcomingName })).toBeVisible();
  await expect(section("Senaste").getByRole("link", { name: recentName })).toBeVisible();
  await expect(section("Pågår nu").getByRole("link", { name: upcomingName })).toHaveCount(0);
  await expect(section("Senaste").getByRole("listitem")).toHaveCount(2);
  await expect(visitor.locator('a[href*="/admin/"]')).toHaveCount(0);
  await expect(visitor.getByRole("link", { name: "För arrangörer: logga in" })).toBeVisible();
  await expect(section("Pågår nu").getByRole("navigation", { name: todayName }).getByRole("link", { name: "Resultat" }))
    .toHaveAttribute("href", `/results/${raceId}`);
  await expect(section("Kommande").getByRole("navigation", { name: upcomingName }).getByRole("link")).toHaveCount(0);
  await expect(visitor.getByText("Förhandsvisning – inte publicerad")).toHaveCount(0);

  // Inloggad: länk till Mina tävlingar i sidhuvudet.
  await owner.goto("/");
  await expect(owner.getByRole("navigation", { name: "Konto" }).getByRole("link", { name: "Mina tävlingar" })).toHaveAttribute("href", "/organizer");

  // Sök på namn (utan hänsyn till versaler).
  await visitor.getByLabel("Sök tävling").fill(`HÖSTSPRINTEN ${suffix}`);
  await visitor.getByRole("button", { name: "Sök" }).click();
  await visitor.waitForURL(/\?q=/);
  await expect(visitor.getByRole("status")).toHaveText(`Sökträffar för ”HÖSTSPRINTEN ${suffix}”`);
  await expect(visitor.getByRole("link", { name: upcomingName })).toBeVisible();
  await expect(visitor.getByRole("link", { name: todayName })).toHaveCount(0);
  await visitor.getByLabel("Sök tävling").fill(`finns inte ${suffix}`);
  await visitor.getByRole("button", { name: "Sök" }).click();
  await expect(visitor.getByRole("status")).toHaveText(`Ingen publicerad tävling matchar ”finns inte ${suffix}”.`);

  // Kort adress till tävlingssidan: navet med vägarna vidare.
  await visitor.goto(hubPath!);
  await expect(visitor.getByRole("heading", { name: todayName, level: 1 })).toBeVisible();
  await expect(visitor.getByText("Förhandsvisning – inte publicerad")).toHaveCount(0);
  const hubLinks = visitor.getByRole("list", { name: "Tävlingssidan" });
  await expect(hubLinks.getByRole("link", { name: /^Resultat/ })).toHaveAttribute("href", `/results/${raceId}`);
  await expect(visitor.getByText(/Adress till sidan: .*\/t\/[2-9a-hjkmnp-z]{6}/)).toBeVisible();
  expect(await visitor.title()).toBe(`${todayName} – O-Tid`);
  expect(await visitor.locator('meta[name="description"]').getAttribute("content")).toContain("Startlista");
  await visitor.goto(hubPath!.toUpperCase().replace("/T/", "/t/"));
  await expect(visitor.getByRole("heading", { name: todayName, level: 1 })).toBeVisible();
  // Från resultatlistan tillbaka till tävlingssidan.
  await visitor.goto(`/results/${raceId}`);
  await visitor.getByRole("link", { name: "‹ Tävlingssidan" }).click();
  await visitor.waitForURL(`**${hubPath!}`);

  // QR-kod att skriva ut: namnet, koden och adressen; vid utskrift bara arket.
  await owner.goto(`/admin/${raceId}/manage`);
  await openStep(owner, "Publicera");
  await expect(owner.getByRole("link", { name: /^Skriv ut QR-kod/ })).toHaveAttribute("href", `${hubPath!}/qr`);
  // Utvecklingsservern och webbläsarna delar ett minnestak: besökarens sida återanvänds.
  const qr = visitor;
  await qr.goto(`${hubPath!}/qr`);
  const sheet = qr.getByRole("article", { name: "QR-kod att skriva ut" });
  await expect(sheet.getByRole("heading", { name: todayName })).toBeVisible();
  await expect(sheet.getByRole("img", { name: `QR-kod till tävlingssidan för ${todayName}` })).toBeVisible();
  await expect(sheet.getByText(/\/t\/[2-9a-hjkmnp-z]{6}$/)).toBeVisible();
  await expect(sheet.getByText("Resultat och sträcktider")).toBeVisible();
  await qr.emulateMedia({ media: "print" });
  await expect(sheet).toBeVisible();
  await expect(qr.getByRole("button", { name: "Skriv ut" })).toBeHidden();
  await expect(qr.getByRole("link", { name: "‹ Tävlingssidan" })).toBeHidden();
  await expect(qr.locator("body > header")).toBeHidden();
  await expect(qr.locator("body > footer")).toBeHidden();
  await screenshots(qr, "qr-utskrift", [1280]);
  await qr.emulateMedia({ media: "screen" });
  await qr.getByLabel("Halv sida (A5)").check();
  await expect(sheet).toHaveAttribute("data-size", "A5");

  // 390 px: ingen vågrät rullning på startsidan eller tävlingssidan.
  await visitor.setViewportSize({ width: 390, height: 844 });
  for (const path of ["/", hubPath!]) {
    await visitor.goto(path);
    await expect(visitor.locator("main")).toBeVisible();
    await expectNoHorizontalScroll(visitor);
  }
  await visitor.setViewportSize({ width: 1280, height: 844 });
  await visitor.goto("/");
  await screenshots(visitor, "startsida");
  await visitor.goto(hubPath!);
  await screenshots(visitor, "tavlingssida");
  await screenshots(owner, "publicera");

  // Sluta publicera: dold igen för besökare.
  await owner.getByRole("button", { name: "Sluta publicera" }).click();
  await expect(owner.getByText("Tävlingen är inte längre publicerad.")).toBeVisible();
  expect((await visitor.goto(hubPath!))?.status()).toBe(404);
  await visitor.goto("/");
  await expect(visitor.getByRole("link", { name: todayName })).toHaveCount(0);
});
