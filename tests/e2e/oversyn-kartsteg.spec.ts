import { readFileSync } from "node:fs";
import { expect, test, type Locator, type Page } from "@playwright/test";
import { registerAccount, unique, warmRoute } from "./helpers";

/**
 * Översynen av kartstegen 2026-11-17 (ägaren: «arbetsstegen … kan vara förvirrande med många oklara namn och undermenyer av
 * samma storlek»). En ny användare ska kunna läsa ordningen uppifrån och ned och se vad som är ett steg och vad som är ett val
 * inom steget:
 * - Projektsidan: «Nästa steg» i fyra steg (underlag och grundkarta, rita, kontrollera och exportera, banor), och sektionerna
 *   «Kartan» och «Exportera» (ny kartversion och bara ändringarna på ett ställe).
 * - Kartredigeraren, fliken Lager: «Underlag och grundkarta» med tre numrerade huvudsteg (h3) – Hämta underlag, Ta fram
 *   grundkartan, Gå igenom utkastet – och valen indragna under, i mindre stil. Guiden är en del av steg 2 (h4).
 * - Fliken Granska i arbetsordning: Förslag, Normkontroll, Notiser, Rekning, Delområden; arbetssätt och AI i en utfällning sist.
 */
const mapBytes = new Uint8Array(readFileSync(new URL("../../fixtures/maps/kartfil.omap", import.meta.url)));

async function csrfOf(page: Page): Promise<string> {
  return (await page.context().cookies()).find(row => /otid[-_]organizer[-_]csrf$/.test(row.name))?.value ?? "";
}
const left = async (locator: Locator) => (await locator.boundingBox())!.x;
const fontSize = (locator: Locator) => locator.evaluate(element => Number.parseFloat(getComputedStyle(element).fontSize));

test("översynen: kartstegen i ordning, huvudsteg skilda från valen under dem", async ({ browser, baseURL }) => {
  test.setTimeout(300_000);
  const owner = await registerAccount(browser, `kartsteg.${unique()}@exempel.se`, "Stina Steg");
  await warmRoute(owner, "/api/organizer/map-projects/upload", "POST");
  const created = await owner.request.post("/api/organizer/map-projects/upload", { headers: { origin: baseURL!, "x-otid-csrf": await csrfOf(owner),
    "content-type": "application/octet-stream", "x-otid-request-id": crypto.randomUUID(), "x-otid-name": "Stegen", "x-otid-file-name": "Stegen.omap" },
    data: Buffer.from(mapBytes) });
  expect(created.status(), await created.text()).toBe(201);
  const projectId = (await created.json() as { projectId: string }).projectId;

  // Projektsidan: fyra steg i ordning; kartfilen är underlaget, så nästa steg är att rita.
  await owner.setViewportSize({ width: 1280, height: 900 });
  await owner.goto(`/organizer/map-projects/${projectId}`);
  const next = owner.getByTestId("map-project-next");
  await expect(next).toBeVisible({ timeout: 60_000 });
  await expect(next.getByRole("heading", { level: 3 })).toHaveText([/^Hämta underlag och ta fram grundkartan/, /^Rita färdigt/,
    /^Kontrollera och exportera/, /^Lägg banor på kartan/]);
  await expect(next.getByTestId("map-project-step-draw")).toHaveAttribute("data-next", "true");
  await expect(next.getByTestId("map-project-step-export")).toContainText("Granska › Normkontroll");
  const sections = owner.locator("main").getByRole("heading", { level: 2 });
  const names = await sections.allTextContents();
  expect(names.indexOf("Kartan")).toBeGreaterThan(names.indexOf("Nästa steg"));
  expect(names.indexOf("Exportera")).toBe(names.indexOf("Kartan") + 1);
  const exporting = owner.locator("#exportera");
  await expect(exporting.getByRole("heading", { level: 3 })).toHaveText(["Ny kartversion", "Bara ändringarna", "Versioner ur projektet"]);
  await expect(exporting.getByRole("link", { name: "Exportera ändringarna (GeoJSON)" })).toBeVisible();

  // Kartredigeraren, fliken Lager.
  await owner.goto(`/organizer/map-projects/${projectId}/map`);
  await expect(owner.getByTestId("course-setting-map")).toHaveAttribute("data-drawn", "true", { timeout: 90_000 });
  await owner.getByTestId("map-project-tab-layers").click();
  const panel = owner.getByTestId("map-project-layers");
  await expect(panel.getByRole("heading", { level: 2 })).toHaveText("Underlag och grundkarta");
  const steps = panel.getByRole("heading", { level: 3 });
  await expect(steps).toHaveCount(3);
  for (const [index, name] of ["Steg 1: Hämta underlag", "Steg 2: Ta fram grundkartan", "Steg 3: Gå igenom utkastet"].entries()) {
    await expect(steps.nth(index)).toHaveAccessibleName(name);
  }
  // Valen under ett steg: indragna och i mindre stil än stegets rubrik. Guiden hör till steg 2 (h4).
  const sources = panel.getByTestId("map-project-mapstep-sources");
  const ortho = sources.locator("summary").filter({ hasText: "Ortofoto från Lantmäteriet" });
  await expect(ortho).toBeVisible();
  expect(await left(ortho)).toBeGreaterThan(await left(steps.first()) + 16);
  expect(await fontSize(ortho)).toBeLessThan(await fontSize(steps.first()));
  const baseMap = panel.getByTestId("map-project-mapstep-base-map");
  await expect(baseMap.locator("summary").filter({ hasText: "Laserkörningar (avancerat)" })).toBeVisible();
  await expect(baseMap.locator("summary").filter({ hasText: "Läs in vektorfil eller OpenStreetMap" })).toBeVisible();
  const guide = baseMap.getByTestId("map-project-guide");
  if (await guide.count()) await expect(guide.getByRole("heading", { level: 4 })).toHaveText("Guiden: från laserdata till grundkarta");
  await expect(panel.getByTestId("map-project-mapstep-review").locator("summary").filter({ hasText: "Punkthöjder med reglage (109)" })).toBeVisible();
  await expect(panel.getByTestId("map-project-steps-then")).toContainText("Granska › Normkontroll");

  // Fliken Granska i arbetsordning; arbetssättet och AI-kopplingen i en stängd utfällning sist.
  await owner.getByTestId("map-project-tab-review").click();
  const review = owner.locator("#map-project-tabpanel-review");
  await expect(review.getByRole("heading", { level: 2 })).toHaveText([/^Förslag/, "Normkontroll", "Notiser", "Rekning", "Delområden"]);
  const settings = review.getByTestId("map-project-collab-settings");
  await expect(settings).not.toHaveAttribute("open", "");
  await settings.getByText("Arbetssätt och AI-kopplingen").click();
  await expect(settings.getByRole("heading", { level: 3 })).toHaveText(["Arbetssätt", "AI-kopplingen"]);
});
