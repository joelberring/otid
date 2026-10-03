import { expect, test } from "@playwright/test";
import { WITHOUT_TIMING_DECISION_POLICY_VERSION, withoutTimingCandidateResponseSchema } from "@o-tid/contracts";

const raceId = "10000000-0000-4000-8000-000000000001";
const classId = "20000000-0000-4000-8000-000000000001";
const courseVersionId = "20000000-0000-4000-8000-000000000002";
const identifier = (prefix: string, index: number) =>
  `${prefix}-0000-4000-8000-${(index + 1).toString(16).padStart(12, "0")}`;

const candidates = withoutTimingCandidateResponseSchema.parse({
  formatVersion: 1, raceId, snapshotVersion: 7, policyVersion: WITHOUT_TIMING_DECISION_POLICY_VERSION,
  entries: Array.from({ length: 8 }, (_, index) => {
    const readiness = (["READY", "NO_ACTIVE_RESULT", "UNSUPPORTED_RESULT", "ACTIVE_WITHOUT_TIMING",
      "READY", "STALE_RESULT", "UNPUBLISHED_RESULT", "ACTIVE_APPROVAL"] as const)[index]!;
    return {
      id: identifier("30000000", index), displayName: `Löpare ${index + 1}`,
      organisationName: index % 2 === 0 ? "Centrum OK" : null,
      classId, className: index % 2 === 0 ? "D21" : "H21", courseVersionId,
      entryVersion: 2, readiness,
      targetResultRevision: readiness === "READY" ? {
        id: identifier("60000000", index), revision: 4, status: "OK", reason: "COMPLETE",
        cause: "CARD_READOUT", createdAt: "2026-09-29T10:00:00.000Z", snapshotVersion: 7
      } : null
    };
  })
});

test("TASK265: tät Utan tidtagning-vy med exakt OK-källa och retry vid 1366/390 px", async ({ page, context }) => {
  await context.addCookies([{ name: "otid_without_timing_admin_csrf", value: "c".repeat(43),
    url: "http://127.0.0.1:3127" }]);
  const attempts: { key: string | undefined; body: string | null }[] = [];
  let releaseFirstRequest: (() => void) | undefined;
  let rejectListRead = false;
  await page.route("**/api/**", async route => {
    const request = route.request(), path = new URL(request.url()).pathname;
    if (path === `/api/admin/races/${raceId}/without-timing-candidates` && request.method() === "GET") {
      if (rejectListRead) return route.fulfill({ status: 503, json: { error: "INTERNAL_ERROR" } });
      return route.fulfill({ status: 200, json: candidates });
    }
    if (path === `/api/admin/races/${raceId}/entries/${candidates.entries[0]!.id}/without-timing` &&
        request.method() === "POST") {
      attempts.push({ key: request.headers()["idempotency-key"], body: request.postData() });
      if (attempts.length === 1) await new Promise<void>(resolve => { releaseFirstRequest = resolve; });
      return route.abort();
    }
    return route.abort();
  });

  await page.setViewportSize({ width: 1366, height: 768 });
  await page.goto(`/admin/${raceId}/without-timing`);
  const entries = page.locator("article.without-timing-entry");
  const begin = { name: "Granska beslut utan tidtagning" };
  await expect(entries).toHaveCount(8);
  for (const index of [1, 2, 3, 5, 6, 7]) {
    await expect(entries.nth(index).getByRole("button", begin)).toBeDisabled();
  }
  await expect(entries.first()).toContainText("4 · OK");
  await expect(entries.first()).toContainText("Godkänt resultat");
  await expect(entries.nth(3)).toContainText("redan aktivt");
  await expect(entries.nth(5)).toContainText("resultatet är inaktuellt");
  expect(await page.locator(".without-timing-list-head > span").evaluateAll(elements =>
    elements.every(element => element.scrollWidth <= element.clientWidth))).toBe(true);
  expect(await page.locator("body > header").evaluate(element => getComputedStyle(element).backgroundColor))
    .toBe("rgb(247, 248, 248)");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: test.info().outputPath("without-timing-desktop.png"), fullPage: true });

  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(await entries.first().getByRole("button", begin).evaluate(element => element.getBoundingClientRect().height))
    .toBeGreaterThanOrEqual(52);
  await page.screenshot({ path: test.info().outputPath("without-timing-mobile.png"), fullPage: true });

  await entries.first().getByRole("button", begin).click();
  const confirm = page.locator("section.without-timing-confirm");
  await expect(confirm).toContainText("Löpare 1");
  await expect(confirm).toContainText("D21");
  await expect(confirm).toContainText("4 · OK");
  await expect(confirm).toContainText("Godkänt resultat");
  expect(attempts).toHaveLength(0);
  expect(await page.getByRole("button", { name: "Ja, markera utan tidtagning" }).evaluate(element => {
    const bounds = element.getBoundingClientRect();
    return bounds.top >= 0 && bounds.bottom <= innerHeight;
  })).toBe(true);
  await page.screenshot({ path: test.info().outputPath("without-timing-confirm-viewport.png") });

  await page.getByRole("button", { name: "Ja, markera utan tidtagning" }).click();
  await expect.poll(() => attempts.length).toBe(1);
  const submitted: unknown = JSON.parse(attempts[0]!.body!);
  expect(submitted).toMatchObject({
    expectedEntryVersion: 2, expectedClassId: classId, expectedCourseVersionId: courseVersionId,
    expectedSnapshotVersion: 7,
    expectedResultRevision: { id: candidates.entries[0]!.targetResultRevision!.id,
      revision: 4, status: "OK", reason: "COMPLETE" }
  });
  await expect(page.locator("section.without-timing-retry[role='alert']")).toHaveCount(0);
  releaseFirstRequest?.();
  const retry = page.locator("section.without-timing-retry[role='alert']");
  await expect(retry).toBeVisible();
  await expect(page.getByRole("status")).toContainText("Serverns svar kunde inte bekräftas.");
  await expect(page.getByRole("status")).not.toContainText("Failed to fetch");
  await expect(retry).toContainText("Löpare 1");
  await expect(retry).toContainText("D21");
  await expect(retry).toContainText("4 · OK");
  expect(await retry.evaluate(element => {
    const bounds = element.getBoundingClientRect();
    return bounds.top >= 0 && bounds.top < innerHeight;
  })).toBe(true);
  await page.screenshot({ path: test.info().outputPath("without-timing-retry-viewport.png") });
  await page.getByRole("button", { name: "Försök igen med samma beslut" }).click();
  await expect.poll(() => attempts.length).toBe(2);
  expect(attempts[1]).toEqual(attempts[0]);

  rejectListRead = true;
  await page.reload();
  await expect(page.getByRole("status")).toContainText("503");
  await expect(page.locator(".without-timing-state-strip")).toContainText("Session: Inte verifierad");
  expect(attempts).toHaveLength(2);
});
