import { expect, test, type Locator, type Page } from "@playwright/test";
import { FAKE_ROC_PORT } from "./fake-roc";
import { addCourseAndClass, addEntry, createRace, openStep, publishRace, registerAccount, unique, warmRoute } from "./helpers";

/**
 * PLAN.md steg 20 (ADR-0172 beslut 5): radiokontroller via ROC/OResults. Admin kopplar tävlingen till en enhet och
 * väljer radiokontroll 50 ("Radio 1"). En falsk OResults ger stämplingar för två löpare och en okänd bricka. Innan
 * någon läst av syns mellantiderna live i den publika resultatlistan ("Ute i skogen") och hos speakern; när Anna
 * läser av avgör avläsningen hennes resultat och Bo är kvar ute.
 */
const TIME_ZONE = "Europe/Stockholm";
const RUNNERS = [
  { className: "H21", givenName: "Anna", familyName: "Ek", club: "OK Ek", card: "8501001" },
  { className: "H21", givenName: "Bo", familyName: "Lind", club: "IFK Lidingö", card: "8501002" }
] as const;
const fullName = (runner: (typeof RUNNERS)[number]) => `${runner.givenName} ${runner.familyName}`;
const zoned = (date: Date, options: Intl.DateTimeFormatOptions) =>
  new Intl.DateTimeFormat("sv-SE", { timeZone: TIME_ZONE, hourCycle: "h23", ...options }).format(date);
const clock = (date: Date) => zoned(date, { hour: "2-digit", minute: "2-digit" });
/** Ett klockslag i dag (svensk tid) som ögonblick: tidszonens förskjutning tas från en känd tidpunkt samma dag. */
function todayAt(reference: Date, time: string): number {
  const wall = zoned(reference, { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" });
  const offset = Date.parse(`${wall.replace(" ", "T")}Z`) - reference.getTime();
  return Date.parse(`${wall.slice(0, 10)}T${time}:00Z`) - offset;
}
/** ROC:s tidsformat: lokal tid "YYYY-MM-DD HH:MM:SS". */
const rocTime = (ms: number) => zoned(new Date(ms), { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit",
  second: "2-digit" });

/** Skärmbilder för granskning när E2E_SCREENSHOT_DIR är satt (1280 och 390 px). */
async function screenshots(page: Page, name: string, target?: Locator) {
  const directory = process.env.E2E_SCREENSHOT_DIR;
  if (!directory) return;
  for (const width of [1280, 390]) {
    const path = `${directory}/step20-${name}-${width}.png`;
    if (target) {
      // Delen i arbetsytan: rullad till under de fasta raderna överst, i ett högt fönster.
      await page.setViewportSize({ width, height: 1400 });
      await target.evaluate(element => element.scrollIntoView({ block: "start" }));
      await page.evaluate(() => window.scrollBy(0, -160));
      await page.screenshot({ path });
      continue;
    }
    await page.setViewportSize({ width, height: 900 });
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({ path, fullPage: true });
  }
  await page.setViewportSize({ width: 1280, height: 720 });
}

test("radiokontroller: mellantid och speaker före avläsning, avläsningen avgör resultatet", async ({ browser, request }) => {
  test.setTimeout(360_000);
  const suffix = unique();
  const unitId = `e2e-${suffix}`;
  const firstStart = new Date(Math.floor(Date.now() / 60_000) * 60_000 - 30 * 60_000);
  const raceDate = zoned(firstStart, { year: "numeric", month: "2-digit", day: "2-digit" });
  const owner = await registerAccount(browser, `radio.${suffix}@exempel.se`, "Rut Radio");
  const raceId = await createRace(owner, `Radio ${suffix}`, raceDate, "Tävling");
  await publishRace(owner);
  await addCourseAndClass(owner, "Lång", "H21", "31 50 33");
  for (const runner of RUNNERS) await addEntry(owner, runner);
  await warmRoute(owner, `/api/admin/races/${raceId}/administrator/radio`);
  await warmRoute(owner, `/api/admin/races/${raceId}/administrator/radio/fetch`, "POST");
  await warmRoute(owner, `/api/public/races/${raceId}/radio`);

  // Lottning med två minuter mellan starterna, första start 30 minuter bakåt.
  await openStep(owner, "Start");
  const draw = owner.getByRole("region", { name: "Lottning" });
  await expect(draw.getByRole("row", { name: /H21/ })).toBeVisible();
  await draw.getByLabel("Första start (klockslag)").fill(clock(firstStart));
  await draw.getByLabel("Startsätt H21").selectOption({ label: "Lottad minutstart" });
  await draw.getByLabel("Intervall (min) H21").fill("2");
  await draw.getByLabel("Vakanser H21").fill("0");
  await draw.getByRole("button", { name: "Visa lottning" }).click();
  await owner.getByRole("region", { name: "Så blir startlistan" }).getByRole("button", { name: "Spara lottningen" }).click();
  await expect(owner.getByText("Lottningen är sparad.", { exact: false })).toBeVisible();
  const h21Start = owner.locator("section:not([hidden]) > [data-list]").getByRole("region", { name: "H21", exact: true });
  const starts = new Map<string, number>();
  for (const runner of RUNNERS) {
    const row = h21Start.getByRole("row", { name: new RegExp(fullName(runner)) });
    await expect(row.getByRole("cell").first()).toHaveText(/^\d\d:\d\d/);
    const time = (await row.getByRole("cell").first().textContent())!.trim().slice(0, 5);
    starts.set(runner.card, todayAt(firstStart, time));
  }

  // Inställningar → Radiokontroller: OResults, enhetens id och kontroll 50 som "Radio 1".
  await openStep(owner, "Inställningar");
  const radio = owner.getByRole("region", { name: "Radiokontroller" });
  await radio.getByLabel("Källa").selectOption("ORESULTS");
  await radio.getByLabel("Enhetens id").fill(unitId);
  await radio.getByRole("checkbox", { name: /^Kontroll 50\b/ }).check();
  await radio.getByLabel("Namn på kontroll 50").fill("Radio 1");
  await radio.getByRole("button", { name: "Spara" }).click();
  await expect(radio.getByText("Radioinställningarna är sparade.")).toBeVisible();
  await expect(radio.getByText("Hämtar automatiskt var tionde sekund i dag.")).toBeVisible();

  // Besökaren har resultatlistan öppen innan stämplingarna kommer.
  const visitor = await (await browser.newContext()).newPage();
  await visitor.goto(`/results/${raceId}`);
  await expect(visitor.getByRole("heading", { name: `Radio ${suffix}` })).toBeVisible();

  // Bo passerar Radio 1 efter 7:20, Anna efter 7:30. En okänd bricka stämplar också.
  const [anna, bo] = RUNNERS;
  const lines = [`1;50;${bo.card};${rocTime(starts.get(bo.card)! + 440_000)}`, `2;50;${anna.card};${rocTime(starts.get(anna.card)! + 450_000)}`,
    `3;50;8509999;${rocTime(starts.get(anna.card)! + 500_000)}`];
  expect((await request.post(`http://127.0.0.1:${FAKE_ROC_PORT}/__fixture/units/${unitId}`, { data: lines.join("\n") })).status()).toBe(204);
  await radio.getByRole("button", { name: "Hämta nu" }).click();
  // Pollern kan ha hunnit före; båda sparar samma stämplingar en gång.
  await expect(radio.getByText(/^Hämtat/)).toBeVisible();
  await expect(radio.getByText("3 stämplingar · 1 med okänd bricka")).toBeVisible({ timeout: 30_000 });
  await expect(radio.getByText("Okänd bricka 8509999")).toBeVisible();
  await screenshots(owner, "radio-settings", radio);

  // Publikt: mellantiden syns live innan någon läst av, med preliminär placering vid kontrollen.
  const visitorH21 = visitor.getByRole("region", { name: "H21", exact: true });
  const out = visitorH21.getByRole("region", { name: "Ute i skogen" });
  await expect(out.getByRole("row", { name: new RegExp(fullName(bo)) })).toContainText("passerat Radio 1", { timeout: 30_000 });
  await expect(out.getByRole("row", { name: new RegExp(fullName(bo)) })).toContainText("7:20");
  await expect(out.getByRole("row", { name: new RegExp(fullName(bo)) })).toContainText("(1)");
  await expect(out.getByRole("row", { name: new RegExp(fullName(anna)) })).toContainText("7:30");
  await expect(out.getByRole("row", { name: new RegExp(fullName(anna)) })).toContainText("(2)");
  await expect(visitor.getByText("8509999")).toHaveCount(0);
  await visitorH21.getByText("Radio 1 · 2 passerade").click();
  await expect(visitorH21.getByRole("table", { name: "Radio 1" }).getByRole("row", { name: new RegExp(fullName(bo)) })).toContainText("7:20");
  await screenshots(visitor, "public-results");
  await visitor.setViewportSize({ width: 390, height: 900 });
  expect(await visitor.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await visitor.setViewportSize({ width: 1280, height: 720 });

  // Tävlingssidan visar att radion är live.
  const hubLink = await visitor.getByRole("link", { name: /Tävlingssidan/ }).first().getAttribute("href");
  await visitor.goto(hubLink!);
  await expect(visitor.getByRole("link", { name: /Radiokontroller live/ })).toBeVisible();

  // Speakern: senaste radiostämplingarna och ledare vid Radio 1, innan någon läst av.
  await owner.goto(`/admin/${raceId}/speaker`);
  const feed = owner.getByRole("region", { name: "Senaste radiostämplingar" });
  await expect(feed.getByRole("row", { name: new RegExp(fullName(bo)) })).toContainText("passerat Radio 1");
  await expect(feed.getByRole("row", { name: new RegExp(fullName(bo)) })).toContainText("7:20");
  await expect(feed.getByRole("row", { name: new RegExp(fullName(anna)) })).toContainText("2.");
  await expect(owner.getByRole("heading", { name: /Ledare vid Radio 1/ })).toBeVisible();
  await screenshots(owner, "speaker");

  // Anna läser av: avläsningen avgör resultatet. Bo är kvar ute med sin mellantid.
  await owner.goto(`/admin/${raceId}/readout`);
  await owner.waitForURL(`**/readout/index.html#${raceId}`);
  await expect(owner.getByTestId("package-status")).toContainText("v");
  await owner.getByRole("button", { name: "Starta övningsstation" }).click();
  await owner.getByLabel("Deltagare").selectOption({ label: `${fullName(anna)} · H21 · ${anna.card}` });
  await owner.getByRole("button", { name: "Läs av: rätt stämplat" }).click();
  await expect(owner.getByTestId("verdict")).toContainText("GODKÄND");
  await expect(owner.getByTestId("queue-status")).toHaveText("0 väntar", { timeout: 30_000 });

  await visitor.goto(`/results/${raceId}`);
  const finalH21 = visitor.getByRole("region", { name: "H21", exact: true });
  await expect(finalH21.getByRole("table", { name: "H21" }).getByRole("row", { name: new RegExp(fullName(anna)) })).toContainText("Godkänd");
  await expect(finalH21.getByRole("region", { name: "Ute i skogen" }).getByRole("row", { name: new RegExp(fullName(anna)) })).toHaveCount(0);
  await expect(finalH21.getByRole("region", { name: "Ute i skogen" }).getByRole("row", { name: new RegExp(fullName(bo)) })).toContainText("7:20");
  await screenshots(visitor, "public-results-after-readout");
});
