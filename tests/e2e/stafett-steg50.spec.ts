import { expect, test, type Page } from "@playwright/test";
import { addCourseAndClass, createRace, openStep, publishRace, registerAccount, unique } from "./helpers";

/**
 * Steg 50 (ADR-0174 beslut 9): teamsprint med utläsning efter varje sträcka, som MeOS. Löparna stämplar mål och läser ut
 * efter varje sträcka utan att tömma brickan; övningsstationen har en bricka per sträcka med stämplingarna från löparens
 * tidigare sträckor kvar.
 * 1. Två lag där varje löpare läses ut efter varje sträcka: beskedet säger vilken sträcka utläsningen gällde, lagkortet visar
 *    båda utläsningarna och resultatlistan placerar lagen.
 * 2. Ett lag där löpare A glömmer att läsa ut efter sträcka 1: utläsningen efter sträcka 3 ger sträcka 3:s resultat och
 *    beskedet "Utläsning efter sträcka 1 saknas", och ingen sträcka blir felstämplad av det.
 */
const TIME_ZONE = "Europe/Stockholm";
const BACK = 60;

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

/** Läser ut en övningsbricka för sträcklöparen; `verdict` är beskedet som väntas (eller inget för att inte kontrollera). */
async function read(page: Page, label: RegExp, verdict: string | null = "GODKÄND") {
  const select = page.getByLabel("Deltagare");
  const option = await select.locator("option").filter({ hasText: label }).first().textContent();
  await select.selectOption({ label: option! });
  await page.getByRole("button", { name: "Läs av: rätt stämplat" }).click();
  if (verdict) await expect(page.getByTestId("verdict")).toContainText(verdict);
  else await expect(page.getByTestId("verdict")).toBeVisible();
}

async function sprintRace(browser: Parameters<typeof registerAccount>[0], prefix: string, teams: readonly string[]) {
  const suffix = unique();
  const { date, clock } = raceClock(BACK);
  const owner = await registerAccount(browser, `${prefix}.${suffix}@exempel.se`, "Tea Sprint");
  const raceId = await createRace(owner, `Teamsprint ${suffix}`, date, "Stafett");
  await publishRace(owner);
  await addCourseAndClass(owner, "Sprintslinga", "Träning", "31 32 33");
  await compileRoutes(owner, raceId);

  await openStep(owner, "Klasser & sträckor");
  await owner.getByText("Ny stafettklass").click();
  const form = owner.getByRole("form", { name: "Ny stafettklass" });
  await form.getByRole("button", { name: "Mall: Teamsprint (2 löpare × 4 sträckor)" }).click();
  // Mallens förval: utläsning efter varje sträcka, ingen växlingskontroll behövs.
  await expect(form.getByLabel("Teamsprint", { exact: true })).toHaveValue("EACH_LEG");
  await form.getByLabel("Klassnamn").fill("Teamsprint");
  await form.getByLabel("Bana").selectOption({ label: "Sprintslinga" });
  await form.getByLabel("Masstart sträcka 1").fill(clock(0));
  await form.getByRole("button", { name: "Spara stafettklass" }).click();
  await expect(owner.getByText("Stafettklassen Teamsprint är sparad.")).toBeVisible();

  await openStep(owner, "Lag");
  const view = owner.getByRole("region", { name: "Lag", exact: true });
  await view.getByText("Nytt lag").click();
  const teamForm = owner.getByRole("form", { name: "Nytt lag" });
  await teamForm.getByLabel("Stafettklass").selectOption({ label: "Teamsprint" });
  for (const [index, name] of teams.entries()) {
    await teamForm.getByLabel("Lagnamn").fill(name);
    for (const [person, card] of [["A", 8_500_001 + index * 10], ["B", 8_500_002 + index * 10]] as const) {
      await teamForm.getByLabel(`Förnamn löpare ${person}`).fill(`Löpare${person}`);
      await teamForm.getByLabel(`Efternamn löpare ${person}`).fill(name.split(" ").at(-1)!);
      await teamForm.getByLabel(`Bricka löpare ${person}`).fill(String(card));
    }
    await teamForm.getByRole("button", { name: "Spara lag" }).click();
    await expect(owner.getByText(`Lag ${index + 1} ${name} är anmält.`)).toBeVisible();
  }
  return { owner, raceId, view };
}

const legLabel = (team: number, leg: number) => new RegExp(`· Teamsprint · Lag ${team} · Sträcka ${leg} ·`);

test("teamsprint: två lag, varje löpare läses ut efter varje sträcka", async ({ browser }) => {
  test.setTimeout(420_000);
  const { owner, raceId, view } = await sprintRace(browser, "teamsprint50", ["OK Sprint", "OK Fart"]);
  await openReadout(owner, raceId);
  for (const team of [1, 2]) {
    const name = team === 1 ? "Sprint" : "Fart";
    await read(owner, legLabel(team, 1));
    await expect(owner.getByTestId("verdict-relay")).toContainText(`Lag ${team} OK ${name} – sträcka 1 (LöpareA ${name}, första sträckan)`);
    await read(owner, legLabel(team, 2));
    // Andra utläsningen av A:s bricka: sträcka 1:s stämplingar finns kvar, målet är det nya.
    await read(owner, legLabel(team, 3));
    await expect(owner.getByTestId("verdict-relay")).toContainText(`Lag ${team} OK ${name} – sträcka 3 (LöpareA ${name}, andra sträckan)`);
    await read(owner, legLabel(team, 4));
    await expect(owner.getByTestId("verdict-relay")).toContainText("Lagets tid");
  }
  await expect(owner.getByTestId("queue-status")).toHaveText("0 väntar", { timeout: 30_000 });

  const visitor = await (await browser.newContext()).newPage();
  await visitor.goto(`/results/${raceId}`);
  const results = visitor.getByRole("table", { name: "Lagresultat Teamsprint" }).locator("tbody");
  await expect(results.nth(0).getByRole("row").first().getByRole("cell").first()).toHaveText("1");
  await expect(results.nth(1).getByRole("row").first().getByRole("cell").first()).toHaveText("2");
  await expect(results.nth(0).getByRole("row")).toHaveCount(5);

  // Lagkortet visar båda utläsningarna av varje löpares bricka.
  await owner.goto(`/admin/${raceId}/manage`);
  await openStep(owner, "Lag");
  await view.getByRole("button", { name: "Öppna lag 1 OK Sprint" }).click();
  const card = owner.getByRole("region", { name: "Lagkort" });
  await expect(card.getByTestId("leg-readout")).toHaveCount(4);
  await expect(card.getByRole("row", { name: /Sträcka 3/ })).toContainText("samma löpare som sträcka 1");
  await expect(card.getByRole("row", { name: /Sträcka 3/ })).toContainText("Utläst");
});

test("teamsprint: en glömd utläsning ger besked men ingen felstämpling", async ({ browser }) => {
  test.setTimeout(420_000);
  const { owner, raceId, view } = await sprintRace(browser, "glomd50", ["OK Glömsk"]);
  await openReadout(owner, raceId);
  // A läser inte ut efter sträcka 1. B:s sträcka 2 väntar på A:s växling.
  await read(owner, legLabel(1, 2), null);
  await read(owner, legLabel(1, 3));
  await expect(owner.getByTestId("verdict-readout-missing")).toHaveText("Utläsning efter sträcka 1 saknas – läs ut efter varje sträcka");
  await read(owner, legLabel(1, 4), null);
  await expect(owner.getByTestId("queue-status")).toHaveText("0 väntar", { timeout: 30_000 });

  await owner.goto(`/admin/${raceId}/manage`);
  await openStep(owner, "Lag");
  await view.getByRole("button", { name: "Öppna lag 1 OK Glömsk" }).click();
  const card = owner.getByRole("region", { name: "Lagkort" });
  await expect(card.getByRole("row", { name: /Sträcka 1/ })).toContainText("Utläsning efter sträcka 1 saknas – läs ut efter varje sträcka");
  await expect(card.getByRole("row", { name: /Sträcka 3/ })).toContainText("Godkänd");
  // Sträcka 2 väntar på växlingen (inte felstämplad).
  await expect(card.getByRole("row", { name: /Sträcka 2/ })).not.toContainText("Felstämplad");
  const visitor = await (await browser.newContext()).newPage();
  await visitor.goto(`/results/${raceId}`);
  await expect(visitor.getByRole("table", { name: "Lagresultat Teamsprint" })).not.toContainText("Felstämplat");
});
