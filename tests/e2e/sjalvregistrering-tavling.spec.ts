import { expect, test } from "@playwright/test";
import { addCourseAndClass, addEntry, createRace, openStep, publishRaceViaApi, registerAccount, unique, warmRoute } from "./helpers";

/**
 * Steg 46: självregistrering i en tävling. En påhittad besökare registrerar sig själv (det publika API:et, som formuläret
 * använder); den publika startlistan märker raden "självreg.", och arrangören stryker alla självregistrerade som inte
 * läst ut under Anmälda efter en förhandsvisning.
 */
test("självregistrerad i tävling märks publikt och kan strykas under Anmälda", async ({ browser }) => {
  test.setTimeout(240_000);
  const suffix = unique();
  const owner = await registerAccount(browser, `sjalv.${suffix}@exempel.se`, "Selma Själv");
  const raceId = await createRace(owner, `Självtävling ${suffix}`);
  for (const path of [`/api/public/races/${raceId}/self-registration`, `/starts/${raceId}`,
    `/api/admin/races/${raceId}/administrator/self-registrations`]) await warmRoute(owner, path);
  await addCourseAndClass(owner, "Bana 1", "Öppen", "31 32");
  await addEntry(owner, { className: "Öppen", givenName: "Anna", familyName: "Anmäld", club: "Påhittade OK", card: "8301001" });

  await openStep(owner, "Inställningar");
  await owner.getByLabel("Tillåt självregistrering på tävlingsdagen").click();
  await expect(owner.getByText("Självregistreringen är på.")).toBeVisible();
  await publishRaceViaApi(owner, raceId);

  const visitor = await (await browser.newContext()).newPage();
  await visitor.goto("/om");
  const info = await (await visitor.request.get(`/api/public/races/${raceId}/self-registration`)).json() as { classes: { id: string }[] };
  const origin = new URL(visitor.url()).origin;
  const registered = await visitor.request.post(`/api/public/races/${raceId}/self-registration`, { headers: { origin },
    data: { formatVersion: 1, cardNumber: "8301999", givenName: "Sigge", familyName: "Spamsson", club: null, classId: info.classes[0]!.id } });
  expect(registered.status()).toBe(201);

  // Startlistan uppdateras löpande; den publika listan märker den självregistrerade, inte den anmälda.
  await openStep(owner, "Start");
  await owner.getByLabel("Uppdatera startlistan löpande").click();
  await expect(owner.getByText("Startlistan uppdateras löpande.")).toBeVisible();
  await visitor.goto(`/starts/${raceId}`);
  await expect(visitor.getByRole("row", { name: /Sigge Spamsson/ })).toContainText("självreg.", { timeout: 15_000 });
  await expect(visitor.getByRole("row", { name: /Anna Anmäld/ })).not.toContainText("självreg.");

  // Anmälda: förhandsvisning och bekräftelse (arbetsytan läses in igen så att den självregistrerade syns).
  await owner.getByRole("button", { name: "Uppdatera" }).click();
  await openStep(owner, "Anmälda");
  await expect(owner.getByRole("button", { name: "Öppna Sigge Spamsson" }).or(owner.getByText("Sigge Spamsson")).first()).toBeVisible();
  const cleanup = owner.getByTestId("self-registration-cleanup");
  await cleanup.getByRole("button", { name: "Stryk alla självregistrerade som inte läst ut" }).click();
  const review = cleanup.getByRole("region", { name: "Självregistrerade som inte läst ut" });
  await expect(review).toContainText("1 självregistrerad som inte läst ut");
  await expect(review).toContainText("Sigge Spamsson");
  await expect(review).not.toContainText("Anna Anmäld");
  await review.getByRole("button", { name: "Stryk 1 självregistrerad" }).click();
  await expect(cleanup.getByRole("status")).toContainText("1 självregistrerad är struken.");
  await visitor.reload();
  await expect(visitor.getByRole("row", { name: /Sigge Spamsson/ })).toHaveCount(0, { timeout: 15_000 });
});
