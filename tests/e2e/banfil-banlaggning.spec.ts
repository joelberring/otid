import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { expect, test, type Page } from "@playwright/test";
import { createRace, openStep, registerAccount, reviewScreenshots, unique, warmCourseSetting, warmRoute } from "./helpers";

/**
 * En banfil utan .ppen blir banläggning. Klubbarkivets träning har bara kartan och en IOF XML (CourseData): "Använd igen"
 * öppnar banläggningen med banorna, starten dras och står kvar efter omladdning. Sedan Banor → Banfil i samma träning med
 * en ändrad banfil: banläggningen ersätts först efter frågan. Sist Banläggning i en rogaining och en fest.
 * Kartan och banfilen är repots påhittade (`fixtures/maps/kartfil.omap`, `fixtures/iof/course-file-kartfil.xml`).
 */
const fixture = (path: string) => readFileSync(fileURLToPath(new URL(`../../fixtures/${path}`, import.meta.url)));
const sha = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const MAP = fixture("maps/kartfil.omap");
const COURSE_DATA = fixture("iof/course-file-kartfil.xml");

async function importEntry(page: Page, clubId: string, token: string) {
  const headers = { authorization: `Bearer ${token}` };
  const content = await page.request.put(`/api/club-import/${clubId}/content/${sha(MAP)}`, { headers: { ...headers,
    "content-type": "application/octet-stream" }, data: MAP });
  expect(content.status(), await content.text()).toBe(200);
  const batch = await page.request.post(`/api/club-import/${clubId}/batch`, { headers, data: { formatVersion: 1,
    maps: [{ importKey: "kartfil", name: "Kartfil", versions: [{ sha256: sha(MAP), fileName: "Kartfil.omap", format: "OMAP", versionDate: "2021-03-01",
      sourcePath: null }] }],
    entries: [{ importKey: "2021/03-14 Kartfil", trainingDate: "2021-03-14", year: 2021, place: "Kartfil", title: "Kvällsträning", leader: null, tags: [],
      sourcePath: "2021/03-14 Kartfil", mapSha256: [sha(MAP)], courseFiles: [{ fileName: "Kvällsträning.xml", kind: "COURSE_DATA", sha256: sha(COURSE_DATA),
        contentBase64: COURSE_DATA.toString("base64"), mapReference: null, mapSha256: sha(MAP), resolution: "FOLDER" }] }] } });
  expect(batch.status(), await batch.text()).toBe(200);
}

type Controls = Record<string, { kind: string; code?: string; at: { x: number; y: number } }>;

test("banfil utan .ppen: Använd igen öppnar banläggningen, starten flyttas och står kvar; Banfil ersätter efter frågan", async ({ browser }) => {
  test.setTimeout(480_000);
  const suffix = unique();
  const owner = await registerAccount(browser, `banfil.${suffix}@exempel.se`, "Bea Banfil");
  const none = "00000000-0000-4000-8000-000000000000";
  for (const path of ["/api/organizer/clubs", `/organizer/clubs/${none}`, `/organizer/clubs/${none}/arkiv/${none}`]) await warmRoute(owner, path);
  await warmRoute(owner, "/api/organizer/events", "POST");
  await owner.goto("/organizer");
  const clubs = owner.getByRole("region", { name: "Mina klubbar" });
  await clubs.getByText("Ny klubb", { exact: true }).click();
  await clubs.getByLabel("Klubbens namn").fill(`OK Banfil ${suffix}`);
  await clubs.getByRole("button", { name: "Skapa klubben" }).click();
  await owner.waitForURL(/\/organizer\/clubs\/[0-9a-f-]+$/);
  const clubId = /clubs\/([0-9a-f-]+)$/.exec(owner.url())![1]!;
  await owner.getByRole("tab", { name: "Import" }).click();
  await owner.getByRole("button", { name: "Skapa importnyckel" }).click();
  const token = (await owner.getByTestId("import-token").textContent())!.trim();
  await importEntry(owner, clubId, token);

  // Arkivets träning med bara banfilen → Använd igen → banläggningen (inte arbetsytan).
  await owner.reload();
  await owner.getByRole("tab", { name: "Träningar" }).click();
  await owner.getByTestId("archive-entries").getByRole("link").filter({ hasText: "Kvällsträning" }).click();
  await owner.waitForURL(/\/arkiv\/[0-9a-f-]+$/);
  await expect(owner.getByTestId("course-file")).toContainText("Kvällsträning.xml");
  await owner.getByTestId("archive-read-only").getByRole("button", { name: "Använd igen" }).click();
  const dialog = owner.getByRole("dialog", { name: "Använd träningen igen" });
  await dialog.getByLabel("Namn").fill(`Kväll igen ${suffix}`);
  await dialog.getByRole("button", { name: "Skapa träningen" }).click();
  await owner.waitForURL(/\/admin\/[0-9a-f-]+\/course-setting$/, { timeout: 120_000 });
  const raceId = /admin\/([0-9a-f-]+)\//.exec(owner.url())![1]!;
  // Beskedet om banfilen (försvinner efter en stund, som andra bekräftelser i editorn).
  await expect(owner.getByText("Banorna kommer från banfilen (1 bana, 9 kontroller). Kontrollbeskrivningarna är tomma.")).toBeVisible({ timeout: 60_000 });
  await warmCourseSetting(owner, raceId);
  const stateUrl = `/api/admin/races/${raceId}/administrator/course-setting`;
  const controlsNow = async () => ((await (await owner.request.get(stateUrl)).json()) as { setting: { document: { controls: Controls } } }).setting.document.controls;
  const state = await (await owner.request.get(stateUrl)).json() as { mapFile: { fileName: string } | null; setting: { document: {
    courses: { name: string; secondaryTitle?: string }[]; controls: Controls } } | null };
  expect(state.mapFile?.fileName).toBe("Kartfil.omap");
  expect(state.setting?.document.courses).toEqual([expect.objectContaining({ name: "Lång", secondaryTitle: "H21" })]);
  // Kontrollerna på samma ställe som i banfilen (kartans mm), med koderna.
  const controls = Object.values(state.setting!.document.controls);
  expect(controls.find(control => control.code === "31")?.at).toEqual({ x: 15, y: 42 });
  expect(controls.find(control => control.kind === "START")?.at).toEqual({ x: 4, y: 8 });

  // Dra starten med Välj; efter omladdning står den kvar (som i en kopia av en .ppen).
  const [startId, start] = Object.entries(await controlsNow()).find(([, control]) => control.kind === "START")!;
  const startOnScreen = async (course?: string) => {
    await owner.reload();
    if (course) await owner.getByTestId("course-setting-view").selectOption({ label: course });
    const map = owner.getByRole("img", { name: `Karta med banpåtryck: ${course ?? "Alla kontroller"}` });
    await expect(map).toBeVisible({ timeout: 30_000 });
    await expect(owner.getByText("Läser kartfilen …")).toHaveCount(0, { timeout: 60_000 });
    const box = (await map.boundingBox())!;
    const [centerX, centerY] = (await map.getAttribute("data-center"))!.split(",").map(Number) as [number, number];
    const pxPerMm = Number(await map.getAttribute("data-px-per-mm"));
    const at = (await controlsNow())[startId]!.at;
    return { point: { x: box.x + box.width / 2 + (at.x - centerX) * pxPerMm, y: box.y + box.height / 2 - (at.y - centerY) * pxPerMm }, pxPerMm, x: at.x };
  };
  await owner.setViewportSize({ width: 390, height: 844 });
  await startOnScreen();
  await screenshot(owner, "banfil-banlaggning-390");
  await owner.setViewportSize({ width: 1280, height: 720 });
  const { point: from, pxPerMm } = await startOnScreen("Lång");
  await screenshot(owner, "banfil-banlaggning-1280");
  await owner.mouse.move(from.x, from.y);
  await owner.mouse.down();
  await owner.mouse.move(from.x + 3 * pxPerMm, from.y, { steps: 4 });
  await owner.mouse.move(from.x + 6 * pxPerMm, from.y, { steps: 4 });
  await owner.mouse.up();
  await expect.poll(async () => (await controlsNow())[startId]!.at.x, { timeout: 15_000 }).toBeCloseTo(start.at.x + 6, 0);
  expect((await startOnScreen("Lång")).x).toBeCloseTo(start.at.x + 6, 0);
  await screenshot(owner, "banfil-banlaggning-flyttad-1280");
  await owner.setViewportSize({ width: 390, height: 844 });
  await startOnScreen();
  await screenshot(owner, "banfil-banlaggning-flyttad-390");
  await owner.setViewportSize({ width: 1280, height: 720 });

  // Banor → Banfil med en ändrad banfil (kontroll 36 är 37): tävlingen får ändringen, banläggningen ersätts efter frågan.
  await owner.goto(`/admin/${raceId}/manage`);
  await openStep(owner, "Banor & klasser");
  const files = owner.getByRole("region", { name: "Banfil" });
  const changed = COURSE_DATA.toString("utf8").replace("<CourseControl><Control>36</Control></CourseControl>", "<CourseControl><Control>37</Control></CourseControl>");
  await files.getByLabel("Banfil (IOF XML)").setInputFiles({ name: "Kvällsträning-2.xml", mimeType: "application/xml", buffer: Buffer.from(changed, "utf8") });
  await files.getByRole("button", { name: /Läs in (ny )?banfil/ }).click();
  const review = files.getByRole("region", { name: "Skillnader mot Kvällsträning-2.xml" });
  await review.getByRole("button", { name: /^Godkänn \d+ ändring(ar)?/ }).click();
  const offer = files.getByTestId("course-data-offer");
  await expect(offer).toContainText("Banläggningen har redan banor.");
  await offer.getByRole("button", { name: "Ersätt banläggningens banor …" }).click();
  await expect(offer).toContainText("Den nuvarande banläggningen sparas som en tidigare version");
  await reviewScreenshots(owner, "banfil-ersatt-fragan");
  await offer.getByRole("button", { name: "Ja, ersätt" }).click();
  await expect(offer.getByRole("status")).toHaveText("Banorna finns i banläggningen.");
  const replaced = await controlsNow();
  // Banfilens start igen (den flyttade versionen finns kvar som tidigare version), och 37 i stället för 36 på banan.
  expect(Object.values(replaced).find(control => control.kind === "START")?.at).toEqual({ x: 4, y: 8 });
  const revisions = await (await owner.request.get(`${stateUrl}/revisions`)).json() as { revisions: unknown[] };
  expect(revisions.revisions.length).toBeGreaterThanOrEqual(1);
  await reviewScreenshots(owner, "banfil-ersatt");
  await offer.getByRole("link", { name: "Öppna banläggningen" }).click();
  await owner.waitForURL(/\/course-setting$/);
  await expect(owner.getByText("Banorna kommer från banfilen", { exact: false })).toBeVisible({ timeout: 30_000 });
});

test("Banläggning i rogaining och fest: syns i arbetsytan och Mina tävlingar, och editorn säger vad som skiljer", async ({ browser }) => {
  test.setTimeout(240_000);
  const suffix = unique();
  const owner = await registerAccount(browser, `typer.${suffix}@exempel.se`, "Tove Typer");
  for (const [type, hint] of [["Rogaining", "Rogaining: nya banor blir poängbanor."], ["Fest", "Fest: banläggningen ger kartor att skriva ut."]] as const) {
    await owner.goto("/organizer");
    const raceId = await createRace(owner, `${type} ${suffix}`, undefined, type);
    await expect(owner.getByTestId("nav-course-setting")).toBeVisible();
    await owner.goto("/organizer");
    const row = owner.getByRole("listitem").filter({ hasText: `${type} ${suffix}` });
    await expect(row.getByTestId("open-course-setting")).toBeVisible();
    await warmCourseSetting(owner, raceId);
    // Utan kartfil: kartfilen laddas upp här, som för andra typer.
    await row.getByTestId("open-course-setting").click();
    await owner.waitForURL(new RegExp(`/admin/${raceId}/course-setting$`));
    await expect(owner.getByRole("heading", { name: "Banläggning", level: 1 })).toBeVisible();
    await owner.getByLabel("Kartfil (.ocd, .omap eller .xmap, högst 75 MB)").setInputFiles(fileURLToPath(new URL("../../fixtures/maps/kartfil.omap", import.meta.url)));
    await owner.getByRole("button", { name: "Ladda upp kartfil (OCAD eller Mapper)" }).click();
    await owner.getByRole("button", { name: "Börja med en tom banläggning" }).click({ timeout: 60_000 });
    await expect(owner.getByTestId("course-setting-race-type")).toContainText(hint, { timeout: 60_000 });
    if (type === "Rogaining") {
      // Ny bana blir poängbana.
      await owner.getByLabel("Namn på ny bana").fill("Poäng");
      await owner.getByRole("button", { name: "Ny bana" }).click();
      await expect.poll(async () => ((await (await owner.request.get(`/api/admin/races/${raceId}/administrator/course-setting`)).json()) as
        { setting: { document: { courses: { name: string; kind: string }[] } } }).setting.document.courses, { timeout: 15_000 })
        .toEqual([expect.objectContaining({ name: "Poäng", kind: "SCORE" })]);
    } else {
      await owner.getByRole("button", { name: /^Fil/ }).click();
      await expect(owner.getByRole("menuitem", { name: "Fil och versioner …" })).toBeVisible();
      await expect(owner.getByRole("menuitem", { name: /Överför till tävlingen/ })).toHaveCount(0);
      await owner.keyboard.press("Escape");
    }
    await reviewScreenshots(owner, `banlaggning-${type.toLowerCase()}`);
  }
});

async function screenshot(page: Page, name: string) {
  const directory = process.env.E2E_SCREENSHOT_DIR;
  if (directory) await page.screenshot({ path: `${directory}/${name}.png` });
}
