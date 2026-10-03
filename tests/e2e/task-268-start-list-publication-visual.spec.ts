import { expect, test } from "@playwright/test";
import { startListPublicationContentSchema, startListPublicationPreviewResponseSchema,
  startListPublicationRequestSchema, startListPublicationResponseSchema } from "@o-tid/contracts";

const raceId = "10000000-0000-4000-8000-000000000001";
const endpoint = `/api/admin/races/${raceId}/start-list-publication`;
const content = startListPublicationContentSchema.parse({
  eventName: "Syntetisk publicering", raceName: "Testlopp", raceDate: "2026-09-29",
  timeZone: "Europe/Stockholm", classes: [
    { name: "H21", startRule: "FIXED", entries: Array.from({ length: 40 }, (_, index) => ({
      displayName: `Löpare ${index + 1}`, organisationName: "Testklubben",
      fixedStartTime: index === 3 ? null : new Date(Date.parse("2026-09-29T08:00:00.000Z") + index * 60_000).toISOString()
    })) },
    { name: "Öppen", startRule: "PUNCH", entries: Array.from({ length: 20 }, (_, index) => ({
      displayName: `Löpare ${index + 41}`, organisationName: null, fixedStartTime: null
    })) }
  ]
});
const initial = startListPublicationPreviewResponseSchema.parse({
  formatVersion: 1, raceId, snapshotVersion: 7, sourceHash: "a".repeat(64), content,
  latestDecision: { revision: 3, action: "PUBLISH", sourceSnapshotVersion: 6,
    sourceHash: "b".repeat(64), decidedAt: "2026-09-28T09:00:00.000Z" }
});

test("TASK268: neutral publicering, fryst retry och avpublicering trots ogiltigt underlag vid 1366/390 px", async ({ page, context }) => {
  await context.addCookies([{ name: "otid_start_list_publication_admin_csrf", value: "c".repeat(43),
    url: "http://127.0.0.1:3127" }]);
  let latest = initial.latestDecision!;
  let invalidContent = false;
  const attempts: { key: string | undefined; body: string | null }[] = [];
  await page.route("**/api/**", async route => {
    const request = route.request(), path = new URL(request.url()).pathname;
    if (path === endpoint && request.method() === "GET") {
      return route.fulfill({ status: 200, json: startListPublicationPreviewResponseSchema.parse({
        ...initial, snapshotVersion: invalidContent ? 8 : 7, latestDecision: latest,
        content: invalidContent ? null : content, sourceHash: invalidContent ? null : initial.sourceHash
      }) });
    }
    if (path === endpoint && request.method() === "POST") {
      attempts.push({ key: request.headers()["idempotency-key"], body: request.postData() });
      if (attempts.length === 1) return route.abort();
      const intent = startListPublicationRequestSchema.parse(request.postDataJSON());
      const receipt = startListPublicationResponseSchema.parse({
        formatVersion: 1, raceId, requestId: request.headers()["idempotency-key"]!.slice("start-list-publication:".length),
        replayed: attempts.length === 2, revision: intent.expectedRevision + 1, action: intent.action,
        decidedAt: "2026-09-29T09:00:00.000Z",
        sourceSnapshotVersion: intent.action === "PUBLISH" ? intent.expectedSnapshotVersion : 8,
        sourceHash: intent.action === "PUBLISH" ? intent.expectedSourceHash : null
      });
      latest = { revision: receipt.revision, action: receipt.action, decidedAt: receipt.decidedAt,
        sourceSnapshotVersion: receipt.sourceSnapshotVersion, sourceHash: receipt.sourceHash };
      return route.fulfill({ status: 200, json: receipt });
    }
    return route.abort();
  });

  await page.setViewportSize({ width: 1366, height: 768 });
  await page.goto(`/admin/${raceId}/start-list-publication`);
  const root = page.locator(".start-list-publication-admin");
  const previewList = page.locator(".start-list-publication-preview-list");
  await expect(root.getByRole("button", { name: "Granska publicering", exact: true })).toBeVisible();
  await expect(root).toContainText("Tävlingsunderlaget skiljer sig från den publicerade kopian");
  await expect(previewList.locator("article")).toHaveCount(60);
  await expect(previewList).toContainText("2026-09-29 10:00:00 GMT+02:00");
  await expect(previewList).toContainText("Starttid saknas");
  await expect(previewList).toContainText("Startstämpling");
  expect(await previewList.evaluate(element => element.scrollHeight > element.clientHeight)).toBe(true);
  expect(await page.locator("body > header").evaluate(element => getComputedStyle(element).backgroundColor))
    .toBe("rgb(247, 248, 248)");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: test.info().outputPath("publication-desktop-overview.png") });

  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await root.getByRole("button", { name: "Granska publicering", exact: true }).click();
  const attempt = page.locator(".start-list-publication-attempt");
  const confirm = page.getByRole("button", { name: "Bekräfta och publicera", exact: true });
  await expect(attempt).toContainText(initial.sourceHash!);
  await expect(attempt.locator(".start-list-publication-attempt-facts")).toContainText("7");
  await expect(attempt.locator(".start-list-publication-attempt-facts")).toContainText("3");
  expect(attempts).toHaveLength(0);
  expect(await confirm.evaluate(element => {
    const bounds = element.getBoundingClientRect();
    return bounds.height >= 52 && bounds.top >= 0 && bounds.bottom <= innerHeight;
  })).toBe(true);
  const frozenList = attempt.locator(".start-list-publication-preview-list");
  await frozenList.getByRole("searchbox", { name: "Sök namn eller klubb" }).fill("Löpare 60");
  await expect(frozenList.locator("article")).toHaveCount(1);
  await expect(frozenList).toContainText("Visar 1 av 60 deltagare");
  await frozenList.getByRole("button", { name: "Rensa filter", exact: true }).click();
  await expect(frozenList.locator("article")).toHaveCount(60);
  await frozenList.evaluate(element => element.scrollIntoView({ block: "end", behavior: "instant" }));
  await frozenList.evaluate(element => { element.scrollTop = element.scrollHeight; });
  await expect(frozenList.getByRole("heading", { name: "Löpare 60", exact: true })).toBeInViewport();
  await frozenList.evaluate(element => { element.scrollTop = 0; });
  await attempt.getByRole("heading").first().evaluate(element => element.scrollIntoView({ block: "start", behavior: "instant" }));
  await page.screenshot({ path: test.info().outputPath("publication-mobile-confirm.png") });

  await confirm.click();
  const retry = page.getByRole("button", { name: "Försök igen med samma begäran", exact: true });
  await expect(retry).toBeVisible();
  await expect(attempt).toContainText("Beslutet kan ha sparats");
  expect(attempts).toHaveLength(1);
  expect(JSON.parse(attempts[0]!.body!) as unknown).toEqual({
    formatVersion: 1, action: "PUBLISH", expectedRevision: 3,
    expectedSnapshotVersion: 7, expectedSourceHash: initial.sourceHash
  });
  await expect(attempt).toContainText(attempts[0]!.key!.slice("start-list-publication:".length));
  expect(await retry.evaluate(element => {
    const bounds = element.getBoundingClientRect();
    return bounds.top >= 0 && bounds.bottom <= innerHeight;
  })).toBe(true);
  await page.screenshot({ path: test.info().outputPath("publication-mobile-retry.png") });
  await retry.click();
  await expect(root.getByRole("status").filter({ hasText: "Publiceringsbeslutet är sparat." })).toBeVisible();
  expect(attempts).toHaveLength(2);
  expect(attempts[1]).toEqual(attempts[0]);

  invalidContent = true;
  await root.getByRole("button", { name: "Läs aktuellt underlag", exact: true }).click();
  await expect(root).toContainText("Det aktuella underlaget kan inte publiceras");
  await expect(root.getByRole("button", { name: "Granska publicering", exact: true })).toHaveCount(0);
  await root.getByRole("button", { name: "Granska avpublicering", exact: true }).click();
  const withdrawConfirm = page.getByRole("button", { name: "Bekräfta och avpublicera", exact: true });
  await expect(attempt).toContainText("4");
  await expect(attempt).not.toContainText(initial.sourceHash!);
  await expect(attempt.locator(".start-list-publication-preview-list")).toHaveCount(0);
  expect(await withdrawConfirm.evaluate(element => {
    const bounds = element.getBoundingClientRect();
    return bounds.height >= 52 && bounds.top >= 0 && bounds.bottom <= innerHeight;
  })).toBe(true);
  await page.screenshot({ path: test.info().outputPath("publication-mobile-withdraw.png") });
  await withdrawConfirm.click();
  await expect(root).toContainText("Avpublicerad");
  expect(attempts).toHaveLength(3);
  expect(JSON.parse(attempts[2]!.body!) as unknown).toEqual({ formatVersion: 1, action: "WITHDRAW", expectedRevision: 4 });
  expect(await page.evaluate(() => ({ local: Object.keys(localStorage), session: Object.keys(sessionStorage) })))
    .toEqual({ local: [], session: [] });
});
