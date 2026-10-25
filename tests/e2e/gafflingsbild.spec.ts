import { expect, test, type Locator, type Page } from "@playwright/test";
import { addCourseAndClass, addEntry, createRace, openStep, publishRace, registerAccount, reviewScreenshots, sendReadout, today, unique,
  warmRoute } from "./helpers";

/**
 * Steg 49: en gafflad bana byggs i appen. Banan "Fjäril" (31 50 32 33) får en fjäril på 50 (slingorna 41 42 och 43) och
 * en enkel gaffling på 32–33 (61 eller 62). Bilden visas, ett alternativ ändras till 63, gafflingarna fördelas, två
 * löpare läses av och resultatlistan visar "Visa gafflingar" och sträcktidsanalysen per sträcka.
 */

// Stämplingar som passar alla fyra varianter (båda slingorna i båda ordningarna och båda alternativen).
const allVariants = [31, 50, 41, 42, 50, 43, 50, 41, 42, 50, 32, 61, 63, 33];

async function readOut(page: Page, raceId: string, cardNumber: string, minutes: number) {
  const start = Date.now() - 90 * 60_000;
  await sendReadout(page, raceId, { cardNumber, startPunchedAt: new Date(start).toISOString(),
    finishPunchedAt: new Date(start + (allVariants.length + 1) * minutes * 60_000).toISOString(),
    punches: allVariants.map((code, index) => ({ code, punchedAt: new Date(start + (index + 1) * minutes * 60_000).toISOString() })) });
}

/**
 * Mäter i webbläsaren att bildens etiketter (bokstäver, ordning, anmälda/avlästa) inte täcker varandra, kontroller eller
 * sträckor: rutorna jämförs parvis och punkter i varje etikett prövas mot sträckornas linjer.
 */
async function expectLabelsClear(diagram: Locator) {
  const problems = await diagram.evaluate(svg => {
    const found: string[] = [];
    type Box = { x: number; y: number; width: number; height: number };
    const hit = (a: Box, b: Box) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
    const labels = [...svg.querySelectorAll<SVGGElement>("[data-label]")].map(label => ({ text: label.textContent ?? "", box: label.getBBox() }));
    const nodes = [...svg.querySelectorAll<SVGGElement>("[data-node]")].map(node => ({ text: node.textContent ?? "", box: node.getBBox() }));
    const paths = [...svg.querySelectorAll<SVGPathElement>("path")];
    labels.forEach((label, index) => {
      for (const other of labels.slice(index + 1)) if (hit(label.box, other.box)) found.push(`${label.text} / ${other.text}`);
      for (const node of nodes) if (hit(label.box, node.box)) found.push(`${label.text} / kontroll ${node.text}`);
      const { x, y, width, height } = label.box;
      for (let i = 1; i < 6; i += 1) for (let j = 1; j < 4; j += 1) {
        const point = new DOMPoint(x + (width * i) / 6, y + (height * j) / 4);
        if (paths.some(path => path.isPointInStroke(point))) { found.push(`${label.text} / sträcka`); return; }
      }
    });
    return { found, count: labels.length };
  });
  expect(problems.count).toBeGreaterThan(0);
  expect(problems.found).toEqual([]);
}

/** Sidan rullar aldrig i sidled (bilden får rulla inom sin ruta). */
async function expectNoPageScroll(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
}

test("bygg en gafflad bana i bilden, fördela, läs av och se gafflingarna i resultatlistan", async ({ browser }) => {
  test.setTimeout(300_000);
  const suffix = unique();
  const owner = await registerAccount(browser, `bild.${suffix}@exempel.se`, "Bo Bild");
  const raceId = await createRace(owner, `Gafflingsbild ${suffix}`, today(), "Tävling med gafflade banor");
  await publishRace(owner);
  const admin = `/api/admin/races/${raceId}/administrator`;
  await warmRoute(owner, `${admin}/courses`);
  await owner.goto(`/admin/${raceId}/manage`);
  await addCourseAndClass(owner, "Fjäril", "D21", "31 50 32 33");
  await addEntry(owner, { className: "D21", givenName: "Ada", familyName: "Ek", club: "OK Skogen", card: "8201001" });
  await addEntry(owner, { className: "D21", givenName: "Ylva", familyName: "Ek", club: "OK Skogen", card: "8201002" });

  // Banor: gaffla banan i bilden. En fjäril på kontroll 50 och en enkel gaffling på sträckan 32–33.
  await warmRoute(owner, `${admin}/courses/00000000-0000-4000-8000-000000000000/edit-preview`, "POST");
  await warmRoute(owner, `${admin}/courses/00000000-0000-4000-8000-000000000000/edit`, "POST");
  await openStep(owner, "Banor");
  await owner.getByRole("button", { name: "Gaffla banan Fjäril" }).click();
  const editor = owner.getByRole("form", { name: "Gafflingar på Fjäril" });
  await expect(editor.getByRole("img", { name: /Banbild för Fjäril/ })).toBeVisible();
  await editor.getByRole("button", { name: "Kontroll 50", exact: true }).click();
  await editor.getByRole("button", { name: "Lägg till fjäril på 50" }).click();
  await editor.getByRole("textbox", { name: "Slinga A" }).fill("41 42");
  await editor.getByRole("textbox", { name: "Slinga B" }).fill("43");
  await editor.getByRole("button", { name: "Sträckan 32–33" }).click();
  await editor.getByRole("button", { name: "Lägg till gaffling på 32–33" }).click();
  await editor.getByRole("textbox", { name: "Alternativ C" }).fill("61");
  await editor.getByRole("textbox", { name: "Alternativ D" }).fill("62");
  const generated = editor.getByRole("region", { name: "Varianterna som banan ger" });
  await expect(generated).toContainText("4 varianter");
  await expect(generated).toContainText("AC 31 50 41 42 50 43 50 32 61 33");
  await expect(generated).toContainText("BD 31 50 43 50 41 42 50 32 62 33");
  await editor.getByRole("button", { name: "Spara ändringen" }).click();
  await expect(owner.getByText("Gafflingarna är sparade.")).toBeVisible();
  const course = owner.getByRole("row", { name: /^Fjäril .*Gafflad/ });
  await expect(course).toContainText("Gafflad (4 varianter)");
  await expect(course.getByRole("img", { name: /Banbild för Fjäril/ })).toBeVisible();
  // Utjämnad bana: den enkla gafflingen ger olika sträckor och en varning. Som fulgaffling är det bara en upplysning.
  await expect(course).toContainText("Varianterna har inte samma sträckor");
  await course.getByLabel("Gafflingssätt").selectOption("UNEQUAL");
  await expect(owner.getByText("Banan är en fulgaffling.")).toBeVisible();
  await expect(owner.getByRole("row", { name: /^Fjäril .*Gafflad/ })).toContainText("alternativen är inte utjämnade");

  // Ändra ett alternativ: D blir 63. Varianterna med 62 försvinner och de nya visas direkt.
  await owner.getByRole("button", { name: "Redigera gafflingar på Fjäril" }).click();
  await editor.getByRole("textbox", { name: "Alternativ D" }).fill("63");
  await expect(generated).toContainText("AD 31 50 41 42 50 43 50 32 63 33");
  await editor.getByRole("button", { name: "Spara ändringen" }).click();
  await expect(owner.getByText("Gafflingarna är sparade.")).toBeVisible();
  await expect(owner.getByRole("row", { name: /^Fjäril .*Gafflad/ }).getByRole("row", { name: /^AD 31 50 41 42 50 43 50 32 63 33/ })).toBeVisible();
  await expectLabelsClear(owner.getByRole("row", { name: /^Fjäril .*Gafflad/ }).getByRole("img", { name: /Banbild för Fjäril/ }));
  // Banraden ser ut som för en vanlig bana: rubriker och klassnamn bryts inte.
  // En text på en rad har en radruta (Range.getClientRects); en bruten text har flera.
  const lines = (locator: Locator) => locator.evaluate(element => { const range = document.createRange(); range.selectNodeContents(element);
    return new Set([...range.getClientRects()].map(rect => Math.round(rect.top))).size; });
  for (const header of ["Bana", "Längd", "Klasser", "Anmälda", "Avlästa"]) {
    expect(await lines(owner.getByRole("columnheader", { name: header, exact: true }).first()), header).toBe(1);
  }
  expect(await lines(owner.getByRole("row", { name: /^Fjäril .*se nedan/ }).getByRole("button", { name: "D21" }))).toBe(1);
  await owner.setViewportSize({ width: 390, height: 900 });
  await expectNoPageScroll(owner);
  await expectLabelsClear(owner.getByRole("row", { name: /^Fjäril .*Gafflad/ }).getByRole("img", { name: /Banbild för Fjäril/ }));
  await owner.setViewportSize({ width: 1280, height: 720 });
  await reviewScreenshots(owner, "gafflingar-banor");

  // Klasser: fördela gafflingarna.
  await warmRoute(owner, `${admin}/classes/00000000-0000-4000-8000-000000000000/variant-distribution`, "POST");
  await openStep(owner, "Klasser");
  const d21 = owner.getByRole("row", { name: /^D21/ });
  await expect(d21).toContainText("2 saknar variant");
  await d21.getByRole("button", { name: "Fördela gafflingar i D21" }).click();
  await expect(owner.getByText("2 löpare fick en variant.")).toBeVisible();

  // Avläsning: båda godkända på sina varianter.
  await readOut(owner, raceId, "8201001", 2);
  await readOut(owner, raceId, "8201002", 3);

  // Publik resultatlista: varianten under namnet och "Visa gafflingar" med löparens väg i bilden.
  const visitor = await (await browser.newContext()).newPage();
  await expect(async () => {
    await visitor.goto(`/results/${raceId}`);
    await expect(visitor.getByRole("row", { name: /Ylva Ek/ })).toContainText("Godkänd", { timeout: 2_000 });
  }).toPass({ timeout: 60_000 });
  const ada = visitor.getByRole("row", { name: /Ada Ek/ });
  await expect(ada).toContainText(/Variant (AC|AD|BC|BD)/);
  const variant = /Variant (AC|AD|BC|BD)/.exec(await ada.innerText())![1]!;
  await expect(visitor.getByRole("img", { name: /Banbild: Ada Ek/ })).toHaveCount(0);
  await visitor.getByRole("button", { name: "Visa gafflingar: D21" }).click();
  await expect(ada.getByRole("img", { name: `Banbild: Ada Ek sprang variant ${variant}` })).toBeVisible();
  await visitor.setViewportSize({ width: 390, height: 900 });
  await expectNoPageScroll(visitor);
  await visitor.setViewportSize({ width: 1280, height: 720 });
  await reviewScreenshots(visitor, "gafflingar-resultat");

  // Deltagarsidan: samma bild, större, med variantens text.
  await ada.getByRole("link", { name: "Ada Ek" }).click();
  await visitor.waitForURL(/\/participants\//);
  await visitor.getByRole("button", { name: "Visa gafflingar", exact: true }).click();
  await expect(visitor.getByRole("img", { name: `Banbild: Ada Ek sprang variant ${variant}` })).toBeVisible();
  await expect(visitor.getByText(`Variant ${variant}`).first()).toBeVisible();

  // Sträcktidsanalysen: per sträcka (kontrollpar) för alla, oavsett variant; per variant som val.
  await visitor.goto(`/results/${raceId}/splits?class=D21`);
  await expect(visitor.getByRole("button", { name: "Per sträcka" })).toHaveAttribute("aria-pressed", "true");
  await expect(visitor.getByRole("columnheader", { name: /50–41/ })).toBeVisible();
  // Fördelningen avgör om löparna fick 61 eller 63; sträckan efter 32 finns i alla fall.
  await expect(visitor.getByRole("columnheader", { name: /32–6[13]/ }).first()).toBeVisible();
  await expect(visitor.getByRole("heading", { name: "D21", exact: true })).toBeVisible();
  await visitor.getByRole("button", { name: "Per variant" }).click();
  await expect(visitor.getByRole("heading", { name: new RegExp(`D21.*${variant}`) })).toBeVisible();
});

test("två fjärilar i följd och en gaffling med fyra alternativ: etiketterna täcker inget, även på 390 px", async ({ browser }) => {
  test.setTimeout(240_000);
  const suffix = unique();
  const owner = await registerAccount(browser, `bon.${suffix}@exempel.se`, "Bo Bon");
  const raceId = await createRace(owner, `Bon ${suffix}`, today(), "Tävling med gafflade banor");
  const admin = `/api/admin/races/${raceId}/administrator`;
  await warmRoute(owner, `${admin}/courses`);
  await owner.goto(`/admin/${raceId}/manage`);
  await addCourseAndClass(owner, "Bon", "H35", "31 50 60 33");
  await warmRoute(owner, `${admin}/courses/00000000-0000-4000-8000-000000000000/edit-preview`, "POST");
  await warmRoute(owner, `${admin}/courses/00000000-0000-4000-8000-000000000000/edit`, "POST");
  await openStep(owner, "Banor");
  await owner.getByRole("button", { name: "Gaffla banan Bon" }).click();
  const editor = owner.getByRole("form", { name: "Gafflingar på Bon" });
  await editor.getByRole("button", { name: "Kontroll 50", exact: true }).click();
  await editor.getByRole("button", { name: "Lägg till fjäril på 50" }).click();
  await editor.getByRole("textbox", { name: "Slinga A" }).fill("41 42");
  await editor.getByRole("textbox", { name: "Slinga B" }).fill("43");
  await editor.getByRole("button", { name: "Kontroll 60", exact: true }).click();
  await editor.getByRole("button", { name: "Lägg till fjäril på 60" }).click();
  await editor.getByRole("textbox", { name: "Slinga C" }).fill("61");
  await editor.getByRole("textbox", { name: "Slinga D" }).fill("62 63");
  await editor.getByRole("button", { name: "Sträckan 60–33" }).click();
  await editor.getByRole("button", { name: "Lägg till gaffling på 60–33" }).click();
  const fork = editor.getByRole("group", { name: /Gaffling 3/ });
  await fork.getByRole("button", { name: "Lägg till alternativ" }).click();
  await fork.getByRole("button", { name: "Lägg till alternativ" }).click();
  for (const [letter, codes] of [["E", "71"], ["F", "72"], ["G", "73 74"], ["H", "75"]] as const) {
    await editor.getByRole("textbox", { name: `Alternativ ${letter}` }).fill(codes);
  }
  await expect(editor.getByRole("region", { name: "Varianterna som banan ger" })).toContainText("16 varianter");
  await expectLabelsClear(editor.getByRole("img", { name: /Banbild för Bon/ }));
  await editor.getByRole("button", { name: "Spara ändringen" }).click();
  await expect(owner.getByText("Gafflingarna är sparade.")).toBeVisible();
  const diagram = owner.getByRole("row", { name: /^Bon .*Gafflad/ }).getByRole("img", { name: /Banbild för Bon/ });
  await expectLabelsClear(diagram);
  await owner.setViewportSize({ width: 390, height: 900 });
  await expectNoPageScroll(owner);
  await expectLabelsClear(diagram);
  await reviewScreenshots(owner, "gafflingar-bon");
});

