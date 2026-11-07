import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { expect, test, type Page } from "@playwright/test";
import { nextGoogleIdentity } from "./fake-google";
import { daysFromToday, logIn, password, registerAccount, today, unique, warmRoute } from "./helpers";

/**
 * ADR-0205 tillägg: kontomenyn på alla inloggade sidor (namnet eller initialerna: Mina klubbar, Mina grupper, Mitt konto och
 * Logga ut), utloggningen (servern, webbläsarens data, varningen för ändringar som väntar på nät), Kom ihåg mig, Logga ut från
 * alla enheter, Koppla Google-konto (också med en annan adress, mot den falska OpenID-leverantören) och flytten från en tom
 * dubblett, och remsan Mina klubbar och grupper överst i Mina tävlingar. Vid 1280 och 390 px.
 */
const WIDTHS = [1280, 390] as const;
const fixture = (path: string) => fileURLToPath(new URL(`../../fixtures/${path}`, import.meta.url));

async function shot(page: Page, name: string) {
  const directory = process.env.E2E_SCREENSHOT_DIR;
  if (!directory) return;
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: `${directory}/${name}-${page.viewportSize()?.width ?? 0}.png`, fullPage: true });
}

async function noSidewaysScroll(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
}

const menuButton = (page: Page) => page.getByRole("button", { name: /^Konto: / });
const menu = (page: Page) => page.getByTestId("account-menu");

async function openMenu(page: Page) {
  await menuButton(page).click();
  await expect(menu(page).getByRole("link", { name: "Mitt konto" })).toBeVisible();
}

/** Bakgrund och textfärg som de ritas (getComputedStyle). */
const colors = (locator: ReturnType<Page["getByRole"]>) =>
  locator.evaluate(element => { const style = getComputedStyle(element); return { background: style.backgroundColor, color: style.color }; });
/** Ljus yta (--subtle) och mörk text (--ink): inte den globala svarta `button:hover`. */
const LIGHT = { background: "rgb(238, 240, 238)", color: "rgb(26, 29, 27)" };

async function logOutWithMenu(page: Page) {
  await openMenu(page);
  await menu(page).getByRole("button", { name: "Logga ut" }).click();
  await expect(page.getByText("Du är utloggad.")).toBeVisible();
}

async function api(page: Page, path: string, data: unknown) {
  const csrf = (await page.context().cookies()).find(cookie => /otid[-_]organizer[-_]csrf$/.test(cookie.name))?.value ?? "";
  const response = await page.request.post(path, { headers: { origin: new URL(page.url()).origin, "x-otid-csrf": csrf,
    "idempotency-key": `organizer-event-create:${randomUUID()}` }, data });
  expect(response.status(), path).toBeLessThan(300);
  return response.json() as Promise<Record<string, unknown>>;
}

const createRace = (page: Page, eventName: string, raceDate = today()) => api(page, "/api/organizer/events",
  { formatVersion: 1, eventName, raceName: "", raceDate, timeZone: "Europe/Stockholm", raceType: "TRAINING" }).then(body => body.raceId as string);

test.beforeAll(async ({ browser }) => {
  const page = await browser.newPage();
  for (const path of ["/konto", "/konto/flytta-google", "/api/account", "/api/account/google/move"]) await warmRoute(page, path);
  await page.close();
});

test("kontomenyn finns på varje inloggad sida, och utloggningen frågar först när ändringar väntar på nät", async ({ browser }) => {
  test.setTimeout(300_000);
  const suffix = unique();
  const owner = await registerAccount(browser, `meny.${suffix}@exempel.se`, "Maja Menysson");
  // Klubbyta, grupp, en tävling i dag med banläggningen och en tidigare.
  const club = (await api(owner, "/api/organizer/clubs", { formatVersion: 1, requestId: randomUUID(), name: `OK Menyn ${suffix}` })).club as { clubId: string };
  const group = (await api(owner, "/api/organizer/groups", { formatVersion: 1, requestId: randomUUID(), name: `Ungdom ${suffix}`,
    code: `ungdom-${suffix}` })).group as { groupId: string };
  const raceId = await createRace(owner, `Kvällsträning ${suffix}`);
  await createRace(owner, `Förra veckan ${suffix}`, daysFromToday(-7));
  await owner.goto(`/admin/${raceId}/course-setting`);
  await owner.getByLabel("Kartfil (.ocd, .omap eller .xmap, högst 75 MB)").setInputFiles(fixture("maps/kartfil.omap"));
  await owner.getByRole("button", { name: "Ladda upp kartfil (OCAD eller Mapper)" }).click();
  await expect(owner.getByRole("heading", { name: "Ingen banläggning än" })).toBeVisible({ timeout: 60_000 });
  await owner.getByRole("button", { name: "Börja med en tom banläggning" }).click();
  await expect(owner.getByRole("button", { name: /^Fil/ })).toBeVisible({ timeout: 60_000 });

  const pages: readonly [string, string][] = [["mina-tavlingar", "/organizer"], ["banlaggning", `/admin/${raceId}/course-setting`],
    ["utskrift", `/admin/${raceId}/course-setting/print`], ["klubbarkiv", `/organizer/clubs/${club.clubId}`],
    ["traningsgrupp", `/organizer/groups/${group.groupId}`], ["mitt-konto", "/konto"]];
  for (const width of WIDTHS) {
    await owner.setViewportSize({ width, height: 900 });
    for (const [name, path] of pages) {
      await owner.goto(path);
      await expect(menuButton(owner), `${name} ${width}`).toBeVisible({ timeout: 30_000 });
      await expect(menuButton(owner)).toHaveAccessibleName("Konto: Maja Menysson");
      // Initialerna alltid; namnet bara på bred skärm.
      await expect(menuButton(owner)).toContainText("MM");
      // Hovrad och öppen: ljus yta och mörk text (namnet syns), också "Logga ut" när den hovras.
      await menuButton(owner).hover();
      expect(await colors(menuButton(owner)), `hovrad ${name} ${width}`).toEqual(LIGHT);
      await openMenu(owner);
      await owner.mouse.move(0, 0);
      expect(await colors(menuButton(owner)), `öppen ${name} ${width}`).toEqual(LIGHT);
      for (const label of ["Mina klubbar", "Mina grupper", "Mitt konto"]) await expect(menu(owner).getByRole("link", { name: label })).toBeVisible();
      await expect(menu(owner).getByRole("button", { name: "Logga ut" })).toBeVisible();
      await menu(owner).getByRole("button", { name: "Logga ut" }).hover();
      expect(await colors(menu(owner).getByRole("button", { name: "Logga ut" })), `Logga ut ${name} ${width}`).toEqual(LIGHT);
      await menuButton(owner).hover();
      await noSidewaysScroll(owner);
      await shot(owner, `kontomeny-${name}`);
      await owner.keyboard.press("Escape");
      await expect(menu(owner).getByRole("link", { name: "Mitt konto" })).toHaveCount(0);
    }
  }

  // Mina tävlingar: remsan överst med klubbytan och gruppen, och den tidigare tävlingen ihopfälld.
  for (const width of WIDTHS) {
    await owner.setViewportSize({ width, height: 900 });
    await owner.goto("/organizer");
    const strip = owner.getByTestId("my-places");
    await expect(strip.getByRole("region", { name: "Mina klubbar" }).getByRole("link", { name: new RegExp(`OK Menyn ${suffix}.*Ägare · 0 träningar`) }))
      .toBeVisible();
    await expect(strip.getByRole("region", { name: "Mina grupper" }).getByRole("link", { name: new RegExp(`Ungdom ${suffix}.*Ledare`) })).toBeVisible();
    await expect(strip.getByRole("button", { name: "Ny klubbyta" })).toBeVisible();
    await expect(strip.getByRole("button", { name: "Ny grupp" })).toBeVisible();
    // Remsan står före tävlingarna.
    const stripTop = (await strip.boundingBox())!.y;
    expect(stripTop).toBeLessThan((await owner.getByRole("heading", { name: "Dina tävlingar" }).boundingBox())!.y);
    const past = owner.getByTestId("past-events");
    await expect(past.locator("summary")).toHaveText("Tidigare tävlingar (1)");
    await expect(past.getByRole("heading", { name: `Förra veckan ${suffix}` })).toBeHidden();
    await expect(owner.getByRole("heading", { name: `Kvällsträning ${suffix}` })).toBeVisible();
    await noSidewaysScroll(owner);
    await shot(owner, "mina-tavlingar-remsan");
  }
  // Sökningen gäller också de tidigare.
  await owner.getByLabel("Sök tävling eller lopp").fill("Förra veckan");
  await expect(owner.getByTestId("past-events").getByRole("heading", { name: `Förra veckan ${suffix}` })).toBeVisible();
  await expect(owner.getByRole("heading", { name: `Kvällsträning ${suffix}` })).toHaveCount(0);
  // Kontomenyns Mina grupper går till remsan.
  await owner.getByLabel("Sök tävling eller lopp").fill("");
  await openMenu(owner);
  await menu(owner).getByRole("link", { name: "Mina grupper" }).click();
  await expect(owner).toHaveURL(/\/organizer#mina-grupper$/);

  // Webbläsarens data: två ändringar i banläggningens kö (fältläget utan nät), en följd löpare och en inställning.
  await owner.setViewportSize({ width: 390, height: 900 });
  await owner.goto("/organizer");
  await owner.evaluate(async (race) => {
    window.localStorage.setItem("otid.follow.v1", JSON.stringify({ runners: [{ name: "Anna Andersson" }], clubs: [] }));
    window.localStorage.setItem("otid.readout.sound.v1", "off");
    await new Promise<void>((resolve, reject) => {
      const open = indexedDB.open("otid-course-setting");
      open.onsuccess = () => {
        const tx = open.result.transaction("queue", "readwrite");
        tx.objectStore("queue").add({ id: `e2e-1-${race}`, raceId: race, kind: "NOTE" });
        tx.objectStore("queue").add({ id: `e2e-2-${race}`, raceId: race, kind: "NOTE" });
        tx.oncomplete = () => { open.result.close(); resolve(); };
        tx.onerror = () => reject(tx.error ?? new Error("IndexedDB"));
      };
      open.onerror = () => reject(open.error ?? new Error("IndexedDB"));
    });
  }, raceId);
  await openMenu(owner);
  await menu(owner).getByRole("button", { name: "Logga ut" }).click();
  const warning = menu(owner).getByRole("alertdialog");
  await expect(warning).toContainText("2 ändringar väntar på nät – logga ut ändå?");
  await shot(owner, "kontomeny-vantar-pa-nat");
  await warning.getByRole("button", { name: "Avbryt" }).click();
  await expect(menu(owner).getByRole("button", { name: "Logga ut" })).toBeVisible();
  await menu(owner).getByRole("button", { name: "Logga ut" }).click();
  await menu(owner).getByRole("button", { name: "Logga ut ändå" }).click();
  await expect(owner.getByText("Du är utloggad.")).toBeVisible();
  await expect(owner).toHaveURL(/\/organizer$/);
  await shot(owner, "utloggad");
  const left = await owner.evaluate(async () => {
    const queued = await new Promise<number>(resolve => {
      const open = indexedDB.open("otid-course-setting");
      open.onsuccess = () => {
        const request = open.result.transaction("queue").objectStore("queue").count();
        request.onsuccess = () => { open.result.close(); resolve(request.result); };
      };
    });
    return { queued, follow: window.localStorage.getItem("otid.follow.v1"), sound: window.localStorage.getItem("otid.readout.sound.v1") };
  });
  expect(left).toEqual({ queued: 0, follow: null, sound: "off" });
  // Servern har avslutat sessionen.
  expect((await owner.request.get("/api/account")).status()).toBe(401);
});

test("Kom ihåg mig och Logga ut från alla enheter", async ({ browser }) => {
  test.setTimeout(180_000);
  const email = `ihag.${unique()}@exempel.se`;
  const laptop = await registerAccount(browser, email, "Kim Kommihåg");
  await logOutWithMenu(laptop);
  const session = async (page: Page) => (await page.context().cookies()).find(cookie => /otid[-_]organizer[-_]session$/.test(cookie.name));

  // Förval: rutan är inte ikryssad och sessionen är en sessionskaka (glöms när webbläsaren stängs).
  await expect(laptop.getByRole("checkbox", { name: "Kom ihåg mig på den här datorn" })).not.toBeChecked();
  await expect(laptop.getByText("Använd inte på en lånad dator")).toBeVisible();
  for (const width of WIDTHS) { await laptop.setViewportSize({ width, height: 900 }); await shot(laptop, "inloggning-kom-ihag"); }
  await logIn(laptop, email);
  await expect(laptop.getByRole("heading", { name: "Dina tävlingar" })).toBeVisible();
  expect((await session(laptop))?.expires).toBe(-1);
  await logOutWithMenu(laptop);

  // Ikryssad: 30 dygn.
  await laptop.getByLabel("E-postadress").fill(email);
  await laptop.getByLabel("Lösenord", { exact: true }).fill(password);
  await laptop.getByRole("checkbox", { name: "Kom ihåg mig på den här datorn" }).check();
  await laptop.getByRole("button", { name: "Logga in", exact: true }).click();
  await expect(laptop.getByRole("heading", { name: "Dina tävlingar" })).toBeVisible();
  expect((await session(laptop))!.expires * 1000).toBeGreaterThan(Date.now() + 29 * 24 * 60 * 60 * 1000);

  // En annan dator (telefonen), sedan Logga ut från alla enheter under Mitt konto.
  const phone = await (await browser.newContext()).newPage();
  await logIn(phone, email);
  await expect(phone.getByRole("heading", { name: "Dina tävlingar" })).toBeVisible();
  await laptop.goto("/konto");
  await laptop.getByRole("button", { name: "Logga ut från alla enheter" }).click();
  await expect(laptop.getByText("Du är utloggad på alla enheter.")).toBeVisible();
  expect((await phone.request.get("/api/account")).status()).toBe(401);
  await phone.reload();
  await expect(phone.getByRole("button", { name: "Logga in", exact: true })).toBeVisible();
});

for (const width of WIDTHS) {
  test(`Koppla Google-konto med en annan adress, logga ut och in med Google på samma konto (${width} px)`, async ({ browser }) => {
    test.setTimeout(180_000);
    const suffix = unique();
    const email = `joel.${suffix}@exempel.se`;
    const gmail = `joel.${suffix}@gmail.test`;
    const sub = `g${suffix}${width}`;
    const page = await registerAccount(browser, email, "Joel Koppla");
    await page.setViewportSize({ width, height: 900 });
    await openMenu(page);
    await menu(page).getByRole("link", { name: "Mitt konto" }).click();
    await expect(page.getByText("Inget Google-konto är kopplat.")).toBeVisible();
    await nextGoogleIdentity({ sub, email: gmail, name: "Joel på Google" });
    await page.getByRole("button", { name: "Koppla Google-konto" }).click();
    await expect(page.getByText(`Google-kontot (${gmail}) är kopplat – du kan logga in med Google.`)).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText(`Kopplat Google-konto: ${gmail}`)).toBeVisible();
    // Kontots adress står kvar.
    await expect(page.getByText(email)).toBeVisible();
    await noSidewaysScroll(page);
    await shot(page, "google-kopplat");

    await logOutWithMenu(page);
    await nextGoogleIdentity({ sub, email: gmail });
    await page.getByRole("link", { name: "Logga in med Google" }).click();
    await expect(page.getByRole("heading", { name: "Dina tävlingar" })).toBeVisible({ timeout: 30_000 });
    await expect(menuButton(page)).toHaveAccessibleName("Konto: Joel Koppla");
    await page.goto("/konto");
    await expect(page.getByText(email)).toBeVisible();
    await expect(page.getByText(`Kopplat Google-konto: ${gmail}`)).toBeVisible();

    // Ta bort kopplingen: kontot har ett eget lösenord.
    await page.getByRole("button", { name: "Ta bort kopplingen" }).click();
    await expect(page.getByText("Kopplingen är borttagen. Du loggar in med e-postadressen och lösenordet.")).toBeVisible();
  });
}

test("ägarens fall: Google skapade en dubblett med Gmail-adressen; kopplingen flyttas hit och dubbletten tas bort", async ({ browser }) => {
  test.setTimeout(180_000);
  const suffix = unique();
  const email = `agare.${suffix}@exempel.se`;
  const gmail = `agare.${suffix}@gmail.test`;
  const sub = `dubblett${suffix}`;
  const page = await registerAccount(browser, email, "Ägaren Själv");
  await logOutWithMenu(page);
  // Google-inloggningen skapar ett andra konto med Gmail-adressen.
  await nextGoogleIdentity({ sub, email: gmail, name: "Ägaren på Gmail" });
  await page.getByRole("link", { name: "Logga in med Google" }).click();
  await expect(menuButton(page)).toHaveAccessibleName("Konto: Ägaren på Gmail", { timeout: 30_000 });
  await logOutWithMenu(page);

  // Inloggad som vanligt kopplas Google: sidan säger vad som händer och flytten bekräftas med lösenordet.
  await logIn(page, email);
  await expect(page.getByRole("heading", { name: "Dina tävlingar" })).toBeVisible();
  await page.goto("/konto");
  await nextGoogleIdentity({ sub, email: gmail });
  await page.getByRole("button", { name: "Koppla Google-konto" }).click();
  await expect(page).toHaveURL(/\/konto\/flytta-google$/, { timeout: 30_000 });
  const move = page.getByTestId("google-move");
  await expect(move).toContainText(`Google-kontot ${gmail} är kopplat till ett annat konto i O-Tid (${gmail})`);
  await expect(move).toContainText(`tas bort som dubblett`);
  for (const width of WIDTHS) { await page.setViewportSize({ width, height: 900 }); await noSidewaysScroll(page); await shot(page, "google-flytta"); }
  await page.getByLabel("Ditt lösenord").fill("fel-lösen-9");
  await page.getByRole("button", { name: "Flytta kopplingen och ta bort dubbletten" }).click();
  await expect(page.getByText("Lösenordet stämmer inte.")).toBeVisible();
  await page.getByLabel("Ditt lösenord").fill(password);
  await page.getByRole("button", { name: "Flytta kopplingen och ta bort dubbletten" }).click();
  await expect(page.getByText(`Google-kontot (${gmail}) är kopplat – du kan logga in med Google. Det tomma kontot är borttaget.`)).toBeVisible();
  await shot(page, "google-flyttad");

  // Nästa Google-inloggning hamnar på ägarens konto.
  await logOutWithMenu(page);
  await nextGoogleIdentity({ sub, email: gmail });
  await page.getByRole("link", { name: "Logga in med Google" }).click();
  await expect(menuButton(page)).toHaveAccessibleName("Konto: Ägaren Själv", { timeout: 30_000 });
});

test("ändrat 2026-11-07: ett konto som bara loggar in med Google tas bort efter en ny inloggning hos Google", async ({ browser }) => {
  test.setTimeout(120_000);
  const suffix = unique();
  const gmail = `bara.google.${suffix}@gmail.test`;
  const sub = `bortgang${suffix}`;
  const page = await browser.newPage();
  await page.goto("/organizer");
  await nextGoogleIdentity({ sub, email: gmail, name: "Bara Google" });
  await page.getByRole("link", { name: "Logga in med Google" }).click();
  await expect(menuButton(page)).toHaveAccessibleName("Konto: Bara Google", { timeout: 30_000 });
  await page.goto("/konto");
  const section = page.getByTestId("account-delete-google");
  await expect(section).toContainText("Du loggar in med Google och har inget eget lösenord.");
  await expect(page.getByLabel("Skriv ditt lösenord för att bekräfta")).toHaveCount(0);
  // Ett annat Google-konto vid den nya inloggningen: inget tas bort.
  await nextGoogleIdentity({ sub: `annan${suffix}`, email: `annan.${suffix}@gmail.test` });
  await section.getByRole("button", { name: "Logga in med Google och ta bort kontot" }).click();
  await expect(page.getByText("Kontot är inte borttaget: du loggade in med ett annat Google-konto")).toBeVisible({ timeout: 30_000 });
  for (const width of WIDTHS) { await page.setViewportSize({ width, height: 900 }); await noSidewaysScroll(page); await shot(page, "konto-ta-bort-google"); }
  // Samma Google-konto (den falska leverantören anger en ny inloggning när O-Tid ber om prompt=login): kontot tas bort.
  await nextGoogleIdentity({ sub, email: gmail });
  await page.getByTestId("account-delete-google").getByRole("button", { name: "Logga in med Google och ta bort kontot" }).click();
  await expect(page.getByText("Kontot är borttaget.")).toBeVisible({ timeout: 30_000 });
  await shot(page, "konto-borttaget-google");
  expect((await page.request.get("/api/account")).status()).toBe(401);
  await page.close();
});
