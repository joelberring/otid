import { readFile, rm } from "node:fs/promises";
import { realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { expect, test, type Page } from "@playwright/test";
import { createDatabase } from "@o-tid/database";

type Account = { loginName: string; password: string };
type Fixture = { owner: Account };

test.afterAll(async () => {
  const sourceUrl = process.env.TASK150_SOURCE_DATABASE_URL;
  const targetUrl = process.env.OTID_TASK160_TARGET_URL;
  const privateDirectory = process.env.OTID_TASK160_PRIVATE_DIRECTORY;
  const runId = process.env.OTID_TASK160_RUN_ID;
  if (!sourceUrl || !targetUrl || !privateDirectory || !runId) throw new Error("TASK160 teardown configuration missing");
  const source = new URL(sourceUrl);
  const target = new URL(targetUrl);
  const targetName = target.pathname.slice(1);
  if (source.pathname !== "/otid_task160_test"
    || !["postgres:", "postgresql:"].includes(source.protocol)
    || !["localhost", "127.0.0.1", "[::1]"].includes(source.hostname)
    || !new RegExp(`^otid_task150_e2e_${runId}$`).test(targetName)
    || dirname(privateDirectory) !== realpathSync(tmpdir())
    || !/^otid-task160-organizer-e2e-[A-Za-z0-9]+$/.test(basename(privateDirectory))) {
    throw new Error("TASK160 teardown target rejected");
  }
  const { pool } = createDatabase(sourceUrl);
  try {
    try {
      await fetch(`http://127.0.0.1:3156/__task150/shutdown/${runId}`, {
        method: "POST", signal: AbortSignal.timeout(5_000)
      });
    } catch { /* Server may already have stopped. */ }
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
  const path = process.env.TASK150_CREDENTIALS_FILE;
  if (!path) throw new Error("TASK160 private account fixture missing");
  return JSON.parse(await readFile(path, "utf8")) as Fixture;
}

async function login(page: Page, account: Account): Promise<void> {
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

test("TASK160 OWNER-inbjudan kräver separat ADMIN-beslut på 390px", async ({ browser }) => {
  const { owner } = await fixture();
  const runSuffix = new URL(process.env.OTID_TASK160_TARGET_URL!).pathname.split("_").at(-1)!.slice(0, 8);
  const eventName = `TASK160 ${runSuffix}`;
  const loginName = `task160.recipient.${runSuffix}`;
  const ownerContext = await browser.newContext({ baseURL: "http://127.0.0.1:3156", viewport: { width: 390, height: 844 } });
  const ownerPage = await ownerContext.newPage();
  await login(ownerPage, owner);
  await ownerPage.getByLabel("Eventnamn", { exact: true }).fill(eventName);
  await ownerPage.getByLabel("Loppets namn", { exact: true }).fill("Inbjudningslopp");
  await ownerPage.getByLabel("Datum", { exact: true }).fill("2026-10-03");
  const [createResponse] = await Promise.all([
    ownerPage.waitForResponse((response) => response.url().endsWith("/api/organizer/events") && response.request().method() === "POST"),
    ownerPage.getByRole("button", { name: "Skapa tävling", exact: true }).click()
  ]);
  expect(createResponse.status()).toBe(201);
  const { eventId, raceId } = await createResponse.json() as { eventId: string; raceId: string };
  const eventCard = ownerPage.getByRole("heading", { name: eventName, exact: true }).locator("../..");
  const panelButton = eventCard.getByRole("button", { name: "Visa medadministratörer", exact: true });
  expect((await panelButton.boundingBox())?.height).toBeGreaterThanOrEqual(44);
  await panelButton.click();
  await eventCard.getByRole("button", { name: "Bjud in nytt konto", exact: true }).click();
  await eventCard.getByLabel("Nytt kontos inloggningsnamn", { exact: true }).fill(loginName);
  await eventCard.getByLabel("Mottagarens visningsnamn", { exact: true }).fill("Syntetisk mottagare");
  const [issueResponse] = await Promise.all([
    ownerPage.waitForResponse((response) => response.url().endsWith(`/api/organizer/events/${eventId}/account-invitations`)
      && response.request().method() === "POST"),
    eventCard.getByRole("button", { name: "Skapa engångskod", exact: true }).click()
  ]);
  expect(issueResponse.status()).toBe(201);
  const code = await eventCard.locator("code").textContent();
  expect(code).toMatch(/^[A-Za-z0-9_-]{43}$/);
  expect(new URL(ownerPage.url()).pathname).toBe("/organizer");
  expect(await ownerPage.evaluate((issuedCode) => {
    for (const storage of [localStorage, sessionStorage]) {
      for (let index = 0; index < storage.length; index += 1) {
        const key = storage.key(index);
        if (key && storage.getItem(key)?.includes(issuedCode)) return true;
      }
    }
    return false;
  }, code!)).toBe(false);
  await hasNoHorizontalOverflow(ownerPage);

  const recipientContext = await browser.newContext({ baseURL: "http://127.0.0.1:3156", viewport: { width: 390, height: 844 } });
  const recipientPage = await recipientContext.newPage();
  await recipientPage.goto("/activate");
  await recipientPage.getByLabel("Användarnamn").fill(loginName);
  await recipientPage.getByLabel("Engångskod").fill(code!);
  await recipientPage.getByRole("button", { name: "Skapa mitt lösenord" }).click();
  const recipientPassword = await recipientPage.getByLabel("Ditt nya lösenord").textContent();
  expect(recipientPassword).toMatch(/^[A-Za-z0-9_-]{43}$/);
  await recipientPage.getByRole("checkbox", { name: /Jag har sparat eller kopierat lösenordet/ }).check();
  const [activationResponse] = await Promise.all([
    recipientPage.waitForResponse((response) => response.url().endsWith("/api/account/activation")
      && response.request().method() === "POST"),
    recipientPage.getByRole("button", { name: "Aktivera konto" }).click()
  ]);
  expect(activationResponse.status()).toBe(201);
  await expect(recipientPage.getByRole("heading", { name: "Kontot är aktiverat" })).toBeVisible();
  expect(await recipientPage.evaluate(() => [localStorage.length, sessionStorage.length])).toEqual([0, 0]);
  await recipientPage.getByRole("link", { name: "Logga in som arrangör" }).click();
  await recipientPage.getByLabel("Inloggningsnamn", { exact: true }).fill(loginName);
  await recipientPage.getByLabel("Lösenord", { exact: true }).fill(recipientPassword!);
  await recipientPage.getByRole("button", { name: "Logga in", exact: true }).click();
  await expect(recipientPage.getByText("Dina tävlingar", { exact: true })).toBeVisible();
  await expect(recipientPage.getByRole("heading", { name: eventName, exact: true })).toHaveCount(0);
  const enterBeforeGrant = await recipientPage.evaluate(async (id) => {
    const csrf = document.cookie.split(";").map((part) => part.trim())
      .find((part) => part.startsWith("otid_organizer_csrf="))?.split("=")[1];
    if (!csrf) throw new Error("Organizer CSRF cookie missing");
    const response = await fetch(`/api/organizer/races/${encodeURIComponent(id)}/enter`, {
      method: "POST", headers: { "x-otid-csrf": csrf }
    });
    return response.status;
  }, raceId);
  expect(enterBeforeGrant).toBe(404);

  const invitationPanel = eventCard.getByRole("region", { name: "Bjud in ett nytt konto", exact: true });
  await invitationPanel.getByRole("button", { name: "Uppdatera", exact: true }).click();
  await expect(eventCard.getByText("konto aktiverat", { exact: false })).toBeVisible();
  const invitationRow = invitationPanel.locator("li").filter({ hasText: loginName });
  let grantRequests = 0;
  ownerPage.on("request", (request) => {
    if (request.url().endsWith(`/api/organizer/events/${eventId}/administrators`) && request.method() === "POST") grantRequests += 1;
  });
  await invitationRow.getByRole("button", { name: "Granska eventåtkomst", exact: true }).click();
  await expect(eventCard.getByLabel("Befintligt kontos inloggningsnamn", { exact: true })).toHaveValue(loginName);
  await expect(eventCard.locator('[tabindex="-1"]').filter({ hasText: loginName })).toBeFocused();
  expect(grantRequests).toBe(0);
  const [grantResponse] = await Promise.all([
    ownerPage.waitForResponse((response) => response.url().endsWith(`/api/organizer/events/${eventId}/administrators`)
      && response.request().method() === "POST"),
    eventCard.getByRole("button", { name: "Ge eventåtkomst", exact: true }).click()
  ]);
  expect(grantResponse.status()).toBe(201);
  expect(grantRequests).toBe(1);
  await expect(invitationRow.getByText("Eventåtkomst aktiv", { exact: true })).toBeVisible();
  await recipientPage.reload();
  await expect(recipientPage.getByRole("heading", { name: eventName, exact: true })).toBeVisible();
  await hasNoHorizontalOverflow(recipientPage);
  await recipientPage.getByRole("button", { name: "Öppna arbetsytan", exact: true }).click();
  await expect(recipientPage).toHaveURL(new RegExp(`/admin/${raceId}/manage$`));
  await expect(recipientPage.getByRole("heading", { name: "Tävlingsadministration", exact: true })).toBeVisible();

  await recipientContext.close();
  await ownerContext.close();
});
