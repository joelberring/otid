import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { expect, test } from "@playwright/test";

test("TASK237 neutral tät publik deltagardetalj med rutt och print", async ({ page }) => {
  const css = await readFile(resolve("apps/web/src/app/globals.css"), "utf8");
  // CSS-only fixture mirroring the public detail/route markup. No Next server,
  // component hydration, database or real participant data is involved.
  const html = `<!doctype html><html lang="sv"><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style></head>
    <body><header>O-Tid · Tävlingskärna</header><main class="stack public-result-detail-page">
      <nav class="nav"><a href="#resultat">Tillbaka till resultat</a></nav>
      <section class="public-result-detail-heading"><h1>Syntetisk tävling</h1><p>Lång · 2026-09-27</p><a href="#karta">Visa karta</a></section>
      <section class="panel public-result-detail-surface"><article class="public-result-detail">
        <header><p class="muted">H21</p><h2>Bo Kontroll</h2><p>Syntetiska OK</p></header>
        <dl><div><dt>Placering</dt><dd>–</dd></div><div><dt>Status</dt><dd class="result-mp">Felstämplad<br><small>Obligatorisk kontroll saknas</small></dd></div>
          <div><dt>Tid</dt><dd>1:05:00</dd></div><div><dt>Efter</dt><dd>–</dd></div></dl>
        <p><strong>Saknas:</strong> 42</p><p><strong>Extra:</strong> 99</p>
        <details><summary>Visa sträcktider</summary><ol><li><span><strong>Kontroll</strong> 31</span><span><strong>Sträcka</strong> 21:40</span><span><strong>Totalt</strong> 21:40</span></li></ol></details>
      </article></section>
      <section class="public-result-route-summary"><div><h2>Publicerad rutt</h2><p>Rutt finns att visa</p></div>
        <dl><div><dt>Distans</dt><dd>5,1 km</dd></div><div><dt>Punkter</dt><dd>118</dd></div><div><dt>Segment</dt><dd>1</dd></div><div><dt>Registrerad tid</dt><dd>Ej tillgänglig</dd></div></dl>
        <div class="public-result-route-summary-actions"><a class="public-result-route-summary-link" href="#rutt">Visa rutt</a>
          <section class="public-link-share"><button class="secondary" type="button">Kopiera länk</button></section></div></section>
    </main></body></html>`;
  for (const width of [320, 390, 1280]) {
    await page.setViewportSize({ width, height: 844 });
    await page.setContent(html);
    await expect(page.locator(".public-result-detail")).toContainText("Bo Kontroll");
    await expect(page.locator(".public-result-detail")).toContainText("Saknas: 42");
    await expect(page.locator(".public-result-detail")).toContainText("Extra: 99");
    await expect(page.locator(".public-result-route-summary")).toContainText("Visa rutt");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await expect(page.locator(".public-result-detail dl > div").first()).toHaveCSS("border-radius", "0px");
    const leftBorder = await page.locator(".public-result-route-summary").evaluate(element => parseFloat(getComputedStyle(element).borderLeftWidth));
    expect(leftBorder).toBeLessThan(5);
    const statusColor = await page.locator(".result-mp").evaluate(element => getComputedStyle(element).color);
    const ordinaryColor = await page.locator(".public-result-detail dd").first().evaluate(element => getComputedStyle(element).color);
    expect(statusColor).not.toBe(ordinaryColor);
    if (width <= 640) {
      const touchTargets = page.locator(".public-result-detail-page > .nav a, .public-result-detail-heading a, .public-result-detail summary, .public-result-route-summary a, .public-result-route-summary button");
      for (const target of await touchTargets.all()) expect((await target.boundingBox())?.height).toBeGreaterThanOrEqual(44);
    }
    await page.screenshot({ path: test.info().outputPath(`public-detail-${width}.png`), fullPage: true });
  }
  await page.emulateMedia({ media: "print" });
  await expect(page.locator("header").first()).toBeHidden();
  await expect(page.locator(".nav")).toBeHidden();
  await expect(page.locator(".public-result-detail > header")).toBeVisible();
  await expect(page.locator(".public-result-detail")).toContainText("Felstämplad");
});
