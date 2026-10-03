import { expect, test } from "@playwright/test";
import { OUT_OF_COMPETITION_WITHDRAWAL_POLICY_VERSION, outOfCompetitionWithdrawalListResponseSchema } from "@o-tid/contracts";

const raceId = "10000000-0000-4000-8000-000000000001";
const classId = "20000000-0000-4000-8000-000000000001";
const courseVersionId = "20000000-0000-4000-8000-000000000002";
const identifier = (prefix: string, index: number) =>
  `${prefix}-0000-4000-8000-${(index + 1).toString(16).padStart(12, "0")}`;

const decisions = outOfCompetitionWithdrawalListResponseSchema.parse({ formatVersion: 1, raceId,
  snapshotVersion: 7, policyVersion: OUT_OF_COMPETITION_WITHDRAWAL_POLICY_VERSION,
  entries: Array.from({ length: 8 }, (_, index) => {
    const withdrawn = index % 2 === 1;
    const laterTechnicalRevision = index === 0;
    const target = { id: identifier("50000000", index), revision: 1 };
    const ooc = { id: identifier("60000000", index), revision: 2 };
    const restoration = { id: identifier("90000000", index), revision: 3 };
    const head = laterTechnicalRevision ? { id: identifier("70000000", index), revision: 4 }
      : withdrawn ? restoration : ooc;
    const source = laterTechnicalRevision ? { ...head, status: "OK", reason: "COMPLETE", cause: "EXPLICIT_RECALCULATION" }
      : { ...target, status: "MP", reason: "MISSING_CONTROL", cause: "CARD_READOUT" };
    return { id: identifier("30000000", index), displayName: `Löpare ${index + 1}`,
      organisationName: index % 2 === 0 ? "Centrum OK" : null,
      classId, className: index % 2 === 0 ? "D21" : "H21", courseVersionId,
      entryVersion: 2, state: withdrawn ? "WITHDRAWN" : "WITHDRAWABLE",
      notCompetingDecisionId: identifier("40000000", index), decidedAt: "2026-09-27T10:00:00.000Z",
      targetResultRevision: target, outOfCompetitionResultRevision: ooc,
      absoluteResultRevision: head, restorationSourceResultRevision: source,
      withdrawal: withdrawn ? { id: identifier("80000000", index),
        restorationResultRevision: restoration, reason: "ERRONEOUS_MANUAL_OUT_OF_COMPETITION",
        policyVersion: OUT_OF_COMPETITION_WITHDRAWAL_POLICY_VERSION,
        withdrawnAt: "2026-09-27T11:00:00.000Z" } : null };
  }) });

test("TASK264: tät OOC-återtagning med exakt källa och retry vid 1366/390 px", async ({ page, context }) => {
  await context.addCookies([{ name: "otid_out_of_competition_withdrawal_admin_csrf", value: "c".repeat(43),
    url: "http://127.0.0.1:3127" }]);
  const attempts: { key: string | undefined; body: string | null }[] = [];
  let releaseFirstRequest: (() => void) | undefined;
  await page.route("**/api/**", async route => {
    const request = route.request(), path = new URL(request.url()).pathname;
    if (path === `/api/admin/races/${raceId}/out-of-competition-withdrawals` && request.method() === "GET") {
      return route.fulfill({ status: 200, json: decisions });
    }
    if (path === `/api/admin/races/${raceId}/entries/${decisions.entries[0]!.id}/out-of-competition-withdrawal` &&
        request.method() === "POST") {
      attempts.push({ key: request.headers()["idempotency-key"], body: request.postData() });
      if (attempts.length === 1) await new Promise<void>(resolve => { releaseFirstRequest = resolve; });
      return route.abort();
    }
    return route.abort();
  });

  await page.setViewportSize({ width: 1366, height: 768 });
  await page.goto(`/admin/${raceId}/out-of-competition-withdrawals`);
  const entries = page.locator("article.out-of-competition-withdrawal-entry");
  await expect(entries).toHaveCount(8);
  await expect(entries.nth(1).getByRole("button", { name: "Granska återtagande" })).toBeDisabled();
  await expect(entries.nth(1)).toContainText("Redan återtaget");
  await expect(entries.first()).toContainText("4 · OK");
  await expect(entries.nth(2)).toContainText("1 · MP");
  await expect(entries.nth(2)).toContainText("Obligatorisk kontroll saknas");
  expect(await page.locator(".out-of-competition-withdrawal-list-head > span")
    .evaluateAll(elements => elements.every(element => element.scrollWidth <= element.clientWidth))).toBe(true);
  expect(await page.locator("body > header").evaluate(element => getComputedStyle(element).backgroundColor))
    .toBe("rgb(247, 248, 248)");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: test.info().outputPath("ooc-withdrawal-desktop.png"), fullPage: true });

  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(await entries.first().getByRole("button", { name: "Granska återtagande" })
    .evaluate(element => element.getBoundingClientRect().height)).toBeGreaterThanOrEqual(52);
  await page.screenshot({ path: test.info().outputPath("ooc-withdrawal-mobile.png"), fullPage: true });

  await entries.first().getByRole("button", { name: "Granska återtagande" }).click();
  const confirm = page.locator("section.out-of-competition-withdrawal-confirm");
  await expect(confirm).toContainText("Löpare 1");
  await expect(confirm).toContainText("4 · OK");
  await expect(confirm.locator("dd").nth(3)).toHaveText(decisions.entries[0]!.notCompetingDecisionId);
  await expect(confirm.locator("dd").nth(4)).toHaveText("2");
  await expect(confirm.locator("dd").nth(5)).toHaveText("4");
  await expect(confirm.locator("dd").nth(7)).toHaveText("7");
  expect(attempts).toHaveLength(0);
  expect(await page.getByRole("button", { name: "Ja, återta utom tävlan" }).evaluate(element => {
    const bounds = element.getBoundingClientRect();
    return bounds.top >= 0 && bounds.bottom <= innerHeight;
  })).toBe(true);
  await page.screenshot({ path: test.info().outputPath("ooc-withdrawal-confirm-viewport.png") });

  await page.getByRole("button", { name: "Ja, återta utom tävlan" }).click();
  await expect.poll(() => attempts.length).toBe(1);
  const submitted: unknown = JSON.parse(attempts[0]!.body!);
  expect(submitted).toMatchObject({
    expectedAbsoluteResultRevision: decisions.entries[0]!.absoluteResultRevision,
    expectedRestorationSourceResultRevision: decisions.entries[0]!.restorationSourceResultRevision
  });
  await expect(page.locator("section.out-of-competition-withdrawal-retry[role='alert']")).toHaveCount(0);
  releaseFirstRequest?.();
  await expect(page.locator("section.out-of-competition-withdrawal-retry[role='alert']")).toBeVisible();
  expect(await page.locator("section.out-of-competition-withdrawal-retry").evaluate(element => {
    const bounds = element.getBoundingClientRect();
    return bounds.top >= 0 && bounds.top < innerHeight;
  })).toBe(true);
  await page.screenshot({ path: test.info().outputPath("ooc-withdrawal-retry-viewport.png") });
  await page.getByRole("button", { name: "Försök igen med samma återtagande" }).click();
  await expect.poll(() => attempts.length).toBe(2);
  expect(attempts[1]).toEqual(attempts[0]);
});
