import { expect, test, type Page } from "@playwright/test";
import { registerAccount, unique, warmRoute } from "./helpers";

/**
 * Översynen av första kartan 2026-11-17 (ägaren: «det blir tydligt vilka steg användare måste gå igenom för att ta fram en karta
 * första gången. och sen att redigera den», och en beskrivning av Lantmäteriet som «kommer upp för de som försöker göra en karta
 * utan fungerande api-koppling»). En ny användare utan uppgifter till Lantmäteriet skapar en ny karta:
 * - projektsidans Nästa steg 1 säger att Lantmäteriet inte är kopplat, med länkarna, och har den enda «Öppna kartan»;
 * - kartan öppnas i fliken Grundkarta; guiden säger lugnt (inget rött fel) att Lantmäteriet inte är kopplat, med «Så kopplar du
 *   Lantmäteriet» (hjälpartikeln) och «Mitt konto»;
 * - laserkörningarna står som en utfällning sist i guiden; Lager har bara lagren och kartans inställningar i en stängd utfällning;
 * - «Till Exportera» sist i Granska leder till projektsidans Exportera;
 * - Mitt konto visar produkterna att beställa bredvid fälten.
 */
async function csrfOf(page: Page): Promise<string> {
  return (await page.context().cookies()).find(row => /otid[-_]organizer[-_]csrf$/.test(row.name))?.value ?? "";
}

test("översynen: första kartan utan Lantmäteriet, stegen och vägen till exporten", async ({ browser, baseURL }) => {
  test.setTimeout(300_000);
  const owner = await registerAccount(browser, `forsta.${unique()}@exempel.se`, "Fia Första");
  await warmRoute(owner, "/api/organizer/map-projects/new", "POST");
  await warmRoute(owner, "/api/account/map-sources/lantmateriet");
  const island = { crs: "WGS84", rings: [[[17.776, 59.303], [17.79, 59.301], [17.804, 59.304], [17.806, 59.311], [17.792, 59.314], [17.778, 59.31], [17.776, 59.303]]] };
  const created = await owner.request.post("/api/organizer/map-projects/new", { headers: { origin: baseURL!, "x-otid-csrf": await csrfOf(owner) },
    data: { formatVersion: 1, requestId: crypto.randomUUID(), name: "Första", symbolSet: "ISOM2017-2", scale: 10000, declination: 6.5, area: island } });
  expect(created.status(), await created.text()).toBeLessThan(300);
  const projectId = (await created.json() as { projectId: string }).projectId;

  // Projektsidan: steg 1 är grundkartan, med kontots läge hos Lantmäteriet; en «Öppna kartan».
  await owner.setViewportSize({ width: 1280, height: 900 });
  await owner.goto(`/organizer/map-projects/${projectId}`);
  const base = owner.getByTestId("map-project-step-base");
  await expect(base).toHaveAttribute("data-next", "true", { timeout: 60_000 });
  await expect(base.getByRole("heading", { level: 3 })).toContainText("Ta fram grundkartan");
  const status = base.getByTestId("lantmateriet-status");
  await expect(status).toHaveAttribute("data-link", "missing");
  await expect(status).toContainText("Lantmäteriet: inte kopplat än.");
  await expect(status.getByRole("button", { name: "Så kopplar du Lantmäteriet" })).toBeVisible();
  await expect(status.getByRole("link", { name: "Mitt konto" })).toHaveAttribute("href", "/konto#konto-lantmateriet");
  await expect(owner.getByTestId("map-project-open-map")).toHaveCount(1);

  // Kartan: en ny karta utan objekt öppnas i fliken Grundkarta.
  await owner.getByTestId("map-project-open-map").click();
  await expect(owner.getByTestId("course-setting-map")).toHaveAttribute("data-drawn", "true", { timeout: 90_000 });
  const tabs = owner.locator("#map-project-sidebar").getByRole("tab");
  await expect(tabs).toHaveText(["Grundkarta", "Symboler", "Lager", "Granska", "Bearbeta"]);
  await expect(owner.getByTestId("map-project-tab-basemap")).toHaveAttribute("aria-selected", "true");
  const panel = owner.getByTestId("map-project-basemap");
  await expect(panel).toContainText("steg 2 och 3 behövs, steg 1 är valfritt");

  // Guiden: kontots läge i första delsteget och ett lugnt besked i nästa, med länkarna.
  const guide = panel.getByTestId("map-project-guide");
  await expect(guide).toHaveAttribute("data-step", "run");
  await expect(guide.getByTestId("lantmateriet-status")).toHaveAttribute("data-link", "missing");
  const notice = guide.getByTestId("map-project-guide-credential").getByTestId("lantmateriet-notice");
  await expect(notice).toHaveAttribute("data-problem", "missing");
  await expect(notice).toContainText("Lantmäteriet är inte kopplat än");
  await expect(notice).toHaveAttribute("role", "status");
  await expect(guide.getByRole("alert")).toHaveCount(0);
  await expect(notice.getByRole("link", { name: "Mitt konto" })).toHaveAttribute("href", "/konto#konto-lantmateriet");
  await notice.getByRole("button", { name: "Så kopplar du Lantmäteriet" }).click();
  const help = owner.getByRole("dialog");
  await expect(help.locator("[data-help-article='lantmateriet-koppla']")).toHaveAttribute("open", "");
  await expect(help.locator("[data-help-article='lantmateriet-koppla']")).toContainText("Laserdata Nedladdning, skog");
  await owner.keyboard.press("Escape");
  await expect(help).toHaveCount(0);

  // Laserkörningarna (avancerat) är en utfällning sist i guiden, med samma besked.
  const laser = guide.getByTestId("map-project-laser");
  await laser.locator("summary").first().click();
  await expect(laser.getByTestId("lantmateriet-notice")).toHaveAttribute("data-problem", "missing");

  // Lager: bara lagren, och kartans inställningar i en stängd utfällning.
  await owner.getByTestId("map-project-tab-layers").click();
  const layers = owner.locator("#map-project-tabpanel-layers");
  await expect(layers.getByTestId("map-project-guide")).toHaveCount(0);
  await expect(layers.getByTestId("map-project-layers").getByRole("heading", { level: 2 })).toHaveText("Underlag");
  await expect(layers.getByTestId("map-project-map-settings")).not.toHaveAttribute("open", "");

  // Granska: «Till Exportera» sist, efter normkontrollen, till projektsidans Exportera.
  await owner.getByTestId("map-project-tab-review").click();
  const review = owner.locator("#map-project-tabpanel-review");
  const toExport = review.getByTestId("map-project-to-export-link");
  await expect(toExport).toHaveText("Till Exportera");
  const order = await review.evaluate(element => [...element.querySelectorAll("[data-testid='map-project-norm'], [data-testid='map-project-to-export']")]
    .map(node => node.getAttribute("data-testid")));
  expect(order).toEqual(["map-project-norm", "map-project-to-export"]);
  await toExport.click();
  await expect(owner).toHaveURL(new RegExp(`/organizer/map-projects/${projectId}#exportera$`), { timeout: 60_000 });
  await expect(owner.locator("#exportera").getByRole("heading", { level: 2 })).toHaveText("Exportera");

  // Telefonen: fem flikar utan att sidan rullar i sidled.
  await owner.setViewportSize({ width: 390, height: 844 });
  await owner.goto(`/organizer/map-projects/${projectId}/map`);
  await expect(owner.getByTestId("course-setting-map")).toHaveAttribute("data-drawn", "true", { timeout: 90_000 });
  await owner.getByRole("button", { name: "Panel", exact: true }).click();
  await expect(owner.getByTestId("map-project-tab-basemap")).toBeVisible();
  expect(await owner.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);

  // Mitt konto: produkterna att beställa bredvid fälten.
  await owner.goto("/konto");
  const products = owner.locator("#konto-lantmateriet").getByTestId("lantmateriet-products");
  await expect(products).toContainText("Laserdata Nedladdning, skog", { timeout: 60_000 });
  await expect(products.locator("tr[data-first='true']")).toHaveCount(1);
});
