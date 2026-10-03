import { expect, test } from "@playwright/test";
import {
  DID_NOT_START_WITHDRAWAL_POLICY_VERSION,
  didNotStartWithdrawalListResponseSchema
} from "@o-tid/contracts";

const raceId = "10000000-0000-4000-8000-000000000001";
const classId = "20000000-0000-4000-8000-000000000001";
const courseVersionId = "20000000-0000-4000-8000-000000000002";
const identifier = (prefix: string, index: number) =>
  `${prefix}-0000-4000-8000-${(index + 1).toString(16).padStart(12, "0")}`;

const withdrawals = didNotStartWithdrawalListResponseSchema.parse({ formatVersion: 1, raceId,
  snapshotVersion: 7, withdrawalPolicyVersion: DID_NOT_START_WITHDRAWAL_POLICY_VERSION,
  entries: Array.from({ length: 8 }, (_, index) => {
    const state = (["WITHDRAWABLE", "WITHDRAWN", "SUPERSEDED"] as const)[index % 3];
    const targetId = identifier("60000000", index);
    return { id: identifier("30000000", index), displayName: `Löpare ${index + 1}`,
      organisationName: index % 2 === 0 ? "Centrum OK" : null, classId,
      className: index % 2 === 0 ? "D21" : "H21", courseVersionId, entryVersion: 2,
      didNotStartDecisionId: identifier("50000000", index), decidedAt: "2026-09-27T09:00:00.000Z",
      state, targetResultRevision: { id: targetId, revision: 1,
        createdAt: "2026-09-27T09:00:00.000Z", snapshotVersion: 7 },
      latestResultRevision: state === "SUPERSEDED" ? {
        id: identifier("70000000", index), revision: 2, cause: "CARD_READOUT",
        status: "OK", reason: "COMPLETE", createdAt: "2026-09-27T10:00:00.000Z",
        snapshotVersion: 7
      } : { id: targetId, revision: 1, cause: "MANUAL_DID_NOT_START",
        status: "DNS", reason: "DID_NOT_START", createdAt: "2026-09-27T09:00:00.000Z",
        snapshotVersion: 7 },
      withdrawal: state === "WITHDRAWN" ? { id: identifier("80000000", index),
        reason: "ERRONEOUS_MANUAL_DNS", policyVersion: DID_NOT_START_WITHDRAWAL_POLICY_VERSION,
        withdrawnAt: "2026-09-27T09:30:00.000Z" } : null
    };
  }) });

test("TASK256: tätt DNS-återtagande med granskning och fryst retry vid 1366/390 px", async ({ page, context }) => {
  await context.addCookies([{ name: "otid_dns_withdrawal_admin_csrf", value: "c".repeat(43),
    url: "http://127.0.0.1:3127" }]);
  const attempts: { key: string | undefined; body: string | null }[] = [];
  let releaseFirstRequest: (() => void) | undefined;
  await page.route("**/api/**", async route => {
    const request = route.request(), path = new URL(request.url()).pathname;
    if (path === `/api/admin/races/${raceId}/did-not-start-withdrawals` && request.method() === "GET") {
      return route.fulfill({ status: 200, json: withdrawals });
    }
    if (path === `/api/admin/races/${raceId}/entries/${withdrawals.entries[0]!.id}/did-not-start-withdrawal` &&
        request.method() === "POST") {
      attempts.push({ key: request.headers()["idempotency-key"], body: request.postData() });
      if (attempts.length === 1) await new Promise<void>(resolve => { releaseFirstRequest = resolve; });
      return route.abort();
    }
    return route.abort();
  });

  await page.setViewportSize({ width: 1366, height: 768 });
  await page.goto(`/admin/${raceId}/did-not-start-withdrawals`);
  const entries = page.locator("article.did-not-start-withdrawal-entry");
  await expect(entries).toHaveCount(8);
  await expect(entries.nth(1).getByRole("button", { name: "Granska återtagande" })).toBeDisabled();
  await expect(entries.nth(2)).toContainText("senare resultatrevision");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: test.info().outputPath("dns-withdrawal-desktop.png"), fullPage: true });

  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(await entries.first().getByRole("button", { name: "Granska återtagande" })
    .evaluate(element => element.getBoundingClientRect().height)).toBeGreaterThanOrEqual(52);
  await page.screenshot({ path: test.info().outputPath("dns-withdrawal-mobile.png"), fullPage: true });

  await entries.first().getByRole("button", { name: "Granska återtagande" }).click();
  await expect(page.locator("section.did-not-start-withdrawal-confirm")).toContainText("Löpare 1");
  await expect(page.locator("section.did-not-start-withdrawal-confirm")).toContainText("1");
  expect(attempts).toHaveLength(0);
  const confirmActionVisible = await page.getByRole("button", { name: "Ja, återta ej-startbeslutet" })
    .evaluate(element => {
      const bounds = element.getBoundingClientRect();
      return bounds.top >= 0 && bounds.bottom <= innerHeight;
    });
  expect(confirmActionVisible).toBe(true);
  await page.screenshot({ path: test.info().outputPath("dns-withdrawal-confirm-viewport.png") });

  await page.getByRole("button", { name: "Ja, återta ej-startbeslutet" }).click();
  await expect.poll(() => attempts.length).toBe(1);
  await expect(page.locator("section.did-not-start-withdrawal-retry[role='alert']")).toHaveCount(0);
  releaseFirstRequest?.();
  await expect(page.locator("section.did-not-start-withdrawal-retry[role='alert']")).toBeVisible();
  const retryVisible = await page.locator("section.did-not-start-withdrawal-retry").evaluate(element => {
    const bounds = element.getBoundingClientRect();
    return bounds.top >= 0 && bounds.top < innerHeight;
  });
  expect(retryVisible).toBe(true);
  await page.screenshot({ path: test.info().outputPath("dns-withdrawal-retry-viewport.png") });
  await page.getByRole("button", { name: "Försök igen med samma request-id" }).click();
  await expect.poll(() => attempts.length).toBe(2);
  expect(attempts[1]).toEqual(attempts[0]);
});
