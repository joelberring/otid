import { expect, test } from "@playwright/test";
import { createRace, publishRaceViaApi, registerAccount, today, unique } from "./helpers";

/**
 * Mastermind med kontroller från en träning (PR #2): förklaringen överst, valet i sidopanelen (och under Mer i tävlingsraden) öppnar spelets
 * statiska skal med träningens id. Övningsstationen: första utläsningen startar spelet, en gissning med fyra färger får
 * svarta/vita stift, och spelen sparas i webbläsaren per träning och på servern (ADR-0228), där den publika ställningen visar
 * spelet utan mönstret. Med "Spela på egen dator" påslaget spelar en besökare utan inloggning från tävlingssidan i samma
 * ställning. I telefonbredd har skalet den smala raden med Byt funktion.
 */
test("Mastermind med kontroller: från träningen, övningsstationen, en gissning och raden i telefonbredd", async ({ browser }) => {
  test.setTimeout(240_000);
  const suffix = unique();
  const owner = await registerAccount(browser, `mastermind.${suffix}@exempel.se`, "Mia Mästare");
  const raceId = await createRace(owner, `Mastermind ${suffix}`, today(), "Träning");

  await owner.getByTestId("nav-mastermind").click();
  await owner.waitForURL(`**/mastermind/index.html#${raceId}`);
  const training = owner.getByTestId("mastermind-training");
  await expect(training).toContainText(`Mastermind ${suffix}`, { timeout: 30_000 });
  await expect(training.getByRole("link", { name: "‹ Till träningen" })).toHaveAttribute("href", `/admin/${raceId}`);

  // Förklaringen är öppen tills något spel finns.
  const about = owner.getByTestId("mastermind-about");
  await expect(about).toHaveAttribute("open", "");
  await expect(about).toContainText("Flera lag kan spela samtidigt");
  await owner.getByRole("button", { name: "Övningsstation" }).click();
  await expect(owner.getByRole("status").filter({ hasText: "är redo" })).toBeVisible({ timeout: 30_000 });
  const practice = owner.getByRole("region", { name: "Övningsstation" });
  await practice.getByRole("button", { name: "Läs ut brickan" }).click();
  await expect(owner.getByText("Spelet har startat")).toBeVisible({ timeout: 30_000 });
  for (const code of [31, 32, 33, 34]) await practice.getByRole("button", { name: new RegExp(` ${code}$`) }).click();
  await practice.getByRole("button", { name: "Läs ut brickan" }).click();
  await expect(owner.locator(".mm-message")).toContainText(/svarta, \d vita|Knäckt/, { timeout: 30_000 });
  await expect(owner.locator(".mm-row:not(.mm-row-blank):not(.mm-secret)")).toHaveCount(1);

  // Spelen sparas per träning: utan träningens id är listan tom.
  const stored = await owner.evaluate((id) => Object.keys(localStorage).filter(key => key.startsWith("otid.mastermind.v1")).includes(`otid.mastermind.v1.${id}`), raceId);
  expect(stored).toBe(true);

  // ADR-0228: spelet når servern, och den publika ställningen (publicerad träning, träningsdagen) visar det utan mönster och
  // utan hela bricknumret.
  await expect(owner.getByTestId("mastermind-sync")).toContainText("sparade på servern", { timeout: 30_000 });
  await publishRaceViaApi(owner, raceId);
  const visitor = await (await browser.newContext()).newPage();
  const standings = await visitor.request.get(`/api/public/races/${raceId}/mastermind`);
  expect(standings.status()).toBe(200);
  const board = await standings.json() as { rows: Record<string, unknown>[] };
  expect(board.rows).toEqual([expect.objectContaining({ cardEnd: "001", guesses: 1 })]);
  expect(JSON.stringify(board)).not.toMatch(/secret|7000001/);

  // "Spela på egen dator": administratören slår på det; en besökare utan inloggning spelar på sin egen dator och spelet
  // hamnar i samma ställning. Tävlingssidan visar knappen och ställningen.
  await owner.getByLabel("Låt lagen spela på egen dator").check();
  await expect(owner.getByLabel("Låt lagen spela på egen dator")).toBeChecked();
  await visitor.goto(`/mastermind/index.html#spela:${raceId}`);
  const back = visitor.getByRole("link", { name: "‹ Till tävlingssidan" });
  await expect(back).toHaveAttribute("href", /^\/t\/[2-9a-hjkmnp-z]{6}$/, { timeout: 30_000 });
  await expect(visitor.getByText("Inställningar", { exact: true })).toHaveCount(0);
  await visitor.getByRole("button", { name: "Övningsstation" }).click();
  const visitorPractice = visitor.getByRole("region", { name: "Övningsstation" });
  // En annan bricka än arrangörens (en bricka har ett spel i taget i ställningen).
  await visitorPractice.getByRole("combobox").selectOption("7000002");
  await expect(visitorPractice.getByRole("combobox")).toHaveValue("7000002");
  await visitorPractice.getByRole("button", { name: "Läs ut brickan" }).click();
  await expect(visitor.getByText("Spelet har startat")).toBeVisible({ timeout: 30_000 });
  await expect(visitor.getByRole("heading", { name: "Bricka 7000002" })).toBeVisible();
  await expect(visitor.getByTestId("mastermind-sync")).toContainText("sparade på servern", { timeout: 30_000 });
  await back.click();
  const hub = visitor.getByTestId("hub-mastermind");
  await expect(hub.getByTestId("hub-mastermind-play")).toHaveAttribute("href", `/mastermind/index.html#spela:${raceId}`);
  await expect(hub.getByTestId("mastermind-board").locator("tbody tr")).toHaveCount(2);

  // Arrangören avbryter besökarens spel från spelsidan: det försvinner ur ställningen, också på tävlingssidan.
  owner.once("dialog", dialog => void dialog.accept());
  await owner.getByRole("button", { name: "Avbryt spelet för Bricka 7000002" }).click({ timeout: 30_000 });
  await expect(owner.getByText("Spelet för Bricka 7000002 är avbrutet")).toBeVisible();
  await expect(async () => {
    await visitor.reload();
    await expect(visitor.getByTestId("mastermind-board").locator("tbody tr")).toHaveCount(1, { timeout: 2_000 });
  }).toPass({ timeout: 30_000 });
  await visitor.context().close();

  // Telefonbredd: den smala raden visar Mastermind och Byt funktion leder till träningens övriga val.
  await owner.setViewportSize({ width: 390, height: 844 });
  const bar = owner.getByTestId("race-narrow-bar");
  await expect(bar).toContainText("Mastermind");
  await bar.getByRole("button", { name: "Byt funktion" }).click();
  await expect(owner.getByTestId("race-switch-sheet")).toContainText("Avläsning");
});
