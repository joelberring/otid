import { expect, test, type Page } from "@playwright/test";
import { addCourseAndClass, createRace, openStep, registerAccount, unique } from "./helpers";

/**
 * PLAN.md steg 11 (ADR-0169 beslut 3): klubbstafett med 6 lag × 3 sträckor. Stafettklassen skapas
 * i Klasser med masstart två timmar bakåt, lagen anmäls i lagvyn, löparen på sträcka 2 i lag 3 byts.
 * Alla sträckor läses av med övningsstationen (lag 4 felstämplar sträcka 2), kontrollvyn visar lagen
 * som är ute och de publika lagresultaten har rätt ordning med det felstämplade laget orankat.
 */
const TIME_ZONE = "Europe/Stockholm";
const TEAMS = 6;
const FAMILIES = ["Ek", "Al", "Björk", "Gran", "Tall", "Lönn"];
const GIVEN = ["Anna", "Bo", "Cia"];
const card = (team: number, leg: number) => String(8_000_000 + team * 100 + leg);

/** Dagens datum och klockslaget två timmar bakåt i tävlingens tidszon (masstarten ligger i det förflutna). */
function raceClock(): { date: string; massStart: string } {
  const now = new Date();
  const date = new Intl.DateTimeFormat("sv-SE", { timeZone: TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
  const [hour, minute] = new Intl.DateTimeFormat("sv-SE", { timeZone: TIME_ZONE, hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
    .format(now).split(":").map(Number) as [number, number];
  const minutes = Math.max(1, hour * 60 + minute - 120);
  return { date, massStart: `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}` };
}

/** Skärmbilder för dokumentation när E2E_SCREENSHOT_DIR är satt (1280 och 390 px). */
async function screenshots(page: Page, name: string) {
  const directory = process.env.E2E_SCREENSHOT_DIR;
  if (!directory) return;
  for (const width of [1280, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await page.screenshot({ path: `${directory}/${name}-${width}.png`, fullPage: true });
  }
  await page.setViewportSize({ width: 1280, height: 720 });
}

async function readLeg(page: Page, team: number, leg: number, name: string, variant: "ok" | "missing" = "ok") {
  await page.getByLabel("Deltagare").selectOption({ label: `${name} · Stafett · Lag ${team} · Sträcka ${leg} · ${card(team, leg)}` });
  await page.getByRole("button", { name: variant === "ok" ? "Läs av: rätt stämplat" : "Läs av: missad kontroll" }).click();
  const verdict = page.getByTestId("verdict");
  await expect(verdict).toContainText(variant === "ok" ? "GODKÄND" : "FELSTÄMPLAD");
  await expect(verdict).toContainText(name);
  await expect(page.getByTestId("verdict-relay")).toContainText(`Lag ${team} OK Test ${team} · Sträcka ${leg} av 3`);
  return page.getByTestId("verdict-relay");
}

/**
 * Utvecklingsservern kompilerar en route vid första anropet, vilket på en belastad dator kan ta längre än
 * arbetsytans tidsgräns för ett anrop. Stafettens routes kompileras därför i förväg (svaret spelar ingen roll).
 */
async function compileRelayRoutes(page: Page, raceId: string) {
  for (const path of ["relay", "relay-classes", "relay-teams", "relay-leg-runner", "relay-start-times"]) {
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

test("klubbstafett: stafettklass, lag, byte av löpare, avläsning per sträcka, lag ute och publikt lagresultat", async ({ browser }) => {
  test.setTimeout(420_000);
  const suffix = unique();
  const { date, massStart } = raceClock();
  const owner = await registerAccount(browser, `stafett.${suffix}`, "Stina Stafett");
  const raceId = await createRace(owner, `Klubbstafett ${suffix}`, date);
  await addCourseAndClass(owner, "Stafettbana", "Inskolning", "31 32 33 34");
  await compileRelayRoutes(owner, raceId);

  // Klasser: ny stafettklass med tre sträckor, masstart på sträcka 1 och växling på sträcka 2 och 3.
  await openStep(owner, "Klasser");
  await owner.getByText("Ny stafettklass").click();
  const classForm = owner.getByRole("form", { name: "Ny stafettklass" });
  await classForm.getByLabel("Klassnamn").fill("Stafett");
  await classForm.getByLabel("Bana").selectOption({ label: "Stafettbana" });
  await expect(classForm.getByLabel("Antal sträckor")).toHaveValue("3");
  await classForm.getByLabel("Masstart sträcka 1").fill(massStart);
  await expect(classForm.getByLabel("Startsätt sträcka 2")).toHaveValue("CHANGEOVER");
  await classForm.getByRole("button", { name: "Spara stafettklass" }).click();
  await expect(owner.getByText("Stafettklassen Stafett är sparad.")).toBeVisible();
  await expect(owner.getByRole("row", { name: /^Stafett Stafettbana/ })).toContainText("Stafett · 3 sträckor");

  // Anmälda: sex lag med en löpare och bricka per sträcka, i samma formulär.
  await openStep(owner, "Anmälda");
  const teamsView = owner.getByRole("region", { name: "Lag", exact: true });
  await teamsView.getByText("Nytt lag").click();
  const teamForm = owner.getByRole("form", { name: "Nytt lag" });
  await teamForm.getByLabel("Stafettklass").selectOption({ label: "Stafett" });
  for (let team = 1; team <= TEAMS; team += 1) {
    await teamForm.getByLabel("Lagnamn").fill(`OK Test ${team}`);
    await teamForm.getByLabel("Klubb").fill("OK Test");
    for (let leg = 1; leg <= 3; leg += 1) {
      await teamForm.getByLabel(`Förnamn sträcka ${leg}`).fill(GIVEN[leg - 1]!);
      await teamForm.getByLabel(`Efternamn sträcka ${leg}`).fill(FAMILIES[team - 1]!);
      await teamForm.getByLabel(`Bricka sträcka ${leg}`).fill(card(team, leg));
    }
    await teamForm.getByRole("button", { name: "Spara lag" }).click();
    await expect(owner.getByText(`Lag ${team} OK Test ${team} är anmält.`)).toBeVisible();
  }
  await expect(teamsView.getByRole("row")).toHaveCount(TEAMS + 1);
  await expect(teamsView.getByRole("row", { name: /^1 Öppna lag 1 OK Test 1 / })).toContainText(`Anna Ek${card(1, 1)}`);
  await expect(teamsView.getByRole("row", { name: /^1 Öppna lag 1 OK Test 1 / })).toContainText("Ute på sträcka 1");

  // Lagkortet: byt löparen på sträcka 2 i lag 3 (den vanligaste ändringen på tävlingsdagen).
  await teamsView.getByRole("button", { name: "Öppna lag 3 OK Test 3" }).click();
  const teamCard = owner.getByRole("region", { name: "Lagkort" });
  await expect(teamCard.getByRole("heading", { name: "Lag 3 OK Test 3" })).toBeVisible();
  await teamCard.getByRole("button", { name: "Byt löpare på sträcka 2" }).click();
  const runnerForm = teamCard.getByRole("form", { name: "Byt löpare på sträcka 2" });
  await runnerForm.getByLabel("Förnamn").fill("Dan");
  await runnerForm.getByLabel("Efternamn").fill("Bytt");
  await runnerForm.getByLabel("Bricka").fill(card(3, 9));
  await runnerForm.getByRole("button", { name: "Spara löpare" }).click();
  await expect(owner.getByText("Sträcka 2: Dan Bytt springer nu.")).toBeVisible();
  await expect(teamCard.getByRole("row", { name: /Sträcka 2/ })).toContainText(`Dan Bytt`);
  await expect(teamCard.getByRole("row", { name: /Sträcka 2/ })).toContainText(card(3, 9));
  await screenshots(owner, "stafett-lagvy");

  // Avläsning av sträcka 1 för alla lag: verdict visar lag, sträcka och växlingen.
  const legName = (team: number, leg: number) => team === 3 && leg === 2 ? "Dan Bytt" : `${GIVEN[leg - 1]} ${FAMILIES[team - 1]}`;
  const legCard = (team: number, leg: number) => team === 3 && leg === 2 ? card(3, 9) : card(team, leg);
  await openReadout(owner, raceId);
  for (let team = 1; team <= TEAMS; team += 1) {
    await expect(await readLeg(owner, team, 1, legName(team, 1))).toContainText("Växlar till sträcka 2");
  }
  await expect(owner.getByTestId("queue-status")).toHaveText("0 väntar", { timeout: 30_000 });

  // Kontrollvyn: alla sex lag är ute på sträcka 2.
  await owner.goto(`/admin/${raceId}/manage`);
  await openStep(owner, "Avläsning");
  const teamsOut = owner.getByRole("region", { name: /Lag ute/ });
  await expect(teamsOut.getByTestId("teams-out-count")).toHaveText(String(TEAMS));
  await expect(teamsOut).toContainText(`Stafett · Sträcka 2: ${TEAMS} lag`);
  await expect(teamsOut).toContainText("Lag 3 OK Test 3 · Dan Bytt");
  await screenshots(owner, "stafett-kontrollvy");

  // Sträcka 2 och 3. Lag 4 missar en kontroll på sträcka 2.
  await openReadout(owner, raceId);
  for (let team = 1; team <= TEAMS; team += 1) {
    await owner.getByLabel("Deltagare").selectOption({ label: `${legName(team, 2)} · Stafett · Lag ${team} · Sträcka 2 · ${legCard(team, 2)}` });
    await owner.getByRole("button", { name: team === 4 ? "Läs av: missad kontroll" : "Läs av: rätt stämplat" }).click();
    await expect(owner.getByTestId("verdict")).toContainText(team === 4 ? "FELSTÄMPLAD" : "GODKÄND");
    await expect(owner.getByTestId("verdict-relay")).toContainText(`Lag ${team} OK Test ${team} · Sträcka 2 av 3 · Växlar till sträcka 3`);
  }
  for (let team = 1; team <= TEAMS; team += 1) {
    const relay = await readLeg(owner, team, 3, legName(team, 3));
    await expect(relay).toContainText(team === 4 ? "Sista sträckan – Laget felstämplat" : "Sista sträckan – Lagets tid");
  }
  await expect(owner.getByTestId("queue-status")).toHaveText("0 väntar", { timeout: 30_000 });

  // Publika lagresultat utan inloggning: fart per lag ger ordningen 3, 2, 1/6, 5; lag 4 är felstämplat och orankat.
  const visitor = await (await browser.newContext()).newPage();
  await visitor.goto(`/results/${raceId}`);
  const results = visitor.getByRole("table", { name: "Lagresultat Stafett" });
  await expect(results.getByRole("row")).toHaveCount(TEAMS + 1);
  const rows = results.getByRole("row");
  await expect(rows.nth(1)).toContainText("3 OK Test 3");
  await expect(rows.nth(1).getByRole("cell").first()).toHaveText("1");
  await expect(rows.nth(2)).toContainText("2 OK Test 2");
  await expect(rows.nth(5)).toContainText("5 OK Test 5");
  await expect(rows.nth(5).getByRole("cell").first()).toHaveText("5");
  await expect(rows.nth(6)).toContainText("4 OK Test 4");
  await expect(rows.nth(6)).toContainText("Felstämplat");
  await expect(rows.nth(6).getByRole("cell").first()).toHaveText("–");
  await rows.nth(1).getByText("Visa sträckor").click();
  await expect(rows.nth(1)).toContainText("Dan Bytt");
  await visitor.getByText("Sträckresultat").click();
  await expect(visitor.getByRole("table", { name: "Stafett sträcka 2" }).getByRole("row")).toHaveCount(TEAMS + 1);
  await visitor.getByText("Sträckresultat").click();
  await screenshots(visitor, "stafett-resultat");
});
