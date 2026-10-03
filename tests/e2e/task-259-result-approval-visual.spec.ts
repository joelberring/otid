import { expect, test } from "@playwright/test";
import { RESULT_APPROVAL_POLICY_VERSION, resultApprovalCandidateResponseSchema } from "@o-tid/contracts";

const raceId = "10000000-0000-4000-8000-000000000001";
const classId = "20000000-0000-4000-8000-000000000001";
const courseVersionId = "20000000-0000-4000-8000-000000000002";
const identifier = (prefix: string, index: number) =>
  `${prefix}-0000-4000-8000-${(index + 1).toString(16).padStart(12, "0")}`;

const candidates = resultApprovalCandidateResponseSchema.parse({ formatVersion: 1, raceId,
  snapshotVersion: 7, policyVersion: RESULT_APPROVAL_POLICY_VERSION,
  entries: Array.from({ length: 8 }, (_, index) => {
    const readiness = (["READY", "UNSUPPORTED_RESULT", "NO_ACTIVE_RESULT", "STALE_RESULT"] as const)[index % 4];
    return { id: identifier("30000000", index), displayName: `Löpare ${index + 1}`,
      organisationName: index % 2 === 0 ? "Centrum OK" : null, classId,
      className: index % 2 === 0 ? "D21" : "H21", courseVersionId, entryVersion: 2,
      readiness, targetResultRevision: readiness === "READY" ? {
        id: identifier("60000000", index), revision: 1, status: "MP",
        reason: index === 4 ? "WRONG_ORDER" : "MISSING_CONTROL", cause: "CARD_READOUT",
        createdAt: "2026-09-27T10:00:00.000Z", snapshotVersion: 7
      } : null };
  }) });

test("TASK259: tät resultatgodkännandevy med fryst MP-källa och same-id-retry vid 1366/390 px", async ({ page, context }) => {
  await context.addCookies([{ name: "otid_result_approval_admin_csrf", value: "c".repeat(43),
    url: "http://127.0.0.1:3127" }]);
  const attempts: { key: string | undefined; body: string | null }[] = [];
  let releaseFirstRequest: (() => void) | undefined;
  await page.route("**/api/**", async route => {
    const request = route.request(), path = new URL(request.url()).pathname;
    if (path === `/api/admin/races/${raceId}/result-approval-candidates` && request.method() === "GET") {
      return route.fulfill({ status: 200, json: candidates });
    }
    if (path === `/api/admin/races/${raceId}/entries/${candidates.entries[0]!.id}/result-approval` &&
        request.method() === "POST") {
      attempts.push({ key: request.headers()["idempotency-key"], body: request.postData() });
      if (attempts.length === 1) await new Promise<void>(resolve => { releaseFirstRequest = resolve; });
      return route.abort();
    }
    return route.abort();
  });

  await page.setViewportSize({ width: 1366, height: 768 });
  await page.goto(`/admin/${raceId}/result-approvals`);
  await expect(page.getByRole("heading", { name: "Resultat och godkännandestatus" })).toBeVisible();
  const entries = page.locator("article.result-approval-entry");
  await expect(entries).toHaveCount(8);
  await expect(entries.nth(1).getByRole("button", { name: "Granska godkännande" })).toBeDisabled();
  await expect(entries.nth(1)).toContainText("endast tidskomplett MP");
  await expect(entries.first()).toContainText("Saknad kontroll");
  await expect(entries.nth(4)).toContainText("Fel kontrollordning");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: test.info().outputPath("result-approval-desktop.png"), fullPage: true });

  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(await entries.first().getByRole("button", { name: "Granska godkännande" })
    .evaluate(element => element.getBoundingClientRect().height)).toBeGreaterThanOrEqual(52);
  await page.screenshot({ path: test.info().outputPath("result-approval-mobile.png"), fullPage: true });

  await entries.first().getByRole("button", { name: "Granska godkännande" }).click();
  const confirm = page.locator("section.result-approval-confirm");
  await expect(confirm).toContainText("Löpare 1");
  await expect(confirm).toContainText("Saknad kontroll");
  await expect(confirm).toContainText("Snapshot");
  expect(attempts).toHaveLength(0);
  expect(await page.getByRole("button", { name: "Ja, godkänn resultatet manuellt" }).evaluate(element => {
    const bounds = element.getBoundingClientRect();
    return bounds.top >= 0 && bounds.bottom <= innerHeight;
  })).toBe(true);
  await page.screenshot({ path: test.info().outputPath("result-approval-confirm-viewport.png") });

  await page.getByRole("button", { name: "Ja, godkänn resultatet manuellt" }).click();
  await expect.poll(() => attempts.length).toBe(1);
  await expect(page.locator("section.result-approval-retry[role='alert']")).toHaveCount(0);
  releaseFirstRequest?.();
  await expect(page.locator("section.result-approval-retry[role='alert']")).toBeVisible();
  expect(await page.locator("section.result-approval-retry").evaluate(element => {
    const bounds = element.getBoundingClientRect();
    return bounds.top >= 0 && bounds.top < innerHeight;
  })).toBe(true);
  await page.screenshot({ path: test.info().outputPath("result-approval-retry-viewport.png") });
  await page.getByRole("button", { name: "Försök igen med samma beslut" }).click();
  await expect.poll(() => attempts.length).toBe(2);
  expect(attempts[1]).toEqual(attempts[0]);
});
