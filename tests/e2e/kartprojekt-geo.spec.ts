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
  // Sidan frågar (i kandidaternas rad) innan kandidater som inte är införda byts mot andra (ägaren 2026-11-12); här byts de med flit.
  const replace = () => owner.getByTestId("map-project-candidate-replace-yes").click();
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
  // Guiden «Ny grundkarta» står överst och följer samma körningar: uppgifterna finns och området ryms, så nästa steg är att köra.
  const guide = owner.getByTestId("map-project-guide");
  await expect(guide).toHaveAttribute("data-step", "run");
  await laser.getByText("Laserdata och Karttapullautin").click();
  await laser.getByTestId("map-project-laser-search").click();
  await expect(laser.getByTestId("map-project-laser-items")).toContainText("2024-05-20 · 24E001_658_67_2550 · 123 MB", { timeout: 30_000 });
  await expect(laser.getByTestId("map-project-laser-name")).toHaveValue("Karttapullautin hela kartan");
  // K5c del 2: fuktigheten ur markmodellen räknas i samma jobb.
  await laser.getByTestId("map-project-laser-moisture").check();
  // K5c del 3: vegetationen ur returerna som ytor.
  await laser.getByTestId("map-project-laser-vegetation").check();
  // G8: sökningen hittar också Lantmäteriets marktäcke och byggnader; båda är förvalda (byggnaderna saknar kontot behörighet till).
  await expect(laser.getByTestId("map-project-laser-extra-LAND_COVER")).toBeChecked();
  await expect(laser.getByTestId("map-project-laser-extra-BUILDINGS")).toBeChecked();
  // Ägaren 2026-11-11: enkla val i stället för värden; fler branter sänker Karttapullautins trösklar.
  await laser.getByTestId("map-project-laser-choice-cliffs").selectOption("more");
  await laser.getByTestId("map-project-laser-start").click();
  await expect(laser.getByTestId("map-project-laser-message")).toHaveText("Jobbet ligger i kön.");
  await expect(laser.getByTestId("map-project-laser-job")).toContainText("Karttapullautin hela kartan · 1 ruta · Väntar på geo-servern");
  // Grundkartan G1: laserdatan klipps till kartans område med 50 m marginal.
  await expect(laser.getByTestId("map-project-laser-job")).toContainText(/Klippt till området, \d+ × \d+ m/);
  await expect(laser.getByTestId("map-project-laser-job")).toContainText("cliff1 0.95, cliff2 1.7");
  await expect(guide).toHaveAttribute("data-step", "wait");

  // Geo-arbetaren tar jobbet; inga uppgifter till Lantmäteriet följer med till den.
  const worker = await runGeoWorker(baseURL!);
  expect(worker.code, worker.output).toBe(0);
  expect(worker.output).toContain("klart (1 rutor");
  expect(worker.output).not.toContain("hemligt");

  await expect(laser.getByTestId("map-project-laser-job")).toContainText("Klart", { timeout: 30_000 });
  await expect(laser.getByTestId("map-project-laser-job")).toContainText("Bilden är tillagd som underlag.");
  await expect(guide).toHaveAttribute("data-step", "review");
  await expect(laser.getByTestId("map-project-laser-job")).toContainText("Fuktigheten är tillagd som underlag.");
  // Terrängskuggningen, reliefen, fuktdjupet, vegetationsklasserna och bergbilden (för reglagen) ur laserns raster är också underlag.
  await expect(owner.getByTestId("map-project-layer")).toHaveCount(8, { timeout: 20_000 });
  const layers = (await (await owner.request.get(`${api}/layers`)).json() as { layers: { name: string; crs: number; width: number }[] }).layers;
  expect(layers).toEqual(expect.arrayContaining([expect.objectContaining({ name: "Karttapullautin hela kartan", crs: 3006, width: 200 }),
    expect.objectContaining({ name: "Karttapullautin hela kartan – fuktighet", crs: 3006 }),
    expect.objectContaining({ name: "Karttapullautin hela kartan – terrängskuggning", crs: 3006 }),
    expect.objectContaining({ name: "Karttapullautin hela kartan – fuktdjup", crs: 3006 }),
    expect.objectContaining({ name: "Karttapullautin hela kartan – relief", crs: 3006 }),
    expect.objectContaining({ name: "Karttapullautin hela kartan – berg", crs: 3006 })]));
  // Fukt med reglage (ägaren 2026-11-11): fuktdjupet läses i webbläsaren och gränserna ger kandidaterna direkt.
  const depth = owner.getByTestId("map-project-depth");
  await depth.getByText("Fukt med reglage (blött och fuktigt)").click();
  await depth.getByTestId("map-project-depth-run").click();
  // Förvalet (0,3 m och flack mark, Högdalen som facit) ger lite i testrutan; en högre gräns och brantare mark ger blött.
  // De enskilda gränserna ligger under Finjustera (skalan 1–10 står överst, ägaren 2026-11-12).
  await depth.getByText("Finjustera").click();
  await depth.getByTestId("map-project-depth-slope").fill("15");
  await depth.getByTestId("map-project-depth-wet").fill("1.5");
  await expect(depth.getByTestId("map-project-depth-message")).toContainText("ha blött", { timeout: 20_000 });
  const first = await depth.getByTestId("map-project-depth-message").textContent();
  await depth.getByTestId("map-project-depth-wet").fill("0.3");
  await expect(depth.getByTestId("map-project-depth-message")).not.toHaveText(first!, { timeout: 20_000 });
  // Grönt med reglage: stegen ur vegetationsklasserna.
  const green = owner.getByTestId("map-project-green");
  await green.getByText("Grönt med reglage (406, 408, 410)").click();
  await green.getByTestId("map-project-green-run").click();
  await expect(green.getByTestId("map-project-green-message")).toContainText("ha mycket svårlöpt", { timeout: 20_000 });

  // Kurvorna som kandidater.
  await laser.getByRole("button", { name: "Läs in kurvor som kandidater" }).click();
  // Grönt med reglage visar redan sina ytor som kandidater; de byts mot kurvorna.
  await replace();
  await expect(laser.getByTestId("map-project-laser-message")).toHaveText("Kurvor visas som kandidater nedan under Vektorfil.");
  const importer = owner.getByTestId("map-project-import");
  // Testkartans symbolset saknar kurvor, så inga förslag här (förslagen prövas i vector-import.test.ts); lagren syns med namnen.
  await expect(importer.getByTestId("map-project-import-layer")).toHaveCount(2);
  await expect(importer.getByTestId("map-project-import-layer").first()).toContainText("contour");
  await expect(importer.getByLabel("Symbol för contour_index")).toBeAttached();
  await reviewScreenshots(owner, "kartprojekt-laser");
  // Våtmarkerna som kandidater (ersätter kurvorna i importen): sänkan blir blött och fuktigt.
  await laser.getByRole("button", { name: "Läs in våtmarker och fuktstråk som kandidater" }).click();
  await replace();
  await expect(laser.getByTestId("map-project-laser-message")).toHaveText("Våtmarker och fuktstråk visas som kandidater nedan under Vektorfil.");
  await expect(importer.getByTestId("map-project-import-layer").first()).toContainText("blott");
  // Vegetationen: öppen mark i väster och mycket svårlöpt grönt i öster (alla tre gröna nivåerna).
  await laser.getByRole("button", { name: "Läs in vegetationsytor som kandidater" }).click();
  await replace();
  await expect(laser.getByTestId("map-project-laser-message")).toHaveText("Vegetationsytor visas som kandidater nedan under Vektorfil.");
  await expect(importer.getByTestId("map-project-import-layer")).toHaveCount(4);
  await expect(importer.getByTestId("map-project-import-layer").first()).toContainText("oppen_mark");
  // Grundkartan: allt på en gång, med branten som en linje i stället för Karttapullautins streck.
  await laser.getByTestId("map-project-laser-base-map").click();
  await replace();
  await expect(laser.getByTestId("map-project-laser-message")).toContainText("Grundkartan visas som kandidater nedan under Vektorfil.");
  // Skogsstyrelsens hyggen efter ålder (ägaren 2026-11-11): förra årets hygge är färskt, det gamla och det odaterade tas inte med.
  await expect(laser.getByTestId("map-project-laser-message")).toContainText("Hyggen från Skogsstyrelsen: 1 färska, 0 med sly och 0 med ungskog");
  // G8: Lantmäteriets marktäcke (åkern och sankmarken) och OpenStreetMap följer med, laserns öppna mark byter namn när
  // marktäcket finns, den uträknade fuktigheten kommer med (ägaren 2026-11-11: «inga kärr kom med») och tomterna räknas
  // ur husen.
  for (const name of ["contour", "brant_passerbar", "vatten", "aker", "sankmark_vat", "oppen_mark_laser", "blott", "tomtmark", "hygge_farskt", "bestandsgrans"]) {
    await expect(importer.getByTestId("map-project-import-layer").filter({ hasText: name }).first()).toBeAttached();
  }
  // Kandidatlisten under kartan: lagren med antal, och de kan väljas bort innan de läggs in.
  const bar = owner.getByTestId("map-project-candidate-bar");
  await expect(bar).toBeVisible();
  // Antalet beror på hur laserns blöta mark klipps mot åkern (2026-11-13: inga kärr på skött mark), så det läses av.
  const add = bar.getByRole("button", { name: /^Lägg in \d+ objekt i kartan$/ });
  await expect(add).toBeVisible();
  const countOf = async () => Number(/\d+/.exec(await add.textContent() ?? "")?.[0]);
  const before = await countOf();
  expect(before).toBeGreaterThanOrEqual(5);
  await bar.getByRole("checkbox", { name: /^308\.0 Sankmark \(\d+\)$/ }).last().uncheck();
  await expect.poll(countOf).toBeLessThan(before);
  // Skogsstyrelsen (ägaren 2026-11-11): kartbilderna som underlag att tända och släcka, och hyggena med reglage för åldern.
  const forest = owner.getByTestId("map-project-forest-images");
  await forest.getByText("Skogsstyrelsen (underlag)").click();
  await forest.getByTestId("map-project-forest-images-fetch").click();
  await expect(forest.getByTestId("map-project-forest-images-message")).toHaveText("1 underlag är tillagt.", { timeout: 30_000 });
  await expect(owner.getByTestId("map-project-layer").filter({ hasText: "Skogsstyrelsen" })).toHaveCount(1, { timeout: 20_000 });
  const cuts = owner.getByTestId("map-project-cuts");
  await cuts.getByText("Hyggen med reglage").click();
  await cuts.getByTestId("map-project-cuts-fetch").click();
  await expect(cuts.getByTestId("map-project-cuts-message")).toHaveText("1 färska, 0 med sly och 0 med ungskog av 3 hyggen i rutan.", { timeout: 20_000 });
  await cuts.getByText("Finjustera").click();
  await cuts.getByTestId("map-project-cuts-fresh").fill("1");
  await expect(cuts.getByTestId("map-project-cuts-message")).toHaveText("0 färska, 1 med sly och 0 med ungskog av 3 hyggen i rutan.", { timeout: 20_000 });
  await laser.getByRole("button", { name: "Läs in lantmäteriets marktäcke som kandidater" }).click();
  await replace();
  await expect(importer.getByTestId("map-project-import-layer")).toHaveCount(2);
  // Vattnet ur laserns klasser: sjön blir en yta i lagret vatten.
  await laser.getByRole("button", { name: "Läs in sjöar och vatten som kandidater" }).click();
  await replace();
  await expect(laser.getByTestId("map-project-laser-message")).toHaveText("Sjöar och vatten visas som kandidater nedan under Vektorfil.");
  await expect(importer.getByTestId("map-project-import-layer")).toHaveCount(1);
  await expect(importer.getByTestId("map-project-import-layer").first()).toContainText("vatten");

  // G6 (ägaren 2026-11-11: «itereringar … efter första körning»): kör om med samma rutor och område men mindre grönt.
  await laser.getByTestId("map-project-laser-rerun-start").click();
  await expect(laser.getByTestId("map-project-laser-rerun")).toContainText("Kör om Karttapullautin hela kartan med samma rutor och område");
  await expect(laser.getByTestId("map-project-laser-choice-cliffs")).toHaveValue("more");
  await expect(laser.getByTestId("map-project-laser-name")).toHaveValue("Karttapullautin hela kartan (ny)");
  await laser.getByTestId("map-project-laser-choice-green").selectOption("less");
  await laser.getByTestId("map-project-laser-start").click();
  const second = laser.getByTestId("map-project-laser-job").filter({ hasText: "(ny)" });
  await expect(second).toContainText(/Väntar på geo-servern.*Klippt till området/);
  await expect(second).toContainText("greenscale 1.5");
  const again = await runGeoWorker(baseURL!);
  expect(again.code, again.output).toBe(0);
  await expect(second).toContainText("Klart", { timeout: 30_000 });
  await expect(second.getByTestId("map-project-laser-base-map")).toBeVisible();
  // G6 provrutan: samma jobb igen, bara 250 × 250 m i mitten av området (snabbt att jämföra inställningar).
  await second.getByTestId("map-project-laser-rerun-start").click();
  await laser.getByTestId("map-project-laser-sample").selectOption("middle");
  await laser.getByTestId("map-project-laser-start").click();
  const sample = laser.getByTestId("map-project-laser-job").filter({ hasText: "(provruta)" });
  await expect(sample).toContainText(/Klippt till området, (2[0-4]\d|250) × (2[0-4]\d|250) m/);
  const third = await runGeoWorker(baseURL!);
  expect(third.code, third.output).toBe(0);
  await expect(sample).toContainText("Klart", { timeout: 30_000 });

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
