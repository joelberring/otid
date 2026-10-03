import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { expect, test } from "@playwright/test";

const raceId = "10000000-0000-4000-8000-000000000001";
const resultId = "20000000-0000-4000-8000-000000000002";
const nodeRequire = createRequire(resolve("package.json"));
const esbuild = nodeRequire(nodeRequire.resolve("esbuild", { paths: [nodeRequire.resolve("tsx")] })) as {
  build(options: Record<string, unknown>): Promise<{ outputFiles: { text: string }[] }>;
};

async function mountRoute(page: import("@playwright/test").Page, unavailable = false) {
  const css = await readFile(resolve("apps/web/src/app/globals.css"), "utf8");
  const bundle = await esbuild.build({
    entryPoints: [resolve("apps/web/test/fixtures/public-route-zoom-browser.tsx")],
    bundle: true, platform: "browser", format: "iife", write: false,
    jsx: "automatic", define: { "process.env.NODE_ENV": '"test"' }
  });
  await page.route(`**/api/public/races/${raceId}/participants/${resultId}/route`, route => route.fulfill(unavailable
    ? { status: 404, json: { formatVersion: 1, error: "NOT_FOUND" } }
    : { status: 200, json: {
      formatVersion: 2, imageWidth: 1000, imageHeight: 500, notice: "ROUTE_NOT_GPS_VERIFIED",
      points: [{ x: 100, y: 300, segment: 0 }, { x: 200, y: 200, segment: 0 }],
      controls: [{ sequence: 1, controlCode: 31, x: 120, y: 280 }],
      metadata: { distanceMeters: 1234.5, pointCount: 2, segmentCount: 1, timing: {
        status: "AVAILABLE", startedAt: "2026-09-21T10:00:00.000Z",
        finishedAt: "2026-09-21T10:01:00.000Z", durationMilliseconds: 60_000
      } },
      playback: { status: "AVAILABLE", pointElapsedMilliseconds: [0, 60_000] }
    } }));
  await page.route(`**/api/public/races/${raceId}/participants/${resultId}/route/map`, route => route.fulfill({
    status: 200, contentType: "image/svg+xml",
    body: '<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="500"><rect width="1000" height="500" fill="#ecebe6"/></svg>'
  }));
  await page.route("http://127.0.0.1:3399/", route => route.fulfill({ status: 200, contentType: "text/html", body: "<!doctype html><title>Syntetisk rutt</title>" }));
  await page.goto("http://127.0.0.1:3399/");
  await page.setContent(`<!doctype html><html lang="sv"><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style></head><body><header>O-Tid</header><main class="stack public-participant-route-page"><h1>Deltagarens rutt</h1><div id="public-route-test-root"></div></main></body></html>`);
  await page.addScriptTag({ content: bundle.outputFiles[0]!.text });
}

test("TASK239 zoom, pan och utskrift på verklig publik ruttkomponent vid 320px", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 844 });
  await mountRoute(page);
  const viewport = page.getByRole("region", { name: "Flyttbar karta med deltagarens rutt" });
  const map = viewport.getByRole("img", { name: "Karta med deltagarens rutt" });
  await expect(map).toBeVisible();
  await expect(page.getByText("Förstoring: 100 %")).toBeVisible();
  await expect(page.getByRole("button", { name: "Zooma ut" })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Visa hela kartan" })).toBeDisabled();
  await expect(map.locator("path")).toHaveAttribute("d", "M100 300 L200 200 ");
  await expect(viewport.locator(".public-participant-route-control")).toHaveCount(1);
  const slider = page.getByRole("slider", { name: "Position i GPX-rutten" });
  await slider.fill("60000");
  await expect(viewport.locator(".public-route-playback-marker")).toHaveAttribute("cx", "200");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);

  for (let step = 0; step < 2; step += 1) await page.getByRole("button", { name: "Zooma in" }).click();
  await expect(page.getByText("Förstoring: 200 %")).toBeVisible();
  const twoTimes = await viewport.evaluate(element => ({ width: element.scrollWidth, visible: element.clientWidth }));
  expect(twoTimes.width).toBeGreaterThan(twoTimes.visible);
  await viewport.evaluate(element => { element.scrollLeft = (element.scrollWidth - element.clientWidth) / 2; });
  const centerBefore = await viewport.evaluate(element => (element.scrollLeft + element.clientWidth / 2) / element.scrollWidth);
  for (let step = 0; step < 4; step += 1) await page.getByRole("button", { name: "Zooma in" }).click();
  await expect(page.getByText("Förstoring: 400 %")).toBeVisible();
  await expect(page.getByRole("button", { name: "Zooma in" })).toBeDisabled();
  const centerAfter = await viewport.evaluate(element => (element.scrollLeft + element.clientWidth / 2) / element.scrollWidth);
  expect(Math.abs(centerAfter - centerBefore)).toBeLessThan(0.04);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const leftBefore = await viewport.evaluate(element => element.scrollLeft);
  await viewport.focus();
  await page.keyboard.press("ArrowRight");
  expect(await viewport.evaluate(element => element.scrollLeft)).toBeGreaterThan(leftBefore);
  await page.keyboard.press("ArrowDown");
  expect(await viewport.evaluate(element => element.scrollTop)).toBeGreaterThan(0);
  await expect(map.locator("path")).toHaveAttribute("d", "M100 300 L200 200 ");
  await expect(viewport.locator(".public-route-playback-marker")).toHaveAttribute("cx", "200");

  await page.emulateMedia({ media: "print" });
  const printWidth = (await map.boundingBox())?.width ?? Infinity;
  expect(printWidth).toBeLessThanOrEqual(320);
  await page.emulateMedia({ media: "screen" });
  await page.getByRole("button", { name: "Visa hela kartan" }).click();
  await expect(page.getByText("Förstoring: 100 %")).toBeVisible();
  expect(await viewport.evaluate(element => element.scrollLeft)).toBe(0);
  expect(await viewport.evaluate(element => element.scrollTop)).toBe(0);
  await page.screenshot({ path: test.info().outputPath("public-route-zoom-320.png"), fullPage: true });
});

test("TASK239 visar ingen kartkontroll när rutten inte är tillgänglig", async ({ page }) => {
  await mountRoute(page, true);
  await expect(page.getByRole("alert")).toContainText("Rutten är inte tillgänglig.");
  await expect(page.getByRole("button", { name: "Zooma in" })).toHaveCount(0);
  await expect(page.locator(".public-route-map-viewport")).toHaveCount(0);
});

test("TASK239 håller helkartan inom sidan vid 390 och 1280px", async ({ page }) => {
  for (const width of [390, 1280]) {
    await page.setViewportSize({ width, height: 844 });
    await mountRoute(page);
    const viewport = page.locator(".public-route-map-viewport");
    await expect(viewport.locator("svg")).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect(await viewport.evaluate(element => element.scrollWidth <= element.clientWidth + 2)).toBe(true);
    await page.getByRole("button", { name: "Zooma in" }).click();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: test.info().outputPath(`public-route-zoom-${width}.png`), fullPage: true });
  }
});
