import { createHash } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import { buildOcd, concat, element, ocdCoord, symbolBody } from "../../packages/map-file/test/ocd-builder";
import { registerAccount, reviewScreenshots, unique, warmRoute } from "./helpers";

/**
 * ADR-0210: dubbletter och versioner av klubbarkivets kartor. Klubben har importerat tre filer av samma påhittade karta under
 * olika namn (två är revideringar med fler stenar) och en annan karta. Förslaget visar de tre; de slås ihop till en karta med
 * tre versioner och år, kartritaren kopieras till alla versioner och sammanslagningen ångras. Sist får en ny träning kartan
 * med "Välj karta från klubbarkivet". Allt är syntetiskt och byggs när testet körs.
 */
const sha = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

const COLORS = [
  { type: 9, value: "Violett\tn11\tc30\tm100\ty0\tk0\to1" },
  { type: 9, value: "Svart\tn0\tc0\tm0\ty0\tk100\to0" },
  { type: 9, value: "Brun\tn2\tc0\tm56\ty100\tk18\to0" },
  { type: 9, value: "Blå\tn3\tc100\tm0\ty0\tk0\to0" },
  { type: 9, value: "Grön\tn5\tc76\tm0\ty91\tk0\to0" },
  { type: 9, value: "Gul\tn4\tc0\tm27\ty79\tk0\to0" }
];

/** En liten skogskarta (120 × 80 mm i 1:10 000), georefererad i SWEREF 99 TM vid `easting`; `stones` stenar till. */
function forestMap(easting: number, stones: number): Uint8Array {
  const rect = (x0: number, y0: number, x1: number, y1: number) => [ocdCoord(x0, y0), ocdCoord(x1, y0), ocdCoord(x1, y1), ocdCoord(x0, y1)];
  const area = (number: number, color: number) => ({ number, type: 3, body: symbolBody(40, { 800: color }, view => view.setUint8(814 - 796, 1)) });
  const curve = (y: number) => [ocdCoord(500, y), ocdCoord(4000, y + 900, 1), ocdCoord(8000, y - 900, 2), ocdCoord(11500, y)];
  const stone = (() => { const dot = element(4, 0, 0, 60, [ocdCoord(0, 0)]); return concat(symbolBody(4, { 796: dot.length / 8 }), dot); })();
  return buildOcd({
    version: 11, subversion: 2, encoding: "WINDOWS_1252",
    strings: [...COLORS, { type: 1039, value: `\tm10000\tg50\tr1\tx${easting}\ty6574000\ta0\td100\ti13002` }],
    symbols: [area(401000, 4), area(406000, 5), area(301000, 3), { number: 101000, type: 2, body: symbolBody(80, { 796: 2, 798: 14, 800: 1 }) },
      { number: 206000, type: 1, body: stone }],
    objects: [
      { symbol: 401000, type: 3, coords: rect(0, 0, 12000, 8000) },
      { symbol: 406000, type: 3, coords: rect(1000, 4500, 5000, 7500) },
      { symbol: 301000, type: 3, coords: rect(8500, 5000, 11000, 7200) },
      ...[1500, 3000, 4500, 6000].map(y => ({ symbol: 101000, type: 2, coords: curve(y) })),
      ...Array.from({ length: 3 + stones }, (_, index) => ({ symbol: 206000, type: 1, coords: [ocdCoord(1500 + index * 900, 2000 + (index % 3) * 1500)] }))
    ]
  });
}

async function importMaps(page: Page, clubId: string, token: string) {
  const files = { first: forestMap(666000, 0), renamed: forestMap(666000, 1), revised: forestMap(666000, 2), other: forestMap(676000, 0) };
  const headers = { authorization: `Bearer ${token}` };
  for (const bytes of Object.values(files)) {
    const response = await page.request.put(`/api/club-import/${clubId}/content/${sha(bytes)}`, { headers: { ...headers,
      "content-type": "application/octet-stream" }, data: Buffer.from(bytes) });
    expect(response.status(), await response.text()).toBe(200);
  }
  const map = (key: string, name: string, bytes: Uint8Array, fileName: string, sourcePath: string | null) =>
    ({ importKey: key, name, versions: [{ sha256: sha(bytes), fileName, format: "OCD", versionDate: null, sourcePath }] });
  const entry = (key: string, title: string, bytes: Uint8Array) => ({ importKey: key, trainingDate: null, year: Number(key.slice(0, 4)), place: title, title,
    leader: null, tags: [], sourcePath: key, mapSha256: [sha(bytes)], courseFiles: [] });
  const batch = await page.request.post(`/api/club-import/${clubId}/batch`, { headers, data: { formatVersion: 1,
    maps: [map("a", "Skogsbacken 2019", files.first, "Skogsbacken 2019.ocd", null),
      map("b", "skogsbacken_ny", files.renamed, "skogsbacken_ny.ocd", "2020/05-12 Skogsbacken/skogsbacken_ny.ocd"),
      map("c", "Skogsbacken rev 2021", files.revised, "Skogsbacken rev 2021.ocd", null), map("d", "Ängsmyren", files.other, "Ängsmyren.ocd", null)],
    entries: [entry("2019/04-01 Skogsbacken", "Skogsbacken kurvbild", files.first), entry("2020/05-12 Skogsbacken", "Skogsbacken korridor", files.renamed),
      entry("2020/06-02 Skogsbacken", "Skogsbacken stafett", files.renamed), entry("2022/05-01 Ängsmyren", "Ängsmyren", files.other)] } });
  expect(batch.status(), await batch.text()).toBe(200);
}

test("dubbletter i kartarkivet: förslaget, slå ihop med år, kopiera till alla versioner, ångra och välj kartan i en ny träning", async ({ browser }) => {
  test.setTimeout(360_000);
  const suffix = unique();
  const owner = await registerAccount(browser, `dubbletter.${suffix}@exempel.se`, "Dagny Dubblett");
  const none = "00000000-0000-4000-8000-000000000000";
  for (const path of ["/api/organizer/clubs", "/api/organizer/club-maps", `/organizer/clubs/${none}`]) await warmRoute(owner, path);
  for (const [path, method] of [[`/api/organizer/clubs/${none}/map-duplicates`, "GET"], [`/api/organizer/clubs/${none}/map-merges`, "POST"],
    [`/api/organizer/clubs/${none}/map-merges/${none}/undo`, "POST"], [`/api/organizer/clubs/${none}/maps/${none}/versions-copy`, "POST"],
    [`/api/organizer/clubs/${none}/map-versions/${none}/check`, "PUT"], [`/api/organizer/clubs/${none}/map-versions/${none}`, "PUT"]] as const) {
    await warmRoute(owner, path, method);
  }
  await owner.goto("/organizer");
  const clubs = owner.getByRole("region", { name: "Mina klubbar" });
  await clubs.getByText("Ny klubb", { exact: true }).click();
  await clubs.getByLabel("Klubbens namn").fill(`OK Dubblett ${suffix}`);
  await clubs.getByRole("button", { name: "Skapa klubben" }).click();
  await owner.waitForURL(/\/organizer\/clubs\/[0-9a-f-]+$/);
  const clubId = /clubs\/([0-9a-f-]+)$/.exec(owner.url())![1]!;
  await owner.getByRole("tab", { name: "Import" }).click();
  await owner.getByText("För den som kan Git: kommandoraden").click();
  await owner.getByRole("button", { name: "Skapa importnyckel" }).click();
  const token = (await owner.getByTestId("import-token").textContent())!.trim();
  await importMaps(owner, clubId, token);

  // Kartorna kontrolleras i webbläsaren (fingeravtrycken sparas); förslaget visar de tre filerna av samma karta.
  await owner.reload();
  await owner.getByRole("tab", { name: "Kartor" }).click();
  await expect(owner.getByTestId("map-check").filter({ hasText: "Fungerar" })).toHaveCount(4, { timeout: 120_000 });
  const suggestion = owner.getByTestId("map-duplicates");
  await expect(suggestion.getByRole("heading", { name: "Möjliga dubbletter (1)" })).toBeVisible({ timeout: 30_000 });
  const cluster = suggestion.getByTestId("duplicate-cluster");
  await expect(cluster).toHaveAttribute("data-level", "HIGH", { timeout: 30_000 });
  await expect(cluster).toContainText("Troligen samma karta");
  await expect(cluster.getByTestId("duplicate-map")).toHaveCount(3);
  await expect(cluster).not.toContainText("Ängsmyren");
  await expect(cluster.getByTestId("duplicate-reasons")).toContainText(/Samma område \(\d+ % överlapp\)/);
  await expect(cluster.getByTestId("duplicate-reasons")).toContainText("Samma namn");
  await expect(cluster.getByTestId("duplicate-reasons")).toContainText("Samma symboler");
  // Förvalet är kartan med flest träningar.
  await expect(cluster.getByRole("radio", { name: "skogsbacken_ny" })).toBeChecked();
  await expect(cluster.getByTestId("duplicate-map").first()).toContainText("1 version, 20");
  await suggestion.scrollIntoViewIfNeeded();
  await reviewScreenshots(owner, "dubbletter-forslag");

  await cluster.getByRole("button", { name: "Slå ihop till en karta" }).click();
  await expect(owner.getByRole("status").filter({ hasText: "Kartorna är sammanslagna till skogsbacken_ny (2 versioner flyttade)." })).toBeVisible();
  const kept = owner.getByTestId("club-map").filter({ has: owner.getByRole("heading", { name: "skogsbacken_ny", exact: true }) });
  await expect(kept.getByTestId("map-summary")).toContainText("3 versioner, 2019–2021");
  await expect(kept.getByTestId("version-year")).toHaveText(["2021", "2020", "2019"]);
  await expect(owner.getByTestId("club-map")).toHaveCount(2);
  await expect(owner.getByTestId("map-duplicates")).toHaveCount(0);

  // Kartritaren på en version och "Kopiera till alla versioner" med förhandsvisning.
  await kept.getByRole("button", { name: "År och uppgifter: Skogsbacken 2019.ocd" }).click();
  const form = kept.getByRole("form", { name: "År och uppgifter: Skogsbacken 2019.ocd" });
  await form.getByLabel("Kartritare").fill("Åke Ö");
  await form.getByRole("button", { name: "Spara" }).click();
  await expect(kept).toContainText("Kartritare: Åke Ö");
  await kept.getByRole("button", { name: "Kopiera från Skogsbacken 2019.ocd till alla versioner" }).click();
  const preview = kept.getByTestId("copy-preview");
  await expect(preview.getByRole("listitem")).toHaveCount(2);
  await expect(preview).toContainText("skogsbacken_ny.ocd: Kartritare – → Åke Ö");
  await reviewScreenshots(owner, "dubbletter-kopiera");
  await preview.getByRole("button", { name: "Kopiera" }).click();
  await expect(owner.getByRole("status").filter({ hasText: "2 versioner är ändrade." })).toBeVisible();
  await expect(kept.getByText("Kartritare: Åke Ö")).toHaveCount(3);
  await reviewScreenshots(owner, "dubbletter-sammanslagen");

  // Ångra sammanslagning: kartorna är tre igen, förslaget kommer tillbaka.
  await kept.getByTestId("map-history").locator("summary").click();
  await kept.getByRole("button", { name: "Ångra sammanslagning" }).click();
  await expect(owner.getByRole("status").filter({ hasText: "Sammanslagningen är ångrad." })).toBeVisible();
  await expect(owner.getByTestId("club-map")).toHaveCount(4);
  await expect(owner.getByTestId("map-duplicates").getByTestId("duplicate-map")).toHaveCount(3);

  // En ny träning med kartan ur klubbarkivet: banläggningen öppnas med kartan.
  await owner.goto("/organizer");
  await owner.getByLabel("Tävlingens namn").fill(`Träning ur arkivet ${suffix}`);
  await owner.getByLabel("Datum").fill(new Date().toLocaleDateString("sv-SE", { timeZone: "Europe/Stockholm" }));
  await owner.getByRole("radio", { name: "Träning", exact: true }).check();
  const picker = owner.getByTestId("club-map-picker");
  await picker.getByRole("button", { name: "Välj karta från klubbarkivet" }).click();
  const choice = picker.getByTestId("club-map-choice").filter({ has: owner.getByRole("heading", { name: "Skogsbacken rev 2021" }) });
  await expect(choice.getByTestId("club-map-choice-summary")).toHaveText("1 version, 2021");
  await reviewScreenshots(owner, "dubbletter-valj-karta");
  await choice.getByRole("button", { name: "Använd kartan Skogsbacken rev 2021" }).click();
  await expect(owner.getByTestId("club-map-chosen")).toContainText("Vald karta: Skogsbacken rev 2021 (2021)");
  await owner.getByRole("button", { name: "Skapa tävling" }).last().click();
  await owner.waitForURL(/\/admin\/[0-9a-f-]+\/course-setting$/, { timeout: 120_000 });
  await expect(owner.getByRole("button", { name: "Börja med en tom banläggning" })).toBeVisible({ timeout: 60_000 });
  await expect(owner.getByText("Skogsbacken rev 2021.ocd · 1:10000")).toBeVisible();
});
