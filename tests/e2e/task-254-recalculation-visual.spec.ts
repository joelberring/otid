import { expect, test } from "@playwright/test";
import { resultRecalculationCandidateResponseSchema } from "@o-tid/contracts";

const raceId = "10000000-0000-4000-8000-000000000001";
const classId = "20000000-0000-4000-8000-000000000001";
const identifier = (prefix: string, index: number) => `${prefix}-0000-4000-8000-${(index + 1).toString(16).padStart(12, "0")}`;
const candidates = resultRecalculationCandidateResponseSchema.parse({ formatVersion: 1, raceId,
  snapshotVersion: 7, engineVersion: "synthetic-engine", entries: Array.from({ length: 8 }, (_, index) => {
    const readiness = (["READY", "NO_READOUT", "NO_ACTIVE_ASSIGNMENT", "MULTIPLE_ACTIVE_ASSIGNMENTS"] as const)[index % 4];
    return { id: identifier("30000000", index), displayName: `Löpare ${index + 1}`,
      organisationName: index % 2 === 0 ? "Centrum OK" : null, classId, className: "D21", entryVersion: 2,
      readiness, cardAssignmentId: readiness === "READY" || readiness === "NO_READOUT"
        ? identifier("40000000", index) : null,
      latestReadout: readiness === "READY" ? { id: identifier("50000000", index), readAt: "2026-09-27T10:00:00.000Z" } : null,
      latestResultRevision: index === 0 ? { id: identifier("60000000", index), revision: 1,
        status: "OK", reason: "COMPLETE", cause: "CARD_READOUT", createdAt: "2026-09-27T10:01:00.000Z",
        snapshotVersion: 7 } : null };
  }) });

test("TASK254: tät omräkningslista och fryst retry vid 1366/390 px", async ({ page, context }) => {
  await context.addCookies([{ name: "otid_recalculation_admin_csrf", value: "c".repeat(43),
    url: "http://127.0.0.1:3127" }]);
  const attempts: { key: string | undefined; body: string | null }[] = [];
  await page.route("**/api/**", route => {
    const request = route.request(), path = new URL(request.url()).pathname;
    if (path === `/api/admin/races/${raceId}/recalculation-candidates` && request.method() === "GET") {
      return route.fulfill({ status: 200, json: candidates });
    }
    if (path === `/api/races/${raceId}/entries/${candidates.entries[0]!.id}/recalculate` && request.method() === "POST") {
      attempts.push({ key: request.headers()["idempotency-key"], body: request.postData() });
      return route.abort();
    }
    return route.abort();
  });
  await page.setViewportSize({ width: 1366, height: 768 });
  await page.goto(`/admin/${raceId}/recalculation`);
  const entries = page.locator("article.result-recalculation-entry");
  await expect(entries).toHaveCount(8);
  await expect(entries.nth(1).getByRole("button", { name: "Räkna om och publicera ny revision" })).toBeDisabled();
  await expect(entries.nth(1)).toContainText("avläsning saknas");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: test.info().outputPath("recalculation-desktop.png"), fullPage: true });

  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const actionHeight = await entries.first().getByRole("button", { name: "Räkna om och publicera ny revision" })
    .evaluate(element => element.getBoundingClientRect().height);
  expect(actionHeight).toBeGreaterThanOrEqual(52);
  await page.screenshot({ path: test.info().outputPath("recalculation-mobile.png"), fullPage: true });

  await entries.first().getByRole("button", { name: "Räkna om och publicera ny revision" }).click();
  await expect(page.getByRole("button", { name: "Försök igen med samma omräkning" })).toBeVisible();
  await expect(page.locator("section.result-recalculation-retry[role='alert']"))
    .toContainText("Omräkningens status är inte bekräftad");
  const retryVisible = await page.locator("section.result-recalculation-retry").evaluate(element => {
    const bounds = element.getBoundingClientRect();
    return bounds.top >= 0 && bounds.top < innerHeight;
  });
  expect(retryVisible).toBe(true);
  await page.screenshot({ path: test.info().outputPath("recalculation-retry-viewport.png") });
  await page.getByRole("button", { name: "Försök igen med samma omräkning" }).click();
  await expect.poll(() => attempts.length).toBe(2);
  expect(attempts[1]).toEqual(attempts[0]);
  await page.screenshot({ path: test.info().outputPath("recalculation-retry-mobile.png"), fullPage: true });
});
