import { expect, test, type Page } from "@playwright/test";
import { registerAccount, reviewScreenshots, today, unique, warmRoute } from "./helpers";

/**
 * Översynen av navet 2026-11-17: /organizer heter Mitt O-Tid och har fyra val överst. "Lägg banor" skapar en träning i
 * bakgrunden (namnet går att byta) och öppnar banläggningen, och erbjuder sedan den befintliga. Klubbfrågan är ett block bara
 * första gången, därefter en rad. Knappen i formuläret följer typen, listans knappar står i ordningen Öppna arbetsytan,
 * Banläggning, Kopiera, och Återställ från säkerhetskopia ligger under Mer. Kom igång och hjälpartikeln för den som är ny.
 */
async function fitsWidth(page: Page, width: number) {
  await page.setViewportSize({ width, height: 900 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
  for (const choice of await page.getByTestId("hub-choices").locator("li > *").all()) {
    const box = (await choice.boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(width);
    expect(box.height).toBeGreaterThanOrEqual(44);
  }
}

test("Mitt O-Tid: fyra val, Lägg banor direkt, klubbfrågan på en rad, knapparnas namn och ordning, Mer", async ({ browser }) => {
  test.setTimeout(300_000);
  const suffix = unique();
  const owner = await registerAccount(browser, `navet.${suffix}@exempel.se`, "Nora Nav");
  await warmRoute(owner, "/admin/00000000-0000-4000-8000-000000000000/course-setting");

  // Namnet och de fyra valen.
  await expect(owner).toHaveTitle("Mitt O-Tid – O-Tid");
  await expect(owner.getByRole("heading", { name: "Mitt O-Tid", level: 1 })).toBeVisible();
  const choices = owner.getByRole("navigation", { name: "Vad vill du göra?" });
  await expect(choices.getByRole("link", { name: "Ta fram en karta" })).toHaveAttribute("href", "/organizer/map-projects");
  await expect(choices.getByRole("button", { name: "Lägg banor" })).toHaveAttribute("aria-expanded", "false");
  await expect(choices.getByRole("link", { name: "Skapa träning eller tävling" })).toHaveAttribute("href", "#organizer-create-event");
  await expect(choices.getByRole("link", { name: "Min klubb" })).toHaveAttribute("href", "#mina-klubbar");

  // Första besöket: klubbfrågan som block, Kom igång och hjälpartikeln för den som är ny.
  await expect(owner.getByRole("heading", { name: "Vilken klubb tillhör du?" })).toBeVisible();
  const start = owner.getByTestId("hub-start");
  await expect(start.getByTestId("hub-start-account")).toHaveAttribute("data-done", "true");
  await expect(start.getByTestId("hub-start-course")).toHaveAttribute("data-next", "true");
  await choices.getByRole("button", { name: "Kom igång: lägga en träning på 10 minuter" }).click();
  const help = owner.getByRole("dialog", { name: "Hjälp" });
  await expect(help.locator("details[open] > summary").first()).toHaveText("Kom igång: lägga en träning på 10 minuter");
  await owner.keyboard.press("Escape");
  await expect(help).toBeHidden();

  // Återställ från säkerhetskopia under Mer.
  const restore = owner.getByRole("button", { name: "Återställ tävling från säkerhetskopia" });
  await expect(restore).toBeHidden();
  await owner.getByTestId("hub-more").locator("summary").click();
  await expect(restore).toBeVisible();

  // Knappen i formuläret följer typen.
  const submit = owner.getByTestId("create-race-submit");
  await expect(submit).toHaveText("Skapa träning");
  await owner.getByRole("radio", { name: "Tävling", exact: true }).check();
  await expect(submit).toHaveText("Skapa tävling");
  await owner.getByRole("radio", { name: "Stafett", exact: true }).check();
  await expect(submit).toHaveText("Skapa stafett");

  await reviewScreenshots(owner, "navet-ny");
  for (const width of [1280, 390]) await fitsWidth(owner, width);
  await owner.setViewportSize({ width: 1280, height: 900 });

  // Andra besöket: klubbfrågan på en rad, som går att fälla ut.
  await owner.reload();
  const line = owner.getByTestId("club-step");
  await expect(line).toHaveAttribute("data-variant", "line");
  await expect(line).toContainText("Vilken klubb tillhör du? Valfritt.");
  await expect(owner.getByRole("heading", { name: "Vilken klubb tillhör du?" })).toHaveCount(0);
  await line.getByRole("button", { name: "Välj klubb" }).click();
  await expect(owner.getByRole("heading", { name: "Vilken klubb tillhör du?" })).toBeVisible();

  // Lägg banor: en träning med förvalt namn (som går att byta); utan klubbar inget klubbval. Banläggningen öppnas direkt.
  await choices.getByRole("button", { name: "Lägg banor" }).click();
  const quick = owner.getByTestId("quick-course");
  await expect(quick.getByLabel("Namn")).toHaveValue(`Banläggning ${today()}`);
  await expect(quick.getByRole("button", { name: "Starta banläggningen" })).toBeEnabled();
  await expect(quick.getByTestId("quick-course-organiser")).toHaveCount(0);
  await expect(quick.getByTestId("quick-course-existing")).toHaveCount(0);
  await reviewScreenshots(owner, "navet-lagg-banor");
  await quick.getByLabel("Namn").fill(`Banor ${suffix}`);
  await quick.getByRole("button", { name: "Starta banläggningen" }).click();
  await owner.waitForURL(/\/admin\/[0-9a-f-]+\/course-setting$/, { timeout: 120_000 });
  const raceId = owner.url().split("/").at(-2)!;

  // Tillbaka i navet: träningen i listan med knapparna i ordning, och Lägg banor erbjuder den.
  await owner.goto("/organizer");
  const row = owner.getByRole("listitem").filter({ has: owner.getByRole("heading", { name: `Banor ${suffix}` }) });
  await expect(row).toContainText("Träning");
  await expect(row.getByRole("button")).toHaveText(["Öppna arbetsytan", "Banläggning", "Kopiera"]);
  await expect(owner.getByTestId("hub-start")).toHaveCount(0);
  await choices.getByRole("button", { name: "Lägg banor" }).click();
  await quick.getByTestId("quick-course-existing").getByRole("button", { name: new RegExp(`Banor ${suffix}`) }).click();
  await owner.waitForURL(new RegExp(`/admin/${raceId}/course-setting$`), { timeout: 120_000 });

  await owner.goto("/organizer");
  await reviewScreenshots(owner, "navet-med-traning");
  for (const width of [1280, 390]) await fitsWidth(owner, width);
});
