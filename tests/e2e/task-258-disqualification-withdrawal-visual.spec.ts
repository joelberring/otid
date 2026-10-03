import { expect, test } from "@playwright/test";
import {
  RESULT_DISQUALIFICATION_WITHDRAWAL_POLICY_VERSION,
  resultDisqualificationWithdrawalListResponseSchema
} from "@o-tid/contracts";

const raceId = "10000000-0000-4000-8000-000000000001";
const classId = "20000000-0000-4000-8000-000000000001";
const courseVersionId = "20000000-0000-4000-8000-000000000002";
const identifier = (prefix: string, index: number) =>
  `${prefix}-0000-4000-8000-${(index + 1).toString(16).padStart(12, "0")}`;

const decisions = resultDisqualificationWithdrawalListResponseSchema.parse({ formatVersion: 1, raceId,
  snapshotVersion: 7, policyVersion: RESULT_DISQUALIFICATION_WITHDRAWAL_POLICY_VERSION,
  entries: Array.from({ length: 8 }, (_, index) => {
    const state = index % 2 === 0 ? "WITHDRAWABLE" : "WITHDRAWN";
    const laterTechnicalRevision = index === 0;
    return { id: identifier("30000000", index), displayName: `Löpare ${index + 1}`,
      organisationName: index % 2 === 0 ? "Centrum OK" : null,
      classId, className: index % 2 === 0 ? "D21" : "H21", courseVersionId,
      entryVersion: 2, state, resultDisqualificationDecisionId: identifier("40000000", index),
      decidedAt: "2026-09-27T10:00:00.000Z",
      targetResultRevision: { id: identifier("50000000", index), revision: 1 },
      disqualifiedResultRevision: { id: identifier("60000000", index), revision: 2 },
      absoluteResultRevision: { id: identifier(laterTechnicalRevision ? "70000000" : state === "WITHDRAWN" ? "a0000000" : "60000000", index),
        revision: laterTechnicalRevision ? 4 : state === "WITHDRAWN" ? 3 : 2 },
      restorationSourceResultRevision: { id: identifier(laterTechnicalRevision ? "80000000" : "50000000", index),
        revision: laterTechnicalRevision ? 4 : 1,
        status: laterTechnicalRevision ? "MP" : "OK", reason: laterTechnicalRevision ? "MISSING_CONTROL" : "COMPLETE" },
      withdrawal: state === "WITHDRAWN" ? { id: identifier("90000000", index),
        restorationResultRevision: { id: identifier("a0000000", index), revision: 3 },
        policyVersion: RESULT_DISQUALIFICATION_WITHDRAWAL_POLICY_VERSION,
        withdrawnAt: "2026-09-27T11:00:00.000Z" } : null };
  }) });

test("TASK258: tät DSQ-återtagning med exakt källa och fryst retry vid 1366/390 px", async ({ page, context }) => {
  await context.addCookies([{ name: "otid_result_disqualification_withdrawal_admin_csrf", value: "c".repeat(43),
    url: "http://127.0.0.1:3127" }]);
  const attempts: { key: string | undefined; body: string | null }[] = [];
  let releaseFirstRequest: (() => void) | undefined;
  await page.route("**/api/**", async route => {
    const request = route.request(), path = new URL(request.url()).pathname;
    if (path === `/api/admin/races/${raceId}/result-disqualification-withdrawals` && request.method() === "GET") {
      return route.fulfill({ status: 200, json: decisions });
    }
    if (path === `/api/admin/races/${raceId}/entries/${decisions.entries[0]!.id}/result-disqualification-withdrawal` &&
        request.method() === "POST") {
      attempts.push({ key: request.headers()["idempotency-key"], body: request.postData() });
      if (attempts.length === 1) await new Promise<void>(resolve => { releaseFirstRequest = resolve; });
      return route.abort();
    }
    return route.abort();
  });

  await page.setViewportSize({ width: 1366, height: 768 });
  await page.goto(`/admin/${raceId}/disqualification-withdrawals`);
  const entries = page.locator("article.result-disqualification-withdrawal-entry");
  await expect(entries).toHaveCount(8);
  await expect(entries.nth(1).getByRole("button", { name: "Granska återtagande" })).toBeDisabled();
  await expect(entries.nth(1)).toContainText("Redan återtaget");
  await expect(entries.first()).toContainText("4 · MP");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: test.info().outputPath("disqualification-withdrawal-desktop.png"), fullPage: true });

  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(await entries.first().getByRole("button", { name: "Granska återtagande" })
    .evaluate(element => element.getBoundingClientRect().height)).toBeGreaterThanOrEqual(52);
  await page.screenshot({ path: test.info().outputPath("disqualification-withdrawal-mobile.png"), fullPage: true });

  await entries.first().getByRole("button", { name: "Granska återtagande" }).click();
  const confirm = page.locator("section.result-disqualification-withdrawal-confirm");
  await expect(confirm).toContainText("Löpare 1");
  await expect(confirm).toContainText("4 · MP");
  expect(attempts).toHaveLength(0);
  expect(await page.getByRole("button", { name: "Ja, återta diskvalifikationen" }).evaluate(element => {
    const bounds = element.getBoundingClientRect();
    return bounds.top >= 0 && bounds.bottom <= innerHeight;
  })).toBe(true);
  await page.screenshot({ path: test.info().outputPath("disqualification-withdrawal-confirm-viewport.png") });

  await page.getByRole("button", { name: "Ja, återta diskvalifikationen" }).click();
  await expect.poll(() => attempts.length).toBe(1);
  await expect(page.locator("section.result-disqualification-withdrawal-retry[role='alert']")).toHaveCount(0);
  releaseFirstRequest?.();
  await expect(page.locator("section.result-disqualification-withdrawal-retry[role='alert']")).toBeVisible();
  expect(await page.locator("section.result-disqualification-withdrawal-retry").evaluate(element => {
    const bounds = element.getBoundingClientRect();
    return bounds.top >= 0 && bounds.top < innerHeight;
  })).toBe(true);
  await page.screenshot({ path: test.info().outputPath("disqualification-withdrawal-retry-viewport.png") });
  await page.getByRole("button", { name: "Försök igen med samma återtagande" }).click();
  await expect.poll(() => attempts.length).toBe(2);
  expect(attempts[1]).toEqual(attempts[0]);
});
