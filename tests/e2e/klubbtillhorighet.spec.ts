import { fileURLToPath } from "node:url";
import { expect, test, type Page } from "@playwright/test";
import { FAKE_EVENTOR_OKAO_KEY } from "./fake-eventor";
import { createRace, daysFromToday, importClubDirectory, openStep, registerAccount, reviewScreenshots, unique, unlinkClub, warmRoute } from "./helpers";

/**
 * ADR-0209: klubbtillhörighet som användarflöde. Den som registrerar sig väljer OK Älvsjö-Örby; ingen har startat klubbytan, så
 * hen startar den och kopplar den till Eventor med klubbens nyckel (den falska Eventor). En medlem registrerar sig och väljer
 * klubben (adressen finns inte i Eventors lista), administratören bekräftar, medlemmen ser klubbarkivet, administratören bjuder
 * in medlemmen till en tävling "Från klubben", och efter tävlingsdagen läggs tävlingen i klubbarkivet där medlemmen ser den.
 */
const fixture = (name: string) => fileURLToPath(new URL(`../../fixtures/iof/${name}`, import.meta.url));

async function pickClub(page: Page, query: string, name: string) {
  const step = page.getByTestId("club-step");
  await step.getByRole("combobox", { name: "Sök klubb" }).fill(query);
  await step.getByRole("option", { name: new RegExp(`^${name}`) }).click();
  await expect(step.getByRole("list", { name: "Mina klubbar" })).toContainText(name);
}

/** Ingen sida får rulla i sidled på 390 px. */
async function fitsPhone(page: Page) {
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await page.setViewportSize({ width: 1280, height: 720 });
}

const none = "00000000-0000-4000-8000-000000000000";

test("klubbtillhörighet: välj klubb, koppla till Eventor, bekräfta, bjud in från klubben och lägg tävlingen i klubbarkivet", async ({ browser }) => {
  test.setTimeout(240_000);
  importClubDirectory("organisations-directory.xml");
  unlinkClub("9901");
  const suffix = unique();

  // Utvecklingsservern kompilerar routerna vid första anropet; ett avbrutet första anrop ger annars ett fel i testet.
  const warm = await (await browser.newContext()).newPage();
  for (const [path, method] of [[`/api/organizer/organisations?q=ok`, "GET"], ["/api/account/clubs", "GET"], ["/api/account/clubs/step", "POST"],
    [`/api/organizer/clubs/${none}/affiliation`, "GET"], [`/api/organizer/clubs/${none}/affiliation/decisions`, "POST"],
    [`/api/organizer/clubs/${none}/eventor`, "PUT"], [`/api/organizer/races/${none}/club-archive`, "GET"],
    [`/api/organizer/club-picker?kind=RACE&id=${none}`, "GET"], ["/api/organizer/club-picker", "POST"]] as const) await warmRoute(warm, path, method);
  await warm.context().close();

  // 1. Administratören registrerar sig och väljer OK Älvsjö-Örby (sökt med förkortningen). Ingen klubbyta finns än.
  const admin = await registerAccount(browser, `klubbadmin.${suffix}@exempel.se`, `Klubbadmin ${suffix}`);
  await expect(admin.getByRole("heading", { name: "Vilken klubb tillhör du?" })).toBeVisible();
  await pickClub(admin, "okäö", "OK Älvsjö-Örby");
  await reviewScreenshots(admin, "klubb-steget");
  await fitsPhone(admin);
  await admin.getByRole("button", { name: "Spara klubbarna" }).click();
  await expect(admin.getByTestId("club-no-space")).toContainText("Ingen från klubben har startat klubbytan än");
  await admin.getByRole("button", { name: "Starta klubbytan" }).click();
  await admin.waitForURL(/\/organizer\/clubs\/[0-9a-f-]+#club$/);
  const clubId = /clubs\/([0-9a-f-]+)/.exec(admin.url())![1]!;
  await expect(admin.getByTestId("club-eventor-badge")).toHaveText("Inte kopplad till Eventor");

  // 2. Koppla till Eventor med klubbens nyckel; nyckeln visas aldrig igen.
  const eventor = admin.getByTestId("club-eventor");
  await eventor.getByLabel("Klubbens API-nyckel").fill(FAKE_EVENTOR_OKAO_KEY);
  await eventor.getByRole("button", { name: "Koppla till Eventor" }).click();
  await expect(admin.getByTestId("club-eventor-linked")).toHaveText(`Kopplad till Eventor · OK Älvsjö-Örby · nyckel …${FAKE_EVENTOR_OKAO_KEY.slice(-4)}`);
  await expect(admin.getByTestId("club-eventor-counts")).toHaveText("2 medlemmar i Eventor, 0 har O-Tid och är bekräftade");
  expect(await admin.content()).not.toContain(FAKE_EVENTOR_OKAO_KEY);

  // Medlemmen registrerar sig och väljer klubben (adressen finns inte i Eventors lista: väntar).
  const member = await registerAccount(browser, `medlem.${suffix}@exempel.se`, `Maja Medlem ${suffix}`);
  await pickClub(member, "älvsjö", "OK Älvsjö-Örby");
  await member.getByRole("button", { name: "Spara klubbarna" }).click();
  await expect(member.getByTestId("account-clubs")).toContainText("Väntar på bekräftelse");

  // Administratören bekräftar sig själv och medlemmen.
  await admin.reload();
  const pending = admin.getByTestId("club-pending");
  await expect(pending).toContainText(`Maja Medlem ${suffix}`);
  await expect(pending).not.toContainText("@");
  await reviewScreenshots(admin, "klubb-klubben");
  await fitsPhone(admin);
  await pending.getByRole("button", { name: `Bekräfta: Maja Medlem ${suffix}` }).click();
  await expect(admin.getByTestId("club-confirmed")).toContainText(`Maja Medlem ${suffix}`, { timeout: 60_000 });
  await admin.getByTestId("club-pending").getByRole("button", { name: `Bekräfta: Klubbadmin ${suffix}` }).click();
  await expect(admin.getByTestId("club-confirmed")).toContainText(`Maja Medlem ${suffix}`);

  // 3. Medlemmen ser klubbytan och träningsarkivet under Mina klubbar.
  await member.goto("/organizer");
  const clubs = member.getByRole("region", { name: "Mina klubbar" });
  await expect(clubs).toContainText("OK Älvsjö-Örby");
  await expect(clubs).toContainText("Medlem");
  await clubs.getByRole("link", { name: "Öppna arkivet" }).click();
  await member.waitForURL(/\/organizer\/clubs\/[0-9a-f-]+$/);
  await expect(member.getByTestId("club-eventor-badge")).toHaveText("Kopplad till Eventor · OK Älvsjö-Örby");
  await expect(member.getByText("Arkivet är tomt")).toBeVisible();
  await expect(member.getByRole("tab", { name: "Klubben" })).toHaveCount(0);

  // 4. Administratören skapar en tävling i går (arrangörsklubben är förvald) och bjuder in medlemmen "Från klubben".
  await admin.goto("/organizer");
  await warmRoute(admin, `/api/admin/races/${none}/administrator/session`);
  const raceId = await createRace(admin, `Klubbkvällen ${suffix}`, daysFromToday(-1), "Tävling");
  // Banorna ur en banfil (Banor → Läs in banfil).
  const files = admin.getByRole("region", { name: "Banfil" });
  await files.getByLabel("Banfil (IOF XML)").setInputFiles(fixture("course-file-1.xml"));
  await files.getByRole("button", { name: "Läs in banfil" }).click();
  await files.getByRole("region", { name: "Skillnader mot course-file-1.xml" }).getByRole("button", { name: /^Godkänn \d+ ändringar$/ }).click();
  await expect(files.getByText(/ändringar har sparats/)).toBeVisible();
  await openStep(admin, "Inställningar");
  const fromClub = admin.getByTestId("from-club");
  await fromClub.locator("summary").click();
  await fromClub.getByRole("checkbox", { name: new RegExp(`Maja Medlem ${suffix}`) }).check();
  await fromClub.getByRole("button", { name: "Bjud in 1 person · Funktionär" }).click();
  await expect(fromClub.getByRole("status")).toContainText("1 inbjudan sparade.");
  const people = admin.getByRole("list", { name: "Personer med behörighet" });
  await expect(people).toContainText(`Maja Medlem ${suffix}`);
  await expect(people).not.toContainText(`medlem.${suffix}@exempel.se`);
  await reviewScreenshots(admin, "klubb-fran-klubben");

  // 5. Efter tävlingsdagen: påminnelsen och "Lägg i klubbarkivet".
  await openStep(admin, "Resultat");
  await expect(admin.getByTestId("club-archive-reminder")).toContainText("Tävlingen är klar – lägga banorna i klubbarkivet?");
  await admin.getByRole("button", { name: "Till Klubben och klubbarkivet" }).click();
  const section = admin.getByTestId("race-club-archive");
  await expect(section.getByTestId("race-organiser")).toHaveText("OK Älvsjö-Örby");
  await section.getByRole("button", { name: "Lägg i klubbarkivet" }).click();
  await expect(section.getByRole("status")).toContainText("Tävlingen ligger i klubbarkivet.", { timeout: 60_000 });
  await reviewScreenshots(admin, "klubb-tavling-i-arkivet");
  await fitsPhone(admin);

  // Träningen syns i klubbarkivet för medlemmen, med länken till tävlingen och utan deltagare.
  await member.goto(`/organizer/clubs/${clubId}`);
  const entries = member.getByTestId("archive-entries");
  await expect(entries).toContainText(`Klubbkvällen ${suffix}`);
  await entries.getByRole("link").filter({ hasText: `Klubbkvällen ${suffix}` }).click();
  await expect(member.getByTestId("entry-source-race")).toContainText(`Klubbkvällen ${suffix}`);
  await expect(member.getByTestId("course-file").first()).toBeVisible();
  await expect(member.getByTestId("map-bank-closed")).toBeVisible();
  await reviewScreenshots(member, "klubb-arkivets-traning");
  await fitsPhone(member);
  expect(raceId).toMatch(/^[0-9a-f-]{36}$/);
});
