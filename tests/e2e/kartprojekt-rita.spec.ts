import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { readMapFile, type MapObject } from "../../packages/map-file/src";
import { registerAccount, reviewScreenshots, unique, warmRoute } from "./helpers";

/**
 * ADR-0219 (K1): rita i kartprojektet. Ett eget projekt från Mapper-fixturen; på kartan ritar ägaren en stig (505) med tre
 * klick och Enter, ångrar och gör om, markerar stenen (206) och drar den, och tar bort den. Varje ändring sparas i kön och
 * syns på servern (synken från början), och efter en omladdning ritas samma karta med ändringarna.
 */
const mapBytes = new Uint8Array(readFileSync(new URL("../../fixtures/maps/kartfil.omap", import.meta.url)));
const parsed = readMapFile(mapBytes, "Rita.omap");

async function csrfOf(page: Page): Promise<string> {
  return (await page.context().cookies()).find(row => /otid[-_]organizer[-_]csrf$/.test(row.name))?.value ?? "";
}

type ServerObject = { key: string; state: { kind: string; object?: MapObject } };

async function serverObjects(page: Page, projectId: string, baseURL: string): Promise<ServerObject[]> {
  const response = await page.request.post(`/api/organizer/map-projects/${projectId}/sync`, { headers: { origin: baseURL,
    "x-otid-csrf": await csrfOf(page), "content-type": "application/json" }, data: { formatVersion: 1, clientId: "e2e-lasare", since: 0, edits: [] } });
  expect(response.status()).toBe(200);
  return (await response.json() as { objects: ServerObject[] }).objects;
}

/** Kartans mm till sidans pixlar, ur kartans attribut (mitten och skalan). */
async function screenOf(page: Page, point: { x: number; y: number }) {
  const map = page.getByTestId("course-setting-map");
  const box = (await map.boundingBox())!;
  const [cx, cy] = (await map.getAttribute("data-center"))!.split(",").map(Number) as [number, number];
  const px = Number(await map.getAttribute("data-px-per-mm"));
  return { x: box.x + box.width / 2 + (point.x - cx) * px, y: box.y + box.height / 2 - (point.y - cy) * px };
}

async function settled(page: Page) {
  await expect(page.getByTestId("map-project-sync")).toHaveAttribute("data-pending", "0", { timeout: 20_000 });
  await expect(page.getByTestId("map-project-sync")).toHaveAttribute("data-state", "idle", { timeout: 20_000 });
}

test("kartprojekt: rita en stig, ångra och gör om, flytta och ta bort en sten", async ({ browser, baseURL }) => {
  test.setTimeout(300_000);
  const owner = await registerAccount(browser, `ritar.${unique()}@exempel.se`, "Rita Ritare");
  await warmRoute(owner, "/api/organizer/map-projects/upload", "POST");
  const created = await owner.request.post("/api/organizer/map-projects/upload", { headers: { origin: baseURL!, "x-otid-csrf": await csrfOf(owner),
    "content-type": "application/octet-stream", "x-otid-request-id": crypto.randomUUID(), "x-otid-name": "Rita", "x-otid-file-name": "Rita.omap" },
    data: Buffer.from(mapBytes) });
  expect(created.status(), await created.text()).toBe(201);
  const projectId = (await created.json() as { projectId: string }).projectId;

  await owner.setViewportSize({ width: 1280, height: 900 });
  await owner.goto(`/organizer/map-projects/${projectId}`);
  await owner.getByTestId("map-project-open-map").click();
  await owner.waitForURL(/\/map$/);
  const map = owner.getByTestId("course-setting-map");
  await expect(map).toHaveAttribute("data-drawn", "true", { timeout: 60_000 });
  // Hela kartan (120 × 100 mm) syns stort nog att rita i.
  expect(Number(await map.getAttribute("data-px-per-mm"))).toBeGreaterThan(3);
  await expect(owner.getByTestId("map-project-symbols").locator("[data-code='505.0']")).toBeVisible();

  // Rita en stig: välj 505, tre klick och Enter.
  await owner.getByTestId("map-project-symbols").locator("[data-code='505.0']").click();
  await expect(owner.getByRole("button", { name: "Rita", exact: true })).toHaveAttribute("aria-pressed", "true");
  for (const point of [{ x: 10, y: 10 }, { x: 40, y: 30 }, { x: 70, y: 15 }]) {
    const at = await screenOf(owner, point);
    await owner.mouse.click(at.x, at.y);
    await owner.waitForTimeout(400);
  }
  await expect(owner.getByTestId("map-project-hint")).toContainText("505");
  await owner.keyboard.press("Enter");
  await settled(owner);
  let objects = await serverObjects(owner, projectId, baseURL!);
  const path = objects.find(object => object.key.startsWith("n:") && object.state.kind === "OBJECT");
  expect(path?.state.object).toMatchObject({ kind: "line" });
  expect(path?.state.object?.kind === "line" && path.state.object.path).toHaveLength(3);
  await reviewScreenshots(owner, "kartprojekt-rita");

  // Ångra och gör om.
  await owner.keyboard.press("Control+z");
  await settled(owner);
  objects = await serverObjects(owner, projectId, baseURL!);
  expect(objects.find(object => object.key === path!.key)?.state.kind).toBe("DELETED");
  await owner.keyboard.press("Control+Shift+z");
  await settled(owner);
  objects = await serverObjects(owner, projectId, baseURL!);
  expect(objects.find(object => object.key === path!.key)?.state.kind).toBe("OBJECT");

  // Markera stenen och dra den 5 mm åt höger.
  await owner.keyboard.press("e");
  const stone = parsed.objects.find(object => object.kind === "point")!;
  if (stone.kind !== "point") throw new Error("ingen sten");
  const from = await screenOf(owner, stone.at);
  await owner.mouse.click(from.x, from.y);
  await expect(owner.getByTestId("map-project-hint")).toContainText("206");
  const px = Number(await map.getAttribute("data-px-per-mm"));
  await owner.mouse.move(from.x, from.y);
  await owner.mouse.down();
  for (let step = 1; step <= 5; step += 1) await owner.mouse.move(from.x + step * px, from.y, { steps: 2 });
  await owner.mouse.up();
  await settled(owner);
  objects = await serverObjects(owner, projectId, baseURL!);
  const moved = objects.find(object => object.key.startsWith("b:") && object.state.object?.kind === "point");
  expect(moved?.state.object?.kind === "point" && moved.state.object.at.x).toBeCloseTo(stone.at.x + 5, 0);

  // Ta bort den med Delete.
  await owner.keyboard.press("Delete");
  await settled(owner);
  objects = await serverObjects(owner, projectId, baseURL!);
  expect(objects.find(object => object.key === moved!.key)?.state.kind).toBe("DELETED");

  // Efter omladdning: samma ändringar (kön är tom och kartan ritas med serverns läge).
  await owner.reload();
  await expect(map).toHaveAttribute("data-drawn", "true", { timeout: 60_000 });
  await settled(owner);
  await expect(owner.getByText("Ändringar")).toHaveCount(0);

  // I telefonen: kartan fyller rutan och symbolerna ligger bakom en knapp.
  await owner.setViewportSize({ width: 390, height: 844 });
  await expect(map).toHaveAttribute("data-drawn", "true", { timeout: 30_000 });
  await expect(owner.getByTestId("map-project-symbols")).toBeHidden();
  if (process.env.E2E_SCREENSHOT_DIR) await owner.screenshot({ path: `${process.env.E2E_SCREENSHOT_DIR}/kartprojekt-rita-mobil-karta.png` });
  await owner.getByRole("button", { name: "Symboler och lager" }).click();
  await expect(owner.getByTestId("map-project-symbols")).toBeVisible();
  expect((await map.boundingBox())!.height).toBeGreaterThan(300);
  if (process.env.E2E_SCREENSHOT_DIR) await owner.screenshot({ path: `${process.env.E2E_SCREENSHOT_DIR}/kartprojekt-rita-mobil.png` });
});
