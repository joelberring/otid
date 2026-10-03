import { expect, test } from "@playwright/test";
import { DID_NOT_FINISH_WITHDRAWAL_POLICY_VERSION, didNotFinishWithdrawalListResponseSchema } from "@o-tid/contracts";

const raceId = "10000000-0000-4000-8000-000000000001";
const classId = "20000000-0000-4000-8000-000000000001";
const courseVersionId = "20000000-0000-4000-8000-000000000002";
const identifier = (prefix: string, index: number) =>
  `${prefix}-0000-4000-8000-${(index + 1).toString(16).padStart(12, "0")}`;

const decisions = didNotFinishWithdrawalListResponseSchema.parse({ formatVersion: 1, raceId,
  snapshotVersion: 7, policyVersion: DID_NOT_FINISH_WITHDRAWAL_POLICY_VERSION,
  entries: Array.from({ length: 8 }, (_, index) => {
    const withdrawn = index % 2 === 1;
    const laterTechnicalRevision = index === 0;
    const target = { id: identifier("50000000", index), revision: 1 };
    const dnf = { id: identifier("60000000", index), revision: 2 };
    const restoration = { id: identifier("90000000", index), revision: 3 };
    const head = laterTechnicalRevision ? { id: identifier("70000000", index), revision: 4 }
      : withdrawn ? restoration : dnf;
    const source = laterTechnicalRevision ? { ...head, status: "OK", reason: "COMPLETE" }
      : { ...target, status: "MP", reason: "MISSING_CONTROL" };
    return { id: identifier("30000000", index), displayName: `Löpare ${index + 1}`,
      organisationName: index % 2 === 0 ? "Centrum OK" : null,
      classId, className: index % 2 === 0 ? "D21" : "H21", courseVersionId,
      entryVersion: 2, state: withdrawn ? "WITHDRAWN" : "WITHDRAWABLE",
      didNotFinishDecisionId: identifier("40000000", index), decidedAt: "2026-09-27T10:00:00.000Z",
      targetResultRevision: target, didNotFinishResultRevision: dnf,
      absoluteResultRevision: head, restorationSourceResultRevision: source,
      withdrawal: withdrawn ? { id: identifier("80000000", index),
        restorationResultRevision: restoration, reason: "ERRONEOUS_MANUAL_DID_NOT_FINISH",
        policyVersion: DID_NOT_FINISH_WITHDRAWAL_POLICY_VERSION,
        withdrawnAt: "2026-09-27T11:00:00.000Z" } : null };
  }) });

test("TASK262: tät DNF-återtagning med exakt källa och retry vid 1366/390 px", async ({ page, context }) => {
  await context.addCookies([{ name: "otid_did_not_finish_withdrawal_admin_csrf", value: "c".repeat(43),
    url: "http://127.0.0.1:3127" }]);
  const attempts: { key: string | undefined; body: string | null }[] = [];
  let releaseFirstRequest: (() => void) | undefined;
  await page.route("**/api/**", async route => {
    const request = route.request(), path = new URL(request.url()).pathname;
    if (path === `/api/admin/races/${raceId}/did-not-finish-withdrawals` && request.method() === "GET") {
      return route.fulfill({ status: 200, json: decisions });
    }
    if (path === `/api/admin/races/${raceId}/entries/${decisions.entries[0]!.id}/did-not-finish-withdrawal` &&
        request.method() === "POST") {
      attempts.push({ key: request.headers()["idempotency-key"], body: request.postData() });
      if (attempts.length === 1) await new Promise<void>(resolve => { releaseFirstRequest = resolve; });
      return route.abort();
    }
    return route.abort();
  });

  await page.setViewportSize({ width: 1366, height: 768 });
  await page.goto(`/admin/${raceId}/did-not-finish-withdrawals`);
  const entries = page.locator("article.did-not-finish-withdrawal-entry");
  await expect(entries).toHaveCount(8);
  await expect(entries.nth(1).getByRole("button", { name: "Granska återtagande" })).toBeDisabled();
  await expect(entries.nth(1)).toContainText("Redan återtaget");
  await expect(entries.first()).toContainText("4 · OK");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: test.info().outputPath("dnf-withdrawal-desktop.png"), fullPage: true });

  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(await entries.first().getByRole("button", { name: "Granska återtagande" })
    .evaluate(element => element.getBoundingClientRect().height)).toBeGreaterThanOrEqual(52);
  await page.screenshot({ path: test.info().outputPath("dnf-withdrawal-mobile.png"), fullPage: true });

  await entries.first().getByRole("button", { name: "Granska återtagande" }).click();
  const confirm = page.locator("section.did-not-finish-withdrawal-confirm");
  await expect(confirm).toContainText("Löpare 1");
  await expect(confirm).toContainText("4 · OK");
  await expect(confirm).toContainText("7");
  expect(attempts).toHaveLength(0);
  expect(await page.getByRole("button", { name: "Ja, återta ej fullföljt" }).evaluate(element => {
    const bounds = element.getBoundingClientRect();
    return bounds.top >= 0 && bounds.bottom <= innerHeight;
  })).toBe(true);
  await page.screenshot({ path: test.info().outputPath("dnf-withdrawal-confirm-viewport.png") });

  await page.getByRole("button", { name: "Ja, återta ej fullföljt" }).click();
  await expect.poll(() => attempts.length).toBe(1);
  await expect(page.locator("section.did-not-finish-withdrawal-retry[role='alert']")).toHaveCount(0);
  releaseFirstRequest?.();
  await expect(page.locator("section.did-not-finish-withdrawal-retry[role='alert']")).toBeVisible();
  expect(await page.locator("section.did-not-finish-withdrawal-retry").evaluate(element => {
    const bounds = element.getBoundingClientRect();
    return bounds.top >= 0 && bounds.top < innerHeight;
  })).toBe(true);
  await page.screenshot({ path: test.info().outputPath("dnf-withdrawal-retry-viewport.png") });
  await page.getByRole("button", { name: "Försök igen med samma återtagande" }).click();
  await expect.poll(() => attempts.length).toBe(2);
  expect(attempts[1]).toEqual(attempts[0]);
});
