import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { expect, type Browser, type Locator, type Page } from "@playwright/test";
import { latestMailTo } from "./fake-smtp";

/** Gemensamma steg för webbläsartesterna (ADR-0168, ADR-0172). */
export const password = "hemligt-lösen-1";
export const unique = () => Math.random().toString(36).slice(2, 8);
const root = fileURLToPath(new URL("../../", import.meta.url));

/** Tävlingarnas tidszon i testerna. */
export const TIME_ZONE = "Europe/Stockholm";

/** Dagens datum (ÅÅÅÅ-MM-DD) i Stockholm. Testerna räknar alla tävlingsdatum härifrån, aldrig från ett fast datum. */
export function today(now = new Date(), timeZone = TIME_ZONE): string {
  return new Intl.DateTimeFormat("sv-SE", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

/**
 * Tidszonen för en tävling som pågår i dag med starter upp till en timme bakåt (radio, listor, sträckanalys,
 * tävlingsfunktioner). Normalt Stockholm. Mellan 23 och 02 i Stockholm skulle starterna eller testets egen körtid
 * hamna på en annan dag än tävlingsdagen; då körs tävlingen i New Yorks tid, där klockan är 17–21. Servern och
 * webbläsaren räknar allt i tävlingens tidszon, så ingen klocka behöver frysas (fungerar också mot driftmiljön i CI).
 */
export function ongoingRaceTimeZone(now = new Date()): string {
  const hour = Number(new Intl.DateTimeFormat("sv-SE", { timeZone: TIME_ZONE, hour: "2-digit", hourCycle: "h23" }).format(now));
  return hour >= 2 && hour < 23 ? TIME_ZONE : "America/New_York";
}

/**
 * Steg 58: en tävling som startade `backMinutes` minuter sedan. Tävlingsdagen är startens datum i tidszonen (efter
 * midnatt alltså i går) och `clock(offset)` är klockslaget `offset` minuter efter starten, som går över midnatt som på
 * riktigt. Testerna kör därmed samma väg oavsett klockslag, i stället för att undvika midnatt.
 */
export function raceStartedAgo(backMinutes: number, timeZone = TIME_ZONE, now = new Date()) {
  const start = new Date(Math.floor(now.getTime() / 60_000) * 60_000 - backMinutes * 60_000);
  const clock = (offset: number) => new Intl.DateTimeFormat("sv-SE", { timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
    .format(new Date(start.getTime() + offset * 60_000));
  return { start, date: today(start, timeZone), clock };
}

/**
 * Steg 58: väntar tills servern har tagit emot avläsningen som beskedet visar ("Sparad."). En avvisad avläsning syns som
 * avvisad och testet faller med det beskedet; ett "0 väntar" ensamt räcker inte innan sidan lämnas.
 */
export async function expectSaved(page: Page): Promise<void> {
  await expect(page.getByTestId("verdict-sync")).toHaveText("Sparad.", { timeout: 30_000 });
}

/** Brickan i övningsstationens alternativ under "Deltagare", som slutar med den: "Ada Ek · H21 · 8571001" ger "8571001". */
function cardOf(label: string): string {
  const card = label.split(" · ").at(-1) ?? "";
  if (!/^\d+$/.test(card)) throw new Error(`Alternativet "${label}" slutar inte med en bricka`);
  return card;
}

/**
 * Väntar på beskedet för just brickan `card` ("Bricka 8571001 · Ada Ek · H21") och sedan på `status` ("GODKÄND"). Förra
 * brickans "GODKÄND" och "Sparad." står kvar tills den nya brickan är avläst; ett test som bara väntar på dem går vidare
 * medan brickan läses, och nästa bricka (eller att sidan lämnas) tar ur den mitt i avläsningen. Läses samma bricka två
 * gånger i rad med samma besked skiljer beskedet inte dem åt; vänta då på något annat (till exempel listan Senaste).
 */
async function expectVerdictFor(page: Page, card: string, status?: string): Promise<void> {
  const verdict = page.getByTestId("verdict");
  await expect(verdict).toContainText(new RegExp(`Bricka ${card}(?!\\d)`), { timeout: 30_000 });
  if (status) await expect(verdict).toContainText(status);
}

const EXERCISE_STATUS: Record<string, string> = { "Läs av: rätt stämplat": "GODKÄND", "Läs av: missad kontroll": "FELSTÄMPLAD" };

/**
 * Övningsstationen (startad): väljer deltagaren (alternativets text, eller ett mönster för det första som passar), trycker
 * på knappen och väntar på beskedet för den brickan (`expectVerdictFor`). `status` är beskedet som väntas (förval efter
 * knappen: GODKÄND eller FELSTÄMPLAD; null kontrollerar inget). Med `saved` (förval) väntar den också tills servern har
 * tagit emot avläsningen (`expectSaved`); utan nät sätts den till false. Ger alternativets text.
 */
export async function readExercise(page: Page, runner: string | RegExp, options: { button?: string; status?: string | null;
  saved?: boolean } = {}): Promise<string> {
  const select = page.getByLabel("Deltagare");
  const label = typeof runner === "string" ? runner : (await select.locator("option").filter({ hasText: runner }).first().textContent()) ?? "";
  const button = options.button ?? "Läs av: rätt stämplat";
  await select.selectOption({ label });
  await page.getByRole("button", { name: button }).click();
  await expectVerdictFor(page, cardOf(label), options.status === null ? undefined : options.status ?? EXERCISE_STATUS[button]);
  if (options.saved ?? true) await expectSaved(page);
  return label;
}

/** Datumet `days` dagar från i dag (negativt bakåt), ÅÅÅÅ-MM-DD i Stockholm. */
export function daysFromToday(days: number, now = new Date()): string {
  const [year, month, day] = today(now).split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}

/**
 * Steg 58: en ny webbläsarkontext. Med E2E_FAKE_CLOCK satt får sidan testkörningens klocka (Playwrights klocka, som går
 * vidare i vanlig takt), så att webbläsaren, servern och databasen har samma falska tid när testerna körs vid ett visst
 * klockslag (libfaketime för Node och PostgreSQL; webbläsaren tål inte libfaketime). Utan variabeln är det en vanlig kontext.
 */
export async function newContext(browser: Browser) {
  const context = await browser.newContext();
  if (process.env.E2E_FAKE_CLOCK) await context.clock.install({ time: Date.now() });
  // Steg 58: E2E_CPU_THROTTLE=6 gör webbläsaren sex gånger långsammare, som en belastad CI-maskin.
  const throttle = Number(process.env.E2E_CPU_THROTTLE ?? 0);
  if (throttle > 1) context.on("page", page => { void context.newCDPSession(page).then(cdp => cdp.send("Emulation.setCPUThrottlingRate", { rate: throttle })); });
  return context;
}

/**
 * Registrerar ett konto med e-post (ADR-0172) i en egen webbläsarkontext och landar i Mina tävlingar. ADR-0186: servern i
 * testerna har e-post, så kontot bekräftas med länken i mejlet (den falska SMTP-servern) och lösenordet.
 */
export async function registerAccount(browser: Browser, email: string, displayName: string): Promise<Page> {
  const page = await (await newContext(browser)).newPage();
  await page.goto("/organizer");
  await page.getByRole("button", { name: "Har du inget konto? Skapa ett" }).click();
  await page.getByLabel("Ditt namn").fill(displayName);
  await page.getByLabel("E-postadress").fill(email);
  await page.getByLabel("Lösenord", { exact: true }).fill(password);
  await page.getByLabel("Upprepa lösenordet", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Skapa konto" }).click();
  await expect(page.getByText("Vi har skickat ett mejl till")).toBeVisible();
  await verifyEmail(page, email);
  return page;
}

/** ADR-0186: länken i det senaste bekräftelsemejlet till adressen (väntar tills mejlet har kommit). */
export async function verificationLink(email: string): Promise<string> {
  let link: string | undefined;
  await expect.poll(() => {
    const pattern = /https?:\/\/\S+\/verify#token=[A-Za-z0-9_-]{43}/;
    link = pattern.exec(latestMailTo(email, pattern)?.text ?? "")?.[0];
    return link;
  }, { timeout: 20_000 }).toBeTruthy();
  return link!;
}

/** ADR-0205: länken i det senaste återställningsmejlet till adressen (väntar tills mejlet har kommit). */
export async function resetLink(email: string): Promise<string> {
  let link: string | undefined;
  await expect.poll(() => {
    const pattern = /https?:\/\/\S+\/recover#token=[A-Za-z0-9_-]{43}/;
    link = pattern.exec(latestMailTo(email, pattern)?.text ?? "")?.[0];
    return link;
  }, { timeout: 20_000 }).toBeTruthy();
  return link!;
}

/** ADR-0205: "Lösenord" och "Upprepa lösenordet" (registrering, bekräftelse och återställning). */
export async function fillNewPassword(page: Page, secret: string, label = "Lösenord"): Promise<void> {
  await page.getByLabel(label, { exact: true }).fill(secret);
  await page.getByLabel("Upprepa lösenordet", { exact: true }).fill(secret);
}

/**
 * ADR-0186, ändrat av ADR-0205: öppnar bekräftelselänken och väljer lösenordet (två gånger); kontot är sedan bekräftat och
 * inloggat.
 */
export async function verifyEmail(page: Page, email: string, secret = password): Promise<void> {
  await page.goto(await verificationLink(email));
  await fillNewPassword(page, secret);
  await page.getByRole("button", { name: "Bekräfta och logga in" }).click();
  await expect(page.getByRole("heading", { name: "Dina tävlingar" })).toBeVisible();
}

/** Loggar in på /organizer med e-post och lösenord. */
export async function logIn(page: Page, email: string, secret = password): Promise<void> {
  await page.goto("/organizer");
  await page.getByLabel("E-postadress").fill(email);
  await page.getByLabel("Lösenord", { exact: true }).fill(secret);
  await page.getByRole("button", { name: "Logga in", exact: true }).click();
}

/**
 * Ger kontot superadmin med samma serverkommando som i drift (ADR-0172): mot driftmiljön i webbens
 * avbildning (`node superadmin.mjs`), annars `pnpm account:superadmin` mot testdatabasen.
 */
export function grantSuperadmin(email: string): void {
  if (process.env.E2E_BASE_URL) {
    execFileSync("docker", ["compose", "-f", "docker-compose.prod.yml", "exec", "-T", "web", "node", "superadmin.mjs", "grant", email,
      "Webbläsartest"], { cwd: root, stdio: "pipe" });
    return;
  }
  const database = process.env.E2E_DATABASE_URL;
  if (!database) throw new Error("E2E_DATABASE_URL saknas");
  execFileSync("pnpm", ["-s", "account:superadmin", "grant", email, "Webbläsartest"], { cwd: root, stdio: "pipe",
    env: { ...process.env, DATABASE_URL: database } });
}

/**
 * ADR-0209: klubblistan ur en fil med samma serverkommando som i drift (`clubs import -`, filen på stdin), mot driftmiljön i
 * webbens avbildning eller `pnpm account:superadmin` mot testdatabasen.
 */
export function importClubDirectory(file: string): void {
  clubsCommand(["import", "-"], readFileSync(new URL(`../../fixtures/eventor/${file}`, import.meta.url)));
}

/** ADR-0209: `clubs unlink <eventor-id>` – klubben fri att kopplas igen (en tidigare körning av testet kan ha kopplat den). */
export function unlinkClub(eventorId: string): void {
  clubsCommand(["unlink", eventorId]);
}

function clubsCommand(args: readonly string[], input?: Buffer): void {
  const options = { cwd: root, stdio: ["pipe", "pipe", "pipe"] as ("pipe")[], ...(input ? { input } : {}) };
  if (process.env.E2E_BASE_URL) {
    execFileSync("docker", ["compose", "-f", "docker-compose.prod.yml", "exec", "-T", "web", "node", "superadmin.mjs", "clubs", ...args], options);
    return;
  }
  const database = process.env.E2E_DATABASE_URL;
  if (!database) throw new Error("E2E_DATABASE_URL saknas");
  execFileSync("pnpm", ["-s", "account:superadmin", "clubs", ...args], { ...options, env: { ...process.env, DATABASE_URL: database } });
}

/** Tävlingstyperna i "Skapa tävling" (ADR-0170 beslut 1). */
/** ADR-0188 beslut 5: "Tävling med gafflade banor" är en del av Tävling (gaffling följer av banorna). */
export type RaceTypeName = "Träning" | "Liten tävling" | "Tävling" | "Stafett" | "Rogaining" | "Fest";

/**
 * Skapar tävling av vald typ (som standard i dag, tävlingsdagen, i Stockholms tid). "Skapa tävling" leder direkt in i den nya
 * tävlingens arbetsyta (PLAN.md steg 24). Returnerar loppets id.
 */
export async function createRace(owner: Page, eventName: string, date = today(), type: RaceTypeName = "Tävling",
  timeZone = TIME_ZONE): Promise<string> {
  await owner.getByLabel("Tävlingens namn").fill(eventName);
  await owner.getByLabel("Etapp/lopp (valfritt)").fill("Torsdag");
  await owner.getByLabel("Datum").fill(date);
  await owner.getByRole("radio", { name: type, exact: true }).check();
  if (timeZone !== TIME_ZONE) {
    const form = owner.locator("form").filter({ has: owner.getByRole("button", { name: "Skapa tävling" }) });
    await form.locator("summary", { hasText: /^Mer$/ }).click();
    await form.getByLabel("Tidszon").fill(timeZone);
  }
  await owner.getByRole("button", { name: "Skapa tävling" }).last().click();
  await owner.waitForURL(/\/admin\/[0-9a-f-]+\/manage$/);
  await expect(owner.getByRole("heading", { name: eventName })).toBeVisible();
  return owner.url().split("/").at(-2)!;
}

/**
 * Steget Publicera i arbetsytan (ADR-0172 beslut 4): en ny tävling syns inte för besökare förrän den är publicerad.
 * Arbetsytan måste vara öppen som administratör.
 */
export async function publishRace(owner: Page): Promise<void> {
  await openStep(owner, "Publicera");
  await owner.getByRole("button", { name: "Publicera tävlingen" }).click();
  await expect(owner.getByText("Tävlingen är publicerad.")).toBeVisible();
  await expect(sectionButton(owner, "Publicera")).toHaveAccessibleDescription("Publicerad");
}

/** Publicerar en tävling utan arbetsytan: anropar med kontots session samma API som steget Publicera. */
export async function publishRaceViaApi(page: Page, raceId: string): Promise<void> {
  const origin = new URL(page.url()).origin;
  const cookie = async (pattern: RegExp) => (await page.context().cookies()).find(row => pattern.test(row.name))?.value ?? "";
  const published = await page.request.put(`/api/admin/races/${raceId}/administrator/race-publication`, {
    headers: { origin, "x-otid-csrf": await cookie(/otid[-_]organizer[-_]csrf$/) } });
  expect(published.status()).toBe(200);
}

/**
 * Utvecklingsservern kompilerar en route vid första anropet, ibland långsammare än arbetsytans gräns på 15 s.
 * Ett anrop i förväg (svaret spelar ingen roll) gör att flödet sedan mäter appen, inte kompileringen.
 */
export async function warmRoute(page: Page, path: string, method: "GET" | "POST" | "PUT" = "GET"): Promise<void> {
  await page.request.fetch(path, { method, failOnStatusCode: false, timeout: 120_000 });
}

/**
 * Sidouppdraget i steg 66: en multipart-POST som utvecklingsservern inte leder till routen renderas av 404-sidan, som tar
 * den för en Server Action ("Failed to find Server Action") och svarar 404 med HTML. Kartfilens uppladdning väntar därför
 * tills en multipart-POST når routen (appens svar är JSON, här 401/403 eftersom anropet saknar CSRF).
 */
export async function warmUpload(page: Page, path: string): Promise<void> {
  const until = Date.now() + 90_000;
  for (;;) {
    const response = await page.request.post(path, { failOnStatusCode: false, timeout: 120_000,
      multipart: { file: { name: "tom.omap", mimeType: "application/octet-stream", buffer: Buffer.alloc(0) } } });
    if ((response.headers()["content-type"] ?? "").includes("application/json") || Date.now() > until) return;
    await page.waitForTimeout(2_000);
  }
}

/**
 * Steg 66: banläggningens routes kompileras i förväg i utvecklingsservern (annars tar första sparningen eller notisen
 * 10–20 s och sparstatusen hinner inte bli "Sparat"). Strömmen (`course-setting/events`) är öppen tills den stängs och
 * kompileras när editorn öppnar den.
 */
export async function warmCourseSetting(page: Page, raceId: string): Promise<void> {
  const admin = `/api/admin/races/${raceId}/administrator`;
  for (const path of ["course-setting", "map/source", "route-choice", "course-setting/notes", "course-setting/suggestions", "course-setting/inspections"]) {
    await warmRoute(page, `${admin}/${path}`);
  }
  for (const path of ["course-setting/import", "course-setting/edits", "course-setting/notes", "course-setting/transfer"]) await warmRoute(page, `${admin}/${path}`, "POST");
  await warmRoute(page, `${admin}/course-setting/inspections`, "PUT");
  await warmRoute(page, `/admin/${raceId}/course-setting`);
  await warmUpload(page, `${admin}/map/source`);
}

/**
 * Banläggningens karta står still: ritad skarpt för vyn som visas (`data-drawn`), och vyn (läge och skala) och rutan på
 * sidan är desamma två bildrutor i rad. Används efter "Visa hela kartan", en ny bana eller att kartan blivit klar, innan
 * testet räknar ut var en kontroll ligger på skärmen (i stället för att vänta en fast tid).
 */
export async function mapSettled(map: Locator): Promise<void> {
  await expect(map).toHaveAttribute("data-drawn", "true", { timeout: 60_000 });
  await expect.poll(() => map.evaluate(element => {
    const state = () => {
      const box = element.getBoundingClientRect();
      return [box.x, box.y, box.width, box.height, element.getAttribute("data-center"), element.getAttribute("data-px-per-mm"),
        element.getAttribute("data-drawn")].join(";");
    };
    // En bildruta (eller 100 ms om sidan inte ritar, t.ex. i bakgrunden).
    const frame = () => new Promise<void>(resolve => { requestAnimationFrame(() => resolve()); setTimeout(resolve, 100); });
    const before = state();
    return frame().then(frame).then(() => state() === before && element.getAttribute("data-drawn") === "true");
  }), { timeout: 30_000 }).toBe(true);
}

/**
 * Banläggningen i telefonen (IndexedDB "otid-course-setting", steg 67 och ADR-0190): `waiting` är åtgärderna som väntar
 * i den sparade posten och kön, som "Utan nät – N ändringar väntar" räknar dem; `history` är ångra-historiken (antal
 * steg och de godtagna varningarna i dess dokument). Posten och historiken skrivs strax efter en ändring; vänta på dem
 * med `expect.poll` före en omladdning eller en stängd sida i stället för en fast tid.
 */
export async function courseSettingInPhone(page: Page, raceId: string): Promise<{ waiting: number;
  history: { past: number; future: number; acceptedChecks: string[] } | undefined }> {
  return page.evaluate(async id => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const open = indexedDB.open("otid-course-setting");
      open.onsuccess = () => resolve(open.result);
      open.onerror = () => reject(new Error(open.error?.message ?? "IndexedDB"));
    });
    const ask = <T,>(request: IDBRequest) => new Promise<T>((resolve, reject) => {
      request.onsuccess = () => resolve(request.result as T);
      request.onerror = () => reject(new Error(request.error?.message ?? "IndexedDB"));
    });
    try {
      const has = (name: string) => db.objectStoreNames.contains(name);
      const record = has("record") ? await ask<{ log?: unknown[] } | undefined>(db.transaction("record").objectStore("record").get(id)) : undefined;
      const queued = has("queue") ? await ask<number>(db.transaction("queue").objectStore("queue").index("raceId").count(id)) : 0;
      const history = has("history") ? await ask<{ past: unknown[]; future: unknown[];
        document?: { event?: { acceptedChecks?: Record<string, unknown> } } } | undefined>(db.transaction("history").objectStore("history").get(id)) : undefined;
      return { waiting: (record?.log?.length ?? 0) + queued, history: history ? { past: history.past.length, future: history.future.length,
        acceptedChecks: Object.keys(history.document?.event?.acceptedChecks ?? {}) } : undefined };
    } finally { db.close(); }
  }, raceId);
}

/** Delarna i sidopanelen; vilka som finns avgörs av tävlingstypen (ADR-0170). */
export type SectionName = "Banor" | "Banor & klasser" | "Kontroller & poäng" | "Klasser" | "Klasser & sträckor" | "Anmälda" | "Deltagare" |
  "Lag" | "Start" | "Publicera" | "Avläsning" | "Resultat" | "Fest" | "Inställningar";

/** En del i sidopanelen "Tävlingens delar". Delens status är knappens beskrivning. */
export function sectionButton(page: Page, name: SectionName) {
  return page.getByRole("navigation", { name: "Tävlingens delar" }).getByRole("button", { name, exact: true });
}

export async function openStep(page: Page, name: SectionName): Promise<void> {
  await sectionButton(page, name).click();
  await expect(sectionButton(page, name)).toHaveAttribute("aria-current", "step");
}

/** Öppnar den första av delarna som tävlingstypen har (t.ex. "Banor" eller "Banor & klasser"). */
async function openFirst(page: Page, names: SectionName[]): Promise<void> {
  // Vänta tills sidopanelen visar någon av delarna (den ritas om när tävlingen läses in på nytt).
  await expect(names.map(name => sectionButton(page, name)).reduce((all, one) => all.or(one)).first()).toBeVisible();
  for (const name of names) {
    if (await sectionButton(page, name).count()) { await openStep(page, name); return; }
  }
  throw new Error(`Ingen av delarna ${names.join(", ")} finns`);
}

/** Formuläret "Ny bana" (PLAN.md steg 24): öppnas med knappen i tomläget eller i Banors rubrik. */
export async function openCourseForm(owner: Page) {
  const courseForm = owner.locator("form").filter({ has: owner.getByRole("button", { name: /^Spara bana( och klass)?$/ }) });
  if (!await courseForm.isVisible()) {
    await owner.getByRole("button", { name: "Ny bana" }).or(owner.getByRole("button", { name: "Lägg till kontroller och klass" })).first().click();
  }
  await expect(courseForm).toBeVisible();
  return courseForm;
}

/** Ny bana med klass sparas direkt, utan granskningssteg (inget resultat ändras). */
export async function addCourseAndClass(owner: Page, courseName: string, className: string, controls: string): Promise<void> {
  // Sparandet kompilerar rutten vid första anropet; ett anrop i förväg håller det under arbetsytans gräns på 15 s.
  const raceId = /\/admin\/([^/]+)\//.exec(owner.url())?.[1];
  if (raceId) await warmRoute(owner, `/api/admin/races/${raceId}/administrator/course-classes`, "POST");
  await openFirst(owner, ["Banor", "Banor & klasser", "Kontroller & poäng"]);
  const courseForm = await openCourseForm(owner);
  await courseForm.getByLabel("Bannamn").fill(courseName);
  await courseForm.getByLabel("Klassnamn").fill(className);
  await courseForm.getByLabel("Kontrollföljd").fill(controls);
  await courseForm.getByRole("button", { name: "Spara bana och klass" }).click();
  // Meddelandet kan stå kvar från förra banan; banan i tabellen visar att just den här är sparad.
  await expect(owner.getByRole("rowheader", { name: courseName, exact: true })
    .or(owner.getByRole("cell", { name: courseName, exact: true })).first()).toBeVisible({ timeout: 30_000 });
  await expect(owner.getByText("Banan och klassen är sparade.")).toBeVisible();
  await expect(courseForm.getByLabel("Bannamn")).toBeEnabled();
}

/** Formuläret "Ny deltagare" (PLAN.md steg 24). Står kvar mellan deltagarna; öppnas bara när det inte redan syns. */
export async function openEntryForm(owner: Page) {
  const entryForm = owner.locator("form").filter({ has: owner.getByRole("button", { name: "Lägg till", exact: true }) });
  if (!await entryForm.isVisible()) {
    await openFirst(owner, ["Anmälda", "Deltagare"]);
    await owner.getByRole("button", { name: "Ny deltagare" }).first().click();
  }
  await expect(entryForm).toBeVisible();
  return entryForm;
}

/** Ny deltagare i ett steg: fyll i och Lägg till. Raden under formuläret säger vem som anmäldes. */
export async function addEntry(owner: Page, entry: { className: string; givenName: string; familyName: string; club: string; card: string;
  startTime?: string }): Promise<void> {
  const entryForm = await openEntryForm(owner);
  await entryForm.getByRole("combobox", { name: "Klass" }).selectOption({ label: entry.className });
  await entryForm.getByLabel("Förnamn").fill(entry.givenName);
  await entryForm.getByRole("textbox", { name: "Efternamn" }).fill(entry.familyName);
  await entryForm.getByLabel("Klubb").fill(entry.club);
  await entryForm.getByLabel("Bricka (valfritt)").fill(entry.card);
  if (entry.startTime) await entryForm.getByLabel("Starttid (klockslag)").fill(entry.startTime);
  await entryForm.getByRole("button", { name: "Lägg till", exact: true }).click();
  await expect(entryForm.getByRole("status")).toContainText(`${entry.givenName} ${entry.familyName} är anmäld i ${entry.className}`);
}

/**
 * Inställningar → Personer med behörighet (ADR-0172 beslut 3): lägger till ett befintligt konto med e-post och roll.
 * Arbetsytan måste vara öppen som administratör.
 */
export async function addPerson(owner: Page, email: string, role: "Funktionär" | "Administratör" | "Banläggning: ändra" | "Banläggning: föreslå"
  | "Banläggning: läsa och kommentera" | "Kartritare: bara kartan och kartfelen"): Promise<void> {
  await openStep(owner, "Inställningar");
  const people = owner.getByRole("region", { name: "Personer med behörighet" });
  const form = people.getByRole("form", { name: "Lägg till person" });
  await form.getByLabel("E-postadress").fill(email);
  await form.getByLabel("Roll").selectOption({ label: role });
  await form.getByRole("button", { name: "Lägg till" }).click();
  await expect(people.getByRole("status")).toContainText(`som ${role.toLowerCase()}`);
  await expect(people.getByRole("list", { name: "Personer med behörighet" })).toContainText(email);
}

/** Skärmbilder för granskning när E2E_SCREENSHOT_DIR är satt: `<namn>-1280.png` och `<namn>-390.png`, hela sidan. */
export async function reviewScreenshots(page: Page, name: string, widths: readonly number[] = [1280, 390]): Promise<void> {
  const directory = process.env.E2E_SCREENSHOT_DIR;
  if (!directory) return;
  for (const width of widths) {
    await page.setViewportSize({ width, height: 900 });
    // Överst först: fasta rubriker hamnar annars mitt i en helsidesbild.
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({ path: `${directory}/${name}-${width}.png`, fullPage: true });
  }
  await page.setViewportSize({ width: 1280, height: 720 });
}

/**
 * Skickar en avläsning till tävlingen med kontots session, som avläsningssidan gör (PLAN.md steg 27): en SI9-bricka med
 * check, mål och stämplingar vid valfria tider, till exempel från ett tidigare lopp. Ramarna är påhittade.
 */
export async function sendReadout(page: Page, raceId: string, readout: { cardNumber: string; checkPunchedAt?: string;
  startPunchedAt?: string; finishPunchedAt?: string; punches: { code: number; punchedAt: string }[];
  /** Steg 36: en riktig avläsning med råramar (annars övningsstationens SI9 med en låtsasram). */
  cardType?: string; frames?: string[]; stationReceivedAt?: string }): Promise<void> {
  const origin = new URL(page.url()).origin;
  const csrf = (await page.context().cookies()).find(row => /otid[-_]organizer[-_]csrf$/.test(row.name))?.value ?? "";
  // Fälten i kontraktets ordning: servern räknar hashen över den tolkade nyttolasten.
  const payload = { cardNumber: readout.cardNumber, cardType: readout.cardType ?? "SI9",
    ...(readout.startPunchedAt ? { startPunchedAt: readout.startPunchedAt } : {}),
    ...(readout.finishPunchedAt ? { finishPunchedAt: readout.finishPunchedAt } : {}),
    ...(readout.checkPunchedAt ? { checkPunchedAt: readout.checkPunchedAt } : {}),
    punches: readout.punches, untimedPunchCodes: [], frames: readout.frames ?? ["02ef0100"],
    ...(readout.frames ? { clockSource: "device" } : {}), simulated: !readout.frames };
  const deviceId = randomUUID();
  const response = await page.request.post(`/api/admin/races/${raceId}/administrator/readouts`, {
    headers: { origin, "x-otid-csrf": csrf, "content-type": "application/json" },
    data: { deviceId, sessionId: deviceId, packageVersion: 1, firstSequence: 1, lastSequence: 1, events: [{ localSequence: 1,
      stationReceivedAt: readout.stationReceivedAt ?? new Date().toISOString(), transport: "sportident", payload,
      contentHash: createHash("sha256").update(JSON.stringify(payload)).digest("hex") }] } });
  expect(response.status()).toBe(200);
  expect(((await response.json()) as { acknowledgements: { status: string }[] }).acknowledgements[0]?.status).toBe("stored");
}

/**
 * Fel i webbläsaren på sidor som börjar med `path` (ADR-0211 tillägg): sidfel och `console.error` samlas, och `check()`
 * fäller testet med dem. Next.js dev-överlägg ("1 Issue") visar samma fel, så ett grönt test betyder ett tomt överlägg.
 */
export function browserErrors(page: Page, path: RegExp): { check: (what?: string) => void } {
  const errors: string[] = [];
  const here = () => { try { return path.test(new URL(page.url()).pathname); } catch { return false; } };
  page.on("pageerror", error => { if (here()) errors.push(`pageerror: ${error.message}`); });
  // "Failed to load resource" säger inte vilken; svaret med adressen tas med i stället.
  page.on("console", message => { if (message.type() === "error" && here() && !message.text().startsWith("Failed to load resource")) errors.push(`console: ${message.text()}`); });
  page.on("response", response => { if (response.status() >= 400 && here()) errors.push(`${response.status()} ${new URL(response.url()).pathname}`); });
  return { check: (what = "sidan") => expect(errors, `fel i webbläsaren på ${what}`).toEqual([]) };
}
