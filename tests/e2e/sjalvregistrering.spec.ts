import { expect, test } from "@playwright/test";
import { createRace, publishRaceViaApi, registerAccount, reviewScreenshots, today, unique, warmRoute } from "./helpers";

/**
 * Steg 41: självregistrering på tävlingsdagen. En fest med valet påslaget: en besökare utan inloggning registrerar
 * övningsstationens pinne med ett påhittat namn på fest-sidan, och bardisken (övningsstationen) visar sedan namnet utan
 * namnruta. Samma pinne igen avvisas. Arbetsytan visar gästen som självregistrerad.
 */
test("självregistrering: gästen kopplar sitt namn till pinnen och bardisken känner igen den", async ({ browser }) => {
  test.setTimeout(300_000);
  const suffix = unique();
  const owner = await registerAccount(browser, `sjalv.${suffix}@exempel.se`, "Sara Själv");
  const raceId = await createRace(owner, `Jubileum ${suffix}`, today(), "Fest");
  for (const path of ["/fest/aaaaaa", `/api/public/parties/${raceId}`, `/api/public/races/${raceId}/self-registration`]) await warmRoute(owner, path);
  await warmRoute(owner, `/api/public/races/${raceId}/self-registration`, "POST");

  const start = owner.getByRole("form", { name: "Festens start" });
  await start.getByLabel("Datum").fill(today());
  await start.getByLabel("Klockslag").fill("00:00");
  await start.getByRole("button", { name: "Spara start" }).click();
  await expect(owner.getByText("Starten är sparad.")).toBeVisible();
  const add = owner.getByRole("form", { name: "Lägg till vara" });
  await add.getByLabel("Kod").fill("31");
  await add.getByLabel("Namn").fill("Öl");
  await add.getByLabel("Pris (kr)").fill("40");
  await add.getByRole("button", { name: "Lägg till vara" }).click();
  await expect(owner.getByLabel("Vara 31: Namn")).toHaveValue("Öl");

  // Valet är av som standard; på sparas direkt.
  const setting = owner.getByLabel("Tillåt självregistrering på tävlingsdagen");
  await expect(setting).not.toBeChecked();
  await setting.click();
  await expect(owner.getByText("Självregistreringen är på.")).toBeVisible();
  await expect(setting).toBeChecked();
  await publishRaceViaApi(owner, raceId);
  const publicPath = await owner.getByRole("link", { name: "Visa den publika sidan" }).getAttribute("href");

  // Bardisken med övningsstationen: pinnens nummer.
  const desk = await owner.context().newPage();
  await desk.goto(`/admin/${raceId}/readout`);
  await desk.waitForURL(`**/readout/index.html#${raceId}`);
  await desk.getByRole("button", { name: "Starta övningsstation" }).click();
  await expect(desk.getByTestId("station-status")).toContainText("Övningsstation");
  const card = /(\d{7})/.exec(await desk.getByTestId("party-exercise-card").textContent() ?? "")![1]!;

  // Besökaren, utan inloggning: formuläret på fest-sidan, svenska fältfel, kvittens.
  const visitor = await (await browser.newContext()).newPage();
  await visitor.goto(publicPath!);
  const form = visitor.getByTestId("self-registration");
  // Steg 42: på fest-sidan är formuläret utfällbart under rubriken, stängt från början.
  const toggle = visitor.getByRole("button", { name: "Registrera din pinne" });
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await expect(form).toBeHidden();
  await toggle.click();
  await expect(form).toBeVisible();
  // En fest utan utseendet "Centrum OK 20 år" behåller sitt typsnitt.
  expect(await visitor.locator("h1").evaluate(element => getComputedStyle(element).fontFamily)).not.toContain("Poppins");
  await expect(form.getByRole("link", { name: "Om personuppgifter" })).toHaveAttribute("href", "/integritet");
  await form.getByRole("button", { name: "Registrera" }).click();
  await expect(form.getByText("Skriv bricknumret med siffror (1–9 999 999).")).toBeVisible();
  await reviewScreenshots(visitor, "sjalvregistrering-formular");
  await form.getByLabel("Bricknummer").fill(card);
  await form.getByLabel("Förnamn").fill("Pia");
  await form.getByLabel("Efternamn").fill("Pinnesson");
  await form.getByLabel("Klubb (valfri)").fill("Påhittade OK");
  await form.getByLabel("Visningsnamn (valfritt)").fill("Pinnan");
  await form.getByRole("button", { name: "Registrera" }).click();
  await expect(form.getByRole("status")).toContainText(`Klart! Pinne ${card} är kopplad till Pia Pinnesson. Du visas som Pinnan.`);
  await reviewScreenshots(visitor, "sjalvregistrering-kvitto");

  // Samma pinne igen: avvisas, inget skrivs över.
  await form.getByRole("button", { name: "Registrera en pinne till" }).click();
  await form.getByLabel("Bricknummer").fill(card);
  await form.getByLabel("Förnamn").fill("Annan");
  await form.getByLabel("Efternamn").fill("Person");
  await form.getByRole("button", { name: "Registrera" }).click();
  await expect(form.getByRole("alert")).toHaveText(/Pinnen är redan registrerad\. Kontakta arrangören\./);

  // Bardisken hämtar festens läge var femte sekund och känner sedan igen pinnen: namnet, ingen namnruta.
  await desk.bringToFront();
  await desk.waitForTimeout(6_000);
  await desk.getByRole("button", { name: "Läs ut brickan" }).click();
  await expect(desk.getByTestId("party-headline")).toHaveText("✓ Välkommen, Pinnan!");
  await expect(desk.getByTestId("party-name")).toHaveCount(0);

  // Arbetsytan: gästen är märkt som självregistrerad.
  await owner.bringToFront();
  const row = owner.locator("tr[data-card]").filter({ hasText: "Pia Pinnesson" });
  await expect(row).toContainText("Självregistrerad", { timeout: 20_000 });
  await expect(row).toContainText("Pinnan");

  // Den publika fest-sidan visar bara visningsnamnet, aldrig fullt namn (inte heller i API:et).
  const api = await (await visitor.request.get(`/api/public/parties/${raceId}`)).text();
  expect(api).toContain("Pinnan");
  expect(api).not.toContain("Pinnesson");
});
