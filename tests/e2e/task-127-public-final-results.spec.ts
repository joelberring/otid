import { createHash, randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { createDatabase, schema } from "@o-tid/database";

const database = process.env.TEST_DATABASE_URL;
if (!database || database !== process.env.DATABASE_URL) throw new Error("Explicit matching isolated database required");
const { db, pool } = createDatabase(database);
const hash = "a".repeat(64);

test.afterAll(async () => pool.end());

async function createFrozenResult() {
  const eventId = randomUUID(), raceId = randomUUID(), actorCredentialId = randomUUID(), finalizationId = randomUUID();
  const finalizedAt = new Date("2026-09-21T14:30:00.000Z"), completeXml = "<ResultList status=\"Complete\" />";
  await db.insert(schema.events).values({ id: eventId, name: "Live eventnamn", startsOn: "2026-09-21", timeZone: "Europe/Stockholm" });
  await db.insert(schema.races).values({ id: raceId, eventId, name: "Långdistans", raceDate: "2026-09-21" });
  await db.insert(schema.pairingAdminAccessCredentials).values({
    id: actorCredentialId, raceId, capability: "FINALIZE_RESULTS", label: "TASK127 browser", secretHash: hash,
    issuedAt: new Date("2026-09-21T14:00:00.000Z"), expiresAt: new Date("2026-09-21T15:00:00.000Z")
  });
  await db.insert(schema.resultFinalizations).values({
    id: finalizationId, requestId: randomUUID(), raceId, scope: "RACE", classId: null, scopeRevision: 1,
    sourceSnapshotVersion: 1, sourceHash: hash, completeXml,
    completeXmlHash: createHash("sha256").update(completeXml).digest("hex"), actorCredentialId, finalizedAt,
    frozenProjection: { formatVersion: 9, scope: "RACE", raceId, snapshotVersion: 1, basisSha256: hash,
      eventName: "Skärgårdshelgen lång", classes: [{ classFinalizationId: randomUUID(), classFinalizationRevision: 1,
        classBasisSha256: hash, classId: randomUUID(), class: { name: "H21", externalId: null, results: [{
          source: { entryId: randomUUID(), resultRevisionId: randomUUID(), revision: 1, courseVersionId: randomUUID(), kind: "READOUT_RESULT", readoutId: randomUUID() },
          personResult: { entryExternalId: null, givenName: "Ada", familyName: "Löpare", organisationName: "Centrum OK",
            startTime: "2026-09-21T10:00:00.000Z", finishTime: "2026-09-21T10:30:00.000Z", elapsedMs: 1_800_000,
            position: 1, timeBehindMs: 0, expectedControls: [], splits: [], status: "OK", manualApprovalProof: null }
        }] } }] }
  });
  return { raceId, finalizationId };
}

test("TASK127 explicit public final result is frozen and compact at 390px", async ({ page, request }) => {
  const { raceId, finalizationId } = await createFrozenResult();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/results/${raceId}/finalizations/${finalizationId}`);
  await expect(page.getByRole("heading", { name: "Skärgårdshelgen lång", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Fastställda slutresultat", exact: true })).toBeVisible();
  await expect(page.locator(".public-result-participant").filter({ hasText: "Ada Löpare" })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  const response = await request.get(`/api/public/races/${raceId}/finalizations/${finalizationId}/results`);
  expect(response.status()).toBe(200);
  expect(response.headers()["cache-control"]).toBe("public, max-age=31536000, immutable");
  const body = await response.text();
  expect(JSON.parse(body)).toEqual({ formatVersion: 1, eventName: "Skärgårdshelgen lång", finalizedAt: "2026-09-21T14:30:00.000Z", results: [{
    className: "H21", givenName: "Ada", familyName: "Löpare", organisationName: "Centrum OK", status: "OK", elapsedMs: 1_800_000, position: 1, timeBehindMs: 0
  }] });
  expect(body).not.toMatch(/entryId|resultRevisionId|sourceHash|completeXml|decisionId|split/i);
  await page.goto(`/results/${raceId}`);
  await expect(page.getByRole("link", { name: "Visa fastställda slutresultat", exact: true })).toHaveAttribute("href", `/results/${raceId}/finalizations/${finalizationId}`);
});
