import { expect, test } from "@playwright/test";
import { raceOverviewResponseSchema } from "@o-tid/contracts";

const raceId = "10000000-0000-4000-8000-000000000001";
const overview = raceOverviewResponseSchema.parse({
  formatVersion: 1,
  race: { id: raceId, eventName: "Syntetiska klubbträningen", name: "Långdistans",
    raceDate: "2026-09-08", timeZone: "Europe/Stockholm", snapshotVersion: 7 },
  classes: [
    { id: "20000000-0000-4000-8000-000000000001", name: "H21", startRule: "FIXED", entryCount: 34 },
    { id: "20000000-0000-4000-8000-000000000002", name: "Öppen 5", startRule: "PUNCH", entryCount: 26 }
  ],
  courses: [{ id: "30000000-0000-4000-8000-000000000001", name: "Långa banan" }],
  counts: { classes: 2, courses: 1, entries: 60, activeCardAssignments: 57, readouts: 28, resultRevisions: 30, imports: 2 },
  latestActivity: { readoutAt: "2026-09-08T10:03:00Z", resultRevisionAt: "2026-09-08T10:03:00Z", importAt: null }
});
const surfaces = ["history", "classes", "start-times", "cards", "registration", "start-list", "forest-watch",
  "speaker", "start-list-publication", "class-start-draw", "recalculation", "did-not-start",
  "did-not-start-withdrawals", "disqualifications", "result-approvals", "did-not-finish", "out-of-competition",
  "without-timing", "without-timing-withdrawals", "out-of-competition-withdrawals", "did-not-finish-withdrawals",
  "approval-withdrawals", "disqualification-withdrawals", "finalization", "imports", "exports", "pairing"];

for (const viewport of [{ width: 1366, height: 768 }, { width: 390, height: 844 }]) {
  test(`compact workspace ${viewport.width}: navigation, layout and private UI boundaries`, async ({ page }) => {
    await page.setViewportSize(viewport);
    let authenticated = false;
    await page.route("**/api/**", async route => {
      const url = new URL(route.request().url());
      if (url.pathname === `/api/admin/races/${raceId}/overview-session`) {
        authenticated = route.request().method() === "POST";
        return route.fulfill({ status: 200, json: { formatVersion: 1, raceId, capability: "VIEW_RACE_OVERVIEW",
          expiresAt: "2099-01-01T00:00:00Z" } });
      }
      if (url.pathname === `/api/admin/races/${raceId}/overview`) {
        return route.fulfill({ status: authenticated ? 200 : 401,
          json: authenticated ? overview : { formatVersion: 1, error: "UNAUTHORIZED" } });
      }
      return route.abort();
    });
    await page.goto(`/admin/${raceId}`);
    await expect(page.locator('input[type="password"]')).toBeVisible();
    await expect(page.getByText(overview.race.eventName, { exact: false })).toHaveCount(0);
    await page.locator('input[type="password"]').fill(`otid_org_race_overview_v1.${raceId}.${"a".repeat(43)}`);
    await page.locator('button[type="submit"]').click();
    await expect(page.getByRole("heading", { name: `${overview.race.eventName} – ${overview.race.name}` })).toBeVisible();
    const links = await page.locator(".race-overview-admin a").evaluateAll(elements => elements.map(element => element.getAttribute("href")));
    for (const surface of surfaces) expect(links).toContain(`/admin/${raceId}/${surface}`);
    expect(links).toContain(`/results/${raceId}`);
    expect(links).toContain(`/checkin/index.html#${raceId}`);
    expect(links).toContain("/organizer");
    expect(links).toContain(`/admin/${raceId}/manage`);
    expect(new Set(links).size).toBe(31);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    const workspace = page.locator(".race-workspace");
    await expect(workspace).toBeVisible();
    if (viewport.width > 1000) {
      const headings = workspace.locator(".race-workspace-area h3");
      await expect(headings).toHaveCount(4);
      for (const heading of await headings.all()) {
        const box = await heading.boundingBox();
        expect(box).not.toBeNull();
        expect(box!.y + box!.height).toBeLessThan(viewport.height);
      }
    }
    await page.screenshot({ path: test.info().outputPath(`workspace-${viewport.width}.png`), fullPage: true });
    await workspace.locator("summary").click();
    await expect(workspace.locator(`a[href="/admin/${raceId}/disqualifications"]`)).toBeVisible();
    await page.locator(".race-overview-structure summary").click();
    await expect(page.getByText("H21 (Minutstart)", { exact: false })).toBeVisible();
    const linkHeights = await workspace.locator("a").evaluateAll(elements =>
      elements.map(element => element.getBoundingClientRect().height));
    expect(linkHeights.every(height => height >= 44)).toBe(true);
    await page.context().setOffline(true);
    await expect(page.locator(".race-overview-admin").getByRole("alert")).toContainText("Offline: översikten kan vara inaktuell");
    await page.context().setOffline(false);
    // Exercise existing UI clearing, not backend authentication correctness.
    if (viewport.width > 1000) {
      authenticated = false;
      await page.getByRole("button", { name: "Uppdatera översikten", exact: true }).click();
    } else {
      await page.context().addCookies([{ name: "otid_race_overview_csrf", value: "c".repeat(43),
        url: test.info().project.use.baseURL as string }]);
      await page.getByRole("button", { name: "Logga ut från översikten", exact: true }).click();
    }
    await expect(workspace).toHaveCount(0);
    await expect(page.getByText(overview.race.eventName, { exact: false })).toHaveCount(0);
  });
}
