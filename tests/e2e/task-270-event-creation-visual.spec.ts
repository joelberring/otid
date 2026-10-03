import { expect, test } from "@playwright/test";
import { eventCreationRequestSchema, eventCreationResponseSchema } from "@o-tid/contracts";

const origin = "http://127.0.0.1:3127";
const request = eventCreationRequestSchema.parse({ formatVersion: 1,
  eventName: "Skärgårdshelgen test", raceName: "Lång", raceDate: "2026-10-03",
  timeZone: "Europe/Stockholm" });
const eventId = "10000000-0000-4000-8000-000000000071";
const raceId = "10000000-0000-4000-8000-000000000072";

test("TASK270: kompakt skapande med fryst okänd commit vid 1280/390 px", async ({ page, context }) => {
  await context.addCookies([{ name: "otid_event_creation_csrf", value: "c".repeat(43), url: origin }]);
  const attempts: { key: string | undefined; body: string | null }[] = [];
  const writes: string[] = [];
  await page.route("**/api/**", async route => {
    const call = route.request(), url = new URL(call.url());
    if (url.pathname === "/api/admin/event-creation-session" && call.method() === "GET") {
      return route.fulfill({ json: { formatVersion: 1, capability: "CREATE_EVENT",
        expiresAt: "2026-09-29T22:00:00.000Z" } });
    }
    if (url.pathname === "/api/events" && call.method() === "POST") {
      writes.push(call.method());
      attempts.push({ key: call.headers()["idempotency-key"], body: call.postData() });
      if (attempts.length === 1) return route.abort();
      const response = eventCreationResponseSchema.parse({ formatVersion: 1, replayed: true,
        requestId: attempts[0]!.key!.slice("event-create:".length), eventId, raceId,
        createdAt: "2026-09-29T18:00:00.000Z" });
      return route.fulfill({ status: 200, json: response });
    }
    if (url.pathname === "/api/admin/event-creation-session" && call.method() === "DELETE") {
      writes.push(call.method());
      return route.abort(); // Local private state must clear even when logout confirmation is lost.
    }
    return route.abort();
  });

  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/admin/events/new");
  await expect(page.getByRole("heading", { name: "Tävlingsuppgifter" })).toBeVisible();
  await expect(page.getByLabel("Personlig nyckel för att skapa tävling")).toHaveCount(0);
  await expect(page.getByLabel("Operativ status för tävlingsskapandet")).toContainText("Ansluten");
  await expect(page.getByLabel("Operativ status för tävlingsskapandet")).toContainText("Aktiv");
  const form = page.locator(".event-creation-form-panel form");
  await form.getByLabel("Tävlingsnamn").fill(request.eventName);
  await form.getByLabel("Första loppets namn").fill(request.raceName);
  await form.getByLabel("Datum").fill(request.raceDate);
  await form.getByLabel("Tidszon").fill(request.timeZone);
  const create = form.getByRole("button", { name: "Skapa tävling och första lopp" });
  await expect(create).toBeInViewport();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(writes).toEqual([]);
  await page.screenshot({ path: test.info().outputPath("creation-desktop-form.png") });

  await create.click();
  const warning = page.getByRole("alert").filter({ hasText: "Skapandets status är inte bekräftad" });
  await expect(warning).toBeVisible();
  await expect(warning).toContainText(request.eventName);
  await expect(warning).toContainText(request.raceName);
  await expect(warning).toContainText(request.raceDate);
  await expect(warning).toContainText(request.timeZone);
  await expect(create).toBeDisabled();
  expect(attempts).toHaveLength(1);
  expect(attempts[0]!.key).toMatch(/^event-create:[0-9a-f-]{36}$/);
  expect(JSON.parse(attempts[0]!.body!) as unknown).toEqual(request);
  await expect(warning.locator("dd").first()).toHaveText(attempts[0]!.key!.slice("event-create:".length));
  expect(page.url()).not.toContain(request.eventName);

  await page.setViewportSize({ width: 390, height: 844 });
  await warning.scrollIntoViewIfNeeded();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const retry = warning.getByRole("button", { name: "Försök igen med samma skapande" });
  expect(await retry.evaluate(element => element.getBoundingClientRect().height)).toBeGreaterThanOrEqual(52);
  await page.screenshot({ path: test.info().outputPath("creation-mobile-uncertain.png") });
  await retry.click();
  const receiptHeading = page.getByRole("heading", { name: /Det tidigare skapandet bekräftades/ });
  await expect(receiptHeading).toBeInViewport();
  expect(await receiptHeading.evaluate(element => element === document.activeElement)).toBe(true);
  expect(attempts).toHaveLength(2);
  expect(attempts[1]).toEqual(attempts[0]);
  await expect(page.getByText(eventId)).toBeVisible();
  await expect(page.getByText(raceId)).toBeVisible();
  await expect(page.getByText(/ger inte automatisk åtkomst till loppets administration/i)).toBeVisible();
  await expect(create).toHaveCount(0);
  const createAnother = page.getByRole("button", { name: "Skapa ytterligare tävling" });
  await expect(createAnother).toBeVisible();
  expect(await createAnother.evaluate(element => element.getBoundingClientRect().height)).toBeGreaterThanOrEqual(52);
  await page.screenshot({ path: test.info().outputPath("creation-mobile-receipt.png") });

  await page.getByRole("button", { name: "Logga ut", exact: true }).click();
  await expect(page.getByRole("heading", { name: /Utloggningen är inte bekräftad/ })).toBeVisible();
  await expect(page.getByText(eventId)).toHaveCount(0);
  await expect(page.getByText(raceId)).toHaveCount(0);
  expect(writes).toEqual(["POST", "POST", "DELETE"]);
  expect(await page.evaluate(() => ({ local: Object.keys(localStorage), session: Object.keys(sessionStorage) })))
    .toEqual({ local: [], session: [] });
});
