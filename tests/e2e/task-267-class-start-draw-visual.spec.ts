import { expect, test } from "@playwright/test";
import { classStartDrawClassesResponseSchema, classStartDrawParametersSchema, classStartDrawPreviewResponseSchema,
  classStartDrawResponseSchema } from "@o-tid/contracts";

const raceId = "10000000-0000-4000-8000-000000000001";
const classId = "20000000-0000-4000-8000-000000000001";
const endpoint = `/api/admin/races/${raceId}/class-start-draw`;
const firstInput = "2026-09-29T10:00:00+02:00";
const parameters = classStartDrawParametersSchema.parse({ algorithmVersion: "xorshift32-fisher-yates-v1", seed: 7,
  firstStartTime: firstInput, intervalSeconds: 60 });
const classes = classStartDrawClassesResponseSchema.parse({
  formatVersion: 1, raceId, snapshotVersion: 7, timeZone: "Europe/Stockholm", seed: 7,
  classes: [{ id: classId, name: "H21", entryCount: 60 },
    { id: "20000000-0000-4000-8000-000000000002", name: "D21", entryCount: 0 }]
});
const preview = classStartDrawPreviewResponseSchema.parse({
  formatVersion: 1, raceId, classId, className: "H21", snapshotVersion: 7,
  sourceHash: "a".repeat(64), timeZone: "Europe/Stockholm", parameters,
  entries: Array.from({ length: 60 }, (_, index) => {
    const fixedStartTime = new Date(Date.parse(parameters.firstStartTime) + index * 60_000).toISOString();
    const previousFixedStartTime = index % 7 === 0 ? fixedStartTime : index % 3 === 0 ? null :
      new Date(Date.parse(fixedStartTime) - 3_600_000).toISOString();
    return { entryId: `30000000-0000-4000-8000-${(index + 1).toString(16).padStart(12, "0")}`,
      entryVersion: 2, displayName: `Löpare ${index + 1}`, previousFixedStartTime,
      fixedStartTime, changed: previousFixedStartTime !== fixedStartTime };
  })
});

test("TASK267: neutral tät lottning med 60 rader och fryst same-id-retry vid 1366/390 px", async ({ page, context }) => {
  await context.addCookies([{ name: "otid_class_start_draw_admin_csrf", value: "c".repeat(43),
    url: "http://127.0.0.1:3127" }]);
  const attempts: { key: string | undefined; body: string | null }[] = [];
  let previews = 0;
  await page.route("**/api/**", async route => {
    const request = route.request(), path = new URL(request.url()).pathname;
    if (path === endpoint && request.method() === "GET") return route.fulfill({ status: 200, json: classes });
    if (path === `${endpoint}/preview` && request.method() === "POST") {
      previews++;
      expect(request.postDataJSON()).toEqual({ formatVersion: 1, classId, parameters });
      return route.fulfill({ status: 200, json: preview });
    }
    if (path === endpoint && request.method() === "POST") {
      attempts.push({ key: request.headers()["idempotency-key"], body: request.postData() });
      if (attempts.length === 1) return route.abort();
      const receipt = classStartDrawResponseSchema.parse({
        formatVersion: 1, raceId, requestId: attempts[0]!.key!.slice("class-start-draw:".length),
        replayed: true, classId, sourceHash: preview.sourceHash, parameters,
        entryCount: 60, changedEntryCount: preview.entries.filter(entry => entry.changed).length,
        snapshotVersionBefore: 7, snapshotVersionAfter: 8, changedAt: "2026-09-29T09:00:00.000Z"
      });
      return route.fulfill({ status: 200, json: receipt });
    }
    return route.abort();
  });

  await page.setViewportSize({ width: 1366, height: 768 });
  await page.goto(`/admin/${raceId}/class-start-draw`);
  await expect(page.getByRole("combobox", { name: "Klass", exact: true })).toHaveValue(classId);
  await page.getByLabel("Första start (datum, sekunder och UTC-offset)").fill(firstInput);
  await page.getByLabel("Startintervall i hela sekunder").fill("60");
  await page.getByLabel("Slumpfrö", { exact: true }).fill("7");
  const logoutTop = await page.getByRole("button", { name: "Logga ut", exact: true })
    .evaluate(element => element.getBoundingClientRect().top);
  expect(await page.getByRole("button", { name: "Läs klasser och hämta nytt slumpfrö", exact: true })
    .evaluate(element => element.getBoundingClientRect().top)).toBe(logoutTop);
  expect(await page.locator("body > header").evaluate(element => getComputedStyle(element).backgroundColor))
    .toBe("rgb(247, 248, 248)");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: test.info().outputPath("draw-desktop-form.png") });
  await page.getByRole("button", { name: "Granska lottning", exact: true }).click();
  const panel = page.locator(".class-start-draw-preview");
  const list = page.locator(".class-start-draw-preview-list");
  const rows = list.locator("article.start-list-entry");
  const confirm = page.getByRole("button", { name: "Bekräfta och spara klassens tider", exact: true });
  await expect(rows).toHaveCount(60);
  await expect(rows.first()).toContainText("Oförändrad");
  await expect(rows.nth(3)).toContainText("Starttid saknas");
  await expect(rows.first()).toContainText("2026-09-29 10:00:00 GMT+02:00");
  await expect(panel).toContainText("xorshift32-fisher-yates-v1");
  await expect(panel).toContainText(preview.sourceHash);
  expect(attempts).toHaveLength(0);
  expect(await list.evaluate(element => element.scrollHeight > element.clientHeight)).toBe(true);
  expect(await confirm.evaluate(element => {
    const bounds = element.getBoundingClientRect();
    return bounds.top >= 0 && bounds.bottom <= innerHeight;
  })).toBe(true);
  await page.screenshot({ path: test.info().outputPath("draw-desktop-preview.png") });

  await page.setViewportSize({ width: 390, height: 844 });
  await panel.getByRole("heading", { name: "H21", exact: true }).evaluate(element =>
    element.scrollIntoView({ block: "start", behavior: "instant" }));
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(await confirm.evaluate(element => element.getBoundingClientRect().height)).toBeGreaterThanOrEqual(52);
  expect(await confirm.evaluate(element => {
    const bounds = element.getBoundingClientRect();
    return bounds.top >= 0 && bounds.bottom <= innerHeight;
  })).toBe(true);
  await list.evaluate(element => { element.scrollTop = element.scrollHeight; });
  await expect(rows.last().getByRole("heading", { name: "Löpare 60", exact: true })).toBeInViewport();
  await list.evaluate(element => { element.scrollTop = 0; });
  await page.screenshot({ path: test.info().outputPath("draw-mobile-preview.png") });

  await confirm.click();
  const retry = page.getByRole("button", { name: "Försök igen med samma begäran", exact: true });
  await expect(retry).toBeVisible();
  await expect(panel).toContainText("Tiderna kan ha sparats");
  expect(attempts).toHaveLength(1);
  expect(JSON.parse(attempts[0]!.body!) as unknown).toEqual({
    formatVersion: 1, classId, parameters, expectedSnapshotVersion: 7, sourceHash: preview.sourceHash
  });
  await expect(panel).toContainText(attempts[0]!.key!.slice("class-start-draw:".length));
  expect(await retry.evaluate(element => {
    const bounds = element.getBoundingClientRect();
    return bounds.top >= 0 && bounds.bottom <= innerHeight;
  })).toBe(true);
  await page.screenshot({ path: test.info().outputPath("draw-mobile-retry.png") });
  await retry.click();
  await expect(page.locator(".class-start-draw-admin").getByRole("status"))
    .toHaveText("Klassens starttider är sparade. Resultat och publicerade listor är oförändrade.");
  expect(attempts).toHaveLength(2);
  expect(attempts[1]).toEqual(attempts[0]);
  expect(previews).toBe(1);
  expect(await page.evaluate(() => ({ local: Object.keys(localStorage), session: Object.keys(sessionStorage) })))
    .toEqual({ local: [], session: [] });
});
