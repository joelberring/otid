import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { registerAccount, unique, warmRoute } from "./helpers";

/**
 * Idéerna 2026-11-08: den nya startsidan. Besökaren ser tävlingarna först och sedan vad O-Tid gör utöver tidtagning, hur det
 * är byggt och länken till koden. Den inloggade ser också sina kartprojekt (och klubbar och grupper) överst.
 */
const mapBytes = new Uint8Array(readFileSync(new URL("../../fixtures/maps/kartfil.omap", import.meta.url)));
const csrfOf = async (page: Page) => (await page.context().cookies()).find(row => /otid[-_]organizer[-_]csrf$/.test(row.name))?.value ?? "";

test("startsidan: mer än tidtagning, koden och den inloggades projekt", async ({ browser, baseURL }) => {
  test.setTimeout(180_000);
  const visitor = await (await browser.newContext()).newPage();
  await visitor.goto("/");
  const features = visitor.getByTestId("home-features");
  await expect(features.getByRole("heading", { name: "Mer än tidtagning" })).toBeVisible();
  await expect(features.locator("li")).toHaveCount(6);
  await expect(visitor.getByRole("link", { name: "O-Tid på GitHub" })).toHaveAttribute("href", "https://github.com/joelberring/otid");
  await expect(visitor.getByTestId("home-personal")).toHaveCount(0);

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
});
