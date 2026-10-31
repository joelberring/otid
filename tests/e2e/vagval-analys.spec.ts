import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { expect, test, type Page } from "@playwright/test";
import { createRace, openStep, publishRace, registerAccount, reviewScreenshots, sendReadout, today, unique, warmRoute } from "./helpers";

/**
 * Steg 60 (ADR-0179 beslut 7–13): vägvalsanalysen. Kartfilen (fixtures/maps/vagval.omap: steg 59:s syntetiska karta med en sjö
 * tvärs över sträckan 31–32) och banfilen (course-file-kartfil.xml) laddas upp; kontrollkartans läge "Vägval" räknar banan i
 * webbläsaren, sträcka för sträcka. Sträckan 31–32 är en vägvalssträcka (norr eller söder om sjön). Inställningarna sparas,
 * bästa vägen publiceras och syns i den publika vägvalskartan först när banorna är publika (ADR-0176).
 */
const fixture = (path: string) => fileURLToPath(new URL(`../../fixtures/${path}`, import.meta.url));
const CONTROLS = [31, 32, 33, 34, 35, 36] as const;

/** Banfilens Position per kontroll (WGS 84), för en påhittad GPS-rutt längs banan. */
function positions(): Map<string, { lat: number; lon: number }> {
  const xml = readFileSync(fixture("iof/course-file-kartfil.xml"), "utf8");
  const found = new Map<string, { lat: number; lon: number }>();
  for (const match of xml.matchAll(/<Id>(\w+)<\/Id>\s*<Position lng="([0-9.]+)" lat="([0-9.]+)"/g)) {
    found.set(match[1]!, { lat: Number(match[3]), lon: Number(match[2]) });
  }
  return found;
}

/** En GPX med en punkt var tionde sekund längs raka linjer mellan start, kontrollerna och mål, en kontroll var femte minut. */
function gpx(startMs: number): Buffer {
  const at = positions();
  const stops = ["S1", ...CONTROLS.map(String), "F1"].map(id => at.get(id)!);
  const points: string[] = [];
  for (let leg = 0; leg < stops.length - 1; leg += 1) {
    const from = stops[leg]!, to = stops[leg + 1]!;
    for (let second = 0; second < 300; second += 10) {
      const share = second / 300;
      points.push(`<trkpt lat="${(from.lat + (to.lat - from.lat) * share).toFixed(7)}" lon="${(from.lon + (to.lon - from.lon) * share).toFixed(7)}">` +
        `<time>${new Date(startMs + (leg * 300 + second) * 1000).toISOString()}</time></trkpt>`);
    }
  }
  const end = stops.at(-1)!;
  points.push(`<trkpt lat="${end.lat}" lon="${end.lon}"><time>${new Date(startMs + (stops.length - 1) * 300_000).toISOString()}</time></trkpt>`);
  return Buffer.from(`<?xml version="1.0" encoding="UTF-8"?><gpx xmlns="http://www.topografix.com/GPX/1/1" version="1.1" creator="O-Tid test">` +
    `<trk><trkseg>${points.join("")}</trkseg></trk></gpx>`);
}

async function importFile(page: Page, raceId: string, path: string) {
  await page.goto(`/admin/${raceId}/imports`);
  await page.getByLabel("IOF XML 3.0").setInputFiles(fixture(path));
  await page.getByRole("button", { name: "Importera", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: "Filen är inläst" })).toBeVisible();
}

test("vägvalsanalys: kartfilen räknas i webbläsaren, en vägvalssträcka, inställningar och bästa vägen publikt efter banhemligheten", async ({ browser }) => {
  test.setTimeout(420_000);
  const suffix = unique();
  const owner = await registerAccount(browser, `vagval.${suffix}@exempel.se`, "Vera Vägval");
  const raceId = await createRace(owner, `Vägval ${suffix}`, today(), "Tävling");
  await publishRace(owner);
  const admin = `/api/admin/races/${raceId}/administrator`;
  for (const path of ["map", "map/image", "map/source", "control-map", "route-choice"]) await warmRoute(owner, `${admin}/${path}`);
  for (const path of ["route-choice/settings", "route-choice/published", "routes"]) await warmRoute(owner, `${admin}/${path}`, "POST");
  await importFile(owner, raceId, "iof/course-file-kartfil.xml");

  // Utan kartfil: en rad om att kartfil behövs, med vägen till Resultat → Karta och vägval.
  await owner.goto(`/admin/${raceId}/manage`);
  await openStep(owner, "Banor");
  await owner.getByRole("button", { name: "Öppna kontrollkartan" }).click();
  let dialog = owner.getByRole("dialog", { name: "Kontrollkarta" });
  await dialog.getByRole("button", { name: "Vägval", exact: true }).click();
  await expect(dialog.getByText(/Vägvalen räknas ur kartfilen/)).toBeVisible();
  await dialog.getByRole("button", { name: "Gå till Karta och vägval" }).click();
  const section = owner.getByRole("region", { name: "Karta och vägval" });
  await expect(section).toBeVisible();

  // Kartfilen med sjön.
  await section.getByLabel("Kartfil (.ocd, .omap eller .xmap, högst 60 MB)").setInputFiles(fixture("maps/vagval.omap"));
  await section.getByRole("button", { name: /Ladda upp kartfil \(OCAD eller Mapper\)|Byt kartfil/ }).click();
  await expect(section.getByText("Kartan är ritad och sparad.")).toBeVisible({ timeout: 60_000 });

  // En löpare med resultat och GPS-rutt, en till anmäld utan resultat (banorna är då hemliga publikt).
  await owner.goto(`/admin/${raceId}/manage`);
  await openStep(owner, "Anmälda");
  for (const [givenName, card] of [["Anna", "8601001"], ["Bo", "8601002"]] as const) {
    const form = owner.locator("form").filter({ has: owner.getByRole("button", { name: "Lägg till", exact: true }) });
    if (!await form.isVisible()) await owner.getByRole("button", { name: "Ny deltagare" }).first().click();
    await form.getByRole("combobox", { name: "Klass" }).selectOption({ label: "H21" });
    await form.getByLabel("Förnamn").fill(givenName);
    await form.getByRole("textbox", { name: "Efternamn" }).fill("Vägval");
    await form.getByLabel("Klubb").fill("OK Vägval");
    await form.getByLabel("Bricka (valfritt)").fill(card);
    await form.getByRole("button", { name: "Lägg till", exact: true }).click();
    await expect(form.getByRole("status")).toContainText(`${givenName} Vägval är anmäld i H21`);
  }
  const start = Math.floor(Date.now() / 1000) * 1000 - 60 * 60_000;
  await sendReadout(owner, raceId, { cardNumber: "8601001", startPunchedAt: new Date(start).toISOString(),
    finishPunchedAt: new Date(start + 7 * 300_000).toISOString(),
    punches: CONTROLS.map((code, index) => ({ code, punchedAt: new Date(start + (index + 1) * 300_000).toISOString() })) });
  await openStep(owner, "Resultat");
  await section.getByRole("combobox", { name: "Löpare", exact: true }).selectOption({ label: "Anna Vägval · H21" });
  await section.getByLabel("GPX-fil").setInputFiles({ name: "anna.gpx", mimeType: "application/gpx+xml", buffer: gpx(start) });
  await section.getByRole("button", { name: "Ladda upp rutt" }).click();
  await expect(section.getByText("Rutten för Anna Vägval är sparad och täcker 7 av 7 sträckor.")).toBeVisible();

  // Kontrollkartan → Vägval: banan räknas sträcka för sträcka.
  await openStep(owner, "Banor");
  await owner.getByRole("button", { name: "Öppna kontrollkartan" }).click();
  dialog = owner.getByRole("dialog", { name: "Kontrollkarta" });
  await dialog.getByRole("button", { name: "Vägval", exact: true }).click();
  await expect(dialog.getByRole("status").filter({ hasText: "Klart: 7 sträckor." })).toBeVisible({ timeout: 120_000 });
  const table = dialog.getByRole("table", { name: "Vägval per sträcka" });
  await expect(table.locator("tbody tr")).toHaveCount(7);
  const lake = table.locator('tr[data-leg="31.1-32.1"]');
  await expect(lake.locator("th")).toHaveText("31–32");
  await expect(lake).toContainText(/Vägvalssträcka|Vägvalen är ungefär lika bra/);
  // Den raka sträckan över öppen skog har inget vägval och bästa vägen är nästan fågelvägen.
  await expect(table.locator('tr[data-leg="34.1-35.1"]')).toContainText("Inget vägval");
  await expect(dialog.getByText(/^Hela banan: bästa vägen .* mot fågelvägen/)).toBeVisible();
  // Vald sträcka på kartan: bästa vägen och stråket på kartbilden.
  await lake.getByRole("button", { name: "Visa 31–32 på kartan" }).click();
  const map = dialog.getByRole("img", { name: "Vägval på sträckan 31–32" });
  await expect(map.locator("image")).toHaveCount(1);
  await expect(map.getByTestId("route-choice-best").locator("polyline").first()).toHaveAttribute("points", /\d/);
  await expect(map.getByTestId("route-choice-corridor")).toHaveAttribute("d", /^M/);
  await expect(map.getByTestId("route-choice-alternative").first()).toBeVisible();
  // Inga interna id i vyn.
  expect(await dialog.innerText()).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-|sha256|IMPASSABLE|ROUTE_CHOICE/);
  await reviewScreenshots(owner, "vagval-analys");

  // Inställningar: sparas och räknas om.
  await dialog.getByText("Inställningar för vägvalen").click();
  await dialog.getByLabel("Ekvidistans (m)").fill("2,5");
  await dialog.getByRole("button", { name: "Spara inställningarna" }).click();
  await expect(dialog.getByText("Inställningarna är sparade.")).toBeVisible();
  await expect(dialog.getByRole("status").filter({ hasText: "Klart: 7 sträckor." })).toBeVisible({ timeout: 120_000 });
  const saved = await owner.request.get(`${admin}/route-choice`);
  expect(((await saved.json()) as { settings: { contourIntervalMeters?: number } }).settings.contourIntervalMeters).toBe(2.5);

  // Publicera bästa vägvalen.
  await dialog.getByRole("button", { name: "Visa bästa vägval publikt" }).click();
  await expect(dialog.getByText("Bästa vägvalen visas publikt när banorna är publika.")).toBeVisible();
  await dialog.getByRole("button", { name: "Stäng" }).click();

  // Publikt: Bo har inget resultat, så banorna är hemliga och linjen visas inte. Arrangören ser den.
  const results = await (await owner.request.get(`/api/public/races/${raceId}/results`)).json() as {
    results: { givenName?: string; publicResultId?: string }[] };
  const annaId = results.results.find(row => row.givenName === "Anna")!.publicResultId!;
  const routeUrl = `/results/${raceId}/routes?runner=${annaId}&leg=31.1-32.1`;
  const visitor = await (await browser.newContext()).newPage();
  await visitor.goto(routeUrl);
  await expect(visitor.getByTestId("selected-route")).toBeVisible();
  await expect(visitor.getByTestId("best-route")).toHaveCount(0);
  const ownerPublic = await owner.context().newPage();
  await ownerPublic.goto(routeUrl);
  await expect(ownerPublic.getByTestId("best-route").locator("polyline").first()).toHaveAttribute("points", /\d/);
  await ownerPublic.close();

  // Banorna publika: besökaren ser "Bästa vägval enligt kartan" bredvid löparens rutt. Kartfilen lämnas aldrig ut.
  await openStep(owner, "Publicera");
  const secrecy = owner.getByRole("region", { name: "Banorna publikt" });
  await secrecy.getByRole("button", { name: "Visa banorna publikt nu" }).click();
  await expect(secrecy).toContainText("Banorna syns publikt");
  await visitor.goto(routeUrl);
  await expect(visitor.getByTestId("best-route").locator("polyline").first()).toHaveAttribute("points", /\d/);
  await expect(visitor.getByText("Bästa vägval enligt kartan")).toBeVisible();
  await reviewScreenshots(visitor, "vagval-publikt");
  expect((await visitor.request.get(`${admin}/map/source`)).status()).toBe(401);
  expect((await visitor.request.get(`${admin}/route-choice`)).status()).toBe(401);

  // Kalibreringen: knappen finns när en löpare med resultat på banan har en rutt; före och efter i en tabell, och "Spara"
  // sparar farterna i inställningarna. Rutterna räknas i webbläsaren.
  await openStep(owner, "Banor");
  await owner.getByRole("button", { name: "Öppna kontrollkartan" }).click();
  dialog = owner.getByRole("dialog", { name: "Kontrollkarta" });
  await dialog.getByRole("button", { name: "Vägval", exact: true }).click();
  await expect(dialog.getByRole("status").filter({ hasText: "Klart: 7 sträckor." })).toBeVisible({ timeout: 120_000 });
  await dialog.getByText("Farterna mot löparnas rutter").click();
  await expect(dialog.getByText("1 löpare med resultat på banan har en uppladdad GPS-rutt.", { exact: false })).toBeVisible();
  await dialog.getByRole("button", { name: "Justera farterna efter de här rutterna" }).click();
  const speeds = dialog.getByRole("table", { name: "Fart mot vanlig skog" });
  await expect(speeds).toBeVisible({ timeout: 60_000 });
  await expect(speeds.getByRole("row", { name: /Vanlig skog/ })).toBeVisible();
  await dialog.getByRole("button", { name: "Spara", exact: true }).click();
  await expect(dialog.getByText("Farterna är sparade.")).toBeVisible();
  const calibrated = await (await owner.request.get(`${admin}/route-choice`)).json() as { settings: { speedByClass?: Record<string, number> } };
  expect(Object.keys(calibrated.settings.speedByClass ?? {})).toContain("NORMAL");
});
