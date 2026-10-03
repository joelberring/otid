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
const origin = "http://127.0.0.1:3152";
const sourceUrl = process.env.OTID_TASK153_SOURCE_DATABASE_URL;
const targetUrl = process.env.OTID_TASK153_DATABASE_URL;
const privateDirectory = process.env.OTID_TASK153_PRIVATE_DIRECTORY;
if (!sourceUrl || sourceUrl !== process.env.TEST_DATABASE_URL || !targetUrl || !privateDirectory) {
  throw new Error("TASK153 synthetic database configuration rejected");
}
const source = new URL(sourceUrl), target = new URL(targetUrl);
const sourceName = source.pathname.slice(1), targetName = target.pathname.slice(1);
if (!( ["postgres:", "postgresql:"].includes(source.protocol)
  && ["localhost", "127.0.0.1", "[::1]"].includes(source.hostname)
  && target.protocol === source.protocol && target.host === source.host && target.username === source.username
  && target.password === source.password && ["localhost", "127.0.0.1", "[::1]"].includes(target.hostname)
  && /^otid_task150_synthetic_[a-z0-9][a-z0-9_-]{0,40}$/.test(sourceName)
  && !/(?:^|[_-])(demo|race|private)(?:[_-]|$)/i.test(sourceName)
  && /^otid_task150_e2e_[a-f0-9]{32}$/.test(targetName) && targetName !== sourceName
  && dirname(privateDirectory) === realpathSync(tmpdir())
  && /^otid-task153-follows-e2e-[A-Za-z0-9]+$/.test(basename(privateDirectory)))) {
  throw new Error("TASK153 synthetic test target rejected");
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
  const path = process.env.OTID_TASK153_CREDENTIALS_FILE;
  if (!path || !path.startsWith(`${privateDirectory}/`)) throw new Error("TASK153 private account fixture missing");
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
  await ownerPage.getByLabel("Loppets namn", { exact: true }).fill("B2-loppet");
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
  await ownerPage.getByLabel("Bannamn", { exact: true }).fill("B2-testbana");
  await ownerPage.getByLabel("Klassnamn", { exact: true }).fill("H21 B2");
  await ownerPage.getByLabel("Kontrollföljd", { exact: true }).fill("41");
  await ownerPage.getByRole("button", { name: "Granska bana och klass", exact: true }).click();
  await ownerPage.getByRole("button", { name: "Bekräfta och spara", exact: true }).click();
  await expect(ownerPage.getByText("Banan och klassen är sparade.", { exact: true })).toBeVisible();
  await ownerPage.getByRole("navigation", { name: "Tävlingsförberedelser", exact: true })
    .getByRole("button", { name: "Deltagare", exact: true }).click();
  await ownerPage.getByRole("button", { name: "Ny deltagare", exact: true }).click();
  const registrationClass = ownerPage.getByRole("combobox", { name: "Anmälningsklass", exact: true });
  await expect(registrationClass).toBeVisible();
  await registrationClass.selectOption({ label: "H21 B2" });
  await ownerPage.getByLabel("Förnamn", { exact: true }).fill("Ada");
  await ownerPage.getByLabel("Efternamn", { exact: true }).fill("B2-löpare");
  await ownerPage.getByLabel("Bricknummer (valfritt)", { exact: true }).fill("88900153");
  await ownerPage.getByRole("button", { name: "Granska anmälan", exact: true }).click();
  await ownerPage.getByRole("button", { name: "Bekräfta anmälan", exact: true }).click();
  await expect(ownerPage.getByText("Deltagaren är anmäld.", { exact: true })).toBeVisible();
  return event;
}

test("TASK153: kontoföljning synkas mellan sessioner och anonyma favoriter stannar lokala", async ({ browser }) => {
  const accounts = await fixture();
  const runSuffix = targetName.slice("otid_task150_e2e_".length, "otid_task150_e2e_".length + 8);
  const eventName = `TASK153 B2 ${runSuffix}`;
  const ownerContext = await browser.newContext({ baseURL: origin, viewport: { width: 390, height: 844 } });
  const ownerPage = await ownerContext.newPage();
  const event = await createEventAndEntry(ownerPage, accounts.owner, eventName);
  await hasNoHorizontalOverflow(ownerPage);

  const [entry] = await db.select({ id: schema.entries.id }).from(schema.entries)
    .where(eq(schema.entries.familyName, "B2-löpare"));
  if (!entry) throw new Error("Synthetic TASK153 entry missing");
  const payload = {
    cardNumber: "88900153",
    startPunchedAt: "2026-10-03T10:00:00.000Z",
    finishPunchedAt: "2026-10-03T10:20:00.000Z",
    punches: [{ code: 41, punchedAt: "2026-10-03T10:10:00.000Z" }]
  };
  const deviceId = randomUUID();
  const ingested = await ingestDeviceBatch(db, event.raceId, {
    deviceId, sessionId: deviceId, packageVersion: 1, firstSequence: 1, lastSequence: 1,
    events: [{ localSequence: 1, stationReceivedAt: "2026-10-03T10:21:00.000Z", transport: "simulator", payload,
      contentHash: contentHash(payload) }]
  });
  expect(ingested.acknowledgements[0]?.status).toBe("stored");
  const [storedEntry] = await db.select({ publicResultId: schema.entries.publicResultId }).from(schema.entries)
    .where(eq(schema.entries.id, entry.id));
  if (!storedEntry?.publicResultId) throw new Error("Public result id missing after synthetic readout");

  const anonymousContext = await browser.newContext({ baseURL: origin, viewport: { width: 390, height: 844 } });
  const anonymousPage = await anonymousContext.newPage();
  const anonymousResponse = await anonymousPage.goto(`/results/${event.raceId}`);
  expect(anonymousResponse?.status()).toBe(200);
  const anonymousRow = anonymousPage.locator("tr").filter({ hasText: "Ada B2-löpare" });
  await expect(anonymousRow.getByRole("button", { name: "Spara favorit", exact: true })).toBeVisible();
  await anonymousRow.getByRole("button", { name: "Spara favorit", exact: true }).click();
  await expect(anonymousRow.getByRole("button", { name: "Ta bort favorit", exact: true })).toBeVisible();
  await anonymousPage.reload();
  await expect(anonymousPage.locator("tr").filter({ hasText: "Ada B2-löpare" })
    .getByRole("button", { name: "Ta bort favorit", exact: true })).toBeVisible();
  expect((await anonymousContext.cookies()).filter(cookie => cookie.name.includes("organizer-session"))).toHaveLength(0);
  await hasNoHorizontalOverflow(anonymousPage);

  const participantContext = await browser.newContext({ baseURL: origin, viewport: { width: 390, height: 844 } });
  const participantPage = await participantContext.newPage();
  await loginAccount(participantPage, accounts.other);
  await hasNoHorizontalOverflow(participantPage);
  await participantPage.goto(`/results/${event.raceId}`);
  const participantRow = participantPage.locator("tr").filter({ hasText: "Ada B2-löpare" });
  await expect(participantRow.getByRole("button", { name: "Följ resultat", exact: true })).toBeVisible();
  await participantRow.getByRole("button", { name: "Följ resultat", exact: true }).click();
  await expect(participantRow.getByRole("button", { name: "Sluta följa", exact: true })).toBeVisible();
  await hasNoHorizontalOverflow(participantPage);

  const freshContext = await browser.newContext({ baseURL: origin, viewport: { width: 1280, height: 800 } });
  const freshPage = await freshContext.newPage();
  await loginAccount(freshPage, accounts.other);
  const followedSection = freshPage.getByRole("heading", { name: "Följda publika resultat", exact: true }).locator("..");
  await expect(followedSection.getByText(eventName, { exact: true })).toBeVisible();
  await expect(followedSection.getByText("Ada B2-löpare", { exact: true })).toBeVisible();
  await freshPage.goto(`/results/${event.raceId}`);
  const freshRow = freshPage.locator("tr").filter({ hasText: "Ada B2-löpare" });
  await expect(freshRow.getByRole("button", { name: "Sluta följa", exact: true })).toBeVisible();
  await hasNoHorizontalOverflow(freshPage);

  await ownerPage.goto("/me");
  await expect(ownerPage.getByText("Inloggad som Syntetisk arrangör", { exact: true })).toBeVisible();
  const ownerFollowedSection = ownerPage.getByRole("heading", { name: "Följda publika resultat", exact: true }).locator("..");
  await expect(ownerFollowedSection.getByText("Du följer inga publika resultat ännu.", { exact: true })).toBeVisible();
  await expect(ownerFollowedSection.getByText("Ada B2-löpare", { exact: true })).toHaveCount(0);

  await freshPage.goto("/me");
  const meFollowedSection = freshPage.getByRole("heading", { name: "Följda publika resultat", exact: true }).locator("..");
  await meFollowedSection.getByRole("button", { name: "Sluta följa", exact: true }).click();
  await expect(meFollowedSection.getByText("Du följer inga publika resultat ännu.", { exact: true })).toBeVisible();
  await freshPage.reload();
  const reloadedSection = freshPage.getByRole("heading", { name: "Följda publika resultat", exact: true }).locator("..");
  await expect(reloadedSection.getByText("Du följer inga publika resultat ännu.", { exact: true })).toBeVisible();
  await freshPage.goto(`/results/${event.raceId}`);
  await expect(freshPage.locator("tr").filter({ hasText: "Ada B2-löpare" })
    .getByRole("button", { name: "Följ resultat", exact: true })).toBeVisible();

  await anonymousContext.close();
  await participantContext.close();
  await freshContext.close();
  await ownerContext.close();
});
