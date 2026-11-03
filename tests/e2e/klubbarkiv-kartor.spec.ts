import { createHash } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import { buildOcd, concat, element, ocdCoord, symbolBody } from "../../packages/map-file/test/ocd-builder";
import { registerAccount, reviewScreenshots, unique, warmRoute } from "./helpers";

/**
 * ADR-0196: klubbarkivets kartor. Ägaren har importerat en syntetisk OCAD 11-karta och en OCAD 7-karta (som inte går att läsa)
 * med två träningar, den ena med en banfil i IOF XML 2.0.3. När arkivet öppnas ritas kartorna i webbläsaren: Kartor-fliken
 * visar bild och "Fungerar" eller skälet, träningarna får en bild med banan, banfilens sammanfattning syns utan karta, och
 * kartans rättigheter ändras i Kartor-fliken och på träningens sida. Allt är påhittat och byggs när testet körs.
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

/** En liten skogskarta, 120 × 80 mm i 1:10 000: öppen mark, grönt, en sjö, höjdkurvor, stenar och ett namn. */
function ocad11Map(): Uint8Array {
  const rect = (x0: number, y0: number, x1: number, y1: number) => [ocdCoord(x0, y0), ocdCoord(x1, y0), ocdCoord(x1, y1), ocdCoord(x0, y1)];
  const area = (number: number, color: number) => ({ number, type: 3, body: symbolBody(40, { 800: color }, view => view.setUint8(814 - 796, 1)) });
  const curve = (y: number) => [ocdCoord(500, y), ocdCoord(4000, y + 900, 1), ocdCoord(8000, y - 900, 2), ocdCoord(11500, y)];
  const stone = (() => { const dot = element(4, 0, 0, 60, [ocdCoord(0, 0)]); return concat(symbolBody(4, { 796: dot.length / 8 }), dot); })();
  return buildOcd({
    version: 11, subversion: 2, encoding: "WINDOWS_1252",
    strings: [...COLORS, { type: 1039, value: "\tm10000\tg50\tr1\tx666000\ty6574000\ta0\td100\ti13002" }],
    symbols: [
      area(401000, 4), area(406000, 5), area(301000, 3),
      { number: 101000, type: 2, body: symbolBody(80, { 796: 2, 798: 14, 800: 1 }) },
      { number: 206000, type: 1, body: stone },
      { number: 902000, type: 4, body: symbolBody(60, { 828: 0, 830: 100, 832: 700 }, view => {
        view.setUint8(0, 5); "Arial".split("").forEach((c, i) => view.setUint8(1 + i, c.charCodeAt(0))); }) }
    ],
    objects: [
      { symbol: 401000, type: 3, coords: rect(0, 0, 12000, 8000) },
      { symbol: 406000, type: 3, coords: rect(1000, 4500, 5000, 7500) },
      { symbol: 406000, type: 3, coords: rect(7000, 500, 11000, 3000) },
      { symbol: 301000, type: 3, coords: rect(8500, 5000, 11000, 7200) },
      ...[1500, 3000, 4500, 6000].map(y => ({ symbol: 101000, type: 2, coords: curve(y) })),
      ...[[2000, 2000], [6000, 4000], [9500, 4200], [3500, 5800]].map(([x, y]) => ({ symbol: 206000, type: 1, coords: [ocdCoord(x!, y!)] })),
      { symbol: 902000, type: 4, coords: [ocdCoord(8800, 5500)], text: "Sjön" }
    ]
  });
}

/** Banfilen i IOF XML 2.0.3 (utan namnrymd), som äldre OCAD skrev. */
const COURSE_DATA_203 = new TextEncoder().encode(`<?xml version="1.0" encoding="utf-8"?>
<CourseData><IOFVersion version="2.0.3" /><Map><Scale>10000</Scale></Map>
  <StartPoint><StartPointCode>STA1</StartPointCode><MapPosition x="15" y="10" /></StartPoint>
  <Control><ControlCode>31</ControlCode><MapPosition x="40" y="30" /></Control>
  <Control><ControlCode>32</ControlCode><MapPosition x="80" y="20" /></Control>
  <Control><ControlCode>33</ControlCode><MapPosition x="100" y="60" /></Control>
  <FinishPoint><FinishPointCode>FIN1</FinishPointCode><MapPosition x="20" y="15" /></FinishPoint>
  <Course><CourseName>Gul</CourseName><CourseId>0</CourseId><CourseVariation><CourseVariationId>0</CourseVariationId><CourseLength>2100</CourseLength>
    <StartPointCode>STA1</StartPointCode>
    <CourseControl><Sequence>1</Sequence><ControlCode>31</ControlCode></CourseControl>
    <CourseControl><Sequence>2</Sequence><ControlCode>32</ControlCode></CourseControl>
    <CourseControl><Sequence>3</Sequence><ControlCode>33</ControlCode></CourseControl>
    <FinishPointCode>FIN1</FinishPointCode></CourseVariation></Course>
</CourseData>`);

async function importArchive(page: Page, clubId: string, token: string, maps: { skogen: Uint8Array; gammal: Uint8Array }) {
  const headers = { authorization: `Bearer ${token}` };
  for (const bytes of [maps.skogen, maps.gammal]) {
    const response = await page.request.put(`/api/club-import/${clubId}/content/${sha(bytes)}`, { headers: { ...headers,
      "content-type": "application/octet-stream" }, data: Buffer.from(bytes) });
    expect(response.status(), await response.text()).toBe(200);
  }
  const batch = await page.request.post(`/api/club-import/${clubId}/batch`, { headers, data: { formatVersion: 1,
    maps: [
      { importKey: "skogen", name: "Skogen", versions: [{ sha256: sha(maps.skogen), fileName: "Skogen V11.ocd", format: "OCD", versionDate: "2020-04-20",
        sourcePath: null }] },
      { importKey: "gammal", name: "Gamla skogen", versions: [{ sha256: sha(maps.gammal), fileName: "Gamla skogen.ocd", format: "OCD",
        versionDate: "2012-05-01", sourcePath: null }] }],
    entries: [
      { importKey: "2020/04-26 Skogen", trainingDate: "2020-04-26", year: 2020, place: "Skogen", title: "Skogen gul", leader: null, tags: [],
        sourcePath: "2020/04-26 Skogen", mapSha256: [sha(maps.skogen)], courseFiles: [{ fileName: "Banor.xml", kind: "COURSE_DATA", sha256: sha(COURSE_DATA_203),
          contentBase64: Buffer.from(COURSE_DATA_203).toString("base64"), mapReference: null, mapSha256: sha(maps.skogen), resolution: "FOLDER" }] },
      { importKey: "2012/05-01 Gamla", trainingDate: "2012-05-01", year: 2012, place: "Gamla skogen", title: "Gamla skogen", leader: null, tags: [],
        sourcePath: "2012/05-01 Gamla", mapSha256: [sha(maps.gammal)], courseFiles: [] }] } });
  expect(batch.status(), await batch.text()).toBe(200);
}

test("klubbarkivets kartor: OCAD 11 fungerar, OCAD 7 säger varför, bilder, banfil i IOF 2.0.3 och rättigheterna", async ({ browser }) => {
  test.setTimeout(300_000);
  const suffix = unique();
  const owner = await registerAccount(browser, `kartor.${suffix}@exempel.se`, "Karin Kartor");
  const none = "00000000-0000-4000-8000-000000000000";
  for (const path of ["/api/organizer/clubs", `/organizer/clubs/${none}`, `/organizer/clubs/${none}/arkiv/${none}`]) await warmRoute(owner, path);
  // Utvecklingsservern kompilerar routerna vid första anropet; svaren spelar ingen roll.
  for (const [path, method] of [[`/api/organizer/clubs/${none}/maps/${none}`, "PUT"], [`/api/organizer/clubs/${none}/map-versions/${none}/check`, "PUT"],
    [`/api/organizer/clubs/${none}/archive/${none}/thumbnail`, "PUT"], [`/api/organizer/clubs/${none}/archive/summaries`, "POST"],
    [`/api/organizer/clubs/${none}/map-versions/${none}`, "GET"], [`/api/organizer/clubs/${none}/archive/${none}`, "GET"]] as const) {
    await warmRoute(owner, path, method);
  }
  await owner.goto("/organizer");
  const clubs = owner.getByRole("region", { name: "Mina klubbar" });
  await clubs.getByText("Ny klubb", { exact: true }).click();
  await clubs.getByLabel("Klubbens namn").fill(`OK Kartor ${suffix}`);
  await clubs.getByRole("button", { name: "Skapa klubben" }).click();
  await owner.waitForURL(/\/organizer\/clubs\/[0-9a-f-]+$/);
  const clubId = /clubs\/([0-9a-f-]+)$/.exec(owner.url())![1]!;
  await owner.getByRole("tab", { name: "Import" }).click();
  await owner.getByRole("button", { name: "Skapa importnyckel" }).click();
  const token = (await owner.getByTestId("import-token").textContent())!.trim();

  const skogen = ocad11Map();
  const gammal = buildOcd({ version: 7, strings: COLORS, symbols: [], objects: [] });
  await importArchive(owner, clubId, token, { skogen, gammal });

  // Arkivet öppnas: kartorna kontrolleras och bilderna ritas i bakgrunden.
  await owner.reload();
  await owner.getByRole("tab", { name: "Kartor" }).click();
  const skogenCard = owner.getByTestId("club-map").filter({ has: owner.getByRole("heading", { name: "Skogen", exact: true }) });
  const gammalCard = owner.getByTestId("club-map").filter({ has: owner.getByRole("heading", { name: "Gamla skogen", exact: true }) });
  await expect(skogenCard.getByTestId("map-check")).toHaveText("Fungerar · OCAD 11.2", { timeout: 90_000 });
  await expect(skogenCard.getByTestId("map-thumbnail")).toBeVisible();
  await expect.poll(() => skogenCard.getByTestId("map-thumbnail").evaluate(image => (image as HTMLImageElement).naturalWidth)).toBeGreaterThan(100);
  await expect(gammalCard.getByTestId("map-check")).toHaveText("OCAD 7 stöds inte", { timeout: 90_000 });
  await expect(gammalCard).toContainText("Öppna kartan och spara den i nyare OCAD eller i Mapper.");
  await expect(gammalCard.getByTestId("map-thumbnail-missing")).toHaveText("OCAD 7 stöds inte");

  // Rättigheterna ändras direkt i kartans kort.
  await skogenCard.getByRole("button", { name: "Ändra rättigheter: Skogen" }).click();
  const rights = owner.getByRole("form", { name: "Kartans rättigheter: Skogen" });
  await rights.getByLabel("Extern", { exact: true }).check();
  await rights.getByRole("combobox", { name: "Ägare", exact: true }).selectOption({ label: "Kommun" });
  await rights.getByLabel("Ägarens namn").fill("Stockholms stad");
  await rights.getByLabel("Avtal", { exact: true }).fill("Avtal om träningskartor 2024–2027");
  await rights.getByRole("button", { name: "Spara rättigheterna" }).click();
  await expect(skogenCard.getByTestId("map-agreement")).toContainText("Extern karta – Kommun: Stockholms stad");
  await expect(skogenCard.getByTestId("map-agreement")).toContainText("Avtal om träningskartor 2024–2027");
  await reviewScreenshots(owner, "kartarkiv-kartor");

  // Träningarna har bild: banan på kartan, eller varför kartan saknas.
  await owner.getByRole("tab", { name: "Träningar" }).click();
  const entries = owner.getByTestId("archive-entries").getByRole("listitem");
  await expect(entries.filter({ hasText: "Skogen gul" }).getByTestId("entry-thumbnail")).toBeVisible({ timeout: 90_000 });
  await expect(entries.filter({ hasText: "Skogen gul" }).getByRole("img")).toHaveAttribute("alt", "Banan på kartan: Skogen gul (Gul)");
  await expect.poll(() => entries.filter({ hasText: "Skogen gul" }).getByTestId("entry-thumbnail")
    .evaluate(image => (image as HTMLImageElement).naturalWidth)).toBe(360);
  await expect(entries.filter({ hasText: "Gamla skogen" }).getByTestId("entry-thumbnail-missing")).toHaveText("Kartan kunde inte ritas");
  await reviewScreenshots(owner, "kartarkiv-traningar");

  // Träningen med OCAD 7-kartan säger skälet.
  await entries.filter({ hasText: "Gamla skogen" }).getByRole("link").click();
  await owner.waitForURL(/\/arkiv\/[0-9a-f-]+$/);
  await expect(owner.getByTestId("preview-failed")).toContainText("Kartan kunde inte ritas här: OCAD 7 stöds inte.", { timeout: 60_000 });
  await reviewScreenshots(owner, "kartarkiv-traning-gammal");

  // Träningen med banfilen i IOF XML 2.0.3: sammanfattningen ur filen, banan på kartan, rättigheterna går att ändra här.
  await owner.goto(`/organizer/clubs/${clubId}`);
  await owner.getByTestId("archive-entries").getByRole("link").filter({ hasText: "Skogen gul" }).click();
  await expect(owner.getByTestId("course-file")).toContainText("Gul 3 kontroller 2,1 km");
  await expect(owner.getByTestId("course-preview")).toHaveAttribute("data-ready", "true", { timeout: 60_000 });
  await owner.getByRole("button", { name: "Ändra rättigheter: Skogen" }).click();
  const entryRights = owner.getByRole("form", { name: "Kartans rättigheter: Skogen" });
  await expect(entryRights.getByLabel("Ägarens namn")).toHaveValue("Stockholms stad");
  await entryRights.getByLabel("Kontaktperson").fill("Kartansvarig i klubben");
  await entryRights.getByRole("button", { name: "Spara rättigheterna" }).click();
  await expect(owner.getByTestId("map-agreement").first()).toContainText("Kartansvarig i klubben");
  await reviewScreenshots(owner, "kartarkiv-traning");

  // "Kontrollera alla kartor igen" gör om allt och säger hur det gick.
  await owner.goto(`/organizer/clubs/${clubId}`);
  await owner.getByRole("tab", { name: "Kartor" }).click();
  await owner.getByRole("button", { name: "Kontrollera alla kartor igen" }).click();
  await expect(owner.getByTestId("recheck").getByRole("status")).toContainText("Klart. 1 av 2 kartversioner fungerar", { timeout: 120_000 });
});
