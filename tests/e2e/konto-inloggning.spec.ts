import { expect, test, type Browser, type Page } from "@playwright/test";
import { fillNewPassword, logIn, newContext, resetLink, unique, verificationLink, warmRoute } from "./helpers";

/**
 * ADR-0205: kontot från klubbmötet 2026-11-03. Fel lösenord vid registreringen, ett bekräftelsemejl och ett återställningsmejl
 * (lästa ur den falska SMTP-serverns mejl) i olika ordning och i olika webbläsare ska alltid leda in eller ge ett tydligt nästa
 * steg. Förut: bekräftelselänken krävde registreringens lösenord, och spärren efter fem fel stod kvar efter återställningen.
 */
const TYPO = "rätt-lösen-1x";
const INTENDED = "rätt-lösen-1";
const WRONG = "E-postadressen eller lösenordet stämmer inte.";

async function screenshots(page: Page, name: string) {
  const directory = process.env.E2E_SCREENSHOT_DIR;
  if (!directory) return;
  for (const width of [1280, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await page.screenshot({ path: `${directory}/konto-${name}-${width}.png`, fullPage: true });
  }
  await page.setViewportSize({ width: 1280, height: 720 });
}

/** En ny webbläsare (egen kontext, inga kakor), som telefonen eller en annan dator. */
const otherBrowser = async (browser: Browser) => (await newContext(browser)).newPage();

async function registerWithTypo(page: Page, email: string) {
  await page.goto("/organizer");
  // Ingen Google-knapp utan Google-klient på servern (testservern har ingen).
  await expect(page.getByRole("link", { name: "Logga in med Google" })).toHaveCount(0);
  await page.getByRole("button", { name: "Har du inget konto? Skapa ett" }).click();
  await page.getByLabel("Ditt namn").fill("Klubbmedlem");
  await page.getByLabel("E-postadress").fill(email);
  // Lösenordet två gånger: olika ger beskedet direkt och knappen går inte att trycka på.
  await page.getByLabel("Lösenord", { exact: true }).fill(INTENDED);
  await page.getByLabel("Upprepa lösenordet", { exact: true }).fill("rätt-x");
  await expect(page.getByText("Lösenorden är inte lika.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Skapa konto" })).toBeDisabled();
  // Ögat visar lösenordet.
  const field = page.getByLabel("Lösenord", { exact: true });
  await expect(field).toHaveAttribute("type", "password");
  await page.getByRole("button", { name: "Visa lösenordet" }).first().click();
  await expect(field).toHaveAttribute("type", "text");
  await screenshots(page, "registrering-olika");
  // Samma fel i båda fälten går igenom (det är det som hände på mötet).
  await fillNewPassword(page, TYPO);
  await page.getByRole("button", { name: "Skapa konto" }).click();
  await expect(page.getByText("Vi har skickat ett mejl till")).toBeVisible();
}

test("fel lösenord vid registreringen: återställning i en annan webbläsare, sedan den gamla bekräftelselänken", async ({ browser }) => {
  test.setTimeout(240_000);
  for (const path of ["/recover", "/verify"]) {
    const page = await browser.newPage();
    await warmRoute(page, path);
    await page.close();
  }
  const email = `moteskonto.${unique()}@exempel.se`;
  const laptop = await otherBrowser(browser);
  await registerWithTypo(laptop, email);
  const confirmation = await verificationLink(email);

  // Ordning 1: det tänkta lösenordet stämmer inte; efter fem fel spärras inloggningen från datorn.
  for (let attempt = 0; attempt < 5; attempt += 1) {
    await logIn(laptop, email, INTENDED);
    await expect(laptop.getByText(WRONG)).toBeVisible();
  }
  await logIn(laptop, email, INTENDED);
  await expect(laptop.getByText("För många misslyckade inloggningar.", { exact: false })).toBeVisible();
  await screenshots(laptop, "sparrad");

  // Glömt lösenordet från datorn; länken öppnas i telefonen (annan webbläsare) på ett obekräftat konto.
  await laptop.getByRole("link", { name: "Glömt lösenordet?" }).click();
  await laptop.getByLabel("E-postadress").fill(email);
  await laptop.getByRole("button", { name: "Skicka länk" }).click();
  await expect(laptop.getByText("Om adressen har ett konto i O-Tid har vi skickat en länk dit.")).toBeVisible();
  const phone = await otherBrowser(browser);
  await phone.goto(await resetLink(email));
  await expect(phone.getByRole("heading", { name: "Välj nytt lösenord" })).toBeVisible();
  await fillNewPassword(phone, INTENDED, "Nytt lösenord");
  await screenshots(phone, "nytt-losenord");
  await phone.getByRole("button", { name: "Spara och logga in" }).click();
  await expect(phone.getByRole("heading", { name: "Dina tävlingar" })).toBeVisible();
  await expect(phone.getByText("Din e-postadress är inte bekräftad.")).toHaveCount(0);

  // Tillbaka på datorn: spärren gäller inte längre eftersom lösenordet är bytt.
  await logIn(laptop, email, INTENDED);
  await expect(laptop.getByRole("heading", { name: "Dina tävlingar" })).toBeVisible();

  // Ordning 2: den gamla bekräftelselänken i en tredje webbläsare säger att adressen redan är bekräftad, utan lösenord.
  const third = await otherBrowser(browser);
  await third.goto(confirmation);
  await expect(third.getByText("E-postadressen är redan bekräftad.")).toBeVisible();
  await expect(third.getByLabel("Lösenord", { exact: true })).toHaveCount(0);
  await screenshots(third, "redan-bekraftad");
  await third.getByRole("link", { name: "Logga in" }).click();
  await logIn(third, email, INTENDED);
  await expect(third.getByRole("heading", { name: "Dina tävlingar" })).toBeVisible();
});

test("fel lösenord vid registreringen: bekräftelselänken i en annan webbläsare väljer lösenord, sedan återställning", async ({ browser }) => {
  test.setTimeout(180_000);
  const email = `bekrafta.${unique()}@exempel.se`;
  const laptop = await otherBrowser(browser);
  await registerWithTypo(laptop, email);
  await logIn(laptop, email, INTENDED);
  await expect(laptop.getByText(WRONG)).toBeVisible();

  // Ordning 3 och 4: länken öppnas i telefonen. Den bevisar adressen; lösenordet väljs här, utan registreringens lösenord.
  const link = await verificationLink(email);
  const phone = await otherBrowser(browser);
  await phone.goto(link);
  await expect(phone.getByRole("heading", { name: "Bekräfta e-postadressen" })).toBeVisible();
  expect(phone.url()).not.toContain("token=");
  await fillNewPassword(phone, INTENDED);
  await screenshots(phone, "bekrafta");
  await phone.getByRole("button", { name: "Bekräfta och logga in" }).click();
  await expect(phone.getByRole("heading", { name: "Dina tävlingar" })).toBeVisible();

  // Datorn: det tänkta lösenordet gäller nu, registreringens inte.
  await logIn(laptop, email, TYPO);
  await expect(laptop.getByText(WRONG)).toBeVisible();
  await logIn(laptop, email, INTENDED);
  await expect(laptop.getByRole("heading", { name: "Dina tävlingar" })).toBeVisible();

  // Samma länk igen: redan bekräftad. Återställningen fungerar sedan som vanligt och loggar in.
  const again = await otherBrowser(browser);
  await again.goto(link);
  await expect(again.getByText("E-postadressen är redan bekräftad.")).toBeVisible();
  await again.goto("/recover");
  await again.getByLabel("E-postadress").fill(email);
  await again.getByRole("button", { name: "Skicka länk" }).click();
  await expect(again.getByText("Om adressen har ett konto i O-Tid har vi skickat en länk dit.")).toBeVisible();
  await again.goto(await resetLink(email));
  await fillNewPassword(again, "tredje-lösen-3", "Nytt lösenord");
  await again.getByRole("button", { name: "Spara och logga in" }).click();
  await expect(again.getByRole("heading", { name: "Dina tävlingar" })).toBeVisible();
});
