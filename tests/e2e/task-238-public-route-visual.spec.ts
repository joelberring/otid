import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { expect, test } from "@playwright/test";

test("TASK238 neutral publik ruttvy behåller karta och tydlig GPX-varning", async ({ page }) => {
  const css = await readFile(resolve("apps/web/src/app/globals.css"), "utf8");
  // CSS-only visual fixture: the real component's fetch, release gate and
  // playback conditions are not exercised without the isolated DB suite.
  const html = `<!doctype html><html lang="sv"><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style></head>
    <body><header>O-Tid · Tävlingskärna</header><main class="stack public-participant-route-page">
      <nav class="nav"><a href="#resultat">Till resultatet</a></nav>
      <section class="public-participant-route-context"><p>Syntetisk tävling</p><h1>Bo Kontroll</h1><p>Lång · 2026-09-27</p><p class="muted">Klass: H21</p></section>
      <h2>Deltagarens rutt</h2>
      <section class="public-participant-route stack">
        <section class="public-link-share"><button class="secondary" type="button">Kopiera länk</button></section>
        <dl class="public-participant-route-metadata"><div><dt>Distans</dt><dd>5,1 km</dd></div><div><dt>Punkter</dt><dd>118</dd></div>
          <div><dt>Segment</dt><dd>1</dd></div><div><dt>GPX-tid (UTC)</dt><dd>1:05:00</dd></div></dl>
        <p>Rutten är inte GPS-verifierad.</p>
        <section class="public-route-playback" aria-label="Spela upp GPX-rutt"><h2>Spela upp GPX-rutt</h2>
          <p>Tidsaxeln följer GPX-filens relativa inspelningstid, inte tävlingstid eller kontrollpassager.</p>
          <div><button type="button">Spela</button><button type="button">Börja om</button><output>0:00 / 1:05:00</output></div>
          <label>Position i GPX-rutten<input type="range" min="0" max="3900000" value="0"></label></section>
        <svg viewBox="0 0 800 600" role="img" aria-label="Karta med deltagarens rutt">
          <rect x="0" y="0" width="800" height="600" fill="#eeeae0"/><path d="M100 450 L310 320 L600 170" fill="none" stroke="#c00020" stroke-width="3"/>
          <g class="public-participant-route-control" aria-label="Kontroll 1, kod 31"><circle cx="310" cy="320" r="10"/><text x="310" y="320" dy="0.35em" text-anchor="middle">1</text><text class="public-participant-route-control-code" x="325" y="304">31</text></g>
          <circle class="public-route-playback-marker" cx="100" cy="450" r="7"/></svg>
      </section>
    </main></body></html>`;
  for (const width of [320, 390, 1280]) {
    await page.setViewportSize({ width, height: 844 });
    await page.setContent(html);
    await expect(page.locator(".public-participant-route-context")).toContainText("Bo Kontroll");
    await expect(page.locator(".public-participant-route > p")).toContainText("inte GPS-verifierad");
    await expect(page.locator(".public-route-playback")).toContainText("inte tävlingstid");
    await expect(page.locator(".public-participant-route-control-code")).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await expect(page.locator(".public-participant-route-metadata > div").first()).toHaveCSS("border-radius", "0px");
    await expect(page.locator(".public-route-playback")).toHaveCSS("border-radius", "0px");
    const mapWidth = (await page.locator(".public-participant-route svg").boundingBox())?.width ?? Infinity;
    expect(mapWidth).toBeLessThanOrEqual(width);
    await expect(page.locator(".public-participant-route svg path")).toHaveAttribute("stroke", "#c00020");
    const warningBorder = await page.locator(".public-participant-route > p").evaluate(element => getComputedStyle(element).borderLeftColor);
    const ordinaryColor = await page.locator(".public-participant-route-context p").first().evaluate(element => getComputedStyle(element).color);
    expect(warningBorder).not.toBe(ordinaryColor);
    if (width <= 640) {
      const touchTargets = page.locator(".public-participant-route-page > nav a, .public-link-share button, .public-route-playback button, .public-route-playback input");
      for (const target of await touchTargets.all()) expect((await target.boundingBox())?.height).toBeGreaterThanOrEqual(44);
      expect((await page.locator(".public-participant-route-control-code").boundingBox())?.height).toBeGreaterThanOrEqual(9);
    }
    await page.screenshot({ path: test.info().outputPath(`public-route-${width}.png`), fullPage: true });
  }
});
