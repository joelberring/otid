import { expect, test } from "@playwright/test";
import { WITHOUT_TIMING_WITHDRAWAL_POLICY_VERSION, withoutTimingWithdrawalListResponseSchema } from "@o-tid/contracts";

const raceId = "10000000-0000-4000-8000-000000000001";
const classId = "20000000-0000-4000-8000-000000000001";
const courseVersionId = "20000000-0000-4000-8000-000000000002";
const identifier = (prefix: string, index: number) =>
  `${prefix}-0000-4000-8000-${(index + 1).toString(16).padStart(12, "0")}`;

const decisions = withoutTimingWithdrawalListResponseSchema.parse({
  formatVersion: 1, raceId, snapshotVersion: 7, policyVersion: WITHOUT_TIMING_WITHDRAWAL_POLICY_VERSION,
  entries: Array.from({ length: 8 }, (_, index) => {
    const withdrawn = index % 2 === 1;
    const laterTechnicalRevision = index === 0 || index === 3;
    const target = { id: identifier("50000000", index), revision: 1 };
    const nt = { id: identifier("60000000", index), revision: 2 };
    const technical = { id: identifier("70000000", index), revision: 4 };
    const restoration = { id: identifier("90000000", index), revision: laterTechnicalRevision ? 5 : 3 };
    const head = withdrawn ? restoration : laterTechnicalRevision ? technical : nt;
    const source = laterTechnicalRevision
      ? { ...technical, status: "MP", reason: "MISSING_CONTROL", cause: "CARD_READOUT" }
      : { ...target, status: "OK", reason: "COMPLETE", cause: "CARD_READOUT" };
    return {
      id: identifier("30000000", index), displayName: `Löpare ${index + 1}`,
      organisationName: index % 2 === 0 ? "Centrum OK" : null,
      classId, className: index % 2 === 0 ? "D21" : "H21", courseVersionId,
      entryVersion: 2, state: withdrawn ? "WITHDRAWN" : "WITHDRAWABLE",
      withoutTimingDecisionId: identifier("40000000", index), decidedAt: "2026-09-29T10:00:00.000Z",
      targetResultRevision: target, withoutTimingResultRevision: nt,
      absoluteResultRevision: head, restorationSourceResultRevision: source,
      withdrawal: withdrawn ? {
        id: identifier("80000000", index), restorationResultRevision: restoration,
        reason: "ERRONEOUS_MANUAL_WITHOUT_TIMING", policyVersion: WITHOUT_TIMING_WITHDRAWAL_POLICY_VERSION,
        withdrawnAt: "2026-09-29T11:00:00.000Z"
      } : null
    };
  })
});

test("TASK266: tät NT-återtagning med exakt OK/MP-källa och retry vid 1366/390 px", async ({ page, context }) => {
  await context.addCookies([{ name: "otid_without_timing_withdrawal_admin_csrf", value: "c".repeat(43),
    url: "http://127.0.0.1:3127" }]);
  const attempts: { key: string | undefined; body: string | null }[] = [];
  let releaseFirstRequest: (() => void) | undefined;
  let rejectListRead = false;
  await page.route("**/api/**", async route => {
    const request = route.request(), path = new URL(request.url()).pathname;
    if (path === `/api/admin/races/${raceId}/without-timing-withdrawals` && request.method() === "GET") {
      if (rejectListRead) return route.fulfill({ status: 503, json: { error: "INTERNAL_ERROR" } });
      return route.fulfill({ status: 200, json: decisions });
    }
    if (path === `/api/admin/races/${raceId}/entries/${decisions.entries[0]!.id}/without-timing-withdrawal` &&
        request.method() === "POST") {
      attempts.push({ key: request.headers()["idempotency-key"], body: request.postData() });
      if (attempts.length === 1) await new Promise<void>(resolve => { releaseFirstRequest = resolve; });
      return route.abort();
    }
    return route.abort();
  });

  await page.setViewportSize({ width: 1366, height: 768 });
  await page.goto(`/admin/${raceId}/without-timing-withdrawals`);
  const entries = page.locator("article.without-timing-withdrawal-entry");
  const begin = { name: "Granska återtagande" };
  await expect(entries).toHaveCount(8);
  await expect(entries.nth(1).getByRole("button", begin)).toBeDisabled();
  await expect(entries.nth(1)).toContainText("Redan återtaget");
  await expect(entries.first()).toContainText("4 · MP");
  await expect(entries.first()).toContainText("Felstämplad");
  expect(await entries.first().locator(".without-timing-withdrawal-source-status").evaluate(element => getComputedStyle(element).color))
    .toBe("rgb(153, 63, 63)");
  await expect(entries.first()).toContainText("Obligatorisk kontroll saknas");
  await expect(entries.nth(2)).toContainText("1 · OK");
  await expect(entries.nth(2)).toContainText("Godkänt resultat");
  expect(await page.locator(".without-timing-withdrawal-list-head > span").evaluateAll(elements =>
    elements.every(element => element.scrollWidth <= element.clientWidth))).toBe(true);
  expect(await page.locator("body > header").evaluate(element => getComputedStyle(element).backgroundColor))
    .toBe("rgb(247, 248, 248)");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: test.info().outputPath("nt-withdrawal-desktop.png"), fullPage: true });

  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(await entries.first().getByRole("button", begin).evaluate(element => element.getBoundingClientRect().height))
    .toBeGreaterThanOrEqual(52);
  await page.screenshot({ path: test.info().outputPath("nt-withdrawal-mobile.png"), fullPage: true });

  await entries.first().getByRole("button", begin).click();
  const confirm = page.locator("section.without-timing-withdrawal-confirm");
  await expect(confirm).toContainText("Löpare 1");
  await expect(confirm).toContainText("D21");
  await expect(confirm).toContainText("4 · MP");
  await expect(confirm).toContainText("Obligatorisk kontroll saknas");
  await expect(confirm.locator("dd").nth(3)).toHaveText(decisions.entries[0]!.withoutTimingDecisionId);
  await expect(confirm.locator("dd").nth(4)).toHaveText("2");
  await expect(confirm.locator("dd").nth(5)).toHaveText("4");
  await expect(confirm.locator("dd").nth(7)).toHaveText("7");
  expect(attempts).toHaveLength(0);
  expect(await page.getByRole("button", { name: "Ja, återta utan tidtagning" }).evaluate(element => {
    const bounds = element.getBoundingClientRect();
    return bounds.top >= 0 && bounds.bottom <= innerHeight;
  })).toBe(true);
  await page.screenshot({ path: test.info().outputPath("nt-withdrawal-confirm-viewport.png") });

  await page.getByRole("button", { name: "Ja, återta utan tidtagning" }).click();
  await expect.poll(() => attempts.length).toBe(1);
  const submitted: unknown = JSON.parse(attempts[0]!.body!);
  expect(submitted).toEqual({
    formatVersion: 1, expectedEntryVersion: 2, expectedClassId: classId,
    expectedCourseVersionId: courseVersionId, expectedSnapshotVersion: 7,
    expectedWithoutTimingDecisionId: decisions.entries[0]!.withoutTimingDecisionId,
    expectedTargetResultRevision: decisions.entries[0]!.targetResultRevision,
    expectedWithoutTimingResultRevision: decisions.entries[0]!.withoutTimingResultRevision,
    expectedAbsoluteResultRevision: decisions.entries[0]!.absoluteResultRevision,
    expectedRestorationSourceResultRevision: decisions.entries[0]!.restorationSourceResultRevision,
    reason: "ERRONEOUS_MANUAL_WITHOUT_TIMING", policyVersion: WITHOUT_TIMING_WITHDRAWAL_POLICY_VERSION
  });
  await expect(page.locator("section.without-timing-withdrawal-retry[role='alert']")).toHaveCount(0);
  releaseFirstRequest?.();
  const retry = page.locator("section.without-timing-withdrawal-retry[role='alert']");
  await expect(retry).toBeVisible();
  await expect(retry).toContainText("4 · MP");
  await expect(retry).toContainText("Obligatorisk kontroll saknas");
  await expect(page.getByRole("status")).toContainText("Serverns svar kunde inte bekräftas.");
  expect(await retry.evaluate(element => {
    const bounds = element.getBoundingClientRect();
    return bounds.top >= 0 && bounds.top < innerHeight;
  })).toBe(true);
  await page.screenshot({ path: test.info().outputPath("nt-withdrawal-retry-viewport.png") });
  await page.getByRole("button", { name: "Försök igen med samma återtagande" }).click();
  await expect.poll(() => attempts.length).toBe(2);
  expect(attempts[1]).toEqual(attempts[0]);

  rejectListRead = true;
  await page.reload();
  await expect(page.getByRole("status")).toContainText("503");
  await expect(page.locator(".without-timing-withdrawal-state-strip")).toContainText("Session: Inte verifierad");
  expect(attempts).toHaveLength(2);
});
