import { expect, type Browser, type Page } from "@playwright/test";

/** Gemensamma steg för webbläsartesterna (ADR-0168). */
export const password = "hemligt-lösen-1";
export const unique = () => Math.random().toString(36).slice(2, 8);

export async function registerAccount(browser: Browser, loginName: string, displayName: string): Promise<Page> {
  const page = await (await browser.newContext()).newPage();
  await page.goto("/organizer");
  await page.getByRole("button", { name: "Har du inget konto? Skapa ett" }).click();
  await page.getByLabel("Ditt namn").fill(displayName);
  await page.getByLabel("Inloggningsnamn").fill(loginName);
  await page.getByLabel("Lösenord").fill(password);
  await page.getByRole("button", { name: "Skapa konto" }).click();
  await expect(page.getByRole("heading", { name: "Dina tävlingar" })).toBeVisible();
  return page;
}

/** Tävlingstyperna i "Skapa tävling" (ADR-0170 beslut 1). */
export type RaceTypeName = "Träning" | "Liten tävling" | "Tävling" | "Tävling med gafflade banor" | "Stafett" | "Rogaining";

/** Skapar tävling av vald typ och öppnar arbetsytan. Returnerar loppets id. */
export async function createRace(owner: Page, eventName: string, date = "2026-10-08", type: RaceTypeName = "Tävling"): Promise<string> {
  await owner.getByLabel("Eventnamn").fill(eventName);
  await owner.getByLabel("Loppets namn").fill("Torsdag");
  await owner.getByLabel("Datum").fill(date);
  await owner.getByRole("radio", { name: type, exact: true }).check();
  await owner.getByRole("button", { name: "Skapa tävling" }).last().click();
  await expect(owner.getByText("Tävlingen skapades.")).toBeVisible();
  // Kvittot under "Skapa tävling" står sist på sidan; listan ovanför kan ha fler tävlingar.
  await owner.getByRole("button", { name: "Öppna arbetsytan" }).last().click();
  await owner.waitForURL(/\/admin\/[0-9a-f-]+\/manage$/);
  await expect(owner.getByRole("heading", { name: eventName })).toBeVisible();
  return owner.url().split("/").at(-2)!;
}

/**
 * Utvecklingsservern kompilerar en route vid första anropet, ibland långsammare än arbetsytans gräns på 15 s.
 * Ett anrop i förväg (svaret spelar ingen roll) gör att flödet sedan mäter appen, inte kompileringen.
 */
export async function warmRoute(page: Page, path: string, method: "GET" | "POST" = "GET"): Promise<void> {
  await page.request.fetch(path, { method, failOnStatusCode: false, timeout: 120_000 });
}

/** Delarna i sidopanelen; vilka som finns avgörs av tävlingstypen (ADR-0170). */
export type SectionName = "Banor" | "Banor & klasser" | "Kontroller & poäng" | "Klasser" | "Klasser & sträckor" | "Anmälda" | "Deltagare" |
  "Lag" | "Start" | "Avläsning" | "Resultat" | "Inställningar";

/** En del i sidopanelen "Tävlingens delar". Delens status är knappens beskrivning. */
export function sectionButton(page: Page, name: SectionName) {
  return page.getByRole("navigation", { name: "Tävlingens delar" }).getByRole("button", { name, exact: true });
}

export async function openStep(page: Page, name: SectionName): Promise<void> {
  await sectionButton(page, name).click();
  await expect(sectionButton(page, name)).toHaveAttribute("aria-current", "step");
}

/** Öppnar den första av delarna som tävlingstypen har (t.ex. "Banor" eller "Banor & klasser"). */
async function openFirst(page: Page, names: SectionName[]): Promise<void> {
  // Vänta tills sidopanelen visar någon av delarna (den ritas om när tävlingen läses in på nytt).
  await expect(names.map(name => sectionButton(page, name)).reduce((all, one) => all.or(one)).first()).toBeVisible();
  for (const name of names) {
    if (await sectionButton(page, name).count()) { await openStep(page, name); return; }
  }
  throw new Error(`Ingen av delarna ${names.join(", ")} finns`);
}

/** Ny bana med klass sparas direkt, utan granskningssteg (inget resultat ändras). */
export async function addCourseAndClass(owner: Page, courseName: string, className: string, controls: string): Promise<void> {
  await openFirst(owner, ["Banor", "Banor & klasser", "Kontroller & poäng"]);
  const courseForm = owner.locator("form").filter({ has: owner.getByRole("button", { name: "Spara bana och klass" }) });
  if (!await courseForm.isVisible()) await owner.getByText("Förbered bana och klass").click();
  await courseForm.getByLabel("Bannamn").fill(courseName);
  await courseForm.getByLabel("Klassnamn").fill(className);
  await courseForm.getByLabel("Kontrollföljd").fill(controls);
  await courseForm.getByRole("button", { name: "Spara bana och klass" }).click();
  await expect(owner.getByText("Banan och klassen är sparade.")).toBeVisible();
}

export async function addEntry(owner: Page, entry: { className: string; givenName: string; familyName: string; club: string; card: string }): Promise<void> {
  await openFirst(owner, ["Anmälda", "Deltagare"]);
  await owner.getByRole("button", { name: "Ny deltagare" }).click();
  const entryForm = owner.locator("form").filter({ has: owner.getByRole("button", { name: "Granska anmälan" }) });
  await entryForm.getByLabel("Anmälningsklass").selectOption({ label: entry.className });
  await entryForm.getByLabel("Förnamn").fill(entry.givenName);
  await entryForm.getByRole("textbox", { name: "Efternamn" }).fill(entry.familyName);
  await entryForm.getByLabel("Klubb").fill(entry.club);
  await entryForm.getByLabel("Bricknummer (valfritt)").fill(entry.card);
  await entryForm.getByRole("button", { name: "Granska anmälan" }).click();
  await owner.getByRole("button", { name: "Bekräfta anmälan" }).click();
  await expect(owner.getByText("Deltagaren är anmäld.")).toBeVisible();
}
