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

/** Skapar tävling och öppnar arbetsytan. Returnerar loppets id. */
export async function createRace(owner: Page, eventName: string): Promise<string> {
  await owner.getByLabel("Eventnamn").fill(eventName);
  await owner.getByLabel("Loppets namn").fill("Torsdag");
  await owner.getByLabel("Datum").fill("2026-10-08");
  await owner.getByRole("button", { name: "Skapa tävling" }).last().click();
  await expect(owner.getByText("Tävlingen skapades.")).toBeVisible();
  await owner.getByRole("button", { name: "Öppna arbetsytan" }).first().click();
  await owner.waitForURL(/\/admin\/[0-9a-f-]+\/manage$/);
  await expect(owner.getByRole("heading", { name: eventName })).toBeVisible();
  return owner.url().split("/").at(-2)!;
}

export type ChecklistStep = "Banor" | "Klasser" | "Anmälda" | "Start" | "Avläsning" | "Resultat";

/** Steget i arbetsytans checklista (ADR-0169 beslut 4). Stegets status är knappens beskrivning. */
export function checklistStep(page: Page, step: ChecklistStep) {
  return page.getByRole("navigation", { name: "Checklista" }).getByRole("button", { name: step, exact: true });
}

export async function openStep(page: Page, step: ChecklistStep): Promise<void> {
  await checklistStep(page, step).click();
  await expect(checklistStep(page, step)).toHaveAttribute("aria-current", "step");
}

/** Ny bana med klass sparas direkt, utan granskningssteg (inget resultat ändras). */
export async function addCourseAndClass(owner: Page, courseName: string, className: string, controls: string): Promise<void> {
  await openStep(owner, "Banor");
  const courseForm = owner.locator("form").filter({ has: owner.getByRole("button", { name: "Spara bana och klass" }) });
  if (!await courseForm.isVisible()) await owner.getByText("Förbered bana och klass").click();
  await courseForm.getByLabel("Bannamn").fill(courseName);
  await courseForm.getByLabel("Klassnamn").fill(className);
  await courseForm.getByLabel("Kontrollföljd").fill(controls);
  await courseForm.getByRole("button", { name: "Spara bana och klass" }).click();
  await expect(owner.getByText("Banan och klassen är sparade.")).toBeVisible();
}

export async function addEntry(owner: Page, entry: { className: string; givenName: string; familyName: string; club: string; card: string }): Promise<void> {
  await openStep(owner, "Anmälda");
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
