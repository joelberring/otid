import { expect, test } from "@playwright/test";
import { latestMailTo } from "./fake-smtp";
import { registerAccount, reviewScreenshots, unique, warmRoute } from "./helpers";

/**
 * ADR-0221: terminsplaneringen. Ägaren skapar klubben, lägger till terminen, en träning varje vecka och en uppgift till en
 * förälders adress, och skapar träningen. Föräldern får mejlet, skapar konto med adressen, ser bara sin uppgift under Mina
 * uppgifter, öppnar banläggningen (läsrätt) och bockar av uppgiften.
 */
test("terminsplanering: termin, varje vecka, uppgift med e-post, Skapa träningen och Mina uppgifter", async ({ browser }) => {
  test.setTimeout(180_000);
  const suffix = unique();
  const owner = await registerAccount(browser, `planerare.${suffix}@exempel.se`, "Petra Planerare");
  for (const path of ["/api/organizer/clubs", "/organizer/clubs/00000000-0000-4000-8000-000000000000"]) await warmRoute(owner, path);
  await owner.goto("/organizer");
  const clubs = owner.getByRole("region", { name: "Mina klubbar" });
  await clubs.getByRole("button", { name: "Ny klubbyta" }).click();
  await clubs.getByLabel("Klubbens namn").fill(`OK Planering ${suffix}`);
  await clubs.getByRole("button", { name: "Skapa klubben" }).click();
  await owner.waitForURL(/\/organizer\/clubs\/[0-9a-f-]+$/);

  await owner.getByRole("tab", { name: "Planering" }).click();
  const planning = owner.getByTestId("club-planning");
  await expect(planning.getByText("Inga terminer än.", { exact: false })).toBeVisible({ timeout: 30_000 });
  await planning.getByRole("button", { name: "Ny termin" }).click();
  await planning.getByLabel("Namn").fill("VT 2027");
  await planning.getByLabel("Första dagen").fill("2027-01-04");
  await planning.getByLabel("Sista dagen").fill("2027-03-28");
  await planning.getByRole("button", { name: "Spara terminen" }).click();
  await expect(planning.getByRole("heading", { name: /VT 2027/ })).toBeVisible();
  await expect(planning.getByTestId("plan-week")).toHaveCount(12);
  await expect(planning.getByTestId("plan-week").first()).toContainText("Ingen träning planerad.");

  // Vecka 2: tisdagsträningen varje vecka till terminens slut.
  await planning.getByRole("button", { name: "Lägg till träning vecka 2" }).click();
  const form = planning.getByTestId("plan-session-form");
  await form.getByLabel("Datum").fill("2027-01-12");
  await form.getByLabel("Tid").fill("18:00");
  await form.getByLabel("Rubrik eller övning").fill("Kurvbildsträning");
  await form.getByLabel("Plats").fill("Älvsjöskogen");
  await form.getByLabel("Ansvarig").selectOption({ label: "Petra Planerare" });
  // ADR-0222: moment, nivå och egna ord.
  await form.getByRole("button", { name: "Kurvbild" }).click();
  await form.getByRole("button", { name: "Gul" }).click();
  await form.getByLabel("Egna ord").fill("Ungdom");
  await form.getByText("Varje vecka till terminens slut").click();
  await expect(form.getByText("Samma träning varje tisdag", { exact: false })).toBeVisible();
  await form.getByRole("button", { name: "Spara" }).click();
  await expect(planning.getByText("11 träningar är tillagda.")).toBeVisible();
  const first = planning.getByTestId("plan-session").first();
  await expect(first).toContainText("Kurvbildsträning");
  await expect(first).toContainText("Ansvarig: Petra Planerare");
  await expect(first.getByTestId("moment-badges")).toContainText("Gul");
  await expect(first.getByTestId("moment-badges")).toContainText("Kurvbild");
  await expect(first.getByTestId("moment-badges")).toContainText("Ungdom");
  await expect(planning.getByTestId("plan-week").first()).toContainText("Ingen träning planerad.");

  // En uppgift till en förälders adress (som inte har konto än).
  const parentEmail = `foralder.${suffix}@exempel.se`;
  await first.getByRole("button", { name: "Lägg till uppgift" }).click();
  await first.getByLabel("Uppgift", { exact: true }).fill("Sätta ut kontroller");
  await first.getByLabel("Vem").selectOption("EMAIL");
  await first.getByLabel("E-postadress", { exact: true }).fill(parentEmail);
  await first.getByRole("button", { name: "Lägg till uppgift" }).click();
  await expect(planning.getByText("Uppgiften är tillagd och ett mejl är skickat.")).toBeVisible();
  await expect(first.getByTestId("plan-task")).toContainText(`Sätta ut kontroller · ${parentEmail} (väntar på inloggning)`);
  await expect.poll(() => latestMailTo(parentEmail, /Sätta ut kontroller/)?.text ?? "", { timeout: 20_000 }).toContain("Kurvbildsträning");
  // Användartestet 2026-11-12 (D): adressen har inget konto, så mejlet säger att det ska skapas och länkar till Skapa konto.
  expect(latestMailTo(parentEmail, /Sätta ut kontroller/)?.text ?? "").toContain("/organizer?konto=skapa");

  // Skapa träningen: länkarna till träningen och banläggningen.
  await first.getByRole("button", { name: "Skapa träningen" }).click();
  await expect(planning.getByText("Träningen är skapad.")).toBeVisible();
  await expect(first.getByRole("link", { name: "Banläggningen" })).toBeVisible();
  await reviewScreenshots(owner, "terminsplanering");
  // Skriv ut terminen (översynen G6): en egen sida med bara planen, utan knappar vid utskrift.
  const [printPage] = await Promise.all([owner.context().waitForEvent("page"), planning.getByRole("link", { name: "Skriv ut terminen" }).click()]);
  const printed = printPage.getByTestId("plan-print");
  await expect(printed.getByRole("heading", { name: /VT 2027/ })).toBeVisible({ timeout: 30_000 });
  await expect(printed).toContainText("Kurvbildsträning");
  await expect(printed).toContainText("Sätta ut kontroller");
  await printPage.emulateMedia({ media: "print" });
  await expect(printed.getByRole("button", { name: "Skriv ut" })).toBeHidden();
  if (process.env.E2E_SCREENSHOT_DIR) await printPage.screenshot({ path: `${process.env.E2E_SCREENSHOT_DIR}/terminsplanering-utskrift.png`, fullPage: true });
  await printPage.close();

  // Översynen B1 och B2: en ny termin visas direkt, "Ändra terminen" visar den valda terminen (inte förslaget för en ny),
  // och en tom termin tas bort utan fel.
  await planning.getByRole("button", { name: "Ny termin" }).click();
  await planning.getByLabel("Namn").fill("HT 2027");
  await planning.getByLabel("Första dagen").fill("2027-08-16");
  await planning.getByLabel("Sista dagen").fill("2027-12-19");
  await planning.getByRole("button", { name: "Spara terminen" }).click();
  await expect(planning.getByRole("heading", { name: /HT 2027/ })).toBeVisible();
  await planning.getByRole("button", { name: "Ny termin" }).click();
  await planning.getByRole("button", { name: "Ändra terminen" }).click();
  await expect(planning.getByLabel("Namn")).toHaveValue("HT 2027");
  owner.once("dialog", dialog => void dialog.accept());
  await planning.getByRole("button", { name: "Ta bort terminen" }).click();
  await expect(planning.getByRole("heading", { name: /VT 2027/ })).toBeVisible();
  await expect(planning.getByRole("alert")).toHaveCount(0);

  // Föräldern: kontot med adressen, Mina uppgifter och banläggningen.
  const parent = await registerAccount(browser, parentEmail, "Fia Förälder");
  await parent.goto("/organizer");
  const mine = parent.getByTestId("my-plan-tasks");
  await expect(mine).toBeVisible({ timeout: 30_000 });
  await expect(mine.getByTestId("my-plan-task")).toHaveCount(1);
  await expect(mine).toContainText("Sätta ut kontroller");
  await expect(mine).toContainText("Ansvarig: Petra Planerare");
  await reviewScreenshots(parent, "mina-uppgifter");
  await mine.getByLabel("Klar: Sätta ut kontroller").check();
  await expect(mine.getByLabel("Klar: Sätta ut kontroller")).toBeChecked();
  await mine.getByRole("link", { name: "Öppna banläggningen" }).click();
  await parent.waitForURL(/\/admin\/[0-9a-f-]+\/course-setting/);
  // Läsrätten: banläggningen öppnas (utan karta än) och säger att ägaren eller en administratör laddar upp kartfilen.
  await expect(parent.getByText("Ägaren eller en administratör laddar upp kartfilen.", { exact: false })).toBeVisible({ timeout: 30_000 });

  // Ledaren ser att uppgiften är klar.
  await owner.reload();
  await owner.getByRole("tab", { name: "Planering" }).click();
  await expect(owner.getByTestId("plan-task").first().getByRole("checkbox")).toBeChecked({ timeout: 30_000 });
  await Promise.all([owner.context().close(), parent.context().close()]);
});
