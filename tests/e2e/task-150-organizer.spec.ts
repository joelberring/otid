import { readFile, rm } from "node:fs/promises";
import { realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { expect, test, type Page } from "@playwright/test";
import { createDatabase } from "@o-tid/database";

type Account = { loginName: string; password: string };
type Fixture = { owner: Account; other: Account };

test.afterAll(async () => {
  // Playwright stops the tsx launcher, which may not deliver SIGTERM to the
  // child Next process. Clean only this run's generated synthetic resources.
  const sourceUrl = process.env.OTID_TASK150_SOURCE_DATABASE_URL;
  const targetUrl = process.env.OTID_TASK150_DATABASE_URL;
  const privateDirectory = process.env.OTID_TASK150_PRIVATE_DIRECTORY;
  if (!sourceUrl || !targetUrl || !privateDirectory) throw new Error("TASK150 teardown configuration missing");
  const source = new URL(sourceUrl);
  const target = new URL(targetUrl);
  const sourceName = source.pathname.slice(1);
  const targetName = target.pathname.slice(1);
  if (!["postgres:", "postgresql:"].includes(source.protocol)
    || !["localhost", "127.0.0.1", "[::1]"].includes(source.hostname)
    || !/^otid_task150_(synthetic|spec|e2e)_[a-z0-9][a-z0-9_-]{0,40}$/.test(sourceName)
    || /(?:^|[_-])(demo|race|private)(?:[_-]|$)/i.test(sourceName)
    || !/^otid_task150_e2e_[a-f0-9]{32}$/.test(targetName)
    || dirname(privateDirectory) !== realpathSync(tmpdir())
    || !/^otid-task150-organizer-e2e-[A-Za-z0-9]+$/.test(basename(privateDirectory))) {
    throw new Error("TASK150 teardown target rejected");
  }
  const { pool } = createDatabase(sourceUrl);
  try {
    try {
      await fetch(`http://127.0.0.1:3150/__task150/shutdown/${targetName.slice("otid_task150_e2e_".length)}`, {
        method: "POST", signal: AbortSignal.timeout(5_000)
      });
    } catch { /* The test server may already have stopped. */ }
    let dropped = false;
    for (let attempt = 0; attempt < 50; attempt += 1) {
      const sessions = await pool.query<{ count: string }>(
        "SELECT count(*)::text AS count FROM pg_stat_activity WHERE datname = $1", [targetName]
      );
      if (Number(sessions.rows[0]?.count) === 0) {
        await pool.query(`DROP DATABASE IF EXISTS "${targetName}"`);
        dropped = true;
        break;
      }
      await delay(100);
    }
    if (!dropped) await pool.query(`DROP DATABASE IF EXISTS "${targetName}" WITH (FORCE)`);
  } finally {
    await pool.end();
  }
  await rm(privateDirectory, { recursive: true, force: true });
});

async function fixture(): Promise<Fixture> {
  const path = process.env.OTID_TASK150_CREDENTIALS_FILE;
  if (!path) throw new Error("TASK150 private account fixture path missing");
  return JSON.parse(await readFile(path, "utf8")) as Fixture;
}

async function enterOrganizer(page: Page, account: Account): Promise<void> {
  await page.goto("/");
  await page.getByRole("link", { name: "Mina tävlingar · Skapa tävling", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Mina tävlingar", exact: true })).toBeVisible();
  await page.getByLabel("Inloggningsnamn", { exact: true }).fill(account.loginName);
  await page.getByLabel("Lösenord", { exact: true }).fill(account.password);
  await page.getByRole("button", { name: "Logga in", exact: true }).click();
  await expect(page.getByText("Dina tävlingar", { exact: true })).toBeVisible();
}

async function hasNoHorizontalOverflow(page: Page): Promise<void> {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
}

test("TASK150 konto → event → Mina tävlingar → delegerad /manage, även efter ny session", async ({ browser }) => {
  const accounts = await fixture();
  const runSuffix = new URL(process.env.OTID_TASK150_DATABASE_URL!).pathname.split("_").at(-1)!;
  const eventName = `TASK150 E2E ${runSuffix.slice(0, 8)}`;
  const ownerContext = await browser.newContext({ baseURL: "http://127.0.0.1:3150", viewport: { width: 1280, height: 900 } });
  const ownerPage = await ownerContext.newPage();

  await enterOrganizer(ownerPage, accounts.owner);
  await hasNoHorizontalOverflow(ownerPage);
  await ownerPage.getByLabel("Eventnamn", { exact: true }).fill(eventName);
  await ownerPage.getByLabel("Loppets namn", { exact: true }).fill("Första loppet");
  await ownerPage.getByLabel("Datum", { exact: true }).fill("2026-10-03");
  const [createResponse] = await Promise.all([
    ownerPage.waitForResponse((response) =>
      response.url().endsWith("/api/organizer/events") && response.request().method() === "POST"),
    ownerPage.getByRole("button", { name: "Skapa tävling", exact: true }).click()
  ]);
  expect(createResponse.status()).toBe(201);
  const creation = await createResponse.json() as { raceId: string };
  await expect(ownerPage.getByRole("heading", { name: eventName, exact: true })).toBeVisible();
  await expect(ownerPage.getByRole("button", { name: "Öppna arbetsytan", exact: true })).toBeVisible();

  const anonymousContext = await browser.newContext({ baseURL: "http://127.0.0.1:3150", viewport: { width: 390, height: 844 } });
  const anonymousPage = await anonymousContext.newPage();
  const publicResponse = await anonymousPage.goto(`/results/${creation.raceId}`);
  expect(publicResponse?.status()).toBe(200);
  await expect(anonymousPage.getByRole("heading", { name: eventName, exact: true })).toBeVisible();
  await expect(anonymousPage.getByText("Inga publicerade resultat ännu.", { exact: true })).toBeVisible();
  expect((await anonymousContext.cookies()).filter((cookie) => cookie.name.includes("organizer-session"))).toHaveLength(0);
  await anonymousContext.close();

  await ownerPage.getByRole("button", { name: "Öppna arbetsytan", exact: true }).click();
  await expect(ownerPage).toHaveURL(new RegExp(`/admin/${creation.raceId}/manage$`));
  await expect(ownerPage.getByRole("heading", { name: "Tävlingsadministration", exact: true })).toBeVisible();
  await ownerPage.getByRole("button", { name: "Före tävlingen", exact: true }).click();
  await ownerPage.getByRole("navigation", { name: "Tävlingsförberedelser", exact: true })
    .getByRole("button", { name: "Banor", exact: true }).click();
  await ownerPage.getByText("Förbered bana och klass", { exact: true }).click();
  await ownerPage.getByLabel("Bannamn", { exact: true }).fill("Testbana");
  await ownerPage.getByLabel("Klassnamn", { exact: true }).fill("Testklass");
  await ownerPage.getByLabel("Kontrollföljd", { exact: true }).fill("31, 32");
  await ownerPage.getByRole("button", { name: "Granska bana och klass", exact: true }).click();
  await ownerPage.getByRole("button", { name: "Bekräfta och spara", exact: true }).click();
  await expect(ownerPage.getByText("Banan och klassen är sparade.", { exact: true })).toBeVisible();
  await ownerContext.close();

  const mobileContext = await browser.newContext({ baseURL: "http://127.0.0.1:3150", viewport: { width: 390, height: 844 } });
  const mobilePage = await mobileContext.newPage();
  await enterOrganizer(mobilePage, accounts.owner);
  await expect(mobilePage.getByRole("heading", { name: eventName, exact: true })).toBeVisible();
  await hasNoHorizontalOverflow(mobilePage);
  const openButton = mobilePage.getByRole("button", { name: "Öppna arbetsytan", exact: true });
  expect((await openButton.boundingBox())?.height).toBeGreaterThanOrEqual(44);
  await openButton.click();
  await expect(mobilePage).toHaveURL(new RegExp(`/admin/${creation.raceId}/manage$`));
  await expect(mobilePage.getByRole("heading", { name: "Tävlingsadministration", exact: true })).toBeVisible();
  await mobileContext.close();

  const otherContext = await browser.newContext({ baseURL: "http://127.0.0.1:3150", viewport: { width: 1280, height: 900 } });
  const otherPage = await otherContext.newPage();
  await enterOrganizer(otherPage, accounts.other);
  const enterStatus = await otherPage.evaluate(async (raceId) => {
    const cookieName = "otid_organizer_csrf=";
    const csrf = document.cookie.split(";").map((part) => part.trim())
      .find((part) => part.startsWith(cookieName))?.slice(cookieName.length);
    if (!csrf) throw new Error("Missing loopback organizer CSRF cookie");
    const response = await fetch(`/api/organizer/races/${encodeURIComponent(raceId)}/enter`, {
      method: "POST", headers: { "x-otid-csrf": csrf }
    });
    return response.status;
  }, creation.raceId);
  expect(enterStatus).toBe(404);
  await otherContext.close();
});

test("TASK151 eventbunden medadministration, återkallelse och kompakt mobilvy", async ({ browser }) => {
  const accounts = await fixture();
  const suffix = new URL(process.env.OTID_TASK150_DATABASE_URL!).pathname.split("_").at(-1)!.slice(0, 8);
  const eventName = `TASK151 A ${suffix}`;
  const otherEventName = `TASK151 B ${suffix}`;
  const ownerContext = await browser.newContext({ baseURL: "http://127.0.0.1:3150", viewport: { width: 390, height: 844 } });
  const ownerPage = await ownerContext.newPage();
  await enterOrganizer(ownerPage, accounts.owner);

  async function createEvent(name: string): Promise<{ eventId: string; raceId: string }> {
    await ownerPage.getByLabel("Eventnamn", { exact: true }).fill(name);
    await ownerPage.getByLabel("Loppets namn", { exact: true }).fill("Lång");
    await ownerPage.getByLabel("Datum", { exact: true }).fill("2026-10-04");
    const [response] = await Promise.all([
      ownerPage.waitForResponse((item) => item.url().endsWith("/api/organizer/events") && item.request().method() === "POST"),
      ownerPage.getByRole("button", { name: "Skapa tävling", exact: true }).click()
    ]);
    expect(response.status()).toBe(201);
    await expect(ownerPage.getByRole("heading", { name, exact: true })).toBeVisible();
    return response.json() as Promise<{ eventId: string; raceId: string }>;
  }

  const eventA = await createEvent(eventName);
  const eventB = await createEvent(otherEventName);
  const eventCard = ownerPage.getByRole("heading", { name: eventName, exact: true }).locator("..");
  const disclosure = eventCard.getByRole("button", { name: "Visa medadministratörer", exact: true });
  expect((await disclosure.boundingBox())?.height).toBeGreaterThanOrEqual(44);
  await disclosure.click();
  await eventCard.getByLabel("Befintligt kontos inloggningsnamn", { exact: true }).fill(accounts.other.loginName);
  const [grantResponse] = await Promise.all([
    ownerPage.waitForResponse((item) => item.url().endsWith(`/api/organizer/events/${eventA.eventId}/administrators`)
      && item.request().method() === "POST"),
    eventCard.getByRole("button", { name: "Ge eventåtkomst", exact: true }).click()
  ]);
  expect(grantResponse.status()).toBe(201);
  await expect(eventCard.getByText(accounts.other.loginName, { exact: false })).toBeVisible();
  await hasNoHorizontalOverflow(ownerPage);

  const adminContext = await browser.newContext({ baseURL: "http://127.0.0.1:3150", viewport: { width: 1280, height: 900 } });
  const adminPage = await adminContext.newPage();
  await enterOrganizer(adminPage, accounts.other);
  await expect(adminPage.getByRole("heading", { name: eventName, exact: true })).toBeVisible();
  await expect(adminPage.getByRole("heading", { name: otherEventName, exact: true })).toHaveCount(0);
  await expect(adminPage.getByRole("button", { name: "Visa medadministratörer", exact: true })).toHaveCount(0);
  const eventBEnter = await adminPage.evaluate(async (raceId) => {
    const csrf = document.cookie.split(";").map((part) => part.trim())
      .find((part) => part.startsWith("otid_organizer_csrf="))?.split("=")[1];
    if (!csrf) throw new Error("Syntetisk CSRF-cookie saknas");
    const response = await fetch(`/api/organizer/races/${raceId}/enter`, {
      method: "POST", headers: { "x-otid-csrf": csrf }
    });
    return response.status;
  }, eventB.raceId);
  expect(eventBEnter).toBe(404);
  await adminPage.getByRole("heading", { name: eventName, exact: true }).locator("..")
    .getByRole("button", { name: "Öppna arbetsytan", exact: true }).click();
  await expect(adminPage).toHaveURL(new RegExp(`/admin/${eventA.raceId}/manage$`));
  await adminPage.getByRole("button", { name: "Före tävlingen", exact: true }).click();
  await adminPage.getByRole("navigation", { name: "Tävlingsförberedelser", exact: true })
    .getByRole("button", { name: "Banor", exact: true }).click();
  await adminPage.getByText("Förbered bana och klass", { exact: true }).click();
  await adminPage.getByLabel("Bannamn", { exact: true }).fill("ADMIN-bana");
  await adminPage.getByLabel("Klassnamn", { exact: true }).fill("H21");
  await adminPage.getByLabel("Kontrollföljd", { exact: true }).fill("31, 32");
  await adminPage.getByRole("button", { name: "Granska bana och klass", exact: true }).click();
  await adminPage.getByRole("button", { name: "Bekräfta och spara", exact: true }).click();
  await expect(adminPage.getByText("Banan och klassen är sparade.", { exact: true })).toBeVisible();

  ownerPage.once("dialog", (dialog) => void dialog.accept());
  const [revokeResponse] = await Promise.all([
    ownerPage.waitForResponse((item) => item.url().endsWith("/revoke") && item.request().method() === "POST"),
    eventCard.getByRole("button", { name: "Återkalla åtkomst", exact: true }).click()
  ]);
  expect(revokeResponse.status()).toBe(200);
  const staleReadStatus = await adminPage.evaluate(async (raceId) => {
    const response = await fetch(`/api/admin/races/${raceId}/administrator/participants`, { cache: "no-store" });
    return response.status;
  }, eventA.raceId);
  expect(staleReadStatus).toBe(401);
  await ownerContext.close();
  await adminContext.close();
});

test("TASK279 hittar senare skapat event lokalt efter nya sessioner", async ({ browser }) => {
  const accounts = await fixture();
  const suffix = new URL(process.env.OTID_TASK150_DATABASE_URL!).pathname.split("_").at(-1)!.slice(0, 8);
  const firstName = `TASK279 Första ${suffix}`;
  const laterName = `TASK279 Senare ${suffix}`;
  const laterRaceName = `TASK279 Nattlopp ${suffix}`;
  const origin = "http://127.0.0.1:3150";

  async function createEvent(page: Page, eventName: string, raceName: string): Promise<string> {
    await page.getByLabel("Eventnamn", { exact: true }).fill(eventName);
    await page.getByLabel("Loppets namn", { exact: true }).fill(raceName);
    await page.getByLabel("Datum", { exact: true }).fill("2026-10-05");
    const [response] = await Promise.all([
      page.waitForResponse((item) => item.url().endsWith("/api/organizer/events") && item.request().method() === "POST"),
      page.getByRole("button", { name: "Skapa tävling", exact: true }).click()
    ]);
    expect(response.status()).toBe(201);
    await expect(page.getByRole("heading", { name: eventName, exact: true })).toBeVisible();
    return (await response.json() as { raceId: string }).raceId;
  }

  const firstContext = await browser.newContext({ baseURL: origin });
  const firstPage = await firstContext.newPage();
  await enterOrganizer(firstPage, accounts.owner);
  await createEvent(firstPage, firstName, "Första loppet");
  await firstContext.close();

  const secondContext = await browser.newContext({ baseURL: origin });
  const secondPage = await secondContext.newPage();
  await enterOrganizer(secondPage, accounts.owner);
  await expect(secondPage.getByRole("heading", { name: firstName, exact: true })).toBeVisible();
  const laterRaceId = await createEvent(secondPage, laterName, laterRaceName);
  await secondContext.close();

  const searchContext = await browser.newContext({ baseURL: origin, viewport: { width: 390, height: 844 } });
  const searchPage = await searchContext.newPage();
  await enterOrganizer(searchPage, accounts.owner);
  await expect(searchPage.getByRole("heading", { name: firstName, exact: true })).toBeVisible();
  await expect(searchPage.getByRole("heading", { name: laterName, exact: true })).toBeVisible();
  let searchApiRequests = 0;
  searchPage.on("request", (request) => {
    if (new URL(request.url()).pathname.startsWith("/api/")) searchApiRequests += 1;
  });
  const finder = searchPage.getByRole("searchbox", { name: "Sök tävling eller lopp" });
  await finder.fill(laterRaceName.toLocaleLowerCase("sv-SE"));
  await expect(searchPage.getByRole("heading", { name: firstName, exact: true })).toHaveCount(0);
  const laterCard = searchPage.getByRole("heading", { name: laterName, exact: true }).locator("xpath=ancestor::li[1]");
  await expect(laterCard).toContainText(laterRaceName);
  await searchPage.getByRole("button", { name: "Rensa sökning" }).click();
  await expect(finder).toHaveValue("");
  await expect(searchPage.getByRole("heading", { name: firstName, exact: true })).toBeVisible();
  await expect(searchPage.getByRole("heading", { name: laterName, exact: true })).toBeVisible();
  await finder.fill(laterRaceName);
  await expect(searchPage.getByRole("heading", { name: firstName, exact: true })).toHaveCount(0);
  expect(searchApiRequests).toBe(0);
  await laterCard.getByRole("button", { name: "Öppna arbetsytan", exact: true }).click();
  await expect(searchPage).toHaveURL(new RegExp(`/admin/${laterRaceId}/manage$`));
  await searchContext.close();

  const otherContext = await browser.newContext({ baseURL: origin });
  const otherPage = await otherContext.newPage();
  await enterOrganizer(otherPage, accounts.other);
  await expect(otherPage.getByRole("heading", { name: laterName, exact: true })).toHaveCount(0);
  await expect(otherPage.getByRole("searchbox", { name: "Sök tävling eller lopp" })).toHaveCount(0);
  const enterStatus = await otherPage.evaluate(async (raceId) => {
    const csrf = document.cookie.split(";").map((part) => part.trim())
      .find((part) => part.startsWith("otid_organizer_csrf="))?.slice("otid_organizer_csrf=".length);
    if (!csrf) throw new Error("Missing loopback organizer CSRF cookie");
    const response = await fetch(`/api/organizer/races/${encodeURIComponent(raceId)}/enter`, {
      method: "POST", headers: { "x-otid-csrf": csrf }
    });
    return response.status;
  }, laterRaceId);
  expect(enterStatus).toBe(404);
  await otherContext.close();
});
