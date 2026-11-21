import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { expect, test, type Page } from "@playwright/test";
import { daysFromToday, grantSuperadmin, publishRaceViaApi, registerAccount, TIME_ZONE, unique, warmRoute } from "./helpers";

/**
 * Startsidan efter skissen F3 (2026-11-21, ADR-0230): rubriken och sökningen överst med veckans målning hel till höger, Pågår
 * nu, Kommande och Genomförda brett till vänster (tomma avsnitt syns inte) och Nytt i O-Tid smalt till höger; i telefonen
 * sökningen, avsnitten, målningen och nyheterna i den ordningen. Den inloggade ser «Ditt O-Tid» med sina kartprojekt.
 * Nyheterna: superadmin skriver en allmän nyhet som syns för alla; klubbens ledare skriver en klubbnyhet som syns för klubbens
 * medlemmar, märkt med klubben, men inte för utloggade eller andra.
 */
const mapBytes = new Uint8Array(readFileSync(new URL("../../fixtures/maps/kartfil.omap", import.meta.url)));
const picture = fileURLToPath(new URL("../../apps/web/public/malningar/skym.jpg", import.meta.url));
const csrfOf = async (page: Page) => (await page.context().cookies()).find(row => /otid[-_]organizer[-_]csrf$/.test(row.name))?.value ?? "";
const headersOf = async (page: Page) => ({ origin: new URL(page.url()).origin, "x-otid-csrf": await csrfOf(page) });
const top = async (page: Page, selector: string) => (await page.locator(selector).first().boundingBox())!.y;
/** Nyheternas bilder laddas först när de syns (lazy): rulla fram dem före en skärmbild av hela sidan. */
async function loadImages(page: Page): Promise<void> {
  for (const picture of await page.getByTestId("home-news").getByRole("img").all()) {
    await picture.scrollIntoViewIfNeeded();
    await expect.poll(() => picture.evaluate((element: HTMLImageElement) => element.complete && element.naturalWidth > 0)).toBe(true);
  }
}
const noSideScroll = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

async function publishedRace(page: Page, eventName: string, raceDate: string): Promise<void> {
  const response = await page.request.post("/api/organizer/events", {
    headers: { ...await headersOf(page), "idempotency-key": `organizer-event-create:${randomUUID()}` },
    data: { formatVersion: 1, eventName, raceName: "Huvudlopp", raceDate, timeZone: TIME_ZONE, raceType: "STANDARD" } });
  expect(response.status()).toBe(201);
  await publishRaceViaApi(page, (await response.json() as { raceId: string }).raceId);
}

test("startsidan: avsnitten, veckans målning i dator och telefon och den inloggades projekt", async ({ browser, baseURL }) => {
  test.setTimeout(240_000);
  const suffix = unique();
  const owner = await registerAccount(browser, `start.${suffix}@exempel.se`, "Stina Start");
  const upcoming = `Höstkvällen ${suffix}`;
  await publishedRace(owner, upcoming, daysFromToday(5));

  // Ett tomt avsnitt syns inte: sökningen ger bara Kommande.
  const visitor = await (await browser.newContext({ viewport: { width: 1280, height: 900 } })).newPage();
  await visitor.goto(`/?q=${encodeURIComponent(suffix)}`);
  await expect(visitor.getByRole("heading", { name: "Hitta din tävling", level: 1 })).toBeVisible();
  await expect(visitor.getByRole("region", { name: "Kommande" }).getByRole("link", { name: upcoming })).toBeVisible();
  await expect(visitor.getByRole("region", { name: "Pågår nu" })).toHaveCount(0);
  await expect(visitor.getByRole("region", { name: "Genomförda" })).toHaveCount(0);
  await expect(visitor.getByText("Inga kommande tävlingar publicerade.")).toHaveCount(0);
  await expect(visitor.getByLabel("Sök tävling")).toBeVisible();
  // Sidans enda mörka knapp är Sök; inga rutor "Mer än tidtagning".
  await expect(visitor.getByTestId("home-features")).toHaveCount(0);
  await expect(visitor.getByTestId("home-personal")).toHaveCount(0);

  // Veckans målning: hel bild från samma värd, bildtexten med länk till konstnären, och sidfotens text.
  await visitor.goto("/");
  const painting = visitor.getByTestId("home-painting");
  await expect(painting).toHaveAttribute("alt", /^Veckans målning: .+ av Emm Berring$/);
  const src = await painting.getAttribute("src");
  expect(src).toMatch(/^\/malningar\/[a-z]+\.jpg$/);
  expect((await visitor.request.get(src!)).status()).toBe(200);
  expect(await painting.evaluate((image: HTMLImageElement) => image.complete && image.naturalWidth > 0)).toBe(true);
  await expect(visitor.locator("figcaption")).toHaveText("Veckans målning · Emm Berring");
  await expect(visitor.locator("figcaption").getByRole("link", { name: "Emm Berring" })).toHaveAttribute("href", "https://berring.se/emm/");
  const footer = visitor.getByRole("contentinfo");
  await expect(footer).toHaveCount(1);
  await expect(footer.getByTestId("home-painting-credit")).toHaveText(/^Veckans målning: .+ av Emm Berring, (olja|akryl och olja) på duk, \d+ × \d+ cm, \d{4}\.$/);
  await expect(footer.getByRole("link", { name: "Emm Berrings portfolio" })).toHaveAttribute("href", "https://berring.se/emm/");
  // Hel: proportionerna som filen, aldrig beskuren eller utdragen.
  const ratio = await painting.evaluate((image: HTMLImageElement) => [image.getBoundingClientRect().width / image.getBoundingClientRect().height,
    image.naturalWidth / image.naturalHeight]);
  expect(Math.abs(ratio[0]! - ratio[1]!)).toBeLessThan(0.02);

  // Datorbredd: målningen till höger om rubriken, avsnitten under till vänster.
  const [wide, heading] = [await painting.boundingBox(), await visitor.getByRole("heading", { level: 1 }).boundingBox()];
  expect(wide!.x).toBeGreaterThan(heading!.x + heading!.width);
  expect(wide!.height).toBeLessThanOrEqual(441);
  expect(await top(visitor, "#kommande")).toBeGreaterThan(wide!.y);
  expect(await noSideScroll(visitor)).toBeLessThanOrEqual(0);
  // Sidhuvudet har samma vänsterkant som rubriken.
  expect(Math.abs((await visitor.locator("[data-site-head] a[href='/']").boundingBox())!.x - heading!.x)).toBeLessThanOrEqual(2);
  await loadImages(visitor);
  await visitor.screenshot({ path: "test-results/startsida-utloggad-1280.png", fullPage: true });

  // Telefonen: sökningen, avsnitten, målningen kant i kant.
  await visitor.setViewportSize({ width: 390, height: 844 });
  const narrow = await painting.boundingBox();
  expect(narrow!.x).toBe(0);
  expect(Math.round(narrow!.width)).toBe(390);
  expect(await top(visitor, "#kommande")).toBeGreaterThan(await top(visitor, "[role=search]"));
  expect(narrow!.y).toBeGreaterThan(await top(visitor, "#kommande"));
  expect(await noSideScroll(visitor)).toBeLessThanOrEqual(0);
  await loadImages(visitor);
  await visitor.screenshot({ path: "test-results/startsida-utloggad-390.png", fullPage: true });

  // Inloggad: «Ditt O-Tid» med kartprojektet, länken till Mitt O-Tid i sidhuvudet, målningen som för alla.
  await warmRoute(owner, "/api/organizer/map-projects/upload", "POST");
  const created = await owner.request.post("/api/organizer/map-projects/upload", { headers: { origin: baseURL!, "x-otid-csrf": await csrfOf(owner),
    "content-type": "application/octet-stream", "x-otid-request-id": crypto.randomUUID(), "x-otid-name": "Kungshatt", "x-otid-file-name": "Kungshatt.omap" },
    data: Buffer.from(mapBytes) });
  expect(created.status()).toBe(201);
  const projectId = (await created.json() as { projectId: string }).projectId;
  await owner.goto("/");
  const personal = owner.getByTestId("home-personal");
  await expect(personal.getByRole("heading", { name: "Ditt O-Tid" })).toBeVisible();
  await expect(personal.getByRole("link", { name: "Kungshatt" })).toHaveAttribute("href", `/organizer/map-projects/${projectId}`);
  await expect(owner.getByRole("navigation", { name: "Konto" }).getByRole("link", { name: "Mitt O-Tid" })).toHaveAttribute("href", "/organizer");
  await expect(owner.getByTestId("home-painting")).toBeVisible();
  await owner.setViewportSize({ width: 1280, height: 900 });
  await loadImages(owner);
  await owner.screenshot({ path: "test-results/startsida-inloggad-1280.png", fullPage: true });
  await owner.setViewportSize({ width: 390, height: 844 });
  await loadImages(owner);
  await owner.screenshot({ path: "test-results/startsida-inloggad-390.png", fullPage: true });

  // Mitt O-Tid har sidfoten som förut, utan målningen.
  await owner.goto("/organizer");
  await expect(owner.getByRole("contentinfo").getByRole("link", { name: "Om O-Tid" })).toBeVisible();
  await expect(owner.getByTestId("home-painting")).toHaveCount(0);
  await expect(owner.getByText("Veckans målning")).toHaveCount(0);
});

test("nyheter: superadmin skriver för alla, klubbens ledare för klubbens medlemmar", async ({ browser }) => {
  test.setTimeout(300_000);
  const suffix = unique();

  // Superadmin skriver en allmän nyhet med bild och länk på /superadmin.
  const bossEmail = `nyhet.boss.${suffix}@exempel.se`;
  const boss = await registerAccount(browser, bossEmail, "Bo Boss");
  grantSuperadmin(bossEmail);
  for (const path of ["/superadmin", "/api/superadmin/news"]) await warmRoute(boss, path);
  await boss.goto("/superadmin");
  const general = `Egen meny för tävlingsdagen ${suffix}`;
  const form = boss.getByTestId("news-form");
  await form.getByLabel("Rubrik").fill(general);
  await form.getByLabel("Kort text").fill("Växla mellan avläsning, sekretariat och resultat");
  await form.getByLabel("Länk (valfri)").fill("/om");
  await form.getByLabel("Bild (valfri)").setInputFiles(picture);
  await expect(form.locator("img")).toBeVisible();
  await form.screenshot({ path: "test-results/nyheter-superadmin-skriv.png" });
  await form.getByRole("button", { name: "Publicera" }).click();
  await expect(boss.getByText("Sparat.")).toBeVisible();
  await expect(boss.getByRole("list", { name: "Nyheter" }).getByText(general)).toBeVisible();
  await boss.locator("#nyheter").screenshot({ path: "test-results/nyheter-superadmin-lista.png" });

  // Utloggad: nyheten i Nytt i O-Tid med bilden (16:9, laddas när den syns) och länken.
  const visitor = await (await browser.newContext({ viewport: { width: 1280, height: 900 } })).newPage();
  await visitor.goto("/");
  const news = visitor.getByTestId("home-news");
  await expect(news.getByRole("heading", { name: "Nytt i O-Tid" })).toBeVisible();
  await expect(news.getByRole("link", { name: general })).toHaveAttribute("href", "/om");
  const image = news.getByRole("img", { name: `Bild till nyheten ${general}` });
  await expect(image).toHaveAttribute("loading", "lazy");
  const imageBox = await image.boundingBox();
  expect(Math.abs(imageBox!.width / imageBox!.height - 16 / 9)).toBeLessThan(0.05);
  expect((await visitor.request.get((await image.getAttribute("src"))!)).headers()["content-type"]).toMatch(/^image\/(webp|jpeg)$/);
  expect(await news.getByRole("listitem").count()).toBeLessThanOrEqual(3);

  // En klubb: ägaren bjuder in en ledare och en medlem.
  const owner = await registerAccount(browser, `nyhet.agare.${suffix}@exempel.se`, "Åsa Ägare");
  const none = "00000000-0000-4000-8000-000000000000";
  for (const [path, method] of [["/api/organizer/clubs", "POST"], [`/organizer/clubs/${none}`, "GET"], [`/api/organizer/clubs/${none}`, "GET"],
    [`/api/organizer/clubs/${none}/archive`, "GET"], [`/api/organizer/clubs/${none}/news`, "GET"], [`/api/organizer/clubs/${none}/news`, "POST"]] as const) {
    await warmRoute(owner, path, method);
  }
  const clubName = `Nyhetsklubben ${suffix}`;
  const club = await owner.request.post("/api/organizer/clubs", { headers: await headersOf(owner),
    data: { formatVersion: 1, requestId: randomUUID(), name: clubName } });
  expect(club.status()).toBe(201);
  const clubId = (await club.json() as { club: { clubId: string } }).club.clubId;
  const leaderEmail = `nyhet.ledare.${suffix}@exempel.se`, memberEmail = `nyhet.medlem.${suffix}@exempel.se`;
  for (const [email, role] of [[leaderEmail, "LEADER"], [memberEmail, "READER"]] as const) {
    const invited = await owner.request.post(`/api/organizer/clubs/${clubId}/members`, { headers: await headersOf(owner),
      data: { formatVersion: 1, requestId: randomUUID(), email, role } });
    expect(invited.status()).toBeLessThan(300);
  }

  // Ledaren skriver klubbens nyhet under klubbytans flik Nyheter.
  const leader = await registerAccount(browser, leaderEmail, "Leo Ledare");
  await leader.goto(`/organizer/clubs/${clubId}#news`);
  await expect(leader.getByRole("tab", { name: "Nyheter" })).toHaveAttribute("aria-selected", "true", { timeout: 60_000 });
  const clubNews = `Natt-KM på torsdag ${suffix}`;
  const clubForm = leader.getByTestId("news-form");
  await clubForm.getByLabel("Rubrik").fill(clubNews);
  await clubForm.getByLabel("Kort text").fill("Samling vid klubbstugan 18.30");
  await clubForm.getByRole("button", { name: "Publicera" }).click();
  await expect(leader.getByText("Sparat.")).toBeVisible();
  await leader.locator("#nyheter").screenshot({ path: "test-results/nyheter-klubb-ledare.png" });

  // Medlemmen läser den på klubbytan (utan formuläret) och på startsidan, märkt med klubben, blandad med den allmänna.
  const member = await registerAccount(browser, memberEmail, "Mia Medlem");
  await member.goto(`/organizer/clubs/${clubId}#news`);
  await expect(member.getByRole("list", { name: "Klubbens nyheter" }).getByText(clubNews)).toBeVisible();
  await expect(member.getByTestId("news-form")).toHaveCount(0);
  await member.goto("/");
  const memberNews = member.getByTestId("home-news");
  await expect(memberNews.getByRole("heading", { name: clubNews })).toBeVisible();
  await expect(memberNews.getByRole("listitem").filter({ hasText: clubNews })).toContainText(clubName);
  await expect(memberNews.getByRole("link", { name: general })).toBeVisible();
  await member.setViewportSize({ width: 1280, height: 900 });
  // Bilderna laddas först när de syns (lazy); vänta på dem före skärmbilden.
  for (const picture of await memberNews.getByRole("img").all()) {
    await picture.scrollIntoViewIfNeeded();
    await expect.poll(() => picture.evaluate((element: HTMLImageElement) => element.complete && element.naturalWidth > 0)).toBe(true);
  }
  await memberNews.screenshot({ path: "test-results/nyheter-medlem-startsidan.png" });

  // Utloggad och en annan inloggad ser inte klubbens nyhet, och API:t ger den inte till någon utanför klubben.
  await visitor.goto("/");
  await expect(visitor.getByTestId("home-news").getByRole("link", { name: general })).toBeVisible();
  await expect(visitor.getByText(clubNews)).toHaveCount(0);
  await boss.goto("/");
  await expect(boss.getByText(clubNews)).toHaveCount(0);
  expect((await visitor.request.get(`/api/organizer/clubs/${clubId}/news`)).status()).toBe(401);
  expect((await owner.request.post("/api/superadmin/news", { headers: await headersOf(owner),
    data: { formatVersion: 1, requestId: randomUUID(), title: "Inte min", body: "", link: "" } })).status()).toBe(403);

  // Moderering: superadmin döljer klubbens nyhet; medlemmen ser den inte längre.
  await boss.goto("/superadmin");
  await boss.getByRole("button", { name: `Dölj ${clubNews}` }).click();
  await expect(boss.getByRole("button", { name: `Visa ${clubNews}` })).toBeVisible();
  await member.goto("/");
  await expect(member.getByText(clubNews)).toHaveCount(0);
});
