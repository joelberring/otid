import { expect, test, type Page } from "@playwright/test";
import {
  addCourseAndClass, addEntry, daysFromToday, newContext, openStep, registerAccount, reviewScreenshots, sendReadout, today, unique, warmRoute
} from "./helpers";

/**
 * Steg 68 (ADR-0182): en träningsgrupp. Ledaren skapar gruppen under Mina tävlingar, lägger till en andra ledare, skapar en
 * upprepning (varje vecka i tre veckor), och den andra ledaren är administratör på tillfällena utan att läggas till. Gruppsidan
 * öppnas publikt med förnamn som standard; ändrat till fullt namn syns det. En extern karta med avtalet "inte publik visning"
 * sparas i kartbiblioteket och visar varningen där den väljs, och den publika kartbilden spärras.
 */
const fixtures = new URL("../../fixtures/", import.meta.url);

async function leaderSection(page: Page, name: string) {
  return page.getByRole("region", { name });
}

test("träningsgrupp: ledare, upprepning, gruppsidan med förnamn och kartans avtal", async ({ browser }) => {
  test.setTimeout(420_000);
  const suffix = unique();
  const leader = await registerAccount(browser, `ledare.${suffix}@exempel.se`, "Lena Ledare");
  const second = await registerAccount(browser, `ledare2.${suffix}@exempel.se`, "Leo Ledare");
  for (const path of ["/api/organizer/groups", "/organizer/groups/00000000-0000-4000-8000-000000000000"]) await warmRoute(leader, path);

  // Mina tävlingar → Mina grupper → Skapa grupp. Kortnamnet föreslås ur namnet.
  await leader.goto("/organizer");
  const groups = leader.getByRole("region", { name: "Mina grupper" });
  await expect(groups.getByText("Du är inte med i någon grupp än.")).toBeVisible();
  await groups.getByText("Ny grupp", { exact: true }).click();
  await groups.getByLabel("Gruppens namn").fill(`Ungdom OK ÄÖ ${suffix}`);
  await expect(groups.getByLabel("Kortnamn i länken")).toHaveValue(`ungdom-ok-ao-${suffix}`);
  await groups.getByRole("button", { name: "Skapa grupp" }).click();
  await leader.waitForURL(/\/organizer\/groups\/[0-9a-f-]+$/);
  // ADR-0189 beslut 8: servern lägger till en slumpad del i länken.
  const listed = await (await leader.request.get("/api/organizer/groups")).json() as { groups: { name: string; code: string }[] };
  const code = listed.groups.find(group => group.name === `Ungdom OK ÄÖ ${suffix}`)!.code;
  expect(code).toMatch(new RegExp(`^ungdom-ok-ao-${suffix}-[a-z2-9]{8}$`));
  await expect(leader.getByRole("heading", { name: `Ungdom OK ÄÖ ${suffix}`, level: 1 })).toBeVisible();

  // En andra ledare läggs till med e-post.
  const people = await leaderSection(leader, "Ledare och medlemmar");
  await people.getByLabel("E-postadress").fill(`ledare2.${suffix}@exempel.se`);
  await people.getByRole("button", { name: "Lägg till" }).click();
  // ADR-0189 beslut 9: adressen väntar på inloggning tills Leo öppnar O-Tid igen (samma svar med och utan konto).
  await expect(people.getByText("Ledare · väntar på inloggning")).toBeVisible();
  await second.goto("/organizer");

  // Upprepning: i dag och två veckor framåt, 18:00 (den första träningen i gruppen blir en tom träning).
  const form = await leaderSection(leader, "Ny träning");
  await form.getByLabel("Starttid").fill("18:00");
  await form.getByRole("checkbox", { name: "Upprepa varje vecka" }).check();
  await form.getByLabel("Till och med").fill(daysFromToday(14));
  await form.getByRole("button", { name: "Skapa 3 tillfällen" }).click();
  await expect(leader.getByRole("status").filter({ hasText: "3 tillfällen är skapade." })).toBeVisible();
  const upcoming = leader.getByRole("list", { name: "Kommande" });
  await expect(upcoming.getByRole("listitem")).toHaveCount(3);
  await expect(leader.getByRole("list", { name: "Upprepningar" })).toContainText("18:00");
  await reviewScreenshots(leader, "traningsgrupp-ledare");

  // Dagens tillfälle: en bana, en löpare med resultat och en kartbild.
  await upcoming.getByRole("link", { name: `Öppna: ${today()}` }).click();
  await leader.waitForURL(/\/admin\/[0-9a-f-]+\/manage$/);
  const raceId = leader.url().split("/").at(-2)!;
  await addCourseAndClass(leader, "Lång", "H12", "31 32 33");
  await addEntry(leader, { className: "H12", givenName: "Anna", familyName: "Andersson", club: "OK ÄÖ", card: "7410001" });
  const at = (time: string) => `${today()}T${time}.000Z`;
  await sendReadout(leader, raceId, { cardNumber: "7410001", startPunchedAt: at("16:00:00"), finishPunchedAt: at("16:31:00"),
    punches: [31, 32, 33].map((code, index) => ({ code, punchedAt: at(`16:${10 + index * 5}:00`) })) });
  // Utvecklingsservern kompilerar kartans routes vid första anropet (långsammare än arbetsytans gräns).
  for (const path of ["map", "map/image"]) await warmRoute(leader, `/api/admin/races/${raceId}/${path}`);
  await warmRoute(leader, `/api/organizer/races/${raceId}/map-agreement`);
  await leader.reload();
  await openStep(leader, "Resultat");
  const mapSection = leader.getByRole("region", { name: "Karta och vägval" });
  await mapSection.getByLabel("Kartbild (PNG eller JPEG, högst 30 MB)").setInputFiles(new URL("maps/strackanalys.png", fixtures).pathname);
  await mapSection.getByRole("button", { name: "Ladda upp karta" }).click();
  await expect(mapSection.getByText("Kartan är uppladdad.", { exact: false })).toBeVisible();

  // Den andra ledaren är administratör på tillfället via gruppen, utan att ha lagts till på det.
  await second.goto(`/admin/${raceId}/manage`);
  await expect(second.getByRole("heading", { name: `Ungdom OK ÄÖ ${suffix}` })).toBeVisible();

  // Gruppsidan publikt: förnamn som standard, aldrig indexerad.
  const visitor = await (await newContext(browser)).newPage();
  const response = await visitor.goto(`/g/${code}`);
  expect(response?.headers()["x-robots-tag"]).toContain("noindex");
  await expect(visitor.getByRole("heading", { name: `Ungdom OK ÄÖ ${suffix}`, level: 1 })).toBeVisible();
  await expect(visitor.getByText("Bara förnamn visas.")).toBeVisible();
  const results = visitor.getByTestId("group-results");
  await expect(results).toContainText("Anna");
  await expect(results).not.toContainText("Andersson");
  await expect(visitor.locator("meta[name=robots]")).toHaveAttribute("content", /noindex/);
  expect(await (await visitor.request.get("/robots.txt")).text()).toContain("Disallow: /g/");
  // Tävlingens egen resultatlista har samma namn.
  const ownList = await visitor.request.get(`/api/public/races/${raceId}/results`);
  expect(JSON.stringify(await ownList.json())).not.toContain("Andersson");
  await reviewScreenshots(visitor, "traningsgrupp-publik");

  // Ledaren ändrar till fullt namn; det syns på gruppsidan.
  await leader.goto("/organizer");
  await leader.getByRole("region", { name: "Mina grupper" }).getByRole("link", { name: "Öppna gruppen" }).click();
  await leader.waitForURL(/\/organizer\/groups\//);
  const settings = await leaderSection(leader, "Inställningar");
  await settings.getByRole("radio", { name: "Fullt namn" }).check();
  await settings.getByRole("button", { name: "Spara inställningarna" }).click();
  await expect(leader.getByRole("status").filter({ hasText: "Sparat." })).toBeVisible();
  await visitor.reload();
  await expect(visitor.getByTestId("group-results")).toContainText("Anna Andersson");
  await expect(visitor.getByText("Bara förnamn visas.")).toBeHidden();

  // Kartbiblioteket: dagens karta sparas som extern med avtalet "inte publik visning".
  const maps = await leaderSection(leader, "Kartbibliotek");
  await maps.getByText("Spara karta från ett tillfälle").click();
  await maps.getByRole("combobox", { name: "Tillfälle med karta" }).selectOption({ index: 0 });
  await maps.getByLabel("Kartans namn").fill("Älvsjöskogen");
  await maps.getByRole("radio", { name: "Extern" }).check();
  await maps.getByRole("combobox", { name: "Ägare", exact: true }).selectOption({ label: "Kommun" });
  await maps.getByLabel("Ägarens namn").fill("Stockholms stad");
  await maps.getByLabel("Avtal", { exact: true }).fill("Avtal 2026 med kommunen: bara klubbens träningar.");
  await maps.getByRole("checkbox", { name: "Inte publik visning" }).check();
  await maps.getByRole("button", { name: "Spara i biblioteket" }).click();
  await expect(maps.getByRole("listitem").filter({ hasText: "Älvsjöskogen" })).toContainText("Extern karta – Kommun: Stockholms stad");

  // Kartan väljs till en ny träning: avtalet och varningen syns där den väljs.
  const next = await leaderSection(leader, "Ny träning");
  await next.getByRole("combobox", { name: "Karta", exact: true }).selectOption({ label: "Älvsjöskogen" });
  const agreement = next.getByTestId("map-agreement");
  await expect(agreement).toContainText("Avtal 2026 med kommunen");
  await expect(agreement).toContainText("Avtalet tillåter inte publik visning");
  await reviewScreenshots(leader, "traningsgrupp-kartavtal");

  // Tillfället som kartan sparades från har nu avtalet: arbetsytan säger att kartan inte visas publikt (spärren själv
  // prövas i integrationstestet med en georefererad karta).
  await leader.goto(`/admin/${raceId}/manage`);
  await openStep(leader, "Resultat");
  await expect(leader.getByTestId("race-map-agreement")).toContainText("Kartan visas inte publikt");
});
