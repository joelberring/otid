import { expect, test } from "@playwright/test";
import { publicStartListResponseSchema, startListAdminListResponseSchema } from "@o-tid/contracts";

const raceId = "10000000-0000-4000-8000-000000000001";
const fixedClass = "20000000-0000-4000-8000-000000000001";
const punchClass = "20000000-0000-4000-8000-000000000002";
const data = startListAdminListResponseSchema.parse({
  formatVersion: 1, raceId, snapshotVersion: 7, timeZone: "Europe/Stockholm", generatedAt: "2026-09-08T08:00:00Z",
  classes: [
    { id: fixedClass, name: "D21", startRule: "FIXED", entries: [
      { id: "30000000-0000-4000-8000-000000000001", displayName: "Åsa Exempel", organisationName: "Testklubben",
        fixedStartTime: "2026-09-08T09:01:00Z", cardNumber: "123456", multipleActiveAssignments: false },
      { id: "30000000-0000-4000-8000-000000000002", displayName: "Bo Exempel", organisationName: null,
        fixedStartTime: null, cardNumber: null, multipleActiveAssignments: true }
    ] },
    { id: punchClass, name: "Öppen 5", startRule: "PUNCH", entries: [
      { id: "30000000-0000-4000-8000-000000000003", displayName: "Cecilia Exempel", organisationName: "Testklubben",
        fixedStartTime: null, cardNumber: "654321", multipleActiveAssignments: false },
      { id: "30000000-0000-4000-8000-000000000004", displayName: "David Exempel", organisationName: null,
        fixedStartTime: null, cardNumber: null, multipleActiveAssignments: false }
    ] }
  ]
});

const publicData = publicStartListResponseSchema.parse({
  formatVersion: 1, revision: 3, publishedAt: "2026-09-08T08:00:00Z", iofExportAvailable: true,
  content: { eventName: "Syntetisk skärgårdshelg", raceName: "Lång", raceDate: "2026-09-08",
    timeZone: "Europe/Stockholm", classes: [
      { name: "D21", startRule: "FIXED", entries: Array.from({ length: 12 }, (_, index) => ({
        displayName: index === 1 ? "Åsa Deltagare" : `Deltagare ${String(index + 1).padStart(2, "0")}`,
        organisationName: index === 3 ? "En syntetisk förening med långt namn" : "Testklubben",
        fixedStartTime: new Date(Date.UTC(2026, 8, 8, 9, index)).toISOString()
      })) },
      { name: "Öppen 5", startRule: "PUNCH", entries: [
        { displayName: "Ada Fritt", organisationName: "Testklubben", fixedStartTime: null },
        { displayName: "Bo Fritt", organisationName: null, fixedStartTime: null }
      ] },
      { name: "H34", startRule: "PUNCH", entries: [] }
    ] }
});

test("publicerad startlista använder täta kolumner på bred skärm och staplad mobilvy", async ({ page }) => {
  await page.route(`**/api/races/${raceId}/start-list`, route => route.fulfill({ status: 200, json: publicData }));
  await page.setViewportSize({ width: 1366, height: 768 });
  await page.goto(`/starts/${raceId}`);
  const content = page.getByRole("region", { name: "Planerad startlista – inte faktisk start" });
  const fixedRows = content.getByRole("heading", { name: "D21", exact: true }).locator("../..").locator("article");
  await expect(fixedRows).toHaveCount(12);
  await expect(content).not.toContainText("123456");
  await expect(fixedRows.first()).toContainText("11:00:00 GMT+02:00");
  for (const width of [1366, 768, 700, 390]) {
    await page.setViewportSize({ width, height: 768 });
    const columns = await fixedRows.first().evaluate(element => getComputedStyle(element).gridTemplateColumns.split(" ").length);
    expect(columns).toBe(width > 680 ? 3 : 1);
    if (width > 680) expect((await fixedRows.first().boundingBox())!.height).toBeLessThan(60);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: test.info().outputPath(`public-start-list-${width}.png`), fullPage: true });
  }
  await content.getByRole("combobox", { name: "Klass" }).selectOption({ label: "Öppen 5" });
  await expect(content.getByRole("heading", { name: "Ada Fritt" })).toBeVisible();
  await expect(content.getByRole("heading", { name: "Deltagare 01" })).toHaveCount(0);
  await content.getByRole("combobox", { name: "Klass" }).selectOption({ label: "Alla klasser" });
  const search = content.getByRole("searchbox", { name: "Sök namn eller klubb" });
  await expect(content.getByText("Visar 14 av 14 deltagare")).toBeVisible();
  await expect(content.getByRole("heading", { name: "H34", exact: true })).toBeVisible();
  await search.fill(" A\u030aSA ");
  await expect(content.getByRole("heading", { name: "Åsa Deltagare" })).toBeVisible();
  await expect(content.locator("article")).toHaveCount(1);
  await expect(content).toContainText("Visar 1 av 14 deltagare");
  await expect(content).toContainText("Filtret ändrar bara visningen här");
  await expect(content.getByRole("heading", { name: "H34", exact: true })).toHaveCount(0);
  await search.fill("En syntetisk förening");
  await expect(content.locator("article")).toHaveCount(1);
  await expect(content.getByRole("heading", { name: "Deltagare 04" })).toBeVisible();
  await content.getByRole("combobox", { name: "Klass" }).selectOption({ label: "Öppen 5" });
  await expect(content.locator("article")).toHaveCount(0);
  await expect(content).toContainText("Inga deltagare matchar sökning och klassval.");
  await search.fill("testklubben");
  await expect(content.locator("article")).toHaveCount(1);
  await expect(content.getByRole("heading", { name: "Ada Fritt" })).toBeVisible();
  await expect(content.getByRole("heading", { name: "Deltagare 01" })).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: test.info().outputPath("public-start-list-filtered-390.png"), fullPage: true });
  await page.emulateMedia({ media: "print" });
  const printSelection = content.getByText("Utskrivet urval från startlistan", { exact: false });
  await expect(printSelection).toBeVisible();
  await expect(printSelection).toContainText("Visar 1 av 14 deltagare");
  await expect(printSelection).toContainText("Sök namn eller klubb: testklubben");
  await page.emulateMedia({ media: "screen" });
  await content.getByRole("button", { name: "Rensa filter" }).click();
  await expect(search).toHaveValue("");
  await expect(content.locator("article")).toHaveCount(14);
  await expect(content.getByRole("heading", { name: "H34", exact: true })).toBeVisible();
  const names = await fixedRows.locator("h4").allTextContents();
  expect(names.slice(0, 3)).toEqual(["Deltagare 01", "Åsa Deltagare", "Deltagare 03"]);
  await page.emulateMedia({ media: "print" });
  expect(await fixedRows.first().evaluate(element => getComputedStyle(element).gridTemplateColumns.split(" ").length)).toBe(1);
  await expect(fixedRows.first()).toBeVisible();
  await page.emulateMedia({ media: "screen" });
});

for (const viewport of [{ width: 1366, height: 768 }, { width: 390, height: 844 }]) {
  test(`start list ${viewport.width}: combined search, start rules, stale data and clearing`, async ({ page }) => {
    await page.setViewportSize(viewport);
    let authenticated = false, unavailable = false;
    await page.route("**/api/**", async route => {
      const path = new URL(route.request().url()).pathname;
      if (path === `/api/admin/races/${raceId}/start-list-session`) {
        authenticated = route.request().method() === "POST";
        return route.fulfill({ status: 200, json: { formatVersion: 1, raceId, capability: "VIEW_START_LIST",
          expiresAt: "2099-01-01T00:00:00Z" } });
      }
      if (path === `/api/admin/races/${raceId}/start-list`) {
        return route.fulfill({ status: !authenticated ? 401 : unavailable ? 503 : 200,
          json: authenticated && !unavailable ? data : { formatVersion: 1, error: "UNAUTHORIZED" } });
      }
      return route.abort();
    });
    await page.goto(`/admin/${raceId}/start-list`);
    const component = page.locator(".start-list-admin");
    const printButton = component.getByRole("button", { name: "Skriv ut urval", exact: true });
    await expect(printButton).toHaveCount(0);
    await expect(component.getByText("Åsa Exempel", { exact: true })).toHaveCount(0);
    await page.getByLabel("Startlistebehörighet", { exact: true }).fill(`otid_org_start_list_v1.${raceId}.${"a".repeat(43)}`);
    await page.getByRole("button", { name: "Logga in", exact: true }).click();
    const rows = component.locator(".start-list-table tbody tr");
    await expect(rows).toHaveCount(4);
    await expect(rows.nth(0)).toContainText("11:01:00"); // Browser is in New York, race is Stockholm.
    await expect(rows.nth(1)).toContainText("Starttid saknas");
    await expect(rows.nth(1)).toContainText("Flera aktiva brickor");
    await expect(rows.nth(2)).toContainText("Startstämpling");
    await expect(rows.nth(3)).toContainText("Ingen aktiv bricka");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: test.info().outputPath(`start-list-${viewport.width}.png`), fullPage: true });
    const search = component.getByRole("searchbox");
    await search.fill("a\u030asa");
    await expect(rows).toHaveCount(1);
    await expect(rows).toContainText("Åsa Exempel");
    await search.fill("TESTKLUBBEN");
    await expect(rows).toHaveCount(2);
    await component.getByRole("combobox").selectOption(punchClass);
    await expect(rows).toHaveCount(1);
    await expect(rows).toContainText("Cecilia Exempel");
    await search.fill("123456");
    await expect(rows).toHaveCount(0);
    await expect(printButton).toHaveCount(0);
    await component.getByRole("combobox").selectOption("");
    await expect(rows).toHaveCount(1);
    await component.getByRole("button", { name: "Rensa filter", exact: true }).click();
    await expect(search).toHaveValue("");
    await expect(rows).toHaveCount(4);
    unavailable = true;
    await page.getByRole("button", { name: "Uppdatera startlista", exact: true }).click();
    await expect(component.getByRole("alert")).toContainText("kan vara gamla");
    await expect(rows).toHaveCount(4);
    await component.getByRole("combobox").selectOption(fixedClass);
    await search.fill("Bo");
    await page.evaluate(() => { window.print = () => { document.body.dataset.printRequested = "yes"; }; });
    await printButton.click();
    expect(await page.locator("body").getAttribute("data-print-requested")).toBe("yes");
    await page.emulateMedia({ media: "print" });
    const printContext = component.locator(".start-list-print-context");
    await expect(printContext).toBeVisible();
    await expect(printContext).toContainText(raceId);
    await expect(printContext).toContainText("D21");
    await expect(printContext).toContainText("Bo");
    await expect(printContext).toContainText("Europe/Stockholm");
    await expect(printContext).toContainText("10:00:00");
    await expect(printContext).toContainText("7");
    await expect(component.locator(".start-list-toolbar")).toBeHidden();
    await expect(search).toBeHidden();
    await expect(component.getByRole("alert")).toBeVisible();
    await expect(rows).toHaveCount(1);
    await expect(rows).toContainText("Bo Exempel");
    await expect(rows).toContainText("Flera aktiva brickor");
    await expect(component.locator(".start-list-table")).toHaveCSS("display", "table");
    await expect(component.locator(".start-list-table thead")).toHaveCSS("display", "table-header-group");
    await expect(rows).toHaveCSS("display", "table-row");
    await page.screenshot({ path: test.info().outputPath(`start-list-print-${viewport.width}.png`), fullPage: true });
    await page.emulateMedia({ media: "screen" });
    await expect(printContext).toBeHidden();
    await component.getByRole("combobox").selectOption("");
    await search.fill("Åsa");
    if (viewport.width > 1000) {
      authenticated = false;
      await page.getByRole("button", { name: "Uppdatera startlista", exact: true }).click();
    } else {
      await page.context().addCookies([{ name: "otid_start_list_admin_csrf", value: "c".repeat(43),
        url: test.info().project.use.baseURL as string }]);
      await page.getByRole("button", { name: "Logga ut", exact: true }).click();
    }
    await expect(component.getByText("Åsa Exempel", { exact: true })).toHaveCount(0);
    await expect(search).toHaveCount(0);
    await expect(printButton).toHaveCount(0);
    unavailable = false;
    await page.getByLabel("Startlistebehörighet", { exact: true }).fill(`otid_org_start_list_v1.${raceId}.${"a".repeat(43)}`);
    await page.getByRole("button", { name: "Logga in", exact: true }).click();
    await expect(search).toHaveValue("");
    await expect(rows).toHaveCount(4);
  });
}
