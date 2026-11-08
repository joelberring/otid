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
});
