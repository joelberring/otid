import { randomUUID } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import { latestMailTo } from "./fake-smtp";
import { grantSuperadmin, logIn, password, publishRaceViaApi, registerAccount, unique, warmRoute } from "./helpers";

/**
 * Steg 17 (ADR-0172 beslut 1–2): konton med e-post, glömt lösenord med länk via e-post (fångad av en falsk
 * SMTP-server) och superadmin som döljer och tar bort en skräptävling och spärrar kontot bakom den.
 */
async function screenshots(page: Page, name: string) {
  const directory = process.env.E2E_SCREENSHOT_DIR;
  if (!directory) return;
  for (const width of [1280, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await page.screenshot({ path: `${directory}/step17-${name}-${width}.png`, fullPage: true });
  }
  await page.setViewportSize({ width: 1280, height: 720 });
}

/**
 * Skräptävlingen skapas med samma anrop som "Skapa tävling" på /organizer, utan att öppna arbetsytan
 * (den täcks av andra flöden och gör utvecklingsservern tung).
 */
async function createRaceViaApi(page: Page, eventName: string): Promise<string> {
  const csrf = (await page.context().cookies()).find(cookie => /otid[-_]organizer[-_]csrf$/.test(cookie.name))?.value;
  const response = await page.request.post("/api/organizer/events", {
    headers: { origin: new URL(page.url()).origin, "x-otid-csrf": csrf ?? "", "idempotency-key": `organizer-event-create:${randomUUID()}` },
    data: { formatVersion: 1, eventName, raceName: "Torsdag", raceDate: "2026-10-08", timeZone: "Europe/Stockholm", raceType: "TRAINING" }
  });
  expect(response.status()).toBe(201);
  return (await response.json() as { raceId: string }).raceId;
}

async function resetLink(email: string): Promise<string> {
  let link: string | undefined;
  await expect.poll(() => {
    link = /https?:\/\/\S+\/recover#token=[A-Za-z0-9_-]{43}/.exec(latestMailTo(email)?.text ?? "")?.[0];
    return link;
  }, { timeout: 20_000 }).toBeTruthy();
  return link!;
}

test("konto med e-post och glömt lösenord via e-post", async ({ browser }) => {
  test.setTimeout(180_000);
  const email = `ulla.${unique()}@exempel.se`;
  for (const path of ["/recover", "/konto", "/integritet", "/api/account/password-reset", "/api/account"]) {
    const page = await browser.newPage();
    await warmRoute(page, path);
    await page.close();
  }

  // Registrering: e-post, namn och lösenord, med länk till personuppgiftstexten.
  const registration = await (await browser.newContext()).newPage();
  await registration.goto("/organizer");
  await registration.getByRole("button", { name: "Har du inget konto? Skapa ett" }).click();
  await expect(registration.getByRole("link", { name: "Så hanterar O-Tid personuppgifter" })).toBeVisible();
  await screenshots(registration, "registrering");
  await registration.close();

  const ulla = await registerAccount(browser, email, "Ulla Glömsk");
  await ulla.getByRole("button", { name: "Logga ut" }).click();
  await expect(ulla.getByText("Du är utloggad.")).toBeVisible();

  // Glömt lösenord: samma besked oavsett adress; länken kommer med e-post.
  await ulla.getByRole("link", { name: "Glömt lösenordet?" }).click();
  await expect(ulla.getByRole("heading", { name: "Glömt lösenordet" })).toBeVisible();
  await ulla.getByLabel("E-postadress").fill(email.toUpperCase());
  await screenshots(ulla, "glomt-losenord");
  await ulla.getByRole("button", { name: "Skicka länk" }).click();
  await expect(ulla.getByText("Om adressen har ett konto i O-Tid har vi skickat en länk dit.")).toBeVisible();

  const link = await resetLink(email);
  await ulla.goto(link);
  await expect(ulla.getByRole("heading", { name: "Välj nytt lösenord" })).toBeVisible();
  expect(ulla.url()).not.toContain("token=");
  await ulla.getByLabel("Nytt lösenord", { exact: true }).fill("nytt-lösen-2");
  await ulla.getByRole("button", { name: "Spara nytt lösenord" }).click();
  await expect(ulla.getByText("Lösenordet är bytt. Logga in med det nya lösenordet.")).toBeVisible();

  // Länken går inte att använda två gånger.
  await ulla.goto(link);
  await ulla.getByLabel("Nytt lösenord", { exact: true }).fill("tredje-lösen-3");
  await ulla.getByRole("button", { name: "Spara nytt lösenord" }).click();
  await expect(ulla.getByText("Länken är ogiltig, redan använd eller har gått ut.")).toBeVisible();

  // Det gamla lösenordet gäller inte; det nya gör det.
  await logIn(ulla, email, password);
  await expect(ulla.getByText("E-postadressen eller lösenordet stämmer inte.")).toBeVisible();
  await logIn(ulla, email, "nytt-lösen-2");
  await expect(ulla.getByRole("heading", { name: "Dina tävlingar" })).toBeVisible();

  // Mitt konto.
  await ulla.getByRole("link", { name: "Mitt konto" }).click();
  await expect(ulla.getByRole("heading", { name: "Mitt konto" })).toBeVisible();
  await expect(ulla.getByText(email)).toBeVisible();
  await ulla.getByLabel("Namn", { exact: true }).fill("Ulla Minnesgod");
  await ulla.getByRole("button", { name: "Spara namn" }).click();
  await expect(ulla.getByText("Namnet är sparat.")).toBeVisible();
  await screenshots(ulla, "mitt-konto");
});

test("superadmin döljer och tar bort en skräptävling och spärrar kontot", async ({ browser, request }) => {
  test.setTimeout(240_000);
  const suffix = unique();
  const spamEmail = `spam.${suffix}@exempel.se`;
  const spam = await registerAccount(browser, spamEmail, "Spam Spamsson");
  // Utvecklingsservern kompilerar sidor vid första besöket; superadminsidan och dess API:er kompileras innan flödet mäts.
  for (const path of ["/superadmin", "/api/superadmin"]) await warmRoute(spam, path);
  await warmRoute(spam, "/api/superadmin/actions", "POST");
  const spamName = `Gratis klockor ${suffix}`;
  const raceId = await createRaceViaApi(spam, spamName);
  await spam.reload();
  await expect(spam.getByRole("heading", { name: spamName })).toBeVisible();
  // Opublicerad syns inte; publicerad syns tills superadmin döljer den (ADR-0172 beslut 4).
  expect((await request.get(`/api/public/races/${raceId}/results`)).status()).toBe(404);
  await publishRaceViaApi(spam, raceId);
  expect((await request.get(`/api/public/races/${raceId}/results`)).status()).toBe(200);

  const bossEmail = `sara.${suffix}@exempel.se`;
  const boss = await registerAccount(browser, bossEmail, "Sara Superadmin");
  await expect(boss.getByRole("link", { name: "Superadmin" })).toHaveCount(0);
  expect((await boss.request.get("/api/superadmin")).status()).toBe(403);
  grantSuperadmin(bossEmail);
  await boss.reload();
  await boss.getByRole("link", { name: "Superadmin" }).click();
  await expect(boss.getByRole("heading", { name: "Superadmin" })).toBeVisible();

  // Tävlingen hittas med sök och döljs från de publika sidorna.
  const races = boss.getByRole("region", { name: "Tävlingar" });
  await races.getByLabel("Sök tävling, lopp eller ägare").fill(spamName);
  await races.getByRole("button", { name: "Sök" }).click();
  await expect(races.getByRole("row")).toHaveCount(2);
  await expect(races.getByRole("rowheader", { name: spamName })).toBeVisible();
  await expect(races.getByRole("cell", { name: spamEmail })).toBeVisible();
  await races.getByRole("button", { name: `Dölj ${spamName}` }).click();
  await races.getByLabel("Skäl (loggas)").fill("Reklam för klockor");
  await races.getByRole("button", { name: "Utför" }).click();
  await expect(boss.getByText(`Klart: Dolde tävling – ${spamName} – Torsdag.`)).toBeVisible();
  await expect(races.getByText("Dold", { exact: true })).toBeVisible();
  expect((await request.get(`/results/${raceId}`)).status()).toBe(404);
  expect((await request.get(`/api/public/races/${raceId}/results`)).status()).toBe(404);
  await screenshots(boss, "superadmin");

  // Ta bort kräver tävlingens namn.
  await races.getByRole("button", { name: `Ta bort ${spamName}` }).click();
  await races.getByLabel("Skäl (loggas)").fill("Skräp");
  await races.getByLabel(`Skriv tävlingens namn, ${spamName}, för att bekräfta`).fill("fel namn");
  await races.getByRole("button", { name: "Utför" }).click();
  await expect(races.getByText("Bekräftelsen stämmer inte.")).toBeVisible();
  await races.getByLabel(`Skriv tävlingens namn, ${spamName}, för att bekräfta`).fill(spamName);
  await races.getByRole("button", { name: "Utför" }).click();
  await expect(boss.getByText(`Klart: Tog bort tävling – ${spamName}.`)).toBeVisible();
  await expect(races.getByText("Inga tävlingar matchar.")).toBeVisible();

  // Kontot spärras: inloggningen slutar gälla och det går inte att logga in igen.
  const accounts = boss.getByRole("region", { name: "Konton" });
  await accounts.getByLabel("Sök e-post eller namn").fill(spamEmail);
  await accounts.getByRole("button", { name: "Sök" }).click();
  await expect(accounts.getByRole("rowheader", { name: spamEmail })).toBeVisible();
  await accounts.getByRole("button", { name: `Spärra ${spamEmail}` }).click();
  await accounts.getByLabel("Skäl (loggas)").fill("Skräpkonto");
  await accounts.getByRole("button", { name: "Utför" }).click();
  await expect(accounts.getByText("Spärrat", { exact: true })).toBeVisible();

  const log = boss.getByRole("region", { name: "Logg" });
  // Loggen är gemensam för hela installationen; raderna för just det här testet hittas på mål och utförare.
  const blocked = log.getByRole("row").filter({ hasText: spamEmail });
  await expect(blocked).toHaveCount(1);
  for (const part of ["Spärrade konto", bossEmail, "Skräpkonto"]) await expect(blocked).toContainText(part);
  await expect(log.getByRole("row").filter({ hasText: spamName })).toHaveCount(2);
  await expect(log.getByRole("row").filter({ hasText: spamName }).filter({ hasText: "Tog bort tävling" })).toContainText(bossEmail);
  await expect(log.getByRole("row").filter({ hasText: bossEmail }).filter({ hasText: "Gav superadmin" })).toContainText("Serverkommando");

  await spam.goto("/organizer");
  await expect(spam.getByRole("heading", { name: "Logga in" })).toBeVisible();
  await logIn(spam, spamEmail);
  await expect(spam.getByText("Kontot är spärrat. Kontakta den som driver O-Tid.")).toBeVisible();
});
