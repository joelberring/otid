import { expect, test, type Page } from "@playwright/test";
import { addCourseAndClass, createRace, openStep, publishRace, registerAccount, unique } from "./helpers";

/**
 * Steg 48 (ADR-0174 beslut 6–7): flera löpare per sträcka.
 * 1. Ungdomsstafett: sträcka 2 har två löpare som springer samtidigt; laget växlar när första löparen är i mål och
 *    sträckan är godkänd när minst en är godkänd. Resultatlistan visar sträckans löpare i ordning och vem som växlade.
 * 2. Teamsprint: två löpare × fyra sträckor med en bricka per person och växlingskontroll; brickan läses ut efter löparens
 *    sista sträcka och delas vid växlingsstämplingarna.
 */
const TIME_ZONE = "Europe/Stockholm";
const BACK = 120;

function raceClock(back: number) {
  const now = new Date();
  const date = new Intl.DateTimeFormat("sv-SE", { timeZone: TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
  const [hour, minute] = new Intl.DateTimeFormat("sv-SE", { timeZone: TIME_ZONE, hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
    .format(now).split(":").map(Number) as [number, number];
  const start = Math.max(1, hour * 60 + minute - back);
  const clock = (offset: number) => `${String(Math.floor((start + offset) / 60)).padStart(2, "0")}:${String((start + offset) % 60).padStart(2, "0")}`;
  return { date, clock };
}

async function compileRoutes(page: Page, raceId: string) {
  for (const path of ["relay", "relay-classes", "relay-teams"]) {
    await page.request.get(`/api/admin/races/${raceId}/administrator/${path}`, { timeout: 120_000 });
  }
  await page.request.get(`/api/public/races/${raceId}/relay-results`, { timeout: 120_000 });
}

async function openReadout(page: Page, raceId: string) {
  await page.goto(`/admin/${raceId}/readout`);
  await page.waitForURL(`**/readout/index.html#${raceId}`);
  await expect(page.getByTestId("package-status")).toContainText("v");
  await page.getByRole("button", { name: "Starta övningsstation" }).click();
  await expect(page.getByTestId("station-status")).toContainText("Övningsstation");
}

async function read(page: Page, label: string | RegExp, ok = true) {
  const select = page.getByLabel("Deltagare");
  const option = typeof label === "string" ? label
    : await select.locator("option").filter({ hasText: label }).first().textContent();
  await select.selectOption({ label: option! });
  await page.getByRole("button", { name: ok ? "Läs av: rätt stämplat" : "Läs av: missad kontroll" }).click();
  await expect(page.getByTestId("verdict")).toContainText(ok ? "GODKÄND" : "FELSTÄMPLAD");
}

test("ungdomsstafett: två löpare på sträcka 2, växlar när första är i mål, godkänt när minst en är godkänd", async ({ browser }) => {
  test.setTimeout(360_000);
  const suffix = unique();
  const { date, clock } = raceClock(BACK);
  const owner = await registerAccount(browser, `ungdom48.${suffix}@exempel.se`, "Ulla Ungdom");
  const raceId = await createRace(owner, `Ungdomsstafett ${suffix}`, date, "Stafett");
  await publishRace(owner);
  await addCourseAndClass(owner, "Ungdomsbana", "Träning", "31 32 33");
  await compileRoutes(owner, raceId);

  await openStep(owner, "Klasser & sträckor");
  await owner.getByText("Ny stafettklass").click();
  const form = owner.getByRole("form", { name: "Ny stafettklass" });
  await form.getByLabel("Klassnamn").fill("Ungdom");
  await form.getByLabel("Bana").selectOption({ label: "Ungdomsbana" });
  await form.getByLabel("Masstart sträcka 1").fill(clock(0));
  await form.getByLabel("Löpare sträcka 2").selectOption("2");
  await form.getByLabel("Växlar när sträcka 2").selectOption("FIRST");
  await form.getByLabel("Godkänt när sträcka 2").selectOption("ANY");
  await form.getByRole("button", { name: "Spara stafettklass" }).click();
  await expect(owner.getByText("Stafettklassen Ungdom är sparad.")).toBeVisible();

  await openStep(owner, "Lag");
  const view = owner.getByRole("region", { name: "Lag", exact: true });
  await view.getByText("Nytt lag").click();
  const teamForm = owner.getByRole("form", { name: "Nytt lag" });
  await teamForm.getByLabel("Stafettklass").selectOption({ label: "Ungdom" });
  await teamForm.getByLabel("Lagnamn").fill("OK Unga");
  const slots = [[1, 1], [2, 1], [2, 2], [3, 1]] as const;
  for (const [leg, order] of slots) {
    const suffixText = leg === 2 ? ` löpare ${order}` : "";
    await teamForm.getByLabel(`Förnamn sträcka ${leg}${suffixText}`).fill(`U${leg}${order}`);
    await teamForm.getByLabel(`Efternamn sträcka ${leg}${suffixText}`).fill("Ung");
    await teamForm.getByLabel(`Bricka sträcka ${leg}${suffixText}`).fill(String(8_400_000 + leg * 10 + order));
  }
  await teamForm.getByRole("button", { name: "Spara lag" }).click();
  await expect(owner.getByText("Lag 1 OK Unga är anmält.")).toBeVisible();
  await view.getByRole("button", { name: "Öppna lag 1 OK Unga" }).click();
  await expect(owner.getByRole("region", { name: "Lagkort" })).toContainText("Sträcka 2 · löpare 2");

  await openReadout(owner, raceId);
  await read(owner, /^U11 Ung · Ungdom · Lag 1 · Sträcka 1/);
  // Sträcka 2: löpare 1 felstämplar, löpare 2 är godkänd – sträckan är godkänd (minst en).
  await read(owner, /^U21 Ung · Ungdom · Lag 1 · Sträcka 2/, false);
  await read(owner, /^U22 Ung · Ungdom · Lag 1 · Sträcka 2/);
  await read(owner, /^U31 Ung · Ungdom · Lag 1 · Sträcka 3/);
  await expect(owner.getByTestId("queue-status")).toHaveText("0 väntar", { timeout: 30_000 });

  const visitor = await (await browser.newContext()).newPage();
  await visitor.goto(`/results/${raceId}`);
  const team = visitor.getByRole("table", { name: "Lagresultat Ungdom" }).locator("tbody").first();
  await expect(team.getByRole("row").first()).toContainText("1 OK Unga");
  await expect(team.getByRole("row").first().getByRole("cell").first()).toHaveText("1");
  await expect(team.getByRole("row")).toHaveCount(5);
  await expect(team.getByRole("row").nth(2)).toContainText("U21 Ung");
  await expect(team.getByRole("row").nth(3)).toContainText("U22 Ung");
  // "växlade" visas bara på sträckor med flera löpare: den löpare vars mål blev lagets växling.
  await expect(team.getByRole("row").filter({ hasText: "växlade" })).toHaveCount(1);
});

test("teamsprint: två löpare × fyra sträckor, en bricka per person, avläsning efter sista sträckan", async ({ browser }) => {
  test.setTimeout(360_000);
  const suffix = unique();
  const { date, clock } = raceClock(BACK);
  const owner = await registerAccount(browser, `teamsprint48.${suffix}@exempel.se`, "Tea Sprint");
  const raceId = await createRace(owner, `Teamsprint ${suffix}`, date, "Stafett");
  await publishRace(owner);
  await addCourseAndClass(owner, "Sprintslinga", "Träning", "31 32 33");
  await compileRoutes(owner, raceId);

  await openStep(owner, "Klasser & sträckor");
  await owner.getByText("Ny stafettklass").click();
  const form = owner.getByRole("form", { name: "Ny stafettklass" });
  await form.getByRole("button", { name: "Mall: Teamsprint (2 löpare × 4 sträckor)" }).click();
  await expect(form.getByLabel("Antal sträckor")).toHaveValue("4");
  await form.getByLabel("Klassnamn").fill("Teamsprint");
  await form.getByLabel("Bana").selectOption({ label: "Sprintslinga" });
  await form.getByLabel("Växlingskontroll").fill("100");
  await form.getByLabel("Masstart sträcka 1").fill(clock(0));
  await form.getByRole("button", { name: "Spara stafettklass" }).click();
  await expect(owner.getByText("Stafettklassen Teamsprint är sparad.")).toBeVisible();

  await openStep(owner, "Lag");
  const view = owner.getByRole("region", { name: "Lag", exact: true });
  await view.getByText("Nytt lag").click();
  const teamForm = owner.getByRole("form", { name: "Nytt lag" });
  await teamForm.getByLabel("Stafettklass").selectOption({ label: "Teamsprint" });
  await teamForm.getByLabel("Lagnamn").fill("OK Sprint");
  for (const [person, card] of [["A", "8500001"], ["B", "8500002"]] as const) {
    await teamForm.getByLabel(`Förnamn löpare ${person}`).fill(`Löpare${person}`);
    await teamForm.getByLabel(`Efternamn löpare ${person}`).fill("Sprint");
    await teamForm.getByLabel(`Bricka löpare ${person}`).fill(card);
  }
  await teamForm.getByRole("button", { name: "Spara lag" }).click();
  await expect(owner.getByText("Lag 1 OK Sprint är anmält.")).toBeVisible();
  await view.getByRole("button", { name: "Öppna lag 1 OK Sprint" }).click();
  const teamCard = owner.getByRole("region", { name: "Lagkort" });
  await expect(teamCard.getByRole("row", { name: /Sträcka 3/ })).toContainText("samma löpare som sträcka 1");

  // Brickorna läses ut först efter sista sträckan: övningsstationen stämplar växlingskontrollen efter varje sträcka.
  await openReadout(owner, raceId);
  await read(owner, /^LöpareA Sprint · Teamsprint · Lag 1 · Sträcka 1/);
  await expect(owner.getByTestId("verdict-relay")).toContainText("Sträcka 1 och 3");
  await read(owner, /^LöpareB Sprint · Teamsprint · Lag 1 · Sträcka 2/);
  await expect(owner.getByTestId("queue-status")).toHaveText("0 väntar", { timeout: 30_000 });

  const visitor = await (await browser.newContext()).newPage();
  await visitor.goto(`/results/${raceId}`);
  const team = visitor.getByRole("table", { name: "Lagresultat Teamsprint" }).locator("tbody").first();
  await expect(team.getByRole("row").first()).toContainText("1 OK Sprint");
  await expect(team.getByRole("row").first().getByRole("cell").first()).toHaveText("1");
  await expect(team.getByRole("row")).toHaveCount(5);
  await expect(team.getByRole("row").nth(3)).toContainText("LöpareA Sprint");
});
