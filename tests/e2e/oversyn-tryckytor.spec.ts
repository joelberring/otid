import { expect, test, type Browser, type Page } from "@playwright/test";
import {
  addCourseAndClass, addEntry, createRace, openStep, publishRaceViaApi, registerAccount, sendReadout, today, unique, warmRoute,
  type SectionName
} from "./helpers";

/**
 * Översynen av användbarheten 2026-11-17 (C3): i telefonen (390 px, pekskärm) är allt man trycker på minst 44 × 44 px –
 * knappar, ikonknappar, länkar som fungerar som knappar, flikar, kryssrutor och alternativ med etikett och rader i menyer.
 * Textlänkar i löpande text räknas inte. Ingen sida blir bredare än skärmen.
 */
const MIN = 44;

type Small = { what: string; width: number; height: number };

/**
 * Alla synliga tryckytor på sidan som är mindre än 44 × 44 px. En kryssruta eller ett alternativ räknas med sin etikett
 * (etiketten tar emot trycket); en länk i löpande text (inline, med annan text runt sig) räknas inte.
 */
async function smallTargets(page: Page): Promise<Small[]> {
  return page.evaluate(min => {
    const selector = ["button", "a[href]", "summary", "select", "input:not([type=hidden])", "textarea", "[role=button]", "[role=tab]",
      "[role=menuitem]", "[role=option]", "[role=switch]", "[role=radio]", "[role=checkbox]", "[role=link]"].join(",");
    const visible = (element: Element) => {
      const style = getComputedStyle(element);
      if (style.visibility === "hidden" || style.display === "none" || Number(style.opacity) === 0) return false;
      if (element.closest("[aria-hidden=true], [inert]")) return false;
      // Innehållet i en stängd utfällbar ruta syns inte (rubriken gör det).
      const closed = element.closest("details:not([open])");
      if (closed && element.parentElement !== closed) return false;
      const box = element.getBoundingClientRect();
      return box.width > 2 && box.height > 2;
    };
    const inRunningText = (element: Element) => {
      if (element.tagName !== "A" || getComputedStyle(element).display !== "inline") return false;
      const parent = element.parentElement;
      if (!parent) return false;
      return (parent.textContent ?? "").trim().length > (element.textContent ?? "").trim().length + 2;
    };
    const describe = (element: Element) => {
      const name = element.getAttribute("aria-label") ?? (element as HTMLElement).innerText ?? element.getAttribute("title") ?? "";
      const id = element.getAttribute("data-testid");
      return `${element.tagName.toLowerCase()}${id ? `[${id}]` : ""} "${name.trim().replace(/\s+/g, " ").slice(0, 50)}"`;
    };
    const result: Small[] = [];
    const seen = new Set<Element>();
    for (const element of Array.from(document.querySelectorAll(selector))) {
      // En kryssruta eller ett fält i en etikett: etiketten är ytan man trycker på.
      const input = element as HTMLInputElement;
      const target = element.tagName === "INPUT" && (input.type === "checkbox" || input.type === "radio")
        ? (element.closest("label") ?? (input.id ? document.querySelector(`label[for="${CSS.escape(input.id)}"]`) : null) ?? element)
        : element;
      if (seen.has(target)) continue;
      seen.add(target);
      // Ett osynligt fält bakom en egen knapp (t.ex. ett dolt alternativ) mäts genom sin etikett.
      if (!visible(target) || inRunningText(target)) continue;
      const box = target.getBoundingClientRect();
      if (box.width + 0.5 < min || box.height + 0.5 < min) {
        result.push({ what: describe(target === element ? element : target), width: Math.round(box.width), height: Math.round(box.height) });
      }
    }
    return result;
  }, MIN);
}

/**
 * Undantag (det som får vara mindre): Next.js egna utvecklarknappar finns bara mot utvecklingsservern. Lägg till här bara det
 * som inte går att trycka fel på, med skälet.
 */
const EXCEPTIONS: RegExp[] = [/Next\.js Dev Tools|issues (overlay|badge)/];

/** Mäter sidan när den har ritats klart; samlar alla fel (soft) så att rapporten visar allt på en gång. */
async function check(page: Page, name: string): Promise<void> {
  // Sidor som frågar servern med jämna mellanrum blir aldrig helt tysta; vänta högst några sekunder.
  await page.waitForLoadState("networkidle", { timeout: 5_000 }).catch(() => undefined);
  const small = (await smallTargets(page)).filter(row => !EXCEPTIONS.some(pattern => pattern.test(row.what)));
  if (small.length) console.log(`\n== ${name}: ${small.length}\n${small.map(row => `  ${row.what} ${row.width}×${row.height}`).join("\n")}`);
  expect.soft(await page.evaluate(() => document.documentElement.scrollWidth), `${name}: sidans bredd`).toBeLessThanOrEqual(390);
  expect.soft(small, `${name}: tryckytor under 44 px`).toEqual([]);
}

async function phone(browser: Browser, storageState?: Awaited<ReturnType<ReturnType<Page["context"]>["storageState"]>>): Promise<Page> {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, locale: "sv-SE",
    ...(storageState ? { storageState } : {}) });
  return context.newPage();
}

test("översynen: tryckytor på minst 44 px i telefonen", async ({ browser }) => {
  test.setTimeout(420_000);
  const suffix = unique();
  const leader = await registerAccount(browser, `tryck.${suffix}@exempel.se`, "Tora Tryck");
  for (const path of ["/api/organizer/groups", "/organizer/groups/00000000-0000-4000-8000-000000000000"]) await warmRoute(leader, path);

  // En grupp med dagens träning: en bana, en deltagare med resultat, publicerad.
  await leader.goto("/organizer");
  const groups = leader.getByRole("region", { name: "Mina grupper" });
  await groups.getByRole("button", { name: "Ny grupp" }).click();
  await groups.getByLabel("Gruppens namn").fill(`Tryck ${suffix}`);
  await groups.getByRole("button", { name: "Skapa grupp" }).click();
  await leader.waitForURL(/\/organizer\/groups\/[0-9a-f-]+$/);
  const groupPath = new URL(leader.url()).pathname;
  const listed = await (await leader.request.get("/api/organizer/groups")).json() as { groups: { name: string; code: string }[] };
  const groupCode = listed.groups.find(group => group.name === `Tryck ${suffix}`)!.code;
  await leader.goto("/organizer");
  await createRace(leader, `Tryck ${suffix}`);
  const raceId = leader.url().split("/").at(-2)!;
  await addCourseAndClass(leader, "Lång", "H21", "31 32 33");
  await addEntry(leader, { className: "H21", givenName: "Anna", familyName: "Andersson", club: "OK Tryck", card: "7420001" });
  const at = (time: string) => `${today()}T${time}.000Z`;
  await sendReadout(leader, raceId, { cardNumber: "7420001", startPunchedAt: at("06:00:00"), finishPunchedAt: at("06:31:00"),
    punches: [31, 32, 33].map((code, index) => ({ code, punchedAt: at(`06:${10 + index * 5}:00`) })) });
  await publishRaceViaApi(leader, raceId);
  await openStep(leader, "Publicera");
  const hubPath = await leader.getByRole("link", { name: "Förhandsvisa tävlingssidan" }).getAttribute("href");

  // En klubbyta.
  await leader.goto("/organizer");
  const clubs = leader.getByRole("region", { name: "Mina klubbar" });
  await clubs.getByRole("button", { name: "Ny klubbyta" }).click();
  await clubs.getByLabel("Klubbens namn").fill(`OK Tryck ${suffix}`);
  await clubs.getByRole("button", { name: "Skapa klubben" }).click();
  await leader.waitForURL(/\/organizer\/clubs\/[0-9a-f-]+$/);
  const clubPath = new URL(leader.url()).pathname;

  // Arrangören i telefonen.
  const organiser = await phone(browser, await leader.context().storageState());
  await organiser.goto("/organizer");
  await check(organiser, "Mitt O-Tid");
  await organiser.goto("/konto");
  await check(organiser, "Kontot");
  await organiser.goto(groupPath);
  await check(organiser, "Träningsgruppen (ledaren)");
  await organiser.goto(clubPath);
  await check(organiser, "Klubbytan");
  await organiser.goto(`/admin/${raceId}/manage`);
  const steps: SectionName[] = ["Banor", "Klasser", "Anmälda", "Start", "Publicera", "Avläsning", "Resultat", "Personer", "Inställningar"];
  for (const step of steps) {
    if (!await organiser.getByRole("navigation", { name: "Tävlingens delar" }).getByRole("button", { name: step, exact: true }).count()) continue;
    await openStep(organiser, step);
    await check(organiser, `Arbetsytan: ${step}`);
  }

  // Deltagaren i telefonen, utan konto.
  const visitor = await phone(browser);
  await visitor.goto(hubPath!);
  await check(visitor, "Tävlingssidan");
  await visitor.goto(`/starts/${raceId}`);
  await check(visitor, "Startlistan");
  await visitor.goto(`/results/${raceId}`);
  await check(visitor, "Resultatlistan");
  // C4: förkortningen i klubbsammanställningen förklaras vid tryck (inte bara som verktygstips).
  await visitor.getByRole("button", { name: "Klubbar", exact: true }).click();
  const first = visitor.getByRole("button", { name: "1:a", exact: true });
  await expect(first).toHaveAttribute("aria-expanded", "false");
  await first.tap();
  await expect(first).toHaveAttribute("aria-expanded", "true");
  await expect(visitor.getByText("Ettor", { exact: true })).toBeVisible();
  await check(visitor, "Resultatlistan: klubbar");
  await visitor.goto(`/g/${groupCode}`);
  await check(visitor, "Gruppsidan");
  await visitor.goto("/");
  await check(visitor, "Startsidan");
  await visitor.goto("/om");
  await check(visitor, "Om O-Tid");
});
