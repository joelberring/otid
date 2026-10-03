import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { expect, test, type Page } from "@playwright/test";

const raceId = "10000000-0000-4000-8000-000000000001";
const nodeRequire = createRequire(resolve("package.json"));
const esbuild = nodeRequire(nodeRequire.resolve("esbuild", { paths: [nodeRequire.resolve("tsx")] })) as {
  build(options: Record<string, unknown>): Promise<{ outputFiles: { text: string }[] }>;
};

function participant(name: string, x: number, y: number) {
  return {
    participant: { givenName: name, familyName: "Kontroll" },
    resultSplits: { status: "AVAILABLE", splits: [{ controlCode: 31, occurrence: 1, legMs: 60_000, elapsedMs: 60_000 }] },
    points: [{ x, y, segment: 0 }, { x: x + 140, y: y - 100, segment: 0 }],
    metadata: { distanceMeters: 1234, pointCount: 2, segmentCount: 1, timing: {
      status: "AVAILABLE", startedAt: "2026-09-21T10:00:00.000Z",
      finishedAt: "2026-09-21T10:01:00.000Z", durationMilliseconds: 60_000
    } },
    playback: { status: "AVAILABLE", pointElapsedMilliseconds: [0, 60_000] }
  };
}

async function mountComparison(page: Page, routeCount: 2 | 3, unavailable?: 404 | 503) {
  const css = await readFile(resolve("apps/web/src/app/globals.css"), "utf8");
  const bundle = await esbuild.build({
    entryPoints: [resolve("apps/web/test/fixtures/public-route-comparison-browser.tsx")],
    bundle: true, platform: "browser", format: "iife", write: false,
    jsx: "automatic", define: { "process.env.NODE_ENV": '"test"' }
  });
  await page.route(new RegExp(`/api/public/races/${raceId}/route-comparison(?:/map)?\\?`), route => {
    const pathname = new URL(route.request().url()).pathname;
    if (pathname.endsWith("/map")) return route.fulfill({ status: 200, contentType: "image/svg+xml",
      body: '<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="500"><rect width="1000" height="500" fill="#ecebe6"/></svg>' });
    if (unavailable) return route.fulfill({ status: unavailable, json: { formatVersion: 1, error: "UNAVAILABLE" } });
    const routes = [participant("Ada", 100, 300), participant("Bea", 120, 280)];
    if (routeCount === 3) routes.push(participant("Cy", 140, 260));
    return route.fulfill({ status: 200, json: {
      formatVersion: routeCount, imageWidth: 1000, imageHeight: 500,
      notice: "ROUTE_COMPARISON_NOT_GPS_VERIFIED", routes,
      controls: [{ sequence: 1, controlCode: 31, x: 120, y: 280 }]
    } });
  });
  await page.route("http://127.0.0.1:3398/", route => route.fulfill({ status: 200, contentType: "text/html", body: "<!doctype html><title>Syntetisk jämförelse</title>" }));
  await page.goto("http://127.0.0.1:3398/");
  await page.setContent(`<!doctype html><html lang="sv"><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style></head><body><header>O-Tid</header><main class="stack public-route-comparison-page"><nav class="nav"><a href="#results">Till resultaten</a></nav><h1>Jämför deltagarrutter</h1><div id="public-comparison-test-root" data-third="${routeCount === 3}"></div></main></body></html>`);
  await page.addScriptTag({ content: bundle.outputFiles[0]!.text });
}

test("TASK240 två rutter zoomar i samma karta utan sidspill vid 320px", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 844 });
  const mapResponses: number[] = [];
  const mapRequests: string[] = [];
  page.on("request", request => {
    if (request.url().includes("/route-comparison/map")) mapRequests.push(request.url());
  });
  page.on("response", response => {
    if (new URL(response.url()).pathname.endsWith("/route-comparison/map")) mapResponses.push(response.status());
  });
  await mountComparison(page, 2);
  const viewport = page.getByRole("region", { name: "Flyttbar karta med två deltagarrutter" });
  const map = viewport.getByRole("img", { name: "Karta med två deltagarrutter" });
  await expect(map).toBeVisible();
  await expect.poll(() => mapRequests.length).toBeGreaterThan(0);
  await expect.poll(() => mapResponses, { message: JSON.stringify(mapRequests) }).toContain(200);
  await expect(page.getByText("Förstoring: 100 %")).toBeVisible();
  await expect(page.getByRole("button", { name: "Zooma ut" })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Visa hela kartan" })).toBeDisabled();
  await expect(map.locator("path")).toHaveCount(2);
  await expect(page.getByText("Röd rutt: Ada Kontroll").first()).toBeVisible();
  await expect(page.getByText("Blå rutt: Bea Kontroll").first()).toBeVisible();
  await expect(viewport.locator(".public-participant-route-control")).toHaveCount(1);
  const splits = page.locator(".public-route-comparison-splits");
  await expect(splits.getByText("Svep tabellen i sidled för att se båda rutternas tider.")).toBeVisible();
  await expect(splits.getByRole("columnheader", { name: "Kontroll", exact: true })).toHaveCSS("white-space", "nowrap");
  await expect(splits.getByRole("columnheader", { name: "Röd rutt: Ada Kontroll · Sträcka" })).toBeVisible();
  expect(await splits.evaluate(element => element.scrollWidth > element.clientWidth)).toBe(true);
  await page.getByRole("slider", { name: "Relativ tid i båda GPX-rutterna" }).fill("60000");
  await expect(viewport.locator(".public-route-comparison-playback-marker")).toHaveCount(2);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);

  for (let step = 0; step < 2; step += 1) await page.getByRole("button", { name: "Zooma in" }).click();
  await expect(page.getByText("Förstoring: 200 %")).toBeVisible();
  expect(await viewport.evaluate(element => element.scrollWidth > element.clientWidth)).toBe(true);
  await viewport.evaluate(element => { element.scrollLeft = (element.scrollWidth - element.clientWidth) / 2; });
  const centerBefore = await viewport.evaluate(element => (element.scrollLeft + element.clientWidth / 2) / element.scrollWidth);
  for (let step = 0; step < 4; step += 1) await page.getByRole("button", { name: "Zooma in" }).click();
  await expect(page.getByText("Förstoring: 400 %")).toBeVisible();
  await expect(page.getByRole("button", { name: "Zooma in" })).toBeDisabled();
  const centerAfter = await viewport.evaluate(element => (element.scrollLeft + element.clientWidth / 2) / element.scrollWidth);
  expect(Math.abs(centerAfter - centerBefore)).toBeLessThan(0.04);
  const leftBefore = await viewport.evaluate(element => element.scrollLeft);
  await viewport.focus();
  await page.keyboard.press("ArrowRight");
  expect(await viewport.evaluate(element => element.scrollLeft)).toBeGreaterThan(leftBefore);
  await page.keyboard.press("ArrowDown");
  expect(await viewport.evaluate(element => element.scrollTop)).toBeGreaterThan(0);
  await expect(map.locator("path")).toHaveCount(2);
  await expect(viewport.locator(".public-route-comparison-playback-marker")).toHaveCount(2);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);

  await page.emulateMedia({ media: "print" });
  expect((await map.boundingBox())?.width ?? Infinity).toBeLessThanOrEqual(320);
  await page.emulateMedia({ media: "screen" });
  await page.getByRole("button", { name: "Visa hela kartan" }).click();
  await expect(page.getByText("Förstoring: 100 %")).toBeVisible();
  expect(await viewport.evaluate(element => element.scrollLeft)).toBe(0);
  await page.screenshot({ path: test.info().outputPath("comparison-320.png"), fullPage: true });
});

test("TASK240 tre rutter förblir läsbara vid 390 och 1280px", async ({ page }) => {
  for (const width of [390, 1280]) {
    await page.setViewportSize({ width, height: 844 });
    await mountComparison(page, 3);
    const viewport = page.getByRole("region", { name: "Flyttbar karta med tre deltagarrutter" });
    const map = viewport.getByRole("img", { name: "Karta med tre deltagarrutter" });
    await expect(map).toBeVisible();
    await expect(map.locator("path")).toHaveCount(3);
    await expect(page.getByText("Grön rutt: Cy Kontroll").first()).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.getByRole("button", { name: "Zooma in" }).click();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: test.info().outputPath(`comparison-${width}.png`), fullPage: true });
  }
});

test("TASK240 otillgänglig jämförelse visar inga kartverktyg", async ({ page }) => {
  for (const status of [404, 503] as const) {
    await mountComparison(page, 2, status);
    await expect(page.getByRole("alert")).toBeVisible();
    await expect(page.getByRole("button", { name: "Zooma in" })).toHaveCount(0);
    await expect(page.locator(".public-route-comparison-map-viewport")).toHaveCount(0);
  }
});
