import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { mapPointToWgs84, readMapFile, type MapObject } from "../../packages/map-file/src";
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
  // Ägaren 2026-11-10: symbolerna som ett tätt rutnät i panelens flik Symboler, bilder utan nummer; numret och namnet när musen står över.
  const grid = owner.getByTestId("map-project-symbols");
  await expect(grid).toHaveAttribute("data-view", "grid");
  await expect(grid.locator("[data-code='505.0']")).toHaveAttribute("aria-pressed", "true");
  await grid.locator("[data-code='505.0']").hover();
  await expect(owner.getByRole("tooltip")).toContainText("505");
  await expect(grid).not.toContainText("505");
  await expect(owner.getByTestId("map-project-symbols-recent").locator("[data-code='505.0']")).toBeVisible();
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
  await owner.keyboard.press("q");
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
  await expect(owner.getByText("Ändringar", { exact: true })).toHaveCount(0);

  // I telefonen: kartan fyller rutan och symbolerna ligger bakom en knapp.
  await owner.setViewportSize({ width: 390, height: 844 });
  await expect(map).toHaveAttribute("data-drawn", "true", { timeout: 30_000 });
  await expect(owner.getByTestId("map-project-symbols")).toBeHidden();
  if (process.env.E2E_SCREENSHOT_DIR) await owner.screenshot({ path: `${process.env.E2E_SCREENSHOT_DIR}/kartprojekt-rita-mobil-karta.png` });
  await owner.getByRole("button", { name: "Panel" }).click();
  await expect(owner.getByTestId("map-project-symbols")).toBeVisible();
  expect((await map.boundingBox())!.height).toBeGreaterThan(300);
  if (process.env.E2E_SCREENSHOT_DIR) await owner.screenshot({ path: `${process.env.E2E_SCREENSHOT_DIR}/kartprojekt-rita-mobil.png` });
});

/**
 * K3 (ägaren 2026-11-08: snabb redigering): rita en rak stig, markera den, dra i sträckan så att den blir en kurva, dubbelklicka
 * på kurvan för en ny punkt och dubbelklicka på punkten för att ta bort den igen; "Flytta hela" drar linjen hel.
 */
test("kartprojekt: böja en sträcka, lägga till och ta bort punkter på en kurva", async ({ browser, baseURL }) => {
  test.setTimeout(240_000);
  const owner = await registerAccount(browser, `kurvor.${unique()}@exempel.se`, "Kurt Kurva");
  await warmRoute(owner, "/api/organizer/map-projects/upload", "POST");
  const created = await owner.request.post("/api/organizer/map-projects/upload", { headers: { origin: baseURL!, "x-otid-csrf": await csrfOf(owner),
    "content-type": "application/octet-stream", "x-otid-request-id": crypto.randomUUID(), "x-otid-name": "Kurvor", "x-otid-file-name": "Kurvor.omap" },
    data: Buffer.from(mapBytes) });
  expect(created.status()).toBe(201);
  const projectId = (await created.json() as { projectId: string }).projectId;
  await owner.setViewportSize({ width: 1280, height: 900 });
  await owner.goto(`/organizer/map-projects/${projectId}/map`);
  const map = owner.getByTestId("course-setting-map");
  await expect(map).toHaveAttribute("data-drawn", "true", { timeout: 60_000 });
  const pathOf = async () => {
    const objects = await serverObjects(owner, projectId, baseURL!);
    const line = objects.find(object => object.key.startsWith("n:") && object.state.object?.kind === "line")?.state.object;
    return line?.kind === "line" ? line.path : [];
  };

  // En rak stig med två punkter (y = 85, ovanför kartans objekt).
  await owner.getByTestId("map-project-symbols").locator("[data-code='505.0']").click();
  for (const point of [{ x: 20, y: 85 }, { x: 80, y: 85 }]) {
    const at = await screenOf(owner, point);
    await owner.mouse.click(at.x, at.y);
    await owner.waitForTimeout(400);
  }
  await owner.keyboard.press("Enter");
  await settled(owner);
  expect((await pathOf()).map(command => command.type)).toEqual(["M", "L"]);

  // Stigen är markerad efter ritningen (ett klick till på samma ställe tar objektet under). Dra mitt på sträckan 6 mm nedåt:
  // den blir en kurva genom punkten.
  await owner.keyboard.press("q");
  const middle = await screenOf(owner, { x: 50, y: 85 });
  await expect(owner.getByTestId("map-project-hint")).toContainText("505");
  const px = Number(await map.getAttribute("data-px-per-mm"));
  await owner.mouse.move(middle.x, middle.y);
  await owner.mouse.down();
  for (let step = 1; step <= 6; step += 1) await owner.mouse.move(middle.x, middle.y + step * px, { steps: 2 });
  await owner.mouse.up();
  await settled(owner);
  let path = await pathOf();
  expect(path.map(command => command.type)).toEqual(["M", "C"]);

  // Dubbelklick på kurvan (där den nu går, 6 mm lägre): en ny punkt.
  const bent = await screenOf(owner, { x: 50, y: 79 });
  await owner.mouse.dblclick(bent.x, bent.y);
  await settled(owner);
  path = await pathOf();
  expect(path.map(command => command.type)).toEqual(["M", "C", "C"]);
  expect(path[1]!.y).toBeCloseTo(79, 0);

  // Dubbelklick på den nya punkten: borta igen (en kurva med de yttre styrpunkterna).
  const added = await screenOf(owner, { x: path[1]!.x, y: path[1]!.y });
  await expect(owner.getByTestId("map-project-hint")).toContainText("505");
  await owner.mouse.dblclick(added.x, added.y);
  await settled(owner);
  expect((await pathOf()).map(command => command.type)).toEqual(["M", "C"]);

  // Flytta hela: linjen dras hel 5 mm åt höger.
  await owner.getByTestId("map-project-move-whole").click();
  const before = (await pathOf())[0]!;
  const grab = await screenOf(owner, { x: 20, y: 85 });
  await owner.mouse.move(grab.x + 2 * px, grab.y);
  await owner.mouse.down();
  for (let step = 1; step <= 5; step += 1) await owner.mouse.move(grab.x + 2 * px + step * px, grab.y, { steps: 2 });
  await owner.mouse.up();
  await settled(owner);
  const after = (await pathOf())[0]!;
  expect(after.x - before.x).toBeCloseTo(5, 0);
  expect(after.y).toBeCloseTo(before.y, 1);
});

/**
 * Ägaren 2026-11-10 (steg K8, R2): tangenterna under vänster hand och verktygen för punkter. W ritar, Backsteg tar bort den sista
 * punkten, A lägger till en punkt med ett klick på sträckan, S tar bort en punkt med ett klick, Cmd/Ctrl+klick gör båda i
 * Redigera, och tangenterna går att byta (sparas i webbläsaren).
 */
test("kartprojekt: tangenter under vänster hand, lägg till och ta bort punkter med ett klick", async ({ browser, baseURL }) => {
  test.setTimeout(240_000);
  const owner = await registerAccount(browser, `tangenter.${unique()}@exempel.se`, "Tage Tangent");
  await warmRoute(owner, "/api/organizer/map-projects/upload", "POST");
  const created = await owner.request.post("/api/organizer/map-projects/upload", { headers: { origin: baseURL!, "x-otid-csrf": await csrfOf(owner),
    "content-type": "application/octet-stream", "x-otid-request-id": crypto.randomUUID(), "x-otid-name": "Tangenter", "x-otid-file-name": "Tangenter.omap" },
    data: Buffer.from(mapBytes) });
  expect(created.status()).toBe(201);
  const projectId = (await created.json() as { projectId: string }).projectId;
  await owner.setViewportSize({ width: 1280, height: 900 });
  await owner.goto(`/organizer/map-projects/${projectId}/map`);
  const map = owner.getByTestId("course-setting-map");
  await expect(map).toHaveAttribute("data-drawn", "true", { timeout: 60_000 });
  const pathOf = async () => {
    const objects = await serverObjects(owner, projectId, baseURL!);
    const line = objects.find(object => object.key.startsWith("n:") && object.state.object?.kind === "line")?.state.object;
    return line?.kind === "line" ? line.path : [];
  };
  const click = async (point: { x: number; y: number }, modifier?: "Meta" | "Control") => {
    const at = await screenOf(owner, point);
    if (modifier) await owner.keyboard.down(modifier);
    await owner.mouse.click(at.x, at.y);
    if (modifier) await owner.keyboard.up(modifier);
    await owner.waitForTimeout(400);
  };

  // Verktygsspalten visar tangenterna. W väljer Rita; tre klick, Backsteg tar bort det sista, ett klick till och Enter.
  await owner.getByTestId("map-project-symbols").locator("[data-code='505.0']").click();
  await owner.keyboard.press("q");
  await expect(owner.getByRole("button", { name: "Redigera", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(owner.getByRole("button", { name: "Redigera", exact: true })).toHaveAttribute("aria-keyshortcuts", "Q");
  await owner.keyboard.press("w");
  await expect(owner.getByRole("button", { name: "Rita", exact: true })).toHaveAttribute("aria-pressed", "true");
  await click({ x: 20, y: 85 });
  await click({ x: 50, y: 85 });
  await click({ x: 60, y: 70 });
  await owner.keyboard.press("Backspace");
  await click({ x: 80, y: 85 });
  await owner.keyboard.press("Enter");
  await settled(owner);
  expect((await pathOf()).map(command => Math.round(command.x))).toEqual([20, 50, 80]);

  // A: ett klick på sträckan ger en ny punkt. S: ett klick på en punkt tar bort den, och ett klick bredvid säger att inget fanns.
  await owner.keyboard.press("a");
  await expect(owner.getByTestId("map-project-add-point")).toHaveAttribute("aria-pressed", "true");
  await expect(owner.getByTestId("map-project-hint")).toHaveText("Klicka på en linje eller en ytas kant för en ny punkt där.");
  await click({ x: 35, y: 85 });
  await settled(owner);
  expect((await pathOf()).map(command => Math.round(command.x))).toEqual([20, 35, 50, 80]);
  await owner.keyboard.press("s");
  await expect(owner.getByTestId("map-project-remove-point")).toHaveAttribute("aria-pressed", "true");
  await click({ x: 50, y: 85 });
  await settled(owner);
  expect((await pathOf()).map(command => Math.round(command.x))).toEqual([20, 35, 80]);
  await click({ x: 65, y: 85 });
  await expect(owner.getByTestId("map-project-hint")).toHaveText("Ingen punkt att ta bort där.");
  expect(await pathOf()).toHaveLength(3);

  // Redigera med Cmd/Ctrl+klick: på en sträcka en ny punkt, på en punkt bort med den.
  await owner.keyboard.press("q");
  await click({ x: 65, y: 85 }, "Control");
  await settled(owner);
  expect((await pathOf()).map(command => Math.round(command.x))).toEqual([20, 35, 65, 80]);
  await click({ x: 35, y: 85 }, "Meta");
  await settled(owner);
  expect((await pathOf()).map(command => Math.round(command.x))).toEqual([20, 65, 80]);

  // Byt tangent: Rita får P. W gör då ingenting, och valet finns kvar efter en omladdning. Återställ ger W igen.
  await owner.getByTestId("map-project-keys-open").click();
  const dialog = owner.getByTestId("map-project-keys");
  await expect(dialog.getByTestId("map-project-key-draw")).toHaveText("W");
  await dialog.getByTestId("map-project-key-draw").click();
  await owner.keyboard.press("p");
  await expect(dialog.getByTestId("map-project-key-draw")).toHaveText("P");
  // Q är Redigeras tangent: ges den till Rita står Redigera utan, och det sägs.
  await dialog.getByTestId("map-project-key-draw").click();
  await owner.keyboard.press("q");
  await expect(dialog.getByTestId("map-project-keys-message")).toHaveText("Redigera hade Q och har nu ingen tangent.");
  await expect(dialog.getByTestId("map-project-key-select")).toHaveText("Ingen");
  await dialog.getByTestId("map-project-key-select").click();
  await owner.keyboard.press("e");
  await dialog.getByTestId("map-project-key-draw").click();
  await owner.keyboard.press("p");
  await dialog.getByRole("button", { name: "Klar" }).click();
  await expect(dialog).toBeHidden();
  await owner.keyboard.press("w");
  await expect(owner.getByRole("button", { name: "Rita", exact: true })).toHaveAttribute("aria-pressed", "false");
  await owner.keyboard.press("p");
  await expect(owner.getByRole("button", { name: "Rita", exact: true })).toHaveAttribute("aria-pressed", "true");
  await owner.reload();
  await expect(map).toHaveAttribute("data-drawn", "true", { timeout: 60_000 });
  await expect(owner.getByRole("button", { name: "Redigera", exact: true })).toHaveAttribute("aria-keyshortcuts", "E");
  await owner.getByTestId("map-project-keys-open").click();
  await dialog.getByTestId("map-project-keys-reset").click();
  await expect(dialog.getByTestId("map-project-key-draw")).toHaveText("W");
  await expect(dialog.getByTestId("map-project-key-select")).toHaveText("Q");
});

/**
 * Ägaren 2026-11-10 (steg K8, R3b): markera flera objekt med en ruta, som i Illustrator. En ruta dragen på tom karta markerar det
 * den rör vid; ett drag inne i markeringen flyttar allt, ett drag strax utanför ett hörn vrider allt, och flytten ångras i ett steg.
 */
test("kartprojekt: markera flera objekt med en ruta, flytta, vrid och ta bort dem tillsammans", async ({ browser, baseURL }) => {
  test.setTimeout(240_000);
  const owner = await registerAccount(browser, `ruta.${unique()}@exempel.se`, "Rut Ruta");
  await warmRoute(owner, "/api/organizer/map-projects/upload", "POST");
  const created = await owner.request.post("/api/organizer/map-projects/upload", { headers: { origin: baseURL!, "x-otid-csrf": await csrfOf(owner),
    "content-type": "application/octet-stream", "x-otid-request-id": crypto.randomUUID(), "x-otid-name": "Ruta", "x-otid-file-name": "Ruta.omap" },
    data: Buffer.from(mapBytes) });
  expect(created.status()).toBe(201);
  const projectId = (await created.json() as { projectId: string }).projectId;
  await owner.setViewportSize({ width: 1280, height: 900 });
  await owner.goto(`/organizer/map-projects/${projectId}/map`);
  const map = owner.getByTestId("course-setting-map");
  await expect(map).toHaveAttribute("data-drawn", "true", { timeout: 60_000 });
  // De egna linjernas första punkt, den nedre linjen först.
  const starts = async () => (await serverObjects(owner, projectId, baseURL!))
    .flatMap(object => object.key.startsWith("n:") && object.state.kind === "OBJECT" && object.state.object?.kind === "line" ? [object.state.object.path[0]!] : [])
    .sort((a, b) => a.y - b.y);
  const drag = async (from: { x: number; y: number }, to: { x: number; y: number }) => {
    const a = await screenOf(owner, from), b = await screenOf(owner, to);
    await owner.mouse.move(a.x, a.y);
    await owner.mouse.down();
    await owner.mouse.move(b.x, b.y, { steps: 8 });
    await owner.mouse.up();
    await owner.waitForTimeout(300);
  };

  // Två stigar ovanför kartans objekt.
  await owner.getByTestId("map-project-symbols").locator("[data-code='505.0']").click();
  for (const y of [85, 90]) {
    for (const x of [20, 80]) { const at = await screenOf(owner, { x, y }); await owner.mouse.click(at.x, at.y); await owner.waitForTimeout(400); }
    await owner.keyboard.press("Enter");
    await settled(owner);
  }
  expect((await starts()).map(point => [Math.round(point.x), Math.round(point.y)])).toEqual([[20, 85], [20, 90]]);

  // Redigera: en ruta dragen över båda markerar dem.
  await owner.keyboard.press("q");
  await owner.keyboard.press("Escape");
  await drag({ x: 12, y: 82 }, { x: 88, y: 93 });
  // Rutan tar också det i kartfilen som går genom den, så antalet läses ur tipset.
  await expect(owner.getByTestId("map-project-hint")).toContainText(/^[2-9] objekt markerade/);
  const count = Number((await owner.getByTestId("map-project-hint").textContent())!.split(" ")[0]);
  if (process.env.E2E_SCREENSHOT_DIR) await owner.screenshot({ path: `${process.env.E2E_SCREENSHOT_DIR}/kartprojekt-markera-flera.png` });
  await expect(owner.getByTestId("map-project-multi-remove")).toHaveText(`Ta bort ${count} objekt`);

  // Ett drag inne i markeringen flyttar båda 5 mm åt höger, och det är ett steg att ångra.
  await drag({ x: 50, y: 87.5 }, { x: 55, y: 87.5 });
  await settled(owner);
  expect((await starts()).map(point => [Math.round(point.x), Math.round(point.y)])).toEqual([[25, 85], [25, 90]]);
  await owner.keyboard.press("z");
  await settled(owner);
  expect((await starts()).map(point => [Math.round(point.x), Math.round(point.y)])).toEqual([[20, 85], [20, 90]]);
  await owner.keyboard.press("Shift+z");
  await settled(owner);
  expect((await starts()).map(point => Math.round(point.x))).toEqual([25, 25]);

  // Strax utanför ett hörn vrider man: markeringen vrids moturs runt sin mitt.
  await drag({ x: 87.5, y: 92.5 }, { x: 85, y: 97.5 });
  await settled(owner);
  const turned = await starts();
  // Den nedre linjens början (25; 85) ligger till vänster om mitten och går därför nedåt när allt vrids moturs.
  expect(turned[0]!.y).toBeLessThan(84);

  // Skift+klick tar ett objekt ur markeringen; Delete tar bort det som är kvar, och Ångra hämtar det.
  await owner.keyboard.press("z");
  await settled(owner);
  const upper = await screenOf(owner, { x: 55, y: 90 });
  await owner.keyboard.down("Shift");
  await owner.mouse.click(upper.x, upper.y);
  await owner.keyboard.up("Shift");
  await expect(owner.getByTestId("map-project-hint")).toContainText(`${count - 1} objekt markerade`);
  await owner.keyboard.press("Delete");
  await settled(owner);
  expect((await starts()).map(point => Math.round(point.y))).toEqual([90]);
  await owner.keyboard.press("z");
  await settled(owner);
  expect(await starts()).toHaveLength(2);

  // Mellanslag nedtryckt: draget flyttar kartan i stället för att rita en ruta.
  const before = await screenOf(owner, { x: 50, y: 50 });
  await owner.keyboard.down("Space");
  await drag({ x: 50, y: 60 }, { x: 60, y: 60 });
  await owner.keyboard.up("Space");
  const after = await screenOf(owner, { x: 50, y: 50 });
  expect(after.x - before.x).toBeGreaterThan(20);
  await expect(owner.getByTestId("map-project-wheel")).toHaveCount(0);
});

/**
 * Ägaren 2026-11-10: en förklaring när musen hålls över ett verktyg, en symbol i spalten för varje snabbkommando, slå ihop linjer
 * och byta symbol på flera. Två stigar som möts markeras med Skift+klick och slås ihop (F eller knappen); sedan ritas en till,
 * båda markeras och får en annan linjesymbol (C). Varje steg ångras som ett.
 */
test("kartprojekt: förklaringar i verktygsspalten, slå ihop linjer och byt symbol på flera", async ({ browser, baseURL }) => {
  test.setTimeout(300_000);
  const owner = await registerAccount(browser, `foga.${unique()}@exempel.se`, "Folke Foga");
  await warmRoute(owner, "/api/organizer/map-projects/upload", "POST");
  const created = await owner.request.post("/api/organizer/map-projects/upload", { headers: { origin: baseURL!, "x-otid-csrf": await csrfOf(owner),
    "content-type": "application/octet-stream", "x-otid-request-id": crypto.randomUUID(), "x-otid-name": "Foga", "x-otid-file-name": "Foga.omap" },
    data: Buffer.from(mapBytes) });
  expect(created.status()).toBe(201);
  const projectId = (await created.json() as { projectId: string }).projectId;
  await owner.setViewportSize({ width: 1280, height: 900 });
  await owner.goto(`/organizer/map-projects/${projectId}/map`);
  const map = owner.getByTestId("course-setting-map");
  await expect(map).toHaveAttribute("data-drawn", "true", { timeout: 60_000 });
  const own = async () => (await serverObjects(owner, projectId, baseURL!))
    .flatMap(object => object.key.startsWith("n:") && object.state.kind === "OBJECT" && object.state.object?.kind === "line" ? [object.state.object] : []);
  const draw = async (points: { x: number; y: number }[]) => {
    for (const point of points) { const at = await screenOf(owner, point); await owner.mouse.click(at.x, at.y); await owner.waitForTimeout(400); }
    await owner.keyboard.press("Enter");
    await settled(owner);
  };
  const shiftClick = async (point: { x: number; y: number }) => {
    const at = await screenOf(owner, point);
    await owner.keyboard.down("Shift");
    await owner.mouse.click(at.x, at.y);
    await owner.keyboard.up("Shift");
    await owner.waitForTimeout(300);
  };

  // Förklaringen: namnet, tangenten och vad verktyget gör; det som inte går just nu säger varför.
  await owner.getByRole("button", { name: "Lägg till punkt", exact: true }).hover();
  await expect(owner.getByTestId("map-project-rail-tip")).toContainText("Lägg till punktAKlicka på en linje eller en ytas kant för en ny punkt där.");
  await owner.getByTestId("map-project-rail-join").hover();
  await expect(owner.getByTestId("map-project-rail-tip")).toContainText("Slå ihop linjer");
  await expect(owner.getByTestId("map-project-rail-tip")).toContainText("Markera två eller fler linjer eller ytor med samma symbol");
  await expect(owner.getByTestId("map-project-rail-join")).toHaveAttribute("aria-disabled", "true");
  await owner.mouse.move(600, 400);
  await expect(owner.getByTestId("map-project-rail-tip")).toHaveCount(0);

  // Två stigar som möts i (50; 88), den andra ritad åt andra hållet.
  await owner.getByTestId("map-project-symbols").locator("[data-code='505.0']").click();
  await draw([{ x: 20, y: 88 }, { x: 50, y: 88 }]);
  await draw([{ x: 80, y: 88 }, { x: 50, y: 88 }]);
  expect(await own()).toHaveLength(2);
  await owner.keyboard.press("q");
  await owner.keyboard.press("Escape");
  const first = await screenOf(owner, { x: 30, y: 88 });
  await owner.mouse.click(first.x, first.y);
  await owner.waitForTimeout(400);
  await shiftClick({ x: 70, y: 88 });
  await expect(owner.getByTestId("map-project-hint")).toContainText("2 objekt markerade");
  await expect(owner.getByTestId("map-project-rail-join")).not.toHaveAttribute("aria-disabled", "true");
  await owner.keyboard.press("f");
  await expect(owner.getByTestId("map-project-hint")).toHaveText("2 objekt blev ett.");
  await settled(owner);
  const joined = await own();
  expect(joined).toHaveLength(1);
  expect(joined[0]!.kind === "line" && joined[0]!.path.map(command => Math.round(command.x))).toEqual([20, 50, 80]);
  // Ett steg att ångra, och knappen i spalten gör samma sak som tangenten.
  await owner.keyboard.press("z");
  await settled(owner);
  expect(await own()).toHaveLength(2);
  await owner.keyboard.press("Escape");
  await owner.mouse.click(first.x, first.y);
  await owner.waitForTimeout(400);
  await shiftClick({ x: 70, y: 88 });
  await owner.getByTestId("map-project-rail-join").click();
  await settled(owner);
  expect(await own()).toHaveLength(1);

  // En stig till; båda markeras och får en annan linjesymbol.
  await owner.keyboard.press("w");
  await draw([{ x: 20, y: 93 }, { x: 80, y: 93 }]);
  const before = (await own()).map(object => object.symbol);
  expect(new Set(before).size).toBe(1);
  await owner.keyboard.press("q");
  await owner.keyboard.press("Escape");
  await owner.mouse.click(first.x, first.y);
  await owner.waitForTimeout(400);
  await shiftClick({ x: 50, y: 93 });
  await expect(owner.getByTestId("map-project-hint")).toContainText("2 objekt markerade");
  await expect(owner.getByTestId("map-project-rail-switch")).toHaveAttribute("aria-disabled", "true");
  await owner.getByTestId("map-project-symbols").locator("[data-kind='line']:not([data-code='505.0'])").first().click();
  await expect(owner.getByTestId("map-project-multi-switch")).toHaveText(/^Byt 2 till /);
  if (process.env.E2E_SCREENSHOT_DIR) {
    await owner.getByTestId("map-project-rail-switch").hover();
    await owner.screenshot({ path: `${process.env.E2E_SCREENSHOT_DIR}/kartprojekt-verktygsspalt.png` });
  }
  await owner.keyboard.press("c");
  await expect(owner.getByTestId("map-project-hint")).toHaveText(/^2 objekt fick symbolen /);
  await settled(owner);
  const after = (await own()).map(object => object.symbol);
  expect(new Set(after).size).toBe(1);
  expect(after[0]).not.toBe(before[0]);
  await owner.keyboard.press("z");
  await settled(owner);
  expect((await own()).map(object => object.symbol)).toEqual(before);

  // Saxen (X): den hopslagna stigen delas vid x = 40. Vänd (V): den markerade delen byter riktning. Pipetten (D) tar symbolen.
  await owner.keyboard.press("Escape");
  await owner.keyboard.press("x");
  await expect(owner.getByTestId("map-project-cut")).toHaveAttribute("aria-pressed", "true");
  const cutAt = await screenOf(owner, { x: 40, y: 88 });
  await owner.mouse.click(cutAt.x, cutAt.y);
  await expect(owner.getByTestId("map-project-hint")).toHaveText("Linjen är delad i två.");
  await settled(owner);
  const ends = async () => (await own()).map(object => object.kind === "line" ? [Math.round(object.path[0]!.x), Math.round(object.path.at(-1)!.x)] : [])
    .sort((a, b) => a[0]! - b[0]! || a[1]! - b[1]!);
  expect(await ends()).toEqual([[20, 40], [20, 80], [40, 80]]);
  await owner.keyboard.press("q");
  await owner.mouse.click(first.x, first.y);
  await owner.waitForTimeout(400);
  await owner.keyboard.press("v");
  await expect(owner.getByTestId("map-project-hint")).toHaveText("Linjen är vänd.");
  await settled(owner);
  expect(await ends()).toEqual([[20, 80], [40, 20], [40, 80]]);
  await expect(owner.getByTestId("map-project-rail-pick")).not.toHaveAttribute("aria-disabled", "true");
  await owner.keyboard.press("d");
  await expect(owner.getByTestId("map-project-hint")).toHaveText(/^Vald symbol: 505/);
  await expect(owner.getByTestId("map-project-rail-pick")).toHaveAttribute("aria-disabled", "true");

  // Duplicera (Skift+D): en kopia av den markerade linjen. Rektangeln (Skift+W): tre klick ger en sluten linje med räta vinklar.
  const count = (await own()).length;
  await owner.keyboard.press("Shift+D");
  await expect(owner.getByTestId("map-project-hint")).toHaveText("Kopian ligger snett nedanför.");
  await settled(owner);
  expect((await own()).length).toBe(count + 1);
  await owner.keyboard.press("Escape");
  await owner.keyboard.press("Shift+W");
  await expect(owner.getByTestId("map-project-rectangle-tool")).toHaveAttribute("aria-pressed", "true");
  for (const corner of [{ x: 100, y: 40 }, { x: 120, y: 40 }, { x: 115, y: 55 }]) {
    const at = await screenOf(owner, corner);
    await owner.mouse.click(at.x, at.y);
  }
  await settled(owner);
  const box = (await own()).find(object => object.kind === "line" && object.path.length === 5 && Math.round(object.path[0]!.x) === 100);
  expect(box?.kind === "line" ? box.path.map(point => [Math.round(point.x), Math.round(point.y)]) : []).toEqual([[100, 40], [120, 40], [120, 55], [100, 55], [100, 40]]);
  // Det markerade mäts under kartan; Skift+V ger en parallell linje och Skift+F fyller den slutna linjen när en ytsymbol är vald (här
  // finns ingen, så beskedet säger vad som behövs).
  await owner.keyboard.press("q");
  const edge = await screenOf(owner, { x: 110, y: 40 });
  await owner.mouse.click(edge.x, edge.y);
  await expect(owner.getByTestId("map-project-hint")).toContainText(" m · ");
  const lines = (await own()).length;
  await owner.keyboard.press("Shift+V");
  await expect(owner.getByTestId("map-project-hint")).toHaveText("Den parallella linjen ligger en millimeter till höger.");
  await settled(owner);
  expect((await own()).length).toBe(lines + 1);
  await owner.keyboard.press("Shift+F");
  await expect(owner.getByTestId("map-project-hint")).toHaveText("Markera en sluten linje och välj en ytsymbol, eller markera en yta och välj en linjesymbol.");
});

/**
 * Ägaren 2026-11-10 («ställa in färger i kartan … färgtabell»): kartans färgtabell under Lager. En färgs CMYK ändras, kartan
 * ritas om, ändringen sparas i projektet och finns kvar efter omladdning; Återställ ger filens färger igen.
 */
test("kartprojekt: kartans färgtabell, ändra en färg, spara och återställ", async ({ browser, baseURL }) => {
  test.setTimeout(240_000);
  const owner = await registerAccount(browser, `farg.${unique()}@exempel.se`, "Frida Färg");
  await warmRoute(owner, "/api/organizer/map-projects/upload", "POST");
  const created = await owner.request.post("/api/organizer/map-projects/upload", { headers: { origin: baseURL!, "x-otid-csrf": await csrfOf(owner),
    "content-type": "application/octet-stream", "x-otid-request-id": crypto.randomUUID(), "x-otid-name": "Färger", "x-otid-file-name": "Farger.omap" },
    data: Buffer.from(mapBytes) });
  expect(created.status()).toBe(201);
  const projectId = (await created.json() as { projectId: string }).projectId;
  await owner.setViewportSize({ width: 1280, height: 900 });
  await owner.goto(`/organizer/map-projects/${projectId}/map`);
  const map = owner.getByTestId("course-setting-map");
  await expect(map).toHaveAttribute("data-drawn", "true", { timeout: 60_000 });
  const saved = async () => (await (await owner.request.get(`/api/organizer/map-projects/${projectId}`)).json() as { colors: { id: number; cmyk: { c: number } }[] }).colors;

  await owner.getByTestId("map-project-tab-layers").click();
  await expect(owner.getByTestId("map-project-colors-summary")).toHaveText("Filens egna färger");
  await owner.getByTestId("map-project-colors-open").click();
  const dialog = owner.getByTestId("map-project-colors");
  const row = dialog.getByTestId("map-project-color").first();
  const name = (await row.locator("th").textContent())!.trim();
  const cyan = row.getByLabel(`${name}, C i procent`);
  const before = await cyan.inputValue();
  await expect(dialog.getByTestId("map-project-colors-save")).toBeDisabled();
  await cyan.fill(before === "12,5" ? "40" : "12,5");
  await expect(row.getByTestId("map-project-color-new")).toBeVisible();
  await expect(row).toContainText("Ändrad");
  if (process.env.E2E_SCREENSHOT_DIR) await owner.screenshot({ path: `${process.env.E2E_SCREENSHOT_DIR}/kartprojekt-farger.png` });
  await dialog.getByTestId("map-project-colors-save").click();
  await expect(dialog.getByTestId("map-project-colors-message")).toHaveText("1 färg är ändrad.");
  expect((await saved()).map(change => change.cmyk.c)).toEqual([before === "12,5" ? 0.4 : 0.125]);
  await dialog.getByRole("button", { name: "Stäng" }).click();
  await expect(owner.getByTestId("map-project-colors-summary")).toHaveText("1 ändrad färg");

  // Kvar efter omladdning; ett ogiltigt värde ändrar ingenting; Återställ och Spara ger filens färger.
  await owner.reload();
  await expect(map).toHaveAttribute("data-drawn", "true", { timeout: 60_000 });
  await owner.getByTestId("map-project-tab-layers").click();
  await expect(owner.getByTestId("map-project-colors-summary")).toHaveText("1 ändrad färg");
  await owner.getByTestId("map-project-colors-open").click();
  await expect(row.getByLabel(`${name}, C i procent`)).toHaveValue(before === "12,5" ? "40" : "12,5");
  await row.getByLabel(`${name}, M i procent`).fill("250");
  await expect(dialog.getByTestId("map-project-colors-save")).toBeDisabled();
  await dialog.getByTestId("map-project-colors-reset").click();
  await expect(row.getByLabel(`${name}, C i procent`)).toHaveValue(before);
  await dialog.getByTestId("map-project-colors-save").click();
  await expect(dialog.getByTestId("map-project-colors-message")).toHaveText("Kartan har filens egna färger.");
  expect(await saved()).toEqual([]);
});

/**
 * ADR-0219 (K1): samarbetet i editorn. Ägaren ritar ett delområde med verktyget Delområde; en medlem med rollen Föreslå tar bort
 * stenen, vilket blir ett förslag (kartan på servern är oförändrad); ägaren ser förslaget, visar det och godkänner det, och byter
 * sedan arbetssätt till Huvudkartritare.
 */
test("kartprojekt: delområde, förslag från Föreslå och godkännande", async ({ browser, baseURL }) => {
  test.setTimeout(300_000);
  const suffix = unique();
  const owner = await registerAccount(browser, `agare.${suffix}@exempel.se`, "Åsa Ägare");
  await warmRoute(owner, "/api/organizer/map-projects/upload", "POST");
  const headers = async (page: Page) => ({ origin: baseURL!, "x-otid-csrf": await csrfOf(page), "content-type": "application/json" });
  const created = await owner.request.post("/api/organizer/map-projects/upload", { headers: { origin: baseURL!, "x-otid-csrf": await csrfOf(owner),
    "content-type": "application/octet-stream", "x-otid-request-id": crypto.randomUUID(), "x-otid-name": "Samarbete", "x-otid-file-name": "Samarbete.omap" },
    data: Buffer.from(mapBytes) });
  expect(created.status(), await created.text()).toBe(201);
  const projectId = (await created.json() as { projectId: string }).projectId;
  const api = `/api/organizer/map-projects/${projectId}`;
  const suggesterEmail = `foreslar.${suffix}@exempel.se`;
  const invited = await owner.request.post(`${api}/members`, { headers: await headers(owner),
    data: { formatVersion: 1, requestId: crypto.randomUUID(), email: suggesterEmail, role: "SUGGEST" } });
  expect(invited.status(), await invited.text()).toBeLessThan(300);
  const suggester = await registerAccount(browser, suggesterEmail, "Fia Föreslår");
  await suggester.goto(`/organizer/map-projects/${projectId}`);
  await expect(suggester.getByTestId("map-project-members")).toContainText("Fia Föreslår (du)");

  // Ägaren ritar delområdet Norr (fyra klick och Enter) och sparar det utan kartritare.
  await owner.setViewportSize({ width: 1280, height: 900 });
  await owner.goto(`/organizer/map-projects/${projectId}/map`);
  const map = owner.getByTestId("course-setting-map");
  await expect(map).toHaveAttribute("data-drawn", "true", { timeout: 60_000 });
  await owner.getByRole("button", { name: "Delområde", exact: true }).click();
  for (const point of [{ x: 5, y: 60 }, { x: 60, y: 60 }, { x: 60, y: 95 }, { x: 5, y: 95 }]) {
    const at = await screenOf(owner, point);
    await owner.mouse.click(at.x, at.y);
    await owner.waitForTimeout(400);
  }
  await owner.keyboard.press("Enter");
  const areas = owner.getByTestId("map-project-areas");
  await owner.getByTestId("map-project-tab-review").click();
  await areas.getByLabel("Namn").fill("Norr");
  await areas.getByRole("button", { name: "Spara delområdet" }).click();
  await expect(areas.getByRole("button", { name: "Norr" })).toBeVisible();
  const areaList = await (await owner.request.get(`${api}/areas`)).json() as { areas: { name: string; polygon: unknown[][] }[] };
  expect(areaList.areas).toMatchObject([{ name: "Norr" }]);
  expect(areaList.areas[0]!.polygon[0]).toHaveLength(4);

  // Föreslå: tar bort stenen; det blir ett förslag och kartan på servern är oförändrad.
  await suggester.setViewportSize({ width: 1280, height: 900 });
  await suggester.goto(`/organizer/map-projects/${projectId}/map`);
  const suggesterMap = suggester.getByTestId("course-setting-map");
  await expect(suggesterMap).toHaveAttribute("data-drawn", "true", { timeout: 60_000 });
  await suggester.getByTestId("map-project-tab-review").click();
  await expect(suggester.getByText("Du har rollen Föreslå")).toBeVisible();
  const stone = parsed.objects.find(object => object.kind === "point")!;
  if (stone.kind !== "point") throw new Error("ingen sten");
  const at = await screenOf(suggester, stone.at);
  await suggester.mouse.click(at.x, at.y);
  await expect(suggester.getByTestId("map-project-hint")).toContainText("206");
  await suggester.keyboard.press("Delete");
  await settled(suggester);
  await expect(suggester.getByRole("status").filter({ hasText: "Ändringen blev ett förslag" })).toBeVisible();
  expect((await serverObjects(owner, projectId, baseURL!)).filter(object => object.state.kind === "DELETED")).toHaveLength(0);
  await expect(suggester.getByTestId("map-project-proposals")).toContainText("Fia Föreslår · 1 ändring");
  await reviewScreenshots(suggester, "kartprojekt-forslag");

  // Ägaren: förslaget i listan, Visa och Godkänn; stenen är borttagen på servern.
  await owner.reload();
  await expect(map).toHaveAttribute("data-drawn", "true", { timeout: 60_000 });
  const proposals = owner.getByTestId("map-project-proposals");
  await expect(proposals).toContainText("Förslag (1 öppet)");
  await owner.getByTestId("map-project-tab-review").click();
  await proposals.getByRole("button", { name: "Visa", exact: true }).click();
  await expect(proposals.getByRole("button", { name: "Visa", exact: true })).toHaveAttribute("aria-pressed", "true");
  if (process.env.E2E_SCREENSHOT_DIR) await owner.screenshot({ path: `${process.env.E2E_SCREENSHOT_DIR}/kartprojekt-forslag-agare.png` });
  await proposals.getByRole("button", { name: "Godkänn" }).click();
  await expect(proposals).toContainText("Godkänt");
  await expect(proposals).toContainText("Inga förslag.");
  expect((await serverObjects(owner, projectId, baseURL!)).filter(object => object.state.kind === "DELETED")).toHaveLength(1);

  // Arbetssättet: Huvudkartritare.
  await owner.getByRole("button", { name: "Huvudkartritare" }).click();
  await expect(owner.getByRole("button", { name: "Huvudkartritare" })).toHaveAttribute("aria-pressed", "true");
  const project = await (await owner.request.get(api)).json() as { mode: string };
  expect(project.mode).toBe("LEAD");
});

/**
 * ADR-0219 (K1): ny karta. Ett konto skapar en skogskarta 1:10 000 över en polygon (GeoJSON, ungefär Kungshatt) och hamnar
 * i editorn: kartan är tom, symbolsetet finns i paletten, området syns och en sten och en stig går att rita.
 */
test("kartprojekt: ny karta från en polygon, rita i den tomma kartan", async ({ browser, baseURL }) => {
  test.setTimeout(300_000);
  const owner = await registerAccount(browser, `nykarta.${unique()}@exempel.se`, "Nils Nykarta");
  await warmRoute(owner, "/api/organizer/map-projects/new", "POST");
  await owner.setViewportSize({ width: 1280, height: 900 });
  await owner.goto("/organizer/map-projects");
  const form = owner.getByRole("form", { name: "Ny karta" });
  await form.getByLabel("Kartans namn").fill("Kungshatt");
  await form.getByLabel("Skala").selectOption("10000");
  const island = { type: "Feature", properties: {}, geometry: { type: "Polygon", coordinates: [[[17.776, 59.303], [17.79, 59.301], [17.804, 59.304],
    [17.806, 59.311], [17.792, 59.314], [17.778, 59.31], [17.776, 59.303]]] } };
  // Ägaren 2026-11-10: området kan ritas på OpenStreetMaps karta (förvalet); rutorna hämtas utifrån men behövs inte här.
  const picker = form.getByTestId("area-map-picker");
  await picker.getByRole("button", { name: "Rita själv" }).click();
  const canvas = picker.getByRole("application", { name: "Karta för att välja området" });
  for (const [x, y] of [[200, 150], [320, 160], [260, 260]] as const) await canvas.click({ position: { x, y } });
  await picker.getByRole("button", { name: "Klar" }).click();
  await expect(form.getByTestId("new-map-area")).toHaveText("3 punkter");
  await form.getByLabel("Polygon som fil").check();
  await form.getByLabel("GeoJSON-fil").setInputFiles({ name: "kungshatt.geojson", mimeType: "application/geo+json",
    buffer: Buffer.from(JSON.stringify(island)) });
  await expect(form.getByTestId("new-map-area")).toHaveText("6 punkter");
  // ADR-0223: förslaget enligt World Magnetic Model för områdets mitt (ungefär 7,5° vid Kungshatt 2026).
  await expect(form.getByText(/World Magnetic Model för områdets mitt: [78],\d°/)).toBeVisible();
  await form.getByLabel("Missvisning (grader, östlig positiv)").fill("6,5");
  if (process.env.E2E_SCREENSHOT_DIR) await owner.screenshot({ path: `${process.env.E2E_SCREENSHOT_DIR}/kartprojekt-ny-karta-formular.png`, fullPage: true });
  await form.getByRole("button", { name: "Skapa kartan" }).click();
  await owner.waitForURL(/\/organizer\/map-projects\/[0-9a-f-]+\/map$/);
  const projectId = /map-projects\/([0-9a-f-]+)\/map$/.exec(owner.url())![1]!;
  const map = owner.getByTestId("course-setting-map");
  await expect(map).toHaveAttribute("data-drawn", "true", { timeout: 60_000 });
  // Området (ca 1,7 × 1,4 km vid 1:10 000 ≈ 170 × 140 mm) fyller vyn.
  expect(Number(await map.getAttribute("data-px-per-mm"))).toBeGreaterThan(3);
  const palette = owner.getByTestId("map-project-symbols");
  for (const code of ["101", "204", "301", "406", "505", "521"]) await expect(palette.locator(`[data-code='${code}']`)).toBeVisible();

  await palette.locator("[data-code='204']").click();
  const stoneAt = await screenOf(owner, { x: 10, y: 5 });
  await owner.mouse.click(stoneAt.x, stoneAt.y);
  await palette.locator("[data-code='505']").click();
  for (const point of [{ x: -40, y: -20 }, { x: 0, y: 0 }, { x: 40, y: 25 }]) {
    const at = await screenOf(owner, point);
    await owner.mouse.click(at.x, at.y);
    await owner.waitForTimeout(400);
  }
  await owner.keyboard.press("Enter");
  await settled(owner);
  const objects = await serverObjects(owner, projectId, baseURL!);
  expect(objects.map(object => object.state.object?.kind).sort()).toEqual(["line", "point"]);
  await reviewScreenshots(owner, "kartprojekt-ny-karta");
  // ADR-0223: kartans nordlinjer (6,5°) mot dagens missvisning.
  const north = owner.getByTestId("map-project-north");
  await owner.getByTestId("map-project-tab-layers").click();
  await north.locator("summary").click();
  await expect(north).toContainText("ritade för missvisningen 6,5°");
  await expect(north).toContainText(/Skillnad [01],\d° åt öster/);
  await owner.goto(`/organizer/map-projects/${projectId}`);
  await expect(owner.getByText("ny karta från O-Tid")).toBeVisible();
});

/**
 * Ägaren 2026-11-09: snabbare verktyg. Symbolerna som rutor, verktygshjulet med högerklick och mellanslag, förenkla en linje
 * med för många punkter, gör den mjuk, och rita en cirkel.
 */
test("kartprojekt: verktygshjul, symbolrutor, förenkla, mjuk och cirkel", async ({ browser, baseURL }) => {
  test.setTimeout(240_000);
  const owner = await registerAccount(browser, `hjul.${unique()}@exempel.se`, "Hjul Ritare");
  await warmRoute(owner, "/api/organizer/map-projects/upload", "POST");
  const created = await owner.request.post("/api/organizer/map-projects/upload", { headers: { origin: baseURL!, "x-otid-csrf": await csrfOf(owner),
    "content-type": "application/octet-stream", "x-otid-request-id": crypto.randomUUID(), "x-otid-name": "Hjul", "x-otid-file-name": "Hjul.omap" },
    data: Buffer.from(mapBytes) });
  expect(created.status()).toBe(201);
  const projectId = (await created.json() as { projectId: string }).projectId;
  await owner.setViewportSize({ width: 1280, height: 900 });
  await owner.goto(`/organizer/map-projects/${projectId}/map`);
  const map = owner.getByTestId("course-setting-map");
  await expect(map).toHaveAttribute("data-drawn", "true", { timeout: 60_000 });
  const lines = async () => (await serverObjects(owner, projectId, baseURL!))
    .filter(object => object.key.startsWith("n:") && object.state.kind === "OBJECT" && object.state.object?.kind === "line")
    .map(object => object.state.object as Extract<MapObject, { kind: "line" }>);

  // Symbolerna som rutor (valet sparas).
  await owner.getByTestId("map-project-symbols-grid").click();
  await expect(owner.getByTestId("map-project-symbols")).toHaveAttribute("data-view", "grid");
  await owner.getByTestId("map-project-symbols").locator("[data-code='505.0']").click();

  // En stig med åtta punkter nästan på en rak linje (y = 85, ovanför kartans objekt).
  for (let i = 0; i < 8; i += 1) {
    const at = await screenOf(owner, { x: 15 + i * 9, y: 85 + (i % 2) * 0.02 });
    await owner.mouse.click(at.x, at.y);
    await owner.waitForTimeout(350);
  }
  await owner.keyboard.press("Enter");
  await settled(owner);
  expect((await lines())[0]!.path).toHaveLength(8);

  // Högerklick på stigen: hjulet med objektets åtgärder. Förenkla ger två punkter, gör mjuk ger kurvor.
  await owner.keyboard.press("q");
  const on = await screenOf(owner, { x: 46.5, y: 85 });
  await owner.mouse.click(on.x, on.y, { button: "right" });
  const wheel = owner.getByTestId("map-project-wheel");
  await expect(wheel).toBeVisible();
  await expect(wheel.getByTestId("map-project-wheel-symbol")).toHaveAttribute("data-code", "505.0");
  await reviewScreenshots(owner, "kartprojekt-verktygshjul");
  await wheel.getByTestId("map-project-wheel-action-simplify").click();
  await expect(wheel).toBeHidden();
  await expect(owner.getByTestId("map-project-hint")).toHaveText("Förenklad: 8 → 2 punkter.");
  await settled(owner);
  expect((await lines())[0]!.path).toHaveLength(2);
  await owner.mouse.click(on.x, on.y, { button: "right" });
  await expect(owner.getByTestId("map-project-hint")).toContainText("505");
  await owner.getByTestId("map-project-wheel-action-smooth").click();
  await expect(owner.getByTestId("map-project-hint")).toHaveText("Linjen går nu i mjuka kurvor genom samma punkter.");
  await settled(owner);
  await expect.poll(async () => (await lines())[0]!.path.map(command => command.type), { timeout: 20_000 }).toEqual(["M", "C"]);

  // Mellanslag med musen över kartan: hjulet, välj Cirkel och dra en cirkel med radien 5 mm.
  const center = await screenOf(owner, { x: 60, y: 60 });
  await owner.mouse.move(center.x, center.y);
  await owner.keyboard.press(" ");
  await owner.getByTestId("map-project-wheel-circle").click();
  await expect(owner.getByTestId("map-project-hint")).toContainText("Cirkel med 505");
  const px = Number(await map.getAttribute("data-px-per-mm"));
  await owner.mouse.move(center.x, center.y);
  await owner.mouse.down();
  for (let step = 1; step <= 5; step += 1) await owner.mouse.move(center.x + step * px, center.y, { steps: 2 });
  await owner.mouse.up();
  await settled(owner);
  await expect.poll(async () => (await lines()).length, { timeout: 20_000 }).toBe(2);
  const circle = (await lines()).find(line => line.path.length === 5);
  expect(circle?.path.map(command => command.type)).toEqual(["M", "C", "C", "C", "C"]);
  expect(Math.abs(circle!.path[0]!.x - 65)).toBeLessThan(0.5);
});

/**
 * Ägaren 2026-11-09: lagren efter normen. Lås berg och stenar (stenen går inte att markera), visa dem nedtonade, lås upp, och
 * slå ihop en symbol med en annan med förhandsvisningen.
 */
test("kartprojekt: lager efter normen, lås, nedtonat och slå ihop symboler", async ({ browser, baseURL }) => {
  test.setTimeout(240_000);
  const owner = await registerAccount(browser, `lager.${unique()}@exempel.se`, "Lage Lager");
  await warmRoute(owner, "/api/organizer/map-projects/upload", "POST");
  const created = await owner.request.post("/api/organizer/map-projects/upload", { headers: { origin: baseURL!, "x-otid-csrf": await csrfOf(owner),
    "content-type": "application/octet-stream", "x-otid-request-id": crypto.randomUUID(), "x-otid-name": "Lager", "x-otid-file-name": "Lager.omap" },
    data: Buffer.from(mapBytes) });
  expect(created.status()).toBe(201);
  const projectId = (await created.json() as { projectId: string }).projectId;
  await owner.setViewportSize({ width: 1280, height: 900 });
  await owner.goto(`/organizer/map-projects/${projectId}/map`);
  const map = owner.getByTestId("course-setting-map");
  await expect(map).toHaveAttribute("data-drawn", "true", { timeout: 60_000 });

  const layers = owner.getByTestId("map-project-symbol-layers");
  await expect(layers).toContainText("Lagren följer ISOM 2017-2");
  await owner.getByTestId("map-project-tab-layers").click();
  await expect(layers.getByTestId("map-project-layer-row")).toHaveCount(5);
  const rock = layers.locator("[data-layer=ROCK]");
  await expect(rock).toContainText("Berg och stenar (2xx)");
  await expect(rock).toContainText("3 objekt");

  // Låst: stenen går inte att markera; nedtonat ritas om.
  await rock.getByTestId("map-project-layer-lock").last().click();
  await expect(rock.getByTestId("map-project-layer-lock").last()).toHaveAttribute("aria-pressed", "true");
  const stone = parsed.objects.find(object => object.kind === "point")!;
  if (stone.kind !== "point") throw new Error("ingen sten");
  const at = await screenOf(owner, stone.at);
  await owner.mouse.click(at.x, at.y);
  await owner.waitForTimeout(500);
  await expect(owner.getByTestId("map-project-hint")).not.toContainText("206");
  await rock.getByTestId("map-project-layer-dim").last().click();
  await expect(map).toHaveAttribute("data-drawn", "true", { timeout: 20_000 });
  // Valen finns kvar efter en omladdning.
  await owner.reload();
  await expect(map).toHaveAttribute("data-drawn", "true", { timeout: 60_000 });
  await owner.getByTestId("map-project-tab-layers").click();
  await expect(owner.getByTestId("map-project-symbol-layers").locator("[data-layer=ROCK]").getByTestId("map-project-layer-dim").last()).toHaveAttribute("aria-pressed", "true");
  await owner.getByTestId("map-project-symbol-layers").locator("[data-layer=ROCK]").getByTestId("map-project-layer-lock").last().click();
  await owner.mouse.click(at.x, at.y);
  await expect(owner.getByTestId("map-project-hint")).toContainText("206");

  // R3: tangenten 2 släcker berg och stenar, 0 tänder allt; en sparad vy tar tillbaka valen.
  const rockEye = owner.getByTestId("map-project-symbol-layers").locator("[data-layer=ROCK]").getByTestId("map-project-layer-visible").last();
  await owner.mouse.click(10, 10);
  await owner.keyboard.press("Escape");
  await owner.keyboard.press("2");
  await expect(rockEye).toHaveAttribute("aria-pressed", "false");
  const views = owner.getByTestId("map-project-layer-views");
  await views.locator("summary").click();
  await views.getByTestId("map-project-layer-view-name").fill("Utan berg");
  await views.getByTestId("map-project-layer-view-save").click();
  await owner.keyboard.press("0");
  await expect(rockEye).toHaveAttribute("aria-pressed", "true");
  await views.getByTestId("map-project-layer-view").filter({ hasText: "Utan berg" }).getByRole("button", { name: "Använd" }).click();
  await expect(rockEye).toHaveAttribute("aria-pressed", "false");
  await rockEye.click();

  // Slå ihop: stigen får höjdkurvans symbol (båda finns i normen: varningen syns).
  const merge = owner.getByTestId("map-project-merge");
  await merge.locator("summary").click();
  await merge.getByTestId("map-project-merge-from").selectOption({ label: "505.0 Stig (1)" });
  await merge.getByTestId("map-project-merge-to").selectOption({ label: "101.0 Höjdkurva" });
  await expect(merge.getByTestId("map-project-merge-preview")).toContainText("1 objekt med 505.0 Stig får symbolen 101.0 Höjdkurva.");
  await expect(merge.getByTestId("map-project-merge-preview")).toContainText("båda finns i normen");
  await merge.getByTestId("map-project-merge-run").click();
  await expect(merge.getByTestId("map-project-merge-message")).toHaveText("1 objekt med 505.0 Stig har nu symbolen 101.0 Höjdkurva.");
  await settled(owner);
  const lines = (await serverObjects(owner, projectId, baseURL!)).filter(object => object.state.object?.kind === "line");
  const contour = parsed.objects.find(object => object.kind === "line" && parsed.symbols.get(object.symbol)?.code.main === 101)!;
  expect(lines.map(object => object.state.object!.symbol)).toEqual([contour.symbol]);
});

/**
 * Ägaren 2026-11-09, lagren fas 2: ett arbetslager med stenarna (206) släcks och stenen går inte att markera; ett skisslager
 * får en linje på fri hand och en text, som sparas för projektet och finns kvar efter en omladdning.
 */
test("kartprojekt: arbetslager och skisslager", async ({ browser, baseURL }) => {
  test.setTimeout(240_000);
  const owner = await registerAccount(browser, `skiss.${unique()}@exempel.se`, "Sigge Skiss");
  await warmRoute(owner, "/api/organizer/map-projects/upload", "POST");
  const created = await owner.request.post("/api/organizer/map-projects/upload", { headers: { origin: baseURL!, "x-otid-csrf": await csrfOf(owner),
    "content-type": "application/octet-stream", "x-otid-request-id": crypto.randomUUID(), "x-otid-name": "Skiss", "x-otid-file-name": "Skiss.omap" },
    data: Buffer.from(mapBytes) });
  expect(created.status()).toBe(201);
  const projectId = (await created.json() as { projectId: string }).projectId;
  await warmRoute(owner, `/api/organizer/map-projects/${projectId}/work-layers`);
  await owner.setViewportSize({ width: 1280, height: 900 });
  await owner.goto(`/organizer/map-projects/${projectId}/map`);
  const map = owner.getByTestId("course-setting-map");
  await expect(map).toHaveAttribute("data-drawn", "true", { timeout: 60_000 });
  const panel = owner.getByTestId("map-project-work-layers");

  // Arbetslager: stenarna i en egen grupp, släckt.
  await owner.getByTestId("map-project-tab-layers").click();
  const fresh = panel.getByTestId("map-project-work-new");
  await fresh.locator("summary").click();
  await fresh.getByTestId("map-project-work-name").fill("Stenar");
  await fresh.locator("label", { hasText: /^206 / }).locator("input").check();
  await fresh.getByTestId("map-project-work-create").click();
  const row = panel.getByTestId("map-project-work-layer");
  await expect(row).toHaveAttribute("data-name", "Stenar", { timeout: 15_000 });
  await expect(row).toContainText("1 symbol");
  await row.getByTestId("map-project-layer-visible").click();
  const stone = parsed.objects.find(object => object.kind === "point")!;
  if (stone.kind !== "point") throw new Error("ingen sten");
  const at = await screenOf(owner, stone.at);
  await owner.mouse.click(at.x, at.y);
  await owner.waitForTimeout(500);
  await expect(owner.getByTestId("map-project-hint")).not.toContainText("206");
  await row.getByTestId("map-project-layer-visible").click();

  // Skisslager: en linje på fri hand och en text.
  const sketchNew = panel.getByTestId("map-project-sketch-new");
  await sketchNew.locator("summary").click();
  await sketchNew.getByTestId("map-project-sketch-name").fill("Fält");
  await sketchNew.getByTestId("map-project-sketch-create").click();
  await expect(owner.getByTestId("map-project-hint")).toContainText("Skissa i Fält", { timeout: 15_000 });
  const start = await screenOf(owner, { x: 20, y: 20 }), end = await screenOf(owner, { x: 40, y: 30 });
  await owner.mouse.move(start.x, start.y);
  await owner.mouse.down();
  for (let step = 1; step <= 10; step++) await owner.mouse.move(start.x + (end.x - start.x) * step / 10, start.y + (end.y - start.y) * step / 10 + (step % 2) * 3);
  await owner.mouse.up();
  await owner.getByTestId("map-project-sketch-text").fill("Ny stig?");
  const textAt = await screenOf(owner, { x: 50, y: 50 });
  await owner.mouse.click(textAt.x, textAt.y);
  type Listed = { layers: { kind: string; name: string }[]; sketches: { kind: string; text: string | null; points: number[][] }[] };
  await expect.poll(async () => ((await (await owner.request.get(`/api/organizer/map-projects/${projectId}/work-layers`)).json()) as Listed).sketches
    .map(sketch => sketch.kind).sort(), { timeout: 15_000 }).toEqual(["LINE", "TEXT"]);
  const listed = (await (await owner.request.get(`/api/organizer/map-projects/${projectId}/work-layers`)).json()) as Listed;
  expect(listed.sketches.find(sketch => sketch.kind === "TEXT")?.text).toBe("Ny stig?");
  expect(listed.sketches.find(sketch => sketch.kind === "LINE")!.points.length).toBeGreaterThanOrEqual(2);
  await owner.getByTestId("map-project-sketch-done").click();
  await reviewScreenshots(owner, "kartprojekt-skisslager");
  await owner.reload();
  await expect(map).toHaveAttribute("data-drawn", "true", { timeout: 60_000 });
  await owner.getByTestId("map-project-tab-layers").click();
  await expect(owner.getByTestId("map-project-sketch-layer")).toContainText("2 skisser", { timeout: 15_000 });

  // Ägaren 2026-11-10: en mapp med äldre underlag. GeoJSON:en blir ett skisslager; pdf:en och kartfilen laddas inte upp.
  const wgs = (x: number, y: number) => { const p = mapPointToWgs84(parsed.georeference!, { x, y }); return [p.longitude, p.latitude]; };
  const old = { type: "FeatureCollection", features: [{ type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: [wgs(10, 10), wgs(30, 20)] } },
    { type: "Feature", properties: {}, geometry: { type: "Point", coordinates: wgs(25, 25) } }] };
  const intake = owner.getByTestId("map-project-intake");
  await intake.locator("summary").click();
  await intake.getByTestId("map-project-intake-files").setInputFiles([
    { name: "gamla-stigar.geojson", mimeType: "application/geo+json", buffer: Buffer.from(JSON.stringify(old)) },
    { name: "banor.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4") },
    { name: "gammal.omap", mimeType: "application/octet-stream", buffer: Buffer.from(mapBytes) }]);
  await expect(intake.getByTestId("map-project-intake-summary")).toContainText("1 fil läses in, 2 slängs");
  await intake.getByTestId("map-project-intake-start").click();
  await expect(intake.getByTestId("map-project-intake-done")).toHaveText("Klart: 1 skisslager och 0 underlag.", { timeout: 30_000 });
  await expect(owner.getByTestId("map-project-sketch-layer").filter({ hasText: "gamla-stigar" })).toContainText("2 skisser", { timeout: 15_000 });
});
