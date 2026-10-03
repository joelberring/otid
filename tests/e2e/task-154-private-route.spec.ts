import { readFile, rm } from "node:fs/promises";
import { realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { randomUUID } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import { participantPrivateRouteDetailResponseSchema } from "@o-tid/contracts";
import { createDatabase, schema } from "@o-tid/database";
import { eq } from "drizzle-orm";

type Account = { loginName: string; password: string };
type Fixture = { owner: Account; other: Account };
const origin = "http://127.0.0.1:3154";
const sourceUrl = process.env.OTID_TASK154_SOURCE_DATABASE_URL;
const targetUrl = process.env.OTID_TASK154_DATABASE_URL;
const privateDirectory = process.env.OTID_TASK154_PRIVATE_DIRECTORY;
if (!sourceUrl || sourceUrl !== process.env.TEST_DATABASE_URL || !targetUrl || !privateDirectory) {
  throw new Error("TASK154 synthetic database configuration rejected");
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
  && /^otid-task154-private-route-e2e-[A-Za-z0-9]+$/.test(basename(privateDirectory)))) {
  throw new Error("TASK154 synthetic test target rejected");
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
      if (sessions.rows[0]?.count === "0") {
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
  const path = process.env.OTID_TASK154_CREDENTIALS_FILE;
  if (!path || !path.startsWith(`${privateDirectory}/`)) throw new Error("TASK154 private account fixture missing");
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

async function createClaim(ownerPage: Page, participantPage: Page, owner: Account, participant: Account, eventName: string): Promise<string> {
  await ownerPage.goto("/");
  await ownerPage.getByRole("link", { name: "Mina tävlingar · Skapa tävling", exact: true }).click();
  await ownerPage.getByLabel("Inloggningsnamn", { exact: true }).fill(owner.loginName);
  await ownerPage.getByLabel("Lösenord", { exact: true }).fill(owner.password);
  await ownerPage.getByRole("button", { name: "Logga in", exact: true }).click();
  await expect(ownerPage.getByText("Dina tävlingar", { exact: true })).toBeVisible();
  await ownerPage.getByLabel("Eventnamn", { exact: true }).fill(eventName);
  await ownerPage.getByLabel("Loppets namn", { exact: true }).fill("C2a-loppet");
  await ownerPage.getByLabel("Datum", { exact: true }).fill("2026-10-03");
  const [created] = await Promise.all([
    ownerPage.waitForResponse(response => response.url().endsWith("/api/organizer/events") && response.request().method() === "POST"),
    ownerPage.getByRole("button", { name: "Skapa tävling", exact: true }).click()
  ]);
  expect(created.status()).toBe(201);
  const event = await created.json() as { raceId: string };
  await ownerPage.getByRole("button", { name: "Öppna tävling", exact: true }).click();
  await ownerPage.getByText("Förbered bana och klass", { exact: true }).click();
  await ownerPage.getByLabel("Bannamn", { exact: true }).fill("C2a-testbana");
  await ownerPage.getByLabel("Klassnamn", { exact: true }).fill("H21 C2a");
  await ownerPage.getByLabel("Kontrollföljd", { exact: true }).fill("41");
  await ownerPage.getByRole("button", { name: "Granska bana och klass", exact: true }).click();
  await ownerPage.getByRole("button", { name: "Bekräfta och spara", exact: true }).click();
  await ownerPage.getByRole("button", { name: "Ny deltagare", exact: true }).click();
  await ownerPage.getByRole("combobox", { name: "Anmälningsklass", exact: true }).selectOption({ label: "H21 C2a" });
  await ownerPage.getByLabel("Förnamn", { exact: true }).fill("Ada");
  await ownerPage.getByLabel("Efternamn", { exact: true }).fill("C2a-löpare");
  await ownerPage.getByLabel("Bricknummer (valfritt)", { exact: true }).fill("88900154");
  await ownerPage.getByRole("button", { name: "Granska anmälan", exact: true }).click();
  await ownerPage.getByRole("button", { name: "Bekräfta anmälan", exact: true }).click();
  await expect(ownerPage.getByRole("heading", { name: "Koppla deltagarens konto", exact: true })).toBeVisible();
  await ownerPage.getByLabel("Jag har kontrollerat mottagarens identitet utanför systemet.", { exact: true }).check();
  await ownerPage.getByRole("button", { name: "Skapa engångskod", exact: true }).click();
  const code = (await ownerPage.locator(".participant-claim-admin output").textContent())?.trim();
  expect(code).toMatch(/^[A-Za-z0-9_-]{21}[AQgw]$/);
  await loginAccount(participantPage, participant);
  await participantPage.getByLabel("Engångskod från arrangören", { exact: true }).fill(code!);
  await participantPage.getByRole("button", { name: "Koppla anmälan", exact: true }).click();
  await expect(participantPage.getByText("Anmälan är kopplad till ditt konto.", { exact: true })).toBeVisible();
  return event.raceId;
}

async function seedStoredRoute(raceId: string): Promise<string> {
  const [entry] = await db.select({ id: schema.entries.id }).from(schema.entries)
    .where(eq(schema.entries.familyName, "C2a-löpare"));
  if (!entry) throw new Error("Synthetic TASK154 entry missing");
  const [claim] = await db.select({ issuerCredentialId: schema.participantEntryClaimIssues.issuerCredentialId })
    .from(schema.participantEntryClaimIssues).where(eq(schema.participantEntryClaimIssues.entryId, entry.id));
  if (!claim) throw new Error("Synthetic TASK154 claim issuer missing");
  const now = new Date("2026-10-03T10:30:00.000Z");
  const grantId = randomUUID(), uploadId = randomUUID(), attemptId = randomUUID();
  const sha256 = "a".repeat(64), byteLength = 128, mediaType = "application/gpx+xml";
  const [race] = await db.select({ id: schema.races.id }).from(schema.races).where(eq(schema.races.id, raceId));
  if (!race) throw new Error("Synthetic TASK154 race missing");
  await db.insert(schema.routeUploadGrants).values({
    id: grantId, requestId: randomUUID(), raceId, entryId: entry.id,
    issuerCredentialId: claim.issuerCredentialId, capability: "MANAGE_RACE", secretHash: "b".repeat(64),
    issuedAt: now, expiresAt: new Date("2026-10-04T10:30:00.000Z")
  });
  await db.insert(schema.routeUploadReservations).values({
    id: uploadId, requestId: randomUUID(), grantId, raceId, entryId: entry.id,
    fileName: "privat-syntetisk.gpx", mediaType, sha256, byteLength, reservedAt: now
  });
  await db.insert(schema.routeUploadAttempts).values({
    id: attemptId, uploadId, grantId, raceId, entryId: entry.id, attemptNumber: 1,
    mediaType, sha256, byteLength, chargedAt: now
  });
  await db.insert(schema.routeObjectManifests).values({
    uploadId, attemptId, grantId, raceId, entryId: entry.id, storeId: randomUUID(),
    objectKey: `route/${raceId}/${attemptId}`, versionId: "synthetic-version-1", mediaType, sha256, byteLength,
    pointCount: 2, segmentCount: 1, firstRecordedAt: new Date("2026-10-03T10:00:00.000Z"),
    lastRecordedAt: new Date("2026-10-03T10:10:00.000Z"), parser: "otid-gpx-1.1", storedAt: now
  });
  await db.insert(schema.routePoints).values([
    { uploadId, sequence: 0, segment: 0, latitude: 59.3, longitude: 18.0, elevationMeters: null, recordedAt: new Date("2026-10-03T10:00:00.000Z") },
    { uploadId, sequence: 1, segment: 0, latitude: 59.3, longitude: 18.001, elevationMeters: null, recordedAt: new Date("2026-10-03T10:10:00.000Z") }
  ]);
  return uploadId;
}

test("TASK154: only the claimed account can read its selected private GPX facts", async ({ browser }) => {
  const accounts = await fixture();
  const runSuffix = (process.env.OTID_TASK154_RUN_ID ?? "").slice(0, 8);
  const ownerContext = await browser.newContext({ baseURL: origin, viewport: { width: 390, height: 844 } });
  const ownerPage = await ownerContext.newPage();
  const participantContext = await browser.newContext({ baseURL: origin, viewport: { width: 390, height: 844 } });
  const participantPage = await participantContext.newPage();
  const raceId = await createClaim(ownerPage, participantPage, accounts.owner, accounts.other, `TASK154 C2a ${runSuffix}`);
  const routeUploadId = await seedStoredRoute(raceId);

  await participantPage.goto("/me");
  const privateRoutes = participantPage.getByRole("heading", { name: "Mina privata GPX-rutter", exact: true }).locator("..");
  await expect(privateRoutes.getByRole("link", { name: "Visa sparad version", exact: true })).toBeVisible();
  await privateRoutes.getByRole("link", { name: "Visa sparad version", exact: true }).click();
  await expect(participantPage).toHaveURL(`/me/routes/${routeUploadId}`);
  await expect(participantPage.getByRole("heading", { name: "Privat GPX-version", exact: true })).toBeVisible();
  await expect(participantPage.getByText("Summerad spårlängd", { exact: true })).toBeVisible();
  await expect(participantPage.locator("dd").filter({ hasText: /km$/ })).toHaveText(/0,06 km/);
  await expect(participantPage.locator("dd").filter({ hasText: /10 min 0 s/ })).toBeVisible();
  await expect(participantPage.getByText("Kart- och banpassning är inte verifierad ännu.", { exact: false })).toBeVisible();
  const ownedDetail = await participantPage.evaluate(async id => {
    const response = await fetch(`/api/participant/me/routes/${id}`, { cache: "no-store" });
    return { status: response.status, cache: response.headers.get("cache-control"), bodyText: await response.text() };
  }, routeUploadId);
  expect(ownedDetail.status).toBe(200);
  expect(ownedDetail.cache).toContain("no-store");
  const detail = participantPrivateRouteDetailResponseSchema.parse(JSON.parse(ownedDetail.bodyText) as unknown);
  expect(detail.metadata.distanceMeters).toBeGreaterThan(55);
  expect(detail.metadata.distanceMeters).toBeLessThan(58);
  if (detail.metadata.timing.status !== "AVAILABLE") throw new Error("Synthetic TASK154 timing should be available");
  expect(detail.metadata.timing.durationMilliseconds).toBe(600_000);
  expect(ownedDetail.bodyText).not.toMatch(/latitude|longitude|objectKey|versionId|entryId|grantId/i);
  await hasNoHorizontalOverflow(participantPage);

  const freshContext = await browser.newContext({ baseURL: origin, viewport: { width: 390, height: 844 } });
  const freshPage = await freshContext.newPage();
  await loginAccount(freshPage, accounts.other);
  const freshRoutes = freshPage.getByRole("heading", { name: "Mina privata GPX-rutter", exact: true }).locator("..");
  await expect(freshRoutes.getByRole("link", { name: "Visa sparad version", exact: true })).toBeVisible();
  await freshRoutes.getByRole("link", { name: "Visa sparad version", exact: true }).click();
  await expect(freshPage).toHaveURL(`/me/routes/${routeUploadId}`);
  await expect(freshPage.locator("dd").filter({ hasText: /10 min 0 s/ })).toBeVisible();
  await hasNoHorizontalOverflow(freshPage);

  const otherContext = await browser.newContext({ baseURL: origin, viewport: { width: 390, height: 844 } });
  const otherPage = await otherContext.newPage();
  await loginAccount(otherPage, accounts.owner);
  const otherResponse = await otherPage.request.get(`/api/participant/me/routes/${routeUploadId}`);
  expect(otherResponse.status()).toBe(404);
  await otherPage.goto(`/me/routes/${routeUploadId}`);
  await expect(otherPage.getByRole("status")).toContainText("kunde inte hämtas");

  const anonymousContext = await browser.newContext({ baseURL: origin, viewport: { width: 390, height: 844 } });
  const anonymousPage = await anonymousContext.newPage();
  const anonymousResponse = await anonymousPage.request.get(`/api/participant/me/routes/${routeUploadId}`);
  expect([401, 404]).toContain(anonymousResponse.status());
  await anonymousPage.goto(`/me/routes/${routeUploadId}`);
  await expect(anonymousPage.getByRole("status")).toContainText("kunde inte hämtas");
  await hasNoHorizontalOverflow(otherPage);
  await hasNoHorizontalOverflow(anonymousPage);

  await anonymousContext.close();
  await otherContext.close();
  await freshContext.close();
  await participantContext.close();
  await ownerContext.close();
});
