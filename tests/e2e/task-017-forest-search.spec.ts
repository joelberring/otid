import { expect, test } from "@playwright/test";
import { StartCheckinRosterResponseSchema } from "@o-tid/contracts";
const raceId = "10000000-0000-4000-8000-000000000001";
const first = { entryId: "20000000-0000-4000-8000-000000000001", entryVersion: 1, classId: raceId,
  className: "Öppen", displayName: "Åsa Exempel", organisationName: "Testklubben", cardNumber: "123456",
  multipleActiveAssignments: false, startRule: "PUNCH", fixedStartTime: null, revision: 0,
  startState: "UNMARKED", manualReturnRegistered: false, readoutReturnRegistered: false, activeDns: false,
  conflictingReports: false, forestState: "UNCONFIRMED", needsFollowUp: true };
const data = StartCheckinRosterResponseSchema.parse({ formatVersion: 1, raceId, snapshotVersion: 7,
  timeZone: "Europe/Stockholm", generatedAt: "2026-09-09T09:00:00.000Z", knowledge: "LAST_SYNCED_ONLY",
  entries: [first, { ...first, entryId: "20000000-0000-4000-8000-000000000002", displayName: "Bo Exempel",
    classId: "10000000-0000-4000-8000-000000000002", className: "H21", cardNumber: "654321",
    forestState: "RETURNED", readoutReturnRegistered: true, needsFollowUp: false }],
  devices: [{ deviceId: "30000000-0000-4000-8000-000000000001", label: "Syntetisk startmobil",
    capability: "START_CHECKIN", lastSequence: 0, lastReceivedAt: null }]
});

for (const viewport of [{ width: 1366, height: 768 }, { width: 390, height: 844 }]) {
  test(`forest search ${viewport.width}: total knowledge survives zero results and printing`, async ({ page }) => {
    await page.setViewportSize(viewport);
    let authorized = false;
    await page.route("**/api/**", async route => {
      const path = new URL(route.request().url()).pathname;
      if (path.endsWith("/finish-forest-watch-session")) {
        if (route.request().method() === "POST") authorized = true;
        return route.fulfill({ status: authorized ? 200 : 401, json: authorized ?
          { formatVersion: 1, raceId, capability: "FINISH_FOREST_WATCH", expiresAt: "2099-01-01T00:00:00Z" } :
          { formatVersion: 1, error: "UNAUTHORIZED" } });
      }
      if (path.endsWith("/finish-forest-watch/roster")) return route.fulfill({ status: 200, json: data });
      return route.abort();
    });
    await page.goto(`/admin/${raceId}/forest-watch`);
    await expect(page.getByRole("status")).toHaveText("Logga in med målpersonalens behörighet för detta lopp.");
    await page.getByLabel("Målpersonalens behörighet").fill(`otid_org_finish_forest_watch_v1.${raceId}.${"a".repeat(43)}`);
    await page.getByRole("button", { name: "Logga in", exact: true }).click();
    const report = page.getByRole("region", { name: "Kvar i skogen – målpersonal", exact: true });
    const search = page.getByRole("searchbox");
    const unknown = report.locator('[data-forest-group="UNCONFIRMED"]');
    await expect(unknown).toHaveAttribute("data-forest-total", "1");
    await search.fill("a\u030asa");
    await expect(unknown).toHaveAttribute("data-forest-visible", "1");
    await search.fill("TESTKLUBBEN");
    await expect(report.locator("tbody tr")).toHaveCount(2);
    await page.getByRole("combobox", { name: "Klassfilter", exact: true }).selectOption(raceId);
    await expect(report.locator("tbody tr")).toHaveCount(1);
    await search.fill("654321");
    await expect(report.locator("tbody tr")).toHaveCount(0);
    await expect(unknown).toHaveAttribute("data-forest-total", "1");
    await expect(unknown).toHaveAttribute("data-forest-visible", "0");
    await expect(report.locator("[data-forest-group]")).toHaveCount(5);
    await expect(report.getByText("Syntetisk startmobil", { exact: true })).toBeVisible();
    await expect(report.getByText(/garanterar inte att skogen är tom/)).toBeVisible();
    await expect(report).toContainText("654321");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: test.info().outputPath(`forest-search-${viewport.width}.png`), fullPage: true });
    await page.emulateMedia({ media: "print" });
    await expect(search).toBeHidden();
    await expect(report).toContainText("654321");
    await expect(report.getByText("Syntetisk startmobil", { exact: true })).toBeVisible();
    await expect(unknown).toHaveAttribute("data-forest-total", "1");
    await page.emulateMedia({ media: "screen" });
    await page.getByRole("button", { name: "Rensa filter", exact: true }).click();
    await expect(search).toHaveValue("");
    await expect(report.locator("tbody tr")).toHaveCount(2);
    await search.fill("Åsa"); authorized = false;
    await page.getByRole("button", { name: "Uppdatera lista", exact: true }).click();
    await expect(report).toHaveCount(0);
    await expect(search).toHaveCount(0);
    await page.getByLabel("Målpersonalens behörighet").fill(`otid_org_finish_forest_watch_v1.${raceId}.${"a".repeat(43)}`);
    await page.getByRole("button", { name: "Logga in", exact: true }).click();
    await expect(search).toHaveValue("");
  });
}
