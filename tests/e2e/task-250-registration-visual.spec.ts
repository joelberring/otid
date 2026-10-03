import { expect, test } from "@playwright/test";
import { entryRegistrationClassesResponseSchema, entryRegistrationStartSlotCandidatesSchema } from "@o-tid/contracts";

const raceId = "10000000-0000-4000-8000-000000000001";
const punchId = "20000000-0000-4000-8000-000000000001";
const fixedId = "20000000-0000-4000-8000-000000000002";
const courseVersionId = "30000000-0000-4000-8000-000000000001";
const classes = entryRegistrationClassesResponseSchema.parse({ formatVersion: 1, raceId, snapshotVersion: 7,
  timeZone: "Europe/Stockholm", classes: [
  { id: punchId, name: "Öppen lång", courseVersionId, startRule: "PUNCH" },
  { id: fixedId, name: "D21", courseVersionId, startRule: "FIXED" }
] });
const slots = entryRegistrationStartSlotCandidatesSchema.parse({ formatVersion: 1, raceId,
  targetClassId: fixedId, snapshotVersion: 7, timeZone: "Europe/Stockholm",
  targetCourseVersionId: courseVersionId, targetCapacityVersion: 2,
  startRule: "FIXED", plan: { status: "AVAILABLE", drawRequestId: "40000000-0000-4000-8000-000000000001",
    sourceHash: "a".repeat(64), slots: [{ fixedStartTime: "2026-10-01T10:00:00+02:00" }] } });

for (const viewport of [{ width: 1366, height: 768 }, { width: 390, height: 844 }]) {
  test(`TASK252 neutral registration ${viewport.width}: race-local slot and frozen UTC retry`, async ({ page }) => {
    await page.setViewportSize(viewport);
    let authorized = false;
    const attempts: { key: string; body: string }[] = [];
    await page.route("**/api/**", async route => {
      const request = route.request(), path = new URL(request.url()).pathname;
      if (path === `/api/admin/races/${raceId}/entry-registration-session` && request.method() === "POST") {
        authorized = true;
        return route.fulfill({ status: 200, json: { formatVersion: 1, raceId, capability: "REGISTER_ENTRY",
          expiresAt: new Date(Date.now() + 10 * 60_000).toISOString() } });
      }
      if (path === `/api/admin/races/${raceId}/entry-registration-classes` && request.method() === "GET")
        return route.fulfill({ status: authorized ? 200 : 401,
          json: authorized ? classes : { formatVersion: 1, error: "UNAUTHORIZED" } });
      if (path === `/api/admin/races/${raceId}/entry-registration-start-slot-candidates/${fixedId}` && request.method() === "GET")
        return route.fulfill({ status: 200, json: slots });
      if (path === `/api/races/${raceId}/entries` && request.method() === "POST") {
        attempts.push({ key: request.headers()["idempotency-key"]!, body: request.postData()! });
        return route.abort();
      }
      return route.abort();
    });
    await page.goto(`/admin/${raceId}/registration`);
    await page.getByLabel("Registreringsbehörighet").fill(`otid_org_entry_registration_v1.${raceId}.${"a".repeat(43)}`);
    await page.getByRole("button", { name: "Logga in" }).click();
    const raceClass = page.getByRole("combobox", { name: "Klass" });
    await expect(raceClass).toBeVisible();
    await raceClass.selectOption(punchId);
    await expect(page.getByLabel("Fast starttid med datum och UTC-offset")).toHaveCount(0);
    await raceClass.selectOption(fixedId);
    await expect(page.getByLabel("Fast starttid med datum och UTC-offset")).toBeVisible();
    await expect(page.getByLabel("Välj en ledig lottad starttid")).toBeVisible();
    await page.getByLabel("Välj en ledig lottad starttid").check();
    await expect(page.getByRole("combobox", { name: "Lottad starttid (loppets tid)" })).toBeVisible();
    await expect(page.getByRole("combobox", { name: "Lottad starttid (loppets tid)" }).locator("option").nth(1)).toHaveText("2026-10-01 10:00:00 GMT+02:00");
    await page.getByRole("combobox", { name: "Lottad starttid (loppets tid)" }).selectOption({ index: 1 });
    await page.screenshot({ path: test.info().outputPath(`registration-fixed-${viewport.width}.png`), fullPage: true });
    await page.getByLabel("Förnamn").fill("Åsa");
    await page.getByLabel("Efternamn").fill("Exempel");
    await page.getByLabel("Klubb (valfri)").fill("Centrum OK");
    await page.getByLabel("Bricknummer (valfritt)").fill("123456");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    const nameHeight = await page.getByLabel("Förnamn").evaluate(element => element.getBoundingClientRect().height);
    expect(nameHeight).toBeGreaterThanOrEqual(viewport.width === 390 ? 52 : 40);
    const buttonColor = await page.getByRole("button", { name: "Granska anmälan" }).evaluate(element => getComputedStyle(element).backgroundColor);
    const channels = buttonColor.match(/\d+/g)?.slice(0, 3).map(Number) ?? [];
    expect(channels).toHaveLength(3);
    expect(Math.max(...channels) - Math.min(...channels)).toBeLessThanOrEqual(30);
    await page.screenshot({ path: test.info().outputPath(`registration-edit-${viewport.width}.png`), fullPage: true });
    await page.getByRole("button", { name: "Granska anmälan" }).click();
    await expect(page.locator(".entry-registration-review")).toContainText("Åsa");
    await expect(page.locator(".entry-registration-review")).toContainText("Exempel");
    await expect(page.locator(".entry-registration-review")).toContainText("2026-10-01 10:00:00 GMT+02:00");
    expect(attempts).toHaveLength(0);
    await page.context().addCookies([{ name: "otid_entry_registration_admin_csrf", value: "c".repeat(43),
      url: test.info().project.use.baseURL as string }]);
    await page.getByRole("button", { name: "Bekräfta och registrera" }).click();
    await expect(page.getByRole("button", { name: "Försök igen med samma begäran" })).toBeVisible();
    await expect(page.locator('.entry-registration-review[data-tone="unknown"]')).toContainText("Svaret är okänt");
    await page.getByRole("button", { name: "Försök igen med samma begäran" }).click();
    await expect.poll(() => attempts.length).toBe(2);
    expect(attempts[1]).toEqual(attempts[0]);
    expect(JSON.parse(attempts[0]!.body)).toMatchObject({ fixedStartTime: "2026-10-01T08:00:00.000Z",
      assignedStartSlot: { fixedStartTime: "2026-10-01T08:00:00.000Z", sourceHash: "a".repeat(64) } });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: test.info().outputPath(`registration-unknown-${viewport.width}.png`), fullPage: true });
  });
}

test("TASK252 ignores late slots and reports a mismatched event zone", async ({ page }) => {
  let authorized = false;
  let releaseFirstSlot: (() => void) | undefined;
  let slotReads = 0;
  await page.route("**/api/**", async route => {
    const path = new URL(route.request().url()).pathname;
    if (path === `/api/admin/races/${raceId}/entry-registration-session` && route.request().method() === "POST") {
      authorized = true;
      return route.fulfill({ status: 200, json: { formatVersion: 1, raceId, capability: "REGISTER_ENTRY",
        expiresAt: new Date(Date.now() + 10 * 60_000).toISOString() } });
    }
    if (path === `/api/admin/races/${raceId}/entry-registration-classes`) return route.fulfill({ status: authorized ? 200 : 401,
      json: authorized ? classes : { formatVersion: 1, error: "UNAUTHORIZED" } });
    if (path === `/api/admin/races/${raceId}/entry-registration-start-slot-candidates/${fixedId}`) {
      const readIndex = ++slotReads;
      if (readIndex === 1) await new Promise<void>(resolve => { releaseFirstSlot = resolve; });
      return route.fulfill({ status: 200, json: readIndex === 1 ? slots : { ...slots, timeZone: "UTC" } });
    }
    return route.abort();
  });
  await page.goto(`/admin/${raceId}/registration`);
  await page.getByLabel("Registreringsbehörighet").fill(`otid_org_entry_registration_v1.${raceId}.${"a".repeat(43)}`);
  await page.getByRole("button", { name: "Logga in" }).click();
  const raceClass = page.getByRole("combobox", { name: "Klass" });
  await raceClass.selectOption(fixedId);
  await expect.poll(() => slotReads).toBe(1);
  await raceClass.selectOption(punchId);
  releaseFirstSlot?.();
  await expect(page.getByLabel("Välj en ledig lottad starttid")).toHaveCount(0);
  await raceClass.selectOption(fixedId);
  await expect(page.getByRole("alert").filter({ hasText: "Lottade tider kunde inte verifieras" })).toBeVisible();
  await expect(page.getByLabel("Välj en ledig lottad starttid")).toHaveCount(0);
});
