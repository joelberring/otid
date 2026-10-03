import { expect, test } from "@playwright/test";
import { entryTransferCandidatesSchema, resultFinalizationCandidateResponseSchema } from "@o-tid/contracts";

const raceId = "10000000-0000-4000-8000-000000000001";
const classId = "20000000-0000-4000-8000-000000000001";
const courseVersionId = "30000000-0000-4000-8000-000000000001";
const entryId = "40000000-0000-4000-8000-000000000001";
const roster = entryTransferCandidatesSchema.parse({
  formatVersion: 2, raceId, eventName: "Syntetisk tävling", raceName: "Lång", snapshotVersion: 2,
  raceDate: "2026-09-27", generatedAt: "2026-09-27T10:00:00.000Z", timeZone: "Europe/Stockholm",
  classes: [{ id: classId, name: "H21", courseVersionId, courseName: "Långbanan", courseVersion: 1,
    startRule: "PUNCH", maxEntries: null, capacityVersion: 1, entryCount: 1 }],
  entries: [{ id: entryId, displayName: "Ada Exempel", organisationName: "Syntetiska OK", classId, version: 1,
    paymentStatus: "PAID", paymentStatusVersion: 1, resultFreshness: "CURRENT_SNAPSHOT",
    effectiveResult: { state: "ACTIVE_RESULT", selectedRevision: {
      id: "50000000-0000-4000-8000-000000000001", revision: 1 }, resultSnapshotVersion: 2,
    result: { revision: 1, status: "OK", reason: "COMPLETE", elapsedMs: 240_000 } },
    resultRevisionMarker: null, fixedStartTime: null, activeAssignment: null, multipleActiveAssignments: false }]
});
const candidates = resultFinalizationCandidateResponseSchema.parse({
  formatVersion: 1, raceId, snapshotVersion: 2,
  race: { entryCount: 1, nonEmptyClassCount: 1, unresolvedUnknownCardReadoutCount: 0,
    blockerCodes: [], basisHash: "a".repeat(64), latestFinalization: null },
  classes: [{ classId, className: "H21", entryCount: 1, blockerCodes: [],
    basisHash: "b".repeat(64), latestFinalization: null }]
});

test("TASK225 TASK226 Efter ordnar omberäkning, fastställande och export med osäker retry", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const writes: Array<{ key: string | null; body: string | null }> = [];
  await page.route("**/api/**", async route => {
    const path = new URL(route.request().url()).pathname;
    if (path === `/api/admin/races/${raceId}/administrator/session`) {
      return route.request().method() === "POST"
        ? route.fulfill({ status: 200, json: { formatVersion: 1, raceId, capability: "MANAGE_RACE",
          expiresAt: new Date(Date.now() + 3_600_000).toISOString() } })
        : route.fulfill({ status: 401, json: { error: "UNAUTHORIZED" } });
    }
    if (path === `/api/admin/races/${raceId}/administrator/transfer-candidates`) {
      return route.fulfill({ status: 200, json: roster });
    }
    if (path === `/api/admin/races/${raceId}/administrator/finalization-candidates`) {
      return route.fulfill({ status: 200, json: candidates });
    }
    if (path === `/api/admin/races/${raceId}/administrator/finalize`) {
      writes.push({ key: route.request().headers()["idempotency-key"] ?? null, body: route.request().postData() });
      return route.fulfill({ status: 503, json: { error: "UNAVAILABLE" } });
    }
    return route.abort();
  });
  await page.goto(`/admin/${raceId}/manage`);
  await page.getByLabel("Administratörsbehörighet", { exact: true })
    .fill(`otid_org_race_admin_v1.${raceId}.${"a".repeat(43)}`);
  await page.getByRole("button", { name: "Logga in", exact: true }).click();
  await page.getByRole("navigation", { name: "Arbetslägen" })
    .getByRole("button", { name: "Efter tävlingen" }).click();

  const finalization = page.getByRole("region", { name: "Fastställ resultat", exact: true });
  const recalculationSummary = page.locator("summary").filter({ hasText: "Räkna om flera resultat" });
  const exportSummary = page.locator("summary").filter({ hasText: "Resultatexport · IOF 3.0" });
  await expect(recalculationSummary).toBeVisible();
  await expect(finalization.getByRole("heading", { name: "Fastställ resultat" })).toBeVisible();
  const load = finalization.getByRole("button", { name: "Hämta finaliseringsunderlag" });
  await expect(load).toBeVisible();
  expect((await load.boundingBox())?.height).toBeGreaterThanOrEqual(44);
  const recalculationBox = await recalculationSummary.boundingBox();
  expect(recalculationBox && recalculationBox.height >= 44 && recalculationBox.height <= 60).toBe(true);
  await expect(exportSummary).toBeVisible();
  await expect(page.getByRole("button", { name: "Ladda ner aktuell IOF-resultatlista" })).toBeHidden();
  const finalizationBox = await finalization.boundingBox(), exportBox = await exportSummary.boundingBox();
  expect(recalculationBox && finalizationBox && exportBox &&
    recalculationBox.y < finalizationBox.y && finalizationBox.y < exportBox.y).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: test.info().outputPath("after-mobile.png"), fullPage: true });
  await recalculationSummary.click();
  await expect(page.getByText("Välj en klass och markera 1–100 tekniskt redo deltagare", { exact: false })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Räkna om flera resultat", exact: true })).toHaveCount(0);
  await page.screenshot({ path: test.info().outputPath("after-recalculation-mobile.png"), fullPage: true });
  await recalculationSummary.click();

  await load.click();
  await expect(finalization.getByRole("button", { name: "Granska fastställande" })).toBeEnabled();
  await finalization.getByRole("button", { name: "Granska fastställande" }).click();
  await page.context().addCookies([{ name: "otid_race_administrator_csrf", value: "c".repeat(43),
    url: test.info().project.use.baseURL as string }]);
  const review = finalization.getByRole("alert", { name: "Granska fastställande" });
  await expect(review).toBeVisible();
  await review.getByRole("button", { name: "Bekräfta fastställande" }).click();
  await expect(review).toContainText("Svaret saknas. Resultaten kan vara fastställda.");
  await review.getByRole("button", { name: "Försök igen" }).click();
  await expect.poll(() => writes.length).toBe(2);
  expect(writes[0]).toEqual(writes[1]);

  await page.setViewportSize({ width: 1280, height: 800 });
  await expect(finalization).toBeVisible();
  await expect(exportSummary).toBeVisible();
  expect((await review.boundingBox())?.width).toBeLessThanOrEqual(900);
  expect((await review.getByRole("button", { name: "Försök igen" }).boundingBox())?.width).toBeLessThan(300);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: test.info().outputPath("after-desktop.png"), fullPage: true });
});
