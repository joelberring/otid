import { expect, test, type Locator, type Page } from "@playwright/test";
import { createRace, openStep, registerAccount, sectionButton, unique, warmRoute } from "./helpers";

/**
 * Översynen av användbarheten 2026-11-17: en ny användare i en träning, på dator och i telefonen (390 px). Personer är en egen
 * del, "Övning i mobilen" leder till banläggningens flik Träning, bingo-ledarens och deltagarens sidor säger lugnt att ingen
 * övning är påslagen, Meny är en fullständig väg i telefonen och klubbytans flikar nås i 390 px.
 */
async function createClub(owner: Page, name: string): Promise<string> {
  await owner.goto("/organizer");
  const clubs = owner.getByRole("region", { name: "Mina klubbar" });
  await clubs.getByRole("button", { name: "Ny klubbyta" }).click();
  await clubs.getByLabel("Klubbens namn").fill(name);
  await clubs.getByRole("button", { name: "Skapa klubben" }).click();
  await owner.waitForURL(/\/organizer\/clubs\/[0-9a-f-]+$/);
  return /clubs\/([0-9a-f-]+)$/.exec(owner.url())![1]!;
}

/** Elementet ligger helt inom sidans bredd (inget klipps mot högerkanten). */
async function insideWidth(page: Page, element: Locator, viewport: number, margin = 0): Promise<void> {
  const box = await element.boundingBox();
  expect(box).not.toBeNull();
  expect(box!.x).toBeGreaterThanOrEqual(margin);
  expect(box!.x + box!.width).toBeLessThanOrEqual(viewport - margin);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(viewport);
}

test("översynen: Personer, Övning i mobilen, ledarens och deltagarens besked och Meny i telefonen", async ({ browser }) => {
  test.setTimeout(240_000);
  const suffix = unique();
  const owner = await registerAccount(browser, `oversyn.${suffix}@exempel.se`, "Olle Översyn");
  const raceId = await createRace(owner, `Översyn ${suffix}`, undefined, "Träning");
  await warmRoute(owner, `/admin/${raceId}/bingo`);
  const parts = owner.getByRole("navigation", { name: "Tävlingens delar" });

  // Starttriangeln är dekor utan text; Träning har inget steg Start.
  await expect(parts.getByText("Start", { exact: true })).toHaveCount(0);

  // Banor utan banor: tre val.
  const empty = owner.getByTestId("courses-empty");
  await expect(empty.getByRole("link", { name: "Lägg banor på kartan" })).toBeVisible();
  await expect(empty.getByRole("button", { name: "Ny bana" })).toBeVisible();
  await expect(empty.getByRole("button", { name: "Läs in banfil" })).toBeVisible();

  // Övning i mobilen: utan påslagen övning till banläggningens flik Träning.
  const exercise = owner.getByTestId("nav-mobile-exercise");
  await expect(exercise).toContainText("Övning i mobilen");
  await expect(exercise).toHaveAccessibleDescription("Bingo, Sänka skepp och virtuella kontroller");
  await expect(exercise).toHaveAttribute("href", `/admin/${raceId}/course-setting?flik=traning`);

  // Personer är en egen del; Inställningar hänvisar dit.
  await expect(sectionButton(owner, "Personer")).toHaveAccessibleDescription("Funktionärer och behörigheter");
  await openStep(owner, "Personer");
  await expect(owner.getByRole("region", { name: "Personer med behörighet" }).getByRole("form", { name: "Lägg till person" })).toBeVisible();
  await openStep(owner, "Inställningar");
  await expect(owner.getByRole("region", { name: "Personer med behörighet" })).toHaveCount(0);
  await owner.getByRole("button", { name: "Gå till Personer" }).click();
  await expect(sectionButton(owner, "Personer")).toHaveAttribute("aria-current", "step");
  await owner.goto(`/admin/${raceId}/manage?del=personer`);
  await expect(sectionButton(owner, "Personer")).toHaveAttribute("aria-current", "step", { timeout: 30_000 });

  // Förhandsvisningens adress, för deltagarens bingosida.
  await openStep(owner, "Publicera");
  const hubPath = await owner.getByRole("link", { name: "Förhandsvisa tävlingssidan" }).getAttribute("href");
  expect(hubPath).toMatch(/^\/t\//);

  // Bingo-ledarens sida utan påslagen övning: lugnt besked, knapp till fliken Träning och vägen tillbaka.
  await owner.goto(`/admin/${raceId}/bingo`);
  const off = owner.getByTestId("bingo-leader-off");
  await expect(off.getByText("Ingen övning i mobilen är påslagen för den här träningen.")).toBeVisible({ timeout: 30_000 });
  await expect(off.getByRole("link", { name: "Öppna fliken Träningsformer i banläggningen" }))
    .toHaveAttribute("href", `/admin/${raceId}/course-setting?flik=traning`);
  // Inget felbesked (Nexts egen route-announcer har också rollen alert, så rutorna räknas i stället).
  await expect(owner.locator('[data-tone="error"]')).toHaveCount(0);
  await owner.getByTestId("bingo-leader-back").click();
  await owner.waitForURL(new RegExp(`/admin/${raceId}/manage$`));

  // Deltagarens sida: eget besked, inte "Tävlingen är inte publicerad", också för arrangören som förhandsvisar.
  await owner.goto(`${hubPath}/bingo`);
  await expect(owner.getByText("Bingon är inte igång för den här träningen.")).toBeVisible({ timeout: 30_000 });
  await expect(owner.getByRole("heading", { name: "Tävlingen är inte publicerad" })).toHaveCount(0);
  await owner.getByRole("link", { name: "Till tävlingssidan" }).click();
  await owner.waitForURL(new RegExp(`${hubPath}$`));

  // "Till adminläget" klipps inte mot högerkanten, på dator och i telefonen.
  const adminLink = owner.getByTestId("admin-shortcut").getByRole("link", { name: "Till adminläget" });
  await expect(adminLink).toBeVisible({ timeout: 30_000 });
  await insideWidth(owner, adminLink, owner.viewportSize()!.width, 12);
  await owner.setViewportSize({ width: 390, height: 844 });
  await insideWidth(owner, adminLink, 390, 8);

  // Telefonen: remsan visar att den fortsätter, och Meny har alla delar med läge och raderna under banan.
  await owner.goto(`/admin/${raceId}/manage`);
  await expect(sectionButton(owner, "Banor & klasser")).toHaveAttribute("aria-current", "step", { timeout: 30_000 });
  await expect(owner.getByTestId("scroll-row-forward")).toBeVisible();
  await owner.getByText("Meny", { exact: true }).click();
  for (const id of ["COURSES", "ENTRIES", "PUBLISH", "READOUT", "RESULTS", "PEOPLE", "SETTINGS"]) {
    await expect(owner.getByTestId(`menu-step-${id}`)).toBeVisible();
  }
  await expect(owner.getByTestId("menu-step-PUBLISH")).toContainText("Inte publicerad");
  await expect(owner.getByTestId("menu-course-setting")).toBeVisible();
  await expect(owner.getByTestId("menu-mobile-exercise")).toContainText("Övning i mobilen");
  await owner.getByTestId("menu-step-RESULTS").click();
  await expect(sectionButton(owner, "Resultat")).toHaveAttribute("aria-current", "step");
  await expect(sectionButton(owner, "Resultat")).toBeInViewport();
  await expect(owner.getByTestId("menu-step-RESULTS")).toBeHidden();
  await owner.getByText("Meny", { exact: true }).click();
  await owner.getByTestId("menu-step-PEOPLE").click();
  await expect(owner.getByRole("region", { name: "Personer med behörighet" })).toBeVisible();
  await expect(sectionButton(owner, "Personer")).toBeInViewport();
  expect(await owner.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);

  // Klubbytans flikar: alla nås i 390 px, och kom igång-listans knappar sticker inte ut.
  await createClub(owner, `OK Översyn ${suffix}`);
  const tabs = owner.getByRole("tablist").first();
  await expect(owner.getByTestId("scroll-row-forward")).toBeVisible({ timeout: 30_000 });
  for (const name of ["Träningar", "Planering", "Kartor", "Medlemmar", "Enheter", "Klubben", "Import"]) {
    const tab = tabs.getByRole("tab", { name, exact: true });
    await tab.click();
    await expect(tab).toHaveAttribute("aria-selected", "true");
    // Nästan hela fliken i bild (en bråkdels pixel kan falla utanför vid kanten).
    await expect(tab).toBeInViewport({ ratio: 0.9 });
  }
  await insideWidth(owner, owner.getByTestId("club-start").getByRole("button", { name: "Be klubbens Eventor-administratör koppla" }), 390);
});
