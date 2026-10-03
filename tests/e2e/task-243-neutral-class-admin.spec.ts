import { expect, test } from "@playwright/test";

const raceId = "10000000-0000-4000-8000-000000000001";
const entryId = "20000000-0000-4000-8000-000000000001";
const classId = "30000000-0000-4000-8000-000000000001";
const targetClassId = "30000000-0000-4000-8000-000000000002";
const data = {
  formatVersion: 1, raceId, snapshotVersion: 4,
  classes: [{ id: classId, name: "Öppen lång" }, { id: targetClassId, name: "D21" }],
  entries: Array.from({ length: 8 }, (_, index) => ({
    id: index === 0 ? entryId : `20000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
    displayName: index === 0 ? "Ada Löpare" : `Deltagare ${index + 1}`,
    organisationName: "Syntetiska OK", classId, version: 1
  }))
};

test("TASK243 separat klassadministration har lugn färg och tät läsbar layout", async ({ page }) => {
  const writes: string[] = [];
  await page.route(`**/api/admin/races/${raceId}/entry-classes`, route => route.fulfill({ status: 200, json: data }));
  await page.route(`**/api/races/${raceId}/entries/*/class`, route => {
    writes.push(route.request().method());
    return route.fulfill({ status: 503, json: { formatVersion: 1, error: "INTERNAL_ERROR" } });
  });
  await page.context().addCookies([{ name: "otid_entry_class_admin_csrf", value: "a".repeat(43),
    url: "http://127.0.0.1:3131" }]);

  for (const width of [320, 390, 1280]) {
    await page.setViewportSize({ width, height: 844 });
    await page.goto(`/admin/${raceId}/classes`);
    await expect(page.getByRole("heading", { name: "Deltagare och klasser" })).toBeVisible();
    await expect(page.locator(".entry-class-entry")).toHaveCount(8);
    await expect(page.locator(".entry-class-entry").first()).toContainText("Ada Löpare");
    const visual = await page.evaluate(() => {
      const header = document.querySelector("body > header");
      const action = document.querySelector<HTMLButtonElement>(".entry-class-entry button");
      const row = document.querySelector<HTMLElement>(".entry-class-entry");
      if (!header || !action || !row) throw new Error("Klassadminytan saknas");
      return { noPageOverflow: document.documentElement.scrollWidth <= innerWidth,
        headerBackground: getComputedStyle(header).backgroundColor,
        actionBackground: getComputedStyle(action).backgroundColor,
        actionHeight: action.getBoundingClientRect().height,
        rowHeight: row.getBoundingClientRect().height };
    });
    expect(visual.noPageOverflow).toBe(true);
    expect(visual.headerBackground).toBe("rgb(247, 248, 248)");
    expect(visual.actionBackground).toBe("rgb(236, 239, 236)");
    expect(visual.actionHeight).toBeGreaterThanOrEqual(width < 761 ? 44 : 32);
    if (width === 1280) expect(visual.rowHeight).toBeLessThan(120);
    await page.screenshot({ path: test.info().outputPath(`neutral-class-${width}.png`), fullPage: true });
  }

  const first = page.locator(".entry-class-entry").first();
  await first.getByLabel("Ny klass").selectOption({ label: "D21" });
  await first.getByRole("button", { name: "Ändra klass" }).click();
  await expect(page.locator(".entry-class-retry[role='alert']"))
    .toContainText("Klassändringens status är inte bekräftad");
  expect(await page.locator(".entry-class-retry").evaluate(element =>
    getComputedStyle(element).borderLeftColor)).toBe("rgb(130, 83, 0)");
  expect(writes).toEqual(["PATCH"]);
});
