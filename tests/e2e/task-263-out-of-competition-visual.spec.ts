import { expect, test } from "@playwright/test";
import { OUT_OF_COMPETITION_DECISION_POLICY_VERSION, outOfCompetitionCandidateResponseSchema } from "@o-tid/contracts";

const raceId = "10000000-0000-4000-8000-000000000001";
const classId = "20000000-0000-4000-8000-000000000001";
const courseVersionId = "20000000-0000-4000-8000-000000000002";
const identifier = (prefix: string, index: number) =>
  `${prefix}-0000-4000-8000-${(index + 1).toString(16).padStart(12, "0")}`;

const candidates = outOfCompetitionCandidateResponseSchema.parse({ formatVersion: 1, raceId,
  snapshotVersion: 7, policyVersion: OUT_OF_COMPETITION_DECISION_POLICY_VERSION,
  entries: Array.from({ length: 8 }, (_, index) => {
    const readiness = (["READY", "NO_ACTIVE_RESULT", "UNSUPPORTED_RESULT", "ACTIVE_OUT_OF_COMPETITION"] as const)[index % 4];
    const status = index === 4 ? "MP" : "OK";
    return { id: identifier("30000000", index), displayName: `Löpare ${index + 1}`,
      organisationName: index % 2 === 0 ? "Centrum OK" : null,
      classId, className: index % 2 === 0 ? "D21" : "H21", courseVersionId,
      entryVersion: 2, readiness, targetResultRevision: readiness === "READY" ? {
        id: identifier("60000000", index), revision: 1, status,
        reason: status === "OK" ? "COMPLETE" : "MISSING_CONTROL", cause: "CARD_READOUT",
        createdAt: "2026-09-27T10:00:00.000Z", snapshotVersion: 7
      } : null };
  }) });

test("TASK263: tät Utom tävlan-vy med exakt target och same-id-retry vid 1366/390 px", async ({ page, context }) => {
  await context.addCookies([{ name: "otid_out_of_competition_admin_csrf", value: "c".repeat(43),
    url: "http://127.0.0.1:3127" }]);
  const attempts: { key: string | undefined; body: string | null }[] = [];
  let releaseFirstRequest: (() => void) | undefined;
  await page.route("**/api/**", async route => {
    const request = route.request(), path = new URL(request.url()).pathname;
    if (path === `/api/admin/races/${raceId}/out-of-competition-candidates` && request.method() === "GET") {
      return route.fulfill({ status: 200, json: candidates });
    }
    if (path === `/api/admin/races/${raceId}/entries/${candidates.entries[0]!.id}/out-of-competition` &&
        request.method() === "POST") {
      attempts.push({ key: request.headers()["idempotency-key"], body: request.postData() });
      if (attempts.length === 1) await new Promise<void>(resolve => { releaseFirstRequest = resolve; });
      return route.abort();
    }
    return route.abort();
  });

  await page.setViewportSize({ width: 1366, height: 768 });
  await page.goto(`/admin/${raceId}/out-of-competition`);
  const entries = page.locator("article.out-of-competition-entry");
  await expect(entries).toHaveCount(8);
  await expect(entries.nth(1).getByRole("button", { name: "Granska utom-tävlan-beslut" })).toBeDisabled();
  await expect(entries.nth(3)).toContainText("redan aktivt");
  await expect(entries.first()).toContainText("1 · OK");
  await expect(entries.nth(4)).toContainText("1 · MP");
  expect(await page.locator("body > header").evaluate(element => getComputedStyle(element).backgroundColor))
    .toBe("rgb(247, 248, 248)");
  expect(await entries.first().getByRole("button", { name: "Granska utom-tävlan-beslut" })
    .evaluate(element => getComputedStyle(element).backgroundColor)).toBe("rgb(62, 72, 82)");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: test.info().outputPath("out-of-competition-desktop.png"), fullPage: true });

  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(await entries.first().getByRole("button", { name: "Granska utom-tävlan-beslut" })
    .evaluate(element => element.getBoundingClientRect().height)).toBeGreaterThanOrEqual(52);
  await page.screenshot({ path: test.info().outputPath("out-of-competition-mobile.png"), fullPage: true });

  await entries.first().getByRole("button", { name: "Granska utom-tävlan-beslut" }).click();
  const confirm = page.locator("section.out-of-competition-confirm");
  await expect(confirm).toContainText("Löpare 1");
  await expect(confirm).toContainText("1 · OK");
  await expect(confirm).toContainText("7");
  expect(attempts).toHaveLength(0);
  expect(await page.getByRole("button", { name: "Ja, markera som utom tävlan" }).evaluate(element => {
    const bounds = element.getBoundingClientRect();
    return bounds.top >= 0 && bounds.bottom <= innerHeight;
  })).toBe(true);
  await page.screenshot({ path: test.info().outputPath("out-of-competition-confirm-viewport.png") });

  await page.getByRole("button", { name: "Ja, markera som utom tävlan" }).click();
  await expect.poll(() => attempts.length).toBe(1);
  await expect(page.locator("section.out-of-competition-retry[role='alert']")).toHaveCount(0);
  releaseFirstRequest?.();
  await expect(page.locator("section.out-of-competition-retry[role='alert']")).toBeVisible();
  expect(await page.locator("section.out-of-competition-retry").evaluate(element => {
    const bounds = element.getBoundingClientRect();
    return bounds.top >= 0 && bounds.top < innerHeight;
  })).toBe(true);
  await page.screenshot({ path: test.info().outputPath("out-of-competition-retry-viewport.png") });
  await page.getByRole("button", { name: "Försök igen med samma beslut" }).click();
  await expect.poll(() => attempts.length).toBe(2);
  expect(attempts[1]).toEqual(attempts[0]);
});
