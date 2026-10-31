import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { expect, test, type Page } from "@playwright/test";
import { createRace, openStep, registerAccount, sendReadout, today, unique, warmRoute } from "./helpers";

/**
 * PLAN.md steg 61: gafflingar till start och karta. En gafflad klass importeras och lottas; under Banor står kontrollen
 * före tävlingen. Kartor till starten visar tryckantal per variant med reserv, kartbuntslistan (utskrift och CSV) och
 * baksidorna (en sida per karta, avdelare per variant). Efter utskriften byter en löpare variant och listan säger "1
 * ändring sedan listan skrevs ut". En löpare som stämplat en annan variant får "Fick löparen fel karta?" och godkänns
 * på den varianten från deltagarkortet.
 */
const fixture = (name: string) => fileURLToPath(new URL(`../../fixtures/iof/${name}`, import.meta.url));
const loops = { A: [50, 41, 42], B: [50, 43, 44], C: [60, 61, 62], D: [60, 63, 64] } as const;
function variantCodes(code: string): number[] {
  const first = code[0] as "A" | "B", second = code[1] as "C" | "D";
  return [31, ...loops[first], ...loops[first === "A" ? "B" : "A"], 50, 32, ...loops[second], ...loops[second === "C" ? "D" : "C"], 60, 33];
}

async function importFile(page: Page, name: string, summary: string) {
  await page.getByLabel("IOF XML 3.0").setInputFiles(fixture(name));
  await page.getByRole("button", { name: "Importera", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: "Filen är inläst" })).toContainText(summary);
}

async function api(page: Page, raceId: string, path: string, data?: unknown, headers: Record<string, string> = {}) {
  const origin = new URL(page.url()).origin;
  const csrf = (await page.context().cookies()).find(row => /otid[-_]organizer[-_]csrf$/.test(row.name))?.value ?? "";
  const url = `/api/admin/races/${raceId}/administrator/${path}`;
  const response = data === undefined ? await page.request.get(url)
    : await page.request.post(url, { headers: { origin, "x-otid-csrf": csrf, "content-type": "application/json", ...headers }, data });
  expect(response.status(), path).toBe(200);
  return response.json() as Promise<Record<string, unknown>>;
}

test("kartor till starten: tryckantal, kartbuntslista, baksidor och fel karta", async ({ browser }) => {
  test.setTimeout(300_000);
  const suffix = unique();
  const owner = await registerAccount(browser, `natt.${suffix}@exempel.se`, "Nils Natt");
  await owner.addInitScript(() => { window.print = () => { (window as unknown as { otidPrints: number }).otidPrints =
    ((window as unknown as { otidPrints?: number }).otidPrints ?? 0) + 1; }; });
  const date = today();
  const raceId = await createRace(owner, `Natt ${suffix}`, date, "Tävling med gafflade banor");
  await owner.goto(`/admin/${raceId}/imports`);
  await importFile(owner, "course-data-forked.xml", "2 banor och 2 klasser, 4 varianter");
  await importFile(owner, "entry-list-forked.xml", "7 deltagare");
  await importFile(owner, "course-assignment-forked.xml", "4 löpare fick sin variant");
  const admin = `/api/admin/races/${raceId}/administrator`;
  for (const path of ["courses", "map-bundles", "transfer-candidates"]) await warmRoute(owner, `${admin}/${path}`);
  await warmRoute(owner, `${admin}/map-print`, "POST");

  // Kontrollen före tävlingen: två löpare i H21 saknar variant.
  await owner.goto(`/admin/${raceId}/manage`);
  await openStep(owner, "Banor");
  await expect(owner.getByTestId("forking-readiness").first()).toContainText("2 löpare i H21 saknar variant");

  // Lottning med minutstart och två lediga tider (samma väg som Start → Lottning); löparna utan variant får en.
  const setup = await api(owner, raceId, "draw") as { classes: { id: string; name: string }[] };
  const h21 = setup.classes.find(row => row.name === "H21")!.id;
  const requestId = randomUUID();
  const first = new Date(Math.ceil(Date.now() / 3_600_000) * 3_600_000).toISOString();
  await api(owner, raceId, "draw", { formatVersion: 1, requestId, seed: 61, firstStartTime: first, clubSeparation: false, confirmChanges: true,
    classes: [{ classId: h21, method: "MINUTE", intervalMinutes: 1, vacancies: { kind: "COUNT", value: 2 } }] },
  { "idempotency-key": `start-draw:${requestId}` });

  // Start → Kartor till starten.
  await owner.goto(`/admin/${raceId}/manage`);
  await openStep(owner, "Start");
  await owner.getByRole("link", { name: "Kartor till starten" }).click();
  await owner.waitForURL(`**/admin/${raceId}/maps`);
  await expect(owner.getByRole("heading", { name: "Kartor till starten" })).toBeVisible();

  // Tryckantal: fyra varianter av Lång och en rad för Kort; reserven ställs om till 1 karta per variant.
  const counts = owner.getByRole("table", { name: "Tryckantal per variant" });
  await expect(counts.getByRole("row")).toHaveCount(1 + 5 + 1);
  await owner.getByRole("spinbutton", { name: "Reserv per variant" }).fill("1");
  await owner.getByRole("combobox", { name: "Reserv per variant" }).selectOption("COUNT");
  await owner.getByRole("button", { name: "Spara reserven" }).click();
  await expect(owner.getByText("Reserven är sparad.")).toBeVisible();
  // H21: 6 löpare + 2 lediga tider + 4 reserver; D21 (Kort): 1 löpare + 1 reserv.
  await expect(counts.getByRole("row", { name: /^Totalt/ })).toContainText("14");

  // Kartbuntslistan per starttid, med variantkod; utskriften sparas.
  await owner.getByRole("button", { name: "Kartbuntslista" }).click();
  const list = owner.getByTestId("map-bundle-list");
  await expect(list.getByRole("row", { name: /Cia Holm/ })).toContainText("AD");
  await expect(list.getByText("Ledig tid")).toHaveCount(2);
  await expect(owner.getByText("Inte utskriven än.")).toBeVisible();
  const download = owner.waitForEvent("download");
  await owner.getByRole("button", { name: "Spara som CSV" }).click();
  const csv = await (await (await download).createReadStream()).toArray();
  expect(Buffer.concat(csv).toString("utf8")).toContain("Nr;Starttid;Klass;Bana;Variant;Namn;Klubb");
  await owner.getByRole("button", { name: "Skriv ut", exact: true }).click();
  await expect(owner.getByText(/^Inga ändringar sedan listan skrevs ut \d\d:\d\d\.$/)).toBeVisible();
  await expect.poll(() => owner.evaluate(() => (window as unknown as { otidPrints?: number }).otidPrints ?? 0)).toBe(1);

  // Baksidorna: lika många sidor som tryckantalet, avdelare per variant och provsida.
  await owner.getByRole("button", { name: "Baksidor" }).click();
  await expect(owner.getByTestId("map-back-count")).toHaveText("14 sidor");
  await owner.getByLabel("Papper").selectOption("A3");
  await owner.getByLabel("Textens läge").selectOption("TOP_RIGHT");
  await owner.getByRole("button", { name: "Skriv ut en provsida" }).click();
  await expect.poll(() => owner.evaluate(() => (window as unknown as { otidPrints?: number }).otidPrints ?? 0)).toBe(2);
  await owner.getByRole("button", { name: "Skriv ut baksidorna" }).click();
  const printed = owner.getByTestId("map-back-print");
  await expect(printed.locator('[data-testid="map-back-page"][data-kind="DIVIDER"]')).toHaveCount(5);
  await expect(printed.locator('[data-testid="map-back-page"]:not([data-kind="DIVIDER"])')).toHaveCount(14);
  await expect(printed.locator('[data-testid="map-back-page"][data-kind="RESERVE"]')).toHaveCount(5);
  await expect.poll(() => owner.evaluate(() => (window as unknown as { otidPrints?: number }).otidPrints ?? 0)).toBe(3);

  // Cia byter variant efter utskriften (befintliga variantbytet): listan visar ändringen överst.
  const roster = await api(owner, raceId, "transfer-candidates") as { entries: { id: string; displayName: string; version: number;
    courseVariantCode: string | null; fixedStartTime: string | null; activeAssignment: { cardNumber: string } | null }[] };
  const cia = roster.entries.find(entry => entry.displayName === "Cia Holm")!;
  const changeId = randomUUID();
  await api(owner, raceId, `entries/${cia.id}/variant`, { formatVersion: 1, requestId: changeId, expectedEntryVersion: cia.version,
    entryId: cia.id, variantCode: "BD", confirmResultChanges: false }, { "idempotency-key": `entry-variant:${changeId}` });
  await owner.reload();
  await owner.getByRole("button", { name: "Kartbuntslista" }).click();
  const changes = owner.getByTestId("map-print-changes");
  await expect(changes).toContainText(/1 ändring sedan listan skrevs ut \d\d:\d\d/);
  await expect(changes).toContainText("Cia Holm (H21): AD → BD");

  // Fel karta: Eva har sin variant men stämplar en annan av samma bana.
  const eva = roster.entries.find(entry => entry.displayName === "Eva Sjö")!;
  const other = ["AC", "AD", "BC", "BD"].find(code => code !== eva.courseVariantCode)!;
  const start = Date.parse(eva.fixedStartTime!);
  await sendReadout(owner, raceId, { cardNumber: eva.activeAssignment!.cardNumber, startPunchedAt: new Date(start).toISOString(),
    finishPunchedAt: new Date(start + 40 * 60_000).toISOString(),
    punches: variantCodes(other).map((code, index) => ({ code, punchedAt: new Date(start + (index + 1) * 60_000).toISOString() })) });
  await owner.goto(`/admin/${raceId}/manage`);
  await openStep(owner, "Anmälda");
  await expect(owner.getByRole("row", { name: /Eva Sjö/ }).getByTestId("roster-wrong-map")).toHaveText(`Fel karta? Passar ${other}`);
  const card = owner.getByRole("region", { name: "Deltagarkort" });
  await expect(async () => {
    await owner.getByRole("row", { name: /Eva Sjö/ }).getByRole("cell").nth(1).click();
    await expect(card.getByRole("heading", { name: "Eva Sjö" })).toBeVisible({ timeout: 2_000 });
  }).toPass({ timeout: 30_000 });
  const note = card.getByTestId("wrong-map");
  await expect(note).toContainText(`Felstämplad mot ${eva.courseVariantCode}, men stämplingarna passar ${other}. Fick löparen fel karta?`);
  await note.getByRole("button", { name: `Godkänn på ${other}` }).click();
  // Resultatet ändras: samma besked och bekräftelse som "Byt variant".
  const variant = card.getByRole("region", { name: "Variant", exact: true });
  await expect(variant.getByRole("alert")).toContainText("Eva Sjö: Felstämplad → Godkänd");
  await variant.getByRole("button", { name: `Byt variant ${other}` }).click();
  await expect(owner.getByText(`Varianten är ändrad till ${other}. Resultatet räknades om.`)).toBeVisible();
  await expect(card.getByRole("region", { name: "Resultat", exact: true })).toContainText("Godkänd");
  await expect(card.getByTestId("wrong-map")).toHaveCount(0);
});
