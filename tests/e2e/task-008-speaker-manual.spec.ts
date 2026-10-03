import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { test, expect } from "@playwright/test";
import { createDatabase } from "@o-tid/database";
import {
  createEvent,
  decideDidNotStartAsAdmin,
  importIofXml,
  issuePairingAdminAccessCredential,
  listDidNotStartCandidatesAsAdmin,
  listDidNotStartWithdrawalsAsAdmin,
  loginPairingAdmin,
  withdrawDidNotStartAsAdmin
} from "@o-tid/application";

const url = process.env.TEST_DATABASE_URL;
if (!url || url !== process.env.DATABASE_URL) throw new Error("Isolerad matchande testdatabas krävs");
const { db, pool } = createDatabase(url);
test.afterAll(async () => pool.end());

type Capability = "VIEW_SPEAKER_BOARD" | "DECIDE_DID_NOT_START" | "WITHDRAW_DID_NOT_START";

async function admin(raceId: string, capability: Capability) {
  const issued = await issuePairingAdminAccessCredential(db, {
    raceId,
    capability,
    label: `TASK008 browser ${capability}`,
    expiresAt: new Date(Date.now() + 3_600_000)
  });
  const login = await loginPairingAdmin(db, { formatVersion: 1, accessCredential: issued.accessCredential }, {
    expectedRaceId: raceId,
    expectedCapability: capability
  });
  if (login.status !== "authenticated") throw new Error("Arrangörssession saknas");
  return {
    raceId,
    credentialId: issued.credentialId,
    accessCredential: issued.accessCredential,
    sessionToken: login.sessionToken,
    csrfCookie: login.csrfToken,
    csrfHeader: login.csrfToken
  };
}

test("TASK008 speaker pollar ett återtaget DNS utan ändrad tävlingsversion", async ({ page }, testInfo) => {
  await page.addInitScript(() => {
    window.addEventListener("pageshow", (event) => { Reflect.set(window, "__speakerPersisted", event.persisted); });
  });
  const { race } = await createEvent(db, {
    name: "Syntetiskt speaker-DNS-browserprov",
    raceName: "Lång",
    raceDate: "2026-08-30",
    timeZone: "Europe/Stockholm"
  });
  for (const file of ["course-data.xml", "entry-list.xml"]) {
    await importIofXml(db, race.id, await readFile(resolve("fixtures/iof", file), "utf8"));
  }

  const dns = await admin(race.id, "DECIDE_DID_NOT_START");
  const candidates = await listDidNotStartCandidatesAsAdmin(db, dns, new Date());
  if (candidates.status !== "ok") throw new Error("DNS-kandidater saknas");
  const candidate = candidates.response.entries.find((entry) => entry.displayName === "Ada Löpare");
  if (!candidate) throw new Error("Ada saknas som DNS-kandidat");
  const decided = await decideDidNotStartAsAdmin(db, {
    ...dns,
    entryId: candidate.id,
    idempotencyKey: `did-not-start:${crypto.randomUUID()}`,
    request: {
      formatVersion: 1,
      expectedEntryVersion: candidate.entryVersion,
      expectedClassId: candidate.classId,
      expectedCourseVersionId: candidate.courseVersionId,
      expectedSnapshotVersion: candidates.response.snapshotVersion,
      expectedLatestResultRevision: null,
      policyVersion: "did-not-start-v1"
    }
  }, new Date());
  expect(decided.status).toBe("decided");

  const speaker = await admin(race.id, "VIEW_SPEAKER_BOARD");
  await page.goto(`/admin/${race.id}/speaker`);
  await page.getByLabel("Speakerns behörighet").fill(speaker.accessCredential);
  await page.getByRole("button", { name: "Logga in", exact: true }).click();
  const row = page.getByRole("listitem").filter({ has: page.getByRole("heading", { name: "Ada Löpare", exact: true }) });
  await expect(row).toContainText("Ej start (DNS)");
  await expect(row).toContainText("Tid: Ingen tid");

  const selectedText = await row.getByText(/^Vald revision:/).textContent();
  const selectedBefore = selectedText?.match(/^Vald revision: \d+/)?.[0];
  const registeredBefore = await row.getByText(/^Underlag registrerat:/).textContent();
  const snapshotBefore = await page.getByText(/^Tävlingsversion:/).textContent();
  expect(selectedBefore).toBeTruthy();
  expect(registeredBefore).toBeTruthy();
  expect(snapshotBefore).toBeTruthy();

  const withdrawalAdmin = await admin(race.id, "WITHDRAW_DID_NOT_START");
  const withdrawals = await listDidNotStartWithdrawalsAsAdmin(db, withdrawalAdmin, new Date());
  if (withdrawals.status !== "ok") throw new Error("DNS-återtagandekandidater saknas");
  const withdrawal = withdrawals.response.entries.find((entry) => entry.id === candidate.id);
  if (!withdrawal || withdrawal.state !== "WITHDRAWABLE") throw new Error("DNS kan inte återtas");
  const withdrawn = await withdrawDidNotStartAsAdmin(db, {
    ...withdrawalAdmin,
    entryId: candidate.id,
    idempotencyKey: `did-not-start-withdrawal:${crypto.randomUUID()}`,
    request: {
      formatVersion: 1,
      expectedEntryVersion: withdrawal.entryVersion,
      expectedClassId: withdrawal.classId,
      expectedCourseVersionId: withdrawal.courseVersionId,
      expectedSnapshotVersion: withdrawals.response.snapshotVersion,
      expectedDidNotStartDecisionId: withdrawal.didNotStartDecisionId,
      expectedResultRevision: { id: withdrawal.targetResultRevision.id, revision: withdrawal.targetResultRevision.revision },
      policyVersion: "did-not-start-withdrawal-v1"
    }
  }, new Date());
  expect(withdrawn.status).toBe("withdrawn");

  await expect(row).toContainText("Inget aktivt resultat", { timeout: 12_000 });
  await expect(row).toContainText("Tid: Ingen tid");
  await expect(row).not.toContainText("Ej start (DNS)");
  await expect(row).toContainText(selectedBefore!);
  await expect(row.getByText(/^Underlag registrerat:/)).toHaveText(registeredBefore!);
  await expect(page.getByText(/^Tävlingsversion:/)).toHaveText(snapshotBefore!);
  await expect(row).not.toContainText("Effektiv revision:");
  // Real navigation, not synthetic PageTransitionEvent dispatch. Record whether
  // Chromium actually chose bfcache; normal reload must not count as that proof.
  await page.goto("/checkin/index.html");
  const freshResponses: string[] = [];
  page.on("response", response => {
    if (response.request().method() !== "GET") return;
    if (response.url().endsWith(`/api/admin/races/${race.id}/speaker-board-session`)) freshResponses.push(`session:${response.status()}`);
    if (response.url().endsWith(`/api/admin/races/${race.id}/speaker-board`)) freshResponses.push(`data:${response.status()}`);
  });
  await page.goBack();
  await expect(page).toHaveURL(new RegExp(`/admin/${race.id}/speaker$`));
  await expect.poll(() => page.evaluate(() => typeof Reflect.get(window, "__speakerPersisted"))).toBe("boolean");
  const persisted = await page.evaluate(() => Reflect.get(window, "__speakerPersisted") === true);
  console.info(`Speaker navigation: pageshow.persisted=${persisted}`);
  if (!persisted) console.info("Speaker navigation reasons:", await page.evaluate(() => {
    const navigation = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming & { notRestoredReasons?: unknown };
    return JSON.stringify(navigation?.notRestoredReasons ?? null);
  }));
  testInfo.annotations.push({ type: "bfcache", description: `pageshow.persisted=${persisted}` });
  await testInfo.attach("navigation-observation", { body: JSON.stringify({ persisted,
    navigation: await page.evaluate(() => performance.getEntriesByType("navigation").map(entry => entry.toJSON() as unknown)) }), contentType: "application/json" });
  if (persisted) {
    await expect(page.getByRole("heading", { name: "Ada Löpare", exact: true })).toHaveCount(0);
    await expect(page.getByLabel("Speakerns behörighet")).toBeVisible();
  } else {
    // Fresh navigation reauthenticates with the still-valid HttpOnly session.
    await expect(row).toContainText("Inget aktivt resultat");
    expect(freshResponses).toContain("session:200");
    expect(freshResponses).toContain("data:200");
    expect(freshResponses.indexOf("session:200")).toBeLessThan(freshResponses.indexOf("data:200"));
  }
  if (testInfo.project.name === "speaker-production" && !persisted) {
    const reasons = await page.evaluate(() => {
      const navigation = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming & {
        notRestoredReasons?: { reasons?: { reason: string }[] };
      };
      return navigation?.notRestoredReasons?.reasons?.map(item => item.reason) ?? [];
    });
    expect(reasons, "Ny laddning måste redovisas som no-store-inträdeshinder, inte bfcache-bevis (ADR-0060)")
      .toContain("response-cache-control-no-store");
  }
});
