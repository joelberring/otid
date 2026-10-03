import { readFile, rm } from "node:fs/promises";
import { realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { randomUUID } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import { contentHash, ingestDeviceBatch } from "@o-tid/application";
import { createDatabase, schema } from "@o-tid/database";
import { eq } from "drizzle-orm";

type Account = { loginName: string; password: string };
type Fixture = { owner: Account; other: Account };
const origin = "http://127.0.0.1:3151";
const sourceUrl = process.env.OTID_TASK152_SOURCE_DATABASE_URL;
const targetUrl = process.env.OTID_TASK152_DATABASE_URL;
const privateDirectory = process.env.OTID_TASK152_PRIVATE_DIRECTORY;
if (!sourceUrl || sourceUrl !== process.env.TEST_DATABASE_URL || !targetUrl || !privateDirectory) {
  throw new Error("TASK152 synthetic database configuration rejected");
}
const source = new URL(sourceUrl), target = new URL(targetUrl);
const sourceName = source.pathname.slice(1), targetName = target.pathname.slice(1);
if (!["postgres:", "postgresql:"].includes(source.protocol)
  || !["localhost", "127.0.0.1", "[::1]"].includes(source.hostname)
  || target.protocol !== source.protocol || target.host !== source.host || target.username !== source.username
  || target.password !== source.password || !["localhost", "127.0.0.1", "[::1]"].includes(target.hostname)
  || !/^otid_task150_(synthetic|spec|e2e)_[a-z0-9][a-z0-9_-]{0,40}$/.test(sourceName)
  || /(?:^|[_-])(demo|race|private)(?:[_-]|$)/i.test(sourceName)
  || !/^otid_task150_e2e_[a-f0-9]{32}$/.test(targetName)
  || targetName === sourceName
  || dirname(privateDirectory) !== realpathSync(tmpdir())
  || !/^otid-task152-claim-e2e-[A-Za-z0-9]+$/.test(basename(privateDirectory))) {
  throw new Error("TASK152 synthetic test target rejected");
}
const { db, pool } = createDatabase(targetUrl);

test.afterAll(async () => {
  try {
    await fetch(`${origin}/__task150/shutdown/${targetName.slice("otid_task150_e2e_".length)}`, {
      method: "POST", signal: AbortSignal.timeout(5_000)
    });
  } catch { /* The fixture server may already have shut down. */ }
  await pool.end();
  const { pool: adminPool } = createDatabase(sourceUrl);
  try {
    let dropped = false;
    for (let attempt = 0; attempt < 50; attempt += 1) {
      const sessions = await adminPool.query<{ count: string }>(
        "SELECT count(*)::text AS count FROM pg_stat_activity WHERE datname = $1", [targetName]
      );
      if (Number(sessions.rows[0]?.count) === 0) {
        await adminPool.query(`DROP DATABASE IF EXISTS "${targetName}"`);
        dropped = true;
        break;
      }
      await delay(100);
    }
    if (!dropped) await adminPool.query(`DROP DATABASE IF EXISTS "${targetName}" WITH (FORCE)`);
  } finally { await adminPool.end(); }
  await rm(privateDirectory, { recursive: true, force: true });
});

async function fixture(): Promise<Fixture> {
  const path = process.env.OTID_TASK152_CREDENTIALS_FILE;
  if (!path || !path.startsWith(`${privateDirectory}/`)) throw new Error("TASK152 private account fixture missing");
  return JSON.parse(await readFile(path, "utf8")) as Fixture;
}

async function loginAccount(page: Page, account: Account): Promise<void> {
  await page.goto("/me");
  await expect(page.getByRole("heading", { name: "Mina resultat", exact: true })).toBeVisible();
  await page.getByLabel("Användarnamn", { exact: true }).fill(account.loginName);
  await page.getByLabel("Lösenord", { exact: true }).fill(account.password);
  await page.getByRole("button", { name: "Logga in", exact: true }).click();
  await expect(page.getByText(/^Inloggad som /)).toBeVisible();
}

async function hasNoHorizontalOverflow(page: Page): Promise<void> {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
}

async function createEventAndEntry(ownerPage: Page, account: Account, eventName: string) {
  await ownerPage.goto("/");
  await ownerPage.getByRole("link", { name: "Mina tävlingar · Skapa tävling", exact: true }).click();
  await expect(ownerPage.getByRole("heading", { name: "Mina tävlingar", exact: true })).toBeVisible();
  await ownerPage.getByLabel("Inloggningsnamn", { exact: true }).fill(account.loginName);
  await ownerPage.getByLabel("Lösenord", { exact: true }).fill(account.password);
  await ownerPage.getByRole("button", { name: "Logga in", exact: true }).click();
  await expect(ownerPage.getByText("Dina tävlingar", { exact: true })).toBeVisible();
  await ownerPage.getByLabel("Eventnamn", { exact: true }).fill(eventName);
  await ownerPage.getByLabel("Loppets namn", { exact: true }).fill("B1-loppet");
  await ownerPage.getByLabel("Datum", { exact: true }).fill("2026-10-03");
  const [created] = await Promise.all([
    ownerPage.waitForResponse(response => response.url().endsWith("/api/organizer/events") && response.request().method() === "POST"),
    ownerPage.getByRole("button", { name: "Skapa tävling", exact: true }).click()
  ]);
  expect(created.status()).toBe(201);
  const event = await created.json() as { raceId: string };
  await ownerPage.getByRole("button", { name: "Öppna tävling", exact: true }).click();
  await expect(ownerPage).toHaveURL(new RegExp(`/admin/${event.raceId}/manage$`));
  await expect(ownerPage.getByRole("heading", { name: "Tävlingsadministration", exact: true })).toBeVisible();
  await ownerPage.getByRole("button", { name: "Före tävlingen", exact: true }).click();
  await ownerPage.getByRole("navigation", { name: "Tävlingsförberedelser", exact: true })
    .getByRole("button", { name: "Banor", exact: true }).click();
  await ownerPage.getByText("Förbered bana och klass", { exact: true }).click();
  await ownerPage.getByLabel("Bannamn", { exact: true }).fill("B1-testbana");
  await ownerPage.getByLabel("Klassnamn", { exact: true }).fill("H21 B1");
  await ownerPage.getByLabel("Kontrollföljd", { exact: true }).fill("31");
  await ownerPage.getByRole("button", { name: "Granska bana och klass", exact: true }).click();
  await ownerPage.getByRole("button", { name: "Bekräfta och spara", exact: true }).click();
  await expect(ownerPage.getByText("Banan och klassen är sparade.", { exact: true })).toBeVisible();
  await ownerPage.getByRole("navigation", { name: "Tävlingsförberedelser", exact: true })
    .getByRole("button", { name: "Deltagare", exact: true }).click();
  await ownerPage.getByRole("button", { name: "Ny deltagare", exact: true }).click();
  const registrationClass = ownerPage.getByRole("combobox", { name: "Anmälningsklass", exact: true });
  await expect(registrationClass).toBeVisible();
  await registrationClass.selectOption({ label: "H21 B1" });
  await ownerPage.getByLabel("Förnamn", { exact: true }).fill("Ada");
  await ownerPage.getByLabel("Efternamn", { exact: true }).fill("B1-löpare");
  await ownerPage.getByLabel("Bricknummer (valfritt)", { exact: true }).fill("88900152");
  await ownerPage.getByRole("button", { name: "Granska anmälan", exact: true }).click();
  await ownerPage.getByRole("button", { name: "Bekräfta anmälan", exact: true }).click();
  await expect(ownerPage.getByText("Deltagaren är anmäld.", { exact: true })).toBeVisible();
  await expect(ownerPage.getByRole("heading", { name: "Koppla deltagarens konto", exact: true })).toBeVisible();
  return event;
}

test("TASK152: arrangörskod kopplar ett eget publicerat resultat till deltagarkontot", async ({ browser }) => {
  const accounts = await fixture();
  const runSuffix = targetName.slice("otid_task150_e2e_".length, "otid_task150_e2e_".length + 8);
  const eventName = `TASK152 B1 ${runSuffix}`;
  const ownerContext = await browser.newContext({ baseURL: origin, viewport: { width: 390, height: 844 } });
  const ownerPage = await ownerContext.newPage();
  const event = await createEventAndEntry(ownerPage, accounts.owner, eventName);
  await hasNoHorizontalOverflow(ownerPage);
  await ownerPage.locator("details").filter({ hasText: "Kontokoppling · frivillig" }).locator("summary").click();
  await expect(ownerPage.getByRole("button", { name: "Skapa engångskod", exact: true })).toBeDisabled();
  await ownerPage.getByLabel("Jag har kontrollerat mottagarens identitet utanför systemet.", { exact: true }).check();
  await ownerPage.getByRole("button", { name: "Skapa engångskod", exact: true }).click();
  await expect(ownerPage.getByRole("heading", { name: "Lämna koden privat till deltagaren", exact: true })).toBeVisible();
  const code = (await ownerPage.locator(".participant-claim-admin output").textContent())?.trim();
  expect(code).toMatch(/^[A-Za-z0-9_-]{21}[AQgw]$/);
  const issueRequest = await ownerPage.evaluate(() => performance.getEntriesByType("resource")
    .map(entry => entry.name).filter(url => url.includes("participant-claims")));
  expect(issueRequest.every(url => !url.includes(code!))).toBe(true);

  const participantContext = await browser.newContext({ baseURL: origin, viewport: { width: 390, height: 844 } });
  const participantPage = await participantContext.newPage();
  await loginAccount(participantPage, accounts.other);
  await hasNoHorizontalOverflow(participantPage);
  await participantPage.getByLabel("Engångskod från arrangören", { exact: true }).fill(code!);
  await participantPage.getByRole("button", { name: "Koppla anmälan", exact: true }).click();
  await expect(participantPage.getByText("Anmälan är kopplad till ditt konto.", { exact: true })).toBeVisible();
  await expect(participantPage.getByText("Resultat publiceras inte ännu.", { exact: true })).toBeVisible();
  expect(await participantPage.evaluate(() => [localStorage, sessionStorage].map(store => store.length))).toEqual([0, 0]);

  const [entry] = await db.select({ id: schema.entries.id, classId: schema.entries.classId }).from(schema.entries)
    .where(eq(schema.entries.familyName, "B1-löpare"));
  if (!entry) throw new Error("Synthetic TASK152 entry missing");
  const payload = {
    cardNumber: "88900152",
    startPunchedAt: "2026-10-03T10:00:00.000Z",
    finishPunchedAt: "2026-10-03T10:20:00.000Z",
    punches: [{ code: 31, punchedAt: "2026-10-03T10:10:00.000Z" }]
  };
  const deviceId = randomUUID();
  const ingested = await ingestDeviceBatch(db, event.raceId, {
    deviceId, sessionId: deviceId, packageVersion: 1, firstSequence: 1, lastSequence: 1,
    events: [{ localSequence: 1, stationReceivedAt: "2026-10-03T10:21:00.000Z", transport: "simulator", payload,
      contentHash: contentHash(payload) }]
  });
  expect(ingested.acknowledgements[0]?.status).toBe("stored");
  await participantPage.reload();
  await expect(participantPage.getByText("Visa publicerat resultat", { exact: true })).toBeVisible();
  await hasNoHorizontalOverflow(participantPage);

  const freshParticipantContext = await browser.newContext({ baseURL: origin, viewport: { width: 390, height: 844 } });
  const freshParticipantPage = await freshParticipantContext.newPage();
  await loginAccount(freshParticipantPage, accounts.other);
  await expect(freshParticipantPage.getByText("Ada B1-löpare", { exact: true })).toBeVisible();
  await expect(freshParticipantPage.getByText("Visa publicerat resultat", { exact: true })).toBeVisible();
  await hasNoHorizontalOverflow(freshParticipantPage);

  const wrongAccountPage = await ownerContext.newPage();
  await wrongAccountPage.goto("/me");
  await expect(wrongAccountPage.getByText("Inloggad som Syntetisk arrangör", { exact: true })).toBeVisible();
  await expect(wrongAccountPage.getByText("Inga anmälningar är kopplade till kontot ännu.", { exact: true })).toBeVisible();

  const publicContext = await browser.newContext({ baseURL: origin, viewport: { width: 390, height: 844 } });
  const publicPage = await publicContext.newPage();
  const [storedEntry] = await db.select({ publicResultId: schema.entries.publicResultId }).from(schema.entries)
    .where(eq(schema.entries.id, entry.id));
  if (!storedEntry?.publicResultId) throw new Error("Public result id missing after synthetic readout");
  const publicResponse = await publicPage.goto(`/results/${event.raceId}/participants/${storedEntry.publicResultId}`);
  expect(publicResponse?.status()).toBe(200);
  await expect(publicPage.getByRole("heading", { name: "Ada B1-löpare", exact: true })).toBeVisible();
  expect((await publicContext.cookies()).filter(cookie => cookie.name.includes("organizer-session"))).toHaveLength(0);

  await publicContext.close();
  await freshParticipantContext.close();
  await participantContext.close();
  await ownerContext.close();
});
