import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { registerAccount, unique, warmRoute } from "./helpers";

/**
 * Idéerna 2026-11-08: den nya startsidan. Besökaren ser tävlingarna först och sedan vad O-Tid gör utöver tidtagning, hur det
 * är byggt och länken till koden. Den inloggade ser också sina kartprojekt (och klubbar och grupper) överst. Veckans målning syns
 * bara på startsidan, utloggad och inloggad.
 */
const mapBytes = new Uint8Array(readFileSync(new URL("../../fixtures/maps/kartfil.omap", import.meta.url)));
const csrfOf = async (page: Page) => (await page.context().cookies()).find(row => /otid[-_]organizer[-_]csrf$/.test(row.name))?.value ?? "";

test("startsidan: mer än tidtagning, koden, veckans målning och den inloggades projekt", async ({ browser, baseURL }) => {
  test.setTimeout(180_000);
  const visitor = await (await browser.newContext()).newPage();
  await visitor.goto("/");
  const features = visitor.getByTestId("home-features");
  await expect(features.getByRole("heading", { name: "Mer än tidtagning" })).toBeVisible();
  await expect(features.locator("li")).toHaveCount(6);
  await expect(visitor.getByRole("link", { name: "O-Tid på GitHub" })).toHaveAttribute("href", "https://github.com/joelberring/otid");
  await expect(visitor.getByTestId("home-personal")).toHaveCount(0);

  // Veckans målning (ägarens önskemål 2026-11-12): hel bild från samma värd och texten i startsidans sidfot, inte på andra sidor.
  const painting = visitor.getByTestId("home-painting");
  await expect(painting).toBeVisible();
  await expect(painting).toHaveAttribute("alt", /^Veckans målning: .+ av Emm Berring$/);
  const src = await painting.getAttribute("src");
  expect(src).toMatch(/^\/malningar\/[a-z]+\.jpg$/);
  expect((await visitor.request.get(src!)).status()).toBe(200);
  expect(await painting.evaluate((image: HTMLImageElement) => image.complete && image.naturalWidth > 0)).toBe(true);
  const footer = visitor.getByRole("contentinfo");
  await expect(footer).toHaveCount(1);
  await expect(footer.getByTestId("home-painting-credit")).toHaveText(/^Veckans målning: .+ av Emm Berring, (olja|akryl och olja) på duk, \d+ × \d+ cm, \d{4}\.$/);
  await expect(footer.getByRole("link", { name: "Emm Berrings portfolio" })).toHaveAttribute("href", "https://berring.se/emm/");
  // Datorbredd: till höger om rubriken, högst cirka 400 × 300 px. Mobil: kant i kant mellan sökrutan och listorna, utan sidled.
  await visitor.setViewportSize({ width: 1280, height: 900 });
  const [wide, heading] = [await painting.boundingBox(), await visitor.getByRole("heading", { level: 1 }).boundingBox()];
  expect(wide!.x).toBeGreaterThan(heading!.x + heading!.width);
  expect(wide!.width).toBeLessThanOrEqual(401);
  expect(wide!.height).toBeLessThanOrEqual(301);
  await visitor.setViewportSize({ width: 390, height: 844 });
  const narrow = await painting.boundingBox();
  expect(narrow!.x).toBe(0);
  expect(Math.round(narrow!.width)).toBe(390);
  expect(narrow!.y).toBeGreaterThan((await visitor.getByRole("search").boundingBox())!.y);
  expect(await visitor.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);

  const owner = await registerAccount(browser, `start.${unique()}@exempel.se`, "Stina Start");
  await warmRoute(owner, "/api/organizer/map-projects/upload", "POST");
  const created = await owner.request.post("/api/organizer/map-projects/upload", { headers: { origin: baseURL!, "x-otid-csrf": await csrfOf(owner),
    "content-type": "application/octet-stream", "x-otid-request-id": crypto.randomUUID(), "x-otid-name": "Kungshatt", "x-otid-file-name": "Kungshatt.omap" },
    data: Buffer.from(mapBytes) });
  expect(created.status()).toBe(201);
  const projectId = (await created.json() as { projectId: string }).projectId;
  await owner.goto("/");
  const personal = owner.getByTestId("home-personal");
  await expect(personal.getByRole("heading", { name: "Ditt O-Tid" })).toBeVisible();
  await expect(personal.getByRole("link", { name: "Kungshatt" })).toHaveAttribute("href", `/organizer/map-projects/${projectId}`);
  await expect(owner.getByTestId("home-painting")).toBeVisible();

  // Mina tävlingar har sidfoten som förut, utan målningen.
  await owner.goto("/organizer");
  await expect(owner.getByRole("contentinfo").getByRole("link", { name: "Om O-Tid" })).toBeVisible();
  await expect(owner.getByTestId("home-painting")).toHaveCount(0);
  await expect(owner.getByText("Veckans målning")).toHaveCount(0);
  await expect(owner.getByRole("link", { name: "Emm Berrings portfolio" })).toHaveCount(0);
});
