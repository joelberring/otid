import { randomUUID } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import { publishRaceViaApi, registerAccount, TIME_ZONE, today, unique, warmRoute } from "./helpers";

/**
 * Översynen av startsidan 2026-11-17: "Har du en kod?" överst. Deltagaren skriver koden (eller klistrar in hela adressen)
 * och hamnar på tävlingssidan; en okänd kod ger ett besked på startsidan. Arrangören har en egen väg, och rutorna under
 * "Mer än tidtagning" är länkar. Allt även på 390 px, där kodfältet syns utan att rulla.
 */
async function createPublishedRace(page: Page, eventName: string): Promise<void> {
  const origin = new URL(page.url()).origin;
  const csrf = (await page.context().cookies()).find(cookie => /otid[-_]organizer[-_]csrf$/.test(cookie.name))?.value ?? "";
  const response = await page.request.post("/api/organizer/events", {
    headers: { origin, "x-otid-csrf": csrf, "idempotency-key": `organizer-event-create:${randomUUID()}` },
    data: { formatVersion: 1, eventName, raceName: "Huvudlopp", raceDate: today(), timeZone: TIME_ZONE, raceType: "TRAINING" } });
  expect(response.status()).toBe(201);
  await publishRaceViaApi(page, (await response.json() as { raceId: string }).raceId);
}

async function join(page: Page, code: string) {
  await page.getByLabel("Kod eller länk").fill(code);
  await page.getByRole("button", { name: "Gå med" }).click();
}

test("startsidan: gå med med kod eller adress, okänd kod, arrangörens väg och rutorna som länkar", async ({ browser }) => {
  test.setTimeout(240_000);
  const suffix = unique();
  const name = `Kodträningen ${suffix}`;
  const owner = await registerAccount(browser, `kod.${suffix}@exempel.se`, "Kim Kod");
  for (const path of ["/", "/kod", "/t/aaaaaa"]) await warmRoute(owner, path);
  await createPublishedRace(owner, name);

  const visitor = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage();
  await visitor.goto(`/?q=${encodeURIComponent(name)}`);
  const hubPath = await visitor.getByRole("link", { name }).getAttribute("href");
  expect(hubPath).toMatch(/^\/t\/[2-9a-hjkmnp-z]{6}$/);
  const code = hubPath!.slice(3);

  // Mobil: kodfältet syns utan att rulla, med rätt tangentbord och stora tryckytor, före sökningen och målningen.
  await visitor.goto("/");
  const field = visitor.getByLabel("Kod eller länk");
  await expect(visitor.getByRole("heading", { name: "Har du en kod?" })).toBeInViewport();
  await expect(field).toBeInViewport();
  await expect(field).toHaveAttribute("autocapitalize", "none");
  await expect(field).toHaveAttribute("autocorrect", "off");
  await expect(field).toHaveAttribute("inputmode", "text");
  const [fieldBox, buttonBox] = [await field.boundingBox(), await visitor.getByRole("button", { name: "Gå med" }).boundingBox()];
  expect(fieldBox!.height).toBeGreaterThanOrEqual(44);
  expect(buttonBox!.height).toBeGreaterThanOrEqual(44);
  expect(buttonBox!.y + buttonBox!.height).toBeLessThanOrEqual(844);
  expect((await visitor.getByRole("search").boundingBox())!.y).toBeGreaterThan(fieldBox!.y);
  expect((await visitor.getByTestId("home-painting").boundingBox())!.y).toBeGreaterThan((await visitor.locator("#pagar").boundingBox())!.y);
  expect(await visitor.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);

  // Koden med versaler och blanksteg leder till tävlingssidan.
  await join(visitor, ` ${code.toUpperCase()} `);
  await visitor.waitForURL(new RegExp(`/t/${code}$`));
  await expect(visitor.getByRole("heading", { name, level: 1 })).toBeVisible();

  // En hel adress, inklistrad.
  await visitor.goto("/");
  await join(visitor, `https://otid.berring.se/t/${code}`);
  await visitor.waitForURL(new RegExp(`/t/${code}$`));
  await expect(visitor.getByRole("heading", { name, level: 1 })).toBeVisible();

  // En okänd kod: tillbaka till startsidan med beskedet, utan koden i adressen.
  await visitor.goto("/");
  await join(visitor, "zzzzzz");
  await visitor.waitForURL(/\/\?kodfel=saknas#kod$/);
  await expect(visitor.getByTestId("home-join").getByRole("alert")).toHaveText("Koden hittades inte. Kontrollera att du skrivit rätt.");
  expect(visitor.url()).not.toContain("zzzzzz");

  // Datorbredd: samma väg med Enter.
  await visitor.setViewportSize({ width: 1280, height: 900 });
  await visitor.goto("/");
  await visitor.getByLabel("Kod eller länk").fill(`otid.berring.se/t/${code}/live`);
  await visitor.getByLabel("Kod eller länk").press("Enter");
  await visitor.waitForURL(new RegExp(`/t/${code}$`));

  // Arrangörens väg och rutorna under "Mer än tidtagning".
  await visitor.goto("/");
  await expect(visitor.getByTestId("home-organizer").getByRole("link", { name: "Kom igång som arrangör" })).toHaveAttribute("href", "/organizer");
  const features = visitor.getByTestId("home-features");
  await expect(features.getByRole("link")).toHaveCount(6);
  await expect(features.getByRole("link", { name: /^AI-koppling/ })).toHaveAttribute("href", "/om");
  await expect(features.getByRole("link", { name: /^Klubbar och grupper/ })).toHaveAttribute("href", "/organizer");
  await expect(visitor.getByRole("heading", { name: "Så är O-Tid byggt" })).toHaveCount(0);
  await visitor.goto("/om");
  await expect(visitor.getByRole("link", { name: "O-Tid på GitHub" })).toHaveAttribute("href", "https://github.com/joelberring/otid");

  // Den inloggade har Mina tävlingar och behöver inte arrangörens rad.
  await owner.goto("/");
  await expect(owner.getByTestId("home-join")).toBeVisible();
  await expect(owner.getByTestId("home-organizer")).toHaveCount(0);
});
