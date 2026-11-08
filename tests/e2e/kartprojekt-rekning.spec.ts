import { readFileSync } from "node:fs";
import { expect, test, type Page, type Route } from "@playwright/test";
import { mapPointToWgs84, readMapFile } from "../../packages/map-file/src";
import { registerAccount, reviewScreenshots, unique, warmRoute } from "./helpers";

/**
 * ADR-0219 tillägget om rekningen (K3): rekning i mobilen. Ett eget projekt från Mapper-fixturen (georefererad, 1:10 000) i
 * 390 px med fejkad position: positionen på kartan, ett spår som spelas in längs stenen (5 m ifrån), statusen som går från ej
 * rekat till passerat, stenen som markeras kollad, en GPX-fil som läses in och ett eget spår som tas bort. Spåren och
 * bekräftelserna finns på servern.
 */
const mapBytes = new Uint8Array(readFileSync(new URL("../../fixtures/maps/kartfil.omap", import.meta.url)));
const parsed = readMapFile(mapBytes, "Rekning.omap");
const georef = parsed.georeference!;
const stone = parsed.objects.find(object => object.kind === "point" && object.at.x === 42 && object.at.y === 61)!;
const wgs = (x: number, y: number) => mapPointToWgs84(georef, { x, y });

async function csrfOf(page: Page): Promise<string> {
  return (await page.context().cookies()).find(row => /otid[-_]organizer[-_]csrf$/.test(row.name))?.value ?? "";
}

async function screenOf(page: Page, point: { x: number; y: number }) {
  const map = page.getByTestId("course-setting-map");
  const box = (await map.boundingBox())!;
  const [cx, cy] = (await map.getAttribute("data-center"))!.split(",").map(Number) as [number, number];
  const px = Number(await map.getAttribute("data-px-per-mm"));
  return { x: box.x + box.width / 2 + (point.x - cx) * px, y: box.y + box.height / 2 - (point.y - cy) * px };
}

type Tracks = { tracks: { trackId: string; name: string; source: string; pointCount: number; endedAt: string | null; own: boolean }[] };

test("kartprojekt: rekning i mobilen med GPS-spår, status, kollat och GPX", async ({ browser, baseURL }) => {
  test.setTimeout(300_000);
  expect(stone).toBeDefined();
  const owner = await registerAccount(browser, `rekar.${unique()}@exempel.se`, "Reka Rekare");
  await warmRoute(owner, "/api/organizer/map-projects/upload", "POST");
  const created = await owner.request.post("/api/organizer/map-projects/upload", { headers: { origin: baseURL!, "x-otid-csrf": await csrfOf(owner),
    "content-type": "application/octet-stream", "x-otid-request-id": crypto.randomUUID(), "x-otid-name": "Rekning", "x-otid-file-name": "Rekning.omap" },
    data: Buffer.from(mapBytes) });
  expect(created.status(), await created.text()).toBe(201);
  const projectId = (await created.json() as { projectId: string }).projectId;
  const api = `/api/organizer/map-projects/${projectId}`;
  for (const path of ["tracks", "checks"]) await warmRoute(owner, `${api}/${path}`);

  // Telefonen: samma inloggning, pekskärm och position.
  const start = wgs(30, 60.5);
  const context = await browser.newContext({ storageState: await owner.context().storageState(), viewport: { width: 390, height: 844 },
    hasTouch: true, isMobile: true, geolocation: { ...start, accuracy: 5 }, permissions: ["geolocation"] });
  const phone = await context.newPage();
  await phone.goto(`/organizer/map-projects/${projectId}/map`);
  const map = phone.getByTestId("course-setting-map");
  await expect(map).toHaveAttribute("data-drawn", "true", { timeout: 60_000 });

  // Menyerna tar lite plats: verktygen på en rad.
  const toolbar = phone.getByRole("toolbar");
  expect((await toolbar.boundingBox())!.height).toBeLessThan(60);

  // Positionen: ett tryck visar den på kartan.
  await phone.getByTestId("field-position").click();
  await expect(phone.getByTestId("field-position")).toHaveAttribute("aria-pressed", "true");
  await expect(map).toHaveAttribute("data-position", "", { timeout: 15_000 });

  // Statuslagret: allt är ej rekat.
  await phone.getByRole("button", { name: "Panel" }).click();
  const recon = phone.getByTestId("map-project-recon");
  await recon.getByTestId("recon-layer-STATUS").check();
  await expect(recon.getByTestId("recon-counts")).toContainText("0 passerade", { timeout: 20_000 });
  await phone.getByRole("button", { name: "Panel" }).click();

  // Spela in längs stenen (5 m söder om den), en punkt i taget.
  await phone.getByTestId("field-record").click();
  await expect(phone.getByTestId("field-record")).toHaveAttribute("aria-pressed", "true");
  for (let x = 30; x <= 54; x += 0.5) {
    await context.setGeolocation({ ...wgs(x, 60.5), accuracy: 5 });
    await phone.waitForTimeout(60);
  }
  await phone.getByTestId("field-record").click();
  await expect(phone.getByTestId("field-record")).toHaveAttribute("aria-pressed", "false");
  await expect.poll(async () => {
    const listed = await (await phone.request.get(`${api}/tracks`)).json() as Tracks;
    return listed.tracks.map(track => [track.source, !!track.endedAt, track.pointCount > 1]);
  }, { timeout: 30_000 }).toEqual([["FIELD", true, true]]);

  // Stenen är passerad.
  await phone.getByRole("button", { name: "Panel" }).click();
  await expect(recon.getByTestId("recon-counts")).not.toContainText(" 0 passerade", { timeout: 20_000 });
  await expect(recon.getByTestId("recon-track")).toHaveCount(1);
  await phone.getByRole("button", { name: "Panel" }).click();
  await reviewScreenshots(phone, "kartprojekt-rekning", [390]);
  await phone.setViewportSize({ width: 390, height: 844 });

  // Markera stenen kollad.
  await phone.getByTestId("field-position").click();
  await phone.getByTestId("field-position").click();
  const at = await screenOf(phone, stone.kind === "point" ? stone.at : { x: 0, y: 0 });
  await phone.mouse.click(at.x, at.y);
  await expect(phone.getByTestId("recon-check")).toBeVisible({ timeout: 10_000 });
  await phone.getByTestId("recon-check").click();
  await expect(phone.getByTestId("recon-check")).toHaveAttribute("aria-pressed", "true", { timeout: 15_000 });
  const checks = await (await phone.request.get(`${api}/checks`)).json() as { checks: { key: string; basis: string | null }[] };
  expect(checks.checks).toHaveLength(1);
  expect(checks.checks[0]!.basis).toBeNull();

  // En notis vid positionen med foto; den syns på kartan och markeras klar.
  await phone.getByTestId("field-position").click();
  await expect(phone.getByTestId("field-note-here")).toBeVisible({ timeout: 15_000 });
  await phone.getByTestId("field-note-here").click();
  const form = phone.getByTestId("map-project-note-form");
  await form.getByRole("textbox").fill("Stigen saknas här");
  await form.getByTestId("map-project-note-photo").setInputFiles(new URL("../../fixtures/maps/strackanalys.png", import.meta.url).pathname);
  await expect(form.getByText("Foto bifogat")).toBeVisible({ timeout: 15_000 });
  await form.getByTestId("map-project-note-save").click();
  await expect(form).toHaveCount(0);
  type Notes = { notes: { noteId: string; text: string; status: string; photo: { mediaType: string } | null }[] };
  await expect.poll(async () => ((await (await phone.request.get(`${api}/notes`)).json()) as Notes).notes.map(note => [note.text, note.photo?.mediaType]),
    { timeout: 20_000 }).toEqual([["Stigen saknas här", "image/jpeg"]]);
  await phone.getByTestId("field-position").click();
  await phone.getByRole("button", { name: "Panel" }).click();
  await phone.getByTestId("map-project-notes").getByRole("button", { name: "Visa" }).click();
  const note = phone.getByTestId("map-project-note");
  await expect(note).toContainText("Stigen saknas här");
  await expect(note.locator("img")).toBeVisible();
  await note.getByTestId("map-project-note-status").click();
  await expect(note).toHaveAttribute("data-status", "DONE", { timeout: 15_000 });
  await note.getByRole("button", { name: "Stäng" }).click();

  // En GPX-fil från klockan.
  const gpx = `<?xml version="1.0"?><gpx version="1.1" creator="Klocka"><trk><name>Klockans runda</name><trkseg>${
    [[10, 10], [20, 20], [30, 15]].map(([x, y], index) => { const p = wgs(x!, y!);
      return `<trkpt lat="${p.latitude}" lon="${p.longitude}"><time>2026-11-08T08:0${index}:00Z</time></trkpt>`; }).join("")}</trkseg></trk></gpx>`;
  await phone.getByRole("button", { name: "Panel" }).click();
  await recon.getByTestId("recon-gpx").setInputFiles({ name: "runda.gpx", mimeType: "application/gpx+xml", buffer: Buffer.from(gpx) });
  await expect.poll(async () => ((await (await phone.request.get(`${api}/tracks`)).json()) as Tracks).tracks.map(track => track.name).sort(),
    { timeout: 30_000 }).toEqual(["Klockans runda", expect.stringMatching(/^Rekning /)]);
  await expect(recon.getByTestId("recon-track")).toHaveCount(2, { timeout: 20_000 });

  // Ta bort GPX-spåret (eget).
  phone.once("dialog", dialog => void dialog.accept());
  await recon.getByTestId("recon-track").filter({ hasText: "Klockans runda" }).getByRole("button", { name: "Ta bort" }).click();
  await expect(recon.getByTestId("recon-track")).toHaveCount(1, { timeout: 20_000 });
  expect(((await (await phone.request.get(`${api}/tracks`)).json()) as Tracks).tracks.map(track => track.name)).toEqual([expect.stringMatching(/^Rekning /)]);
  await reviewScreenshots(phone, "kartprojekt-rekning-panel", [390]);
  await phone.setViewportSize({ width: 390, height: 844 });

  // Sidan är sparad för offline; service workern gäller bara projektets karta.
  const scopes = await phone.evaluate(async id => ({
    own: (await navigator.serviceWorker.getRegistration(`/organizer/map-projects/${id}/map`))?.scope ?? null,
    page: (await navigator.serviceWorker.getRegistration(`/organizer/map-projects/${id}`))?.scope ?? null
  }), projectId);
  expect(scopes.own).toMatch(new RegExp(`/organizer/map-projects/${projectId}/map$`));
  expect(scopes.page).toBeNull();

  // Utan nät: ett spår spelas in och väntar i telefonen; med nät skickas det.
  const noNetwork = (route: Route) => route.abort("internetdisconnected");
  await context.setOffline(true);
  await context.route("**/*", noNetwork);
  // Panelen är öppen sedan GPX-filen.
  await phone.getByRole("button", { name: "Panel" }).click();
  await phone.getByTestId("field-record").click();
  for (let y = 40; y <= 50; y += 1) {
    await context.setGeolocation({ ...wgs(80, y), accuracy: 5 });
    await phone.waitForTimeout(60);
  }
  await phone.getByTestId("field-record").click();
  // En notis utan nät med verktyget Notis (tryck på kartan).
  await phone.getByTestId("map-project-note-tool").click();
  const spot = await screenOf(phone, { x: 70, y: 30 });
  await phone.mouse.click(spot.x, spot.y);
  await phone.getByTestId("map-project-note-form").getByRole("textbox").fill("Nytt hygge");
  await phone.getByTestId("map-project-note-save").click();
  await phone.getByRole("button", { name: "Panel" }).click();
  await expect(recon.getByTestId("recon-track").filter({ hasText: "väntar på nät" })).toHaveCount(1, { timeout: 15_000 });
  await expect(phone.getByTestId("map-project-note-row").filter({ hasText: "Nytt hygge" })).toContainText("väntar på nät");
  if (process.env.E2E_BASE_URL) {
    // Omladdning utan nät mot driftbygget: kartan och projektet från telefonen.
    await phone.reload();
    await expect(phone.getByTestId("map-project-offline")).toBeVisible({ timeout: 30_000 });
    await expect(phone.getByTestId("course-setting-map")).toHaveAttribute("data-drawn", "true", { timeout: 30_000 });
  } else test.info().annotations.push({ type: "utan nät", description: "Omladdningen utan nät provas mot driftbygget (E2E_BASE_URL)" });
  await context.unroute("**/*", noNetwork);
  await context.setOffline(false);
  await phone.evaluate(() => window.dispatchEvent(new Event("online")));
  await expect.poll(async () => ((await (await phone.request.get(`${api}/tracks`)).json()) as Tracks).tracks.length, { timeout: 30_000 }).toBe(2);
  await expect.poll(async () => ((await (await phone.request.get(`${api}/notes`)).json()) as { notes: { text: string }[] }).notes.map(row => row.text).sort(),
    { timeout: 30_000 }).toEqual(["Nytt hygge", "Stigen saknas här"]);
});

/** ADR-0219 K3b: den egna statistiken och den frivilliga topplistan (av från början, ägarna slår på, var och en väljer att synas). */
test("kartprojekt: statistik och frivillig topplista", async ({ browser, baseURL }) => {
  test.setTimeout(180_000);
  const owner = await registerAccount(browser, `topp.${unique()}@exempel.se`, "Toppa Listsson");
  await warmRoute(owner, "/api/organizer/map-projects/upload", "POST");
  const created = await owner.request.post("/api/organizer/map-projects/upload", { headers: { origin: baseURL!, "x-otid-csrf": await csrfOf(owner),
    "content-type": "application/octet-stream", "x-otid-request-id": crypto.randomUUID(), "x-otid-name": "Topplista", "x-otid-file-name": "Topplista.omap" },
    data: Buffer.from(mapBytes) });
  expect(created.status()).toBe(201);
  const projectId = (await created.json() as { projectId: string }).projectId;
  const api = `/api/organizer/map-projects/${projectId}`;
  // En ny punkt (synken) och en bekräftelse.
  const sync = await owner.request.post(`${api}/sync`, { headers: { origin: baseURL!, "x-otid-csrf": await csrfOf(owner), "content-type": "application/json" },
    data: { formatVersion: 1, clientId: "e2e", since: 0, edits: [{ editId: crypto.randomUUID(), key: `n:${crypto.randomUUID()}`, ref: null, base: null,
      state: { kind: "OBJECT", object: { kind: "point", symbol: stone.symbol, at: { x: 50, y: 50 }, angle: 0 } }, kind: "ADD", at: new Date().toISOString() }] } });
  expect(sync.status()).toBe(200);
  await warmRoute(owner, `${api}/stats`);
  await warmRoute(owner, "/api/account/map-stats");

  await owner.goto(`/organizer/map-projects/${projectId}`);
  const section = owner.getByTestId("map-project-stats");
  await expect(section.getByTestId("map-stats-mine")).toContainText("1 nytt objekt", { timeout: 30_000 });
  await expect(section).toContainText("Topplistan är av i det här projektet.");
  await section.getByTestId("map-stats-setting").selectOption("FIRST");
  await expect(section).toContainText("Ingen har valt att synas än.", { timeout: 15_000 });
  await section.getByTestId("map-stats-opt-in").check();
  await expect(section.getByTestId("map-stats-leaderboard")).toContainText("Du", { timeout: 15_000 });
  await reviewScreenshots(owner, "kartprojekt-statistik");

  // Den egna statistiken på listan över kartprojekten.
  await owner.goto("/organizer/map-projects");
  await expect(owner.getByTestId("my-map-stats-total")).toContainText("1 nytt objekt", { timeout: 30_000 });
  await expect(owner.getByTestId("my-map-stats").getByTestId("map-stats-opt-in")).toBeChecked();
});
