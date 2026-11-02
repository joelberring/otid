import { expect, test, type Page } from "@playwright/test";
import { addCourseAndClass, addEntry, createRace, newContext, openStep, publishRace, registerAccount, reviewScreenshots, sendReadout,
  today, unique, warmRoute } from "./helpers";

/**
 * ADR-0191: rättelserna för en löpare finns i deltagarkortets "Rätta" och Avläsning länkar dit (beslut 1); start- och
 * resultatlistorna har klubbfilter och sammanställning per klubb (beslut 2); importen av anmälda har sin plats under Anmälda
 * och Inställningar hänvisar dit (beslut 3). Påhittade löpare och klubbar.
 */
async function noHorizontalScroll(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
}

test("Rätta i deltagarkortet, klubbfilter och sammanställning per klubb, import under Anmälda", async ({ browser }) => {
  test.setTimeout(420_000);
  const suffix = unique();
  const owner = await registerAccount(browser, `ratta.${suffix}@exempel.se`, "Rut Rättare");
  const raceId = await createRace(owner, `Klubbkvällen ${suffix}`, today(), "Tävling");
  await publishRace(owner);
  await addCourseAndClass(owner, "Lång", "H21", "31 32 33");
  await addCourseAndClass(owner, "Kort", "D21", "31 33");
  await addEntry(owner, { className: "H21", givenName: "Ada", familyName: "Ek", club: "OK Ekorren", card: "7410001" });
  await addEntry(owner, { className: "H21", givenName: "Bo", familyName: "Lind", club: "IFK Lindön", card: "7410002" });
  await addEntry(owner, { className: "D21", givenName: "Cia", familyName: "Holm", club: "OK Ekorren", card: "7410003" });

  // Beslut 3: importen finns under Anmälda; Inställningar hänvisar dit.
  await expect(owner.getByRole("link", { name: "Importera anmälda (IOF XML)" })).toHaveAttribute("href", `/admin/${raceId}/imports`);
  await openStep(owner, "Inställningar");
  const imports = owner.getByRole("region", { name: "Import" });
  await expect(imports.getByRole("link")).toHaveCount(0);
  await imports.getByRole("button", { name: "Gå till Anmälda" }).click();
  await expect(owner.getByRole("navigation", { name: "Tävlingens delar" }).getByRole("button", { name: "Anmälda", exact: true }))
    .toHaveAttribute("aria-current", "step");

  const day = today();
  const at = (time: string) => `${day}T${time}.000Z`;
  await sendReadout(owner, raceId, { cardNumber: "7410001", startPunchedAt: at("16:00:00"), finishPunchedAt: at("16:40:00"),
    punches: [31, 32, 33].map((code, index) => ({ code, punchedAt: at(`16:${10 + index * 10}:00`) })) });
  // Bo missar 32.
  await sendReadout(owner, raceId, { cardNumber: "7410002", startPunchedAt: at("16:01:00"), finishPunchedAt: at("16:45:00"),
    punches: [31, 33].map((code, index) => ({ code, punchedAt: at(`16:${11 + index * 20}:00`) })) });
  await sendReadout(owner, raceId, { cardNumber: "7410003", startPunchedAt: at("16:02:00"), finishPunchedAt: at("16:32:00"),
    punches: [31, 33].map((code, index) => ({ code, punchedAt: at(`16:${12 + index * 10}:00`) })) });
  for (const path of ["race-corrections", "uninterpreted-readouts", "forest-watch"]) await warmRoute(owner, `/api/admin/races/${raceId}/administrator/${path}`);
  await owner.reload();

  // Beslut 1: Avläsning har inga egna rättelser för en löpare, bara vägen till kortet; verktygen för alla ligger under Mer.
  await openStep(owner, "Avläsning");
  await expect(owner.getByText("Rätta observerad måltid")).toHaveCount(0);
  const shortcut = owner.getByRole("region", { name: "Rätta en löpare" }).filter({ visible: true });
  await shortcut.getByLabel("Löpare").selectOption({ label: "Bo Lind · H21 · 7410002" });
  await shortcut.getByRole("button", { name: "Öppna Rätta" }).click();
  const card = owner.getByRole("region", { name: "Deltagarkort" });
  await expect(card.getByRole("heading", { name: "Bo Lind" })).toBeVisible();
  const fix = card.getByRole("region", { name: "Rätta" });
  await expect(fix).toBeVisible();
  await expect(fix).toBeFocused();
  await expect(card.getByRole("region", { name: "Resultat", exact: true })).toContainText("Felstämplad");
  for (const button of ["Ange tid manuellt", "Godkänn saknade kontroller", "Byt bricka", "Byt klass"]) {
    await expect(fix.getByRole("button", { name: button })).toBeVisible();
  }
  await fix.getByText("Mer", { exact: true }).click();
  await expect(fix.getByText("Rätta observerad måltid")).toBeVisible();
  await reviewScreenshots(owner, "adr0191-ratta");

  // Status ändras i Rätta som förut: bekräfta felstämplad, med journal i historiken.
  await fix.getByLabel("Ändra status").selectOption({ label: "Bekräfta felstämplad" });
  await fix.getByRole("button", { name: "Bekräfta ändringen" }).click();
  await expect(card.getByRole("region", { name: "Resultat", exact: true })).toContainText("Felstämpling bekräftad");
  await expect(card.getByRole("region", { name: "Historik" })).toContainText("Felstämpling bekräftad");

  // Byt bricka i Rätta öppnar samma formulär som förut.
  await fix.getByRole("button", { name: "Byt bricka" }).click();
  await expect(card.getByRole("button", { name: "Ändra bricka", pressed: true })).toBeVisible();

  await openStep(owner, "Avläsning");
  await owner.getByText("Mer: verktyg för hela tävlingen", { exact: true }).click();
  await expect(owner.getByRole("region", { name: "Rättningar för hela tävlingen" })).toBeVisible();

  // Beslut 2: publika resultat för en klubb i alla klasser, med länkbar adress, och sammanställningen per klubb.
  const visitor = await (await newContext(browser)).newPage();
  for (const path of ["results", "relay-results", "radio"]) await warmRoute(visitor, `/api/public/races/${raceId}/${path}`);
  await visitor.goto(`/results/${raceId}`);
  const toolbar = visitor.getByRole("toolbar", { name: "Listans verktyg" });
  await toolbar.getByLabel("Klubb").selectOption("OK Ekorren");
  await expect(visitor).toHaveURL(/klubb=OK\+Ekorren|klubb=OK%20Ekorren/);
  await expect(toolbar).toContainText("2 löpare");
  await expect(visitor.getByRole("table", { name: "H21" })).toContainText("Ada Ek");
  await expect(visitor.getByRole("table", { name: "H21" })).not.toContainText("Bo Lind");
  await expect(visitor.getByRole("table", { name: "D21" })).toContainText("Cia Holm");
  await visitor.emulateMedia({ media: "print" });
  await expect(visitor.getByRole("heading", { name: "Resultatlista per klass · OK Ekorren" })).toBeVisible();
  await visitor.emulateMedia({ media: "screen" });
  await visitor.reload();
  await expect(toolbar.getByLabel("Klubb")).toHaveValue("OK Ekorren");
  await toolbar.getByLabel("Klubb").selectOption("");
  await toolbar.getByRole("button", { name: "Klubbar", exact: true }).click();
  const summary = visitor.getByRole("table", { name: "Sammanställning per klubb" });
  await expect(summary.getByRole("row", { name: /OK Ekorren/ })).toContainText(/2\s*2\s*2/);
  await expect(summary.getByRole("row", { name: /IFK Lindön/ })).toContainText("1");
  await expect(summary.getByRole("row", { name: /Totalt/ })).toContainText(/3\s*2\s*2/);
  await summary.getByRole("button", { name: "IFK Lindön" }).click();
  await expect(toolbar.getByRole("button", { name: "Per klubb", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(visitor.getByRole("region", { name: "IFK Lindön" })).toContainText("Bo Lind");
  await expect(visitor.getByRole("region", { name: "OK Ekorren" })).toHaveCount(0);
  await reviewScreenshots(visitor, "adr0191-klubb");
  await visitor.setViewportSize({ width: 390, height: 800 });
  await noHorizontalScroll(visitor);
});
