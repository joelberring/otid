import { expect, test } from "@playwright/test";
import { addCourseAndClass, addEntry, createRace, openStep, publishRace, registerAccount, reviewScreenshots, unique, warmRoute } from "./helpers";

/**
 * Steg 33: Inställningar → kort info om tävlingen, första start (bara information) och "Visa bricknummer i den publika
 * startlistan". Infon syns överst på tävlingssidan för alla och i Start-steget för inloggade; bricknumret syns i den
 * publicerade startlistan när inställningen är på och döljs direkt när den stängs av. Påhittade namn och brickor.
 */
test("tävlingsinfo på tävlingssidan och i arbetsytan, bricka i den publika startlistan", async ({ browser }) => {
  test.setTimeout(240_000);
  const suffix = unique();
  const owner = await registerAccount(browser, `info.${suffix}@exempel.se`, "Ingrid Info");
  for (const path of ["/t/aaaaaa", "/starts/00000000-0000-4000-8000-000000000000"]) await warmRoute(owner, path);
  const raceId = await createRace(owner, `Klubbkväll ${suffix}`, undefined, "Liten tävling");
  await warmRoute(owner, `/api/admin/races/${raceId}/administrator/settings`, "POST");
  await addCourseAndClass(owner, "Mellan", "Öppen", "31 32 33");
  await addEntry(owner, { className: "Öppen", givenName: "Testa", familyName: "Påhittad", club: "OK Exempel", card: "8123456" });

  // Inställningar: info med radbrytningar (och tecken som bara är text), första start skrivet som 18.30.
  await openStep(owner, "Inställningar");
  const settings = owner.getByRole("region", { name: "Inställningar" });
  await settings.getByLabel("Första start").fill("25:99");
  await settings.getByRole("button", { name: "Spara inställningar" }).click();
  await expect(settings.getByText("Skriv klockslaget som TT:MM")).toBeVisible();
  await settings.getByLabel("Kort info om tävlingen").fill("Samling vid klubbstugan.\nParkering vid skolan.\n<b>Ta med pannlampa</b>");
  await settings.getByLabel("Första start").fill("18.30");
  await expect(settings.getByLabel("Visa bricknummer i den publika startlistan")).toBeChecked();
  await settings.getByRole("button", { name: "Spara inställningar" }).click();
  await expect(settings.getByText("Inställningarna är sparade.")).toBeVisible();
  await expect(settings.getByLabel("Första start")).toHaveValue("18:30");

  // Start-steget för inloggade.
  await openStep(owner, "Start");
  const ownInfo = owner.getByRole("region", { name: "Om tävlingen" });
  await expect(ownInfo).toContainText("Första start 18:30");
  await expect(ownInfo).toContainText("Samling vid klubbstugan.");
  await owner.getByRole("button", { name: "Publicera startlistan" }).click();
  await expect(owner.getByText("Startlistan är publicerad.")).toBeVisible();
  await openStep(owner, "Publicera");
  const hubPath = await owner.getByRole("link", { name: "Förhandsvisa tävlingssidan" }).getAttribute("href");
  await publishRace(owner);

  // Besökaren: infon överst på tävlingssidan, som text med radbrytningar.
  const visitor = await (await browser.newContext({ viewport: { width: 1280, height: 844 } })).newPage();
  await visitor.goto(hubPath!);
  const info = visitor.getByRole("region", { name: "Om tävlingen" });
  await expect(info).toContainText("Första start 18:30");
  expect(await info.locator("p").last().innerText()).toBe("Samling vid klubbstugan.\nParkering vid skolan.\n<b>Ta med pannlampa</b>");
  await expect(info.locator("b")).toHaveCount(0);
  expect(await visitor.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
  await reviewScreenshots(visitor, "steg33-tavlingssidan");

  // Den publicerade startlistan visar bricka.
  await visitor.goto(`/starts/${raceId}`);
  const row = visitor.getByRole("row", { name: /Testa Påhittad/ }).first();
  await expect(row).toContainText("8123456");
  await expect(visitor.getByRole("columnheader", { name: "Bricka" }).first()).toBeVisible();
  await reviewScreenshots(visitor, "steg33-startlista");

  // Avstängd: bricknumret försvinner direkt ur den redan publicerade listan; Live visar aldrig bricka.
  await openStep(owner, "Inställningar");
  await settings.getByLabel("Visa bricknummer i den publika startlistan").uncheck();
  await settings.getByRole("button", { name: "Spara inställningar" }).click();
  await expect(settings.getByText("Inställningarna är sparade.")).toBeVisible();
  await visitor.reload();
  await expect(visitor.getByRole("row", { name: /Testa Påhittad/ }).first()).toBeVisible();
  await expect(visitor.getByText("8123456")).toHaveCount(0);
  await expect(visitor.getByRole("columnheader", { name: "Bricka" })).toHaveCount(0);
  await visitor.goto(`${hubPath!}/live`);
  await expect(visitor.getByText("8123456")).toHaveCount(0);
});
