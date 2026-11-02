import { expect, test, type Page } from "@playwright/test";
import { addCourseAndClass, addEntry, createRace, registerAccount, unique, warmRoute } from "./helpers";

/**
 * Översynen 2026-11-02: två löpare har sprungit med varandras brickor. Byt bricka säger vem som har brickan (inte
 * "har ändrats under tiden") och "Byt bricka med …" byter brickorna mellan dem i ett steg. Påhittade namn.
 */
async function openCard(owner: Page, name: string) {
  const card = owner.getByRole("region", { name: "Deltagarkort" });
  await expect(async () => {
    await owner.getByRole("row", { name: new RegExp(name) }).getByRole("cell").nth(1).click();
    await expect(card.getByRole("heading", { name })).toBeVisible({ timeout: 2_000 });
  }).toPass({ timeout: 30_000 });
  return card;
}

test("Byt bricka med …: två löpare som bytt brickor rättas i ett steg", async ({ browser }) => {
  test.setTimeout(240_000);
  const suffix = unique();
  const owner = await registerAccount(browser, `byte.${suffix}@exempel.se`, "Byte Bytesson");
  const raceId = await createRace(owner, `Brickbyte ${suffix}`);
  // Utvecklingsservern kompilerar brickbytets route vid första anropet (svaret, här 405, spelar ingen roll).
  await warmRoute(owner, `/api/admin/races/${raceId}/administrator/entries/${crypto.randomUUID()}/card`);
  for (const path of ["course-classes", "registration", "registration-candidates"]) {
    await warmRoute(owner, `/api/admin/races/${raceId}/administrator/${path}`, "POST");
  }
  await addCourseAndClass(owner, "Kort", "Öppen", "31 32");
  await addEntry(owner, { className: "Öppen", givenName: "Ada", familyName: "Ek", club: "OK Ek", card: "8401001" });
  await addEntry(owner, { className: "Öppen", givenName: "Bo", familyName: "Berg", club: "OK Ek", card: "8401002" });

  const ada = await openCard(owner, "Ada Ek");
  await ada.getByRole("button", { name: "Ändra bricka" }).click();
  const cardForm = owner.getByRole("region", { name: "Byt bricka" });
  await cardForm.getByLabel("Ny bricka").fill("8401002");
  await cardForm.getByRole("button", { name: "Spara bricka" }).click();
  const swap = owner.getByTestId("card-swap");
  await expect(swap).toContainText("Bricka 8401002 används av Bo Berg (Öppen).");
  await expect(swap).not.toContainText("har ändrats under tiden");
  await swap.getByRole("button", { name: "Byt bricka med Bo Berg" }).click();
  await expect(owner.getByText("Brickorna är bytta med Bo Berg.")).toBeVisible({ timeout: 30_000 });
  await expect(owner.getByRole("row", { name: /Ada Ek/ })).toContainText("8401002");
  await expect(owner.getByRole("row", { name: /Bo Berg/ })).toContainText("8401001");
});
