import { expect, test } from "@playwright/test";
import { createRace, publishRaceViaApi, registerAccount, unique } from "./helpers";

/**
 * Idéerna 2026-11-08 (engelska): en webbläsare utan svenska får startsidan, sidfoten och Om O-Tid på engelska (med avsnittet
 * om klubbar utanför Sverige); länken byter språk, valet sparas och går att byta tillbaka. En svensk webbläsare får svenska.
 */
test("språk: engelska för den som inte har svenska, och språkvalet", async ({ browser }) => {
  const english = await browser.newContext({ locale: "en-US" });
  const page = await english.newPage();
  await page.goto("/");
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Events");
  await expect(page.getByRole("contentinfo")).toContainText("About O-Tid");
  await page.goto("/om");
  await expect(page.getByRole("heading", { name: "Clubs outside Sweden" })).toBeVisible();
  await expect(page.locator("[data-testid=language-switch]:visible")).toHaveText("Svenska");
  await page.locator("[data-testid=language-switch]:visible").click();
  await expect(page).toHaveURL(/\/om$/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Om O-Tid");
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Tävlingar");
  await page.locator("[data-testid=language-switch]:visible").click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Events");
  await english.close();

  const swedish = await browser.newContext();
  const svPage = await swedish.newPage();
  await svPage.goto("/");
  await expect(svPage.getByRole("heading", { level: 1 })).toHaveText("Tävlingar");
  await expect(svPage.locator("[data-testid=language-switch]:visible")).toHaveText("English");
  await swedish.close();
});

/** Del 2: tävlingssidan och resultatlistan på engelska för en besökare med engelska (tävlingen skapas på svenska). */
test("språk: tävlingssidan och resultatlistan på engelska", async ({ browser }) => {
  test.setTimeout(240_000);
  const suffix = unique();
  const owner = await registerAccount(browser, `sprak.${suffix}@exempel.se`, "Sune Språk");
  const name = `Evening training ${suffix}`;
  const raceId = await createRace(owner, name, undefined, "Träning");
  await publishRaceViaApi(owner, raceId);
  const visitor = await (await browser.newContext({ locale: "en-GB" })).newPage();
  await visitor.goto(`/?q=${suffix}`);
  await visitor.getByRole("link", { name: new RegExp(name) }).first().click();
  await expect(visitor.getByRole("heading", { level: 1, name })).toBeVisible();
  await expect(visitor.getByRole("link", { name: /^Results/ })).toContainText("The results show here when the first runners have read out.");
  await expect(visitor.getByText("Training", { exact: false }).first()).toBeVisible();
  await visitor.getByRole("link", { name: /^Results/ }).click();
  await expect(visitor.getByRole("link", { name: "‹ Event page" })).toBeVisible();
  await expect(visitor.getByRole("toolbar", { name: "List tools" })).toBeVisible();
  await expect(visitor.getByRole("button", { name: "By class" })).toBeVisible();
  await expect(visitor.getByRole("button", { name: "Print" })).toBeVisible();
  // Del 3: Live.
  await visitor.getByRole("link", { name: "‹ Event page" }).click();
  await visitor.getByRole("link", { name: /^Live/ }).click();
  await expect(visitor.getByRole("heading", { name: "No finishers yet – the page updates by itself." })).toBeVisible();
  // Del 5: QR-sidan.
  await visitor.goto(visitor.url().replace(/\/live$/, "/qr"));
  await expect(visitor.getByRole("button", { name: "Print" })).toBeVisible();
  await expect(visitor.getByText("Results and split times")).toBeVisible();
});

/** Del 4: inloggningen och Skapa konto på engelska. */
test("språk: inloggningen på engelska", async ({ browser }) => {
  const page = await (await browser.newContext({ locale: "en-US" })).newPage();
  await page.goto("/organizer");
  await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
  await expect(page.getByLabel("Email address")).toBeVisible();
  await page.getByRole("button", { name: "No account? Create one" }).click();
  await expect(page.getByRole("heading", { name: "Create account" })).toBeVisible();
  await expect(page.getByLabel("Your name")).toBeVisible();
  await page.goto("/recover");
  await expect(page.getByRole("heading", { name: "Forgot password" })).toBeVisible();
  await page.goto("/verify");
  await expect(page.getByText("The link is missing its key. Open the link in the email again.")).toBeVisible();
});

/** Del 7: Mitt konto och kontomenyn på engelska för den som valt engelska. */
test("språk: Mitt konto på engelska", async ({ browser }) => {
  const owner = await registerAccount(browser, `konto.${unique()}@exempel.se`, "Kim Konto");
  await owner.goto(`/sprak?till=en&tillbaka=${encodeURIComponent("/konto")}`);
  await expect(owner.getByRole("heading", { name: "My account", level: 1 })).toBeVisible();
  await expect(owner.getByRole("button", { name: "Sign out from all devices" })).toBeVisible();
  // Del 9: AI-kopplingarna och Lantmäteriet.
  await expect(owner.getByRole("heading", { name: "AI connections" })).toBeVisible();
  await expect(owner.getByText("No AI connections.", { exact: false })).toBeVisible();
  await expect(owner.getByRole("heading", { name: "Lantmäteriet (Swedish mapping authority)" })).toBeVisible();
  await expect(owner.getByRole("button", { name: "Save the credentials" })).toBeVisible();
  // Del 10: Mina klubbar.
  await expect(owner.getByRole("heading", { name: "My clubs" })).toBeVisible();
  await expect(owner.getByRole("combobox", { name: "Search club" })).toBeVisible();
  await owner.getByRole("button", { name: "Account: Kim Konto" }).click();
  await expect(owner.getByRole("link", { name: "My events" }).first()).toBeVisible();
  await owner.goto(`/sprak?till=sv&tillbaka=${encodeURIComponent("/konto")}`);
  await expect(owner.getByRole("heading", { name: "Mitt konto", level: 1 })).toBeVisible();
});

/** Del 8: festens sida och QR-skylt på engelska. */
test("språk: festen på engelska", async ({ browser }) => {
  test.setTimeout(240_000);
  const suffix = unique();
  const owner = await registerAccount(browser, `sprakfest.${suffix}@exempel.se`, "Fia Fest");
  const raceId = await createRace(owner, `Party ${suffix}`, undefined, "Fest");
  const origin = new URL(owner.url()).origin;
  const csrf = (await owner.context().cookies()).find(row => /otid[-_]organizer[-_]csrf$/.test(row.name))?.value ?? "";
  const published = await owner.request.put(`/api/admin/races/${raceId}/administrator/race-publication`, {
    headers: { origin, "x-otid-csrf": csrf } });
  expect(published.status()).toBe(200);
  const shortCode = (await published.json() as { publication: { shortCode: string } }).publication.shortCode;
  const visitor = await (await browser.newContext({ locale: "en-GB" })).newPage();
  await visitor.goto(`/fest/${shortCode}`);
  await expect(visitor.getByRole("heading", { name: "Best sellers" })).toBeVisible({ timeout: 30_000 });
  await expect(visitor.getByRole("heading", { name: "Tonight's split times" })).toBeVisible();
  await expect(visitor.getByRole("list", { name: "How to pay" })).toContainText("Clear your card first");
  await visitor.goto(`/fest/${shortCode}/qr`);
  await expect(visitor.getByRole("button", { name: "Print" })).toBeVisible();
  await expect(visitor.getByText("Follow the evening here")).toBeVisible();
});

/** Arbetsytan del 1: skalet, delarnas läge, Inställningar och Personer med behörighet på engelska. */
test("språk: arbetsytans skal på engelska", async ({ browser }) => {
  test.setTimeout(180_000);
  const owner = await registerAccount(browser, `sprakyta.${unique()}@exempel.se`, "Ylva Yta");
  const raceId = await createRace(owner, `Workspace ${unique()}`, undefined, "Träning");
  await owner.goto(`/sprak?till=en&tillbaka=${encodeURIComponent(`/admin/${raceId}/manage`)}`);
  const parts = owner.getByRole("navigation", { name: "Parts of the event" });
  await expect(parts.getByRole("button", { name: "Courses & classes" })).toBeVisible({ timeout: 30_000 });
  await expect(parts.getByText("No course yet")).toBeVisible();
  await expect(owner.getByRole("link", { name: "‹ My events" })).toBeVisible();
  // Arbetsytan del 2: arbetsytans egna texter (Ny bana).
  await expect(owner.getByRole("button", { name: "New course" }).first()).toBeVisible();
  await owner.getByRole("button", { name: "New course" }).first().click();
  await expect(owner.getByLabel("Course name")).toBeVisible();
  await parts.getByRole("button", { name: "Settings" }).click();
  await expect(owner.getByRole("heading", { name: "People with access" })).toBeVisible();
  await expect(owner.getByRole("group", { name: "Type of event" })).toContainText("Training");
  // Del 25: informationen till löparna, självregistreringen och Publicera.
  await expect(owner.getByText("Information for the runners")).toBeVisible();
  await expect(owner.getByLabel("Allow self-registration on the day of the event")).toBeVisible();
  await parts.getByRole("button", { name: "Publish" }).click();
  await expect(owner.getByRole("button", { name: "Publish the event" })).toBeVisible();
  await expect(owner.getByRole("link", { name: "Preview the event page" })).toBeVisible();
  // Del 27: hjälpen på engelska, med sökning.
  await owner.getByTestId("help-button").first().click();
  const help = owner.getByRole("dialog", { name: "Help" });
  await expect(help.getByRole("heading", { name: "Help for this page" })).toBeVisible();
  await expect(help.getByText("Publish the event", { exact: true }).first()).toBeVisible();
  await help.getByLabel("Search the help").fill("borrowed card");
  await expect(help.getByText("Unknown card, direct entry and borrowed card")).toBeVisible();
  await help.getByRole("button", { name: "Close" }).click();
  // Del 33: kartprojekten.
  await owner.goto("/organizer/map-projects");
  await expect(owner.getByRole("heading", { name: "My map projects" })).toBeVisible({ timeout: 30_000 });
  // Del 35: träningsgrupperna.
  await owner.goto("/organizer");
  await owner.getByRole("button", { name: "New group" }).click();
  await expect(owner.getByLabel("Group name")).toBeVisible();
  await expect(owner.getByRole("button", { name: "Create group" })).toBeVisible();
  // Del 28: banläggningen utan kartfil.
  await owner.goto(`/admin/${raceId}/course-setting`);
  await expect(owner.getByText("Upload the map file first.", { exact: false })).toBeVisible({ timeout: 30_000 });
  // Avläsningen (eget appskal) följer språket.
  await owner.goto(`/admin/${raceId}/readout`);
  await expect(owner.getByRole("button", { name: "Start practice station" })).toBeVisible({ timeout: 30_000 });
  await owner.goto(`/sprak?till=sv&tillbaka=${encodeURIComponent(`/admin/${raceId}/manage`)}`);
  await expect(owner.getByRole("navigation", { name: "Tävlingens delar" })).toBeVisible({ timeout: 30_000 });
});
