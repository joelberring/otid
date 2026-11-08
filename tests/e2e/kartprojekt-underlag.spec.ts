import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { writeArrayBuffer } from "geotiff";
import { mapPointToProjected, readMapFile } from "../../packages/map-file/src";
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
    await expect(owner.getByTestId("map-project-layer")).toContainText("ortofoto", { timeout: 15_000 });
    await expect.poll(() => alphaAt(owner, { x: 50, y: 55 }), { timeout: 20_000 }).toBeGreaterThan(0);
    await context.unroute("**/*", noNetwork);
    await context.setOffline(false);
  } else test.info().annotations.push({ type: "utan nät", description: "Omladdningen utan nät provas mot driftbygget (E2E_BASE_URL)" });
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
  await importer.getByText("Importera vektorer").click();
  await importer.getByTestId("map-project-import-file").setInputFiles({ name: "baskarta.dxf", mimeType: "application/dxf", buffer: Buffer.from(dxf) });
  await expect(importer.getByTestId("map-project-import-crs")).toHaveValue("3006");
  await expect(importer.getByRole("combobox", { name: "Symbol för STIG" })).toHaveValue(/.+/);
  await expect(importer.getByRole("combobox", { name: "Symbol för STIG" }).locator("option:checked")).toContainText("505.0");
  await expect(importer.getByRole("combobox", { name: "Symbol för SJO" }).locator("option:checked")).toContainText("301.0");
  await expect(importer.getByRole("combobox", { name: "Symbol för 0153" })).toHaveValue("");
  await expect(importer.getByTestId("map-project-import-result")).toHaveText("2 kandidater · 1 hopslagna");
  await reviewScreenshots(owner, "kartprojekt-import");
  await importer.getByTestId("map-project-import-propose").click();
  await expect(importer.getByTestId("map-project-import-sent")).toContainText("1 förslag lämnade", { timeout: 20_000 });

  const proposals = owner.getByTestId("map-project-proposals");
  await expect(proposals).toContainText("Förslag (1 öppet)", { timeout: 20_000 });
  await expect(proposals).toContainText("Import baskarta.dxf");
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
  await areas.getByLabel("Reviderad: Etapp 1").fill("2024-05-31");
  await expect.poll(async () => (await (await owner.request.get(`${api}/areas`)).json() as { areas: { revisedOn: string | null }[] }).areas[0]!.revisedOn,
    { timeout: 10_000 }).toBe("2024-05-31");
  expect(await alphaAt(owner, { x: 35, y: 45 })).toBe(0);
  await areas.getByTestId("map-project-stages").check();
  await expect(areas.getByTestId("map-project-stage-legend")).toContainText("aldrig i utskrift");
  await expect.poll(() => alphaAt(owner, { x: 35, y: 45 }), { timeout: 10_000 }).toBeGreaterThan(0);
  await reviewScreenshots(owner, "kartprojekt-etapper");
});
