import { expect, test } from "@playwright/test";
import { readoutHistoryDetailResponseSchema, readoutHistoryListResponseSchema } from "@o-tid/contracts";

const raceId = "10000000-0000-4000-8000-000000000001";
const entryId = "20000000-0000-4000-8000-000000000001";
const classId = "30000000-0000-4000-8000-000000000001";
const courseVersionId = "40000000-0000-4000-8000-000000000001";
const readoutId = "50000000-0000-4000-8000-000000000001";
const endpoint = `/api/admin/races/${raceId}/readouts`;
const startTime = "2026-09-29T08:00:00.000Z";
const finishTime = "2026-09-29T08:30:00.000Z";
const readAt = "2026-09-29T08:31:00.000Z";
const assessment = { status: "MP", reason: "MISSING_CONTROL", engineVersion: "test-v1",
  snapshotVersion: 7, courseVersionId };
const items = Array.from({ length: 12 }, (_, index) => ({
  id: `50000000-0000-4000-8000-${(index + 1).toString(16).padStart(12, "0")}`,
  cardNumber: String(800001 + index), readAt,
  entry: index === 1 ? null : { id: entryId, displayName: index === 0 ? "Löpare Ett" : `Löpare ${index + 1}` },
  firstServerAssessment: index === 1 ? { ...assessment, status: "UNKNOWN_CARD", reason: "UNKNOWN_CARD",
    courseVersionId: null } : index === 2 ? null : assessment
}));
const list = readoutHistoryListResponseSchema.parse({ formatVersion: 1, raceId, items,
  nextCursor: "older_readouts" });
const revisions = [1, 2].map(revision => ({
  id: `60000000-0000-4000-8000-${String(revision).padStart(12, "0")}`,
  revision, readoutId, cause: revision === 1 ? "CARD_READOUT" : "EXPLICIT_RECALCULATION",
  ...assessment, published: revision === 1, createdAt: readAt,
  evaluation: { status: "MP", reason: "MISSING_CONTROL", entryId, classId, courseVersionId,
    startTime, finishTime, elapsedMs: 1_800_000, missingControls: [32], extraPunches: [99],
    splits: [{ controlCode: 31, occurrence: 1, elapsedMs: 60_000, legMs: 60_000 },
      { controlCode: 31, occurrence: 2, elapsedMs: 120_000, legMs: 60_000 }] }
}));
const detail = readoutHistoryDetailResponseSchema.parse({ formatVersion: 1, raceId,
  readout: { id: readoutId, cardNumber: "800001", readAt, startPunchedAt: startTime,
    finishPunchedAt: finishTime, punches: [
      { code: 31, punchedAt: "2026-09-29T08:01:00.000Z" },
      { code: 31, punchedAt: "2026-09-29T08:02:00.000Z" },
      { code: 99, punchedAt: "2026-09-29T08:03:00.000Z" }
    ] }, entry: items[0]!.entry, firstServerAssessment: assessment,
  history: { upperRevision: 2, items: revisions.slice(0, 1), nextCursor: "next_revision" }
});
const nextDetail = readoutHistoryDetailResponseSchema.parse({ ...detail,
  history: { upperRevision: 2, items: revisions.slice(1), nextCursor: null } });
const unknownDetail = readoutHistoryDetailResponseSchema.parse({ ...detail,
  readout: { ...detail.readout, id: items[1]!.id, cardNumber: "800002", startPunchedAt: null, punches: [] },
  entry: null, firstServerAssessment: items[1]!.firstServerAssessment,
  history: { upperRevision: 0, items: [], nextCursor: null } });

test("TASK269: neutral läsande avläsningslista och bevarade revisioner vid 1366/390 px", async ({ page, context }) => {
  await context.addCookies([{ name: "otid_readout_result_history_csrf", value: "c".repeat(43),
    url: "http://127.0.0.1:3127" }]);
  const reads: string[] = [], writes: string[] = [];
  await page.route("**/api/**", async route => {
    const request = route.request(), url = new URL(request.url());
    if (request.method() !== "GET") {
      writes.push(request.method());
      return route.abort(); // An unconfirmed logout must still clear local private data.
    }
    reads.push(`${url.pathname}${url.search}`);
    if (url.pathname === endpoint) return route.fulfill({ json: url.searchParams.has("cursor")
      ? readoutHistoryListResponseSchema.parse({ ...list, items: [{ ...items[0]!,
        id: "50000000-0000-4000-8000-000000000013", cardNumber: "800013",
        entry: { id: entryId, displayName: "Löpare 13" } }], nextCursor: null }) : list });
    if (url.pathname === `${endpoint}/${readoutId}`) return route.fulfill({ json:
      url.searchParams.has("cursor") ? nextDetail : detail });
    if (url.pathname === `${endpoint}/${items[1]!.id}`) return route.fulfill({ json: unknownDetail });
    return route.abort();
  });
  await page.setViewportSize({ width: 1366, height: 768 });
  await page.goto(`/admin/${raceId}/history`);
  const rows = page.locator(".readout-history-list > article");
  await expect(rows).toHaveCount(12);
  await expect(rows.first()).toContainText("MP · MISSING_CONTROL");
  await expect(rows.nth(1)).toContainText("UNKNOWN_CARD");
  await expect(rows.nth(2)).toContainText("Första serverbedömning saknas");
  // Next dev may replay the initial effect; no cursor page is loaded automatically.
  expect(reads.length).toBeGreaterThanOrEqual(1);
  expect(reads.every(path => path === endpoint)).toBe(true);
  expect(writes).toEqual([]);
  expect(await page.locator("body > header").evaluate(element => getComputedStyle(element).backgroundColor))
    .toBe("rgb(247, 248, 248)");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: test.info().outputPath("history-desktop-list.png") });

  await rows.first().getByRole("button", { name: "Visa avläsning och historik" }).click();
  const selected = page.getByLabel("Vald avläsning och revisionskedja", { exact: true });
  await expect(selected).toContainText("Löpare Ett");
  expect(await selected.locator("h2").evaluate(element => element === document.activeElement)).toBe(true);
  await expect(selected.locator(".readout-history-revision")).toHaveCount(1);
  await expect(selected).toContainText("CARD_READOUT");
  await expect(selected).toContainText("Saknade kontroller: 32");
  await expect(selected).toContainText("Extra stämplingar: 99");
  await selected.locator("summary").click();
  await expect(selected).toContainText("31 (1)");
  await expect(selected).toContainText("31 (2)");
  await page.screenshot({ path: test.info().outputPath("history-desktop-detail.png") });
  await page.getByRole("button", { name: "Visa äldre revisioner" }).click();
  await expect(selected.locator(".readout-history-revision")).toHaveCount(2);
  await expect(selected).toContainText("EXPLICIT_RECALCULATION");
  await expect(selected).toContainText("opublicerad");
  expect(await selected.locator("h2").evaluate(element => element === document.activeElement)).toBe(false);
  expect(reads.filter(path => path.includes("cursor=next_revision"))).toHaveLength(1);
  await page.getByRole("button", { name: "Visa äldre avläsningar" }).click();
  await expect(rows).toHaveCount(13);
  await expect(rows.last()).toContainText("Löpare 13");

  await page.setViewportSize({ width: 390, height: 844 });
  await rows.first().getByRole("button", { name: "Visa avläsning och historik" }).click();
  await expect(selected.locator(".readout-history-revision")).toHaveCount(1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(await rows.first().getByRole("button").evaluate(element => element.getBoundingClientRect().height))
    .toBeGreaterThanOrEqual(52);
  await page.screenshot({ path: test.info().outputPath("history-mobile-detail.png") });
  await rows.nth(1).getByRole("button", { name: "Visa avläsning och historik" }).click();
  await expect(selected).toContainText("Ingen resultatrevision finns för denna avläsning.");
  await expect(selected.locator(".readout-history-revision")).toHaveCount(0);
  expect(writes).toEqual([]);
  await page.getByRole("button", { name: "Logga ut från historiken" }).click();
  await expect(page.getByRole("heading", { name: "Utloggningen är inte bekräftad" })).toBeVisible();
  await expect(rows).toHaveCount(0);
  await expect(selected).toHaveCount(0);
  await expect(page.locator(".readout-history-admin")).not.toContainText("Löpare Ett");
  expect(writes).toEqual(["DELETE"]);
  expect(await page.evaluate(() => ({ local: Object.keys(localStorage), session: Object.keys(sessionStorage) })))
    .toEqual({ local: [], session: [] });
});
