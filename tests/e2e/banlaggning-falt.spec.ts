import { fileURLToPath } from "node:url";
import { expect, test, type Locator, type Page, type Route } from "@playwright/test";
import { mapPointToWgs84 } from "../../packages/map-file/src/georef";
import type { MapGeoreference } from "../../packages/map-file/src/model";
import { addPerson, createRace, registerAccount, today, unique, warmCourseSetting } from "./helpers";

/** Telefonens rad är kompakt: Lista, Offline och Notis utan vald kontroll ligger bakom "Mer" (⋯). */
async function openMore(page: Page) {
  const more = page.getByTestId("course-setting-field-more");
  if (await more.getAttribute("aria-expanded") !== "true") await more.click();
}

/**
 * Steg 67 (ADR-0181 beslut 6–7): fältläget på en telefon (390 × 844, fejkad position). Kolla en kontroll och se den i
 * listan, notis med foto (filväljaren med en testbild), "Spara kartan för offline", och utan nät: flytta en kontroll,
 * skriv en notis och bocka en kontroll, se "väntar", ladda om utan nät (editorn och kartan från telefonen), nätet tillbaka
 * och allt sparat och synligt hos en annan användare (bankontrollanten, som läser och kommenterar).
 */
const fixture = (path: string) => fileURLToPath(new URL(`../../fixtures/${path}`, import.meta.url));
const georeference: MapGeoreference = { scale: 10000, crs: { kind: "EPSG", code: 3006 }, refPoint: { easting: 675000, northing: 6580000 },
  mapRefPoint: { x: 0, y: 0 }, grivationDegrees: 0, combinedScaleFactor: 1 };

type Document = { controls: Record<string, { kind: string; code?: string; at: { x: number; y: number } }> };
type Inspections = { inspections: { control: string; checkedBy: { displayName: string | null } }[] };
type Notes = { notes: { text: string; target: { kind: string; control?: string }; photo: { mediaType: string } | null; createdBy: { displayName: string | null } }[] };

async function screenOf(map: Locator, x: number, y: number) {
  const box = (await map.boundingBox())!;
  const [centerX, centerY] = (await map.getAttribute("data-center"))!.split(",").map(Number) as [number, number];
  const scale = Number(await map.getAttribute("data-px-per-mm"));
  return { x: box.x + box.width / 2 + (x - centerX) * scale, y: box.y + box.height / 2 - (y - centerY) * scale };
}

async function screenshot(page: Page, name: string) {
  const directory = process.env.E2E_SCREENSHOT_DIR;
  if (directory) await page.screenshot({ path: `${directory}/${name}.png` });
}

async function tapControl(page: Page, x: number, y: number, label: string) {
  const map = page.getByTestId("course-setting-map");
  const at = await screenOf(map, x, y);
  await page.touchscreen.tap(at.x, at.y);
  await expect(page.getByTestId("course-setting-field-selected")).toHaveText(`Vald: kontroll ${label}`);
}

test("fältläget: kollad, notis med foto och ändringar utan nät som sparas när nätet kommer tillbaka", async ({ browser }) => {
  test.setTimeout(420_000);
  const suffix = unique();
  const owner = await registerAccount(browser, `falt.${suffix}@exempel.se`, "Bea Banläggare");
  const raceId = await createRace(owner, `Fältläge ${suffix}`, today(), "Tävling");
  const admin = `/api/admin/races/${raceId}/administrator`;
  await warmCourseSetting(owner, raceId);
  await owner.goto(`/admin/${raceId}/course-setting`);
  await owner.getByLabel("Kartfil (.ocd, .omap eller .xmap, högst 75 MB)").setInputFiles(fixture("maps/kartfil.omap"));
  await owner.getByRole("button", { name: "Ladda upp kartfil (OCAD eller Mapper)" }).click();
  await expect(owner.getByRole("heading", { name: "Ingen banläggning än" })).toBeVisible({ timeout: 60_000 });
  await owner.getByLabel("Purple Pen-fil (.ppen)").setInputFiles(fixture("course-setting/kartfil.ppen"));
  await owner.getByRole("button", { name: "Läs in .ppen" }).click();
  await expect(owner.getByText(/Inläst: 2 banor och 9 kontroller\./)).toBeVisible({ timeout: 30_000 });

  // Bankontrollanten läser och kommenterar (en annan användare).
  const kimEmail = `kim.${suffix}@exempel.se`;
  const kim = await registerAccount(browser, kimEmail, "Kim Kontrollant");
  const manage = await owner.context().newPage();
  await manage.goto(`/admin/${raceId}/manage`);
  await addPerson(manage, kimEmail, "Banläggning: läsa och kommentera");
  await manage.close();

  // Telefonen: ägaren, position vid (60, 50) mm med ±6 m.
  const wgs = mapPointToWgs84(georeference, { x: 60, y: 50 });
  const phoneContext = await browser.newContext({ storageState: await owner.context().storageState(), viewport: { width: 390, height: 844 },
    hasTouch: true, isMobile: true, geolocation: { latitude: wgs.latitude, longitude: wgs.longitude, accuracy: 6 }, permissions: ["geolocation"] });
  const phone = await phoneContext.newPage();
  await phone.goto(`/admin/${raceId}/course-setting`);
  const map = phone.getByTestId("course-setting-map");
  await expect(phone.getByTestId("course-setting-field")).toBeVisible({ timeout: 30_000 });
  await expect(phone.getByText("Läser kartfilen …")).toHaveCount(0, { timeout: 90_000 });
  await expect(map).toHaveAttribute("data-px-per-mm", /\d/);
  await phone.getByTestId("course-setting-field-course").selectOption({ label: "Lång" });
  await phone.getByRole("button", { name: "Visa hela kartan" }).click();
  await phone.waitForTimeout(400);
  const status = phone.getByTestId("course-setting-field-status");

  // 1. Kollad: kontroll 32, och den syns i listan (inte under "Ej kollade").
  await tapControl(phone, 42, 61, "32");
  await phone.getByTestId("course-setting-inspect").click();
  await expect(phone.getByTestId("course-setting-inspect")).toHaveAttribute("aria-pressed", "true");
  await expect(phone.getByTestId("course-setting-inspected-by")).toContainText("Kollad av Bea Banläggare");
  await expect.poll(async () => ((await (await phone.request.get(`${admin}/course-setting/inspections`)).json()) as Inspections).inspections.length)
    .toBe(1);
  await screenshot(phone, "falt-kollad");
  await openMore(phone);
  await phone.getByRole("button", { name: "Lista", exact: true }).click();
  const list = phone.getByTestId("course-setting-inspections");
  await expect(list).toBeVisible();
  await expect(list).toContainText("1 av 6 kollade");
  await expect(list.getByRole("button", { name: /^32 / })).toHaveCount(0);
  await expect(list.getByRole("button", { name: /^33 Ej kollad/ })).toBeVisible();
  await screenshot(phone, "falt-lista-ej-kollade");
  await list.getByRole("button", { name: "Alla" }).click();
  await expect(list.getByRole("button", { name: /^32 ✓ Kollad av Bea Banläggare/ })).toBeVisible();
  await screenshot(phone, "falt-lista-alla");
  await phone.locator('button[aria-expanded="true"][aria-label="Fäll ihop panelerna"]').click();

  // 2. Notis med foto vid vald kontroll: knappen öppnar kameran (filväljaren) direkt.
  const chooser = phone.waitForEvent("filechooser");
  if (!(await phone.getByTestId("course-setting-note-here-button").isVisible())) await openMore(phone);
  await phone.getByTestId("course-setting-note-here-button").click();
  await (await chooser).setFiles(fixture("maps/strackanalys.png"));
  const sheet = phone.getByTestId("course-setting-note-here");
  await expect(sheet.getByText("Foto bifogat")).toBeVisible();
  await expect(sheet).toContainText("Notis: kontroll 32");
  await sheet.getByLabel("Text (valfritt med foto)").fill("Flaggan på norra sidan");
  await screenshot(phone, "falt-notis-foto");
  await sheet.getByRole("button", { name: "Spara notisen" }).click();
  await expect(sheet).toHaveCount(0);
  await expect.poll(async () => ((await (await phone.request.get(`${admin}/course-setting/notes`)).json()) as Notes).notes
    .map(note => [note.text, note.target.kind, note.photo?.mediaType ?? null])).toEqual([["Flaggan på norra sidan", "CONTROL", "image/jpeg"]]);

  // 3. Spara kartan och sidan för offline; service workern gäller bara banläggningen.
  await openMore(phone);
  await phone.getByRole("button", { name: "Offline", exact: true }).click();
  const dialog = phone.getByRole("dialog", { name: "Utan nät" });
  await dialog.getByRole("button", { name: /^Spara kartan för offline \(\d+ kB\)$/ }).click();
  await expect(dialog.getByTestId("course-setting-offline-saved")).toContainText("Sparad i telefonen", { timeout: 30_000 });
  await expect(dialog.getByRole("status")).toHaveCount(0);
  await screenshot(phone, "falt-offline-sparad");
  const scopes = await phone.evaluate(async id => ({
    own: (await navigator.serviceWorker.getRegistration(`/admin/${id}/course-setting`))?.scope ?? null,
    manage: (await navigator.serviceWorker.getRegistration(`/admin/${id}/manage`))?.scope ?? null,
    readout: (await navigator.serviceWorker.getRegistration("/readout/"))?.scope ?? null,
    results: (await navigator.serviceWorker.getRegistration("/results"))?.scope ?? null
  }), raceId);
  expect(scopes.own).toMatch(new RegExp(`/admin/${raceId}/course-setting$`));
  expect([scopes.manage, scopes.readout, scopes.results]).toEqual([null, null, null]);
  await dialog.getByRole("button", { name: "Stäng" }).click();

  // 4. Utan nät: flytta 33 en meter österut, kolla 33 och skriv en notis vid positionen (utan foto).
  // `setOffline` gäller inte service workerns egna anrop i Chromium, så nätet stängs också för dem (routen gäller båda).
  const noNetwork = (route: Route) => route.abort("internetdisconnected");
  await phoneContext.setOffline(true);
  await phoneContext.route("**/*", noNetwork);
  await tapControl(phone, 76, 52, "33");
  await phone.getByRole("button", { name: "Flytta 1 m österut" }).click();
  await phone.getByTestId("course-setting-inspect").click();
  await expect(phone.getByTestId("course-setting-inspected-by")).toContainText("väntar på nät");
  // Positionen med noggrannheten (GPS fungerar utan nät).
  await phone.getByRole("button", { name: "Min position" }).click();
  await expect(phone.getByTestId("course-setting-position-info")).toHaveText("Position ±6 m", { timeout: 15_000 });
  // Kompassen (Android: absolut riktning moturs) ger konen; sämre än 15 m ger en varning.
  await phone.evaluate(() => window.dispatchEvent(Object.assign(new Event("deviceorientationabsolute"), { alpha: 90, absolute: true })));
  await expect(map).toHaveAttribute("data-heading", "270");
  await phoneContext.setGeolocation({ latitude: wgs.latitude, longitude: wgs.longitude, accuracy: 25 });
  await expect(phone.getByTestId("course-setting-position-info")).toHaveText(/^Position ±25 m – osäker/, { timeout: 15_000 });
  await screenshot(phone, "falt-kompass-osaker");
  await phoneContext.setGeolocation({ latitude: wgs.latitude, longitude: wgs.longitude, accuracy: 6 });
  // Följ: ett tryck till håller positionen i mitten; att dra kartan släpper.
  await phone.getByRole("button", { name: "Min position" }).click();
  await expect(map).toHaveAttribute("data-follow", "true");
  const drag = await screenOf(map, 20, 90);
  await phone.mouse.move(drag.x, drag.y); await phone.mouse.down(); await phone.mouse.move(drag.x + 40, drag.y + 40, { steps: 4 }); await phone.mouse.up();
  await expect(map).not.toHaveAttribute("data-follow", "true");
  // Notisen vid kontroll 33; kameran avbryts och texten räcker.
  const offlineChooser = phone.waitForEvent("filechooser");
  if (!(await phone.getByTestId("course-setting-note-here-button").isVisible())) await openMore(phone);
  await phone.getByTestId("course-setting-note-here-button").click();
  await (await offlineChooser).setFiles([]);
  await sheet.getByLabel("Text (valfritt med foto)").fill("Snitseln saknas vid stigen");
  await sheet.getByRole("button", { name: "Spara notisen" }).click();
  await expect(phone.getByTestId("course-setting-field-note")).toHaveText("Notisen är sparad i telefonen och skickas när nätet finns.");
  await expect(status).toHaveText("Utan nät – 3 ändringar väntar", { timeout: 15_000 });
  await screenshot(phone, "falt-utan-nat");

  // 5. Omladdning utan nät: sidan, editorn och kartan från telefonen; ändringarna väntar kvar. Provas mot driftbygget
  // (E2E_BASE_URL, som i CI): utvecklingsserverns filer är inte byggda för att gå utan nät (Next: "Dev mode is not a
  // reliable reference for offline behavior"), där startar sidan aldrig från service workern.
  if (process.env.E2E_BASE_URL) {
    await phone.waitForTimeout(600);
    await phone.reload();
    await expect(phone.getByText(/Utan nät: banläggningen från telefonen/)).toBeVisible({ timeout: 30_000 });
    await expect(phone.getByTestId("course-setting-field")).toBeVisible();
    await expect(phone.getByText("Läser kartfilen …")).toHaveCount(0, { timeout: 30_000 });
    await expect(phone.getByText(/Kartfilen kunde inte läsas/)).toHaveCount(0);
    await expect(map).toHaveAttribute("data-px-per-mm", /\d/);
    await expect(status).toHaveText("Utan nät – 3 ändringar väntar", { timeout: 15_000 });
    await phone.waitForTimeout(500);
    await screenshot(phone, "falt-omladdad-utan-nat");
    // Bockarna från servern (sparade i telefonen) och den som väntar syns i listan utan nät.
    await openMore(phone);
  await phone.getByRole("button", { name: "Lista", exact: true }).click();
    await expect(list).toContainText("2 av 7 kollade");
    await list.getByRole("button", { name: "Alla" }).click();
    await expect(list.getByRole("button", { name: /^32 ✓ Kollad av Bea Banläggare/ })).toBeVisible();
    await expect(list.getByRole("button", { name: /^33 ✓ .*\(väntar på nät\)/ })).toBeVisible();
    await screenshot(phone, "falt-lista-utan-nat");
    await phone.locator('button[aria-expanded="true"][aria-label="Fäll ihop panelerna"]').click();
  } else test.info().annotations.push({ type: "utan nät", description: "Omladdningen utan nät provas mot driftbygget (E2E_BASE_URL)" });

  // 6. Nätet tillbaka: allt skickas och sparas.
  await phoneContext.unroute("**/*", noNetwork);
  await phoneContext.setOffline(false);
  await expect(status).toHaveText("Sparat", { timeout: 30_000 });
  await expect(phone.getByText(/^Nätet är tillbaka: /)).toBeVisible();
  await screenshot(phone, "falt-natet-tillbaka");
  const document = ((await (await phone.request.get(`${admin}/course-setting`)).json()) as { setting: { document: Document } }).setting.document;
  const c33 = Object.values(document.controls).find(control => control.code === "33")!;
  expect(c33.at.x).toBeCloseTo(76.1, 2);
  expect(c33.at.y).toBeCloseTo(52, 2);

  // 7. Hos bankontrollanten: flytten, notiserna och bockarna.
  await kim.goto(`/admin/${raceId}/course-setting`);
  await expect(kim.getByTestId("course-setting-map")).toBeVisible({ timeout: 30_000 });
  await expect(kim.getByText("Läser kartfilen …")).toHaveCount(0, { timeout: 30_000 });
  await kim.getByRole("tab", { name: /Notiser/ }).click();
  const notes = kim.getByTestId("course-setting-notes");
  await notes.getByRole("button", { name: "Alla" }).click();
  await expect(notes).toContainText("Flaggan på norra sidan");
  await expect(notes).toContainText("Snitseln saknas vid stigen");
  await kim.getByRole("tab", { name: /Kollat/ }).click();
  const kimList = kim.getByTestId("course-setting-inspections");
  await expect(kimList).toContainText("2 av 7 kollade");
  await kimList.getByRole("button", { name: "Alla" }).click();
  await expect(kimList.getByRole("button", { name: /^33 ✓ Kollad av Bea Banläggare/ })).toBeVisible();
  // Bankontrollanten bockar 31; telefonen ser det via strömmen.
  await kimList.getByRole("button", { name: /^31 / }).click();
  // ADR-0188: på datorn utanför fältläget bockas kontrollen i fliken Kollat.
  await expect(kim.getByTestId("course-setting-inspect")).toHaveCount(0);
  await kim.getByTestId("course-setting-inspect-selected").click();
  await expect(kim.getByTestId("course-setting-inspected-by")).toContainText("Kollad av Kim Kontrollant");
  await screenshot(kim, "falt-kontrollant");
  await expect.poll(async () => ((await (await phone.request.get(`${admin}/course-setting/inspections`)).json()) as Inspections).inspections
    .map(row => row.checkedBy.displayName).sort()).toEqual(["Bea Banläggare", "Bea Banläggare", "Kim Kontrollant"]);
  // Telefonen får bocken via strömmen.
  await openMore(phone);
  await phone.getByRole("button", { name: "Lista", exact: true }).click();
  await expect(list).toContainText(/3 av [67] kollade/);
  const savedNotes = ((await (await phone.request.get(`${admin}/course-setting/notes`)).json()) as Notes).notes;
  expect(savedNotes.find(note => note.text === "Snitseln saknas vid stigen")?.target).toMatchObject({ kind: "CONTROL" });
  await phoneContext.close();
});
