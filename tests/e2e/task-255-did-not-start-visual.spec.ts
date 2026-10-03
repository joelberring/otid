import { expect, test } from "@playwright/test";
import { DID_NOT_START_DECISION_POLICY_VERSION, didNotStartCandidateResponseSchema } from "@o-tid/contracts";

const raceId = "10000000-0000-4000-8000-000000000001";
const classId = "20000000-0000-4000-8000-000000000001";
const courseVersionId = "20000000-0000-4000-8000-000000000002";
const identifier = (prefix: string, index: number) =>
  `${prefix}-0000-4000-8000-${(index + 1).toString(16).padStart(12, "0")}`;

const candidates = didNotStartCandidateResponseSchema.parse({ formatVersion: 1, raceId,
  snapshotVersion: 7, decisionPolicyVersion: DID_NOT_START_DECISION_POLICY_VERSION,
  entries: Array.from({ length: 8 }, (_, index) => ({
    id: identifier("30000000", index), displayName: `Löpare ${index + 1}`,
    organisationName: index % 2 === 0 ? "Centrum OK" : null, classId,
    className: index % 2 === 0 ? "D21" : "H21", courseVersionId, entryVersion: 2,
    readiness: index % 4 === 0 ? "READY" : "HAS_RESULT",
    latestResultRevision: index % 4 === 0 ? null : {
      id: identifier("60000000", index), revision: 1, status: "OK", reason: "COMPLETE",
      createdAt: "2026-09-27T10:00:00.000Z", snapshotVersion: 7
    }
  })) });

test("TASK255: tät Ej start-lista och fryst retry vid 1366/390 px", async ({ page, context }) => {
  await context.addCookies([{ name: "otid_did_not_start_admin_csrf", value: "c".repeat(43),
    url: "http://127.0.0.1:3127" }]);
  const attempts: { key: string | undefined; body: string | null }[] = [];
  let releaseFirstRequest: (() => void) | undefined;
  await page.route("**/api/**", async route => {
    const request = route.request(), path = new URL(request.url()).pathname;
    if (path === `/api/admin/races/${raceId}/did-not-start-candidates` && request.method() === "GET") {
      return route.fulfill({ status: 200, json: candidates });
    }
    if (path === `/api/admin/races/${raceId}/entries/${candidates.entries[0]!.id}/did-not-start` && request.method() === "POST") {
      attempts.push({ key: request.headers()["idempotency-key"], body: request.postData() });
      if (attempts.length === 1) await new Promise<void>(resolve => { releaseFirstRequest = resolve; });
      return route.abort();
    }
    return route.abort();
  });

  await page.setViewportSize({ width: 1366, height: 768 });
  await page.goto(`/admin/${raceId}/did-not-start`);
  const entries = page.locator("article.did-not-start-entry");
  await expect(entries).toHaveCount(8);
  await expect(entries.nth(1).getByRole("button", { name: "Markera som ej startad" })).toBeDisabled();
  await expect(entries.nth(1)).toContainText("Har redan resultat");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: test.info().outputPath("did-not-start-desktop.png"), fullPage: true });

  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(await entries.first().getByRole("button", { name: "Markera som ej startad" })
    .evaluate(element => element.getBoundingClientRect().height)).toBeGreaterThanOrEqual(52);
  await page.screenshot({ path: test.info().outputPath("did-not-start-mobile.png"), fullPage: true });

  await entries.first().getByRole("button", { name: "Markera som ej startad" }).click();
  await expect.poll(() => attempts.length).toBe(1);
  await expect(page.locator("section.did-not-start-retry[role='alert']")).toHaveCount(0);
  releaseFirstRequest?.();
  await expect(page.locator("section.did-not-start-retry[role='alert']")).toBeVisible();
  const retryVisible = await page.locator("section.did-not-start-retry").evaluate(element => {
    const bounds = element.getBoundingClientRect();
    return bounds.top >= 0 && bounds.top < innerHeight;
  });
  expect(retryVisible).toBe(true);
  await page.screenshot({ path: test.info().outputPath("did-not-start-retry-viewport.png") });
  await page.getByRole("button", { name: "Försök igen med samma request-id" }).click();
  await expect.poll(() => attempts.length).toBe(2);
  expect(attempts[1]).toEqual(attempts[0]);
});
