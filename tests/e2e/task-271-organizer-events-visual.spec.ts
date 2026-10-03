import { expect, test } from "@playwright/test";

const accountId = "11111111-1111-4111-8111-111111111111";
const id = (prefix: string, number: number) => `${prefix}-${String(number).padStart(12, "0")}`;
const events = Array.from({ length: 6 }, (_, index) => {
  const eventNumber = index + 1;
  return {
    eventId: id("22222222-2222-4222-8222", eventNumber),
    eventName: eventNumber === 1
      ? "Skärgårdshelgen med ett långt tävlingsnamn som ska få plats"
      : `Syntetisk tävling ${eventNumber}`,
    role: index % 2 === 0 ? "OWNER" : "ADMIN",
    startsOn: `2026-10-${String(eventNumber).padStart(2, "0")}`,
    timeZone: "Europe/Stockholm",
    races: [1, 2].map((raceNumber) => ({
      raceId: id("33333333-3333-4333-8333", eventNumber * 10 + raceNumber),
      raceName: raceNumber === 1 ? `Medel ${eventNumber}` : `Lång ${eventNumber}`,
      raceDate: `2026-10-${String(eventNumber).padStart(2, "0")}`
    }))
  };
});
const firstEvent = events[0]!;
const secondEvent = events[1]!;

test("TASK271/TASK278 täta kontotävlingar och lokal sökning på dator och mobil", async ({ page }) => {
  const requests: string[] = [];
  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    requests.push(`${request.method()} ${path}`);
    if (request.method() === "GET" && path === "/api/organizer/session") {
      return route.fulfill({ json: { formatVersion: 1, accountId,
        displayName: "Syntetisk arrangör", expiresAt: "2026-11-01T00:00:00Z" } });
    }
    if (request.method() === "GET" && path === "/api/organizer/events") {
      return route.fulfill({ json: { formatVersion: 1, events } });
    }
    return route.abort();
  });

  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/organizer");
  await expect(page.getByRole("heading", { name: firstEvent.eventName })).toBeVisible();
  await expect(page.getByRole("button", { name: "Öppna arbetsytan" })).toHaveCount(12);
  await expect(page.getByRole("button", { name: "Visa medadministratörer" })).toHaveCount(3);
  await expect(page.getByRole("heading", { name: "Skapa tävling" })).toBeVisible();
  const ownerEvent = page.getByRole("heading", { name: firstEvent.eventName }).locator("xpath=ancestor::li[1]");
  const adminEvent = page.getByRole("heading", { name: secondEvent.eventName }).locator("xpath=ancestor::li[1]");
  await expect(ownerEvent).toContainText("Ägare");
  await expect(ownerEvent).toContainText("2 lopp");
  await expect(ownerEvent.getByRole("button", { name: "Visa medadministratörer" })).toBeVisible();
  await expect(adminEvent).toContainText("Medadministratör");
  await expect(adminEvent.getByRole("button", { name: "Visa medadministratörer" })).toHaveCount(0);
  const panels = page.locator("main > div > section");
  const list = await panels.nth(0).boundingBox();
  const creation = await panels.nth(1).boundingBox();
  expect(list && creation).not.toBeNull();
  expect(list!.width).toBeGreaterThan(creation!.width * 1.4);
  expect(creation!.x).toBeGreaterThan(list!.x + list!.width);
  expect(Math.abs(creation!.y - list!.y)).toBeLessThan(4);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBe(0);
  await page.screenshot({ path: test.info().outputPath("organizer-events-1280.png") });

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole("heading", { name: firstEvent.eventName })).toBeVisible();
  const mobileList = await panels.nth(0).boundingBox();
  const mobileCreation = await panels.nth(1).boundingBox();
  expect(mobileList && mobileCreation).not.toBeNull();
  expect(mobileCreation!.y).toBeGreaterThan(mobileList!.y + mobileList!.height);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBe(0);
  const buttonHeights = await page.locator("main button").evaluateAll((buttons) =>
    buttons.map((button) => button.getBoundingClientRect().height));
  expect(buttonHeights.every((height) => height >= 44)).toBe(true);
  await page.screenshot({ path: test.info().outputPath("organizer-events-390.png") });
  expect(requests.length).toBeGreaterThanOrEqual(2);
  expect(requests.every((request) => request === "GET /api/organizer/session" ||
    request === "GET /api/organizer/events")).toBe(true);
  expect(requests).toContain("GET /api/organizer/session");
  expect(requests).toContain("GET /api/organizer/events");

  const requestCountBeforeSearch = requests.length;
  const finder = page.getByRole("searchbox", { name: "Sök tävling eller lopp" });
  await finder.fill("lÅnG 6");
  await expect(page.getByRole("heading", { name: "Syntetisk tävling 6" })).toBeVisible();
  await expect(page.getByRole("heading", { name: firstEvent.eventName })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Öppna arbetsytan" })).toHaveCount(2);
  await expect(page.getByRole("button", { name: "Visa medadministratörer" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Rensa sökning" })).toBeVisible();
  expect((await page.getByRole("button", { name: "Rensa sökning" }).boundingBox())?.height).toBeGreaterThanOrEqual(44);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBe(0);
  await page.screenshot({ path: test.info().outputPath("organizer-finder-390.png") });

  await page.getByRole("button", { name: "Rensa sökning" }).click();
  await expect(finder).toHaveValue("");
  await expect(page.getByRole("button", { name: "Öppna arbetsytan" })).toHaveCount(12);
  await finder.fill("skÄrgårds");
  await expect(page.getByRole("heading", { name: firstEvent.eventName })).toBeVisible();
  await expect(page.getByRole("button", { name: "Visa medadministratörer" })).toHaveCount(1);
  await finder.fill("ingen sådan tävling");
  await expect(page.getByText("Ingen tävling eller något lopp matchar sökningen.")).toBeVisible();
  await expect(page.getByText("Inga tävlingar ännu")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Öppna arbetsytan" })).toHaveCount(0);
  await page.setViewportSize({ width: 320, height: 740 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBe(0);
  expect((await finder.boundingBox())?.width).toBeGreaterThanOrEqual(110);
  await page.screenshot({ path: test.info().outputPath("organizer-finder-empty-320.png") });
  await page.setViewportSize({ width: 1280, height: 900 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBe(0);
  await page.screenshot({ path: test.info().outputPath("organizer-finder-empty-1280.png") });
  await page.getByRole("button", { name: "Rensa sökning" }).click();
  await expect(page.getByRole("button", { name: "Öppna arbetsytan" })).toHaveCount(12);
  expect(requests.length).toBe(requestCountBeforeSearch);
});
