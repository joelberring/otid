import { expect, test, type Locator, type Page } from "@playwright/test";
import { openStep, registerAccount, sectionButton, today, unique, warmRoute } from "./helpers";

/**
 * Steg 24 (PLAN.md): enklare arbetsyta. "Skapa tävling" leder direkt in, tomlägen har en primär knapp,
 * tre deltagare läggs till på under tio klick, tomma formulär ger svenska fältfel (inga webbläsarrutor),
 * sparande låser inte sidopanelen och mobilens toppbalk behåller tillbakalänken och räknarna.
 * Med E2E_SCREENSHOT_DIR satt sparas skärmbilder på 1280 och 390 px (step24-*.png).
 */

/** Räknar användarens klick: varje knapp, länk eller val i en lista räknas som ett klick. Skrivande räknas inte. */
function clickCounter() {
  let count = 0;
  return {
    get count() { return count; },
    async click(locator: Locator) { count += 1; await locator.click(); },
    async choose(select: Locator, label: string) { count += 1; await select.selectOption({ label }); }
  };
}

async function screenshots(page: Page, name: string) {
  const directory = process.env.E2E_SCREENSHOT_DIR;
  if (!directory) return;
  const size = page.viewportSize() ?? { width: 1280, height: 720 };
  for (const width of [1280, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await page.screenshot({ path: `${directory}/step24-${name}-${width}.png`, fullPage: true });
  }
  await page.setViewportSize(size);
}

/** Inga formulär i arbetsytan lämnar valideringen till webbläsaren. */
async function expectNoNativeValidation(page: Page) {
  expect(await page.evaluate(() => [...document.querySelectorAll("form")].filter(form => !form.noValidate &&
    form.querySelector("[required], [minlength], [pattern], input[type=email]")).length)).toBe(0);
}

test("ny tävling: direkt in, tomlägen med åtgärd, svenska fältfel och tre deltagare på under tio klick", async ({ browser }) => {
  test.setTimeout(300_000);
  const suffix = unique();
  const owner = await registerAccount(browser, `arbetsyta.${suffix}@exempel.se`, "Ada Arbetsyta");

  // Skapa tävling: tomt formulär ger svenska fel vid fälten, ingen webbläsarruta, och tidszonen ligger under "Mer".
  const create = owner.locator("form").filter({ has: owner.getByRole("button", { name: "Skapa tävling" }) });
  await expect(create).toHaveAttribute("novalidate", "");
  await expect(create.getByLabel("Tidszon")).toBeHidden();
  await create.getByRole("button", { name: "Skapa tävling" }).click();
  await expect(create.getByText("Skriv tävlingens namn (minst 2 tecken).")).toBeVisible();
  await expect(create.getByText("Skriv tävlingens datum som ÅÅÅÅ-MM-DD", { exact: false })).toBeVisible();
  await expect(create.getByLabel("Tävlingens namn")).toHaveAttribute("aria-invalid", "true");
  await expect(create.getByLabel("Tävlingens namn")).toBeFocused();
  await expect(owner).toHaveURL(/\/organizer$/);

  // Etappen är valfri. "Skapa tävling" leder direkt in i arbetsytan.
  await create.getByLabel("Tävlingens namn").fill(`Arbetsyta ${suffix}`);
  await create.getByLabel("Datum").fill(today());
  await create.getByRole("button", { name: "Skapa tävling" }).click();
  await owner.waitForURL(/\/admin\/[0-9a-f-]+\/manage$/);
  const raceId = owner.url().split("/").at(-2)!;
  await expect(owner.getByRole("heading", { name: `Arbetsyta ${suffix}` })).toBeVisible();
  await expect(owner.getByText(/^Lopp 1 · /)).toBeVisible();
  await warmRoute(owner, `/api/admin/races/${raceId}/administrator/course-classes`, "POST");
  await warmRoute(owner, `/api/admin/races/${raceId}/administrator/registration`, "POST");
  await warmRoute(owner, `/api/admin/races/${raceId}/administrator/registration-candidates`, "POST");

  // Banor utan banor: en primär "Ny bana" som öppnar formuläret direkt; banfilen är andra vägen.
  await expect(sectionButton(owner, "Banor")).toHaveAttribute("aria-current", "step");
  await expect(owner.getByText("Det finns inga banor ännu.")).toBeVisible();
  await expect(owner.getByRole("button", { name: "eller läs in banfil" })).toBeVisible();
  await screenshots(owner, "tom-arbetsyta");
  await owner.getByRole("button", { name: "Ny bana" }).click();
  const courseForm = owner.locator("form").filter({ has: owner.getByRole("button", { name: "Spara bana och klass" }) });
  await expect(courseForm).toHaveAttribute("novalidate", "");
  await courseForm.getByRole("button", { name: "Spara bana och klass" }).click();
  for (const error of ["Skriv banans namn.", "Skriv klassens namn.", "Skriv kontrollerna i ordning, till exempel 31 32 33."]) {
    await expect(courseForm.getByText(error)).toBeVisible();
  }
  await expectNoNativeValidation(owner);
  await courseForm.getByLabel("Bannamn").fill("Lång");
  await courseForm.getByLabel("Klassnamn").fill("H21");
  await courseForm.getByLabel("Startsätt").selectOption({ label: "Minutstart" });
  await courseForm.getByLabel("Kontrollföljd").fill("31 32 33");
  await courseForm.getByRole("button", { name: "Spara bana och klass" }).click();
  await expect(owner.getByText("Banan och klassen är sparade.")).toBeVisible();
  // Formuläret töms helt efter sparandet, även startsättet, och står kvar för nästa bana.
  await expect(courseForm.getByLabel("Bannamn")).toHaveValue("");
  await expect(courseForm.getByLabel("Startsätt")).toHaveValue("PUNCH");
  await courseForm.getByLabel("Bannamn").fill("Kort");
  await courseForm.getByLabel("Klassnamn").fill("D21");
  await courseForm.getByLabel("Kontrollföljd").fill("31 33");
  await courseForm.getByRole("button", { name: "Spara bana och klass" }).click();
  await expect(owner.getByRole("row", { name: /^Kort/ })).toBeVisible();
  // Sparandet låser inte sidopanelen, och beskedet om pågående ändring syns bara när man försöker lämna steget.
  await expect(sectionButton(owner, "Klasser")).toBeEnabled();
  await expect(owner.getByText("Slutför eller avbryt den pågående ändringen")).toHaveCount(0);
  await screenshots(owner, "banor");
  // En ändrad rad som inte är sparad: att byta steg stannar kvar med beskedet; en orörd rad stängs bara.
  await owner.getByRole("button", { name: "Redigera Kort" }).click();
  await owner.getByLabel("Kontroller i ordning").fill("31 32 33");
  await sectionButton(owner, "Klasser").click();
  await expect(owner.getByText("Slutför eller avbryt den pågående ändringen innan du byter steg.")).toBeVisible();
  await expect(sectionButton(owner, "Banor")).toHaveAttribute("aria-current", "step");
  await owner.getByRole("button", { name: "Avbryt" }).click();
  await expect(owner.getByText("Slutför eller avbryt den pågående ändringen")).toHaveCount(0);

  // Tre deltagare: Anmälda, Ny deltagare, klass, fyll i och Lägg till; formuläret står kvar. Enter lägger också till.
  const clicks = clickCounter();
  await clicks.click(sectionButton(owner, "Anmälda"));
  await expect(owner.getByRole("region", { name: "Deltagare" }).getByText("Inga anmälda ännu.")).toBeVisible();
  await clicks.click(owner.getByRole("button", { name: "Ny deltagare" }));
  const entryForm = owner.locator("form").filter({ has: owner.getByRole("button", { name: "Lägg till", exact: true }) });
  await expect(entryForm).toHaveAttribute("novalidate", "");
  // Tomt formulär: svenska fel vid fälten.
  await entryForm.getByRole("button", { name: "Lägg till", exact: true }).click();
  for (const error of ["Välj klass.", "Skriv förnamnet.", "Skriv efternamnet."]) await expect(entryForm.getByText(error)).toBeVisible();
  const status = entryForm.getByRole("status");
  await clicks.choose(entryForm.getByRole("combobox", { name: "Klass" }), "H21");
  // Minutstart som lottas senare: starttiden är frivillig.
  await expect(entryForm.getByText("Lämna tomt – lottas senare.")).toBeVisible();
  await entryForm.getByLabel("Förnamn").fill("Anna");
  await entryForm.getByRole("textbox", { name: "Efternamn" }).fill("Ek");
  await entryForm.getByLabel("Klubb").fill("OK Ek");
  await entryForm.getByLabel("Bricka (valfritt)").fill("8240001");
  await clicks.click(entryForm.getByRole("button", { name: "Lägg till", exact: true }));
  await expect(status).toContainText("Anna Ek är anmäld i H21.");
  await expect(entryForm.getByLabel("Förnamn")).toBeFocused();
  await expect(entryForm.getByRole("combobox", { name: "Klass" })).toHaveValue(/.+/);
  await entryForm.getByLabel("Förnamn").fill("Bo");
  await entryForm.getByRole("textbox", { name: "Efternamn" }).fill("Lind");
  await entryForm.getByLabel("Bricka (valfritt)").fill("8240002");
  await entryForm.getByLabel("Bricka (valfritt)").press("Enter");
  await expect(status).toContainText("Bo Lind är anmäld i H21.");
  await expect(owner.getByText("Visar 2 av 2")).toBeVisible();
  await expect(entryForm.getByLabel("Förnamn")).toBeEnabled();
  await screenshots(owner, "ny-deltagare");
  await clicks.choose(entryForm.getByRole("combobox", { name: "Klass" }), "D21");
  await entryForm.getByLabel("Förnamn").fill("Cecilia");
  await entryForm.getByRole("textbox", { name: "Efternamn" }).fill("Holm");
  await entryForm.getByLabel("Bricka (valfritt)").fill("8240003");
  await clicks.click(entryForm.getByRole("button", { name: "Lägg till", exact: true }));
  await expect(status).toContainText("Cecilia Holm är anmäld i D21.");
  expect(clicks.count).toBeLessThan(10);
  await expect(sectionButton(owner, "Anmälda")).toHaveAccessibleDescription(/3 anmälda/);
  // Filterraden: sök och klass; resten under "Fler filter". Ingen "Bred tabell".
  await expect(owner.getByRole("button", { name: "Bred tabell" })).toHaveCount(0);
  await expect(owner.getByLabel("Status")).toHaveCount(0);
  await owner.getByRole("button", { name: "Fler filter" }).click();
  await expect(owner.getByLabel("Status")).toBeVisible();
  await expect(owner.getByText(/hyrbrickor/)).toHaveCount(0);

  // Deltagarkortet: samma ord för startsätt; Anna har minutstart utan tid än.
  await owner.getByRole("button", { name: "Anna Ek OK Ek" }).click();
  const card = owner.getByRole("region", { name: "Deltagarkort" });
  await expect(card.getByRole("heading", { name: "Anna Ek" })).toBeVisible();
  await expect(card).toContainText("Minutstart · Ingen starttid");
  await screenshots(owner, "deltagarkort");

  // Start: 1 Lottning, 2 Startlistan, 3 Publicera startlistan. Tom första start ger ett svenskt fel.
  await openStep(owner, "Start");
  const order = await Promise.all(["Lottning", "Startlistan", "Publicera startlistan"].map(async name =>
    (await owner.getByRole("heading", { name, exact: true }).boundingBox())?.y ?? -1));
  expect(order.every((y, index) => y > 0 && (index === 0 || y > order[index - 1]!))).toBe(true);
  const draw = owner.getByRole("region", { name: "Lottning" });
  await draw.getByLabel("Lotta H21").check();
  await draw.getByRole("button", { name: "Visa lottning" }).click();
  await expect(draw.getByText("Ange första start som klockslag, till exempel 10:00.")).toBeVisible();
  await screenshots(owner, "start");

  // Avläsning: läget läses in av sig självt.
  await openStep(owner, "Avläsning");
  await expect(owner.getByTestId("in-forest-count")).toHaveText("3");
  await screenshots(owner, "avlasning");

  // Inställningar: publiceringen finns bara i steget Publicera; Inställningar länkar dit.
  await openStep(owner, "Inställningar");
  await expect(owner.getByRole("button", { name: "Publicera tävlingen" })).toHaveCount(0);
  await screenshots(owner, "installningar");
  await owner.getByRole("button", { name: "Gå till Publicera" }).click();
  await expect(sectionButton(owner, "Publicera")).toHaveAttribute("aria-current", "step");
  await expect(owner.getByRole("button", { name: "Publicera tävlingen" })).toBeVisible();

  // Mobil: tillbakalänken, räknarna och en meny för genvägarna; inget sidled.
  await owner.setViewportSize({ width: 390, height: 800 });
  await expect(owner.getByRole("link", { name: "‹ Mina tävlingar" })).toBeVisible();
  await expect(owner.getByLabel("Läget just nu")).toBeVisible();
  await expect(owner.getByRole("link", { name: /Öppna avläsningen/ })).toBeHidden();
  await owner.getByText("Meny").click();
  await expect(owner.getByRole("link", { name: /Öppna avläsningen/ })).toBeVisible();
  await expect(owner.getByRole("button", { name: "Logga ut" })).toBeVisible();
  expect(await owner.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  if (process.env.E2E_SCREENSHOT_DIR) {
    await owner.screenshot({ path: `${process.env.E2E_SCREENSHOT_DIR}/step24-mobil-toppbalk-390.png` });
    await owner.getByText("Meny").click();
    await openStep(owner, "Anmälda");
    await owner.screenshot({ path: `${process.env.E2E_SCREENSHOT_DIR}/step24-mobil-anmalda-390.png`, fullPage: true });
    await owner.setViewportSize({ width: 1280, height: 900 });
    await owner.screenshot({ path: `${process.env.E2E_SCREENSHOT_DIR}/step24-toppbalk-1280.png` });
  }
  await owner.setViewportSize({ width: 1280, height: 720 });

  // Avläsningssidan: tävlingsdatan med klockslag som rubrik och versionen som liten detalj.
  await owner.goto(`/admin/${raceId}/readout`);
  await owner.waitForURL(`**/readout/index.html#${raceId}`);
  await expect(owner.getByTestId("package-status")).toHaveText(/^Uppdaterad \d\d:\d\d v\d+$/);
  await expect(owner.getByText("Underlag")).toHaveCount(0);
  await screenshots(owner, "avlasningssidan");
});

test("rogaining och stafett: ett tomläge och en väg vidare", async ({ browser }) => {
  test.setTimeout(180_000);
  const suffix = unique();
  const owner = await registerAccount(browser, `tomlagen.${suffix}@exempel.se`, "Tom Läge");
  const create = async (name: string, type: string) => {
    await owner.goto("/organizer");
    await owner.getByLabel("Tävlingens namn").fill(name);
    await owner.getByLabel("Datum").fill(today());
    await owner.getByRole("radio", { name: type, exact: true }).check();
    await owner.getByRole("button", { name: "Skapa tävling" }).click();
    await owner.waitForURL(/\/admin\/[0-9a-f-]+\/manage$/);
  };

  // Rogaining: kontrollerna med poäng först och ett enda tomläge, inga motstridiga texter om banor och klasser.
  await create(`Poäng ${suffix}`, "Rogaining");
  await expect(owner.getByText("Inga kontroller ännu")).toBeVisible();
  await expect(owner.getByText("Det finns inga banor ännu.")).toHaveCount(0);
  await expect(owner.getByText("Det finns inga klasser ännu.")).toHaveCount(0);
  await screenshots(owner, "rogaining-tom");
  await owner.getByRole("button", { name: "Lägg till kontroller och klass" }).click();
  await expect(owner.getByRole("form", { name: "Kontroller och klass" })).toBeVisible();

  // Stafett utan stafettklass: Lag säger vad som behövs och leder dit.
  await create(`Stafett ${suffix}`, "Stafett");
  await openStep(owner, "Lag");
  await expect(owner.getByText("Det finns ingen stafettklass ännu.")).toBeVisible();
  await expect(owner.getByRole("button", { name: "Ny deltagare" })).toHaveCount(0);
  await screenshots(owner, "stafett-lag-tom");
  await owner.getByRole("button", { name: "Gå till Klasser & sträckor" }).click();
  await expect(sectionButton(owner, "Klasser & sträckor")).toHaveAttribute("aria-current", "step");
});
