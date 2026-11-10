import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { writeArrayBuffer } from "geotiff";
import { mapPointToProjected, projectedToMapPoint, readMapFile } from "../../packages/map-file/src";
import { registerAccount, reviewScreenshots, unique, warmRoute } from "./helpers";

/**
 * ADR-0219 tillägget om underlagen (K4a): ett eget underlag i kartprojektet. Ägaren lägger upp en PNG med världsfil (utan
 * svenskt API), ser den ritad på kartan där världsfilen säger, gör den mer genomskinlig (sparas för projektet), döljer den för sig
 * själv och tar bort den. Sedan en GeoTIFF utan världsfil: läget och koordinatsystemet läses ur filen i webbläsaren.
 */
const mapBytes = new Uint8Array(readFileSync(new URL("../../fixtures/maps/kartfil.omap", import.meta.url)));
const parsed = readMapFile(mapBytes, "Underlag.omap");
const georef = parsed.georeference!;
const png = readFileSync(new URL("../../fixtures/maps/strackanalys.png", import.meta.url));
const [width, height] = [png.readUInt32BE(16), png.readUInt32BE(20)];

async function csrfOf(page: Page): Promise<string> {
  return (await page.context().cookies()).find(row => /otid[-_]organizer[-_]csrf$/.test(row.name))?.value ?? "";
}

/** Täckningen (alfa 0–255) på kartans överlägg i en punkt i kartans mm. */
async function alphaAt(page: Page, point: { x: number; y: number }): Promise<number> {
  const map = page.getByTestId("course-setting-map");
  const [cx, cy] = (await map.getAttribute("data-center"))!.split(",").map(Number) as [number, number];
  const px = Number(await map.getAttribute("data-px-per-mm"));
  return page.getByTestId("course-setting-overprint").evaluate((canvas, { dx, dy }) => {
    const element = canvas as HTMLCanvasElement, rect = element.getBoundingClientRect();
    const scale = element.width / rect.width;
    const x = Math.round((rect.width / 2 + dx) * scale), y = Math.round((rect.height / 2 + dy) * scale);
    return element.getContext("2d")!.getImageData(x, y, 1, 1).data[3]!;
  }, { dx: (point.x - cx) * px, dy: -(point.y - cy) * px });
}

test("kartprojekt: eget underlag med världsfil", async ({ browser, baseURL }) => {
  test.setTimeout(240_000);
  expect(georef.crs.kind).toBe("EPSG");
  const owner = await registerAccount(browser, `underlag.${unique()}@exempel.se`, "Ulla Underlag");
  await warmRoute(owner, "/api/organizer/map-projects/upload", "POST");
  const created = await owner.request.post("/api/organizer/map-projects/upload", { headers: { origin: baseURL!, "x-otid-csrf": await csrfOf(owner),
    "content-type": "application/octet-stream", "x-otid-request-id": crypto.randomUUID(), "x-otid-name": "Underlag", "x-otid-file-name": "Underlag.omap" },
    data: Buffer.from(mapBytes) });
  expect(created.status(), await created.text()).toBe(201);
  const projectId = (await created.json() as { projectId: string }).projectId;
  const api = `/api/organizer/map-projects/${projectId}`;
  await warmRoute(owner, `${api}/layers`);

  // Världsfilen: bilden täcker kartans mm 30–70 (x) och 40–70 (y).
  const topLeft = mapPointToProjected(georef, { x: 30, y: 70 }), bottomRight = mapPointToProjected(georef, { x: 70, y: 40 });
  const a = (bottomRight.easting - topLeft.easting) / width, e = (bottomRight.northing - topLeft.northing) / height;
  const world = [a, 0, 0, e, topLeft.easting + a / 2, topLeft.northing + e / 2].join("\n");

  await owner.goto(`/organizer/map-projects/${projectId}/map`);
  const map = owner.getByTestId("course-setting-map");
  await expect(map).toHaveAttribute("data-drawn", "true", { timeout: 60_000 });
  expect(await alphaAt(owner, { x: 50, y: 55 })).toBe(0);

  // I datorn syns panelen bredvid kartan.
  const panel = owner.getByTestId("map-project-layers");
  await expect(panel).toContainText("Inga underlag ännu.");
  await owner.getByTestId("map-project-tab-layers").click();
  await panel.getByText("Lägg till", { exact: true }).first().click();
  await panel.getByTestId("map-project-layer-file").setInputFiles([
    { name: "flygfoto.png", mimeType: "image/png", buffer: png },
    { name: "flygfoto.pgw", mimeType: "text/plain", buffer: Buffer.from(world) }]);
  await expect(panel).toContainText("flygfoto.png, flygfoto.pgw");
  await panel.getByTestId("map-project-layer-upload").click();
  await expect(panel.getByTestId("map-project-layer")).toHaveCount(1, { timeout: 30_000 });
  await expect(panel.getByTestId("map-project-layer")).toContainText("flygfoto");

  // Ritad där världsfilen säger, inte utanför.
  await expect.poll(() => alphaAt(owner, { x: 50, y: 55 }), { timeout: 20_000 }).toBeGreaterThan(0);
  expect(await alphaAt(owner, { x: 80, y: 55 })).toBe(0);
  const full = await alphaAt(owner, { x: 50, y: 55 });

  // Genomskinligheten: lägre på kartan och sparad för projektet.
  const slider = panel.getByTestId("map-project-layer-opacity");
  await slider.focus();
  for (let i = 0; i < 6; i += 1) await slider.press("ArrowLeft");
  await expect.poll(() => alphaAt(owner, { x: 50, y: 55 }), { timeout: 10_000 }).toBeLessThan(full);
  await expect.poll(async () => (await (await owner.request.get(`${api}/layers`)).json() as { layers: { opacity: number }[] }).layers[0]!.opacity,
    { timeout: 10_000 }).toBeLessThan(0.5);
  await reviewScreenshots(owner, "kartprojekt-underlag");

  // Dölj för sig själv, sedan ta bort för alla.
  await panel.getByRole("checkbox", { name: "Visa flygfoto" }).uncheck();
  await expect.poll(() => alphaAt(owner, { x: 50, y: 55 }), { timeout: 10_000 }).toBe(0);
  owner.once("dialog", dialog => void dialog.accept());
  await panel.getByRole("button", { name: "Ta bort" }).click();
  await expect(panel).toContainText("Inga underlag ännu.", { timeout: 15_000 });
  expect((await (await owner.request.get(`${api}/layers`)).json() as { layers: unknown[] }).layers).toHaveLength(0);

  // En GeoTIFF (RGB) över samma område, utan världsfil.
  const [tw, th] = [60, 45];
  const tiff = writeArrayBuffer(new Uint8Array(tw * th * 3).fill(180), { width: tw, height: th, SamplesPerPixel: 3, BitsPerSample: [8, 8, 8],
    PhotometricInterpretation: 2, ModelPixelScale: [(bottomRight.easting - topLeft.easting) / tw, (topLeft.northing - bottomRight.northing) / th, 0],
    ModelTiepoint: [0, 0, 0, topLeft.easting, topLeft.northing, 0], ProjectedCSTypeGeoKey: georef.crs.kind === "EPSG" ? georef.crs.code : 3006,
    GTModelTypeGeoKey: 1, GTRasterTypeGeoKey: 1 }) as ArrayBuffer;
  await panel.getByText("Lägg till", { exact: true }).first().click();
  await panel.getByTestId("map-project-layer-file").setInputFiles([{ name: "ortofoto.tif", mimeType: "image/tiff", buffer: Buffer.from(tiff) }]);
  await panel.getByTestId("map-project-layer-upload").click();
  await expect(panel.getByTestId("map-project-layer")).toContainText("ortofoto", { timeout: 30_000 });
  await expect.poll(() => alphaAt(owner, { x: 50, y: 55 }), { timeout: 20_000 }).toBeGreaterThan(0);
  expect(await alphaAt(owner, { x: 80, y: 55 })).toBe(0);
  const stored = (await (await owner.request.get(`${api}/layers`)).json() as { layers: { mediaType: string; crs: number }[] }).layers;
  expect(stored).toMatchObject([{ mediaType: "image/jpeg", crs: georef.crs.kind === "EPSG" ? georef.crs.code : 3006 }]);

  if (process.env.E2E_BASE_URL) {
    // Omladdning utan nät mot driftbygget: listan och bilden från webbläsaren.
    const context = owner.context();
    const noNetwork = (route: Parameters<Parameters<typeof context.route>[1]>[0]) => route.abort("internetdisconnected");
    await context.setOffline(true);
    await context.route("**/*", noNetwork);
    await owner.reload();
    await expect(owner.getByTestId("course-setting-map")).toHaveAttribute("data-drawn", "true", { timeout: 30_000 });
    await owner.getByTestId("map-project-tab-layers").click();
    await expect(owner.getByTestId("map-project-layer")).toContainText("ortofoto", { timeout: 15_000 });
    await expect.poll(() => alphaAt(owner, { x: 50, y: 55 }), { timeout: 20_000 }).toBeGreaterThan(0);
    await context.unroute("**/*", noNetwork);
    await context.setOffline(false);
  } else test.info().annotations.push({ type: "utan nät", description: "Omladdningen utan nät provas mot driftbygget (E2E_BASE_URL)" });
});

/** Ett klick på kartan i en punkt i kartans mm. */
async function clickMap(page: Page, point: { x: number; y: number }) {
  const map = page.getByTestId("course-setting-map");
  const [cx, cy] = (await map.getAttribute("data-center"))!.split(",").map(Number) as [number, number];
  const px = Number(await map.getAttribute("data-px-per-mm"));
  const box = (await page.getByTestId("course-setting-overprint").boundingBox())!;
  await page.mouse.click(box.x + box.width / 2 + (point.x - cx) * px, box.y + box.height / 2 - (point.y - cy) * px);
}

/**
 * ADR-0219 K6b: en skannad bild utan världsfil läggs mitt på kartan och rättas med två passpunkter. Placeringen sparas som en ny
 * världsfil i kartans koordinatsystem.
 */
test("kartprojekt: skannad bild utan världsfil rättas med passpunkter", async ({ browser, baseURL }) => {
  test.setTimeout(240_000);
  const owner = await registerAccount(browser, `passpunkt.${unique()}@exempel.se`, "Pia Passpunkt");
  await warmRoute(owner, "/api/organizer/map-projects/upload", "POST");
  const created = await owner.request.post("/api/organizer/map-projects/upload", { headers: { origin: baseURL!, "x-otid-csrf": await csrfOf(owner),
    "content-type": "application/octet-stream", "x-otid-request-id": crypto.randomUUID(), "x-otid-name": "Passpunkter", "x-otid-file-name": "Pass.omap" },
    data: Buffer.from(mapBytes) });
  expect(created.status()).toBe(201);
  const projectId = (await created.json() as { projectId: string }).projectId;
  const api = `/api/organizer/map-projects/${projectId}`;
  await warmRoute(owner, `${api}/layers`);
  await owner.goto(`/organizer/map-projects/${projectId}/map`);
  await expect(owner.getByTestId("course-setting-map")).toHaveAttribute("data-drawn", "true", { timeout: 60_000 });

  const panel = owner.getByTestId("map-project-layers");
  await owner.getByTestId("map-project-tab-layers").click();
  await panel.getByText("Lägg till", { exact: true }).first().click();
  await panel.getByTestId("map-project-layer-file").setInputFiles([{ name: "skannad.png", mimeType: "image/png", buffer: png }]);
  await panel.getByTestId("map-project-layer-upload").click();
  await expect(panel.getByTestId("map-project-layer")).toContainText("skannad", { timeout: 30_000 });
  type Stored = { layers: { width: number; height: number; crs: number; transform: { a: number; b: number; c: number; d: number; e: number; f: number } }[] };
  const placed = (await (await owner.request.get(`${api}/layers`)).json() as Stored).layers[0]!;
  expect(placed.crs).toBe(georef.crs.kind === "EPSG" ? georef.crs.code : 0);
  const at = (t: Stored["layers"][number]["transform"], column: number, row: number) =>
    projectedToMapPoint(georef, { easting: t.a * column + t.b * row + t.c, northing: t.d * column + t.e * row + t.f });
  const pixels = [[width * 0.25, height * 0.25], [width * 0.75, height * 0.7]] as const;
  const shift = { x: 4, y: -3 };

  await panel.getByTestId("map-project-layer-control").click();
  const control = panel.getByTestId("map-project-control-points");
  await expect(control.getByTestId("map-project-control-hint")).toHaveText("Passpunkter: klicka på en punkt i bilden.");
  for (const [column, row] of pixels) {
    const from = at(placed.transform, column, row);
    await clickMap(owner, from);
    await expect(control.getByTestId("map-project-control-hint")).toHaveText("Passpunkter: klicka där punkten ska ligga på kartan.");
    await clickMap(owner, { x: from.x + shift.x, y: from.y + shift.y });
  }
  await expect(control.getByTestId("map-project-control-list").locator("li")).toHaveCount(2);
  await expect(control.getByTestId("map-project-control-fit")).toContainText("Likformig, medelavvikelse");
  await control.getByTestId("map-project-control-save").click();
  await expect(control).toHaveCount(0, { timeout: 15_000 });

  const moved = (await (await owner.request.get(`${api}/layers`)).json() as Stored).layers[0]!;
  for (const [column, row] of pixels) {
    const before = at(placed.transform, column, row), after = at(moved.transform, column, row);
    expect(Math.abs(after.x - before.x - shift.x)).toBeLessThan(0.3);
    expect(Math.abs(after.y - before.y - shift.y)).toBeLessThan(0.3);
  }
});

/**
 * ADR-0219 tillägget om vektorunderlagen (K4b): en DXF-baskarta blir kandidater. Lagren får symbol ur namnen (STIG → 505, SJO →
 * 301 som yta av en sluten polylinje), ett okänt lager hoppas över, de brutna stigbitarna slås ihop, kandidaterna lämnas som ett
 * förslag (källan IMPORT) och ägaren godkänner det.
 */
test("kartprojekt: importera en DXF-baskarta som kandidater", async ({ browser, baseURL }) => {
  test.setTimeout(240_000);
  const owner = await registerAccount(browser, `import.${unique()}@exempel.se`, "Ivar Import");
  await warmRoute(owner, "/api/organizer/map-projects/upload", "POST");
  const created = await owner.request.post("/api/organizer/map-projects/upload", { headers: { origin: baseURL!, "x-otid-csrf": await csrfOf(owner),
    "content-type": "application/octet-stream", "x-otid-request-id": crypto.randomUUID(), "x-otid-name": "Import", "x-otid-file-name": "Import.omap" },
    data: Buffer.from(mapBytes) });
  expect(created.status()).toBe(201);
  const projectId = (await created.json() as { projectId: string }).projectId;
  const api = `/api/organizer/map-projects/${projectId}`;
  await warmRoute(owner, `${api}/proposals`);

  const p = (x: number, y: number) => { const at = mapPointToProjected(georef, { x, y }); return [at.easting.toFixed(3), at.northing.toFixed(3)] as const; };
  const xy = (x: number, y: number, a = "10", b = "20") => { const [e, n] = p(x, y); return [a, e, b, n]; };
  const dxf = ["0", "SECTION", "2", "ENTITIES",
    "0", "LINE", "8", "STIG", ...xy(20, 20), ...xy(30, 20, "11", "21"),
    "0", "LINE", "8", "STIG", ...xy(40, 25), ...xy(30, 20, "11", "21"),
    "0", "LWPOLYLINE", "8", "SJO", "90", "3", "70", "1", ...xy(60, 30), ...xy(70, 30), ...xy(65, 40),
    "0", "LINE", "8", "0153", ...xy(20, 60), ...xy(30, 60, "11", "21"),
    "0", "ENDSEC", "0", "EOF"].join("\r\n");

  await owner.goto(`/organizer/map-projects/${projectId}/map`);
  await expect(owner.getByTestId("course-setting-map")).toHaveAttribute("data-drawn", "true", { timeout: 60_000 });
  const importer = owner.getByTestId("map-project-import");
  await owner.getByTestId("map-project-tab-layers").click();
  await importer.getByText("Importera vektorer").click();
  await importer.getByTestId("map-project-import-file").setInputFiles({ name: "baskarta.dxf", mimeType: "application/dxf", buffer: Buffer.from(dxf) });
  await expect(importer.getByTestId("map-project-import-crs")).toHaveValue("3006");
  await expect(importer.getByRole("combobox", { name: "Symbol för STIG" })).toHaveValue(/.+/);
  await expect(importer.getByRole("combobox", { name: "Symbol för STIG" }).locator("option:checked")).toContainText("505.0");
  await expect(importer.getByRole("combobox", { name: "Symbol för SJO" }).locator("option:checked")).toContainText("301.0");
  await expect(importer.getByRole("combobox", { name: "Symbol för 0153" })).toHaveValue("");
  await expect(importer.getByTestId("map-project-import-result")).toHaveText("2 kandidater · 1 hopslagna");
  await reviewScreenshots(owner, "kartprojekt-import");
  // Ägaren 2026-11-10: Passa in mot kartan räknar i kartans Worker och ger ett besked (den lilla testkartan har för lite att passa mot).
  const fit = importer.getByTestId("map-project-import-fit");
  await fit.getByRole("button", { name: "Passa in mot kartan" }).click();
  await expect(fit.getByRole("status")).toHaveText(/^(Inpassat|Det gick inte att passa in)/, { timeout: 30_000 });
  await expect(importer.getByTestId("map-project-import-result")).toHaveText("2 kandidater · 1 hopslagna");
  // K6b: valen sparas som en profil; samma fil igen får profilens symbol för lagret 0153 (som namnet inte ger något förslag för).
  await warmRoute(owner, `${api}/layer-profiles`);
  const zero = importer.getByRole("combobox", { name: "Symbol för 0153" });
  await zero.selectOption({ index: 1 });
  const chosen = await zero.inputValue();
  await importer.getByTestId("map-project-import-profile-name").fill("Kommunens baskarta");
  await importer.getByTestId("map-project-import-profile-save").click();
  await expect(importer.getByText("Profilen är sparad.")).toBeVisible({ timeout: 15_000 });
  await importer.getByRole("button", { name: "Avbryt" }).click();
  await importer.getByTestId("map-project-import-file").setInputFiles({ name: "baskarta.dxf", mimeType: "application/dxf", buffer: Buffer.from(dxf) });
  await expect(importer.getByTestId("map-project-import-profile")).toHaveText("Symbolerna från profilen ”Kommunens baskarta” (3 av 3 lager).");
  await expect(importer.getByRole("combobox", { name: "Symbol för 0153" })).toHaveValue(chosen);
  await importer.getByRole("combobox", { name: "Symbol för 0153" }).selectOption("");
  await expect(importer.getByTestId("map-project-import-result")).toHaveText("2 kandidater · 1 hopslagna");
  await importer.getByTestId("map-project-import-propose").click();
  await expect(importer.getByTestId("map-project-import-sent")).toContainText("1 förslag lämnade", { timeout: 20_000 });

  const proposals = owner.getByTestId("map-project-proposals");
  await expect(proposals).toContainText("Förslag (1 öppet)", { timeout: 20_000 });
  await expect(proposals).toContainText("Import baskarta.dxf");
  await owner.getByTestId("map-project-tab-review").click();
  await proposals.getByRole("button", { name: "Godkänn" }).click();
  await expect(proposals).toContainText("Godkänt", { timeout: 15_000 });
  const sync = await owner.request.post(`${api}/sync`, { headers: { origin: baseURL!, "x-otid-csrf": await csrfOf(owner), "content-type": "application/json" },
    data: { formatVersion: 1, clientId: "e2e-lasare", since: 0, edits: [] } });
  const objects = (await sync.json() as { objects: { key: string; state: { kind: string; object?: { kind: string } } }[] }).objects
    .filter(row => row.key.startsWith("n:"));
  expect(objects.map(row => row.state.object?.kind).sort()).toEqual(["area", "line"]);
  const listed = (await (await owner.request.get(`${api}/proposals`)).json() as { proposals: { source: string }[] }).proposals;
  expect(listed.map(row => row.source)).toEqual(["IMPORT"]);
});

/**
 * Etapperna (ägaren 2026-11-08, migration 0098): ett delområde får ett revideringsdatum och lagret Etapper (bara på skärmen)
 * färgar det efter hur länge sedan det reviderades.
 */
test("kartprojekt: etapper med revideringsdatum", async ({ browser, baseURL }) => {
  test.setTimeout(180_000);
  const owner = await registerAccount(browser, `etapp.${unique()}@exempel.se`, "Etta Etapp");
  await warmRoute(owner, "/api/organizer/map-projects/upload", "POST");
  const headers = async () => ({ origin: baseURL!, "x-otid-csrf": await csrfOf(owner) });
  const created = await owner.request.post("/api/organizer/map-projects/upload", { headers: { ...await headers(),
    "content-type": "application/octet-stream", "x-otid-request-id": crypto.randomUUID(), "x-otid-name": "Etapper", "x-otid-file-name": "Etapper.omap" },
    data: Buffer.from(mapBytes) });
  const projectId = (await created.json() as { projectId: string }).projectId;
  const api = `/api/organizer/map-projects/${projectId}`;
  const area = await owner.request.post(`${api}/areas`, { headers: { ...await headers(), "content-type": "application/json" }, data: { formatVersion: 1,
    requestId: crypto.randomUUID(), name: "Etapp 1", polygon: [[{ x: 30, y: 40 }, { x: 70, y: 40 }, { x: 70, y: 70 }, { x: 30, y: 70 }]] } });
  expect(area.status(), await area.text()).toBe(201);
  // Utvecklingsservern kompilerar ändringens väg vid första anropet.
  await warmRoute(owner, `${api}/areas/${(await area.json() as { area: { areaId: string } }).area.areaId}`, "PUT");

  await owner.goto(`/organizer/map-projects/${projectId}/map`);
  await expect(owner.getByTestId("course-setting-map")).toHaveAttribute("data-drawn", "true", { timeout: 60_000 });
  const areas = owner.getByTestId("map-project-areas");
  await owner.getByTestId("map-project-tab-review").click();
  await areas.getByLabel("Reviderad: Etapp 1").fill("2024-05-31");
  await expect.poll(async () => (await (await owner.request.get(`${api}/areas`)).json() as { areas: { revisedOn: string | null }[] }).areas[0]!.revisedOn,
    { timeout: 10_000 }).toBe("2024-05-31");
  expect(await alphaAt(owner, { x: 35, y: 45 })).toBe(0);
  await areas.getByTestId("map-project-stages").check();
  await expect(areas.getByTestId("map-project-stage-legend")).toContainText("aldrig i utskrift");
  await expect.poll(() => alphaAt(owner, { x: 35, y: 45 }), { timeout: 10_000 }).toBeGreaterThan(0);
  await reviewScreenshots(owner, "kartprojekt-etapper");
});

/** Normkontrollen (ägaren 2026-11-08): två kurvor för nära varandra syns när kontrollen slås på, och försvinner när den slås av. */
test("kartprojekt: normkontroll av kurvavståndet", async ({ browser, baseURL }) => {
  test.setTimeout(180_000);
  const contour = [...parsed.symbols.values()].find(symbol => symbol.code.text === "101.0")!;
  expect(contour).toBeDefined();
  const owner = await registerAccount(browser, `norm.${unique()}@exempel.se`, "Nora Norm");
  await warmRoute(owner, "/api/organizer/map-projects/upload", "POST");
  const headers = async () => ({ origin: baseURL!, "x-otid-csrf": await csrfOf(owner) });
  const created = await owner.request.post("/api/organizer/map-projects/upload", { headers: { ...await headers(),
    "content-type": "application/octet-stream", "x-otid-request-id": crypto.randomUUID(), "x-otid-name": "Norm", "x-otid-file-name": "Norm.omap" },
    data: Buffer.from(mapBytes) });
  const projectId = (await created.json() as { projectId: string }).projectId;
  const line = (y: number) => ({ editId: crypto.randomUUID(), key: `n:${crypto.randomUUID()}`, ref: null, base: null, kind: "ADD", at: new Date().toISOString(),
    state: { kind: "OBJECT", object: { kind: "line", symbol: contour.id, path: [{ type: "M", x: 20, y }, { type: "L", x: 40, y }] } } });
  const sync = await owner.request.post(`/api/organizer/map-projects/${projectId}/sync`, { headers: { ...await headers(), "content-type": "application/json" },
    data: { formatVersion: 1, clientId: "e2e", since: 0, edits: [line(80), line(80.1)] } });
  expect(sync.status()).toBe(200);

  await owner.goto(`/organizer/map-projects/${projectId}/map`);
  await expect(owner.getByTestId("course-setting-map")).toHaveAttribute("data-drawn", "true", { timeout: 60_000 });
  const panel = owner.getByTestId("map-project-norm");
  await owner.getByTestId("map-project-tab-review").click();
  await panel.getByTestId("map-project-norm-toggle").check();
  await expect(panel.getByTestId("map-project-norm-count")).toContainText("att se över", { timeout: 20_000 });
  const rule = panel.locator("[data-rule='CONTOUR_GAP']");
  await expect(rule).toContainText("Kurvor för nära varandra");
  await rule.locator("summary").click();
  await rule.getByRole("button", { name: "Visa" }).first().click();
  // Romberna ritas på överlägget längs kurvorna (kurvorna själva ritas i kartan under).
  const alongLine = async () => { let most = 0; for (let x = 20; x <= 40; x += 0.25) most = Math.max(most, await alphaAt(owner, { x, y: 80.05 })); return most; };
  await expect.poll(alongLine, { timeout: 10_000 }).toBeGreaterThan(0);
  await reviewScreenshots(owner, "kartprojekt-normkontroll");
  await panel.getByTestId("map-project-norm-toggle").uncheck();
  await expect(panel.getByTestId("map-project-norm-count")).toHaveCount(0);
  await expect.poll(alongLine, { timeout: 10_000 }).toBe(0);
});

/**
 * ADR-0219 tillägget om hämtningen (K4c): OpenStreetMap för en etapp hämtas av servern (en falsk Overpass i testerna) och blir
 * kandidater som en vektorfil. Gångvägen får 505 ur lagrets namn; byggnaden saknar symbol i kartans set och hoppas över.
 */
test("kartprojekt: hämta OpenStreetMap för en etapp", async ({ browser, baseURL }) => {
  test.setTimeout(240_000);
  const owner = await registerAccount(browser, `osm.${unique()}@exempel.se`, "Olle Osm");
  await warmRoute(owner, "/api/organizer/map-projects/upload", "POST");
  const headers = async () => ({ origin: baseURL!, "x-otid-csrf": await csrfOf(owner) });
  const created = await owner.request.post("/api/organizer/map-projects/upload", { headers: { ...await headers(),
    "content-type": "application/octet-stream", "x-otid-request-id": crypto.randomUUID(), "x-otid-name": "Osm", "x-otid-file-name": "Osm.omap" },
    data: Buffer.from(mapBytes) });
  const projectId = (await created.json() as { projectId: string }).projectId;
  const api = `/api/organizer/map-projects/${projectId}`;
  const area = await owner.request.post(`${api}/areas`, { headers: { ...await headers(), "content-type": "application/json" }, data: { formatVersion: 1,
    requestId: crypto.randomUUID(), name: "Etapp 1", polygon: [[{ x: 30, y: 40 }, { x: 70, y: 40 }, { x: 70, y: 70 }, { x: 30, y: 70 }]] } });
  expect(area.status(), await area.text()).toBe(201);
  await warmRoute(owner, `${api}/sources/osm`, "POST");
  await warmRoute(owner, `${api}/proposals`);

  await owner.goto(`/organizer/map-projects/${projectId}/map`);
  await expect(owner.getByTestId("course-setting-map")).toHaveAttribute("data-drawn", "true", { timeout: 60_000 });
  const importer = owner.getByTestId("map-project-import");
  await owner.getByTestId("map-project-tab-layers").click();
  await importer.getByText("Importera vektorer").click();
  const osm = importer.getByTestId("map-project-osm");
  await osm.getByTestId("map-project-osm-area").selectOption({ label: "Etapp 1" });
  await osm.getByTestId("map-project-osm-fetch").click();
  await expect(importer.getByTestId("map-project-import-crs")).toHaveValue("4326", { timeout: 30_000 });
  await expect(importer.getByRole("combobox", { name: "Symbol för OSM gångväg och cykelväg" }).locator("option:checked")).toContainText("505.0");
  await expect(importer.getByRole("combobox", { name: "Symbol för OSM byggnad" })).toHaveValue("");
  await expect(importer.getByTestId("map-project-import-result")).toHaveText("1 kandidat");
  await importer.getByTestId("map-project-import-propose").click();
  await expect(importer.getByTestId("map-project-import-sent")).toContainText("1 förslag lämnade", { timeout: 20_000 });
  const proposals = owner.getByTestId("map-project-proposals");
  await expect(proposals).toContainText("OpenStreetMap, Etapp 1", { timeout: 20_000 });

  // Ett för stort område avvisas av servern.
  const huge = await owner.request.post(`${api}/sources/osm`, { headers: { ...await headers(), "content-type": "application/json" },
    data: { formatVersion: 1, box: { south: 59, west: 18, north: 60, east: 19 } } });
  expect(huge.status()).toBe(422);
  expect((await huge.json() as { error: string }).error).toBe("SOURCE_AREA_TOO_LARGE");
});

/**
 * ADR-0219 tillägget om hämtningen (K4c, migration 0100): egna uppgifter till Lantmäteriet under Mitt konto (visas aldrig igen),
 * sökningen efter ortofoton för kartan och bilden som underlag; bilden läses i delar genom servern (en falsk STAC i testerna).
 */
test("kartprojekt: ortofoto från Lantmäteriet med egna uppgifter", async ({ browser, baseURL }) => {
  test.setTimeout(240_000);
  const owner = await registerAccount(browser, `orto.${unique()}@exempel.se`, "Orvar Orto");
  await warmRoute(owner, "/api/account/map-sources/lantmateriet");
  await owner.goto("/konto");
  const section = owner.locator("#konto-lantmateriet");
  await expect(section.getByTestId("map-source-state")).toHaveText("Inga uppgifter sparade.");
  await section.getByLabel("Användarnamn", { exact: true }).fill("geotorget-orvar");
  await section.getByLabel("Lösenord", { exact: true }).fill("hemligt-orto-1");
  await section.getByRole("button", { name: "Spara uppgifterna" }).click();
  await expect(section.getByTestId("map-source-state")).toContainText("användarnamn som slutar på …rvar");
  expect(await (await owner.request.get("/api/account/map-sources/lantmateriet")).text()).not.toContain("hemligt");

  await warmRoute(owner, "/api/organizer/map-projects/upload", "POST");
  const created = await owner.request.post("/api/organizer/map-projects/upload", { headers: { origin: baseURL!, "x-otid-csrf": await csrfOf(owner),
    "content-type": "application/octet-stream", "x-otid-request-id": crypto.randomUUID(), "x-otid-name": "Orto", "x-otid-file-name": "Orto.omap" },
    data: Buffer.from(mapBytes) });
  const projectId = (await created.json() as { projectId: string }).projectId;
  const api = `/api/organizer/map-projects/${projectId}`;
  await warmRoute(owner, `${api}/sources/lantmateriet/search`, "POST");
  await warmRoute(owner, `${api}/layers`);

  await owner.goto(`/organizer/map-projects/${projectId}/map`);
  await expect(owner.getByTestId("course-setting-map")).toHaveAttribute("data-drawn", "true", { timeout: 60_000 });
  const ortho = owner.getByTestId("map-project-ortho");
  await owner.getByTestId("map-project-tab-layers").click();
  await ortho.getByText("Ortofoto från Lantmäteriet").click();
  await ortho.getByTestId("map-project-ortho-search").click();
  const items = ortho.getByTestId("map-project-ortho-items");
  await expect(items).toContainText("2025-06-15 · orto-2025 · 64_6_2025", { timeout: 30_000 });
  await ortho.getByTestId("map-project-ortho-add").click();
  await expect(ortho.getByTestId("map-project-ortho-message")).toHaveText("1 underlag tillagt.", { timeout: 60_000 });
  await expect(owner.getByTestId("map-project-layer")).toHaveCount(1);
  await expect(owner.getByTestId("map-project-layer")).toContainText("Ortofoto orto-2025 64_6_2025");
  const listed = (await (await owner.request.get(`${api}/layers`)).json() as { layers: { crs: number; mediaType: string; width: number }[] }).layers;
  expect(listed).toMatchObject([{ crs: 3006, mediaType: "image/jpeg" }]);
  await reviewScreenshots(owner, "kartprojekt-ortofoto");
});

/**
 * ADR-0219 K6 (del 1): generaliseringen som förslag. En importerad stig med täta punkter förenklas och en liten sjö (mindre än
 * normen) tas bort; ändringarna blir ett förslag (källan GENERALIZE) som ägaren godkänner.
 */
test("kartprojekt: generalisering som förslag", async ({ browser, baseURL }) => {
  test.setTimeout(240_000);
  const owner = await registerAccount(browser, `general.${unique()}@exempel.se`, "Greta General");
  await warmRoute(owner, "/api/organizer/map-projects/upload", "POST");
  const created = await owner.request.post("/api/organizer/map-projects/upload", { headers: { origin: baseURL!, "x-otid-csrf": await csrfOf(owner),
    "content-type": "application/octet-stream", "x-otid-request-id": crypto.randomUUID(), "x-otid-name": "General", "x-otid-file-name": "General.omap" },
    data: Buffer.from(mapBytes) });
  const projectId = (await created.json() as { projectId: string }).projectId;
  const api = `/api/organizer/map-projects/${projectId}`;
  await warmRoute(owner, `${api}/proposals`);
  const p = (x: number, y: number) => { const at = mapPointToProjected(georef, { x, y }); return [at.easting.toFixed(3), at.northing.toFixed(3)] as const; };
  // Stigen: 60 punkter med 0,01 mm krusning; sjön: en triangel på 0,4 mm.
  const stig = Array.from({ length: 60 }, (_, i) => p(20 + i * 0.5, 50 + (i % 2 === 0 ? 0.01 : -0.01)));
  const sjo = [p(60, 30), p(60.4, 30), p(60.2, 30.4)];
  const dxf = ["0", "SECTION", "2", "ENTITIES",
    "0", "LWPOLYLINE", "8", "STIG", "90", "60", "70", "0", ...stig.flatMap(([e, n]) => ["10", e, "20", n]),
    "0", "LWPOLYLINE", "8", "SJO", "90", "3", "70", "1", ...sjo.flatMap(([e, n]) => ["10", e, "20", n]),
    "0", "ENDSEC", "0", "EOF"].join("\r\n");

  await owner.goto(`/organizer/map-projects/${projectId}/map`);
  await expect(owner.getByTestId("course-setting-map")).toHaveAttribute("data-drawn", "true", { timeout: 60_000 });
  const importer = owner.getByTestId("map-project-import");
  await owner.getByTestId("map-project-tab-layers").click();
  await importer.getByText("Importera vektorer").click();
  await importer.getByTestId("map-project-import-file").setInputFiles({ name: "tat.dxf", mimeType: "application/dxf", buffer: Buffer.from(dxf) });
  await expect(importer.getByTestId("map-project-import-result")).toContainText("2 kandidater");
  await importer.getByTestId("map-project-import-propose").click();
  const proposals = owner.getByTestId("map-project-proposals");
  await expect(proposals).toContainText("Förslag (1 öppet)", { timeout: 20_000 });
  await owner.getByTestId("map-project-tab-review").click();
  await proposals.getByRole("button", { name: "Godkänn" }).click();
  await expect(proposals).toContainText("Godkänt", { timeout: 15_000 });

  const general = owner.getByTestId("map-project-generalize");
  await owner.getByTestId("map-project-tab-process").click();
  await general.getByText("Generalisering").first().click();
  await general.getByTestId("map-project-generalize-tolerance").selectOption("0.1");
  await expect(async () => {
    await general.getByTestId("map-project-generalize-preview").click();
    await expect(general.getByTestId("map-project-generalize-result")).toContainText("1 objekt förenklas: 60 punkter blir 2.", { timeout: 3000 });
  }).toPass({ timeout: 30_000 });
  await expect(general.getByTestId("map-project-generalize-result")).toContainText("Tas bort: 1 små ytor, 0 korta linjer, 0 små knollar.");
  // K6 del 2: ihopfogning och ytor inuti likadana ytor räknas också (inget att göra här).
  await expect(general.getByTestId("map-project-generalize-result")).toContainText("Inga ytor inuti en likadan yta.");
  await general.getByTestId("map-project-generalize-propose").click();
  await expect(general.getByTestId("map-project-generalize-message")).toHaveText("Förslaget är skickat. Ägaren ser det under Förslag.", { timeout: 20_000 });
  await expect(proposals).toContainText("Generalisering: förenkla 0,1 mm, ta bort det som är mindre än normen", { timeout: 20_000 });
  await owner.getByTestId("map-project-tab-review").click();
  await proposals.getByRole("button", { name: "Godkänn" }).click();
  await expect(proposals).not.toContainText("öppet", { timeout: 15_000 });

  const sync = await owner.request.post(`${api}/sync`, { headers: { origin: baseURL!, "x-otid-csrf": await csrfOf(owner), "content-type": "application/json" },
    data: { formatVersion: 1, clientId: "e2e-general", since: 0, edits: [] } });
  const objects = (await sync.json() as { objects: { key: string; state: { kind: string; object?: { kind: string; path?: unknown[] } } }[] }).objects
    .filter(row => row.key.startsWith("n:"));
  expect(objects.map(row => row.state.kind === "DELETED" ? "borttagen" : `${row.state.object!.kind}:${row.state.object!.path?.length ?? "-"}`).sort())
    .toEqual(["borttagen", "line:2"]);
  const listed = (await (await owner.request.get(`${api}/proposals`)).json() as { proposals: { source: string }[] }).proposals;
  expect(listed.map(row => row.source).sort()).toEqual(["GENERALIZE", "IMPORT"]);
});

/**
 * ADR-0219 K6b: en äldre karta rättas med passpunkter. Två punkter som ligger 2 mm åt öster och 1 mm åt norr ger en
 * likformig flytt av alla objekt (cirka 22 m vid 1:10 000) som lämnas som förslag med källan PROCESS.
 */
test("kartprojekt: rätta kartan med passpunkter som förslag", async ({ browser, baseURL }) => {
  test.setTimeout(240_000);
  const owner = await registerAccount(browser, `ratta.${unique()}@exempel.se`, "Rut Rättare");
  await warmRoute(owner, "/api/organizer/map-projects/upload", "POST");
  const created = await owner.request.post("/api/organizer/map-projects/upload", { headers: { origin: baseURL!, "x-otid-csrf": await csrfOf(owner),
    "content-type": "application/octet-stream", "x-otid-request-id": crypto.randomUUID(), "x-otid-name": "Rätta", "x-otid-file-name": "Ratta.omap" },
    data: Buffer.from(mapBytes) });
  expect(created.status()).toBe(201);
  const projectId = (await created.json() as { projectId: string }).projectId;
  const api = `/api/organizer/map-projects/${projectId}`;
  await warmRoute(owner, `${api}/proposals`);
  await owner.goto(`/organizer/map-projects/${projectId}/map`);
  await expect(owner.getByTestId("course-setting-map")).toHaveAttribute("data-drawn", "true", { timeout: 60_000 });

  const rectify = owner.getByTestId("map-project-rectify");
  await owner.getByTestId("map-project-tab-process").click();
  await rectify.getByText("Rätta kartan med passpunkter").click();
  await rectify.getByTestId("map-project-rectify-start").click();
  for (const from of [{ x: 30, y: 40 }, { x: 70, y: 60 }]) {
    await expect(rectify.getByTestId("map-project-rectify-hint")).toHaveText("Rätta kartan: klicka där något ligger på kartan nu.");
    await clickMap(owner, from);
    await expect(rectify.getByTestId("map-project-rectify-hint")).toHaveText("Rätta kartan: klicka där det ska ligga.");
    await clickMap(owner, { x: from.x + 2, y: from.y + 1 });
  }
  await expect(rectify.getByTestId("map-project-rectify-list").locator("li")).toHaveCount(2);
  await expect(rectify.getByTestId("map-project-rectify-fit")).toContainText("Likformig: medelavvikelse");
  await rectify.getByRole("button", { name: "Klar med punkterna" }).click();
  await rectify.getByTestId("map-project-rectify-preview").click();
  await expect(rectify.getByTestId("map-project-rectify-result")).toContainText(/\d+ objekt flyttas, i medel 2\d m/, { timeout: 30_000 });
  const count = Number((await rectify.getByTestId("map-project-rectify-result").textContent())!.match(/(\d+) objekt flyttas/)![1]);
  expect(count).toBeGreaterThan(0);
  await rectify.getByTestId("map-project-rectify-propose").click();
  await expect(rectify.getByTestId("map-project-rectify-message")).toContainText("Ägaren ser", { timeout: 30_000 });
  const listed = (await (await owner.request.get(`${api}/proposals`)).json() as { proposals: { source: string; note: string | null }[] }).proposals;
  expect(listed.every(row => row.source === "PROCESS")).toBe(true);
  expect(listed[0]!.note).toMatch(/^Rättad med 2 passpunkter \(likformig\)/);
  await owner.getByTestId("map-project-tab-review").click();
  await expect(owner.getByTestId("map-project-proposals")).toContainText("Rättad med 2 passpunkter", { timeout: 20_000 });
});
