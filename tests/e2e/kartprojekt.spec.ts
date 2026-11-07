import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { readMapFile, sha256Hex } from "../../packages/map-file/src";
import { baseKey, objectRefFor } from "../../packages/map-revision/src";
import { registerAccount, reviewScreenshots, unique, warmRoute } from "./helpers";

/**
 * ADR-0219 (steg K0): kartprojekt. Ägaren importerar Mapper-fixturen till klubbarkivet och startar ett kartprojekt från
 * kartversionen i Kartor-fliken. På projektets sida bjuder ägaren in en kartritare med e-post; kartritaren skapar konto
 * med länken i mejlet och hamnar på projektet med rollen Ändra. En ändring (punkten flyttad) synkas genom projektets API, som
 * ritverktygen i K1 kommer att göra, och ägaren skapar en ny kartversion som syns i projektet och i klubbarkivet.
 * Ett eget projekt (rättelsen 2026-11-07): vem som helst startar ett från en kartfil i Mina kartprojekt, utan klubb, och den nya
 * versionen sparas i projektet och går att ladda ner.
 */
const mapBytes = new Uint8Array(readFileSync(new URL("../../fixtures/maps/kartfil.omap", import.meta.url)));
const sha = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

async function csrfOf(page: Page): Promise<string> {
  return (await page.context().cookies()).find(row => /otid[-_]organizer[-_]csrf$/.test(row.name))?.value ?? "";
}

test("kartprojekt: starta från klubbarkivet, bjud in en kartritare, synka en ändring och skapa en ny kartversion", async ({ browser, baseURL }) => {
  test.setTimeout(300_000);
  const suffix = unique();
  const owner = await registerAccount(browser, `kartprojekt.${suffix}@exempel.se`, "Kim Kartägare");
  const none = "00000000-0000-4000-8000-000000000000";
  for (const path of ["/api/organizer/clubs", "/api/organizer/map-projects", `/api/organizer/map-projects/${none}`, `/organizer/map-projects/${none}`,
    `/organizer/clubs/${none}`]) await warmRoute(owner, path);
  for (const [path, method] of [["/api/organizer/map-projects", "POST"], [`/api/organizer/map-projects/${none}/members`, "POST"],
    [`/api/organizer/map-projects/${none}/sync`, "POST"], [`/api/organizer/map-projects/${none}/versions`, "POST"]] as const) {
    await warmRoute(owner, path, method);
  }

  await owner.goto("/organizer");
  const clubs = owner.getByRole("region", { name: "Mina klubbar" });
  await clubs.getByRole("button", { name: "Ny klubbyta" }).click();
  await clubs.getByLabel("Klubbens namn").fill(`OK Kartprojekt ${suffix}`);
  await clubs.getByRole("button", { name: "Skapa klubben" }).click();
  await owner.waitForURL(/\/organizer\/clubs\/[0-9a-f-]+$/);
  const clubId = /clubs\/([0-9a-f-]+)$/.exec(owner.url())![1]!;
  await owner.getByRole("tab", { name: "Import" }).click();
  await owner.getByText("För den som kan Git: kommandoraden").click();
  await owner.getByRole("button", { name: "Skapa importnyckel" }).click();
  const token = (await owner.getByTestId("import-token").textContent())!.trim();
  const headers = { authorization: `Bearer ${token}` };
  expect((await owner.request.put(`/api/club-import/${clubId}/content/${sha(mapBytes)}`, { headers: { ...headers,
    "content-type": "application/octet-stream" }, data: Buffer.from(mapBytes) })).status()).toBe(200);
  const batch = await owner.request.post(`/api/club-import/${clubId}/batch`, { headers, data: { formatVersion: 1, entries: [],
    maps: [{ importKey: "skogen", name: "Skogen", versions: [{ sha256: sha(mapBytes), fileName: "Skogen.omap", format: "OMAP",
      versionDate: "2025-05-01", sourcePath: null }] }] } });
  expect(batch.status(), await batch.text()).toBe(200);

  // Starta kartprojektet från versionen i Kartor-fliken.
  await owner.reload();
  await owner.getByRole("tab", { name: "Kartor" }).click();
  await owner.getByRole("button", { name: "Starta kartprojekt från Skogen.omap" }).click();
  const start = owner.getByRole("form", { name: "Starta kartprojekt från Skogen.omap" });
  await start.getByLabel("Projektets namn").fill("Rekning hösten");
  await start.getByRole("button", { name: "Starta" }).click();
  await owner.waitForURL(/\/organizer\/map-projects\/[0-9a-f-]+$/);
  const projectId = /map-projects\/([0-9a-f-]+)$/.exec(owner.url())![1]!;
  await expect(owner.getByRole("heading", { name: "Rekning hösten", level: 1 })).toBeVisible();
  await expect(owner.getByTestId("map-project-members")).toContainText("Kim Kartägare (du)");

  // Bjud in en kartritare med e-post; hen skapar konto med länken och hamnar på projektet.
  const mapperEmail = `kartritare.${suffix}@exempel.se`;
  const invite = owner.getByRole("form", { name: "Bjud in" });
  await invite.getByLabel("E-postadress").fill(mapperEmail);
  await invite.getByLabel("Roll").selectOption("EDIT");
  await invite.getByRole("button", { name: "Bjud in" }).click();
  await expect(owner.getByRole("status")).toContainText("Inbjudan sparad.");
  await expect(owner.getByTestId("map-project-members")).toContainText(mapperEmail);
  const mapper = await registerAccount(browser, mapperEmail, "Mia Kartritare");
  await mapper.goto(`/organizer/map-projects/${projectId}`);
  await expect(mapper.getByTestId("map-project-members")).toContainText("Mia Kartritare (du)");
  await expect(mapper.getByTestId("map-project-members")).toContainText("Ändra");
  await expect(mapper.getByText("Bara projektets ägare skapar nya kartversioner.")).toBeVisible();

  // En ändring synkas genom API:t (ritverktygen kommer i K1): punkten flyttas 5 mm.
  const parsed = readMapFile(mapBytes, "Skogen.omap", { sources: true });
  const point = parsed.objects.find(object => object.kind === "point")!;
  if (point.kind !== "point") throw new Error("ingen punkt");
  const ref = objectRefFor(sha256Hex(mapBytes), point)!;
  const synced = await mapper.request.post(`/api/organizer/map-projects/${projectId}/sync`, {
    headers: { origin: baseURL!, "x-otid-csrf": await csrfOf(mapper), "content-type": "application/json" },
    data: { formatVersion: 1, clientId: "e2e", since: 0, edits: [{ editId: randomUUID(), key: baseKey(ref), ref, base: null, kind: "MOVE",
      at: new Date().toISOString(), state: { kind: "OBJECT", object: { ...point, at: { x: point.at.x + 5, y: point.at.y } } } }] } });
  expect(synced.status(), await synced.text()).toBe(200);
  expect((await synced.json() as { results: { status: string }[] }).results[0]!.status).toBe("APPLIED");

  // Ägaren skapar en ny kartversion; den syns i projektet och i klubbarkivet.
  await owner.reload();
  await expect(owner.getByText("1 ändrat objekt")).toBeVisible();
  owner.once("dialog", dialog => void dialog.accept());
  await owner.getByRole("button", { name: "Skapa ny kartversion" }).click();
  await expect(owner.getByLabel("Lägg också den nya versionen i klubbarkivet")).toBeChecked();
  await expect(owner.getByRole("status")).toContainText("Ny kartversion i projektet och i klubbarkivet: Skogen reviderad");
  await expect(owner.getByText(/Skogen reviderad \d{4}-\d{2}-\d{2}\.omap · 1 ändring · \d{4}-\d{2}-\d{2} · i klubbarkivet/)).toBeVisible();
  await reviewScreenshots(owner, "kartprojekt");
  await owner.goto(`/organizer/clubs/${clubId}`);
  await owner.getByRole("tab", { name: "Kartor" }).click();
  await expect(owner.getByTestId("club-map-version")).toHaveCount(2);

  // Mina tävlingar visar projektet i remsan.
  await owner.goto("/organizer");
  await expect(owner.getByRole("region", { name: "Mina kartprojekt" })).toContainText("Rekning hösten");
});

test("kartprojekt: eget projekt från en kartfil, utan klubb, med en ny version i projektet", async ({ browser, baseURL }) => {
  test.setTimeout(240_000);
  const suffix = unique();
  const owner = await registerAccount(browser, `egetprojekt.${suffix}@exempel.se`, "Ebba Egen");
  const none = "00000000-0000-4000-8000-000000000000";
  for (const path of ["/organizer/map-projects", "/api/organizer/map-projects", `/api/organizer/map-projects/${none}`]) await warmRoute(owner, path);
  await warmRoute(owner, "/api/organizer/map-projects/upload", "POST");

  await owner.goto("/organizer/map-projects");
  const form = owner.getByRole("form", { name: "Nytt kartprojekt från en kartfil" });
  await form.getByLabel("Kartfil (.omap, .xmap eller .ocd)").setInputFiles({ name: "Kungshatt.omap", mimeType: "application/octet-stream",
    buffer: Buffer.from(mapBytes) });
  await expect(form.getByLabel("Projektets namn")).toHaveValue("Kungshatt");
  await form.getByRole("button", { name: "Starta projektet" }).click();
  await owner.waitForURL(/\/organizer\/map-projects\/[0-9a-f-]+$/);
  const projectId = /map-projects\/([0-9a-f-]+)$/.exec(owner.url())![1]!;
  await expect(owner.getByRole("heading", { name: "Kungshatt", level: 1 })).toBeVisible();
  await expect(owner.getByText("Eget projekt (ingen klubb)").first()).toBeVisible();
  await expect(owner.getByLabel("Lägg också den nya versionen i klubbarkivet")).toHaveCount(0);

  const parsed = readMapFile(mapBytes, "Kungshatt.omap", { sources: true });
  const point = parsed.objects.find(object => object.kind === "point")!;
  if (point.kind !== "point") throw new Error("ingen punkt");
  const ref = objectRefFor(sha256Hex(mapBytes), point)!;
  const synced = await owner.request.post(`/api/organizer/map-projects/${projectId}/sync`, {
    headers: { origin: baseURL!, "x-otid-csrf": await csrfOf(owner), "content-type": "application/json" },
    data: { formatVersion: 1, clientId: "e2e", since: 0, edits: [{ editId: randomUUID(), key: baseKey(ref), ref, base: null, kind: "MOVE",
      at: new Date().toISOString(), state: { kind: "OBJECT", object: { ...point, at: { x: point.at.x + 3, y: point.at.y } } } }] } });
  expect(synced.status(), await synced.text()).toBe(200);
  await owner.reload();
  owner.once("dialog", dialog => void dialog.accept());
  await owner.getByRole("button", { name: "Skapa ny kartversion" }).click();
  await expect(owner.getByRole("status")).toContainText("Ny kartversion: Kungshatt reviderad");
  const outputs = owner.getByTestId("map-project-outputs");
  await expect(outputs).toContainText(/Kungshatt reviderad \d{4}-\d{2}-\d{2}\.omap · 1 ändring/);
  const download = owner.waitForEvent("download");
  await outputs.getByRole("link", { name: /Ladda ner Kungshatt reviderad/ }).click();
  const file = await download;
  expect(file.suggestedFilename()).toMatch(/^Kungshatt reviderad \d{4}-\d{2}-\d{2}\.omap$/);
  await owner.goto("/organizer/map-projects");
  await expect(owner.getByTestId("map-projects")).toContainText("Kungshatt");
  await expect(owner.getByTestId("map-projects")).toContainText("eget");
});
