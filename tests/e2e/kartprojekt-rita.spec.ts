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
  await owner.keyboard.press("e");
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
  await form.getByLabel("GeoJSON-fil").setInputFiles({ name: "kungshatt.geojson", mimeType: "application/geo+json",
    buffer: Buffer.from(JSON.stringify(island)) });
  await expect(form.getByTestId("new-map-area")).toHaveText("6 punkter");
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
  await owner.goto(`/organizer/map-projects/${projectId}`);
  await expect(owner.getByText("ny karta från O-Tid")).toBeVisible();
});
