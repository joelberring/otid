import { readFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";
import { createRace, publishRace, publishRaceViaApi, registerAccount, reviewScreenshots, today, unique, warmRoute } from "./helpers";

/**
 * Steg 40: fest med bardisk, hela kvällen i automatiskt läge i ett fönster. Festen och två varor läggs in, bardisken
 * ansluter övningsstationen och en påhittad gäst checkar in (okänd bricka, namnet skrivs in), stämplar två varor och
 * läser ut (två nya köp), läser ut igen (inga nya köp), stämplar mål (utcheckad). En ny okänd bricka får namnförslag.
 * Arbetsytan visar köpen med summa per person och utcheckningen, och summeringen laddas ner som CSV.
 */
test("fest: bardisken checkar in, verifierar köp och checkar ut med mål", async ({ browser }) => {
  test.setTimeout(300_000);
  const suffix = unique();
  const owner = await registerAccount(browser, `fest.${suffix}@exempel.se`, "Fia Fest");
  const raceId = await createRace(owner, `Klubbfest ${suffix}`, today(), "Fest");
  for (const path of ["/fest/aaaaaa", `/api/public/parties/${raceId}`, `/api/public/parties/${raceId}/logo`, "/robots.txt"]) await warmRoute(owner, path);
  for (const path of ["party-guests", "party-desk-events", "party-logo"]) await warmRoute(owner, `/api/admin/races/${raceId}/administrator/${path}`, "POST");

  // Festens start i dag 00:00, så att övningens stämplingar räknas. Två varor med kod och pris.
  const start = owner.getByRole("form", { name: "Festens start" });
  await start.getByLabel("Datum").fill(today());
  await start.getByLabel("Klockslag").fill("00:00");
  await start.getByRole("button", { name: "Spara start" }).click();
  await expect(owner.getByText("Starten är sparad.")).toBeVisible();
  const add = owner.getByRole("form", { name: "Lägg till vara" });
  for (const [code, name, price] of [["31", "Öl", "40"], ["32", "Drink", "60"]] as const) {
    await add.getByLabel("Kod").fill(code);
    await add.getByLabel("Namn").fill(name);
    await add.getByLabel("Pris (kr)").fill(price);
    await add.getByRole("button", { name: "Lägg till vara" }).click();
    await expect(owner.getByLabel(`Vara ${code}: Namn`)).toHaveValue(name);
  }
  await expect(owner.getByRole("link", { name: "Öppna bardisken" }).first()).toHaveAttribute("href", `/admin/${raceId}/readout`);

  // Utseendet: förinställningen för jubileet och en logga (PNG).
  const look = owner.getByRole("form", { name: "Utseende" });
  await look.getByRole("button", { name: "Förinställning: Centrum OK 20 år" }).click();
  await expect(look.getByLabel("Huvudfärg")).toHaveValue("#ae1917");
  await look.getByRole("button", { name: "Spara utseende" }).click();
  await expect(owner.getByText("Utseendet är sparat.")).toBeVisible();
  await look.getByLabel("Logga (PNG eller JPEG, högst 1 MB)").setInputFiles({ name: "logga.png", mimeType: "image/png",
    buffer: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64") });
  await expect(owner.getByText("Loggan är sparad.")).toBeVisible();

  // Jubileumsbarens prislista: bara koderna som saknas läggs till (31 och 32 finns redan), efter bekräftelse.
  owner.once("dialog", dialog => { expect(dialog.message()).toContain("33 Cuba libre 35,00 kr"); expect(dialog.message()).not.toContain("31 "); void dialog.accept(); });
  await owner.getByRole("button", { name: "Lägg in Jubileumsbarens varor" }).click();
  await expect(owner.getByText("6 varor är tillagda.")).toBeVisible();
  await expect(owner.getByLabel("Vara 31: Namn")).toHaveValue("Öl");
  await expect(owner.getByLabel("Vara 34: Grupp")).toHaveValue("Drink");
  const labels = await owner.context().newPage();
  await labels.goto(`/admin/${raceId}/party-labels`);
  await expect(labels.getByTestId("party-labels").locator("strong")).toHaveCount(18);
  await expect(labels.getByTestId("party-labels")).toContainText("kod 34");
  await expect(labels.getByTestId("party-labels")).toContainText("Gå hem – stämpla här");
  await reviewScreenshots(labels, "fest-etiketter");
  await labels.close();

  // Bardisken: ett fönster, stationens knappar syns tills den är ansluten.
  const desk = await owner.context().newPage();
  await desk.goto(`/admin/${raceId}/readout`);
  await desk.waitForURL(`**/readout/index.html#${raceId}`);
  await expect(desk.getByRole("heading", { name: "Bardisken" })).toBeVisible();
  await expect(desk.getByTestId("package-status")).toContainText("v");
  await desk.getByRole("button", { name: "Starta övningsstation" }).click();
  await expect(desk.getByTestId("station-status")).toContainText("Övningsstation");
  const verdict = desk.getByTestId("party-verdict");
  await expect(verdict).toContainText("Stämpla på varans enhet");
  await expect(desk.locator(".party-band")).toHaveText("Jubileumsbaren");
  // Kiosk: inga länkar ut ur sidan i automatiskt läge.
  await expect(desk.getByRole("link", { name: "Hantera tävlingen" })).toHaveCount(0);

  // Första utläsningen: incheckning. Okänd bricka: namnrutan, köpet sparas ändå.
  await desk.getByRole("button", { name: "Läs ut brickan" }).click();
  await expect(desk.getByTestId("party-headline")).toHaveText("✓ Välkommen!");
  const nameBox = desk.getByTestId("party-name");
  await nameBox.getByLabel("Förnamn").fill("Festa");
  await nameBox.getByLabel("Efternamn").fill("Påhittsson");
  await nameBox.getByLabel("Klubb (valfritt)").fill("Påhittade OK");
  await nameBox.getByRole("button", { name: "Spara" }).click();
  await expect(nameBox).toHaveCount(0);
  await expect(verdict).toContainText("Inte du? Ändra");

  // Två stämplingar och utläsning: två nya köp och kvällens summa.
  await desk.getByRole("button", { name: "Stämpla 31 (Öl)" }).click();
  await desk.getByRole("button", { name: "Stämpla 32 (Drink)" }).click();
  await desk.getByRole("button", { name: "Läs ut brickan" }).click();
  await expect(desk.getByTestId("party-headline")).toHaveText("✓ 2 nya köp");
  await expect(desk.getByTestId("party-new")).toContainText("Nytt: Öl");
  await expect(desk.getByTestId("party-new")).toContainText("Nytt: Drink");
  await expect(desk.getByTestId("party-total")).toHaveText("Kvällens summa: 100,00 kr");
  // Steg 41: kioskskärmen visar bara visningsnamnet (förnamn + efternamnets första bokstav).
  await expect(verdict).toContainText("Festa P");
  await expect(verdict).not.toContainText("Påhittsson");
  await reviewScreenshots(desk, "fest-bardisk-kop");

  // Samma bricka igen utan nya stämplingar: inga nya köp, samma summa.
  await desk.getByRole("button", { name: "Läs ut brickan" }).click();
  await expect(desk.getByTestId("party-headline")).toHaveText("Inga nya köp");
  await expect(desk.getByTestId("party-total")).toHaveText("Kvällens summa: 100,00 kr");
  await expect(verdict).toContainText("Tidigare i kväll");

  // Målstämpling: utcheckad med alla köp och summan.
  await desk.getByRole("button", { name: "Stämpla mål" }).click();
  await desk.getByRole("button", { name: "Läs ut brickan" }).click();
  await expect(desk.getByTestId("party-headline")).toHaveText(/^✓ Utcheckad \d\d:\d\d$/);
  await expect(desk.getByTestId("party-total")).toHaveText("Kvällens summa: 100,00 kr");
  await expect(desk.getByTestId("queue-status")).toHaveText("0 väntar", { timeout: 30_000 });

  // En ny okänd bricka: namnrutan föreslår kvällens gäster när man söker.
  await desk.getByRole("button", { name: "Ny gäst (okänd bricka)" }).click();
  await desk.getByRole("button", { name: "Läs ut brickan" }).click();
  await expect(desk.getByTestId("party-headline")).toHaveText("✓ Välkommen!");
  await expect.poll(async () => {
    await nameBox.getByLabel("Sök namn").fill("");
    await nameBox.getByLabel("Sök namn").fill("påhitt");
    return nameBox.getByText("Festa P", { exact: true }).count();
  }, { timeout: 20_000 }).toBeGreaterThan(0);
  await reviewScreenshots(desk, "fest-bardisk-namn");
  await nameBox.getByLabel("Förnamn").fill("Gäst");
  await nameBox.getByLabel("Efternamn").fill("Tvåsson");
  await nameBox.getByRole("button", { name: "Spara" }).click();
  await expect(nameBox).toHaveCount(0);
  await expect(desk.getByTestId("queue-status")).toHaveText("0 väntar", { timeout: 30_000 });

  // Arbetsytan: köpen, summa per person, in- och utcheckade och export.
  await owner.bringToFront();
  await expect(owner.getByTestId("party-totals")).toContainText("2 köp · 100,00 kr", { timeout: 20_000 });
  await expect(owner.getByTestId("party-totals")).toContainText("2 incheckade · 1 utcheckade");
  const festa = owner.locator("tr[data-card]").filter({ hasText: "Festa Påhittsson" });
  await expect(festa).toContainText("100,00");
  await expect(festa).toContainText("(mål)");
  await expect(owner.getByTestId("party-purchases")).toContainText("Drink");
  const download = owner.waitForEvent("download");
  await owner.getByRole("button", { name: "Ladda ner summering (CSV)" }).click();
  const file = await (await download).path();
  const csv = await readFile(file, "utf8");
  expect(csv.startsWith("\uFEFFNamn;Visningsnamn;Klubb;Bricka;Antal köp;Summa kr;Incheckad;Utcheckad;Utcheckad via")).toBe(true);
  expect(csv).toMatch(/Festa Påhittsson;Festa P;Påhittade OK;\d+;2;100,00;[^;]+;[^;]+;Mål/);

  // Ångra ett köp med orsak: summan räknas om.
  owner.once("dialog", dialog => void dialog.accept("Fel enhet"));
  await owner.getByRole("button", { name: /^Ångra Öl på bricka/ }).click();
  await expect(owner.getByTestId("party-totals")).toContainText("1 köp · 60,00 kr");
  await expect(owner.getByTestId("party-purchases")).toContainText("ångrat: Fel enhet");

  // Den publika fest-sidan: publicerad, statistik i webbläsaren, namn bara via JavaScript och stängd för robotar.
  await publishRaceViaApi(owner, raceId);
  const publicPath = await owner.getByRole("link", { name: "Visa den publika sidan" }).getAttribute("href");
  expect(publicPath).toMatch(/^\/fest\/[2-9a-hjkmnp-z]{6}$/);
  const code = publicPath!.split("/").at(-1)!;
  const visitor = await (await browser.newContext()).newPage();
  const hub = await visitor.request.get(`/t/${code}`, { maxRedirects: 0 });
  expect(hub.status()).toBe(307);
  expect(hub.headers().location).toBe(publicPath);
  const html = await visitor.request.get(publicPath!);
  expect(html.headers()["x-robots-tag"]).toBe("noindex, nofollow, noarchive, nosnippet, noai, noimageai");
  const body = await html.text();
  expect(body).toContain('<meta name="robots" content="noindex, nofollow, noarchive, nosnippet, noimageindex"/>');
  expect(body).not.toContain("Festa");
  expect(body).not.toContain("Tvåsson");
  const api = await visitor.request.get(`/api/public/parties/${raceId}`);
  expect(api.headers()["x-robots-tag"]).toBe("noindex, nofollow, noarchive, nosnippet, noai, noimageai");
  expect(api.headers()["cache-control"]).toBe("private, no-store");
  const json = await api.text();
  expect(json).toContain("Festa P");
  expect(json).not.toContain("Påhittsson");
  expect(json.replace(/\/api\/public\/parties\/[^"]+/, "")).not.toMatch(/cardNumber|priceOre|totalOre|raceId|[0-9a-f]{8}-[0-9a-f]{4}/);
  const logo = await visitor.request.get(`/api/public/parties/${raceId}/logo?v=1`);
  expect(logo.headers()["content-type"]).toBe("image/png");
  expect(logo.headers()["x-content-type-options"]).toBe("nosniff");
  const robots = await (await visitor.request.get("/robots.txt")).text();
  expect(robots).toContain("Disallow: /api/public/parties/");
  expect(robots).toContain("User-Agent: GPTBot");
  await visitor.goto(publicPath!);
  await expect(visitor.getByTestId("party-numbers")).toContainText("sålda");
  await expect(visitor.getByRole("heading", { name: "Vad säljer bäst" })).toBeVisible();
  await expect(visitor.getByTestId("party-public")).toContainText("Festa P");
  await expect(visitor.getByTestId("party-public")).not.toContainText("Påhittsson");
  await expect(visitor.getByTestId("party-public")).not.toContainText("kr");
  await reviewScreenshots(visitor, "fest-publik");

  // En vanlig tävlings publika sida har inga av fest-sidans huvuden.
  await owner.goto("/organizer");
  await createRace(owner, `Vanlig ${suffix}`, today(), "Träning");
  await publishRace(owner);
  const hubText = await owner.getByText(/\/t\/[2-9a-hjkmnp-z]{6}/).first().textContent();
  const racePath = /\/t\/[2-9a-hjkmnp-z]{6}/.exec(hubText ?? "")![0];
  const race = await visitor.request.get(racePath);
  expect(race.status()).toBe(200);
  expect(race.headers()["x-robots-tag"]).toBeUndefined();
  expect(await race.text()).not.toContain("noai");
});

