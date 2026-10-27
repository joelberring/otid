import { execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { expect, type Browser, type Page } from "@playwright/test";

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

/** Registrerar ett konto med e-post (ADR-0172) i en egen webbläsarkontext och landar i Mina tävlingar. */
export async function registerAccount(browser: Browser, email: string, displayName: string): Promise<Page> {
  const page = await (await newContext(browser)).newPage();
  await page.goto("/organizer");
  await page.getByRole("button", { name: "Har du inget konto? Skapa ett" }).click();
  await page.getByLabel("Ditt namn").fill(displayName);
  await page.getByLabel("E-postadress").fill(email);
  await page.getByLabel("Lösenord").fill(password);
  await page.getByRole("button", { name: "Skapa konto" }).click();
  await expect(page.getByRole("heading", { name: "Dina tävlingar" })).toBeVisible();
  return page;
}

/** Loggar in på /organizer med e-post och lösenord. */
export async function logIn(page: Page, email: string, secret = password): Promise<void> {
  await page.goto("/organizer");
  await page.getByLabel("E-postadress").fill(email);
  await page.getByLabel("Lösenord").fill(secret);
  await page.getByRole("button", { name: "Logga in" }).click();
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

/** Tävlingstyperna i "Skapa tävling" (ADR-0170 beslut 1). */
export type RaceTypeName = "Träning" | "Liten tävling" | "Tävling" | "Tävling med gafflade banor" | "Stafett" | "Rogaining" | "Fest";

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
export async function warmRoute(page: Page, path: string, method: "GET" | "POST" = "GET"): Promise<void> {
  await page.request.fetch(path, { method, failOnStatusCode: false, timeout: 120_000 });
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
export async function addPerson(owner: Page, email: string, role: "Funktionär" | "Administratör"): Promise<void> {
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
