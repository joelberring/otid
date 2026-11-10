import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test, type Page } from "@playwright/test";
import { E2E_GEO_WORKER_TOKEN } from "./fake-geodata";
import { registerAccount, reviewScreenshots, unique, warmRoute } from "./helpers";

/**
 * ADR-0219 K5: laserdata och Karttapullautin, och K5c: SLU:s markfuktighet. Ägaren lägger in sina uppgifter till Lantmäteriet,
 * hämtar markfuktigheten som underlag, söker laserrutor och lägger ett jobb. Geo-arbetaren (scripts/geo-worker.ts, med en falsk
 * Karttapullautin) hämtar jobbet och laserfilen genom servern och skickar tillbaka resultatet: bilden blir ett underlag och
 * kurvorna läses in som kandidater. Lantmäteriet och SLU är falska (fake-geodata.ts).
 */
const mapBytes = new Uint8Array(readFileSync(new URL("../../fixtures/maps/kartfil.omap", import.meta.url)));
const root = fileURLToPath(new URL("../../", import.meta.url));

async function csrfOf(page: Page): Promise<string> {
  return (await page.context().cookies()).find(row => /otid[-_]organizer[-_]csrf$/.test(row.name))?.value ?? "";
}

/** Geo-arbetaren ett varv mot webben (nyckeln är testkonfigurationens). */
function runGeoWorker(origin: string): Promise<{ code: number | null; output: string }> {
  const work = mkdtempSync(join(tmpdir(), "otid-geo-"));
  const ini = join(work, "pullauta.default.ini");
  writeFileSync(ini, "batch=0\nprocesses=2\n");
  return new Promise(resolve => {
    const child = spawn(process.execPath, [join(root, "scripts/geo-worker.ts")], { cwd: work, env: { ...process.env, OTID_GEO_ORIGIN: origin,
      OTID_GEO_WORKER_TOKEN: E2E_GEO_WORKER_TOKEN, OTID_GEO_WORKER_NAME: "e2e-geo", OTID_GEO_ONCE: "1", OTID_PULLAUTA: join(root, "tests/e2e/fake-pullauta.mjs"),
      OTID_DWGREAD: join(root, "tests/e2e/fake-dwgread.mjs"), OTID_LASCLIP: join(root, "tests/e2e/fake-lasclip.mjs"),
      OTID_PULLAUTA_INI: ini, OTID_GEO_WORKDIR: join(work, "jobb"), NODE_TLS_REJECT_UNAUTHORIZED: "0", NODE_NO_WARNINGS: "1" } });
    let output = "";
    child.stdout.on("data", (chunk: Buffer) => { output += chunk.toString(); });
    child.stderr.on("data", (chunk: Buffer) => { output += chunk.toString(); });
    child.on("close", code => resolve({ code, output }));
  });
}

test("kartprojekt: markfuktighet och laserdata med Karttapullautin på geo-servern", async ({ browser, baseURL }) => {
  test.setTimeout(300_000);
  const owner = await registerAccount(browser, `laser.${unique()}@exempel.se`, "Lisa Laser");
  await warmRoute(owner, "/api/account/map-sources/lantmateriet");
  const saved = await owner.request.put("/api/account/map-sources/lantmateriet", { headers: { origin: baseURL!, "x-otid-csrf": await csrfOf(owner) },
    data: { formatVersion: 1, method: "BASIC", id: "geotorget-lisa", secret: "hemligt-laser-1" } });
  expect(saved.status()).toBe(200);

  await warmRoute(owner, "/api/organizer/map-projects/upload", "POST");
  const created = await owner.request.post("/api/organizer/map-projects/upload", { headers: { origin: baseURL!, "x-otid-csrf": await csrfOf(owner),
    "content-type": "application/octet-stream", "x-otid-request-id": crypto.randomUUID(), "x-otid-name": "Laser", "x-otid-file-name": "Laser.omap" },
    data: Buffer.from(mapBytes) });
  const projectId = (await created.json() as { projectId: string }).projectId;
  const api = `/api/organizer/map-projects/${projectId}`;
  for (const [path, method] of [[`${api}/sources/markfuktighet`, "POST"], [`${api}/sources/lantmateriet/laser`, "POST"], [`${api}/geo-jobs`, "GET"],
    [`${api}/layers`, "GET"], ["/api/geo-worker/claim", "POST"]] as const) await warmRoute(owner, path, method);

  await owner.goto(`/organizer/map-projects/${projectId}/map`);
  await expect(owner.getByTestId("course-setting-map")).toHaveAttribute("data-drawn", "true", { timeout: 60_000 });

  // K5c: markfuktigheten blir ett underlag i SWEREF 99 TM.
  const moisture = owner.getByTestId("map-project-moisture");
  await owner.getByTestId("map-project-tab-layers").click();
  await moisture.getByText("Markfuktighet (SLU)").click();
  await moisture.getByTestId("map-project-moisture-fetch").click();
  await expect(moisture.getByTestId("map-project-moisture-message")).toHaveText("Markfuktigheten är tillagd som underlag.", { timeout: 60_000 });
  await expect(owner.getByTestId("map-project-layer")).toHaveCount(1);
  await expect(owner.getByTestId("map-project-layer")).toContainText("Markfuktighet SLU hela kartan");

  // K5: laserrutorna och jobbet.
  const laser = owner.getByTestId("map-project-laser");
  await laser.getByText("Laserdata och Karttapullautin").click();
  await laser.getByTestId("map-project-laser-search").click();
  await expect(laser.getByTestId("map-project-laser-items")).toContainText("2024-05-20 · 24E001_658_67_2550 · 123 MB", { timeout: 30_000 });
  await expect(laser.getByTestId("map-project-laser-name")).toHaveValue("Karttapullautin hela kartan");
  // K5c del 2: fuktigheten ur markmodellen räknas i samma jobb.
  await laser.getByTestId("map-project-laser-moisture").check();
  // K5c del 3: vegetationen ur returerna som ytor.
  await laser.getByTestId("map-project-laser-vegetation").check();
  await laser.getByTestId("map-project-laser-start").click();
  await expect(laser.getByTestId("map-project-laser-message")).toHaveText("Jobbet ligger i kön.");
  await expect(laser.getByTestId("map-project-laser-job")).toContainText("Karttapullautin hela kartan · 1 ruta · Väntar på geo-servern");
  // Grundkartan G1: laserdatan klipps till kartans område med 50 m marginal.
  await expect(laser.getByTestId("map-project-laser-job")).toContainText(/Klippt till området, \d+ × \d+ m/);

  // Geo-arbetaren tar jobbet; inga uppgifter till Lantmäteriet följer med till den.
  const worker = await runGeoWorker(baseURL!);
  expect(worker.code, worker.output).toBe(0);
  expect(worker.output).toContain("klart (1 rutor");
  expect(worker.output).not.toContain("hemligt");

  await expect(laser.getByTestId("map-project-laser-job")).toContainText("Klart", { timeout: 30_000 });
  await expect(laser.getByTestId("map-project-laser-job")).toContainText("Bilden är tillagd som underlag.");
  await expect(laser.getByTestId("map-project-laser-job")).toContainText("Fuktigheten är tillagd som underlag.");
  await expect(owner.getByTestId("map-project-layer")).toHaveCount(3, { timeout: 20_000 });
  const layers = (await (await owner.request.get(`${api}/layers`)).json() as { layers: { name: string; crs: number; width: number }[] }).layers;
  expect(layers).toEqual(expect.arrayContaining([expect.objectContaining({ name: "Karttapullautin hela kartan", crs: 3006, width: 200 }),
    expect.objectContaining({ name: "Karttapullautin hela kartan – fuktighet", crs: 3006 })]));

  // Kurvorna som kandidater.
  await laser.getByRole("button", { name: "Läs in kurvor som kandidater" }).click();
  await expect(laser.getByTestId("map-project-laser-message")).toHaveText("Kurvor visas som kandidater nedan under Vektorfil.");
  const importer = owner.getByTestId("map-project-import");
  // Testkartans symbolset saknar kurvor, så inga förslag här (förslagen prövas i vector-import.test.ts); lagren syns med namnen.
  await expect(importer.getByTestId("map-project-import-layer")).toHaveCount(2);
  await expect(importer.getByTestId("map-project-import-layer").first()).toContainText("contour");
  await expect(importer.getByLabel("Symbol för contour_index")).toBeAttached();
  await reviewScreenshots(owner, "kartprojekt-laser");
  // Våtmarkerna som kandidater (ersätter kurvorna i importen): sänkan blir blött och fuktigt.
  await laser.getByRole("button", { name: "Läs in våtmarker och fuktstråk som kandidater" }).click();
  await expect(laser.getByTestId("map-project-laser-message")).toHaveText("Våtmarker och fuktstråk visas som kandidater nedan under Vektorfil.");
  await expect(importer.getByTestId("map-project-import-layer").first()).toContainText("blott");
  // Vegetationen: öppen mark i väster och mycket svårlöpt grönt i öster (alla tre gröna nivåerna).
  await laser.getByRole("button", { name: "Läs in vegetationsytor som kandidater" }).click();
  await expect(laser.getByTestId("map-project-laser-message")).toHaveText("Vegetationsytor visas som kandidater nedan under Vektorfil.");
  await expect(importer.getByTestId("map-project-import-layer")).toHaveCount(4);
  await expect(importer.getByTestId("map-project-import-layer").first()).toContainText("oppen_mark");
  // Grundkartan: allt på en gång, med branten som en linje i stället för Karttapullautins streck.
  await laser.getByTestId("map-project-laser-base-map").click();
  await expect(laser.getByTestId("map-project-laser-message")).toHaveText("Grundkartan visas som kandidater nedan under Vektorfil.");
  for (const name of ["contour", "brant_passerbar", "vatten", "blott", "oppen_mark"]) {
    await expect(importer.getByTestId("map-project-import-layer").filter({ hasText: name }).first()).toBeAttached();
  }
  // Vattnet ur laserns klasser: sjön blir en yta i lagret vatten.
  await laser.getByRole("button", { name: "Läs in sjöar och vatten som kandidater" }).click();
  await expect(laser.getByTestId("map-project-laser-message")).toHaveText("Sjöar och vatten visas som kandidater nedan under Vektorfil.");
  await expect(importer.getByTestId("map-project-import-layer")).toHaveCount(1);
  await expect(importer.getByTestId("map-project-import-layer").first()).toContainText("vatten");

  // K6b: en DWG-ritning läses på geo-servern (vägen och huset, en skraffyr) och läses in som kandidater.
  await warmRoute(owner, `${api}/geo-jobs/dwg`, "POST");
  if (await importer.getAttribute("open") === null) await importer.locator("summary").first().click();
  await importer.getByRole("button", { name: "Avbryt", exact: true }).click();
  await owner.getByTestId("map-project-import-file").setInputFiles({ name: "baskarta.dwg", mimeType: "application/acad",
    buffer: Buffer.concat([Buffer.from("AC1015"), Buffer.alloc(200)]) });
  await expect(owner.getByTestId("map-project-import-dwg")).toContainText("baskarta.dwg läses på geo-servern");
  const dwgWorker = await runGeoWorker(baseURL!);
  expect(dwgWorker.code, dwgWorker.output).toBe(0);
  expect(dwgWorker.output).toContain("DWG klart");
  const dwgJob = laser.getByTestId("map-project-laser-job").filter({ hasText: "baskarta" });
  await expect(dwgJob).toContainText("baskarta · DWG-ritning · Klart", { timeout: 30_000 });
  await dwgJob.getByRole("button", { name: "Läs in ritningen som kandidater" }).click();
  await expect(importer.getByTestId("map-project-import-layer")).toHaveCount(2);
  await expect(importer.getByTestId("map-project-import-layer").first()).toContainText("VAG");
  // Något annat än en DWG avvisas utan jobb.
  const notDwg = await owner.request.post(`${api}/geo-jobs/dwg`, { headers: { origin: baseURL!, "x-otid-csrf": await csrfOf(owner),
    "content-type": "application/octet-stream", "x-otid-request-id": crypto.randomUUID(), "x-otid-file-name": "fel.dwg" }, data: Buffer.from("inte en ritning") });
  expect(notDwg.status()).toBe(422);
  expect((await notDwg.json() as { error: string }).error).toBe("UNSUPPORTED_DWG_FILE");

  // Fel nyckel kommer inte åt geo-arbetarens anrop.
  const denied = await owner.request.post("/api/geo-worker/claim", { headers: { authorization: `Bearer ${"x".repeat(48)}`, "x-otid-geo-worker": "e2e" } });
  expect(denied.status()).toBe(401);
});
