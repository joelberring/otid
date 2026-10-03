import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { expect, test, type Page } from "@playwright/test";

const raceId = "10000000-0000-4000-8000-000000000001";
const nodeRequire = createRequire(resolve("package.json"));
const esbuild = nodeRequire(nodeRequire.resolve("esbuild", { paths: [nodeRequire.resolve("tsx")] })) as {
  build(options: Record<string, unknown>): Promise<{ outputFiles: { text: string }[] }>;
};

async function mountMap(page: Page, imageUnavailable = false) {
  const css = await readFile(resolve("apps/web/src/app/globals.css"), "utf8");
  const bundle = await esbuild.build({
    entryPoints: [resolve("apps/web/test/fixtures/public-map-browser.tsx")],
    bundle: true, platform: "browser", format: "iife", write: false,
    jsx: "automatic", define: { "process.env.NODE_ENV": '"test"' }
  });
  await page.route(`**/api/public/races/${raceId}/map`, route => route.fulfill(imageUnavailable
    ? { status: 404, body: "" }
    : { status: 200, contentType: "image/svg+xml",
      body: '<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="800"><rect width="1000" height="800" fill="#e6e7e4"/><path d="M0 400H1000M500 0V800" stroke="#bfc6c0" stroke-width="3"/></svg>' }));
  await page.route("http://127.0.0.1:3397/", route => route.fulfill({ status: 200, contentType: "text/html", body: "<!doctype html><title>Syntetisk karta</title>" }));
  await page.goto("http://127.0.0.1:3397/");
  await page.setContent(`<!doctype html><html lang="sv"><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style></head><body><header>O-Tid</header><main class="stack public-map-page"><nav class="nav"><a href="#results">Till resultatlistan</a></nav><section class="public-map-context"><p>Syntetiskt kartsläpp · Individuellt</p><h1>Karta</h1><p>Syntetisk orienteringskarta</p></section><div id="public-map-test-root"></div></main></body></html>`);
  await page.addScriptTag({ content: bundle.outputFiles[0]!.text });
}

test("TASK241 publik karta zoomar och panorerar utan obunden dragning vid 320px", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 844 });
  await mountMap(page);
  const viewport = page.getByRole("region", { name: "Tävlingskarta" });
  const image = page.getByRole("img", { name: "Syntetisk orienteringskarta" });
  await expect(image).toBeVisible();
  await expect.poll(() => image.evaluate(element => (element as HTMLImageElement).naturalWidth)).toBe(1000);
  await expect(page.getByText("Förstoring: 100 %")).toBeVisible();
  await expect(page.getByRole("button", { name: "Zooma ut" })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Visa hela kartan" })).toBeDisabled();
  const initial = await image.boundingBox();
  if (!initial) throw new Error("Public map image missing");
  expect(initial.width / initial.height).toBeCloseTo(1.25, 1);
  expect(await viewport.evaluate(element => element.scrollWidth <= element.clientWidth + 2)).toBe(true);
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
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);

  await page.emulateMedia({ media: "print" });
  expect((await image.boundingBox())?.width ?? Infinity).toBeLessThanOrEqual(320);
  await page.emulateMedia({ media: "screen" });
  await page.getByRole("button", { name: "Visa hela kartan" }).click();
  await expect(page.getByText("Förstoring: 100 %")).toBeVisible();
  expect(await viewport.evaluate(element => element.scrollLeft)).toBe(0);
  expect(await viewport.evaluate(element => element.scrollTop)).toBe(0);
  await page.screenshot({ path: test.info().outputPath("public-map-320.png"), fullPage: true });
});

test("TASK241 kartan får plats på 390 och 1280px utan ny sidspill", async ({ page }) => {
  for (const width of [390, 1280]) {
    await page.setViewportSize({ width, height: 844 });
    await mountMap(page);
    const image = page.getByRole("img", { name: "Syntetisk orienteringskarta" });
    await expect.poll(() => image.evaluate(element => (element as HTMLImageElement).naturalWidth)).toBe(1000);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.getByRole("button", { name: "Zooma in" }).click();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: test.info().outputPath(`public-map-${width}.png`), fullPage: true });
  }
});

test("TASK241 bildfel visar text utan oanvändbara zoomverktyg", async ({ page }) => {
  await mountMap(page, true);
  await expect(page.getByRole("alert")).toContainText("Kartbilden kunde inte visas. Försök att ladda om sidan.");
  await expect(page.getByRole("button", { name: "Zooma in" })).toHaveCount(0);
  await expect(page.locator(".public-map-viewport")).toHaveCount(0);
});
