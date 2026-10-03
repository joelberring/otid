import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { expect, test } from "@playwright/test";

const raceId = "10000000-0000-4000-8000-000000000001";

test("TASK236 neutral tät publik resultatlista med bevarade signaler och print", async ({ page }) => {
  const css = await readFile(resolve("apps/web/src/app/globals.css"), "utf8");
  // CSS-only browser fixture mirrors the public component's row structure;
  // component behavior is checked separately. No server or database is used.
  const results = `<p class="public-results-refresh-status">Uppdaterar resultat</p>
    <section class="public-results-controls"><label>Sök namn eller klubb<input type="search"></label>
      <label>Klass<select><option>Alla klasser</option></select></label>
      <label class="public-results-favorites-only"><input type="checkbox">Visa bara mina favoriter</label>
      <p>Visar 3 av 3 deltagare</p></section>
    <section class="public-results-route-comparison"><p>0 av 3 rutter valda för jämförelse</p><small>Välj minst två rutter</small></section>
    <div class="public-results"><table class="public-results-table"><thead><tr><th>Klass</th><th>Placering</th><th>Deltagare</th><th>Status</th><th>Tid</th><th>Efter</th><th>Sträcktider</th></tr></thead><tbody>
      <tr><td class="public-result-class" data-label="Klass">H21</td><td data-label="Placering">1</td>
        <td class="public-result-participant" data-label="Deltagare"><a href="#ada">Ada Löpare</a><small>Syntetiska OK</small><span class="public-result-actions"><button>Spara favorit</button><button class="public-result-route-comparison">Välj rutt för jämförelse</button></span></td>
        <td class="result-ok" data-label="Status">Godkänt resultat<br><small>Alla kontroller</small></td><td data-label="Tid">1:02:05</td><td data-label="Efter">+0:00</td>
        <td class="public-result-details" data-label="Sträcktider"><details><summary>Visa sträcktider</summary><ol><li>31 · 20:00</li></ol></details></td></tr>
      <tr><td class="public-result-class" data-label="Klass">H21</td><td data-label="Placering">–</td>
        <td class="public-result-participant" data-label="Deltagare"><a href="#bo">Bo Kontroll</a><small>En syntetisk förening med längre namn</small><span class="public-result-actions"><button>Spara favorit</button><button class="public-result-route-comparison">Välj rutt för jämförelse</button></span></td>
        <td class="result-mp" data-label="Status">Felstämpling<br><small>Kontroll saknas</small></td><td data-label="Tid">1:05:00</td><td data-label="Efter">–</td>
        <td class="public-result-details" data-label="Sträcktider"><details><summary>Visa sträcktider</summary><ol><li>31 · 21:40</li></ol></details><small>Saknas: 42</small></td></tr>
      <tr><td class="public-result-class" data-label="Klass">Öppen 5</td><td data-label="Placering">–</td>
        <td class="public-result-participant" data-label="Deltagare"><a href="#cia">Cia Diskad</a><small>Ingen klubb</small><span class="public-result-actions"><button>Spara favorit</button><button class="public-result-route-comparison">Välj rutt för jämförelse</button></span></td>
        <td class="result-dsq" data-label="Status">Diskvalificerad<br><small>Beslut av arrangör</small></td><td data-label="Tid">–</td><td data-label="Efter">–</td><td class="public-result-details" data-label="Sträcktider"></td></tr>
    </tbody></table></div>`;
  const html = `<!doctype html><html lang="sv"><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style></head>
    <body><header>O-Tid · Tävlingskärna</header><main class="stack public-results-page">
      <nav class="nav" aria-label="Tävlingens sidor"><a href="/">Tävlingar</a><a href="/starts/${raceId}">Startlista</a></nav>
      <section class="public-results-heading"><h1>Syntetisk tävling</h1><p>Lång · 2026-09-27</p></section>
      <section class="panel public-results-surface">${results}</section></main></body></html>`;
  for (const width of [320, 390, 1280]) {
    await page.setViewportSize({ width, height: 844 });
    await page.setContent(html);
    const rows = page.locator(".public-results-table tbody tr");
    await expect(rows).toHaveCount(3);
    await expect(rows.nth(0)).toContainText("Ada Löpare");
    await expect(rows.nth(1)).toContainText("Bo Kontroll");
    await expect(rows.nth(1)).toContainText("Saknas: 42");
    await expect(rows.nth(2)).toContainText("Diskvalificerad");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    const mpColor = await rows.nth(1).locator(".result-mp").evaluate(element => getComputedStyle(element).color);
    const ordinaryColor = await rows.nth(0).locator(".public-result-participant a").evaluate(element => getComputedStyle(element).color);
    expect(mpColor).not.toBe(ordinaryColor);
    if (width <= 640) {
      await expect(rows.first()).toHaveCSS("border-radius", "0px");
      const touchTargets = page.locator(".nav a, .public-results-controls input[type=search], .public-results-controls select, .public-result-participant a, .public-result-actions button, .public-result-details summary");
      for (const target of await touchTargets.all()) expect((await target.boundingBox())?.height).toBeGreaterThanOrEqual(44);
    }
    await page.screenshot({ path: test.info().outputPath(`public-results-${width}.png`), fullPage: true });
  }
  await page.emulateMedia({ media: "print" });
  await expect(page.locator(".public-results-table")).toHaveCSS("display", "table");
  await expect(page.locator("header")).toBeHidden();
  await expect(page.locator(".nav")).toBeHidden();
});
