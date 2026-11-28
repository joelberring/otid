import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { expect, test, type Page } from "@playwright/test";
import { daysFromToday, registerAccount, reviewScreenshots, today, unique, warmRoute } from "./helpers";

/**
 * Steg F2 (ADR-0170 tillägg 2026-11-28): den täta raden i Mina kartprojekt och klubbarkivet. Hela raden är länken (ingen knapp
 * per rad), datumen som «tis 15 okt 2024», arkivet grupperat per månad och år med odaterade sist, sök först och filter på
 * begäran (i telefonen bakom «Filter»), valen i adressen, «Visa fler» efter 60 rader och sökningen över hela arkivet, minst fem
 * träningar på första skärmen i telefonen och ingen sidledsrullning. Lagringen står under Klubben. Kartan och banfilen är repots
 * påhittade.
 */
const fixture = (path: string) => readFileSync(fileURLToPath(new URL(`../../fixtures/${path}`, import.meta.url)));
const sha = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const MAP = fixture("maps/kartfil.omap");
const COURSE_DATA = fixture("iof/course-file-kartfil.xml");
const LONG = "Kartfil_med_ett_mycket_langt_namn_utan_mellanslag_2023_slutversion_v2";
const RECENT = 62;

async function csrfOf(page: Page): Promise<string> {
  return (await page.context().cookies()).find(row => /otid[-_]organizer[-_]csrf$/.test(row.name))?.value ?? "";
}

async function noSidewaysScroll(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(await page.evaluate(() => window.innerWidth));
}

type Entry = { title: string; date: string | null; tags?: string[]; map?: boolean };

async function importEntries(page: Page, clubId: string, token: string, entries: readonly Entry[]) {
  const headers = { authorization: `Bearer ${token}` };
  const content = await page.request.put(`/api/club-import/${clubId}/content/${sha(MAP)}`, { headers: { ...headers,
    "content-type": "application/octet-stream" }, data: MAP });
  expect(content.status(), await content.text()).toBe(200);
  const batch = await page.request.post(`/api/club-import/${clubId}/batch`, { headers, data: { formatVersion: 1,
    maps: [{ importKey: "kartfil", name: "Kartfil", versions: [{ sha256: sha(MAP), fileName: "Kartfil.omap", format: "OMAP", versionDate: "2021-03-01",
      sourcePath: null }] }],
    entries: entries.map((entry, index) => ({ importKey: `rad-${index}`, trainingDate: entry.date, year: entry.date ? Number(entry.date.slice(0, 4)) : null,
      place: "Skogen", title: entry.title, leader: "Lena Ledare", tags: entry.tags ?? [], sourcePath: `rad-${index}`,
      mapSha256: entry.map === false ? [] : [sha(MAP)],
      courseFiles: [{ fileName: "Banor.xml", kind: "COURSE_DATA", sha256: sha(COURSE_DATA), contentBase64: COURSE_DATA.toString("base64"),
        mapReference: null, mapSha256: entry.map === false ? null : sha(MAP), resolution: entry.map === false ? "MISSING" : "FOLDER" }] })) } });
  expect(batch.status(), await batch.text()).toBe(200);
}

test("täta rader: Mina kartprojekt och klubbarkivet, datorn och telefonen", async ({ browser, baseURL }) => {
  test.setTimeout(600_000);
  const suffix = unique();
  const owner = await registerAccount(browser, `rader.${suffix}@exempel.se`, "Rut Rad");
  const none = "00000000-0000-4000-8000-000000000000";
  for (const path of ["/api/organizer/clubs", `/organizer/clubs/${none}`, "/organizer/map-projects", "/api/organizer/map-projects"]) {
    await warmRoute(owner, path);
  }
  await warmRoute(owner, "/api/organizer/map-projects/upload", "POST");
  await owner.setViewportSize({ width: 1280, height: 900 });

  // Mina kartprojekt: två egna projekt, ett med filnamn som namn (utan mellanslag).
  for (const [name, file] of [[LONG, `${LONG}.omap`], [`Skogen ${suffix}`, "Skogen gammal.omap"]] as const) {
    const created = await owner.request.post("/api/organizer/map-projects/upload", { headers: { origin: baseURL!, "x-otid-csrf": await csrfOf(owner),
      "content-type": "application/octet-stream", "x-otid-request-id": crypto.randomUUID(), "x-otid-name": encodeURIComponent(name),
      "x-otid-file-name": encodeURIComponent(file) }, data: MAP });
    expect(created.status(), await created.text()).toBeLessThan(300);
  }
  await owner.goto("/organizer/map-projects");
  const projects = owner.getByTestId("map-projects");
  const rows = projects.getByRole("listitem");
  await expect(rows).toHaveCount(2);
  // Hela raden är länken, ingen knapp: namnet, «eget», «i dag», och filnamnet bara när det skiljer sig från namnet.
  const skogen = rows.filter({ hasText: `Skogen ${suffix}` });
  await expect(skogen.getByRole("link")).toHaveAttribute("href", /\/organizer\/map-projects\/[0-9a-f-]+$/);
  await expect(skogen.getByRole("button")).toHaveCount(0);
  await expect(skogen).toContainText(`eget · i dag · Skogen gammal.omap`);
  await expect(skogen).not.toContainText("Ägare");
  await expect(rows.filter({ hasText: LONG })).not.toContainText(`${LONG}.omap`);
  await expect(owner.getByTestId("map-projects-search")).toBeVisible();
  await expect(owner.getByTestId("map-projects-new")).toHaveText("Nytt kartprojekt");
  // Det långa namnet bryts och kapas till högst två rader i datorn och en rad i telefonen.
  const title = rows.filter({ hasText: LONG }).getByRole("link").locator("span").nth(1);
  expect((await title.boundingBox())!.height).toBeLessThanOrEqual(2 * 17 * 1.25 + 2);
  await reviewScreenshots(owner, "f2-kartprojekt", [1440, 900, 390, 360]);
  for (const width of [390, 360]) {
    await owner.setViewportSize({ width, height: 844 });
    await noSidewaysScroll(owner);
    expect((await title.boundingBox())!.height).toBeLessThanOrEqual(16 * 1.25 + 2);
    expect((await rows.first().boundingBox())!.height).toBeLessThanOrEqual(56);
  }
  await owner.setViewportSize({ width: 1280, height: 900 });

  // Klubben och arkivet: 62 träningar de senaste månaderna, två 2024, en 2019, en med långt namn, en utan karta och en odaterad.
  await owner.goto("/organizer");
  const clubs = owner.getByRole("region", { name: "Mina klubbar" });
  await clubs.getByRole("button", { name: "Ny klubbyta" }).click();
  await clubs.getByLabel("Klubbens namn").fill(`OK Rad ${suffix}`);
  await clubs.getByRole("button", { name: "Skapa klubben" }).click();
  await owner.waitForURL(/\/organizer\/clubs\/[0-9a-f-]+$/);
  const clubId = /clubs\/([0-9a-f-]+)$/.exec(owner.url())![1]!;
  await owner.getByRole("tab", { name: "Import" }).click();
  await owner.getByText("För den som kan Git: kommandoraden").click();
  await owner.getByRole("button", { name: "Skapa importnyckel" }).click();
  const token = (await owner.getByTestId("import-token").textContent())!.trim();
  const words = ["natt", "sprint", "intervall", "KepsOL", "kurvbild", "stafett", "ungdom", "veteran", "teknik"];
  const entries: Entry[] = [
    ...Array.from({ length: RECENT }, (_, index) => ({ title: `Träning ${index + 1}`, date: daysFromToday(-3 * index),
      tags: index < words.length ? [words[index]!] : [] })),
    { title: "Höstnatt", date: "2024-10-15", tags: ["natt"] }, { title: "Vårsprint utan karta", date: "2024-03-01", map: false },
    { title: LONG, date: "2023-05-05" }, { title: "Gammal träning", date: "2019-04-02" }, { title: "Okänt datum", date: null }];
  await importEntries(owner, clubId, token, entries);
  await owner.goto(`/organizer/clubs/${clubId}`);
  await owner.getByTestId("club-start").getByRole("button", { name: "Dölj Kom igång" }).click();

  const list = owner.getByTestId("archive-entries");
  const items = list.getByRole("listitem");
  await expect(owner.getByTestId("archive-search")).toHaveAttribute("placeholder", `Sök bland ${entries.length} träningar`);
  await expect(owner.getByTestId("club-usage")).toHaveText(`1 karta · ${entries.length} träningar`);
  // Lagringen står under Klubben, inte på Träningar.
  await expect(owner.getByTestId("club-storage")).toHaveCount(0);
  // De första 60 raderna och «Visa fler».
  await expect(items).toHaveCount(60);
  await expect(owner.getByTestId("archive-show-more")).toHaveText(`Visa fler (${entries.length - 60} till)`);
  // Raden är en länk utan knappar; datumet i brickan och i klartext för skärmläsare.
  const first = items.first();
  await expect(first.getByRole("link")).toHaveAttribute("href", new RegExp(`/organizer/clubs/${clubId}/arkiv/[0-9a-f-]+$`));
  await expect(first.getByRole("button")).toHaveCount(0);
  await expect(first.locator("time")).toHaveAttribute("datetime", today());
  // Gruppernas rubriker: månaden i år, år för äldre, «Utan datum» sist.
  const month = new Intl.DateTimeFormat("sv-SE", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${today()}T12:00:00Z`));
  await expect(list.getByRole("heading").first()).toHaveText(`${month.charAt(0).toUpperCase()}${month.slice(1)}`);
  await expect(owner.getByRole("heading", { name: "Inlagd av" })).toHaveCount(0);
  await expect(first).not.toContainText("Inlagd av");

  // Sökningen gäller hela arkivet: den äldsta träningen syns inte bland de 60 första men hittas.
  await expect(items.filter({ hasText: "Gammal träning" })).toHaveCount(0);
  await owner.getByLabel("Sök", { exact: true }).fill("gammal");
  await expect(items).toHaveCount(1);
  await expect(items.first().locator("time")).toHaveAttribute("datetime", "2019-04-02");
  await expect(items.first()).toContainText("tisdag 2 april 2019");
  await expect(list.getByRole("heading", { name: "2019" })).toBeVisible();
  await owner.getByRole("button", { name: "Rensa" }).click();
  await owner.getByTestId("archive-show-more").click();
  await expect(items).toHaveCount(entries.length);
  await expect(list.getByRole("heading").last()).toHaveText("Utan datum");
  await expect(items.last()).toContainText("Okänt datum");
  await expect(items.last().getByTestId("date-tile")).toContainText("–");
  // Bara det som saknas syns till höger: «Karta saknas» med en symbol.
  await expect(items.filter({ hasText: "Vårsprint utan karta" }).getByTestId("archive-entry-status")).toHaveText("! Karta saknas");
  await expect(items.filter({ hasText: "Höstnatt" }).getByTestId("archive-entry-status")).toHaveCount(0);
  await expect(list.getByText("Karta och banor")).toHaveCount(0);
  // Utan filter står varken antalet eller Rensa (sökrutan säger antalet).
  await expect(owner.getByRole("button", { name: "Rensa" })).toHaveCount(0);
  // Bilderna ritas i bakgrunden (ADR-0196); rader utan bild behåller bildens plats tom.
  await expect(items.getByTestId("entry-thumbnail").first()).toBeVisible({ timeout: 180_000 });
  await reviewScreenshots(owner, "f2-arkivet", [1440, 900, 390, 360]);

  // Datorn: År och Karta bredvid sökrutan, resten under «Fler filter». Egna ord och valen i adressen; Bakåt behåller dem.
  await expect(owner.getByLabel("År")).toBeVisible();
  await expect(owner.getByLabel("Ledare")).toBeHidden();
  await owner.getByRole("button", { name: "Fler filter" }).click();
  await expect(owner.getByLabel("Ledare")).toBeVisible();
  await reviewScreenshots(owner, "f2-arkivet-fler-filter", [1440]);
  await owner.getByRole("button", { name: "Fler filter" }).click();
  await owner.getByTestId("archive-tags").getByRole("button", { name: "natt" }).click();
  await expect(items).toHaveCount(2);
  await expect(owner).toHaveURL(/\?ord=natt#trainings|\?ord=natt$/);
  await items.filter({ hasText: "Höstnatt" }).getByRole("link").click();
  await owner.waitForURL(/\/arkiv\/[0-9a-f-]+$/);
  await expect(owner.getByRole("main")).toContainText("Lena Ledare");
  await owner.goBack();
  await expect(owner.getByTestId("archive-tags").getByRole("button", { name: "natt" })).toHaveAttribute("aria-pressed", "true");
  await expect(items).toHaveCount(2);
  await owner.getByRole("button", { name: "Rensa" }).click();

  // Fliken Klubben har lagringen; den valda fliken har banlila linje.
  await owner.getByRole("tab", { name: "Klubben" }).click();
  await expect(owner.getByTestId("club-storage")).toBeVisible();
  await reviewScreenshots(owner, "f2-klubben", [1440, 390]);
  expect(await owner.getByRole("tab", { name: "Klubben" }).evaluate(tab => getComputedStyle(tab).borderBottomWidth)).toBe("3px");
  await owner.getByRole("tab", { name: "Träningar" }).click();

  // Telefonen: sökrutan och en knapp Filter, som fäller ut alla val; minst fem träningar på första skärmen; ingen sidledsrullning.
  await owner.setViewportSize({ width: 390, height: 844 });
  await owner.reload();
  await expect(items.first()).toBeVisible();
  await expect(owner.getByRole("button", { name: "Fler filter" })).toBeHidden();
  await expect(owner.getByLabel("År")).toBeHidden();
  // Flikraden nertill täcker de sista 60 px: raden ska synas ovanför den.
  const visibleBottom = (await owner.getByTestId("app-tabs").boundingBox())!.y;
  const fifth = await items.nth(4).boundingBox();
  expect(fifth!.y + fifth!.height).toBeLessThanOrEqual(visibleBottom);
  for (const index of [0, 1, 2]) expect((await items.nth(index).boundingBox())!.height).toBeLessThanOrEqual(56);
  await noSidewaysScroll(owner);
  await owner.getByRole("button", { name: "Filter", exact: true }).click();
  await expect(owner.getByLabel("År")).toBeVisible();
  await expect(owner.getByLabel("Ledare")).toBeVisible();
  await owner.getByLabel("År").selectOption("2024");
  await expect(items).toHaveCount(2);
  await expect(owner.getByRole("button", { name: "Filter (1)" })).toBeVisible();
  await noSidewaysScroll(owner);
  await reviewScreenshots(owner, "f2-arkivet-filter-telefon", [390]);
  await owner.setViewportSize({ width: 390, height: 844 });
  await owner.getByRole("button", { name: "Rensa" }).click();
  await owner.setViewportSize({ width: 360, height: 640 });
  await noSidewaysScroll(owner);

  // Engelska i 390 px.
  await owner.context().addCookies([{ name: "otid-lang", value: "en", url: baseURL! }]);
  await owner.setViewportSize({ width: 390, height: 844 });
  await owner.goto(`/organizer/clubs/${clubId}`);
  await expect(owner.getByTestId("archive-search")).toHaveAttribute("placeholder", `Search ${entries.length} trainings`);
  await expect(owner.getByRole("button", { name: "Filter", exact: true })).toBeVisible();
  await noSidewaysScroll(owner);
  await reviewScreenshots(owner, "f2-arkivet-en", [390]);
  await owner.goto("/organizer/map-projects");
  await expect(owner.getByTestId("map-projects").getByRole("listitem").first()).toContainText("own · today");
  await reviewScreenshots(owner, "f2-kartprojekt-en", [390]);
  await owner.context().clearCookies({ name: "otid-lang" });
});
