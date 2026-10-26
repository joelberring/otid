import { expect, test, type Browser, type Page } from "@playwright/test";
import { addCourseAndClass, createRace, logIn, openStep, publishRace, registerAccount, unique } from "./helpers";

/**
 * Steg 47 (ADR-0174): stafett på riktigt.
 * 1. Klubbstafett med kort bana på sträcka 2 och omstart på sträcka 3; avläsningen bedöms mot sträckans bana, kontrollvyn
 *    visar omstarten, laget i omstart placeras efter laget med vanliga växlingar och en ändrad sträcka räknas om efter besked.
 * 2. Linjestafett med sex sträckor och egen bana per sträcka, flygande omstart och fast omstart, avläst på två datorer.
 * 3. 25-manna: formuläret med 25 sträckor och resultatlistan med 25 sträckor, även på 390 px.
 *
 * Övningsstationen lägger sträckornas mål jämnt mellan masstarten och nu med fart per lag (lag 1 97 %, lag 2 94 %, lag 3 91 %),
 * så växlingstiderna går att räkna ut: sträcka k av n går i mål efter k/n av fönstret gånger lagets fart.
 */
/** Minuter efter midnatt i tidszonen. */
function minutesOfDay(timeZone: string, now = new Date()) {
  const [hour, minute] = new Intl.DateTimeFormat("sv-SE", { timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
    .format(now).split(":").map(Number) as [number, number];
  return hour * 60 + minute;
}

/**
 * Dagens datum och klockslag `back` minuter bakåt (och plus `offset` minuter) i tävlingens tidszon. Masstarten ligger sex
 * timmar bakåt så att skillnaden mellan lagens växlingar (2–3 % av fönstret) blir flera minuter och inte påverkas av att
 * fönstret växer medan testet läser av.
 */
const BACK = 360;
function raceClock(back: number) {
  const now = new Date();
  const date = new Intl.DateTimeFormat("sv-SE", { timeZone: TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
  const [hour, minute] = new Intl.DateTimeFormat("sv-SE", { timeZone: TIME_ZONE, hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
    .format(now).split(":").map(Number) as [number, number];
  const start = Math.max(1, hour * 60 + minute - back);
  const clock = (offset: number) => `${String(Math.floor((start + offset) / 60)).padStart(2, "0")}:${String((start + offset) % 60).padStart(2, "0")}`;
  return { date, clock };
}

/**
 * Testerna med växlingstider behöver ett fönster på sex timmar samma dag (masstarten kan inte läggas på gårdagen). Tävlingen
 * läggs därför i Stockholm när det ryms och annars i New York (sex timmar efter); ryms det i ingen av dem (eller kan testet
 * gå över midnatt) hoppas testet över i stället för att fallera av klockan.
 */
const TIME_ZONE = ["Europe/Stockholm", "America/New_York"].find(zone => {
  const minutes = minutesOfDay(zone);
  return minutes >= BACK + 5 && minutes < 23 * 60 + 30;
}) ?? "Europe/Stockholm";
function needsFullWindow() {
  const minutes = minutesOfDay(TIME_ZONE);
  test.skip(minutes < BACK + 5 || minutes >= 23 * 60 + 30, "Fönstret på sex timmar ryms inte i dygnet just nu");
}

async function compileRoutes(page: Page, raceId: string) {
  for (const path of ["relay", "relay-classes", "relay-teams", "relay-class-edit", "relay-start-times", "relay-team-edit"]) {
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

async function read(page: Page, label: string, ok = true) {
  await page.getByLabel("Deltagare").selectOption({ label });
  await page.getByRole("button", { name: ok ? "Läs av: rätt stämplat" : "Läs av: missad kontroll" }).click();
  await expect(page.getByTestId("verdict")).toContainText(ok ? "GODKÄND" : "FELSTÄMPLAD");
}

async function newRelayClass(owner: Page, name: string, course: string, legs: number) {
  await openStep(owner, "Klasser & sträckor");
  await owner.getByText("Ny stafettklass").click();
  const form = owner.getByRole("form", { name: "Ny stafettklass" });
  await form.getByLabel("Klassnamn").fill(name);
  await form.getByLabel("Bana").selectOption({ label: course });
  await form.getByLabel("Antal sträckor").selectOption(String(legs));
  return form;
}

async function addTeams(owner: Page, className: string, teams: number, legs: number, card: (team: number, leg: number) => string) {
  await openStep(owner, "Lag");
  const view = owner.getByRole("region", { name: "Lag", exact: true });
  await view.getByText("Nytt lag").click();
  const form = owner.getByRole("form", { name: "Nytt lag" });
  await form.getByLabel("Stafettklass").selectOption({ label: className });
  for (let team = 1; team <= teams; team += 1) {
    await form.getByLabel("Lagnamn").fill(`OK Linje ${team}`);
    for (let leg = 1; leg <= legs; leg += 1) {
      await form.getByLabel(`Förnamn sträcka ${leg}`, { exact: true }).fill(`L${leg}`);
      await form.getByLabel(`Efternamn sträcka ${leg}`, { exact: true }).fill(`Lag${team}`);
      await form.getByLabel(`Bricka sträcka ${leg}`, { exact: true }).fill(card(team, leg));
    }
    await form.getByRole("button", { name: "Spara lag" }).click();
    await expect(owner.getByText(`Lag ${team} OK Linje ${team} är anmält.`)).toBeVisible();
  }
  return view;
}

async function secondComputer(browser: Browser, email: string, raceId: string) {
  const page = await (await browser.newContext()).newPage();
  await logIn(page, email);
  await expect(page.getByRole("heading", { name: "Dina tävlingar" })).toBeVisible();
  await openReadout(page, raceId);
  return page;
}

test("stafett: kort bana på sträcka 2, omstart, placering efter omstart och ändrad sträcka med besked", async ({ browser }) => {
  needsFullWindow();
  test.setTimeout(420_000);
  const suffix = unique();
  const { date, clock } = raceClock(BACK);
  const owner = await registerAccount(browser, `stafett47.${suffix}@exempel.se`, "Sara Sträcka");
  const raceId = await createRace(owner, `Banstafett ${suffix}`, date, "Stafett", TIME_ZONE);
  await publishRace(owner);
  await addCourseAndClass(owner, "Lång", "Långklass", "31 32 33 34");
  await addCourseAndClass(owner, "Kort", "Kortklass", "41 42");
  await compileRoutes(owner, raceId);

  const form = await newRelayClass(owner, "Stafett", "Lång", 3);
  await form.getByLabel("Masstart sträcka 1").fill(clock(0));
  await form.getByLabel("Sträcka 2 springer").selectOption({ label: "Kort" });
  await form.getByLabel("Startsätt sträcka 3").selectOption("RESTART");
  await form.getByLabel("Omstart sträcka 3").fill(clock(BACK - 5));
  await form.getByRole("button", { name: "Spara stafettklass" }).click();
  await expect(owner.getByText("Stafettklassen Stafett är sparad.")).toBeVisible();

  const card = (team: number, leg: number) => String(8_100_000 + team * 100 + leg);
  const teams = await addTeams(owner, "Stafett", 2, 3, card);
  await teams.getByRole("button", { name: "Öppna lag 1 OK Linje 1" }).click();
  const teamCard = owner.getByRole("region", { name: "Lagkort" });
  await expect(teamCard.getByRole("row", { name: /Sträcka 2/ })).toContainText("Kort");

  const relayLabel = (team: number, leg: number) => `L${leg} Lag${team} · Stafett · Lag ${team} · Sträcka ${leg} · ${card(team, leg)}`;
  // Alla sträckor läses ut först. Omstarten (fem minuter före nu) ligger då efter båda lagens växlingar till sträcka 3.
  await openReadout(owner, raceId);
  for (const leg of [1, 2, 3]) for (let team = 1; team <= 2; team += 1) await read(owner, relayLabel(team, leg));
  await expect(owner.getByTestId("queue-status")).toHaveText("0 väntar", { timeout: 30_000 });

  // Lagens faktiska växlingar till sträcka 3 (sträcka 2:s mål). Omstarten flyttas på tävlingsdagen till en hel minut mitt
  // emellan dem; flytten räknas om, och laget som växlade efter omstarten startar sträcka 3 i den. Testet beror därmed inte
  // på väggklockan eller övningsstationens tider.
  const overview = await (await owner.request.get(`/api/admin/races/${raceId}/administrator/relay`)).json() as
    { teams: { number: number; legs: { leg: number; finishTime: string | null }[] }[] };
  const changeover = (team: number) => Date.parse(overview.teams.find(row => row.number === team)!.legs.find(leg => leg.leg === 2)!.finishTime!);
  const [early, late] = [changeover(1), changeover(2)].sort((left, right) => left - right) as [number, number];
  expect(late - early).toBeGreaterThanOrEqual(2 * 60_000);
  const restartAt = Math.round((early + late) / 2 / 60_000) * 60_000;
  expect(restartAt).toBeGreaterThan(early);
  expect(restartAt).toBeLessThan(late);
  const restart = new Intl.DateTimeFormat("sv-SE", { timeZone: TIME_ZONE, hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
    .format(new Date(restartAt));
  const restartedTeam = changeover(1) > changeover(2) ? 1 : 2;
  const normalTeam = 3 - restartedTeam;
  await owner.goto(`/admin/${raceId}/manage`);
  await openStep(owner, "Start");
  const times = owner.getByRole("form", { name: "Stafett", exact: true });
  await times.getByLabel("Omstart sträcka 3").fill(restart);
  await times.getByRole("button", { name: "Spara tider för Stafett" }).click();
  await expect(owner.getByText("Tiderna för Stafett är sparade.")).toBeVisible();

  // Laget som växlade efter omstarten (med övningsstationens farter lag 1) deltog i omstart: placeras efter laget med
  // vanliga växlingar (SOFT TR 5.8.2).
  const visitor = await (await browser.newContext()).newPage();
  await visitor.goto(`/results/${raceId}`);
  const results = visitor.getByRole("table", { name: "Lagresultat Stafett" }).locator("tbody");
  await expect(results.nth(0).getByRole("row").first()).toContainText(`${normalTeam} OK Linje ${normalTeam}`);
  await expect(results.nth(1).getByRole("row").first()).toContainText(`${restartedTeam} OK Linje ${restartedTeam}`);
  await expect(results.nth(1).getByRole("row").first()).toContainText("deltog i omstart");
  await expect(results.nth(1)).toContainText("omstart");
  await expect(results.nth(0).getByRole("row").nth(2)).toContainText("Kort");

  // Kontrollvyn visar omstarten.
  await owner.goto(`/admin/${raceId}/manage`);
  await openStep(owner, "Avläsning");
  await expect(owner.getByTestId("relay-restarts")).toContainText(`Stafett · Sträcka 3: omstart kl. ${restart}`);
  await expect(owner.getByTestId("relay-restarts")).toContainText("Alla lag har växlat.");

  // Ändra stafettklassen: sträcka 2 springer klassens (långa) bana. Två avlästa löpare blir felstämplade: först beskedet.
  await openStep(owner, "Klasser & sträckor");
  await owner.getByText("Ändra stafettklass").click();
  await owner.getByLabel("Stafettklass att ändra").selectOption({ label: "Stafett" });
  const edit = owner.getByRole("form", { name: "Ändra stafettklass" });
  await expect(edit.getByLabel("Omstart sträcka 3")).toHaveValue(restart);
  await edit.getByLabel("Sträcka 2 springer").selectOption({ label: "Samma som klassen" });
  await edit.getByRole("button", { name: "Spara ändringen" }).click();
  await expect(edit).toContainText("2 löpare byter status:");
  await expect(edit).toContainText("Lag 1 sträcka 2, L2 Lag1: godkänd → felstämplad");
  await edit.getByRole("button", { name: "Spara och räkna om" }).click();
  await expect(owner.getByText("Stafett är ändrad. 2 sträckor räknades om.")).toBeVisible();
  await visitor.reload();
  await expect(visitor.getByRole("table", { name: "Lagresultat Stafett" }).locator("tbody").first()).toContainText("Felstämplat");
});

test("linjestafett: egen bana per sträcka, flygande och fast omstart, avläsning på två datorer", async ({ browser }) => {
  needsFullWindow();
  test.setTimeout(900_000);
  const suffix = unique();
  const { date, clock } = raceClock(BACK);
  const email = `linje47.${suffix}@exempel.se`;
  const owner = await registerAccount(browser, email, "Lina Linje");
  const raceId = await createRace(owner, `Mot centrum ${suffix}`, date, "Stafett", TIME_ZONE);
  await publishRace(owner);
  await addCourseAndClass(owner, "Rotebro–Sollentuna", "Etapp A", "31 32");
  await addCourseAndClass(owner, "Sollentuna–Haga", "Etapp B", "41 42");
  await addCourseAndClass(owner, "Haga–City", "Etapp C", "51 52");
  await compileRoutes(owner, raceId);

  const form = await newRelayClass(owner, "Mot centrum", "Rotebro–Sollentuna", 6);
  await form.getByLabel("Masstart sträcka 1").fill(clock(0));
  const courses = ["Rotebro–Sollentuna", "Sollentuna–Haga", "Haga–City"];
  for (let leg = 2; leg <= 6; leg += 1) await form.getByLabel(`Sträcka ${leg} springer`).selectOption({ label: courses[(leg - 1) % 3]! });
  // Ledaren (lag 3) växlar till sträcka 3 efter 2/6 × 91 % av fönstret (sex timmar); lag 1 omkring 7 min senare och lag 2
  // omkring 3,6 min senare. Gränsen 5 min: lag 1 går i den flygande omstarten, lag 2 växlar som vanligt.
  await form.getByLabel("Startsätt sträcka 3").selectOption("FLYING_RESTART");
  await form.getByLabel("Minuter efter ledaren sträcka 3").fill("5");
  await form.getByLabel("Startsätt sträcka 5").selectOption("RESTART");
  await form.getByLabel("Omstart sträcka 5").fill(clock(BACK - 1));
  await form.getByRole("button", { name: "Spara stafettklass" }).click();
  await expect(owner.getByText("Stafettklassen Mot centrum är sparad.")).toBeVisible();

  const card = (team: number, leg: number) => String(8_200_000 + team * 100 + leg);
  await addTeams(owner, "Mot centrum", 3, 6, card);

  // Två avläsningsdatorer: växlingsplatserna läser var sina sträckor.
  await openReadout(owner, raceId);
  const other = await secondComputer(browser, email, raceId);
  const label = (team: number, leg: number) => `L${leg} Lag${team} · Mot centrum · Lag ${team} · Sträcka ${leg} · ${card(team, leg)}`;
  for (const team of [3, 2, 1]) await read(owner, label(team, 1));
  await expect(owner.getByTestId("queue-status")).toHaveText("0 väntar", { timeout: 30_000 });
  await other.reload();
  await expect(other.getByTestId("package-status")).toContainText("v");
  await other.getByRole("button", { name: "Starta övningsstation" }).click();
  // Lag 2 läses direkt efter ledaren: fönstret växer medan testet går, och marginalen (3,6 min mot gränsen 5 min) får inte ätas upp.
  await read(other, label(3, 2));
  await read(other, label(2, 2));
  await expect(other.getByTestId("queue-status")).toHaveText("0 väntar", { timeout: 30_000 });

  // Funktionärsvyn: omstarten räknas från ledarens växling, och lag 1 har inte växlat till sträcka 3.
  const control = await (await browser.newContext()).newPage();
  await logIn(control, email);
  await expect(control.getByRole("heading", { name: "Dina tävlingar" })).toBeVisible();
  await control.goto(`/admin/${raceId}/manage`);
  await openStep(control, "Avläsning");
  const restarts = control.getByTestId("relay-restarts");
  await expect(restarts).toContainText(/Mot centrum · Sträcka 3: omstart kl\. \d\d:\d\d \(ledaren växlade \d\d:\d\d \+ 5 min\)/);
  await expect(restarts).toContainText("1 lag har inte växlat:");
  await expect(restarts).toContainText("Lag 1 OK Linje 1");
  await expect(restarts).toContainText(`Sträcka 5: omstart kl. ${clock(BACK - 1)}`);

  await read(other, label(1, 2));
  for (let leg = 3; leg <= 6; leg += 1) {
    const page = leg % 2 === 0 ? other : owner;
    await page.reload();
    await expect(page.getByTestId("package-status")).toContainText("v");
    await page.getByRole("button", { name: "Starta övningsstation" }).click();
    for (const team of [3, 2, 1]) await read(page, label(team, leg));
    await expect(page.getByTestId("queue-status")).toHaveText("0 väntar", { timeout: 30_000 });
  }

  // Lag 1 växlade mer än fem minuter efter ledaren och startade sträcka 3 i den flygande omstarten.
  await openStep(control, "Lag");
  const teamsView = control.getByRole("region", { name: "Lag", exact: true });
  await teamsView.getByRole("button", { name: "Öppna lag 1 OK Linje 1" }).click();
  const teamCard = control.getByRole("region", { name: "Lagkort" });
  await expect(teamCard.getByRole("row", { name: /Sträcka 3/ })).toContainText("Omstart");
  // Sträckans egen bana visas när den skiljer sig från klassens (sträcka 4 springer klassens bana).
  await expect(teamCard.getByRole("row", { name: /Sträcka 3/ })).toContainText("Haga–City");
  await expect(teamCard.getByRole("row", { name: /Sträcka 4/ })).not.toContainText("Haga–City");
  await expect(teamCard).toContainText("Deltog i omstart");
  await teamsView.getByRole("button", { name: "Öppna lag 2 OK Linje 2" }).click();
  await expect(control.getByRole("region", { name: "Lagkort" }).getByRole("row", { name: /Sträcka 3/ })).not.toContainText("Omstart");
});

test("25-manna: formuläret med 25 sträckor och resultatlistan, även på mobil", async ({ browser }) => {
  test.setTimeout(300_000);
  const suffix = unique();
  const { date, clock } = raceClock(60);
  const owner = await registerAccount(browser, `manna25.${suffix}@exempel.se`, "Tor Tjugofem");
  const raceId = await createRace(owner, `25-manna ${suffix}`, date, "Stafett", TIME_ZONE);
  await publishRace(owner);
  await addCourseAndClass(owner, "Mannabana", "Träning", "31 32");
  await compileRoutes(owner, raceId);
  const form = await newRelayClass(owner, "25-manna", "Mannabana", 25);
  await owner.setViewportSize({ width: 390, height: 900 });
  await expect(form.getByLabel("Startsätt sträcka 25")).toBeVisible();
  // Formulärets fält ryms på skärmen (arbetsytans stegrad scrollar i sidled för sig).
  const overflow = await form.evaluate((element) => Math.max(0, ...[...element.querySelectorAll("input, select, button")]
    .map((field) => field.getBoundingClientRect().right - document.documentElement.clientWidth)));
  expect(overflow).toBeLessThanOrEqual(1);
  await owner.setViewportSize({ width: 1280, height: 720 });
  await form.getByLabel("Masstart sträcka 1").fill(clock(0));
  await form.getByLabel("Startsätt sträcka 13").selectOption("RESTART");
  await form.getByLabel("Omstart sträcka 13").fill(clock(30));
  await form.getByRole("button", { name: "Spara stafettklass" }).click();
  await expect(owner.getByText("Stafettklassen 25-manna är sparad.")).toBeVisible();
  await addTeams(owner, "25-manna", 1, 25, (team, leg) => String(8_300_000 + team * 100 + leg));

  const visitor = await (await browser.newContext({ viewport: { width: 390, height: 900 } })).newPage();
  await visitor.goto(`/results/${raceId}`);
  const team = visitor.getByRole("table", { name: "Lagresultat 25-manna" }).locator("tbody").first();
  await expect(team.getByRole("row")).toHaveCount(26);
  await expect(team).toContainText("Ute på sträcka 1");
  const publicOverflow = await visitor.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(publicOverflow).toBeLessThanOrEqual(1);
});
