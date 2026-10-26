import { expect, test, type Locator, type Page } from "@playwright/test";
import { addCourseAndClass, createRace, openStep, publishRace, registerAccount, unique } from "./helpers";

/**
 * Steg 56 (ADR-0174 beslut 10): stafettformulären med fel vid fälten, bana per sträcka och mallar.
 * 1. Spara utan bana och tid ger fel vid fälten (och överst), fokus på första felet; byt mall Teamsprint → Vanlig stafett;
 *    sedan går det att spara (masstart skriven 1830).
 * 2. Teamsprint och ungdomsstafett från mall, där ungdomsstafettens sträcka 2 har en annan bana: lagformulärets fel vid
 *    fälten, lagkortet, "Ändra stafettklass" och den publika resultatlistan visar banan per sträcka.
 */
async function compileRoutes(page: Page, raceId: string) {
  for (const path of ["relay", "relay-classes", "relay-teams"]) {
    await page.request.get(`/api/admin/races/${raceId}/administrator/${path}`, { timeout: 120_000 });
  }
  await page.request.get(`/api/public/races/${raceId}/relay-results`, { timeout: 120_000 });
}

async function openNewClass(owner: Page) {
  await openStep(owner, "Klasser & sträckor");
  await owner.getByText("Ny stafettklass").click();
  return owner.getByRole("form", { name: "Ny stafettklass" });
}

async function expectFieldError(form: Locator, label: string, message: string) {
  const field = form.getByLabel(label, { exact: true });
  await expect(field).toHaveAttribute("aria-invalid", "true");
  await expect(field).toHaveAccessibleDescription(new RegExp(message.replace(/[.()]/g, "\\$&")));
}

test("stafettklass: fel vid fälten, byt mall och spara", async ({ browser }) => {
  test.setTimeout(300_000);
  const suffix = unique();
  const owner = await registerAccount(browser, `form56.${suffix}@exempel.se`, "Fia Formulär");
  const raceId = await createRace(owner, `Formulärstafett ${suffix}`, undefined, "Stafett");
  await publishRace(owner);
  await addCourseAndClass(owner, "Lång", "Långklass", "31 32 33");
  await addCourseAndClass(owner, "Kort", "Kortklass", "41 42");
  await compileRoutes(owner, raceId);

  const form = await openNewClass(owner);
  await form.getByLabel("Klassnamn").fill("Kvällsstafett");
  await form.getByRole("button", { name: "Spara stafettklass" }).click();
  // Felen står vid fälten och sammanfattas överst; fokus går till det första.
  await expect(form.getByRole("alert")).toContainText("Rätta 4 fält innan du sparar:");
  await expectFieldError(form, "Bana sträcka 1", "Välj bana för sträcka 1.");
  await expectFieldError(form, "Bana sträcka 3", "Välj bana för sträcka 3.");
  await expectFieldError(form, "Masstart sträcka 1", "Skriv masstarttiden för sträcka 1 som klockslag, till exempel 18:30.");
  await expect(form.getByLabel("Bana sträcka 1", { exact: true })).toBeFocused();
  await expect(form.getByLabel("Klassnamn")).not.toHaveAttribute("aria-invalid", "true");

  // Mall: teamsprint sätter sträckor och inställningar (Fler inställningar öppnas), inte namnet.
  const teamSprint = form.getByRole("button", { name: "Teamsprint (2 löpare × 4 sträckor)" });
  await teamSprint.click();
  await expect(teamSprint).toHaveAttribute("aria-pressed", "true");
  await expect(form.getByRole("status")).toContainText("Teamsprint: 4 sträckor med växling, utläsning efter varje sträcka.");
  await expect(form.getByLabel("Antal sträckor")).toHaveValue("4");
  await expect(form.getByLabel("Teamsprint", { exact: true })).toHaveValue("EACH_LEG");
  await expect(form.getByLabel("Klassnamn")).toHaveValue("Kvällsstafett");
  // "Gaffling" visas bara för gafflade banor och "Lag i omstart" bara när någon sträcka har omstart.
  await expect(form.getByLabel("Gaffling", { exact: true })).toHaveCount(0);
  await expect(form.getByLabel("Lag i omstart")).toHaveCount(0);
  const screenshots = process.env.E2E_SCREENSHOT_DIR;
  if (screenshots) {
    // Hela formuläret ur en helsidesbild, så att den fasta rubriken inte ligger över det.
    await owner.setViewportSize({ width: 1280, height: 900 });
    await owner.evaluate(() => window.scrollTo(0, 0));
    const box = (await form.boundingBox())!;
    await owner.screenshot({ path: `${screenshots}/stafettklass-1280.png`, fullPage: true,
      clip: { x: Math.max(0, box.x - 16), y: Math.max(0, box.y - 56), width: box.width + 32, height: box.height + 72 } });
  }

  // Tillbaka till en vanlig stafett: tre sträckor, ingen teamsprint.
  const standard = form.getByRole("button", { name: "Vanlig stafett (3 sträckor)" });
  await standard.click();
  await expect(standard).toHaveAttribute("aria-pressed", "true");
  await expect(teamSprint).toHaveAttribute("aria-pressed", "false");
  await expect(form.getByLabel("Antal sträckor")).toHaveValue("3");
  await expect(form.getByLabel("Teamsprint", { exact: true })).toHaveValue("");
  await expect(form.getByLabel("Startsätt sträcka 2")).toHaveValue("CHANGEOVER");

  // Linjestafett: flygande omstart, och då visas "Lag i omstart".
  await form.getByRole("button", { name: "Linjestafett med flygande omstart" }).click();
  await expect(form.getByLabel("Minuter efter ledaren sträcka 2")).toHaveValue("60");
  await expect(form.getByLabel("Lag i omstart")).toBeVisible();
  await standard.click();

  // Snabbvalet fyller i alla sträckor; sträcka 2 får en annan bana. Masstarten skriven 1830.
  await form.getByLabel("Samma bana på alla sträckor").selectOption({ label: "Lång" });
  await expect(form.getByLabel("Bana sträcka 3", { exact: true })).not.toHaveAttribute("aria-invalid", "true");
  await form.getByLabel("Bana sträcka 2", { exact: true }).selectOption({ label: "Kort" });
  await form.getByLabel("Masstart sträcka 1").fill("1830");
  await form.getByRole("button", { name: "Spara stafettklass" }).click();
  await expect(owner.getByText("Stafettklassen Kvällsstafett är sparad.")).toBeVisible();
  await expect(form.getByRole("alert")).toHaveCount(0);

  // Samma namn igen: felet står vid klassnamnet.
  await form.getByLabel("Klassnamn").fill("Kvällsstafett");
  await form.getByLabel("Samma bana på alla sträckor").selectOption({ label: "Lång" });
  await form.getByLabel("Masstart sträcka 1").fill("18.30");
  await form.getByRole("button", { name: "Spara stafettklass" }).click();
  await expectFieldError(form, "Klassnamn", "Det finns redan en klass med det namnet i tävlingen.");

  // Ändra stafettklass visar banan per sträcka, och fel vid fälten även där.
  await owner.getByText("Ändra stafettklass").click();
  await owner.getByLabel("Stafettklass att ändra").selectOption({ label: "Kvällsstafett" });
  const edit = owner.getByRole("form", { name: "Ändra stafettklass" });
  await expect(edit.getByLabel("Bana sträcka 1", { exact: true }).locator("option:checked")).toHaveText("Lång");
  await expect(edit.getByLabel("Bana sträcka 2", { exact: true }).locator("option:checked")).toHaveText("Kort");
  await expect(edit.getByLabel("Masstart sträcka 1")).toHaveValue("18:30");
  await edit.getByLabel("Masstart sträcka 1").fill("25.00");
  await edit.getByRole("button", { name: "Spara ändringen" }).click();
  await expectFieldError(edit, "Masstart sträcka 1", "Skriv masstarttiden för sträcka 1 som klockslag");
  await expect(edit.getByLabel("Masstart sträcka 1")).toBeFocused();
});

test("teamsprint och ungdomsstafett från mall; sträcka 2 med annan bana syns per sträcka", async ({ browser }) => {
  test.setTimeout(300_000);
  const suffix = unique();
  const owner = await registerAccount(browser, `mall56.${suffix}@exempel.se`, "Mats Mall");
  const raceId = await createRace(owner, `Mallstafett ${suffix}`, undefined, "Stafett");
  await publishRace(owner);
  await addCourseAndClass(owner, "Sprintslinga", "Träning", "31 32 33");
  await addCourseAndClass(owner, "Ungdomsbana", "Ungdom kort", "41 42 43");
  await addCourseAndClass(owner, "Knattebana", "Knatte", "51 52");
  await compileRoutes(owner, raceId);

  let form = await openNewClass(owner);
  await form.getByRole("button", { name: "Teamsprint (2 löpare × 4 sträckor)" }).click();
  await form.getByLabel("Klassnamn").fill("Teamsprint");
  await form.getByLabel("Samma bana på alla sträckor").selectOption({ label: "Sprintslinga" });
  await form.getByLabel("Masstart sträcka 1").fill("1830");
  await form.getByRole("button", { name: "Spara stafettklass" }).click();
  await expect(owner.getByText("Stafettklassen Teamsprint är sparad.")).toBeVisible();

  form = owner.getByRole("form", { name: "Ny stafettklass" });
  await form.getByRole("button", { name: "Ungdomsstafett (sträcka 2 med 2 löpare)" }).click();
  await expect(form.getByLabel("Löpare sträcka 2")).toHaveValue("2");
  await form.getByLabel("Klassnamn").fill("Ungdom");
  await form.getByLabel("Samma bana på alla sträckor").selectOption({ label: "Ungdomsbana" });
  await form.getByLabel("Bana sträcka 2", { exact: true }).selectOption({ label: "Knattebana" });
  await form.getByLabel("Masstart sträcka 1").fill("18:30");
  await form.getByRole("button", { name: "Spara stafettklass" }).click();
  await expect(owner.getByText("Stafettklassen Ungdom är sparad.")).toBeVisible();

  // Lagformuläret: fel vid fälten, sedan sparat.
  await openStep(owner, "Lag");
  const view = owner.getByRole("region", { name: "Lag", exact: true });
  await view.getByText("Nytt lag").click();
  const teamForm = owner.getByRole("form", { name: "Nytt lag" });
  await teamForm.getByLabel("Stafettklass").selectOption({ label: "Ungdom" });
  await teamForm.getByLabel("Förnamn sträcka 1").fill("Ada");
  await teamForm.getByRole("button", { name: "Spara lag" }).click();
  await expect(teamForm.getByRole("alert")).toContainText("Rätta");
  await expectFieldError(teamForm, "Lagnamn", "Skriv lagets namn.");
  await expectFieldError(teamForm, "Efternamn sträcka 1", "Skriv efternamnet.");
  await expect(teamForm.getByLabel("Lagnamn")).toBeFocused();
  await teamForm.getByLabel("Lagnamn").fill("OK Unga");
  const slots = [[1, 1], [2, 1], [2, 2], [3, 1]] as const;
  for (const [leg, order] of slots) {
    const slot = leg === 2 ? `sträcka ${leg} löpare ${order}` : `sträcka ${leg}`;
    await teamForm.getByLabel(`Förnamn ${slot}`).fill(`U${leg}${order}`);
    await teamForm.getByLabel(`Efternamn ${slot}`).fill("Ung");
  }
  await teamForm.getByRole("button", { name: "Spara lag" }).click();
  await expect(owner.getByText("Lag 1 OK Unga är anmält.")).toBeVisible();

  // Lagkortet visar banan per sträcka eftersom sträckorna springer olika banor.
  await view.getByRole("button", { name: "Öppna lag 1 OK Unga" }).click();
  const card = owner.getByRole("region", { name: "Lagkort" });
  await expect(card.getByRole("row", { name: /^Sträcka 1/ })).toContainText("Ungdomsbana");
  await expect(card.getByRole("row", { name: /Sträcka 2 · löpare 1/ })).toContainText("Knattebana");

  // Publikt: lagresultatet visar sträckans bana.
  const visitor = await (await browser.newContext()).newPage();
  await visitor.goto(`/results/${raceId}`);
  const team = visitor.getByRole("table", { name: "Lagresultat Ungdom" });
  await expect(team).toContainText("Knattebana");
  await expect(team).toContainText("Ungdomsbana");
});
