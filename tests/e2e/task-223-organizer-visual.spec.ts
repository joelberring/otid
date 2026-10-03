import { expect, test } from "@playwright/test";

const accountId = "11111111-1111-4111-8111-111111111111";
const eventId = "22222222-2222-4222-8222-222222222222";
const raceId = "33333333-3333-4333-8333-333333333333";
const eventName = "Syntetisk skärgårdstävling med ett längre namn för layoutkontroll";

for (const viewport of [{ width: 1280, height: 900 }, { width: 390, height: 844 }]) {
  test(`TASK223 neutral inloggad arrangörsyta ${viewport.width}px`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.context().addCookies([{
      name: "otid_organizer_csrf", value: "c".repeat(43), url: "http://127.0.0.1:3114"
    }]);
    let postCount = 0;
    let created = false;
    const idempotencyKeys: string[] = [];
    await page.route("**/api/**", async (route) => {
      const request = route.request();
      const path = new URL(request.url()).pathname;
      if (path === "/api/organizer/session" && request.method() === "GET") {
        return route.fulfill({ json: { formatVersion: 1, accountId, displayName: "Syntetisk arrangör",
          expiresAt: "2026-10-01T00:00:00Z" } });
      }
      if (path === "/api/organizer/events" && request.method() === "GET") {
        const events = [{ eventId, eventName, role: "OWNER", startsOn: "2026-09-27",
          timeZone: "Europe/Stockholm", races: [{ raceId, raceName: "Lång", raceDate: "2026-09-27" }] }];
        if (created) events.push({ eventId: "44444444-4444-4444-8444-444444444444",
          eventName: "Bekräftad syntetisk tävling", role: "OWNER", startsOn: "2026-10-04",
          timeZone: "Europe/Stockholm", races: [{ raceId: "55555555-5555-4555-8555-555555555555",
            raceName: "Testlopp", raceDate: "2026-10-04" }] });
        return route.fulfill({ json: { formatVersion: 1, events } });
      }
      if (path === "/api/organizer/events" && request.method() === "POST") {
        postCount += 1;
        idempotencyKeys.push(request.headers()["idempotency-key"] ?? "");
        if (postCount === 1) return route.fulfill({ status: 503,
          json: { formatVersion: 1, error: "INTERNAL_ERROR" } });
        created = true;
        return route.fulfill({ status: 201, json: { formatVersion: 1, replayed: false,
          requestId: idempotencyKeys.at(-1)?.split(":")[1],
          eventId: "44444444-4444-4444-8444-444444444444",
          raceId: "55555555-5555-4555-8555-555555555555",
          createdAt: "2026-09-27T12:00:00Z" } });
      }
      return route.abort();
    });

    await page.goto("/organizer");
    await expect(page.getByRole("heading", { name: eventName })).toBeVisible();
    await expect(page.getByText("Syntetisk arrangör")).toBeVisible();
    await expect(page.getByLabel("Inloggningsnamn")).toHaveCount(0);
    const panels = page.locator("main > div > section");
    await expect(panels).toHaveCount(2);
    const first = await panels.nth(0).boundingBox();
    const second = await panels.nth(1).boundingBox();
    expect(first && second).not.toBeNull();
    if (viewport.width > 700) {
      expect(second!.x).toBeGreaterThan(first!.x + first!.width);
      expect(Math.abs(second!.y - first!.y)).toBeLessThan(4);
    } else {
      expect(second!.y).toBeGreaterThan(first!.y + first!.height);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBe(0);
    expect(await page.evaluate(() => getComputedStyle(document.body).backgroundColor)).toBe("rgb(247, 248, 248)");
    expect(await page.evaluate(() => getComputedStyle(document.querySelector("body > header")!).backgroundColor))
      .toBe("rgb(247, 248, 248)");
    const buttonHeights = await page.locator("main button").evaluateAll((buttons) =>
      buttons.map((button) => button.getBoundingClientRect().height));
    expect(buttonHeights.every((height) => height >= 44)).toBe(true);
    const inputHeights = await page.locator("main input").evaluateAll((inputs) =>
      inputs.map((input) => input.getBoundingClientRect().height));
    expect(inputHeights.every((height) => height >= 48)).toBe(true);
    await page.screenshot({ path: test.info().outputPath(`organizer-${viewport.width}.png`) });

    await page.getByLabel("Eventnamn", { exact: true }).fill("Bekräftad syntetisk tävling");
    await page.getByLabel("Loppets namn", { exact: true }).fill("Testlopp");
    await page.getByLabel("Datum", { exact: true }).fill("2026-10-04");
    await page.getByRole("button", { name: "Skapa tävling", exact: true }).click();
    const uncertain = page.getByRole("alert").filter({ hasText: "Skapandet har ännu inget bekräftat svar" });
    await expect(uncertain).toBeVisible();
    await expect(uncertain).toContainText("Retry skickar exakt samma uppgifter och request-id");
    expect(await uncertain.evaluate((element) => getComputedStyle(element).borderLeftColor))
      .toBe("rgb(130, 83, 0)");
    await page.screenshot({ path: test.info().outputPath(`organizer-uncertain-${viewport.width}.png`), fullPage: true });

    await page.getByRole("button", { name: "Retry samma försök" }).click();
    const confirmed = page.getByRole("status").filter({ hasText: "Tävlingen skapades." });
    await expect(confirmed).toBeVisible();
    await expect(uncertain).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "Bekräftad syntetisk tävling" })).toBeVisible();
    expect(await confirmed.evaluate((element) => getComputedStyle(element).borderLeftColor))
      .toBe("rgb(217, 221, 224)");
    expect(idempotencyKeys).toHaveLength(2);
    expect(idempotencyKeys[0]).toBe(idempotencyKeys[1]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBe(0);
    await page.screenshot({ path: test.info().outputPath(`organizer-confirmed-${viewport.width}.png`), fullPage: true });
  });
}
