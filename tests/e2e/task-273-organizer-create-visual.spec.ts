import { expect, test } from "@playwright/test";

const accountId = "11111111-1111-4111-8111-111111111111";
const createdEventId = "77777777-7777-4777-8777-777777777777";
const createdRaceId = "88888888-8888-4888-8888-888888888888";
const session = { formatVersion: 1, accountId, displayName: "Syntetisk arrangör",
  expiresAt: "2026-10-01T00:00:00Z" };
const existingEvents = Array.from({ length: 4 }, (_, index) => ({
  eventId: `22222222-2222-4222-8222-${String(index + 1).padStart(12, "0")}`,
  eventName: `Syntetisk befintlig tävling ${index + 1}`,
  role: "ADMIN", startsOn: "2026-09-30", timeZone: "Europe/Stockholm",
  races: [{ raceId: `33333333-3333-4333-8333-${String(index + 1).padStart(12, "0")}`,
    raceName: "Befintligt lopp", raceDate: "2026-09-30" }]
}));

test("TASK273 kontobundet skapande granskar fryst försök och byter till kvitto", async ({ page }) => {
  await page.context().addCookies([{ name: "otid_organizer_csrf", value: "c".repeat(43),
    url: "http://127.0.0.1:3114" }]);
  const keys: string[] = [];
  const bodies: string[] = [];
  let confirmed = false;
  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (path === "/api/organizer/session" && request.method() === "GET") {
      return route.fulfill({ json: session });
    }
    if (path === "/api/organizer/events" && request.method() === "GET") {
      const events = confirmed ? [...existingEvents, { eventId: createdEventId,
        eventName: "Ny syntetisk tävling", role: "OWNER", startsOn: "2026-10-04",
        timeZone: "Europe/Stockholm", races: [{ raceId: createdRaceId,
          raceName: "Första loppet", raceDate: "2026-10-04" }] }] : existingEvents;
      return route.fulfill({ json: { formatVersion: 1, events } });
    }
    if (path === "/api/organizer/events" && request.method() === "POST") {
      keys.push(request.headers()["idempotency-key"] ?? "");
      bodies.push(request.postData() ?? "");
      if (keys.length === 1) return route.fulfill({ status: 503,
        json: { formatVersion: 1, error: "INTERNAL_ERROR" } });
      confirmed = true;
      return route.fulfill({ status: 201, json: { formatVersion: 1, replayed: false,
        requestId: keys.at(-1)?.split(":")[1], eventId: createdEventId,
        raceId: createdRaceId, createdAt: "2026-09-29T12:00:00Z" } });
    }
    return route.abort();
  });

  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/organizer");
  const creation = page.locator("#organizer-create-event");
  await expect(creation.getByRole("heading", { name: "Skapa tävling" })).toBeVisible();
  await creation.getByLabel("Eventnamn").fill("Ny syntetisk tävling");
  await creation.getByLabel("Loppets namn").fill("Första loppet");
  await creation.getByLabel("Datum").fill("2026-10-04");
  await expect(creation.getByLabel("Tidszon")).toHaveValue("Europe/Stockholm");
  await creation.getByRole("button", { name: "Skapa tävling", exact: true }).click();
  const pending = creation.getByRole("alert").filter({ hasText: "Skapandet har ännu inget bekräftat svar" });
  await expect(pending).toBeVisible();
  await expect(pending).toContainText("Ny syntetisk tävling");
  await expect(pending).toContainText("Första loppet");
  await expect(pending).toContainText("2026-10-04");
  await expect(pending).toContainText("Europe/Stockholm");
  await expect(pending).toContainText(keys[0]!.split(":")[1]!);
  await expect(creation.locator('form input[name="eventName"]')).toHaveCount(0);
  await page.screenshot({ path: test.info().outputPath("organizer-create-pending-1280.png") });

  await page.reload();
  await expect(pending).toBeVisible();
  expect(keys).toHaveLength(1);
  await page.setViewportSize({ width: 390, height: 844 });
  const jump = page.getByRole("link", { name: "Till Skapa tävling" });
  await expect(jump).toBeVisible();
  await jump.click();
  await expect(page).toHaveURL(/#organizer-create-event$/);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBe(0);
  await pending.scrollIntoViewIfNeeded();
  await page.screenshot({ path: test.info().outputPath("organizer-create-pending-390.png") });
  await pending.getByRole("button", { name: "Retry samma försök" }).click();
  await expect(pending).toHaveCount(0);
  await expect(creation.getByText(createdEventId)).toBeVisible();
  await expect(creation.getByText(createdRaceId)).toBeVisible();
  await expect(creation.locator('time[datetime="2026-09-29T12:00:00Z"]')).toBeVisible();
  await expect(creation.getByRole("button", { name: "Öppna arbetsytan" })).toBeVisible();
  await expect(creation.getByRole("status").filter({ hasText: "Tävlingen skapades." })).toBeInViewport();
  await expect(creation.getByRole("button", { name: "Skapa ytterligare tävling" })).toBeVisible();
  await expect(creation.locator('form input[name="eventName"]')).toHaveCount(0);
  await page.screenshot({ path: test.info().outputPath("organizer-create-confirmed-390.png") });
  expect(keys).toHaveLength(2);
  expect(keys[0]).toBe(keys[1]);
  expect(bodies[0]).toBe(bodies[1]);
  await creation.getByRole("button", { name: "Skapa ytterligare tävling" }).click();
  await expect(creation.getByLabel("Eventnamn")).toHaveValue("");
  await expect(creation.getByLabel("Loppets namn")).toHaveValue("");
  await expect(creation.getByLabel("Datum")).toHaveValue("");
  await expect(creation.getByLabel("Tidszon")).toHaveValue("Europe/Stockholm");
  await expect(creation.getByText(createdEventId)).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBe(0);
  await page.screenshot({ path: test.info().outputPath("organizer-create-new-390.png") });
});
