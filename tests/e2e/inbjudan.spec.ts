import { expect, test, type Page } from "@playwright/test";
import { latestMailTo } from "./fake-smtp";
import { addPerson, createRace, fillNewPassword, newContext, password, registerAccount, reviewScreenshots, unique, verificationLink, warmRoute }
  from "./helpers";

/**
 * ADR-0206: inbjudningar med e-post. Ägaren bjuder in en ny adress till klubbarkivet (flera adresser på en gång) och till en
 * tävling; mejlen kommer till den falska SMTP-servern. Den inbjudna öppnar länken, skapar ett konto med den låsta adressen,
 * bekräftar den och hamnar i klubben som administratör; tävlingens länk leder sedan till arbetsytan som funktionär. Utan e-post
 * på servern (klubbens svar ändrat i webbläsaren) står "Kopiera länken", och en borttagen inbjudan gäller inte längre.
 */
const LINK = /https?:\/\/\S+\/inbjudan#token=[A-Za-z0-9_-]{43}/;

async function invitationLink(email: string, about: string): Promise<string> {
  let link: string | undefined;
  await expect.poll(() => {
    const mail = latestMailTo(email, new RegExp(about));
    link = mail && LINK.exec(mail.text)?.[0];
    return link;
  }, { timeout: 20_000 }).toBeTruthy();
  return link!;
}

async function openMembers(page: Page, clubId: string): Promise<void> {
  await page.goto(`/organizer/clubs/${clubId}`);
  await page.getByRole("tab", { name: "Medlemmar" }).click();
}

async function createClub(owner: Page, name: string): Promise<string> {
  // registerAccount landar redan i Mina tävlingar.
  if (!owner.url().endsWith("/organizer")) await owner.goto("/organizer");
  const clubs = owner.getByRole("region", { name: "Mina klubbar" });
  await clubs.getByRole("button", { name: "Ny klubbyta" }).click();
  await clubs.getByLabel("Klubbens namn").fill(name);
  await clubs.getByRole("button", { name: "Skapa klubben" }).click();
  await owner.waitForURL(/\/organizer\/clubs\/[0-9a-f-]+$/);
  return /clubs\/([0-9a-f-]+)$/.exec(owner.url())![1]!;
}

test("inbjudan med e-post: klubbarkivet och tävlingen, länken, nytt konto och rätt roll", async ({ browser }) => {
  test.setTimeout(300_000);
  const suffix = unique();
  const owner = await registerAccount(browser, `agare.${suffix}@exempel.se`, "Joel Ägare");
  const none = "00000000-0000-4000-8000-000000000000";
  for (const path of ["/api/organizer/clubs", "/inbjudan", `/organizer/clubs/${none}`, `/admin/${none}/manage`]) await warmRoute(owner, path);
  for (const path of [`/api/organizer/clubs/${none}/members`, `/api/organizer/clubs/${none}/invitations/${none}`, "/api/invitation"]) {
    await warmRoute(owner, path, "POST");
  }
  const clubName = `OK Inbjudan ${suffix}`;
  const clubId = await createClub(owner, clubName);
  const invited = `ny.${suffix}@exempel.se`;
  const other = `annan.${suffix}@exempel.se`;

  // Flera adresser på en gång, en av dem ogiltig.
  await openMembers(owner, clubId);
  const form = owner.getByRole("form", { name: "Bjud in" });
  await form.getByLabel("E-postadress").fill(`${invited}, inte-en-adress\n${other}`);
  await form.getByLabel("Roll").selectOption({ label: "Administratör" });
  await form.getByRole("button", { name: "Bjud in" }).click();
  await expect(owner.getByRole("alert").filter({ hasText: "2 inbjudningar skickade, 1 adress var ogiltig." }))
    .toBeVisible({ timeout: 60_000 });
  const row = owner.getByTestId("club-invitation").filter({ hasText: invited });
  await expect(row).toContainText(/Administratör · väntar på inloggning · skickad \d/);
  await expect(row.getByRole("button", { name: `Skicka inbjudan igen till ${invited}` })).toBeVisible();
  await reviewScreenshots(owner, "inbjudan-klubbens-lista");

  // Mejlet: vem, till vad och som vad, och en enda länk.
  const clubLink = await invitationLink(invited, "klubben");
  const clubMail = latestMailTo(invited, /klubben/)!.text;
  expect(clubMail).toContain(`Joel Ägare har bjudit in dig till klubben ${clubName} i O-Tid som administratör.`);
  expect(clubMail.match(/https?:\/\/\S+/g)).toHaveLength(1);
  expect(latestMailTo(other, /klubben/)).toBeTruthy();

  // Samma adress till en tävling som funktionär.
  await owner.goto("/organizer");
  const raceId = await createRace(owner, `Klubbkväll ${suffix}`);
  await addPerson(owner, invited, "Funktionär");
  await expect(owner.getByTestId("person-invitation").filter({ hasText: invited })).toContainText("skickad");
  const raceLink = await invitationLink(invited, "tävlingen");

  // Den inbjudna: länken, Skapa konto med adressen låst, bekräftelsen och klubben.
  const guest = await (await newContext(browser)).newPage();
  await guest.goto(clubLink);
  const card = guest.getByTestId("invitation");
  await expect(card).toContainText(`Joel Ägare har bjudit in dig till klubben ${clubName} som administratör.`);
  await expect(guest).toHaveURL(/\/inbjudan$/);
  await reviewScreenshots(guest, "inbjudan-lanksidan");
  await card.getByRole("button", { name: "Skapa konto" }).click();
  await guest.waitForURL(/\/organizer$/);
  const email = guest.getByLabel("E-postadress");
  await expect(email).toHaveValue(invited);
  await expect(email).not.toBeEditable();
  await guest.getByLabel("Ditt namn").fill("Nora Ny");
  // ADR-0205: lösenordet två gånger.
  await fillNewPassword(guest, password);
  await guest.getByRole("button", { name: "Skapa konto" }).click();
  await expect(guest.getByText("Vi har skickat ett mejl till")).toBeVisible();
  // ADR-0205 tillägg 2026-11-12: länken i samma webbläsare som registreringen; lösenordet skrivs inte en tredje gång.
  await guest.goto(await verificationLink(invited));
  await expect(guest.getByLabel("Upprepa lösenordet", { exact: true })).toHaveCount(0);
  await guest.getByRole("button", { name: "Bekräfta och logga in" }).click();
  await guest.waitForURL(`**/organizer/clubs/${clubId}`);
  await expect(guest.getByRole("heading", { name: clubName, level: 1 })).toBeVisible();
  // Administratör: får bjuda in.
  await openMembers(guest, clubId);
  await expect(guest.getByRole("form", { name: "Bjud in" })).toBeVisible();

  // Tävlingens länk, nu inloggad med adressen: direkt till arbetsytan som funktionär.
  await guest.goto(raceLink);
  await expect(guest.getByTestId("invitation")).toContainText("som funktionär");
  await guest.getByTestId("invitation").getByRole("button", { name: "Öppna" }).click();
  await guest.waitForURL(`**/admin/${raceId}/manage`);
  await expect(guest.locator("header").getByText("Funktionär", { exact: true })).toBeVisible();

  // Ägarens listor: inbjudningarna är tagna.
  await openMembers(owner, clubId);
  await expect(owner.getByTestId("club-invitation").filter({ hasText: invited })).toHaveCount(0);
  await expect(owner.getByTestId("club-invitation").filter({ hasText: other })).toHaveCount(1);
});

test("inbjudan utan e-post på servern: Kopiera länken, och en borttagen inbjudan gäller inte längre", async ({ browser }) => {
  test.setTimeout(180_000);
  const suffix = unique();
  const owner = await registerAccount(browser, `agare.${suffix}@exempel.se`, "Joel Ägare");
  const clubId = await createClub(owner, `OK Utan e-post ${suffix}`);
  const invited = `kopia.${suffix}@exempel.se`;
  // Klubbens svar som på en server utan e-post (OTID_SMTP_URL saknas): listan visar "Kopiera länken".
  await owner.route(`**/api/organizer/clubs/${clubId}`, async route => {
    const response = await route.fetch();
    await route.fulfill({ response, json: { ...(await response.json() as object), mailEnabled: false } });
  });
  await openMembers(owner, clubId);
  const form = owner.getByRole("form", { name: "Bjud in" });
  await form.getByLabel("E-postadress").fill(invited);
  await form.getByRole("button", { name: "Bjud in" }).click();
  await expect(owner.getByRole("status").filter({ hasText: "Inbjudan är sparad." })).toBeVisible({ timeout: 60_000 });
  const row = owner.getByTestId("club-invitation").filter({ hasText: invited });
  await expect(row.getByRole("button", { name: /Skicka inbjudan igen/ })).toHaveCount(0);
  await expect(row).not.toContainText("skickad");
  await row.getByRole("button", { name: "Kopiera länken" }).click();
  const field = row.getByLabel("Länk till inbjudan");
  await expect(field).toHaveValue(LINK);
  const copied = await field.inputValue();
  await reviewScreenshots(owner, "inbjudan-kopiera-lanken");

  const guest = await (await newContext(browser)).newPage();
  await guest.goto(copied);
  await expect(guest.getByTestId("invitation")).toContainText("som medlem");

  // Ta bort inbjudan: länken gäller inte längre.
  owner.once("dialog", dialog => void dialog.accept());
  await row.getByRole("button", { name: "Ta bort" }).click();
  await expect(owner.getByTestId("club-invitation").filter({ hasText: invited })).toHaveCount(0);
  await guest.goto("/organizer");
  await guest.goto(copied);
  await expect(guest.getByRole("heading", { name: "Inbjudan gäller inte längre" })).toBeVisible();
});
