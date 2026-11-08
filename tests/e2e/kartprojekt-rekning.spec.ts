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
  await phone.getByRole("button", { name: "Panel" }).click();
  await expect(recon.getByTestId("recon-track").filter({ hasText: "väntar på nät" })).toHaveCount(1, { timeout: 15_000 });
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
});
