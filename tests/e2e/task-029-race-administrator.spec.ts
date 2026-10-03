import { createHash, randomUUID } from "node:crypto";
import { test, expect, type Page, type Locator } from "@playwright/test";
import { createDatabase, schema } from "@o-tid/database";
import { ingestDeviceBatch, issuePairingAdminAccessCredential, loginPairingAdmin,
  listResultFinalizationCandidatesAsAdmin, finalizeResultsAsAdmin, correctAdministratorStart,
  previewClassStartDrawAsAdmin, commitClassStartDrawAsAdmin } from "@o-tid/application";
import { and, eq } from "drizzle-orm";

const database = process.env.TEST_DATABASE_URL;
if (!database || database !== process.env.DATABASE_URL) throw new Error("Explicit matching isolated database required");
const { db, pool } = createDatabase(database);
test.afterAll(async () => pool.end());

async function signIn(page: Page, accessCredential: string, mode = "Deltagare", subArea?: string) {
  await page.getByLabel("Administratörsbehörighet", { exact: true }).fill(accessCredential);
  await page.getByRole("button", { name: "Logga in", exact: true }).click();
  await page.getByRole("button", { name: mode, exact: true }).click();
  if (subArea) await page.getByRole("navigation", { name: mode === "Före tävlingen"
    ? "Tävlingsförberedelser" : "Tävlingsdagens arbetsytor", exact: true })
    .getByRole("button", { name: subArea, exact: true }).click();
}

async function chooseResultAction(page: Page, name: string) {
  const menu = page.locator("details").filter({
    has: page.locator("summary").filter({ hasText: "Resultatbeslut och historik" })
  });
  if (!(await menu.evaluate(element => (element as HTMLDetailsElement).open))) await menu.locator("summary").click();
  await menu.getByRole("button", { name, exact: true }).click();
}

test("TASK065/TASK066/TASK067/TASK068/TASK069/TASK070/TASK071/TASK072/TASK073/TASK074/TASK075/TASK076/TASK077/TASK079/TASK080 admin byter startupplägg och följer upp tid, resultat och hyrbricka", async ({ page }) => {
  const setup = await fixture();
  const inactiveRentalEntryId = randomUUID(), multipleAssignmentEntryId = randomUUID();
  await db.update(schema.entries).set({ fixedStartTime: new Date("2026-09-12T08:00:00.000Z") })
    .where(eq(schema.entries.id, setup.entryId));
  await db.insert(schema.entries).values([
    { id: inactiveRentalEntryId, raceId: setup.raceId, classId: setup.targetClassId,
      givenName: "Bertil", familyName: "Färsk", organisationName: "Test IF" },
    { id: multipleAssignmentEntryId, raceId: setup.raceId, classId: setup.targetClassId,
      givenName: "Reserv 00", familyName: "Zed", organisationName: "Test IF" },
    ...Array.from({ length: 24 }, (_, index) => ({ id: randomUUID(), raceId: setup.raceId, classId: setup.targetClassId,
      givenName: `Reserv ${String(index + 1).padStart(2, "0")}`, familyName: "Zed", organisationName: "Test IF" }))
  ]);
  await db.insert(schema.cardAssignments).values([
    { raceId: setup.raceId, entryId: inactiveRentalEntryId, cardNumber: "777777", active: false, isRental: true },
    { raceId: setup.raceId, entryId: multipleAssignmentEntryId, cardNumber: "888881", active: true, isRental: true },
    { raceId: setup.raceId, entryId: multipleAssignmentEntryId, cardNumber: "888882", active: true, isRental: false }
  ]);
  const resultPayload = { cardNumber: "123456", startPunchedAt: "2026-09-12T08:00:00Z", finishPunchedAt: "2026-09-12T08:20:00Z",
    punches: [{ code: 31, punchedAt: "2026-09-12T08:10:00Z" }] };
  const resultDeviceId = randomUUID();
  const resultIngest = await ingestDeviceBatch(db, setup.raceId, { deviceId: resultDeviceId, sessionId: resultDeviceId, packageVersion: 1,
    firstSequence: 1, lastSequence: 1, events: [{ localSequence: 1, stationReceivedAt: "2026-09-12T08:21:00Z",
      transport: "simulator", payload: resultPayload,
      contentHash: createHash("sha256").update(JSON.stringify(resultPayload)).digest("hex") }] });
  expect(resultIngest.acknowledgements[0]?.status).toBe("stored");
  await page.setViewportSize({ width: 1366, height: 768 });
  await page.goto(`/admin/${setup.raceId}/manage`);
  const managePage = page.locator("main.race-admin-manage-page");
  await expect(managePage).toHaveCSS("max-width", "1520px");
  await expect(page.getByRole("status")).toContainText("Behörighet saknas eller har gått ut.");
  await page.getByLabel("Administratörsbehörighet", { exact: true }).fill(setup.admin.accessCredential);
  await page.getByRole("button", { name: "Logga in", exact: true }).click();
  await expect(page.getByRole("button", { name: "Översikt", exact: true })).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("navigation", { name: "Arbetslägen", exact: true })
    .getByRole("button", { name: "Deltagare", exact: true }).click();
  const competitionStatus = page.getByRole("region", { name: "Tävlingsstatus", exact: true });
  const statusMetric = (label: string) => competitionStatus.locator("dl > div").filter({ has: page.getByText(label, { exact: true }) }).locator("dd");
  await expect(competitionStatus).toBeVisible();
  await expect(statusMetric("Deltagare")).toHaveText("27");
  await expect(statusMetric("Klasser")).toHaveText("2");
  await expect(statusMetric("Klasser · fri start")).toHaveText("1");
  await expect(statusMetric("Klasser · minutstart")).toHaveText("1");
  await expect(statusMetric("Äldre resultat")).toHaveText("0");
  await expect(statusMetric("Ej återlämnade hyrbrickor")).toHaveText("0");
  await expect(competitionStatus).toContainText("Underlag version 1 · läst");
  const rosterTable = page.locator('[data-panel="LIST"]').getByRole("table");
  for (const heading of ["Namn och klubb", "Klass", "Bricka", "Start"]) {
    await expect(rosterTable.getByRole("columnheader", { name: heading, exact: true })).toHaveAttribute("scope", "col");
  }
  const desktopViewport = page.viewportSize() ?? { width: 1366, height: 768 };
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(managePage).toHaveCSS("max-width", "1120px");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.setViewportSize(desktopViewport);
  const work = page.locator('[data-panel="WORK"]');
  const list = page.locator('[data-panel="LIST"]');
  const participantRow = page.locator('[data-panel="LIST"] tbody tr').filter({ hasText: "Åsa Testperson" });
  const inactiveCardRow = page.locator('[data-panel="LIST"] tbody tr').filter({ hasText: "Bertil Färsk" });
  const multipleCardRow = page.locator('[data-panel="LIST"] tbody tr').filter({ hasText: "Reserv 00 Zed" });
  await expect(participantRow.locator("td").nth(2)).toHaveText("123456");
  await expect(participantRow.locator("td").nth(3)).toHaveText("Fri start / startstämpling");
  await expect(inactiveCardRow.locator("td").nth(2)).toHaveText("Ingen aktiv bricka");
  await expect(inactiveCardRow.locator("td").nth(3)).toContainText("Minutstart");
  await expect(inactiveCardRow.locator("td").nth(3)).toContainText("Ingen fast starttid");
  await expect(multipleCardRow.locator("td").nth(2)).toHaveText("Flera aktiva brickor – kontrollera");
  await expect(list.getByRole("button", { name: "Skriv ut ej återlämnade hyrbrickor", exact: true })).toHaveCount(0);
  await expect(participantRow).not.toContainText("Äldre resultat");
  await expect(list.locator("tbody tr")).toHaveCount(25);
  await expect(list).toContainText("Visar 27 av 27");
  await expect(list.getByRole("checkbox", { name: "Visa endast äldre resultat (0)", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Åsa Testperson Test OK", exact: true }).click();
  const resultSummary = work.getByRole("region", { name: "Gällande resultat", exact: true });
  await expect(resultSummary).toContainText("Gällande resultat: Godkänd");
  await expect(resultSummary.getByRole("button", { name: /från äldre resultatunderlag/ })).toHaveCount(0);
  await page.getByRole("button", { name: "Före tävlingen", exact: true }).click();
  await page.getByRole("button", { name: "Klasser", exact: true }).click();
  const setupPanel = page.locator("details").filter({ hasText: "Klassens startupplägg" });
  await setupPanel.locator("summary").click();
  await setupPanel.locator("select").selectOption({ label: "Testklass" });
  await setupPanel.getByRole("button", { name: "Hämta underlag", exact: true }).click();
  await expect(page.getByText("Testklass · Nuvarande startupplägg:", { exact: false })).toContainText("Startstämpling");
  await expect(page.getByText("fasta tider: 1", { exact: false })).toBeVisible();
  await expect(page.getByText("deltagare med resultathistorik: 1", { exact: false })).toBeVisible();
  await page.getByLabel("Orsak till ändringen", { exact: true }).fill("Klassen får minutstart");
  await page.getByRole("checkbox", { name: "Jag har kontrollerat berörda deltagare", exact: false }).check();
  await page.getByRole("button", { name: "Granska regelbyte", exact: true }).click();
  const review = setupPanel.getByRole("alert");
  await expect(review).toContainText("Testklass"); await expect(review).toContainText("Fast starttid");
  const bodies: string[] = [];
  await page.route(`**/administrator/classes/${setup.classId}/start-rule`, async route => {
    if (route.request().method() !== "PATCH") return route.continue();
    bodies.push(route.request().postData()!); const response = await route.fetch();
    if (bodies.length === 1) await route.abort("failed"); else await route.fulfill({ response });
  });
  await review.getByRole("button", { name: "Bekräfta regelbyte", exact: true }).click();
  await expect(review).toContainText("Svaret saknas. Regelbytet kan vara sparat.");
  await review.getByRole("button", { name: "Försök igen med samma begäran", exact: true }).click();
  expect(bodies).toHaveLength(2); expect(bodies[1]).toBe(bodies[0]);
  await expect(review).toHaveCount(0);
  const [raceClass] = await db.select().from(schema.classes).where(eq(schema.classes.id, setup.classId));
  const [entry] = await db.select().from(schema.entries).where(eq(schema.entries.id, setup.entryId));
  expect(raceClass?.startRule).toBe("FIXED"); expect(entry?.fixedStartTime).toBeNull(); expect(entry?.version).toBe(2);
  expect(await db.select().from(schema.classStartRuleChanges).where(eq(schema.classStartRuleChanges.raceId, setup.raceId))).toHaveLength(1);
  await page.getByRole("navigation", { name: "Arbetslägen", exact: true })
    .getByRole("button", { name: "Deltagare", exact: true }).click();
  await expect(participantRow).toContainText("Äldre resultat");
  await expect(statusMetric("Klasser · fri start")).toHaveText("0");
  await expect(statusMetric("Klasser · minutstart")).toHaveText("2");
  await expect(statusMetric("Äldre resultat")).toHaveText("1");
  await expect(participantRow.locator("td").nth(3)).toContainText("Minutstart");
  await expect(participantRow.locator("td").nth(3)).toContainText("Ingen fast starttid");
  const olderResultsFilter = list.getByRole("checkbox", { name: "Visa endast äldre resultat (1)", exact: true });
  let rosterReads = 0;
  page.on("request", request => { if (request.url().endsWith("/administrator/transfer-candidates")) rosterReads += 1; });
  await list.getByRole("button", { name: "Nästa", exact: true }).click();
  await expect(list.locator("tbody tr")).toHaveCount(2);
  await expect(list).toContainText("2 / 2");
  await olderResultsFilter.check();
  await expect(list.locator("tbody tr")).toHaveCount(1);
  await expect(list).toContainText("Visar 1 av 27");
  await expect(participantRow).toContainText("Åsa Testperson");
  await expect(participantRow.getByRole("button")).toHaveAttribute("aria-pressed", "true");
  await list.getByLabel("Sök namn, klubb, klass eller bricka", { exact: true }).fill("Bertil");
  await expect(list.locator("tbody tr")).toHaveCount(0);
  await expect(list).toContainText("Visar 0 av 27");
  await expect(olderResultsFilter).toBeChecked();
  await list.getByLabel("Sök namn, klubb, klass eller bricka", { exact: true }).fill("Åsa");
  await expect(list.locator("tbody tr")).toHaveCount(1);
  await olderResultsFilter.uncheck();
  await expect(list.locator("tbody tr")).toHaveCount(1);
  await expect(participantRow).toContainText("Åsa Testperson");
  expect(rosterReads).toBe(0);

  let recalculationWrites = 0;
  page.on("request", request => {
    if (request.method() === "POST" && new URL(request.url()).pathname.endsWith("/recalculate")) recalculationWrites += 1;
  });
  await page.getByRole("button", { name: "Åsa Testperson Test OK", exact: true }).click();
  await expect(resultSummary).toContainText("Resultatet bygger på äldre tävlingsunderlag. Separat omräkning kan behövas.");
  await resultSummary.getByRole("button", { name: "Öppna omräkning för Åsa Testperson från äldre resultatunderlag", exact: true }).click();
  await expect(work.getByRole("button", { name: "Omräkning", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(work.getByRole("region", { name: "Omräkning", exact: true })).toContainText("Senaste lagrade revision: 1 · OK/COMPLETE");
  expect(recalculationWrites).toBe(0);
  expect(await db.select().from(schema.resultRevisions).where(eq(schema.resultRevisions.raceId, setup.raceId))).toHaveLength(1);

  await page.getByRole("button", { name: "Före tävlingen", exact: true }).click();
  await page.getByRole("button", { name: "Lottning & starttider", exact: true }).click();
  const followUp = setupPanel.getByRole("region", { name: "Saknade fasta starttider", exact: true });
  await expect(followUp).toContainText("1 deltagare saknar fast starttid.");
  let drawWrites = 0;
  page.on("request", request => {
    const path = new URL(request.url()).pathname;
    if (request.method() === "POST" && (path.endsWith("/draw-preview") || path.endsWith("/draw"))) drawWrites += 1;
  });
  await followUp.getByRole("button", { name: "Öppna klasslottning", exact: true }).click();
  const drawPanel = page.locator("details").filter({ hasText: "Lotta klassens starttider" });
  await expect(drawPanel).toHaveJSProperty("open", true);
  await expect(drawPanel.locator("summary")).toBeFocused();
  await expect(drawPanel.locator("select")).toHaveValue(setup.classId);
  expect(drawWrites).toBe(0);
  const resultFollowUp = setupPanel.getByRole("region", { name: "Resultat från äldre tävlingsversion", exact: true });
  await resultFollowUp.getByRole("button", { name: "Hämta omräkningsunderlag", exact: true }).click();
  await expect(resultFollowUp).toContainText("1 deltagare har resultat som kan behöva omräknas.");
  await expect(resultFollowUp).toContainText("Revision 1 · tävlingsversion 1 av 2");
  await resultFollowUp.getByRole("button", { name: "Öppna omräkning för Åsa Testperson", exact: true }).click();
  await expect(work.getByRole("button", { name: "Omräkning", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(work.getByRole("region", { name: "Omräkning", exact: true })).toContainText("Senaste lagrade revision: 1 · OK/COMPLETE");
  expect(recalculationWrites).toBe(0);
  expect(await db.select().from(schema.resultRevisions).where(eq(schema.resultRevisions.raceId, setup.raceId))).toHaveLength(1);
  await followUp.getByRole("button", { name: "Rätta starttid för Åsa Testperson", exact: true }).click();
  await expect(work.getByRole("button", { name: "Ändra starttid", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(work).toContainText("Åsa Testperson");
  const [stillMissing] = await db.select().from(schema.entries).where(eq(schema.entries.id, setup.entryId));
  expect(stillMissing?.fixedStartTime).toBeNull();
  await work.getByLabel("Startdatum", { exact: true }).fill("2026-09-12");
  await work.getByLabel("Klockslag", { exact: true }).fill("10:15:00");
  await work.getByLabel("UTC-offset", { exact: true }).fill("+02:00");
  await work.getByRole("button", { name: "Granska starttid", exact: true }).click();
  const timeReview = work.getByRole("alert");
  await timeReview.getByRole("button", { name: "Bekräfta starttid", exact: true }).click();
  await expect(followUp).toContainText("Alla deltagare i klassen har en fast starttid");
  const [timed] = await db.select().from(schema.entries).where(eq(schema.entries.id, setup.entryId));
  expect(timed?.fixedStartTime).toEqual(new Date("2026-09-12T08:15:00.000Z"));
  expect(timed?.version).toBe(3);
  await expect(participantRow.locator("td").nth(3)).toContainText("2026-09-12");
  await expect(participantRow.locator("td").nth(3)).toContainText("10:15:00 GMT+02:00");

  await work.getByRole("button", { name: "Ändra bricka", exact: true }).click();
  await expect(work).toContainText("Bricktyp: Inte markerad som hyrbricka");
  await work.getByRole("button", { name: "Markera som hyrbricka", exact: true }).click();
  const rentalReview = work.getByRole("alert");
  await expect(rentalReview).toContainText("Granska hyrbricksmarkering");
  const rentalBodies: string[] = [];
  await page.route(`**/administrator/entries/${setup.entryId}/card-rental`, async route => {
    rentalBodies.push(route.request().postData()!); const response = await route.fetch();
    if (rentalBodies.length === 1) await route.abort("failed"); else await route.fulfill({ response });
  });
  await rentalReview.getByRole("button", { name: "Bekräfta ändringen", exact: true }).click();
  await expect(rentalReview).toContainText("Svaret saknas. Ändringen kan vara sparad.");
  await rentalReview.getByRole("button", { name: "Försök igen med samma begäran", exact: true }).click();
  expect(rentalBodies).toHaveLength(2); expect(rentalBodies[1]).toBe(rentalBodies[0]);
  await expect(rentalReview).toHaveCount(0);
  await expect(participantRow).toContainText("Hyrbricka");
  await expect(statusMetric("Ej återlämnade hyrbrickor")).toHaveText("1");
  expect(await db.select().from(schema.entryCardRentalChanges)
    .where(eq(schema.entryCardRentalChanges.raceId, setup.raceId))).toHaveLength(1);
  const [rentalAssignment] = await db.select().from(schema.cardAssignments)
    .where(eq(schema.cardAssignments.id, setup.assignmentId));
  expect(rentalAssignment?.isRental).toBe(true);

  let rentalRosterReads = 0;
  page.on("request", request => {
    if (request.url().endsWith("/administrator/transfer-candidates")) rentalRosterReads += 1;
  });
  await list.getByLabel("Sök namn, klubb, klass eller bricka", { exact: true }).fill("");
  const rentalFilter = list.getByRole("checkbox", { name: "Visa endast ej återlämnade hyrbrickor (1)", exact: true });
  await rentalFilter.check();
  await expect(list.locator("tbody tr")).toHaveCount(1);
  await expect(participantRow).toContainText("Åsa Testperson");
  await expect(participantRow).toContainText("Testklass");
  await expect(participantRow).toContainText("Hyrbricka · 123456");
  await expect(participantRow.getByRole("button")).toHaveAttribute("aria-pressed", "true");
  await list.getByLabel("Sök namn, klubb, klass eller bricka", { exact: true }).fill("Bertil");
  await expect(list.locator("tbody tr")).toHaveCount(0);
  await expect(list).toContainText("Visar 0 av 27");
  await expect(rentalFilter).toBeChecked();
  await rentalFilter.uncheck();
  await expect(list.locator("tbody tr")).toHaveCount(1);
  expect(rentalRosterReads).toBe(0);

  await page.evaluate(() => { window.print = () => { document.body.dataset.rentalPrintRequested = "yes"; }; });
  const rentalPrintButton = list.getByRole("button", { name: "Skriv ut ej återlämnade hyrbrickor", exact: true });
  await rentalPrintButton.click();
  expect(await page.locator("body").getAttribute("data-rental-print-requested")).toBe("yes");
  expect(rentalRosterReads).toBe(0);
  const rentalPrint = page.locator("[data-rental-print]");
  await expect(rentalPrint).toBeHidden();
  await page.emulateMedia({ media: "print" });
  await expect(rentalPrint).toBeVisible();
  await expect(rentalPrint).toContainText("Privat lista: ej återlämnade hyrbrickor");
  await expect(rentalPrint).toContainText("Syntetiskt adminprov · Adminprov · 2026-09-12");
  await expect(rentalPrint).toContainText("Europe/Stockholm");
  await expect(rentalPrint).toContainText("Åsa Testperson");
  await expect(rentalPrint).toContainText("Test OK");
  await expect(rentalPrint).toContainText("Testklass");
  await expect(rentalPrint).toContainText("123456");
  await expect(rentalPrint).not.toContainText("Bertil Färsk");
  await expect(rentalPrint).not.toContainText("Reserv 00");
  await expect(page.locator('[data-panel="LIST"]')).toBeHidden();
  await page.emulateMedia({ media: "screen" });
  await expect(rentalPrint).toBeHidden();
  await page.evaluate(() => window.dispatchEvent(new Event("afterprint")));

  await work.getByRole("button", { name: "Markera som återlämnad", exact: true }).click();
  const returnReview = work.getByRole("alert");
  await expect(returnReview).toContainText("Granska återlämning av hyrbricka");
  const returnBodies: string[] = [];
  await page.route(`**/administrator/entries/${setup.entryId}/card-rental-return`, async route => {
    returnBodies.push(route.request().postData()!); const response = await route.fetch();
    if (returnBodies.length === 1) await route.abort("failed"); else await route.fulfill({ response });
  });
  await returnReview.getByRole("button", { name: "Bekräfta ändringen", exact: true }).click();
  await expect(returnReview).toContainText("Svaret saknas. Återlämningen kan vara sparad.");
  await returnReview.getByRole("button", { name: "Försök igen med samma begäran", exact: true }).click();
  expect(returnBodies).toHaveLength(2); expect(returnBodies[1]).toBe(returnBodies[0]);
  await expect(returnReview).toHaveCount(0);
  await expect(work).toContainText("Återlämning: Återlämnad");
  await list.getByLabel("Sök namn, klubb, klass eller bricka", { exact: true }).fill("");
  await expect(participantRow).toContainText("Hyrbricka · 123456 · Återlämnad");
  await expect(list.getByRole("checkbox", { name: "Visa endast ej återlämnade hyrbrickor (0)", exact: true })).toBeVisible();
  await expect(statusMetric("Ej återlämnade hyrbrickor")).toHaveText("0");
  await expect(list.getByRole("button", { name: "Skriv ut ej återlämnade hyrbrickor", exact: true })).toHaveCount(0);
  const [returnedAssignment] = await db.select().from(schema.cardAssignments)
    .where(eq(schema.cardAssignments.id, setup.assignmentId));
  expect(returnedAssignment).toMatchObject({ active: true, isRental: true, rentalReturned: true });
  expect(await db.select().from(schema.entryCardRentalReturnChanges)
    .where(eq(schema.entryCardRentalReturnChanges.raceId, setup.raceId))).toHaveLength(1);

  await work.getByRole("button", { name: "Rätta till inte återlämnad", exact: true }).click();
  const correctionReview = work.getByRole("alert");
  await expect(correctionReview).toContainText("Återlämningsmarkeringen rättas bort");
  await correctionReview.getByRole("button", { name: "Bekräfta ändringen", exact: true }).click();
  await expect(correctionReview).toHaveCount(0);
  await expect(work).toContainText("Återlämning: Inte registrerad som återlämnad");
  await expect(list.getByRole("checkbox", { name: "Visa endast ej återlämnade hyrbrickor (1)", exact: true })).toBeVisible();
  expect(await db.select().from(schema.entryCardRentalReturnChanges)
    .where(eq(schema.entryCardRentalReturnChanges.raceId, setup.raceId))).toHaveLength(2);
  // TASK077: hyrstatus, återlämning och rättning visas i samma deltagarhistorik.
  await chooseResultAction(page, "Historik");
  const history = page.getByRole("region", { name: "Historik", exact: true });
  await expect(history.locator("details")).toHaveCount(4);
  await expect(history.locator("summary").first()).toContainText("Återlämning · Deltagarversion 6");
  await history.locator("summary").first().click();
  await expect(history).toContainText("Före: Återlämnad");
  await expect(history).toContainText("Efter: Inte registrerad som återlämnad");
  const rentalReturn = history.locator("details").filter({ has: page.locator("summary", { hasText: "Återlämning" }) }).nth(1);
  await rentalReturn.locator("summary").click();
  await expect(rentalReturn).toContainText("Före: Inte registrerad som återlämnad");
  await expect(rentalReturn).toContainText("Efter: Återlämnad");
  const rental = history.locator("details").filter({ has: page.locator("summary", { hasText: "Hyrstatus" }) });
  await rental.locator("summary").click();
  await expect(rental).toContainText("Före: Inte markerad som hyrbricka");
  await expect(rental).toContainText("Efter: Hyrbricka");
});

test("TASK143 admin återanvänder en återlämnad hyrbricka på mobil med exakt återförsök", async ({ page }) => {
  const setup = await fixture(), targetEntryId = randomUUID();
  await db.update(schema.cardAssignments).set({ isRental: true, rentalReturned: true })
    .where(eq(schema.cardAssignments.id, setup.assignmentId));
  await db.insert(schema.entries).values({ id: targetEntryId, raceId: setup.raceId, classId: setup.classId,
    givenName: "Bo", familyName: "Måltavla", organisationName: "Test OK" });

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/admin/${setup.raceId}/manage`);
  await signIn(page, setup.admin.accessCredential);
  await page.getByRole("button", { name: "Bo Måltavla Test OK", exact: true }).click();
  const work = page.locator('[data-panel="WORK"]');
  await work.getByRole("button", { name: "Ändra bricka", exact: true }).click();
  await work.getByLabel("Återlämnad hyrbricka att ge vidare", { exact: true }).selectOption(setup.assignmentId);
  await work.getByRole("button", { name: "Granska återanvändning", exact: true }).click();
  const review = work.getByRole("alert");
  await expect(review).toContainText("Åsa Testperson · 123456");
  await expect(review).toContainText("Bo Måltavla");
  const requestBodies: string[] = [];
  await page.route(`**/administrator/entries/${targetEntryId}/card-rental-reuse`, async route => {
    requestBodies.push(route.request().postData()!); const response = await route.fetch();
    if (requestBodies.length === 1) await route.abort("failed"); else await route.fulfill({ response });
  });
  await review.getByRole("button", { name: "Bekräfta återanvändning", exact: true }).click();
  await expect(review).toContainText("Svaret saknas. Återanvändningen kan vara sparad.");
  await review.getByRole("button", { name: "Försök igen med samma begäran", exact: true }).click();
  expect(requestBodies).toHaveLength(2); expect(requestBodies[1]).toBe(requestBodies[0]);
  await expect(review).toHaveCount(0);
  await expect(work).toContainText("Hyrbricka");
  await expect(work).toContainText("123456");
  await expect(work).toContainText("Inte registrerad som återlämnad");
  await chooseResultAction(page, "Historik");
  const history = work.getByRole("region", { name: "Historik", exact: true });
  await expect(history.locator("details")).toHaveCount(1);
  await expect(history.locator("summary")).toContainText("Hyrbricksåteranvändning");
  await history.locator("summary").click();
  await expect(history).toContainText("Före: Ingen aktiv bricka");
  await expect(history).toContainText("Efter: Hyrbricka tilldelad · inte återlämnad");
  await expect(history).not.toContainText("Åsa Testperson");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

  const [source] = await db.select().from(schema.cardAssignments).where(eq(schema.cardAssignments.id, setup.assignmentId));
  const targetAssignments = await db.select().from(schema.cardAssignments)
    .where(and(eq(schema.cardAssignments.entryId, targetEntryId), eq(schema.cardAssignments.active, true)));
  const [sourceEntry] = await db.select().from(schema.entries).where(eq(schema.entries.id, setup.entryId));
  const [targetEntry] = await db.select().from(schema.entries).where(eq(schema.entries.id, targetEntryId));
  const [race] = await db.select().from(schema.races).where(eq(schema.races.id, setup.raceId));
  expect(source).toMatchObject({ active: false, isRental: true, rentalReturned: true });
  expect(targetAssignments).toHaveLength(1);
  expect(targetAssignments[0]).toMatchObject({ cardNumber: "123456", isRental: true, rentalReturned: false });
  expect(sourceEntry?.version).toBe(2); expect(targetEntry?.version).toBe(2); expect(race?.snapshotVersion).toBe(2);
  expect(await db.select().from(schema.entryCardRentalReuseRequests)
    .where(eq(schema.entryCardRentalReuseRequests.raceId, setup.raceId))).toHaveLength(1);
});

test("TASK063/TASK064 admin granskar konflikt från skogslistan med exakt retry och bevarad journal", async ({ page }) => {
  const setup = await fixture();
  const login = await loginPairingAdmin(db, { formatVersion: 1, accessCredential: setup.admin.accessCredential }, { expectedRaceId: setup.raceId, expectedCapability: "MANAGE_RACE" });
  if (login.status !== "authenticated") throw new Error("Synthetic login failed");
  const auth = { raceId: setup.raceId, sessionToken: login.sessionToken, csrfCookie: login.csrfToken, csrfHeader: login.csrfToken };
  for (let index = 0; index < 2; index++) {
    await correctAdministratorStart(db, { ...auth, request: { formatVersion: 1, requestId: randomUUID(),
      entryId: setup.entryId, packageVersion: 1, expectedEntryVersion: 1, expectedRevision: 0,
      observedAt: new Date().toISOString(), targetStartState: "STARTED" } });
  }
  await page.goto(`/admin/${setup.raceId}/manage`);
  await signIn(page, setup.admin.accessCredential, "Under tävlingen");
  await page.getByRole("button", { name: "Uppdatera lista", exact: true }).click();
  await page.getByRole("button", { name: "Granska konflikt", exact: true }).click();
  const panel = page.getByRole("region", { name: "Granska mottagna konfliktrapporter", exact: true });
  await expect(panel).toContainText("Onlineadministration");
  await expect(panel).toContainText("Åsa Testperson");
  await panel.getByLabel("Orsak till granskningsbeslut", { exact: true }).fill("Kontrollerat med startpersonalen");
  await panel.getByRole("checkbox").check();
  const bodies: string[] = [];
  await page.route("**/administrator/conflict-reviews", async route => {
    bodies.push(route.request().postData()!);
    const response = await route.fetch();
    if (bodies.length === 1) await route.abort("failed"); else await route.fulfill({ response });
  });
  await panel.getByRole("button", { name: "Bekräfta granskning – behåll registrerat läge", exact: true }).click();
  await expect(page.getByText("Svaret är osäkert.", { exact: false })).toBeVisible();
  await panel.getByRole("button", { name: "Försök igen med samma granskningsbeslut", exact: true }).click();
  await expect(panel).toHaveCount(0);
  expect(bodies).toHaveLength(2); expect(bodies[1]).toBe(bodies[0]);
  await page.getByRole("button", { name: "Visa senaste journalen", exact: true }).click();
  await expect(page.getByText("Granskad: Kontrollerat med startpersonalen", { exact: false })).toBeVisible();
  expect(await db.select().from(schema.startCheckinConflictReviews).where(eq(schema.startCheckinConflictReviews.raceId, setup.raceId))).toHaveLength(1);
});

test("TASK060 automatisk skogsrapport pausar vid granskning och behåller gammaldata vid nätfel", async ({ page }) => {
  const setup = await fixture();
  await page.goto(`/admin/${setup.raceId}/manage`);
  await expect(page.getByRole("button", { name: "Logga in", exact: true })).toBeEnabled();
  await signIn(page, setup.admin.accessCredential);
  await page.getByRole("button", { name: "Åsa Testperson Test OK", exact: true }).click();
  await page.getByRole("button", { name: "Under tävlingen", exact: true }).click();
  let reads = 0;
  page.on("request", request => { if (request.url().endsWith("/administrator/forest-watch")) reads++; });
  const refresh = page.getByRole("button", { name: "Uppdatera lista", exact: true });
  await refresh.click();
  const report = page.getByRole("region", { name: "Kvar i skogen – målpersonal", exact: true });
  await expect(report).toContainText("Åsa Testperson");
  await page.locator("summary").filter({ hasText: "Vald deltagare" }).click();
  await page.clock.install();
  const automatic = page.getByRole("checkbox", { name: "Uppdatera skogsrapporten automatiskt", exact: true });
  await expect(automatic).not.toBeChecked();
  await automatic.check();
  const initial = reads;
  await page.clock.runFor(15_100);
  await expect.poll(() => reads).toBe(initial + 1);
  await expect(refresh).toBeEnabled();
  await page.getByRole("button", { name: "Granska manuell återkomst", exact: true }).click();
  const review = page.getByRole("alert", { name: "Granska manuell återkomst", exact: true });
  const beforeReview = reads;
  await page.clock.runFor(30_100);
  expect(reads).toBe(beforeReview);
  await expect(review).toContainText("Åsa Testperson");
  await review.getByRole("button", { name: "Ändra val", exact: true }).click();
  await page.route("**/administrator/forest-watch", route => route.abort("failed"));
  await page.clock.runFor(15_100);
  await expect.poll(() => reads).toBe(beforeReview + 1);
  await expect(report.getByRole("alert")).toContainText("Underlaget nedan kan vara gammalt");
  await expect(report).toContainText("Åsa Testperson");
  await expect(automatic).toBeEnabled();
  await automatic.uncheck();
  const stopped = reads;
  await page.clock.runFor(30_100);
  expect(reads).toBe(stopped);
  await page.getByRole("button", { name: "Logga ut", exact: true }).click();
  await page.clock.runFor(15_100);
  expect(reads).toBe(stopped);
  await expect(report).toHaveCount(0);
});

test("TASK057/TASK058 admin öppnar journal från skogslistan och rensar vid deltagarbyte/logout", async ({ page, request }) => {
  const setup = await fixture();
  await db.insert(schema.entries).values({ id: randomUUID(), raceId: setup.raceId, classId: setup.classId, givenName: "Bertil", familyName: "Testperson" });
  const login = await loginPairingAdmin(db, { formatVersion: 1, accessCredential: setup.admin.accessCredential }, { expectedRaceId: setup.raceId, expectedCapability: "MANAGE_RACE" });
  if (login.status !== "authenticated") throw new Error("Synthetic login failed");
  const auth = { raceId: setup.raceId, sessionToken: login.sessionToken, csrfCookie: login.csrfToken, csrfHeader: login.csrfToken };
  for (let index = 0; index < 28; index++) {
    const result = await correctAdministratorStart(db, { ...auth, request: { formatVersion: 1,
      requestId: randomUUID(), entryId: setup.entryId, packageVersion: 1, expectedEntryVersion: 1,
      expectedRevision: index === 27 ? 0 : Math.max(0, index - 1), observedAt: new Date().toISOString(),
      targetStartState: index === 27 ? "REPORTED_NOT_STARTED" : index % 2 ? "STARTED" : "UNMARKED" } });
    expect(result.status).toBe("stored");
  }
  const before = await db.select().from(schema.startCheckinOperations).where(eq(schema.startCheckinOperations.raceId, setup.raceId));
  expect((await request.get(`/api/admin/races/${setup.raceId}/administrator/entries/${setup.entryId}/checkin-history`)).status()).toBe(401);
  await page.goto(`/admin/${setup.raceId}/manage`);
  await signIn(page, setup.admin.accessCredential);
  await page.getByRole("button", { name: "Åsa Testperson Test OK", exact: true }).click();
  await page.getByRole("button", { name: "Under tävlingen", exact: true }).click();
  await page.getByRole("button", { name: "Uppdatera lista", exact: true }).click();
  const forest = page.getByRole("region", { name: "Kvar i skogen – målpersonal", exact: true });
  await expect(page.locator("[data-forest-print] button")).toHaveCount(0);
  await forest.getByRole("row").filter({ hasText: "Åsa Testperson" }).getByRole("button", { name: "Journal", exact: true }).click();
  const journal = page.getByRole("region", { name: "Start- och återkomsthistorik", exact: true });
  await expect(journal.locator("tbody tr")).toHaveCount(25);
  await expect(journal).toContainText("Konflikt – inte tillämpad");
  await expect(journal).toContainText("Administratör");
  await page.getByRole("button", { name: "Visa äldre journalrader", exact: true }).click();
  await expect(journal.locator("tbody tr")).toHaveCount(3);
  await expect(journal).toContainText("Oförändrad");
  await page.getByRole("navigation", { name: "Arbetslägen", exact: true })
    .getByRole("button", { name: "Deltagare", exact: true }).click();
  await page.getByRole("button", { name: "Bertil Testperson Ingen klubb angiven", exact: true }).click();
  await expect(journal).toHaveCount(0);
  await page.getByRole("button", { name: "Under tävlingen", exact: true }).click();
  await page.getByRole("button", { name: "Visa senaste journalen", exact: true }).click();
  await expect(journal).toContainText("Inga journalförda avprickningar");
  await page.getByRole("button", { name: "Logga ut", exact: true }).click();
  await expect(journal).toHaveCount(0);
  expect(await db.select().from(schema.startCheckinOperations).where(eq(schema.startCheckinOperations.raceId, setup.raceId))).toEqual(before);
  expect(await db.select().from(schema.resultRevisions).where(eq(schema.resultRevisions.raceId, setup.raceId))).toHaveLength(0);
});

test("TASK056/TASK061 admin rättar startmarkering med exakt retry och rapporterad startålder", async ({ page }) => {
  const setup = await fixture();
  await page.goto(`/admin/${setup.raceId}/manage`);
  await signIn(page, setup.admin.accessCredential);
  await page.getByRole("button", { name: "Åsa Testperson Test OK", exact: true }).click();
  await page.getByRole("button", { name: "Under tävlingen", exact: true }).click();
  const refresh = page.getByRole("button", { name: "Uppdatera lista", exact: true });
  await refresh.click();
  await page.locator("summary").filter({ hasText: "Vald deltagare" }).click();
  await page.getByRole("combobox", { name: "Rättad startmarkering", exact: true }).selectOption("REPORTED_NOT_STARTED");
  await page.getByRole("button", { name: "Granska startmarkering", exact: true }).click();
  const review = page.getByRole("alert", { name: "Granska startmarkering", exact: true });
  await expect(review).toContainText("Ingen starttid eller stämpling ändras");
  await review.getByRole("button", { name: "Bekräfta startmarkering", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("Startmarkeringen är rättad");
  const writes: string[] = [];
  await page.route("**/administrator/start-correction", async route => {
    writes.push(route.request().postData()!);
    const response = await route.fetch();
    if (writes.length === 1) await route.abort("failed"); else await route.fulfill({ response });
  });
  await page.getByRole("combobox", { name: "Rättad startmarkering", exact: true }).selectOption("STARTED");
  await page.getByRole("button", { name: "Granska startmarkering", exact: true }).click();
  await review.getByRole("button", { name: "Ändra val", exact: true }).click();
  expect(writes).toHaveLength(0);
  await page.getByRole("button", { name: "Granska startmarkering", exact: true }).click();
  await review.getByRole("button", { name: "Bekräfta startmarkering", exact: true }).click();
  await expect(review).toContainText("Svaret saknas");
  await expect(refresh).toBeDisabled();
  await review.getByRole("button", { name: "Försök igen med samma begäran", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("Startmarkeringen är rättad");
  expect(writes).toHaveLength(2); expect(writes[0]).toBe(writes[1]);
  const report = page.getByRole("region", { name: "Kvar i skogen – målpersonal", exact: true });
  await expect(report.locator('[data-forest-group="STARTED_NO_RETURN"]')).toHaveAttribute("data-forest-total", "1");
  await expect(report).toContainText("Sedan rapporterad start, vid rapporttiden (ej löptid)");
  expect(await db.select().from(schema.startCheckinOperations).where(eq(schema.startCheckinOperations.raceId, setup.raceId))).toHaveLength(2);
  expect(await db.select().from(schema.resultRevisions).where(eq(schema.resultRevisions.raceId, setup.raceId))).toHaveLength(1);
});

test("TASK054/TASK055 manuell återkomst och rättning från samma admin bevarar start och resultat", async ({ page }) => {
  const setup = await fixture();
  await page.setViewportSize({ width: 390, height: 900 });
  await page.goto(`/admin/${setup.raceId}/manage`);
  await expect(page.getByRole("button", { name: "Logga in", exact: true })).toBeEnabled();
  await signIn(page, setup.admin.accessCredential);
  await page.getByRole("button", { name: "Åsa Testperson Test OK", exact: true }).click();
  await page.getByRole("button", { name: "Under tävlingen", exact: true }).click();
  const refresh = page.getByRole("button", { name: "Uppdatera lista", exact: true });
  await refresh.click();
  await page.locator("summary").filter({ hasText: "Vald deltagare" }).click();
  const writes: string[] = [];
  await page.route("**/administrator/manual-return", async route => {
    writes.push(route.request().postData()!);
    const response = await route.fetch();
    if (writes.length === 1) await route.abort("failed"); else await route.fulfill({ response });
  });
  await page.getByRole("button", { name: "Granska manuell återkomst", exact: true }).click();
  const review = page.getByRole("alert", { name: "Granska manuell återkomst", exact: true });
  await expect(review).toContainText("Åsa Testperson");
  await expect(review).toContainText("inte godkänt resultat");
  await expect(review).toContainText("Start: omarkerad / okänd");
  expect(writes).toHaveLength(0);
  await review.getByRole("button", { name: "Ändra val", exact: true }).click();
  await page.getByRole("button", { name: "Granska manuell återkomst", exact: true }).click();
  await review.getByRole("button", { name: "Bekräfta manuell återkomst", exact: true }).click();
  await expect(review).toContainText("Svaret saknas");
  await expect(refresh).toBeDisabled();
  await review.getByRole("button", { name: "Försök igen med samma begäran", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("Manuell återkomst är registrerad");
  expect(writes).toHaveLength(2); expect(writes[1]).toBe(writes[0]);
  const report = page.getByRole("region", { name: "Kvar i skogen – målpersonal", exact: true });
  await expect(report).toContainText("Registrerad återkomst (1)");
  await expect(report).toContainText("Start: omarkerad / okänd");
  await expect(report).toContainText("Återkomst: manuellt registrerad");
  await expect(page.getByRole("button", { name: "Granska manuell återkomst", exact: true })).toBeDisabled();
  const operations = await db.select().from(schema.startCheckinOperations).where(eq(schema.startCheckinOperations.raceId, setup.raceId));
  expect(operations).toHaveLength(1); expect(operations[0]?.actorCredentialId).toBe(setup.admin.credentialId);
  expect(await db.select().from(schema.resultRevisions).where(eq(schema.resultRevisions.raceId, setup.raceId))).toHaveLength(0);
  const corrections: string[] = [];
  await page.route("**/administrator/manual-return-withdrawal", async route => {
    corrections.push(route.request().postData()!);
    const response = await route.fetch();
    if (corrections.length === 1) await route.abort("failed"); else await route.fulfill({ response });
  });
  const correct = page.getByRole("button", { name: "Rätta manuell återkomst", exact: true });
  await correct.click();
  const correction = page.getByRole("alert", { name: "Rätta manuell återkomst", exact: true });
  await expect(correction).toContainText("ej startande (DNS)");
  await expect(correction).toContainText("faktisk avläsning räknas fortfarande");
  await correction.getByRole("button", { name: "Ändra val", exact: true }).click();
  expect(corrections).toHaveLength(0);
  await correct.click();
  await correction.getByRole("button", { name: "Bekräfta borttagning av manuell återkomst", exact: true }).click();
  await expect(correction).toContainText("Svaret saknas");
  await correction.getByRole("button", { name: "Försök igen med samma begäran", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("Manuell återkomst är borttagen");
  expect(corrections).toHaveLength(2); expect(corrections[1]).toBe(corrections[0]);
  await expect(report).toContainText("Okänd startstatus – följ upp (1)");
  await expect(report).toContainText("Start: omarkerad / okänd");
  await expect(correct).toBeDisabled();
  expect(await db.select().from(schema.startCheckinOperations).where(eq(schema.startCheckinOperations.raceId, setup.raceId))).toHaveLength(2);
  expect(await db.select().from(schema.resultRevisions).where(eq(schema.resultRevisions.raceId, setup.raceId))).toHaveLength(0);
  const deviceId = randomUUID();
  const payload = { cardNumber: "123456", startPunchedAt: "2026-09-12T10:30:00Z", finishPunchedAt: "2026-09-12T10:50:00Z",
    punches: [{ code: 31, punchedAt: "2026-09-12T10:40:00Z" }] };
  expect((await ingestDeviceBatch(db, setup.raceId, { deviceId, sessionId: deviceId, packageVersion: 1,
    firstSequence: 1, lastSequence: 1, events: [{ localSequence: 1, stationReceivedAt: "2026-09-12T10:50:00Z",
      transport: "simulator", payload, contentHash: createHash("sha256").update(JSON.stringify(payload)).digest("hex") }] })).acknowledgements[0]?.status).toBe("stored");
  const technicalResults = await db.select().from(schema.resultRevisions).where(eq(schema.resultRevisions.raceId, setup.raceId));
  const technicalReadouts = await db.select().from(schema.cardReadouts).where(eq(schema.cardReadouts.raceId, setup.raceId));
  await refresh.click();
  await page.getByRole("button", { name: "Granska manuell återkomst", exact: true }).click();
  await review.getByRole("button", { name: "Bekräfta manuell återkomst", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("Manuell återkomst är registrerad");
  await correct.click();
  await correction.getByRole("button", { name: "Bekräfta borttagning av manuell återkomst", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("Manuell återkomst är borttagen");
  await expect(report).toContainText("Registrerad återkomst (1)");
  expect(await db.select().from(schema.resultRevisions).where(eq(schema.resultRevisions.raceId, setup.raceId))).toEqual(technicalResults);
  expect(await db.select().from(schema.cardReadouts).where(eq(schema.cardReadouts.raceId, setup.raceId))).toEqual(technicalReadouts);
});

test("TASK052/TASK053 admin läser och skriver ut kvar-i-skogen med synlig osäkerhet", async ({ page, request }) => {
  const setup = await fixture(), deviceId = randomUUID();
  const endpoint = `/api/admin/races/${setup.raceId}/administrator/forest-watch`;
  expect((await request.get(endpoint)).status()).toBe(401);
  await page.setViewportSize({ width: 390, height: 900 });
  await page.goto(`/admin/${setup.raceId}/manage`);
  await expect(page.getByRole("button", { name: "Logga in", exact: true })).toBeEnabled();
  await signIn(page, setup.admin.accessCredential, "Under tävlingen");
  const refresh = page.getByRole("button", { name: "Uppdatera lista", exact: true });
  await refresh.click();
  const report = page.getByRole("region", { name: "Kvar i skogen – målpersonal", exact: true });
  await expect(report).toContainText("Åsa Testperson");
  await expect(report).toContainText("Okänd startstatus – följ upp (1)");
  await expect(report).toContainText("garanterar inte att skogen är tom");
  await page.getByLabel("Sök namn, klubb eller bricknummer", { exact: true }).fill("saknas");
  await expect(report).toContainText("Det betyder inte att skogen är tom");
  await expect(report.locator('[data-forest-group="UNCONFIRMED"]')).toHaveAttribute("data-forest-total", "1");
  await page.getByRole("button", { name: "Rensa filter", exact: true }).click();
  const payload = { cardNumber: "123456", startPunchedAt: "2026-09-12T10:30:00Z", finishPunchedAt: "2026-09-12T10:50:00Z",
    punches: [{ code: 31, punchedAt: "2026-09-12T10:40:00Z" }] };
  expect((await ingestDeviceBatch(db, setup.raceId, { deviceId, sessionId: deviceId, packageVersion: 1,
    firstSequence: 1, lastSequence: 1, events: [{ localSequence: 1, stationReceivedAt: "2026-09-12T10:50:00Z",
      transport: "simulator", payload, contentHash: createHash("sha256").update(JSON.stringify(payload)).digest("hex") }] })).acknowledgements[0]?.status).toBe("stored");
  const before = await db.select().from(schema.resultRevisions).where(eq(schema.resultRevisions.raceId, setup.raceId));
  await refresh.click();
  await expect(report).toContainText("Registrerad återkomst (1)");
  expect(await db.select().from(schema.resultRevisions).where(eq(schema.resultRevisions.raceId, setup.raceId))).toEqual(before);
  await page.route(`**${endpoint}`, route => route.abort("failed"));
  await refresh.click();
  await expect(report.getByRole("alert")).toContainText("Underlaget nedan kan vara gammalt");
  await expect(report).toContainText("Registrerad återkomst (1)");
  await page.getByLabel("Sök namn, klubb eller bricknummer", { exact: true }).fill("saknas");
  await page.evaluate(() => { window.print = () => { document.documentElement.dataset.printCalls = "1"; }; });
  let printRequests = 0;
  const countPrintRequest = () => { printRequests += 1; };
  page.on("request", countPrintRequest);
  await page.getByRole("button", { name: "Skriv ut listan", exact: true }).click();
  expect(await page.locator("html").getAttribute("data-print-calls")).toBe("1");
  await page.emulateMedia({ media: "print" });
  const printed = page.locator("[data-forest-print]");
  await expect(printed).toBeVisible();
  await expect(printed).toContainText("Underlaget nedan kan vara gammalt");
  await expect(printed).toContainText("Det betyder inte att skogen är tom");
  await expect(printed.locator('[data-forest-group="RETURNED"]')).toHaveAttribute("data-forest-total", "1");
  await expect(page.getByRole("heading", { name: "Tävlingsadministration", exact: true })).toHaveCount(0);
  await expect(page.locator(`#participant-list-${setup.raceId}`)).toBeHidden();
  await expect(page.getByRole("button", { name: "Logga ut", exact: true })).toHaveCount(0);
  expect(printRequests).toBe(0); page.off("request", countPrintRequest);
  await page.emulateMedia({ media: "screen" });
  await expect(printed).toBeHidden();
  await page.getByRole("button", { name: "Logga ut", exact: true }).click();
  await expect(report).toHaveCount(0);
  await expect(printed).toHaveCount(0);
});

test("TASK051 publicera och avpublicera med samma admin och exakt retry", async ({ page, request }) => {
  const setup = await fixture();
  const publicUrl = `/api/races/${setup.raceId}/start-list`;
  expect((await request.get(publicUrl)).status()).toBe(404);
  await page.setViewportSize({ width: 390, height: 900 });
  await page.goto(`/admin/${setup.raceId}/manage`);
  await expect(page.getByRole("button", { name: "Logga in", exact: true })).toBeEnabled();
  await signIn(page, setup.admin.accessCredential, "Före tävlingen", "Startlista");
  await page.getByText("Publicera startlista", { exact: true }).click();
  const refresh = page.getByRole("button", { name: "Läs aktuellt underlag", exact: true });
  await refresh.click();
  await expect(page.getByText("Ingen startlista är publicerad.", { exact: true })).toBeVisible();
  const writes: { key: string | undefined; body: string | null }[] = [];
  await page.route("**/administrator/publication", async route => {
    writes.push({ key: route.request().headers()["idempotency-key"], body: route.request().postData() });
    const response = await route.fetch();
    if (writes.length === 1) await route.abort("failed"); else await route.fulfill({ response });
  });
  await page.getByRole("button", { name: "Granska publicering", exact: true }).click();
  const review = page.getByRole("alert", { name: "Förhandsgranskning", exact: true });
  await expect(review).toContainText("Åsa Testperson"); await expect(review).toContainText("Test OK");
  await expect(review).toContainText("Fri start"); await expect(review).not.toContainText("123456");
  await expect(review).toContainText("kan inte radera kopior");
  expect(writes).toHaveLength(0);
  await review.getByRole("button", { name: "Avbryt", exact: true }).click();
  expect((await request.get(publicUrl)).status()).toBe(404);
  await page.getByRole("button", { name: "Granska publicering", exact: true }).click();
  await review.getByRole("button", { name: "Bekräfta och publicera", exact: true }).click();
  await expect(review).toContainText("Svaret är okänt");
  await expect(refresh).toBeDisabled();
  await review.getByRole("button", { name: "Försök igen med samma begäran", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("Publiceringsbeslutet är sparat");
  expect(writes).toHaveLength(2); expect(writes[1]).toEqual(writes[0]);
  const published = await request.get(publicUrl); expect(published.status()).toBe(200);
  const oldBytes = await published.text(); expect(oldBytes).toContain("Åsa Testperson"); expect(oldBytes).not.toContain("123456");
  // Simulate a later source correction in this isolated fixture; no automatic republish.
  await db.update(schema.entries).set({ givenName: "Ändrat", version: 2 }).where(eq(schema.entries.id, setup.entryId));
  await db.update(schema.races).set({ snapshotVersion: 2 }).where(eq(schema.races.id, setup.raceId));
  await refresh.click();
  await expect(page.getByText(/Tävlingsunderlaget skiljer sig från den publicerade kopian/)).toBeVisible();
  expect(await (await request.get(publicUrl)).text()).toBe(oldBytes);
  await page.getByRole("button", { name: "Granska avpublicering", exact: true }).click();
  await review.getByRole("button", { name: "Bekräfta och avpublicera", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("Publiceringsbeslutet är sparat");
  expect((await request.get(publicUrl)).status()).toBe(404);
  const rows = await db.select().from(schema.startListPublications).where(eq(schema.startListPublications.raceId, setup.raceId));
  expect(rows).toHaveLength(2); expect(rows.map(row => row.action).sort()).toEqual(["PUBLISH", "WITHDRAW"]);
  const audits = await db.select().from(schema.auditEvents).where(eq(schema.auditEvents.raceId, setup.raceId));
  const publicationAudits = audits.filter(row => ["START_LIST_PUBLISHED", "START_LIST_WITHDRAWN"].includes(row.action));
  expect(publicationAudits).toHaveLength(2);
  expect(publicationAudits.every(row => row.actorKind === "RACE_ADMIN_ACCESS_CREDENTIAL" && row.actorId === setup.admin.credentialId)).toBe(true);
});

test("TASK050 minutstartslottning bevarar fri start och återförs exakt", async ({ page }) => {
  const setup = await fixture(), firstId = randomUUID(), secondId = randomUUID();
  await db.insert(schema.entries).values([
    { id: firstId, raceId: setup.raceId, classId: setup.targetClassId, givenName: "Minut", familyName: "Ett", fixedStartTime: new Date("2026-09-12T08:00:00Z") },
    { id: secondId, raceId: setup.raceId, classId: setup.targetClassId, givenName: "Minut", familyName: "Två", fixedStartTime: new Date("2026-09-12T08:01:00Z") }
  ]);
  const [freeBefore] = await db.select().from(schema.entries).where(eq(schema.entries.id, setup.entryId));
  await page.setViewportSize({ width: 390, height: 900 });
  await page.goto(`/admin/${setup.raceId}/manage`);
  await expect(page.getByRole("button", { name: "Logga in", exact: true })).toBeEnabled();
  await signIn(page, setup.admin.accessCredential, "Före tävlingen", "Lottning & starttider");
  await page.getByText("Lotta klassens starttider", { exact: true }).click();
  await page.getByRole("button", { name: "Läs klasser och hämta nytt slumpfrö", exact: true }).click();
  const classes = page.getByRole("combobox", { name: "Klass", exact: true });
  await expect(classes.locator(`option[value="${setup.classId}"]`)).toHaveCount(0);
  await classes.selectOption(setup.targetClassId);
  await page.getByLabel("Första start (datum, sekunder och UTC-offset)", { exact: true }).fill("2026-09-12T11:00:00+02:00");
  await page.getByLabel("Startintervall i hela sekunder", { exact: true }).fill("120");
  const writes: { key: string | undefined; body: string | null }[] = [];
  await page.route("**/administrator/draw", async route => {
    writes.push({ key: route.request().headers()["idempotency-key"], body: route.request().postData() });
    const response = await route.fetch();
    if (writes.length === 1) await route.abort("failed"); else await route.fulfill({ response });
  });
  await page.getByRole("button", { name: "Granska lottning", exact: true }).click();
  const review = page.getByRole("alert", { name: "Granska lottning", exact: true });
  await expect(review).toContainText("Minut Ett"); await expect(review).toContainText("Minut Två");
  await expect(review).toContainText("11:00"); await expect(review).toContainText("11:02");
  expect(writes).toHaveLength(0);
  await review.getByRole("button", { name: "Avbryt granskning", exact: true }).click();
  expect(writes).toHaveLength(0);
  await page.getByRole("button", { name: "Granska lottning", exact: true }).click();
  await review.getByRole("button", { name: "Bekräfta och spara klassens tider", exact: true }).click();
  await expect(review).toContainText("Svaret är okänt");
  await expect(classes).toBeDisabled();
  await review.getByRole("button", { name: "Försök igen med samma begäran", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("Klassens starttider är sparade");
  expect(writes).toHaveLength(2); expect(writes[1]).toEqual(writes[0]);
  const entries = await db.select().from(schema.entries).where(eq(schema.entries.raceId, setup.raceId));
  expect(entries.find(row => row.id === setup.entryId)).toEqual(freeBefore);
  expect(entries.filter(row => row.classId === setup.targetClassId).map(row => row.fixedStartTime?.toISOString()).sort())
    .toEqual(["2026-09-12T09:00:00.000Z", "2026-09-12T09:02:00.000Z"]);
  const audits = await db.select().from(schema.auditEvents).where(eq(schema.auditEvents.raceId, setup.raceId));
  const drawAudit = audits.filter(row => row.action === "CLASS_START_DRAW_COMMITTED");
  expect(drawAudit).toHaveLength(1); expect(drawAudit[0]?.actorKind).toBe("RACE_ADMIN_ACCESS_CREDENTIAL");
});

test("TASK108 visar bara bevisbara lottade startluckor på mobil", async ({ page }) => {
  const setup = await fixture();
  const [first] = await db.insert(schema.entries).values([
    { raceId: setup.raceId, classId: setup.targetClassId, givenName: "Plan", familyName: "Ett" },
    { raceId: setup.raceId, classId: setup.targetClassId, givenName: "Plan", familyName: "Två" }
  ]).returning();
  const login = await loginPairingAdmin(db, { formatVersion: 1, accessCredential: setup.admin.accessCredential }, {
    expectedRaceId: setup.raceId, expectedCapability: "MANAGE_RACE"
  });
  if (login.status !== "authenticated") throw new Error("Administratörsinloggning saknas");
  const auth = { raceId: setup.raceId, sessionToken: login.sessionToken, csrfCookie: login.csrfToken, csrfHeader: login.csrfToken };
  const parameters = { algorithmVersion: "xorshift32-fisher-yates-v1" as const, seed: 29,
    firstStartTime: "2026-09-12T08:00:00.000Z", intervalSeconds: 60 };
  const preview = await previewClassStartDrawAsAdmin(db, { ...auth, request: { formatVersion: 1, classId: setup.targetClassId, parameters } });
  if (preview.status !== "ok") throw new Error("Lottning kunde inte granskas");
  expect(await commitClassStartDrawAsAdmin(db, { ...auth, idempotencyKey: `class-start-draw:${randomUUID()}`,
    request: { formatVersion: 1, classId: setup.targetClassId, parameters, expectedSnapshotVersion: preview.response.snapshotVersion,
      sourceHash: preview.response.sourceHash } })).toMatchObject({ status: "changed" });
  await db.update(schema.entries).set({ fixedStartTime: null }).where(eq(schema.entries.id, first!.id));
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/admin/${setup.raceId}/manage`);
  await signIn(page, setup.admin.accessCredential, "Före tävlingen", "Lottning & starttider");
  const report = page.locator("details").filter({ hasText: "Planerade startluckor" });
  await report.locator("summary").click();
  await report.getByRole("button", { name: "Visa startplan", exact: true }).click();
  await expect(report).toContainText("Minutstart testklass");
  await expect(report).toContainText("Ledig planerad tid");
  await expect(report).toContainText("Utan fast starttid: Plan Ett");
  await expect(report).toContainText("Obegränsat");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test("TASK049 samma admin fastställer klass och lopp med exakt retry", async ({ page }) => {
  const setup = await fixture(), deviceId = randomUUID();
  await page.setViewportSize({ width: 390, height: 900 });
  await page.goto(`/admin/${setup.raceId}/manage`);
  await expect(page.getByRole("button", { name: "Logga in", exact: true })).toBeEnabled();
  await signIn(page, setup.admin.accessCredential, "Efter tävlingen");
  await page.getByText("Resultatexport · IOF 3.0", { exact: true }).click();
  const refresh = page.getByRole("button", { name: "Hämta finaliseringsunderlag", exact: true });
  await refresh.click();
  const scope = page.getByRole("combobox", { name: "Klass eller hela loppet", exact: true });
  await scope.selectOption(setup.classId);
  await expect(page.getByRole("button", { name: "Granska fastställande", exact: true })).toBeDisabled();
  const payload = { cardNumber: "123456", startPunchedAt: "2026-09-12T10:30:00Z", finishPunchedAt: "2026-09-12T10:50:00Z",
    punches: [{ code: 31, punchedAt: "2026-09-12T10:40:00Z" }] };
  expect((await ingestDeviceBatch(db, setup.raceId, { deviceId, sessionId: deviceId, packageVersion: 1,
    firstSequence: 1, lastSequence: 1, events: [{ localSequence: 1, stationReceivedAt: "2026-09-12T10:50:00Z",
      transport: "simulator", payload, contentHash: createHash("sha256").update(JSON.stringify(payload)).digest("hex") }] })).acknowledgements[0]?.status).toBe("stored");
  await refresh.click();
  const writes: { key: string | undefined; body: string | null }[] = [];
  await page.route(`**/administrator/finalize`, async route => {
    writes.push({ key: route.request().headers()["idempotency-key"], body: route.request().postData() });
    const response = await route.fetch();
    if (writes.length === 1) await route.abort("failed"); else await route.fulfill({ response });
  });
  await page.getByRole("button", { name: "Granska fastställande", exact: true }).click();
  const review = page.getByRole("alert", { name: "Granska fastställande", exact: true });
  await expect(review).toContainText("Testklass");
  await expect(review.locator("details")).toHaveJSProperty("open", false);
  expect(writes).toHaveLength(0);
  await review.getByRole("button", { name: "Ändra val", exact: true }).click();
  await page.getByRole("button", { name: "Granska fastställande", exact: true }).click();
  await review.getByRole("button", { name: "Bekräfta fastställande", exact: true }).click();
  await expect(review).toContainText("Svaret saknas. Resultaten kan vara fastställda.");
  await expect(scope).toBeDisabled();
  await review.getByRole("button", { name: "Försök igen med samma begäran", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("Resultaten är fastställda");
  expect(writes).toHaveLength(2); expect(writes[1]).toEqual(writes[0]);
  await scope.selectOption("RACE");
  await page.getByRole("button", { name: "Granska fastställande", exact: true }).click();
  await review.getByRole("button", { name: "Bekräfta fastställande", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("Resultaten är fastställda");
  const rows = await db.select().from(schema.resultFinalizations).where(eq(schema.resultFinalizations.raceId, setup.raceId));
  expect(rows).toHaveLength(2); expect(rows.map(row => row.scope).sort()).toEqual(["CLASS", "RACE"]);
  const audit = await db.select().from(schema.auditEvents).where(eq(schema.auditEvents.raceId, setup.raceId));
  const finalAudit = audit.filter(row => row.actorKind === "RACE_ADMIN_ACCESS_CREDENTIAL" && row.action.includes("FINAL"));
  expect(finalAudit).toHaveLength(2);
  expect(rows.find(row => row.scope === "RACE")?.completeXml).toContain('status="Complete"');
});

test("TASK048 fryst Complete behålls efter senare avläsning", async ({ page }) => {
  const setup = await fixture(), deviceId = randomUUID();
  await page.goto(`/admin/${setup.raceId}/manage`);
  await expect(page.getByRole("button", { name: "Logga in", exact: true })).toBeEnabled();
  await signIn(page, setup.admin.accessCredential, "Efter tävlingen");
  await page.getByText("Resultatexport · IOF 3.0", { exact: true }).click();
  await page.getByRole("button", { name: "Hämta fastställda versioner", exact: true }).click();
  await expect(page.getByText("Inga fastställda loppresultat finns ännu.")).toBeVisible();
  async function ingest(sequence: number, finish: string) {
    const payload = { cardNumber: "123456", startPunchedAt: "2026-09-12T10:30:00Z", finishPunchedAt: finish,
      punches: [{ code: 31, punchedAt: "2026-09-12T10:40:00Z" }] };
    const result = await ingestDeviceBatch(db, setup.raceId, { deviceId, sessionId: deviceId, packageVersion: 1,
      firstSequence: sequence, lastSequence: sequence, events: [{ localSequence: sequence, stationReceivedAt: finish,
        transport: "simulator", payload, contentHash: createHash("sha256").update(JSON.stringify(payload)).digest("hex") }] });
    expect(result.acknowledgements[0]?.status).toBe("stored");
  }
  await ingest(1, "2026-09-12T10:50:00Z");
  // Synthetic fixture only: prepare a real finalization with its existing separate authority.
  const access = await issuePairingAdminAccessCredential(db, { raceId: setup.raceId, capability: "FINALIZE_RESULTS",
    label: "Syntetisk finaliseringsfixture", expiresAt: new Date(Date.now() + 3600_000) });
  const login = await loginPairingAdmin(db, { formatVersion: 1, accessCredential: access.accessCredential },
    { expectedRaceId: setup.raceId, expectedCapability: "FINALIZE_RESULTS" });
  if (login.status !== "authenticated") throw new Error("Fixture login failed");
  const auth = { raceId: setup.raceId, sessionToken: login.sessionToken, csrfCookie: login.csrfToken, csrfHeader: login.csrfToken };
  const candidates = await listResultFinalizationCandidatesAsAdmin(db, auth);
  if (candidates.status !== "ok") throw new Error("Missing fixture candidates");
  for (const row of candidates.response.classes.filter(row => row.entryCount > 0)) {
    expect((await finalizeResultsAsAdmin(db, { ...auth, idempotencyKey: `result-finalization:${randomUUID()}`,
      request: { formatVersion: 1, scope: "CLASS", classId: row.classId, expectedSnapshotVersion: candidates.response.snapshotVersion,
        expectedBasisHash: row.basisHash, expectedLatestScopeRevision: null } })).status).toBe("finalized");
  }
  const ready = await listResultFinalizationCandidatesAsAdmin(db, auth);
  if (ready.status !== "ok") throw new Error("Missing race candidate");
  const finalized = await finalizeResultsAsAdmin(db, { ...auth, idempotencyKey: `result-finalization:${randomUUID()}`,
    request: { formatVersion: 1, scope: "RACE", classId: null, expectedSnapshotVersion: ready.response.snapshotVersion,
      expectedBasisHash: ready.response.race.basisHash, expectedLatestScopeRevision: null } });
  if (finalized.status !== "finalized") throw new Error(`Finalization failed: ${finalized.status}`);
  const before = await db.select().from(schema.resultFinalizations).where(eq(schema.resultFinalizations.raceId, setup.raceId));
  const frozen = before.find(row => row.id === finalized.response.finalization.id)!;
  await ingest(2, "2026-09-12T10:55:00Z");
  await page.getByRole("button", { name: "Hämta fastställda versioner", exact: true }).click();
  await expect(page.getByRole("combobox", { name: "Fastställd version", exact: true })).toHaveValue(frozen.id);
  await expect(page.getByText(/Historiska Complete-filer/)).toBeVisible();
  const promised = page.waitForEvent("download");
  await page.getByRole("button", { name: "Ladda ner vald officiell resultatlista", exact: true }).click();
  const download = await promised, chunks: Buffer[] = [];
  for await (const chunk of await download.createReadStream()) chunks.push(Buffer.from(chunk as Uint8Array));
  const bytes = Buffer.concat(chunks);
  expect(bytes.toString("utf8")).toBe(frozen.completeXml);
  expect(bytes.toString("utf8")).toContain('status="Complete"');
  expect(createHash("sha256").update(bytes).digest("hex")).toBe(frozen.completeXmlHash);
  expect(download.suggestedFilename()).toBe(`otid-complete-result-list-${setup.raceId}-r1.xml`);
  await expect(page.getByRole("status")).toContainText("Officiell Complete-fil version 1 nedladdad");
  expect(await db.select().from(schema.resultFinalizations).where(eq(schema.resultFinalizations.raceId, setup.raceId))).toEqual(before);
  await page.getByRole("button", { name: "Logga ut", exact: true }).click();
  await expect(page.getByRole("combobox", { name: "Fastställd version", exact: true })).toHaveCount(0);
});

test("TASK047 Snapshot laddas ner med samma adminsession utan resultatändring", async ({ page }) => {
  const setup = await fixture(), deviceId = randomUUID();
  await db.insert(schema.entries).values({ id: randomUUID(), raceId: setup.raceId, classId: setup.classId,
    givenName: "Utan", familyName: "Resultat" });
  const payload = { cardNumber: "123456", startPunchedAt: "2026-09-12T10:30:00Z", finishPunchedAt: "2026-09-12T10:50:00Z",
    punches: [{ code: 31, punchedAt: "2026-09-12T10:40:00Z" }] };
  const ingested = await ingestDeviceBatch(db, setup.raceId, { deviceId, sessionId: deviceId, packageVersion: 1,
    firstSequence: 1, lastSequence: 1, events: [{ localSequence: 1, stationReceivedAt: "2026-09-12T10:50:00Z",
      transport: "simulator", payload, contentHash: createHash("sha256").update(JSON.stringify(payload)).digest("hex") }] });
  expect(ingested.acknowledgements[0]?.status).toBe("stored");
  const revisions = await db.select().from(schema.resultRevisions).where(eq(schema.resultRevisions.raceId, setup.raceId));
  const endpoint = `/api/admin/races/${setup.raceId}/administrator/result-export`;
  expect((await page.request.get(endpoint)).status()).toBe(401);
  await page.setViewportSize({ width: 390, height: 900 });
  await page.goto(`/admin/${setup.raceId}/manage`);
  await expect(page.getByRole("button", { name: "Logga in", exact: true })).toBeEnabled();
  await signIn(page, setup.admin.accessCredential, "Efter tävlingen");
  await page.getByText("Resultatexport · IOF 3.0", { exact: true }).click();
  await expect(page.getByText(/Filen innehåller personuppgifter/)).toBeVisible();
  const downloadButton = page.getByRole("button", { name: "Ladda ner aktuell IOF-resultatlista", exact: true });
  const downloadPromise = page.waitForEvent("download"), responsePromise = page.waitForResponse(response => response.url().endsWith(endpoint));
  await downloadButton.click();
  const download = await downloadPromise, response = await responsePromise;
  expect(download.suggestedFilename()).toBe(`otid-result-list-${setup.raceId}.xml`);
  const stream = await download.createReadStream(), chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk as Uint8Array));
  const bytes = Buffer.concat(chunks), xml = bytes.toString("utf8");
  expect(createHash("sha256").update(bytes).digest("hex")).toBe(response.headers()["x-otid-content-sha256"]);
  expect(response.headers()["cache-control"]).toContain("no-store");
  expect(xml).toContain('status="Snapshot"'); expect(xml).not.toContain('status="Complete"');
  expect(xml).toContain("Testperson"); expect(xml).not.toContain("DidNotStart");
  await expect(page.getByRole("status")).toContainText("1 resultat · 1 deltagare utelämnade · 0 resultat med äldre underlag");
  expect(await db.select().from(schema.resultRevisions).where(eq(schema.resultRevisions.raceId, setup.raceId))).toEqual(revisions);
  let downloads = 0; page.on("download", () => { downloads += 1; });
  await page.route(`**${endpoint}`, route => route.fulfill({ status: 409, contentType: "application/json", body: '{"error":"CONFLICT"}' }));
  await downloadButton.click();
  await expect(page.getByRole("status")).toContainText("Exporten kunde inte skapas");
  expect(downloads).toBe(0);
  await page.route(`**${endpoint}`, route => route.fulfill({ status: 200, headers: response.headers(),
    body: bytes.toString("utf8").replace("Testperson", "Felperson!") }));
  await downloadButton.click();
  await expect(page.getByRole("status")).toContainText("Ingen resultatfil laddades ner");
  expect(downloads).toBe(0);
});

async function checkCompactReview(page: Page, panel: Locator, statusChange: string, revisionText: string) {
  const review = panel.getByRole("alert"), details = review.locator("details");
  await expect(review.getByText(statusChange, { exact: true })).toBeVisible();
  await expect(review).toContainText("Åsa Testperson");
  await expect(details).toHaveJSProperty("open", false);
  await expect(details.getByText(revisionText, { exact: false })).not.toBeVisible();
  let requests = 0;
  const count = () => { requests += 1; };
  page.on("request", count);
  try {
    await details.locator("summary").focus();
    await page.keyboard.press("Enter");
    await expect(details).toHaveJSProperty("open", true);
    await expect(details.getByText(revisionText, { exact: false })).toBeVisible();
    await page.keyboard.press("Enter");
    await expect(details).toHaveJSProperty("open", false);
    expect(requests).toBe(0);
  } finally { page.off("request", count); }
  expect((await review.boundingBox())!.height).toBeLessThan(520);
}

async function fixture(options: { distinctTargetCourse?: boolean } = {}) {
  const eventId = randomUUID(), raceId = randomUUID(), courseId = randomUUID(), courseVersionId = randomUUID();
  const targetCourseId = options.distinctTargetCourse ? randomUUID() : courseId;
  const targetCourseVersionId = options.distinctTargetCourse ? randomUUID() : courseVersionId;
  const classId = randomUUID(), targetClassId = randomUUID(), entryId = randomUUID();
  await db.insert(schema.events).values({ id: eventId, name: "Syntetiskt adminprov", startsOn: "2026-09-12", timeZone: "Europe/Stockholm" });
  await db.insert(schema.races).values({ id: raceId, eventId, name: "Adminprov", raceDate: "2026-09-12" });
  await db.insert(schema.courses).values({ id: courseId, raceId, name: "Testbana" });
  await db.insert(schema.courseVersions).values({ id: courseVersionId, courseId, version: 1 });
  if (options.distinctTargetCourse) {
    await db.insert(schema.courses).values({ id: targetCourseId, raceId, name: "Minutstartbana" });
    await db.insert(schema.courseVersions).values({ id: targetCourseVersionId, courseId: targetCourseId, version: 1 });
  }
  const controlId = randomUUID();
  await db.insert(schema.controls).values({ id: controlId, raceId, code: 31 });
  await db.insert(schema.courseControls).values({ courseVersionId, controlId, sequence: 1 });
  if (options.distinctTargetCourse) await db.insert(schema.courseControls).values({ courseVersionId: targetCourseVersionId, controlId, sequence: 1 });
  await db.insert(schema.classes).values([
    { id: classId, raceId, name: "Testklass", courseVersionId, startRule: "PUNCH" },
    { id: targetClassId, raceId, name: "Minutstart testklass", courseVersionId: targetCourseVersionId, startRule: "FIXED" }
  ]);
  await db.insert(schema.entries).values({ id: entryId, raceId, classId, givenName: "Åsa", familyName: "Testperson", organisationName: "Test OK" });
  const [assignment] = await db.insert(schema.cardAssignments).values({ raceId, entryId, cardNumber: "123456" })
    .returning({ id: schema.cardAssignments.id });
  if (!assignment) throw new Error("Synthetic card assignment missing");
  const admin = await issuePairingAdminAccessCredential(db, { raceId, capability: "MANAGE_RACE",
    label: "Syntetisk browseradmin", expiresAt: new Date(Date.now() + 3600_000) });
  return { raceId, entryId, assignmentId: assignment.id, classId, targetClassId, courseId, courseVersionId, targetCourseVersionId, admin };
}

test("TASK142 administratör markerar betalstatus med exakt retry", async ({ page }) => {
  const setup = await fixture();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/admin/${setup.raceId}/manage`);
  await signIn(page, setup.admin.accessCredential);
  await page.getByRole("button", { name: "Åsa Testperson Test OK", exact: true }).click();
  const work = page.locator('[data-panel="WORK"]');
  await work.getByRole("button", { name: "Ändra betalningsmarkering", exact: true }).click();
  const paymentStatus = work.getByRole("combobox", { name: "Ny betalstatus", exact: true });
  await expect(paymentStatus).toHaveValue("UNMARKED");
  await paymentStatus.selectOption("PAID");
  await expect(paymentStatus).toHaveValue("PAID");
  await work.getByRole("button", { name: "Granska betalstatus", exact: true }).click();
  const review = work.getByRole("alert");
  await expect(review).toContainText("Aktuell betalstatus: Inte markerad → Betald");
  const requests: string[] = [];
  await page.route(`**/administrator/entries/${setup.entryId}/payment-status`, async route => {
    if (route.request().method() !== "PATCH") return route.continue();
    requests.push(route.request().postData() ?? "");
    const response = await route.fetch();
    expect(response.status()).toBe(200);
    if (requests.length === 1) await route.abort("failed"); else await route.fulfill({ response });
  });
  await review.getByRole("button", { name: "Bekräfta betalstatus", exact: true }).click();
  await expect(review).toContainText("Svaret saknas. Betalstatusen kan vara sparad.");
  await review.getByRole("button", { name: "Försök igen med samma begäran", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("Betalstatusen är sparad.");
  expect(requests).toHaveLength(2); expect(requests[1]).toBe(requests[0]);
  expect(JSON.parse(requests[0] ?? "{}")).toMatchObject({ expectedPaymentStatus: "UNMARKED",
    expectedPaymentStatusVersion: 1, paymentStatus: "PAID" });
  const [entry] = await db.select().from(schema.entries).where(eq(schema.entries.id, setup.entryId));
  expect(entry).toMatchObject({ paymentStatus: "PAID", paymentStatusVersion: 2, version: 1 });
  const [race] = await db.select().from(schema.races).where(eq(schema.races.id, setup.raceId));
  expect(race?.snapshotVersion).toBe(1);
  const changes = await db.select().from(schema.entryPaymentStatusChanges)
    .where(eq(schema.entryPaymentStatusChanges.raceId, setup.raceId));
  expect(changes).toHaveLength(1);
  expect(changes[0]).toMatchObject({ entryId: setup.entryId, previousPaymentStatus: "UNMARKED", paymentStatus: "PAID",
    entryVersionAtChange: 1, paymentStatusVersionBefore: 1, paymentStatusVersionAfter: 2, capability: "MANAGE_RACE" });
  await expect(page.locator('[data-panel="LIST"] tbody tr').filter({ hasText: "Åsa Testperson" }))
    .toContainText("Betalning · Betald");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test("TASK109 väljer en serververifierad framtida lottad minutstart vid klassbyte", async ({ page }) => {
  const setup = await fixture(), occupiedId = randomUUID(), departedId = randomUUID(), drawId = randomUUID();
  const occupiedAt = "2026-10-12T10:02:00.000Z", vacantAt = "2026-10-12T10:03:00.000Z";
  await db.insert(schema.entries).values([
    { id: occupiedId, raceId: setup.raceId, classId: setup.targetClassId, givenName: "Bo", familyName: "Kvar", fixedStartTime: new Date(occupiedAt) },
    { id: departedId, raceId: setup.raceId, classId: setup.classId, givenName: "Cid", familyName: "Flyttad" }
  ]);
  await db.update(schema.races).set({ snapshotVersion: 2 }).where(eq(schema.races.id, setup.raceId));
  await db.insert(schema.classStartDrawRequests).values({ id: drawId, requestId: randomUUID(), raceId: setup.raceId,
    classId: setup.targetClassId, actorCredentialId: setup.admin.credentialId, sourceHash: "a".repeat(64), timeZone: "Europe/Stockholm",
    algorithmVersion: "task109-browser", seed: 1, firstStartTime: new Date(occupiedAt), intervalSeconds: 60,
    entryCount: 2, changedEntryCount: 2, snapshotVersionBefore: 1, snapshotVersionAfter: 2, changedAt: new Date("2026-09-20T10:00:00.000Z") });
  await db.insert(schema.classStartDrawItems).values([
    { drawRequestId: drawId, entryId: occupiedId, displayName: "Bo Kvar", previousFixedStartTime: new Date(occupiedAt), fixedStartTime: new Date(occupiedAt), entryVersionBefore: 1, entryVersionAfter: 1 },
    { drawRequestId: drawId, entryId: departedId, displayName: "Cid Flyttad", previousFixedStartTime: null, fixedStartTime: new Date(vacantAt), entryVersionBefore: 1, entryVersionAfter: 2 }
  ]);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/admin/${setup.raceId}/manage`);
  await signIn(page, setup.admin.accessCredential);
  await page.getByRole("button", { name: "Åsa Testperson Test OK", exact: true }).click();
  const work = page.locator('[data-panel="WORK"]');
  await expect(work.getByRole("heading", { name: "Byt klass", exact: true })).toBeVisible();
  const targetClass = work.locator("form select").first();
  await expect(targetClass).toBeEnabled();
  await targetClass.selectOption(setup.targetClassId);
  const slot = work.locator("form select").nth(1);
  await expect(slot).toBeVisible();
  await slot.selectOption(vacantAt);
  await work.getByRole("button", { name: "Granska klassbyte", exact: true }).click();
  await expect(work.getByText("Ny fast starttid:", { exact: false })).toContainText("2026-10-12T10:03:00.000Z");
  await work.getByRole("button", { name: "Bekräfta klassbyte", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("Klassbytet och starttiden är sparade.");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  const assignments = await db.select().from(schema.entryStartSlotAssignments).where(eq(schema.entryStartSlotAssignments.raceId, setup.raceId));
  expect(assignments).toHaveLength(1); expect(assignments[0]).toMatchObject({ entryId: setup.entryId, drawRequestId: drawId, fixedStartTime: new Date(vacantAt) });
});

test("TASK110 direktanmäler till en lottad minutstart och återförsöker exakt", async ({ page }) => {
  const setup = await fixture(), drawId = randomUUID(), sourceHash = "b".repeat(64);
  const vacantAt = "2026-10-12T10:03:00.000Z", base = `/api/admin/races/${setup.raceId}/administrator`;
  await db.update(schema.races).set({ snapshotVersion: 2 }).where(eq(schema.races.id, setup.raceId));
  await db.insert(schema.classStartDrawRequests).values({ id: drawId, requestId: randomUUID(), raceId: setup.raceId,
    classId: setup.targetClassId, actorCredentialId: setup.admin.credentialId, sourceHash, timeZone: "Europe/Stockholm",
    algorithmVersion: "task110-browser", seed: 1, firstStartTime: new Date(vacantAt), intervalSeconds: 60,
    entryCount: 1, changedEntryCount: 1, snapshotVersionBefore: 1, snapshotVersionAfter: 2, changedAt: new Date("2026-09-20T10:00:00.000Z") });
  await db.insert(schema.classStartDrawItems).values({ drawRequestId: drawId, entryId: setup.entryId,
    displayName: "Åsa Testperson", previousFixedStartTime: null, fixedStartTime: new Date(vacantAt), entryVersionBefore: 1, entryVersionAfter: 2 });
  const requests: { key: string | undefined; body: string | null }[] = [];
  await page.route(`**${base}/registration`, async route => {
    requests.push({ key: route.request().headers()["idempotency-key"], body: route.request().postData() });
    const response = await route.fetch();
    if (requests.length === 1) await route.abort("failed"); else await route.fulfill({ response });
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/admin/${setup.raceId}/manage`);
  await signIn(page, setup.admin.accessCredential);
  await page.getByRole("button", { name: "Ny deltagare", exact: true }).click();
  await page.getByRole("combobox", { name: "Anmälningsklass", exact: true }).selectOption(setup.targetClassId);
  const slot = page.getByRole("combobox", { name: "Ledig lottad starttid", exact: true });
  await expect(slot).toBeVisible(); await slot.selectOption(vacantAt);
  await page.getByLabel("Förnamn", { exact: true }).fill("Lottad");
  await page.getByLabel("Efternamn", { exact: true }).fill("Direktanmäld");
  await page.getByLabel("Bricknummer (valfritt)", { exact: true }).fill("765432");
  await page.getByRole("button", { name: "Granska anmälan", exact: true }).click();
  await page.getByRole("button", { name: "Bekräfta anmälan", exact: true }).click();
  await expect(page.getByRole("button", { name: "Försök igen med samma begäran", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Försök igen med samma begäran", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("Deltagaren är anmäld.");
  expect(requests).toHaveLength(2); expect(requests[1]).toEqual(requests[0]);
  expect(JSON.parse(requests[0]!.body ?? "{}")).toMatchObject({ fixedStartTime: vacantAt, expectedTargetCapacityVersion: 1,
    assignedStartSlot: { drawRequestId: drawId, sourceHash, fixedStartTime: vacantAt } });
  const registrations = await db.select().from(schema.entryRegistrationRequests).where(eq(schema.entryRegistrationRequests.raceId, setup.raceId));
  const assignments = await db.select().from(schema.entryRegistrationStartSlotAssignments).where(eq(schema.entryRegistrationStartSlotAssignments.raceId, setup.raceId));
  expect(registrations).toHaveLength(1); expect(assignments).toHaveLength(1);
  expect(assignments[0]).toMatchObject({ registrationRequestId: registrations[0]?.id, drawRequestId: drawId,
    sourceHash, fixedStartTime: new Date(vacantAt), capability: "MANAGE_RACE" });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test("TASK102 admin utfärdar och spärrar kortvarig startåtkomst utan lokal kodlagring", async ({ page }) => {
  const setup = await fixture();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/admin/${setup.raceId}/manage`);
  await signIn(page, setup.admin.accessCredential, "Före tävlingen", "Funktionärer");
  const panel = page.locator("details").filter({ has: page.locator('select[name="capability"]') });
  await panel.locator("summary").click();
  await expect(panel).toHaveAttribute("open", "");
  await panel.locator('select[name="capability"]').selectOption("START_CHECKIN");
  await panel.locator('input[name="label"]').fill("Start vid bryggan");
  const expiry = new Date(Date.now() + 2 * 60 * 60 * 1000);
  expiry.setMinutes(expiry.getMinutes() - expiry.getTimezoneOffset());
  await panel.locator('input[name="expiresAt"]').fill(expiry.toISOString().slice(0, 16));
  let issueRequests = 0;
  page.on("request", request => {
    if (request.method() === "POST" && request.url().endsWith(`/api/admin/races/${setup.raceId}/administrator/operator-access`)) issueRequests += 1;
  });
  await page.getByRole("button", { name: "Utfärda åtkomst", exact: true }).click();
  const code = page.locator("output");
  await expect(code).toHaveText(/^otid_org_start_checkin_v1\./);
  const accessCredential = await code.textContent();
  if (!accessCredential) throw new Error("Synthetic operator credential missing");
  expect(issueRequests).toBe(1);
  const browserStorage = await page.evaluate(() => JSON.stringify({ local: { ...localStorage }, session: { ...sessionStorage } }));
  expect(browserStorage).not.toContain(accessCredential);
  await page.getByRole("button", { name: "Jag har kopierat koden", exact: true }).click();
  await expect(code).toHaveCount(0);
  await page.getByRole("button", { name: "Hämta utfärdade behörigheter", exact: true }).click();
  const access = page.locator("article").filter({ hasText: "Startpersonal · Start vid bryggan" });
  await expect(access).toContainText("Aktiv");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  const login = await loginPairingAdmin(db, { formatVersion: 1, accessCredential }, {
    expectedRaceId: setup.raceId, expectedCapability: "START_CHECKIN"
  });
  expect(login.status).toBe("authenticated");
  await access.getByRole("button", { name: "Spärra", exact: true }).click();
  await expect(access).toContainText("Spärrad");
  expect((await loginPairingAdmin(db, { formatVersion: 1, accessCredential }, {
    expectedRaceId: setup.raceId, expectedCapability: "START_CHECKIN"
  })).status).toBe("unauthorized");
  const audit = await db.select({ action: schema.auditEvents.action, actorId: schema.auditEvents.actorId }).from(schema.auditEvents)
    .where(and(eq(schema.auditEvents.raceId, setup.raceId), eq(schema.auditEvents.entityType, "web_operator_access")));
  expect(audit).toEqual(expect.arrayContaining([
    { action: "WEB_OPERATOR_ACCESS_ISSUED", actorId: setup.admin.credentialId },
    { action: "WEB_OPERATOR_ACCESS_REVOKED", actorId: setup.admin.credentialId }
  ]));
});

async function appendControlToCourseVersion(raceId: string, courseVersionId: string, code: number, sequence: number) {
  const controlId = randomUUID();
  await db.insert(schema.controls).values({ id: controlId, raceId, code });
  await db.insert(schema.courseControls).values({ courseVersionId, controlId, sequence });
}

test("TASK081 granskar och retryar manuell bana och klass utan sidscroll", async ({ page }) => {
  const setup = await fixture();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/admin/${setup.raceId}/manage`);
  await page.getByLabel("Administratörsbehörighet", { exact: true }).fill(setup.admin.accessCredential);
  const loginResponse = page.waitForResponse(response => response.request().method() === "POST" &&
    response.url().endsWith(`/api/admin/races/${setup.raceId}/administrator/session`));
  await page.getByRole("button", { name: "Logga in", exact: true }).click();
  expect((await loginResponse).status()).toBe(200);
  await page.getByRole("button", { name: "Före tävlingen", exact: true }).click();
  await page.getByRole("navigation", { name: "Tävlingsförberedelser", exact: true })
    .getByRole("button", { name: "Banor", exact: true }).click();
  const panel = page.locator("details").filter({ hasText: "Förbered bana och klass" });
  await expect(panel).toHaveJSProperty("open", false);
  await panel.locator("summary").click();
  await panel.getByLabel("Bannamn", { exact: true }).fill("Bana 081");
  await panel.getByLabel("Klassnamn", { exact: true }).fill("Klass 081");
  await panel.getByLabel("Kontrollföljd", { exact: true }).fill("31, 31 32");
  await panel.getByRole("button", { name: "Granska bana och klass", exact: true }).click();
  await expect(panel.getByRole("alert")).toContainText("31 → 31 → 32");
  await expect(panel.getByRole("alert")).toContainText("Ingen ändring har sparats ännu.");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  const requests: { key: string | undefined; body: string | null }[] = [];
  await page.route(`**/api/admin/races/${setup.raceId}/administrator/course-classes`, async route => {
    requests.push({ key: route.request().headers()["idempotency-key"], body: route.request().postData() });
    if (requests.length === 1) {
      const committed = await route.fetch();
      expect(committed.status()).toBe(200);
      return route.abort("failed");
    }
    await route.continue();
  });
  await panel.getByRole("alert").getByRole("button", { name: "Bekräfta och spara", exact: true }).click();
  await expect(panel).toContainText("Svaret saknas. Banan och klassen kan vara sparade.");
  await panel.getByRole("button", { name: "Bekräfta och spara", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("Banan och klassen är sparade.");
  expect(requests).toHaveLength(2);
  expect(requests[1]?.key).toBe(requests[0]?.key);
  expect(requests[1]?.body).toBe(requests[0]?.body);
  const competitionStatus = page.getByRole("region", { name: "Tävlingsstatus", exact: true });
  await expect(competitionStatus.locator("dl > div").filter({ hasText: "Klasser" }).first().locator("dd")).toHaveText("3");
  const createdCourses = (await db.select().from(schema.courses).where(eq(schema.courses.raceId, setup.raceId)))
    .filter(row => row.name === "Bana 081");
  expect(createdCourses).toHaveLength(1);
  const [version] = await db.select().from(schema.courseVersions).where(eq(schema.courseVersions.courseId, createdCourses[0]!.id));
  expect(version?.version).toBe(1);
  const createdClasses = (await db.select().from(schema.classes).where(eq(schema.classes.raceId, setup.raceId)))
    .filter(row => row.name === "Klass 081");
  expect(createdClasses).toHaveLength(1);
  expect(createdClasses[0]).toMatchObject({ courseVersionId: version?.id, startRule: "PUNCH", externalSource: null, externalId: null });
  const sequence = await db.select({ code: schema.controls.code }).from(schema.courseControls)
    .innerJoin(schema.controls, eq(schema.controls.id, schema.courseControls.controlId))
    .where(eq(schema.courseControls.courseVersionId, version!.id)).orderBy(schema.courseControls.sequence);
  expect(sequence.map(row => row.code)).toEqual([31, 31, 32]);
  expect(await db.select().from(schema.manualCourseClassCreateRequests)
    .where(eq(schema.manualCourseClassCreateRequests.raceId, setup.raceId))).toHaveLength(1);
});

test("TASK082 granskar och retryar ny banversion för en resultatfri manuell klass", async ({ page }) => {
  const setup = await fixture();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/admin/${setup.raceId}/manage`);
  await page.getByLabel("Administratörsbehörighet", { exact: true }).fill(setup.admin.accessCredential);
  const loginResponse = page.waitForResponse(response => response.request().method() === "POST" &&
    response.url().endsWith(`/api/admin/races/${setup.raceId}/administrator/session`));
  await page.getByRole("button", { name: "Logga in", exact: true }).click();
  expect((await loginResponse).status()).toBe(200);
  await page.getByRole("button", { name: "Före tävlingen", exact: true }).click();
  await page.getByRole("navigation", { name: "Tävlingsförberedelser", exact: true })
    .getByRole("button", { name: "Banor", exact: true }).click();
  const panel = page.locator("details").filter({ hasText: "Ändra bana för befintlig klass" });
  await expect(panel).toHaveJSProperty("open", false);
  await panel.locator("summary").click();
  await panel.locator("select").selectOption(setup.classId);
  await panel.getByRole("button", { name: "Hämta påverkan", exact: true }).click();
  await expect(panel).toContainText("Testbana");
  await expect(panel).toContainText("Nuvarande banversion: 1");
  await expect(panel).toContainText("Deltagare: 1 · Resultatrevisioner: 0");
  await expect(panel).toContainText("31");
  await panel.locator("textarea").fill("31, 31 42");
  await panel.getByRole("checkbox", { name: "Jag har granskat påverkan och förstår att en ny banversion skapas.", exact: true }).check();
  await panel.getByRole("button", { name: "Granska ny banversion", exact: true }).click();
  const review = panel.locator("section[role=alert]");
  await expect(review).toContainText("1 → 2");
  await expect(review).toContainText("31 → 31 → 42");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  const requests: { key: string | undefined; body: string | null }[] = [];
  await page.route(`**/api/admin/races/${setup.raceId}/administrator/classes/${setup.classId}/course-version-link`, async route => {
    if (route.request().method() !== "POST") return route.continue();
    requests.push({ key: route.request().headers()["idempotency-key"], body: route.request().postData() });
    if (requests.length === 1) {
      const committed = await route.fetch();
      expect(committed.status()).toBe(200);
      return route.abort("failed");
    }
    await route.continue();
  });
  await review.getByRole("button", { name: "Skapa ny banversion och länka om klassen", exact: true }).click();
  await expect(review).toContainText("Svaret saknas. Ändringen kan vara sparad.");
  await review.getByRole("button", { name: "Skapa ny banversion och länka om klassen", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("Ny banversion är skapad och klassen är länkad till den.");
  expect(requests).toHaveLength(2); expect(requests[1]?.key).toBe(requests[0]?.key); expect(requests[1]?.body).toBe(requests[0]?.body);
  const [raceClass] = await db.select().from(schema.classes).where(eq(schema.classes.id, setup.classId));
  expect(raceClass?.courseVersionId).not.toBe(setup.courseVersionId);
  const [newVersion] = await db.select().from(schema.courseVersions).where(eq(schema.courseVersions.id, raceClass!.courseVersionId));
  expect(newVersion).toMatchObject({ courseId: setup.courseId, version: 2 });
  const sequence = await db.select({ code: schema.controls.code }).from(schema.courseControls)
    .innerJoin(schema.controls, eq(schema.controls.id, schema.courseControls.controlId))
    .where(eq(schema.courseControls.courseVersionId, newVersion!.id)).orderBy(schema.courseControls.sequence);
  expect(sequence.map(row => row.code)).toEqual([31, 31, 42]);
  const [entry] = await db.select().from(schema.entries).where(eq(schema.entries.id, setup.entryId));
  expect(entry).toMatchObject({ classId: setup.classId, version: 1, fixedStartTime: null });
  expect(await db.select().from(schema.manualCourseVersionClassRelinkRequests)
    .where(eq(schema.manualCourseVersionClassRelinkRequests.raceId, setup.raceId))).toHaveLength(1);
});

test("TASK083 visar resultatpåverkan utan att skriva bana eller resultat", async ({ page }) => {
  const setup = await fixture();
  const payload = { cardNumber: "123456", startPunchedAt: "2026-09-12T08:00:00Z", finishPunchedAt: "2026-09-12T08:20:00Z",
    punches: [{ code: 31, punchedAt: "2026-09-12T08:10:00Z" }] };
  const deviceId = randomUUID();
  const ingest = await ingestDeviceBatch(db, setup.raceId, { deviceId, sessionId: deviceId, packageVersion: 1,
    firstSequence: 1, lastSequence: 1, events: [{ localSequence: 1, stationReceivedAt: "2026-09-12T08:21:00Z",
      transport: "simulator", payload, contentHash: createHash("sha256").update(JSON.stringify(payload)).digest("hex") }] });
  expect(ingest.acknowledgements[0]?.status).toBe("stored");
  const [beforeRace] = await db.select({ snapshotVersion: schema.races.snapshotVersion }).from(schema.races).where(eq(schema.races.id, setup.raceId));
  const [beforeClass] = await db.select({ courseVersionId: schema.classes.courseVersionId }).from(schema.classes).where(eq(schema.classes.id, setup.classId));
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/admin/${setup.raceId}/manage`);
  await signIn(page, setup.admin.accessCredential, "Före tävlingen", "Banor");
  const panel = page.locator("details").filter({ hasText: "Se resultatpåverkan före banrättning" });
  await expect(panel).toHaveJSProperty("open", false);
  await panel.locator("summary").click();
  await panel.locator("select").selectOption(setup.classId);
  await panel.getByRole("button", { name: "Hämta resultatpåverkan", exact: true }).click();
  await expect(panel).toContainText("Testbana");
  await expect(panel).toContainText("Åsa Testperson");
  await expect(panel).toContainText("Ingen ändring har sparats. Resultat räknas inte om automatiskt.");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  const [afterRace] = await db.select({ snapshotVersion: schema.races.snapshotVersion }).from(schema.races).where(eq(schema.races.id, setup.raceId));
  const [afterClass] = await db.select({ courseVersionId: schema.classes.courseVersionId }).from(schema.classes).where(eq(schema.classes.id, setup.classId));
  expect(afterRace).toEqual(beforeRace); expect(afterClass).toEqual(beforeClass);
  expect(await db.select().from(schema.resultRevisions).where(eq(schema.resultRevisions.entryId, setup.entryId))).toHaveLength(1);
});

test("TASK084 rättar manuell bana efter resultat utan automatisk omräkning", async ({ page }) => {
  const setup = await fixture();
  const payload = { cardNumber: "123456", startPunchedAt: "2026-09-12T08:00:00Z", finishPunchedAt: "2026-09-12T08:20:00Z",
    punches: [{ code: 31, punchedAt: "2026-09-12T08:10:00Z" }] };
  const deviceId = randomUUID();
  const ingest = await ingestDeviceBatch(db, setup.raceId, { deviceId, sessionId: deviceId, packageVersion: 1,
    firstSequence: 1, lastSequence: 1, events: [{ localSequence: 1, stationReceivedAt: "2026-09-12T08:21:00Z",
      transport: "simulator", payload, contentHash: createHash("sha256").update(JSON.stringify(payload)).digest("hex") }] });
  expect(ingest.acknowledgements[0]?.status).toBe("stored");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/admin/${setup.raceId}/manage`);
  await signIn(page, setup.admin.accessCredential, "Före tävlingen", "Banor");
  const panel = page.locator("details").filter({ hasText: "Rätta bana efter resultat" });
  await expect(panel).toHaveJSProperty("open", false);
  await panel.locator("summary").click();
  await panel.locator("select").selectOption(setup.classId);
  await panel.getByRole("button", { name: "Hämta säkrat underlag", exact: true }).click();
  await expect(panel).toContainText("Testbana"); await expect(panel).toContainText("Åsa Testperson");
  await panel.locator("textarea").fill("31, 31 42");
  await panel.getByRole("checkbox", { name: "Jag förstår att gamla resultat och beslut bevaras och att ingen omräkning sker automatiskt.", exact: true }).check();
  await panel.getByRole("button", { name: "Granska banrättning", exact: true }).click();
  const review = panel.locator("section[role=alert]");
  await expect(review).toContainText("1 → 2"); await expect(review).toContainText("31 → 31 → 42");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  const requests: { key: string | undefined; body: string | null }[] = [];
  await page.route(`**/api/admin/races/${setup.raceId}/administrator/classes/${setup.classId}/course-result-bearing-link`, async route => {
    if (route.request().method() !== "POST") return route.continue();
    requests.push({ key: route.request().headers()["idempotency-key"], body: route.request().postData() });
    if (requests.length === 1) { const committed = await route.fetch(); expect(committed.status()).toBe(200); return route.abort("failed"); }
    await route.continue();
  });
  await review.getByRole("button", { name: "Skapa ny banversion och behåll resultatens historik", exact: true }).click();
  await expect(review).toContainText("Svaret saknas. Ändringen kan vara sparad.");
  await review.getByRole("button", { name: "Skapa ny banversion och behåll resultatens historik", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("Ny banversion är skapad. Äldre resultat och beslut är bevarade");
  expect(requests).toHaveLength(2); expect(requests[1]?.key).toBe(requests[0]?.key); expect(requests[1]?.body).toBe(requests[0]?.body);
  const [raceClass] = await db.select().from(schema.classes).where(eq(schema.classes.id, setup.classId));
  expect(raceClass?.courseVersionId).not.toBe(setup.courseVersionId);
  const revisions = await db.select().from(schema.resultRevisions).where(eq(schema.resultRevisions.entryId, setup.entryId));
  expect(revisions).toHaveLength(1); expect(revisions[0]?.courseVersionId).toBe(setup.courseVersionId);
});

test("TASK135 flyttar en MP och en resultatlös deltagare till separat kortklass med exakt retry", async ({ page }) => {
  const setup = await fixture(), noResultEntryId = randomUUID(), deviceId = randomUUID();
  await appendControlToCourseVersion(setup.raceId, setup.courseVersionId, 42, 2);
  await db.insert(schema.entries).values({ id: noResultEntryId, raceId: setup.raceId, classId: setup.classId,
    givenName: "Bo", familyName: "Utan resultat", organisationName: "Test OK" });
  const payload = { cardNumber: "123456", startPunchedAt: "2026-09-12T08:00:00Z", finishPunchedAt: "2026-09-12T08:20:00Z",
    punches: [{ code: 31, punchedAt: "2026-09-12T08:10:00Z" }] };
  const ingest = await ingestDeviceBatch(db, setup.raceId, { deviceId, sessionId: deviceId, packageVersion: 1,
    firstSequence: 1, lastSequence: 1, events: [{ localSequence: 1, stationReceivedAt: "2026-09-12T08:21:00Z",
      transport: "simulator", payload, contentHash: createHash("sha256").update(JSON.stringify(payload)).digest("hex") }] });
  expect(ingest.acknowledgements[0]?.status).toBe("stored");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/admin/${setup.raceId}/manage`);
  await signIn(page, setup.admin.accessCredential, "Före tävlingen", "Banor");
  const panel = page.locator("details").filter({ hasText: "Flytta till kortare bana" });
  await panel.locator("summary").click();
  await page.getByRole("combobox", { name: "Källklass", exact: true }).selectOption(setup.classId);
  await panel.getByRole("button", { name: "Hämta säkrat underlag", exact: true }).click();
  await expect(panel).toContainText("Testbana");
  await expect(panel).toContainText("31 → 42");
  await panel.getByLabel("Namn på kortbana", { exact: true }).fill("Testbana kort");
  await panel.getByLabel("Namn på ny klass", { exact: true }).fill("Testklass kort");
  const candidates = panel.locator("fieldset").getByRole("checkbox");
  await expect(candidates).toHaveCount(2);
  await candidates.nth(0).check(); await candidates.nth(1).check();
  await panel.getByRole("button", { name: "Granska kortbaneflytt", exact: true }).click();
  const review = panel.locator("section[role=alert]");
  await expect(review).toContainText("Testklass → Testklass kort");
  await expect(review).toContainText("31");
  await expect(review).toContainText("MP från brickavläsning");
  await expect(review).toContainText("Inget resultat – flyttas utan resultat");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  const requests: { key: string | undefined; body: string | null }[] = [];
  await page.route(`**/api/admin/races/${setup.raceId}/administrator/classes/${setup.classId}/shortened-course-transfer`, async route => {
    if (route.request().method() !== "POST") return route.continue();
    requests.push({ key: route.request().headers()["idempotency-key"], body: route.request().postData() });
    if (requests.length === 1) { const committed = await route.fetch(); expect(committed.status()).toBe(200); return route.abort("failed"); }
    await route.continue();
  });
  await review.getByRole("button", { name: "Skapa kortbana och flytta deltagare", exact: true }).click();
  await expect(review).toContainText("Svaret saknas. Flytten kan vara sparad.");
  await review.getByRole("button", { name: "Skapa kortbana och flytta deltagare", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("Kortbana och ny klass är skapade.");
  expect(requests).toHaveLength(2); expect(requests[1]?.key).toBe(requests[0]?.key); expect(requests[1]?.body).toBe(requests[0]?.body);
  const [shortClass] = await db.select().from(schema.classes).where(and(eq(schema.classes.raceId, setup.raceId), eq(schema.classes.name, "Testklass kort")));
  expect(shortClass).toBeDefined();
  const moved = await db.select().from(schema.entries).where(eq(schema.entries.raceId, setup.raceId));
  expect(moved.filter(entry => entry.id === setup.entryId || entry.id === noResultEntryId)
    .every(entry => entry.classId === shortClass?.id && entry.version === 2)).toBe(true);
  const revisions = await db.select({ revision: schema.resultRevisions.revision, cause: schema.resultRevisions.cause,
    status: schema.resultRevisions.status, courseVersionId: schema.resultRevisions.courseVersionId })
    .from(schema.resultRevisions).where(eq(schema.resultRevisions.entryId, setup.entryId)).orderBy(schema.resultRevisions.revision);
  expect(revisions).toEqual([
    expect.objectContaining({ revision: 1, cause: "CARD_READOUT", status: "MP", courseVersionId: setup.courseVersionId }),
    expect.objectContaining({ revision: 2, cause: "SHORTENED_COURSE_CLASS_TRANSFER", status: "OK", courseVersionId: shortClass?.courseVersionId })
  ]);
  expect(await db.select().from(schema.shortenedCourseClassTransfers).where(eq(schema.shortenedCourseClassTransfers.raceId, setup.raceId))).toHaveLength(1);
  expect(await db.select().from(schema.shortenedCourseClassTransferItems).where(eq(schema.shortenedCourseClassTransferItems.raceId, setup.raceId))).toHaveLength(2);
});

test("TASK097 stoppar avkortat banprefix före något skriv-anrop", async ({ page }) => {
  const setup = await fixture();
  await appendControlToCourseVersion(setup.raceId, setup.courseVersionId, 42, 2);
  const payload = { cardNumber: "123456", startPunchedAt: "2026-09-12T08:00:00Z", finishPunchedAt: "2026-09-12T08:20:00Z",
    punches: [{ code: 31, punchedAt: "2026-09-12T08:10:00Z" }, { code: 42, punchedAt: "2026-09-12T08:15:00Z" }] };
  const deviceId = randomUUID();
  const ingest = await ingestDeviceBatch(db, setup.raceId, { deviceId, sessionId: deviceId, packageVersion: 1,
    firstSequence: 1, lastSequence: 1, events: [{ localSequence: 1, stationReceivedAt: "2026-09-12T08:21:00Z",
      transport: "simulator", payload, contentHash: createHash("sha256").update(JSON.stringify(payload)).digest("hex") }] });
  expect(ingest.acknowledgements[0]?.status).toBe("stored");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/admin/${setup.raceId}/manage`);
  await signIn(page, setup.admin.accessCredential, "Före tävlingen", "Banor");
  const panel = page.locator("details").filter({ hasText: "Rätta bana efter resultat" });
  await panel.locator("summary").click();
  await panel.locator("select").selectOption(setup.classId);
  await panel.getByRole("button", { name: "Hämta säkrat underlag", exact: true }).click();
  await expect(panel).toContainText("31 → 42");
  await panel.locator("textarea").fill("31");
  await panel.getByRole("checkbox", { name: "Jag förstår att gamla resultat och beslut bevaras och att ingen omräkning sker automatiskt.", exact: true }).check();
  let writes = 0;
  page.on("request", request => {
    if (request.method() === "POST" && new URL(request.url()).pathname.endsWith("/course-result-bearing-link")) writes += 1;
  });
  await panel.getByRole("button", { name: "Granska banrättning", exact: true }).click();
  await expect(panel).toContainText("En avkortad bana kan inte sparas som banrättning efter resultat.");
  expect(writes).toBe(0);
  expect(await db.select().from(schema.courseVersions).where(eq(schema.courseVersions.courseId, setup.courseId))).toHaveLength(1);
  expect(await db.select().from(schema.manualCourseVersionClassRelinkRequests)
    .where(eq(schema.manualCourseVersionClassRelinkRequests.raceId, setup.raceId))).toHaveLength(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test("TASK085 löser exakt vald okänd avläsning med samma retry utan sidscroll", async ({ page }) => {
  const setup = await fixture(), deviceId = randomUUID(), cardNumber = "999999";
  const payloads = [
    { cardNumber, startPunchedAt: "2026-09-12T08:00:00Z", finishPunchedAt: "2026-09-12T08:20:00Z", punches: [{ code: 31, punchedAt: "2026-09-12T08:10:00Z" }] },
    { cardNumber, startPunchedAt: "2026-09-12T09:00:00Z", finishPunchedAt: "2026-09-12T09:40:00Z", punches: [{ code: 31, punchedAt: "2026-09-12T09:20:00Z" }] }
  ];
  const ingest = await ingestDeviceBatch(db, setup.raceId, { deviceId, sessionId: deviceId, packageVersion: 1,
    firstSequence: 1, lastSequence: 2, events: payloads.map((payload, index) => ({ localSequence: index + 1,
      stationReceivedAt: index === 0 ? "2026-09-12T08:21:00Z" : "2026-09-12T09:41:00Z", transport: "simulator",
      payload, contentHash: createHash("sha256").update(JSON.stringify(payload)).digest("hex") })) });
  expect(ingest.acknowledgements.map(row => row.status)).toEqual(["stored", "stored"]);
  const readouts = await db.select().from(schema.cardReadouts).where(eq(schema.cardReadouts.raceId, setup.raceId))
    .orderBy(schema.cardReadouts.readAt);
  const selected = readouts[0]!;
  const originalRaw = await db.select().from(schema.rawDeviceMessages).where(eq(schema.rawDeviceMessages.raceId, setup.raceId));
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/admin/${setup.raceId}/manage`);
  await signIn(page, setup.admin.accessCredential, "Under tävlingen", "Tid- & kontrollrättning");
  const panel = page.locator("details").filter({ hasText: "Lös okänd brickavläsning" });
  await expect(panel).toHaveJSProperty("open", false);
  await panel.locator("summary").click();
  const candidateResponse = page.waitForResponse(response => response.request().method() === "GET" &&
    response.url().endsWith(`/api/admin/races/${setup.raceId}/administrator/unknown-readout-resolution`));
  await panel.getByRole("button", { name: "Hämta okända avläsningar", exact: true }).click();
  expect((await candidateResponse).status()).toBe(200);
  const readoutSelect = page.getByRole("combobox", { name: "Välj avläsning", exact: true });
  const entrySelect = page.getByRole("combobox", { name: "Deltagare", exact: true });
  await readoutSelect.selectOption(selected.id);
  await entrySelect.selectOption(setup.entryId);
  await expect(readoutSelect).toHaveValue(selected.id);
  await expect(entrySelect).toHaveValue(setup.entryId);
  await page.getByRole("button", { name: "Granska koppling", exact: true }).click();
  const review = panel.locator("section[role=alert]");
  await expect(review).toContainText(cardNumber); await expect(review).toContainText("Ingen ändring har sparats ännu.");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  const requests: { key: string | undefined; body: string | null }[] = [];
  await page.route(`**/api/admin/races/${setup.raceId}/administrator/unknown-readout-resolution`, async route => {
    if (route.request().method() !== "POST") return route.continue();
    requests.push({ key: route.request().headers()["idempotency-key"], body: route.request().postData() });
    if (requests.length === 1) { const committed = await route.fetch(); expect(committed.status()).toBe(200); return route.abort("failed"); }
    await route.continue();
  });
  await review.getByRole("button", { name: "Bekräfta koppling och bedömning", exact: true }).click();
  await expect(review).toContainText("Svaret saknas. Kopplingen kan vara sparad.");
  await review.getByRole("button", { name: "Bekräfta koppling och bedömning", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("Den valda okända avläsningen är kopplad och bedömd.");
  expect(requests).toHaveLength(2); expect(requests[1]).toEqual(requests[0]);
  const revisions = await db.select().from(schema.resultRevisions).where(eq(schema.resultRevisions.raceId, setup.raceId));
  expect(revisions).toHaveLength(1); expect(revisions[0]).toMatchObject({ entryId: setup.entryId, readoutId: selected.id, cause: "UNKNOWN_READOUT_RESOLUTION" });
  expect(await db.select().from(schema.unknownReadoutResolutions).where(eq(schema.unknownReadoutResolutions.raceId, setup.raceId))).toHaveLength(1);
  expect(await db.select().from(schema.rawDeviceMessages).where(eq(schema.rawDeviceMessages.raceId, setup.raceId))).toEqual(originalRaw);
  expect(readouts.find(row => row.id !== selected.id)).toBeDefined();
});

test("TASK093 rättar observerad måltid med samma retry utan sidscroll", async ({ page }) => {
  const setup = await fixture(), deviceId = randomUUID();
  const payload = { cardNumber: "123456", startPunchedAt: "2026-09-12T08:00:00Z", finishPunchedAt: "2026-09-12T08:20:00Z",
    punches: [{ code: 31, punchedAt: "2026-09-12T08:10:00Z" }] };
  const ingest = await ingestDeviceBatch(db, setup.raceId, { deviceId, sessionId: deviceId, packageVersion: 1,
    firstSequence: 1, lastSequence: 1, events: [{ localSequence: 1, stationReceivedAt: "2026-09-12T08:21:00Z",
      transport: "simulator", payload, contentHash: createHash("sha256").update(JSON.stringify(payload)).digest("hex") }] });
  expect(ingest.acknowledgements[0]?.status).toBe("stored");
  const rawBefore = await db.select().from(schema.rawDeviceMessages).where(eq(schema.rawDeviceMessages.raceId, setup.raceId));
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/admin/${setup.raceId}/manage`);
  await signIn(page, setup.admin.accessCredential, "Under tävlingen", "Tid- & kontrollrättning");
  const panel = page.locator("details").filter({ hasText: "Rätta observerad måltid" });
  await expect(panel).toHaveJSProperty("open", false);
  await panel.locator("summary").click();
  await panel.getByRole("combobox", { name: "Deltagare", exact: true }).selectOption(setup.entryId);
  const candidateResponse = page.waitForResponse(response => response.request().method() === "GET" &&
    response.url().endsWith(`/api/admin/races/${setup.raceId}/administrator/entries/${setup.entryId}/finish-time-correction`));
  await panel.getByRole("button", { name: "Hämta resultatuppgift", exact: true }).click();
  expect((await candidateResponse).status()).toBe(200);
  await expect(panel).toContainText("Aktuell avläst tid: OK/COMPLETE · revision 1");
  const correctedLocal = "2026-09-12T10:22";
  const expectedFinish = "2026-09-12T08:22:00.000Z";
  await panel.getByLabel("Ny observerad måltid", { exact: true }).fill(correctedLocal);
  await panel.getByLabel("UTC-offset", { exact: true }).fill("+02:00");
  await panel.getByRole("checkbox", { name: "Jag har kontrollerat den observerade måltiden", exact: false }).check();
  await panel.getByRole("button", { name: "Granska måltidsrättning", exact: true }).click();
  const review = panel.locator("section[role=alert]");
  await expect(review).toContainText("10:20:00 GMT+02:00");
  await expect(review).toContainText("Ingen ändring har sparats ännu.");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  const requests: { key: string | undefined; body: string | null }[] = [];
  await page.route(`**/api/admin/races/${setup.raceId}/administrator/entries/${setup.entryId}/finish-time-correction`, async route => {
    if (route.request().method() !== "POST") return route.continue();
    requests.push({ key: route.request().headers()["idempotency-key"], body: route.request().postData() });
    if (requests.length === 1) { const committed = await route.fetch(); expect(committed.status()).toBe(200); return route.abort("failed"); }
    await route.continue();
  });
  await review.getByRole("button", { name: "Bekräfta korrigerad måltid", exact: true }).click();
  await expect(panel).toContainText("Svaret saknas. Rättningen kan vara sparad.");
  await review.getByRole("button", { name: "Bekräfta korrigerad måltid", exact: true }).click();
  await expect(panel.getByRole("status")).toContainText("Den korrigerade måltiden är sparad som en ny resultatrevision.");
  expect(requests).toHaveLength(2); expect(requests[1]).toEqual(requests[0]);
  const revisions = await db.select().from(schema.resultRevisions).where(eq(schema.resultRevisions.raceId, setup.raceId)).orderBy(schema.resultRevisions.revision);
  expect(revisions).toHaveLength(2); expect(revisions[0]).toMatchObject({ cause: "CARD_READOUT", revision: 1 });
  expect(revisions[1]).toMatchObject({ cause: "MANUAL_FINISH_TIME_CORRECTION", revision: 2,
    evaluation: { finishTime: expectedFinish, elapsedMs: Date.parse(expectedFinish) - Date.parse("2026-09-12T08:00:00.000Z") } });
  expect(await db.select().from(schema.manualFinishTimeCorrections).where(eq(schema.manualFinishTimeCorrections.raceId, setup.raceId))).toHaveLength(1);
  expect(await db.select().from(schema.rawDeviceMessages).where(eq(schema.rawDeviceMessages.raceId, setup.raceId))).toEqual(rawBefore);
});

test("TASK104 rättar PUNCH-start med samma retry utan sidscroll", async ({ page }) => {
  const setup = await fixture(), deviceId = randomUUID();
  const payload = { cardNumber: "123456", startPunchedAt: "2026-09-20T08:00:00Z", finishPunchedAt: "2026-09-20T08:20:00Z",
    punches: [{ code: 31, punchedAt: "2026-09-20T08:10:00Z" }] };
  const ingest = await ingestDeviceBatch(db, setup.raceId, { deviceId, sessionId: deviceId, packageVersion: 1,
    firstSequence: 1, lastSequence: 1, events: [{ localSequence: 1, stationReceivedAt: "2026-09-20T08:21:00Z",
      transport: "simulator", payload, contentHash: createHash("sha256").update(JSON.stringify(payload)).digest("hex") }] });
  expect(ingest.acknowledgements[0]?.status).toBe("stored");
  const rawBefore = await db.select().from(schema.rawDeviceMessages).where(eq(schema.rawDeviceMessages.raceId, setup.raceId));
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/admin/${setup.raceId}/manage`);
  await signIn(page, setup.admin.accessCredential, "Under tävlingen", "Tid- & kontrollrättning");
  const panel = page.locator("details").filter({ hasText: "Rätta observerad starttid (fri start)" });
  await expect(panel).toHaveJSProperty("open", false);
  await panel.locator("summary").click();
  await panel.getByRole("combobox", { name: "Deltagare", exact: true }).selectOption(setup.entryId);
  const candidateResponse = page.waitForResponse(response => response.request().method() === "GET" &&
    response.url().endsWith(`/api/admin/races/${setup.raceId}/administrator/entries/${setup.entryId}/punch-start-time-correction`));
  await panel.getByRole("button", { name: "Hämta startuppgift", exact: true }).click();
  expect((await candidateResponse).status()).toBe(200);
  await expect(panel).toContainText("Aktuell avläst tid: OK/COMPLETE · revision 1");
  await panel.getByLabel("Ny observerad starttid", { exact: true }).fill("2026-09-20T09:58");
  await panel.getByLabel("UTC-offset", { exact: true }).fill("+02:00");
  await panel.getByRole("checkbox", { name: "Jag har kontrollerat den observerade starttiden", exact: false }).check();
  await panel.getByRole("button", { name: "Granska starträttning", exact: true }).click();
  const review = panel.locator("section[role=alert]");
  await expect(review).toContainText("2026-09-20 10:00:00 GMT+02:00 → 2026-09-20 09:58:00 GMT+02:00");
  await expect(review).toContainText("Ingen ändring har sparats ännu.");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  const requests: { key: string | undefined; body: string | null }[] = [];
  await page.route(`**/api/admin/races/${setup.raceId}/administrator/entries/${setup.entryId}/punch-start-time-correction`, async route => {
    if (route.request().method() !== "POST") return route.continue();
    requests.push({ key: route.request().headers()["idempotency-key"], body: route.request().postData() });
    if (requests.length === 1) { const committed = await route.fetch(); expect(committed.status()).toBe(200); return route.abort("failed"); }
    await route.continue();
  });
  await review.getByRole("button", { name: "Bekräfta korrigerad starttid", exact: true }).click();
  await expect(panel).toContainText("Svaret saknas. Rättningen kan vara sparad.");
  await review.getByRole("button", { name: "Bekräfta korrigerad starttid", exact: true }).click();
  await expect(panel.getByRole("status")).toContainText("Den korrigerade starttiden är sparad som en ny resultatrevision.");
  expect(requests).toHaveLength(2); expect(requests[1]).toEqual(requests[0]);
  const revisions = await db.select().from(schema.resultRevisions).where(eq(schema.resultRevisions.raceId, setup.raceId)).orderBy(schema.resultRevisions.revision);
  expect(revisions).toHaveLength(2); expect(revisions[0]).toMatchObject({ cause: "CARD_READOUT", revision: 1 });
  expect(revisions[1]).toMatchObject({ cause: "MANUAL_PUNCH_START_TIME_CORRECTION", revision: 2,
    evaluation: { startTime: "2026-09-20T07:58:00.000Z", elapsedMs: 1_320_000 } });
  expect(await db.select().from(schema.manualPunchStartTimeCorrections).where(eq(schema.manualPunchStartTimeCorrections.raceId, setup.raceId))).toHaveLength(1);
  expect(await db.select().from(schema.rawDeviceMessages).where(eq(schema.rawDeviceMessages.raceId, setup.raceId))).toEqual(rawBefore);
});

test("TASK105 återtar PUNCH-starträttning med samma retry utan sidscroll", async ({ page }) => {
  const setup = await fixture(), deviceId = randomUUID();
  const payload = { cardNumber: "123456", startPunchedAt: "2026-09-20T08:00:00Z", finishPunchedAt: "2026-09-20T08:20:00Z",
    punches: [{ code: 31, punchedAt: "2026-09-20T08:10:00Z" }] };
  await ingestDeviceBatch(db, setup.raceId, { deviceId, sessionId: deviceId, packageVersion: 1, firstSequence: 1, lastSequence: 1,
    events: [{ localSequence: 1, stationReceivedAt: "2026-09-20T08:21:00Z", transport: "simulator", payload,
      contentHash: createHash("sha256").update(JSON.stringify(payload)).digest("hex") }] });
  const rawBefore = await db.select().from(schema.rawDeviceMessages).where(eq(schema.rawDeviceMessages.raceId, setup.raceId));
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/admin/${setup.raceId}/manage`);
  await signIn(page, setup.admin.accessCredential, "Under tävlingen", "Tid- & kontrollrättning");
  const correction = page.locator("details").filter({ hasText: "Rätta observerad starttid (fri start)" });
  await correction.locator("summary").click();
  await correction.getByRole("combobox", { name: "Deltagare", exact: true }).selectOption(setup.entryId);
  await correction.getByRole("button", { name: "Hämta startuppgift", exact: true }).click();
  await correction.getByLabel("Ny observerad starttid", { exact: true }).fill("2026-09-20T09:58");
  await correction.getByLabel("UTC-offset", { exact: true }).fill("+02:00");
  await correction.getByRole("checkbox", { name: "Jag har kontrollerat den observerade starttiden", exact: false }).check();
  await correction.getByRole("button", { name: "Granska starträttning", exact: true }).click();
  await correction.getByRole("button", { name: "Bekräfta korrigerad starttid", exact: true }).click();
  await expect(correction.getByRole("status")).toContainText("Den korrigerade starttiden är sparad");
  const panel = page.locator("details").filter({ hasText: "Återta starträttning (fri start)" });
  await panel.locator("summary").click();
  await panel.getByRole("combobox", { name: "Deltagare", exact: true }).selectOption(setup.entryId);
  const candidateResponse = page.waitForResponse(response => response.request().method() === "GET" &&
    response.url().endsWith(`/api/admin/races/${setup.raceId}/administrator/entries/${setup.entryId}/punch-start-time-correction-withdrawal`));
  await panel.getByRole("button", { name: "Hämta återtagandeunderlag", exact: true }).click();
  expect((await candidateResponse).status()).toBe(200);
  await expect(panel).toContainText("Teknisk ursprungsstart: 2026-09-20 10:00:00 GMT+02:00");
  await expect(panel).toContainText("Felaktigt rättad start: 2026-09-20 09:58:00 GMT+02:00");
  await panel.getByRole("checkbox", { name: "Jag har kontrollerat kedjan och vill återta den aktuella starträttningen.", exact: true }).check();
  await panel.getByRole("button", { name: "Granska återtagande", exact: true }).click();
  const review = panel.locator("section[role=alert]");
  await expect(review).toContainText("2026-09-20 09:58:00 GMT+02:00 → 2026-09-20 10:00:00 GMT+02:00");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  const requests: { key: string | undefined; body: string | null }[] = [];
  await page.route(`**/api/admin/races/${setup.raceId}/administrator/entries/${setup.entryId}/punch-start-time-correction-withdrawal`, async route => {
    if (route.request().method() !== "POST") return route.continue();
    requests.push({ key: route.request().headers()["idempotency-key"], body: route.request().postData() });
    if (requests.length === 1) { const committed = await route.fetch(); expect(committed.status()).toBe(200); return route.abort("failed"); }
    await route.continue();
  });
  await review.getByRole("button", { name: "Bekräfta återtagande", exact: true }).click();
  await expect(panel).toContainText("Svaret saknas. Återtagandet kan vara sparat.");
  await review.getByRole("button", { name: "Bekräfta återtagande", exact: true }).click();
  await expect(panel.getByRole("status")).toContainText("Starträttningen är återtagen som en ny resultatrevision.");
  expect(requests).toHaveLength(2); expect(requests[1]).toEqual(requests[0]);
  const revisions = await db.select().from(schema.resultRevisions).where(eq(schema.resultRevisions.raceId, setup.raceId)).orderBy(schema.resultRevisions.revision);
  expect(revisions).toHaveLength(3); expect(revisions[2]).toMatchObject({ cause: "MANUAL_PUNCH_START_TIME_CORRECTION_WITHDRAWAL", revision: 3,
    evaluation: { startTime: "2026-09-20T08:00:00.000Z", elapsedMs: 1_200_000 } });
  expect(await db.select().from(schema.manualPunchStartTimeCorrectionWithdrawals).where(eq(schema.manualPunchStartTimeCorrectionWithdrawals.raceId, setup.raceId))).toHaveLength(1);
  expect(await db.select().from(schema.rawDeviceMessages).where(eq(schema.rawDeviceMessages.raceId, setup.raceId))).toEqual(rawBefore);
});

test("TASK094/TASK095/TASK096 återtar och visar måltidskedjan utan sidscroll", async ({ page }) => {
  const setup = await fixture(), deviceId = randomUUID();
  const payload = { cardNumber: "123456", startPunchedAt: "2026-09-12T08:00:00Z", finishPunchedAt: "2026-09-12T08:20:00Z",
    punches: [{ code: 31, punchedAt: "2026-09-12T08:10:00Z" }] };
  await ingestDeviceBatch(db, setup.raceId, { deviceId, sessionId: deviceId, packageVersion: 1, firstSequence: 1, lastSequence: 1,
    events: [{ localSequence: 1, stationReceivedAt: "2026-09-12T08:21:00Z", transport: "simulator", payload,
      contentHash: createHash("sha256").update(JSON.stringify(payload)).digest("hex") }] });
  const rawBefore = await db.select().from(schema.rawDeviceMessages).where(eq(schema.rawDeviceMessages.raceId, setup.raceId));
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/admin/${setup.raceId}/manage`);
  await signIn(page, setup.admin.accessCredential, "Under tävlingen", "Tid- & kontrollrättning");
  const correctionPanel = page.locator("details").filter({ hasText: "Rätta observerad måltid" });
  await correctionPanel.locator("summary").click();
  await correctionPanel.getByRole("combobox", { name: "Deltagare", exact: true }).selectOption(setup.entryId);
  await correctionPanel.getByRole("button", { name: "Hämta resultatuppgift", exact: true }).click();
  await correctionPanel.getByLabel("Ny observerad måltid", { exact: true }).fill("2026-09-12T10:22");
  await correctionPanel.getByLabel("UTC-offset", { exact: true }).fill("+02:00");
  await correctionPanel.getByRole("checkbox", { name: "Jag har kontrollerat den observerade måltiden", exact: false }).check();
  await correctionPanel.getByRole("button", { name: "Granska måltidsrättning", exact: true }).click();
  await correctionPanel.getByRole("button", { name: "Bekräfta korrigerad måltid", exact: true }).click();
  await expect(correctionPanel.getByRole("status")).toContainText("Den korrigerade måltiden är sparad");
  const participantRow = page.locator('[data-panel="LIST"] tbody tr').filter({ hasText: "Åsa Testperson" });
  await page.getByRole("button", { name: "Uppdatera deltagare", exact: true }).click();
  await expect(participantRow).toContainText("Måltid rättad");
  const panel = page.locator("details").filter({ hasText: "Återta måltidsrättning" });
  await panel.locator("summary").click();
  await panel.getByRole("combobox", { name: "Deltagare", exact: true }).selectOption(setup.entryId);
  const candidateResponse = page.waitForResponse(response => response.request().method() === "GET" &&
    response.url().endsWith(`/api/admin/races/${setup.raceId}/administrator/entries/${setup.entryId}/finish-time-correction-withdrawal`));
  await panel.getByRole("button", { name: "Hämta återtagandeunderlag", exact: true }).click();
  expect((await candidateResponse).status()).toBe(200);
  await expect(panel).toContainText("Teknisk ursprungsmåltid: 2026-09-12 10:20:00 GMT+02:00");
  await expect(panel).toContainText("Felaktigt rättad måltid: 2026-09-12 10:22:00 GMT+02:00");
  await panel.getByRole("checkbox", { name: "Jag har kontrollerat kedjan", exact: false }).check();
  await panel.getByRole("button", { name: "Granska återtagande", exact: true }).click();
  const review = panel.locator("section[role=alert]");
  await expect(review).toContainText("2026-09-12 10:22:00 GMT+02:00 → 2026-09-12 10:20:00 GMT+02:00");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  const requests: { key: string | undefined; body: string | null }[] = [];
  await page.route(`**/api/admin/races/${setup.raceId}/administrator/entries/${setup.entryId}/finish-time-correction-withdrawal`, async route => {
    if (route.request().method() !== "POST") return route.continue();
    requests.push({ key: route.request().headers()["idempotency-key"], body: route.request().postData() });
    if (requests.length === 1) { const committed = await route.fetch(); expect(committed.status()).toBe(200); return route.abort("failed"); }
    await route.continue();
  });
  await review.getByRole("button", { name: "Bekräfta återtagande", exact: true }).click();
  await expect(panel).toContainText("Svaret saknas. Återtagandet kan vara sparat.");
  await review.getByRole("button", { name: "Bekräfta återtagande", exact: true }).click();
  await expect(panel.getByRole("status")).toContainText("Måltidsrättningen är återtagen som en ny resultatrevision.");
  await page.getByRole("button", { name: "Uppdatera deltagare", exact: true }).click();
  await expect(participantRow).toContainText("Måltidsrättning återtagen");
  await participantRow.getByRole("button", { name: "Åsa Testperson Test OK", exact: true }).click();
  await expect(page.getByRole("region", { name: "Gällande resultat", exact: true }))
    .toContainText("Måltidsrättning: Måltidsrättning återtagen");
  expect(requests).toHaveLength(2); expect(requests[1]).toEqual(requests[0]);
  const revisions = await db.select().from(schema.resultRevisions).where(eq(schema.resultRevisions.raceId, setup.raceId)).orderBy(schema.resultRevisions.revision);
  expect(revisions).toHaveLength(3); expect(revisions[2]).toMatchObject({ cause: "MANUAL_FINISH_TIME_CORRECTION_WITHDRAWAL", revision: 3,
    evaluation: { finishTime: "2026-09-12T08:20:00.000Z", elapsedMs: 1_200_000 } });
  expect(await db.select().from(schema.manualFinishTimeCorrectionWithdrawals).where(eq(schema.manualFinishTimeCorrectionWithdrawals.raceId, setup.raceId))).toHaveLength(1);
  expect(await db.select().from(schema.rawDeviceMessages).where(eq(schema.rawDeviceMessages.raceId, setup.raceId))).toEqual(rawBefore);
});

for (const width of [1366, 390]) test(`TASK029 samma login och verkligt klassbyte ${width}`, async ({ page }, testInfo) => {
  const setup = await fixture({ distinctTargetCourse: width === 1366 });
  const base = `/api/admin/races/${setup.raceId}/administrator`;
  let administratorRequests = 0;
  page.on("request", request => { if (request.url().includes(base)) administratorRequests += 1; });
  const listPanel = page.locator(`#participant-list-${setup.raceId}`);
  const workPanel = page.locator(`#participant-work-${setup.raceId}`);
  async function showParticipants() {
    if (width <= 720 && !(await listPanel.isVisible())) {
      await page.getByRole("button", { name: "Deltagarlista", exact: true }).click();
      await expect(listPanel).toBeFocused();
    }
  }
  await page.setViewportSize({ width, height: 900 });
  await page.goto(`/admin/${setup.raceId}/manage`);
  await expect(page.getByRole("status").filter({ hasText: "Behörighet saknas eller har gått ut." })).toBeVisible();
  await expect(page.getByRole("button", { name: "Logga in", exact: true })).toBeEnabled();
  await signIn(page, setup.admin.accessCredential);
  await expect(listPanel).toBeVisible();
  if (width <= 720) await expect(workPanel).toBeHidden();
  else await expect(workPanel).toBeVisible();
  for (const limit of [0, 1]) {
    await page.getByRole("button", { name: "Före tävlingen", exact: true }).click();
    await page.getByRole("navigation", { name: "Tävlingsförberedelser", exact: true })
      .getByRole("button", { name: "Klasser", exact: true }).click();
    const details = page.locator("details").filter({ hasText: "Deltagargränser per klass" });
    if (!(await details.evaluate(element => (element as HTMLDetailsElement).open))) await details.locator("summary").click();
    await page.getByRole("combobox", { name: "Klass för deltagargräns", exact: true }).selectOption(setup.targetClassId);
    await page.getByLabel("Max antal deltagare", { exact: true }).fill(String(limit));
    await page.getByRole("button", { name: "Granska deltagargräns", exact: true }).click();
    await page.getByRole("button", { name: "Bekräfta deltagargräns", exact: true }).click();
    await expect(page.getByRole("status").filter({ hasText: "Deltagargränsen är sparad." })).toBeVisible();
    await expect(page.getByRole("button", { name: "Uppdatera deltagare", exact: true, includeHidden: true })).toBeEnabled();
    await page.getByRole("navigation", { name: "Arbetslägen", exact: true })
      .getByRole("button", { name: "Deltagare", exact: true }).click();
    if (limit === 0) {
      await page.getByRole("button", { name: "Åsa Testperson Test OK", exact: true }).click();
      await expect(page.getByRole("combobox", { name: "Ny klass", exact: true })).toHaveCount(0);
      await page.getByRole("button", { name: "Byt klass", exact: true }).click();
      await page.getByRole("combobox", { name: "Ny klass", exact: true }).selectOption(setup.targetClassId);
      await expect(page.getByRole("button", { name: "Granska klassbyte", exact: true })).toBeDisabled();
    }
  }
  const [capacityClass] = await db.select().from(schema.classes).where(eq(schema.classes.id, setup.targetClassId));
  expect(capacityClass).toMatchObject({ maxEntries: 1, capacityVersion: 3 });
  const [raceBeforeTransfer] = await db.select().from(schema.races).where(eq(schema.races.id, setup.raceId));
  expect(raceBeforeTransfer?.snapshotVersion).toBe(1);
  expect(await db.select().from(schema.classCapacityChangeRequests).where(eq(schema.classCapacityChangeRequests.raceId, setup.raceId))).toHaveLength(2);
  await showParticipants();
  await listPanel.getByLabel("Sök namn, klubb, klass eller bricka", { exact: true }).fill("Åsa");
  await page.getByRole("button", { name: "Åsa Testperson Test OK", exact: true }).click();
  await expect(page.getByRole("region", { name: "Gällande resultat", exact: true })).toContainText("Inget publicerat resultat");
  await expect(page.getByRole("heading", { name: "Kontroller och sträcktider", exact: true })).toBeVisible();
  await expect(page.getByRole("combobox", { name: "Ny klass", exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Byt klass", exact: true }).click();
  await page.getByRole("combobox", { name: "Ny klass", exact: true }).selectOption(setup.targetClassId);
  await page.getByLabel("Startdatum", { exact: true }).fill("2026-09-12");
  await page.getByLabel("Klockslag", { exact: true }).fill("12:30:00");
  await page.getByLabel("UTC-offset", { exact: true }).fill("+02:00");
  if (width <= 720) {
    await expect(page.getByRole("button", { name: "Deltagarlista", exact: true })).toBeEnabled();
    const requestsBeforeToggle = administratorRequests;
    await expect(listPanel).toBeHidden();
    await showParticipants();
    await expect(workPanel).toBeHidden();
    await expect(listPanel.getByLabel("Sök namn, klubb, klass eller bricka", { exact: true })).toHaveValue("Åsa");
    await page.getByRole("button", { name: "Arbetsvy", exact: true }).click();
    await expect(workPanel).toBeFocused();
    await expect(page.getByRole("combobox", { name: "Ny klass", exact: true })).toHaveValue(setup.targetClassId);
    await expect(page.getByLabel("Klockslag", { exact: true })).toHaveValue("12:30:00");
    expect(administratorRequests).toBe(requestsBeforeToggle);
  }
  await page.getByRole("button", { name: "Granska klassbyte", exact: true }).click();
  const requests: { key: string | undefined; body: string | null }[] = [];
  await page.route(`**${base}/entries/${setup.entryId}/transfer`, async route => {
    requests.push({ key: route.request().headers()["idempotency-key"], body: route.request().postData() });
    const response = await route.fetch();
    expect(response.status()).toBe(200);
    if (requests.length === 1) await route.abort("failed");
    else await route.fulfill({ response });
  });
  await page.getByRole("button", { name: "Bekräfta klassbyte", exact: true }).click();
  if (width <= 720) {
    await expect(page.getByRole("button", { name: "Deltagarlista", exact: true })).toBeDisabled();
    await expect(workPanel).toBeVisible();
  }
  await page.getByRole("button", { name: "Försök igen med samma begäran", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: "Klassbytet och starttiden är sparade." })).toBeVisible();
  expect(requests).toHaveLength(2);
  expect(requests[1]).toEqual(requests[0]);
  const journal = await db.select().from(schema.entryTransferRequests).where(eq(schema.entryTransferRequests.raceId, setup.raceId));
  expect(journal).toHaveLength(1);
  expect(journal[0]).toMatchObject({ actorCredentialId: setup.admin.credentialId, targetClassId: setup.targetClassId });
  const [entry] = await db.select().from(schema.entries).where(eq(schema.entries.id, setup.entryId));
  expect(entry).toMatchObject({ classId: setup.targetClassId, version: 2, fixedStartTime: new Date("2026-09-12T10:30:00Z") });
  expect(await db.select().from(schema.resultRevisions).where(eq(schema.resultRevisions.raceId, setup.raceId))).toHaveLength(0);
  if (width === 1366) {
    await page.getByRole("button", { name: "Åsa Testperson Test OK", exact: true }).click();
    const assignedCourse = workPanel.getByRole("region", { name: "Tilldelad bana", exact: true });
    await expect(assignedCourse).toContainText("Minutstartbana · Version 1");
    await expect(assignedCourse.getByRole("listitem")).toHaveText(["1.31"]);
    await expect(workPanel.locator('section[aria-labelledby="race-result-controls-title"]'))
      .toContainText("Det finns inget publicerat resultat för deltagaren.");
  }
  await expect(page.getByRole("button", { name: "Uppdatera deltagare", exact: true, includeHidden: true })).toBeEnabled();
  // TASK031: correct only the fixed time, without changing class or logging in again.
  const payload = { cardNumber: "123456", startPunchedAt: "2026-09-12T10:30:00Z", finishPunchedAt: "2026-09-12T10:50:00Z",
    punches: [{ code: 31, punchedAt: "2026-09-12T10:40:00Z" }] };
  const deviceId = randomUUID();
  const ingested = await ingestDeviceBatch(db, setup.raceId, { deviceId, sessionId: deviceId, packageVersion: 2,
    firstSequence: 1, lastSequence: 1, events: [{ localSequence: 1, stationReceivedAt: "2026-09-12T10:51:00Z",
      transport: "simulator", payload, contentHash: createHash("sha256").update(JSON.stringify(payload)).digest("hex") }] });
  expect(ingested.acknowledgements[0]?.status).toBe("stored");
  const originalResults = await db.select().from(schema.resultRevisions).where(eq(schema.resultRevisions.raceId, setup.raceId));
  expect(originalResults).toHaveLength(1);
  if (width === 1366) expect(originalResults[0]?.courseVersionId).toBe(setup.targetCourseVersionId);
  const rawBefore = await db.select().from(schema.rawDeviceMessages).where(eq(schema.rawDeviceMessages.raceId, setup.raceId));
  await page.getByRole("button", { name: "Ändra starttid", exact: true }).click();
  await expect(page.getByRole("combobox", { name: "Ny klass", exact: true })).toHaveCount(0);
  await page.getByLabel("Startdatum", { exact: true }).fill("2026-09-12");
  await page.getByLabel("Klockslag", { exact: true }).fill("12:32:00.125");
  await page.getByLabel("UTC-offset", { exact: true }).fill("+02:00");
  const timeRequests: { key: string | undefined; body: string | null }[] = [];
  await page.route(`**${base}/entries/${setup.entryId}/start-time`, async route => {
    timeRequests.push({ key: route.request().headers()["idempotency-key"], body: route.request().postData() });
    const response = await route.fetch();
    expect(response.status()).toBe(200);
    if (timeRequests.length === 1) await route.abort("failed");
    else await route.fulfill({ response });
  });
  await page.getByRole("button", { name: "Granska starttid", exact: true }).click();
  await expect(page.getByRole("button", { name: "Byt klass", exact: true })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Ändra bricka", exact: true })).toBeDisabled();
  await page.getByRole("button", { name: "Bekräfta starttid", exact: true }).click();
  await page.getByRole("button", { name: "Försök igen med samma begäran", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: "Starttiden är sparad." })).toBeVisible();
  await expect(page.getByRole("button", { name: "Uppdatera deltagare", exact: true, includeHidden: true })).toBeEnabled();
  expect(timeRequests).toHaveLength(2);
  expect(timeRequests[1]).toEqual(timeRequests[0]);
  const timeJournal = await db.select().from(schema.entryStartTimeChangeRequests).where(eq(schema.entryStartTimeChangeRequests.raceId, setup.raceId));
  expect(timeJournal).toHaveLength(1);
  expect(timeJournal[0]).toMatchObject({ actorCredentialId: setup.admin.credentialId, classId: setup.targetClassId,
    previousFixedStartTime: new Date("2026-09-12T10:30:00Z"), fixedStartTime: new Date("2026-09-12T10:32:00.125Z"),
    entryVersionBefore: 2, entryVersionAfter: 3, snapshotVersionBefore: 2, snapshotVersionAfter: 3 });
  await chooseResultAction(page, "Omräkning");
  const recalculationRequests: { key: string | undefined; body: string | null }[] = [];
  await page.route(`**${base}/entries/${setup.entryId}/recalculate`, async route => {
    recalculationRequests.push({ key: route.request().headers()["idempotency-key"], body: route.request().postData() });
    const response = await route.fetch();
    expect(response.status()).toBe(200);
    if (recalculationRequests.length === 1) await route.abort("failed");
    else await route.fulfill({ response });
  });
  await page.getByRole("button", { name: "Granska omräkning", exact: true }).click();
  await expect(page.getByRole("button", { name: "Ändra starttid", exact: true })).toBeDisabled();
  await page.getByRole("button", { name: "Bekräfta omräkning", exact: true }).click();
  await page.getByRole("button", { name: "Försök igen med samma begäran", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: "Omräkningen är sparad." })).toBeVisible();
  await expect(page.getByRole("button", { name: "Uppdatera deltagare", exact: true, includeHidden: true })).toBeEnabled();
  expect(recalculationRequests).toHaveLength(2);
  expect(recalculationRequests[1]).toEqual(recalculationRequests[0]);
  const recalculationJournal = await db.select().from(schema.resultRecalculationRequests).where(eq(schema.resultRecalculationRequests.raceId, setup.raceId));
  expect(recalculationJournal).toHaveLength(1);
  expect(recalculationJournal[0]).toMatchObject({ actorCredentialId: setup.admin.credentialId, createdResultRevision: 2 });
  const recalculatedResults = await db.select().from(schema.resultRevisions).where(eq(schema.resultRevisions.raceId, setup.raceId));
  expect(recalculatedResults).toHaveLength(2);
  expect(recalculatedResults.find(row => row.id === originalResults[0]?.id)).toEqual(originalResults[0]);
  expect(recalculatedResults.find(row => row.revision === 2)).toMatchObject({ cause: "EXPLICIT_RECALCULATION", published: true,
    status: "OK", snapshotVersion: 3, evaluation: { elapsedMs: 1079875 } });
  expect(await db.select().from(schema.rawDeviceMessages).where(eq(schema.rawDeviceMessages.raceId, setup.raceId))).toEqual(rawBefore);
  await expect(page.getByRole("region", { name: "Gällande resultat", exact: true })).toContainText("Godkänd");
  await expect(page.getByRole("region", { name: "Gällande resultat", exact: true })).toContainText("17:59.875");
  await page.getByRole("button", { name: "Byt klass", exact: true }).click();
  await page.getByRole("combobox", { name: "Ny klass", exact: true }).selectOption(setup.classId);
  await expect(page.getByLabel("Startdatum", { exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Granska klassbyte", exact: true }).click();
  await page.getByRole("button", { name: "Bekräfta klassbyte", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: "Klassbytet och starttiden är sparade." })).toBeVisible();
  await expect(page.getByRole("button", { name: "Uppdatera deltagare", exact: true, includeHidden: true })).toBeEnabled();
  const [returned] = await db.select().from(schema.entries).where(eq(schema.entries.id, setup.entryId));
  expect(returned).toMatchObject({ classId: setup.classId, version: 4, fixedStartTime: null });
  expect(await db.select().from(schema.entryTransferRequests).where(eq(schema.entryTransferRequests.raceId, setup.raceId))).toHaveLength(2);
  await expect(page.getByRole("region", { name: "Gällande resultat", exact: true })).toContainText("Minutstart testklass");
  if (width === 1366) {
    await page.getByRole("button", { name: "Åsa Testperson Test OK", exact: true }).click();
    const assignedCourse = workPanel.getByRole("region", { name: "Tilldelad bana", exact: true });
    const historicalControls = workPanel.locator('section[aria-labelledby="race-result-controls-title"]');
    await expect(assignedCourse).toContainText("Testbana · Version 1");
    await expect(assignedCourse.getByRole("listitem")).toHaveText(["1.31"]);
    await expect(assignedCourse).not.toContainText("Minutstartbana");
    await expect(historicalControls).toContainText("Minutstartbana");
    await expect(historicalControls).not.toContainText("Testbana");
    expect((await db.select().from(schema.resultRevisions).where(eq(schema.resultRevisions.raceId, setup.raceId)))
      .find(row => row.revision === 2)?.courseVersionId).toBe(setup.targetCourseVersionId);
  }
  await expect(page.getByRole("button", { name: "Ändra starttid", exact: true })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Granska starttid", exact: true })).toHaveCount(0);
  await expect(page.getByLabel("Startdatum", { exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Ändra bricka", exact: true }).click();
  // TASK030: the same session also changes the card; a lost commit response reuses exact intent.
  const cardRequests: { key: string | undefined; body: string | null }[] = [];
  await page.route(`**${base}/entries/${setup.entryId}/card`, async route => {
    cardRequests.push({ key: route.request().headers()["idempotency-key"], body: route.request().postData() });
    const response = await route.fetch();
    expect(response.status()).toBe(200);
    if (cardRequests.length === 1) await route.abort("failed");
    else await route.fulfill({ response });
  });
  await page.getByLabel("Ny bricka", { exact: true }).fill("654321");
  await page.getByRole("button", { name: "Granska brickbyte", exact: true }).click();
  await expect(page.getByRole("button", { name: "Uppdatera deltagare", exact: true, includeHidden: true })).toBeDisabled();
  await page.getByRole("button", { name: "Bekräfta brickbyte", exact: true }).click();
  await page.getByRole("button", { name: "Försök igen med samma begäran", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: "Brickbytet är sparat." })).toBeVisible();
  await expect(page.getByRole("button", { name: "Uppdatera deltagare", exact: true, includeHidden: true })).toBeEnabled();
  expect(cardRequests).toHaveLength(2);
  expect(cardRequests[1]).toEqual(cardRequests[0]);
  const cardJournal = await db.select().from(schema.entryCardChangeRequests).where(eq(schema.entryCardChangeRequests.raceId, setup.raceId));
  expect(cardJournal).toHaveLength(1);
  expect(cardJournal[0]).toMatchObject({ actorCredentialId: setup.admin.credentialId, previousCardNumber: "123456", cardNumber: "654321",
    entryVersionBefore: 4, entryVersionAfter: 5, snapshotVersionBefore: 4, snapshotVersionAfter: 5 });
  const assignments = await db.select().from(schema.cardAssignments).where(eq(schema.cardAssignments.raceId, setup.raceId));
  expect(assignments).toHaveLength(2);
  expect(assignments.find(row => row.cardNumber === "123456")?.active).toBe(false);
  expect(assignments.find(row => row.cardNumber === "654321")?.active).toBe(true);
  // TASK034: structured name/club correction stays in this session and retries one exact intent.
  await page.getByRole("button", { name: "Ändra namn eller klubb", exact: true }).click();
  await expect(page.getByLabel("Förnamn", { exact: true })).toHaveValue("Åsa");
  await expect(page.getByLabel("Efternamn", { exact: true })).toHaveValue("Testperson");
  await page.getByLabel("Förnamn", { exact: true }).fill("Åsa Maria");
  await page.getByLabel("Efternamn", { exact: true }).fill("Rättad Testperson");
  await page.getByLabel("Klubb", { exact: true }).fill("Rättad Test OK");
  const identityRequests: { key: string | undefined; body: string | null }[] = [];
  await page.route(`**${base}/entries/${setup.entryId}/identity`, async route => {
    identityRequests.push({ key: route.request().headers()["idempotency-key"], body: route.request().postData() });
    const response = await route.fetch();
    expect(response.status()).toBe(200);
    if (identityRequests.length === 1) await route.abort("failed");
    else await route.fulfill({ response });
  });
  await page.getByRole("button", { name: "Granska rättning", exact: true }).click();
  await page.getByRole("button", { name: "Bekräfta rättning", exact: true }).click();
  await page.getByRole("button", { name: "Försök igen med samma begäran", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: "Namn och klubb är sparade." })).toBeVisible();
  await expect(page.getByRole("button", { name: "Uppdatera deltagare", exact: true, includeHidden: true })).toBeEnabled();
  await showParticipants();
  await expect(page.getByRole("button", { name: "Åsa Maria Rättad Testperson Rättad Test OK", exact: true })).toBeVisible();
  expect(identityRequests).toHaveLength(2);
  expect(identityRequests[1]).toEqual(identityRequests[0]);
  const identityJournal = await db.select().from(schema.entryIdentityChangeRequests).where(eq(schema.entryIdentityChangeRequests.raceId, setup.raceId));
  expect(identityJournal).toHaveLength(1);
  expect(identityJournal[0]).toMatchObject({ capability: "MANAGE_RACE", actorCredentialId: setup.admin.credentialId,
    entryVersionBefore: 5, entryVersionAfter: 6, snapshotVersionBefore: 5, snapshotVersionAfter: 6 });
  const [renamed] = await db.select().from(schema.entries).where(eq(schema.entries.id, setup.entryId));
  expect(renamed).toMatchObject({ givenName: "Åsa Maria", familyName: "Rättad Testperson", organisationName: "Rättad Test OK",
    classId: setup.classId, fixedStartTime: null, version: 6 });
  expect(await db.select().from(schema.cardAssignments).where(eq(schema.cardAssignments.raceId, setup.raceId))).toEqual(assignments);
  expect(await db.select().from(schema.resultRevisions).where(eq(schema.resultRevisions.raceId, setup.raceId))).toEqual(recalculatedResults);
  expect(await db.select().from(schema.rawDeviceMessages).where(eq(schema.rawDeviceMessages.raceId, setup.raceId))).toEqual(rawBefore);
  const audits = await db.select().from(schema.auditEvents).where(eq(schema.auditEvents.raceId, setup.raceId));
  expect(audits.find(row => row.action === "ENTRY_IDENTITY_CHANGED_BY_ADMIN")).toMatchObject({ actorKind: "RACE_ADMIN_ACCESS_CREDENTIAL", actorId: setup.admin.credentialId });
  expect(audits.find(row => row.action === "ENTRY_CARD_CHANGED_BY_ADMIN")).toMatchObject({ actorKind: "RACE_ADMIN_ACCESS_CREDENTIAL", actorId: setup.admin.credentialId });
  expect(audits.find(row => row.action === "ENTRY_START_TIME_CHANGED_BY_ADMIN")).toMatchObject({ actorKind: "RACE_ADMIN_ACCESS_CREDENTIAL", actorId: setup.admin.credentialId });
  expect(audits.find(row => row.action === "RESULT_RECALCULATED_BY_ADMIN")).toMatchObject({ actorKind: "RACE_ADMIN_ACCESS_CREDENTIAL", actorId: setup.admin.credentialId });
  expect(await db.select().from(schema.resultRevisions).where(eq(schema.resultRevisions.raceId, setup.raceId))).toHaveLength(2);
  // TASK039: the same administrator sees the saved before/after values, not reconstructed state.
  if (width <= 720) await page.getByRole("button", { name: "Arbetsvy", exact: true }).click();
  await chooseResultAction(page, "Historik");
  const history = page.getByRole("region", { name: "Historik", exact: true });
  await expect(history.locator("details")).toHaveCount(5);
  await expect(history.locator("summary").first()).toContainText("Namn och klubb · Deltagarversion 6");
  await history.locator("summary").first().click();
  await expect(history).toContainText("Före: Testperson");
  await expect(history).toContainText("Efter: Rättad Testperson");
  const cardChange = history.locator("details").filter({ has: page.locator("summary", { hasText: "Brickbyte" }) });
  await cardChange.locator("summary").click();
  await expect(cardChange).toContainText("Före: 123456");
  await expect(cardChange).toContainText("Efter: 654321");
  await page.screenshot({ path: testInfo.outputPath(`entry-changes-${width}.png`), fullPage: true });
  await page.route(`**${base}/entries/${setup.entryId}/changes`, route => route.abort("failed"));
  await history.getByRole("button", { name: "Uppdatera historik", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: "Historiken kunde inte hämtas." })).toBeVisible();
  await expect(history.locator("details")).toHaveCount(0);
  await page.unroute(`**${base}/entries/${setup.entryId}/changes`);
  await history.getByRole("button", { name: "Uppdatera historik", exact: true }).click();
  await expect(history.locator("details")).toHaveCount(5);
  // TASK035: register PUNCH/FIXED entrants, then continue administering the created entry.
  const registrationRequests: { key: string | undefined; body: string | null }[] = [];
  let candidateSearches = 0;
  page.on("request", request => { if (request.url().endsWith(`${base}/registration-candidates`)) candidateSearches += 1; });
  await page.route(`**${base}/registration`, async route => {
    registrationRequests.push({ key: route.request().headers()["idempotency-key"], body: route.request().postData() });
    const response = await route.fetch();
    expect(response.status()).toBe(200);
    if (registrationRequests.length === 1 || registrationRequests.length === 4) await route.abort("failed");
    else await route.fulfill({ response });
  });
  for (const fixed of [false, true]) {
    await showParticipants();
    await page.getByRole("button", { name: "Ny deltagare", exact: true }).click();
    await page.getByRole("combobox", { name: "Anmälningsklass", exact: true }).selectOption(fixed ? setup.targetClassId : setup.classId);
    await page.getByLabel("Förnamn", { exact: true }).fill(fixed ? "Minut" : "Fri");
    await page.getByLabel("Efternamn", { exact: true }).fill("Nyanmäld");
    if (fixed) {
      await page.getByLabel("Bricknummer (valfritt)", { exact: true }).fill("765432");
      await page.getByLabel("Startdatum", { exact: true }).fill("2026-09-12");
      await page.getByLabel("Klockslag", { exact: true }).fill("12:40:00.125");
      await page.getByLabel("UTC-offset", { exact: true }).fill("+02:00");
    } else await expect(page.getByLabel("Startdatum", { exact: true })).toHaveCount(0);
    if (fixed) {
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      await page.screenshot({ path: testInfo.outputPath(`registration-${width}.png`), fullPage: true });
    }
    await page.getByRole("button", { name: "Granska anmälan", exact: true }).click();
    await page.getByRole("button", { name: "Bekräfta anmälan", exact: true }).click();
    if (!fixed) await page.getByRole("button", { name: "Försök igen med samma begäran", exact: true }).click();
    await expect(page.getByRole("status").filter({ hasText: "Deltagaren är anmäld." })).toBeVisible();
    await expect(page.getByRole("button", { name: "Uppdatera deltagare", exact: true, includeHidden: true })).toBeEnabled();
    await expect(page.getByRole("region", { name: "Direktanmälan", exact: true })).toHaveCount(0);
  }
  expect(registrationRequests).toHaveLength(3);
  expect(registrationRequests[1]).toEqual(registrationRequests[0]);
  const registrations = await db.select().from(schema.entryRegistrationRequests).where(eq(schema.entryRegistrationRequests.raceId, setup.raceId));
  expect(registrations).toHaveLength(2);
  await chooseResultAction(page, "Historik");
  await expect(history.locator("details")).toHaveCount(1);
  await expect(history.locator("summary")).toContainText("Direktanmälan · Deltagarversion 1");
  await expect(history).not.toContainText("Rättad Testperson");
  expect(registrations.every(row => row.actorCredentialId === setup.admin.credentialId)).toBe(true);
  const allEntries = await db.select().from(schema.entries).where(eq(schema.entries.raceId, setup.raceId));
  expect(allEntries).toHaveLength(3);
  expect(allEntries.find(row => row.givenName === "Fri")).toMatchObject({ classId: setup.classId, version: 1, fixedStartTime: null });
  expect(allEntries.find(row => row.givenName === "Minut")).toMatchObject({ classId: setup.targetClassId, version: 1,
    fixedStartTime: new Date("2026-09-12T10:40:00.125Z") });
  await showParticipants();
  await page.getByRole("button", { name: "Ny deltagare", exact: true }).click();
  await page.getByRole("combobox", { name: "Anmälningsklass", exact: true }).selectOption(setup.targetClassId);
  await expect(page.getByRole("button", { name: "Granska anmälan", exact: true })).toBeDisabled();
  await showParticipants();
  await page.getByRole("button", { name: /^Fri Nyanmäld/ }).click();
  await page.getByRole("button", { name: "Ändra bricka", exact: true }).click();
  await page.getByLabel("Ny bricka", { exact: true }).fill("876543");
  await page.getByRole("button", { name: "Granska brickbyte", exact: true }).click();
  await page.getByRole("button", { name: "Bekräfta brickbyte", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: "Brickbytet är sparat." })).toBeVisible();
  await expect(page.getByRole("button", { name: "Uppdatera deltagare", exact: true, includeHidden: true })).toBeEnabled();
  const afterRegistrationAudits = await db.select().from(schema.auditEvents).where(eq(schema.auditEvents.raceId, setup.raceId));
  expect(afterRegistrationAudits.filter(row => row.action === "ENTRY_REGISTERED_BY_ADMIN")).toHaveLength(2);
  expect(afterRegistrationAudits.filter(row => row.action === "ENTRY_REGISTERED_BY_ADMIN").every(row =>
    row.actorKind === "RACE_ADMIN_ACCESS_CREDENTIAL" && row.actorId === setup.admin.credentialId)).toBe(true);
  expect(await db.select().from(schema.resultRevisions).where(eq(schema.resultRevisions.raceId, setup.raceId))).toEqual(recalculatedResults);
  expect(await db.select().from(schema.rawDeviceMessages).where(eq(schema.rawDeviceMessages.raceId, setup.raceId))).toEqual(rawBefore);
  // TASK036: a historical card blocks registration and offers the existing participant.
  await showParticipants();
  await page.getByRole("button", { name: "Ny deltagare", exact: true }).click();
  await page.getByRole("combobox", { name: "Anmälningsklass", exact: true }).selectOption(setup.classId);
  await page.getByLabel("Förnamn", { exact: true }).fill("Annan");
  await page.getByLabel("Efternamn", { exact: true }).fill("Person");
  await page.getByLabel("Bricknummer (valfritt)", { exact: true }).fill("123456");
  await page.getByRole("button", { name: "Granska anmälan", exact: true }).click();
  await expect(page.getByRole("button", { name: "Bekräfta anmälan", exact: true })).toBeDisabled();
  await page.getByRole("button", { name: "Välj befintlig deltagare: Åsa Maria Rättad Testperson", exact: true }).click();
  await expect(page.getByRole("region", { name: "Direktanmälan", exact: true })).toHaveCount(0);
  expect(registrationRequests).toHaveLength(3);
  await expect(page.getByRole("button", { name: "Ny deltagare", exact: true, includeHidden: true })).toBeEnabled();
  await showParticipants();
  await page.getByRole("button", { name: "Ny deltagare", exact: true }).click();
  await page.getByRole("combobox", { name: "Anmälningsklass", exact: true }).selectOption(setup.classId);
  await page.getByLabel("Förnamn", { exact: true }).fill("Fri");
  await page.getByLabel("Efternamn", { exact: true }).fill("Nyanmäld");
  await page.getByRole("button", { name: "Granska anmälan", exact: true }).click();
  await expect(page.getByRole("button", { name: "Bekräfta anmälan", exact: true })).toBeDisabled();
  await page.getByRole("checkbox", { name: "Jag anmäler en annan person med samma namn", exact: true }).check();
  await page.screenshot({ path: testInfo.outputPath(`candidates-${width}.png`), fullPage: true });
  expect(candidateSearches).toBe(4);
  await page.getByRole("button", { name: "Bekräfta anmälan", exact: true }).click();
  await page.getByRole("button", { name: "Försök igen med samma begäran", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: "Deltagaren är anmäld." })).toBeVisible();
  await expect(page.getByRole("button", { name: "Uppdatera deltagare", exact: true, includeHidden: true })).toBeEnabled();
  expect(candidateSearches).toBe(4);
  expect(registrationRequests).toHaveLength(5);
  expect(registrationRequests[4]).toEqual(registrationRequests[3]);
  const duplicates = await db.select().from(schema.entries).where(eq(schema.entries.raceId, setup.raceId));
  expect(duplicates.filter(row => row.givenName === "Fri" && row.familyName === "Nyanmäld")).toHaveLength(2);
  expect(await db.select().from(schema.entryRegistrationRequests).where(eq(schema.entryRegistrationRequests.raceId, setup.raceId))).toHaveLength(3);
  await page.screenshot({ path: testInfo.outputPath(`race-administrator-${width}.png`), fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  const stored = await page.evaluate(() => JSON.stringify({ local: { ...localStorage }, session: { ...sessionStorage } }));
  for (const value of ["Åsa", "Testperson", "Rättad", setup.admin.accessCredential]) expect(stored).not.toContain(value);
  const cookies = await page.context().cookies();
  expect(cookies.filter(cookie => cookie.name.includes("otid") && cookie.name.includes("session")).map(cookie => cookie.name))
    .toEqual(["otid_race_administrator_session"]);

  let release!: () => void, observed!: () => void, done!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const seen = new Promise<void>(resolve => { observed = resolve; });
  const handled = new Promise<void>(resolve => { done = resolve; });
  await page.route(`**${base}/transfer-candidates`, async route => {
    const response = await route.fetch(); observed(); await gate;
    try { await route.fulfill({ response }); } catch { /* Logout intentionally aborts this pending read. */ }
    finally { done(); }
  });
  await showParticipants();
  await page.getByRole("button", { name: "Uppdatera deltagare", exact: true, includeHidden: true }).click();
  await seen;
  await page.getByRole("button", { name: "Logga ut", exact: true }).click();
  await expect(page.getByLabel("Administratörsbehörighet", { exact: true })).toBeVisible();
  release(); await handled;
  await expect(page.getByRole("button", { name: "Logga in", exact: true })).toBeEnabled();
  await expect(page.locator("body")).not.toContainText("Åsa Testperson");
  await expect(page.locator("body")).not.toContainText("Åsa Maria");
  await expect(page.locator("body")).not.toContainText("Nyanmäld");
  expect((await page.request.get(`${base}/transfer-candidates`)).status()).toBe(401);
});

test("TASK038 målklassens starttider hjälper utan att spärra klassbyte", async ({ page }, testInfo) => {
  const setup = await fixture();
  const alternateId = randomUUID(), punchId = randomUUID();
  await db.insert(schema.classes).values([
    { id: alternateId, raceId: setup.raceId, name: "Annan minutstart", courseVersionId: setup.courseVersionId, startRule: "FIXED" },
    { id: punchId, raceId: setup.raceId, name: "Fri start", courseVersionId: setup.courseVersionId, startRule: "PUNCH" }
  ]);
  await db.insert(schema.entries).values([
    ...Array.from({ length: 22 }, (_, index) => ({ id: randomUUID(), raceId: setup.raceId, classId: setup.targetClassId,
      givenName: "Start", familyName: String(index).padStart(2, "0"),
      fixedStartTime: new Date(Date.UTC(2026, 8, 12, 10, 30 + index)) })),
    { id: randomUUID(), raceId: setup.raceId, classId: setup.targetClassId, givenName: "Utan", familyName: "Starttid", fixedStartTime: null },
    { id: randomUUID(), raceId: setup.raceId, classId: alternateId, givenName: "Annan", familyName: "Klass", fixedStartTime: new Date("2026-09-12T13:00:00Z") }
  ]);
  let apiRequests = 0;
  page.on("request", request => { if (request.url().includes(`/api/admin/races/${setup.raceId}/administrator`)) apiRequests += 1; });
  await page.setViewportSize({ width: 390, height: 900 });
  await page.goto(`/admin/${setup.raceId}/manage`);
  await expect(page.getByRole("button", { name: "Logga in", exact: true })).toBeEnabled();
  await signIn(page, setup.admin.accessCredential);
  await page.getByLabel("Sök namn, klubb, klass eller bricka", { exact: true }).fill("Åsa");
  await page.getByRole("button", { name: "Åsa Testperson Test OK", exact: true }).click();
  await expect(page.getByRole("region", { name: "Gällande resultat", exact: true })).toContainText("Inget publicerat resultat");
  await page.getByRole("button", { name: "Byt klass", exact: true }).click();
  const select = page.getByRole("combobox", { name: "Ny klass", exact: true });
  await select.selectOption(setup.targetClassId);
  const times = page.getByRole("region", { name: "Målklassens tilldelade starttider", exact: true });
  await expect(times.locator("summary")).toContainText("(22)");
  const readCount = apiRequests;
  await times.locator("summary").click();
  await expect(times).toContainText("Deltagare utan fast starttid: 1");
  await expect(times.locator("tbody tr")).toHaveCount(20);
  await expect(times.locator("tbody tr").first()).toContainText("Start 00");
  await expect(times.locator("tbody tr").first()).toContainText("2026-09-12 12:30:00 GMT+02:00");
  await times.getByRole("button", { name: "Nästa tider", exact: true }).click();
  await expect(times.locator("tbody tr")).toHaveCount(2);
  await expect(times).toContainText("Start 21");
  await expect(times.getByRole("button", { name: "Nästa tider", exact: true })).toBeDisabled();
  await select.selectOption(alternateId);
  await times.locator("summary").click();
  await expect(times.locator("tbody tr")).toHaveCount(1);
  await expect(times).toContainText("Annan Klass");
  await select.selectOption(setup.targetClassId);
  await times.locator("summary").click();
  await expect(times.locator("tbody tr")).toHaveCount(20);
  await expect(times.getByRole("button", { name: "Föregående tider", exact: true })).toBeDisabled();
  await select.selectOption(punchId);
  await expect(times).toHaveCount(0);
  await select.selectOption(setup.targetClassId);
  // Same instant with a different offset: informational warning, not a new restriction.
  await page.getByLabel("Startdatum", { exact: true }).fill("2026-09-12");
  await page.getByLabel("Klockslag", { exact: true }).fill("11:30:00");
  await page.getByLabel("UTC-offset", { exact: true }).fill("+01:00");
  await expect(times).toContainText("Samma tidsögonblick är redan tilldelat: 1");
  await expect(page.getByRole("button", { name: "Granska klassbyte", exact: true })).toBeEnabled();
  expect(apiRequests).toBe(readCount);
  for (const width of [390, 1366]) {
    await page.setViewportSize({ width, height: 900 });
    await expect(times).toBeVisible();
    if (!(await times.locator("details").evaluate(element => (element as HTMLDetailsElement).open))) await times.locator("summary").click();
    const tableScroll = times.getByRole("region", { name: "Tilldelad starttid", exact: true });
    const tableBox = await tableScroll.boundingBox();
    expect(tableBox?.height).toBeLessThanOrEqual(width === 390 ? 300 : 470);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath(`target-times-${width}.png`), fullPage: true });
  }
  await page.getByRole("button", { name: "Granska klassbyte", exact: true }).click();
  await page.getByRole("button", { name: "Bekräfta klassbyte", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("Klassbytet och starttiden är sparade.");
  const [changed] = await db.select().from(schema.entries).where(eq(schema.entries.id, setup.entryId));
  expect(changed).toMatchObject({ classId: setup.targetClassId, fixedStartTime: new Date("2026-09-12T10:30:00Z"), version: 2 });
  expect(await db.select().from(schema.entryTransferRequests).where(eq(schema.entryTransferRequests.raceId, setup.raceId))).toHaveLength(1);
  await page.getByRole("button", { name: "Logga ut", exact: true }).click();
  await expect(page.getByLabel("Administratörsbehörighet", { exact: true })).toBeVisible();
  await expect(times).toHaveCount(0);
});

test("TASK040 samma administratör markerar och rättar ej start med exakt retry", async ({ page }, testInfo) => {
  const setup = await fixture();
  const base = `/api/admin/races/${setup.raceId}/administrator`;
  await page.setViewportSize({ width: 390, height: 900 });
  await page.goto(`/admin/${setup.raceId}/manage`);
  await expect(page.getByRole("button", { name: "Logga in", exact: true })).toBeEnabled();
  await signIn(page, setup.admin.accessCredential);
  await page.getByRole("button", { name: "Åsa Testperson Test OK", exact: true }).click();
  await chooseResultAction(page, "Ej startande");
  const dnsPanel = page.getByRole("region", { name: "Ej startande", exact: true });
  const requests: Record<string, { key: string | undefined; body: string | null }[]> = {};
  for (const endpoint of ["did-not-start", "did-not-start-withdrawal"]) {
    requests[endpoint] = [];
    await page.route(`**${base}/entries/${setup.entryId}/${endpoint}`, async route => {
      requests[endpoint]!.push({ key: route.request().headers()["idempotency-key"], body: route.request().postData() });
      const response = await route.fetch();
      expect(response.status()).toBe(200);
      if (requests[endpoint]!.length === 1) await route.abort("failed");
      else await route.fulfill({ response });
    });
  }
  await dnsPanel.getByRole("button", { name: "Granska ej start", exact: true }).click();
  await dnsPanel.getByRole("button", { name: "Bekräfta ej start", exact: true }).click();
  await expect(dnsPanel).toContainText("Svaret saknas.");
  await expect(page.getByRole("button", { name: "Deltagarlista", exact: true })).toBeDisabled();
  await dnsPanel.getByRole("button", { name: "Försök igen med samma begäran", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("Ej start är sparat.");
  await expect(page.getByRole("region", { name: "Gällande resultat", exact: true })).toContainText("Gällande resultat: Ej start");
  const revisions = await db.select().from(schema.resultRevisions).where(eq(schema.resultRevisions.raceId, setup.raceId));
  expect(revisions).toHaveLength(1);
  expect(revisions[0]).toMatchObject({ status: "DNS", reason: "DID_NOT_START", readoutId: null, revision: 1 });
  await dnsPanel.getByRole("button", { name: "Granska återtagande", exact: true }).click();
  for (const width of [390, 1366]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath(`dns-correction-${width}.png`), fullPage: true });
  }
  await dnsPanel.getByRole("button", { name: "Bekräfta återtagande", exact: true }).click();
  await dnsPanel.getByRole("button", { name: "Försök igen med samma begäran", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("Ej-startbeslutet är återtaget.");
  await expect(dnsPanel).toContainText("Det manuella ej-startbeslutet är redan återtaget.");
  await expect(page.getByRole("region", { name: "Gällande resultat", exact: true })).toContainText("Inget aktivt resultat");
  await expect(dnsPanel.getByRole("button", { name: "Granska ej start", exact: true })).toHaveCount(0);
  for (const attempts of Object.values(requests)) { expect(attempts).toHaveLength(2); expect(attempts[1]).toEqual(attempts[0]); }
  expect(await db.select().from(schema.didNotStartDecisions).where(eq(schema.didNotStartDecisions.raceId, setup.raceId))).toHaveLength(1);
  expect(await db.select().from(schema.didNotStartWithdrawals).where(eq(schema.didNotStartWithdrawals.raceId, setup.raceId))).toHaveLength(1);
  expect(await db.select().from(schema.resultRevisions).where(eq(schema.resultRevisions.raceId, setup.raceId))).toEqual(revisions);
  expect(await db.select().from(schema.rawDeviceMessages).where(eq(schema.rawDeviceMessages.raceId, setup.raceId))).toHaveLength(0);
  const [race] = await db.select().from(schema.races).where(eq(schema.races.id, setup.raceId));
  const [entry] = await db.select().from(schema.entries).where(eq(schema.entries.id, setup.entryId));
  expect(race?.snapshotVersion).toBe(1); expect(entry?.version).toBe(1);
  const audits = await db.select().from(schema.auditEvents).where(eq(schema.auditEvents.raceId, setup.raceId));
  for (const action of ["DID_NOT_START_DECIDED", "DID_NOT_START_WITHDRAWN"]) {
    expect(audits.find(row => row.action === action)).toMatchObject({ actorKind: "RACE_ADMIN_ACCESS_CREDENTIAL", actorId: setup.admin.credentialId });
  }
  await page.getByRole("button", { name: "Logga ut", exact: true }).click();
  await expect(page.getByLabel("Administratörsbehörighet", { exact: true })).toBeVisible();
  await expect(dnsPanel).toHaveCount(0);
});

test("TASK044 godkännande bevarar senare avläsning och rättas från granskad källa", async ({ page }, testInfo) => {
  const setup = await fixture();
  const base = `/api/admin/races/${setup.raceId}/administrator`;
  const deviceId = randomUUID();
  async function ingest(sequence: number, finish: string) {
    const payload = { cardNumber: "123456", startPunchedAt: "2026-09-12T10:30:00Z", finishPunchedAt: finish,
      punches: [] };
    const result = await ingestDeviceBatch(db, setup.raceId, { deviceId, sessionId: deviceId, packageVersion: 1,
      firstSequence: sequence, lastSequence: sequence, events: [{ localSequence: sequence, stationReceivedAt: finish,
        transport: "simulator", payload, contentHash: createHash("sha256").update(JSON.stringify(payload)).digest("hex") }] });
    expect(result.acknowledgements[0]?.status).toBe("stored");
  }
  await page.setViewportSize({ width: 390, height: 900 });
  await page.goto(`/admin/${setup.raceId}/manage`);
  await expect(page.getByRole("button", { name: "Logga in", exact: true })).toBeEnabled();
  await signIn(page, setup.admin.accessCredential);
  await page.getByRole("button", { name: "Åsa Testperson Test OK", exact: true }).click();
  await chooseResultAction(page, "Manuellt godkännande");
  const panel = page.getByRole("region", { name: "Manuellt godkännande", exact: true });
  await expect(panel).toContainText("Inget aktivt tekniskt resultat finns.");
  await expect(panel.getByRole("button", { name: "Granska godkännande", exact: true })).toHaveCount(0);
  await ingest(1, "2026-09-12T10:50:00Z");
  await panel.getByRole("button", { name: "Uppdatera godkännandeunderlag", exact: true }).click();
  const requests: Record<string, { key: string | undefined; body: string | null }[]> = {};
  for (const endpoint of ["approval", "approval-withdrawal"]) {
    requests[endpoint] = [];
    await page.route(`**${base}/entries/${setup.entryId}/${endpoint}`, async route => {
      requests[endpoint]!.push({ key: route.request().headers()["idempotency-key"], body: route.request().postData() });
      const response = await route.fetch();
      expect(response.status()).toBe(200);
      if (requests[endpoint]!.length === 1) await route.abort("failed");
      else await route.fulfill({ response });
    });
  }
  await panel.getByRole("button", { name: "Granska godkännande", exact: true }).click();
  await checkCompactReview(page, panel, "Statusändring: Felstämplad → Godkänd", "Berörd teknisk revision: 1");
  await panel.locator("summary").click();
  await panel.getByRole("button", { name: "Ändra val", exact: true }).click();
  await panel.getByRole("button", { name: "Granska godkännande", exact: true }).click();
  await expect(panel.locator("details")).toHaveJSProperty("open", false);
  await panel.getByRole("button", { name: "Bekräfta godkännande", exact: true }).click();
  await expect(panel.getByText("Svaret saknas. Åtgärden kan vara sparad. Återförsök endast samma begäran.", { exact: true })).toBeVisible();
  await panel.getByRole("button", { name: "Försök igen med samma begäran", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("Godkännandet är sparat.");
  await expect(page.getByRole("region", { name: "Gällande resultat", exact: true })).toContainText("Godkänd");
  await ingest(2, "2026-09-12T10:55:00Z");
  await panel.getByRole("button", { name: "Uppdatera godkännandeunderlag", exact: true }).click();
  await expect(page.getByRole("region", { name: "Gällande resultat", exact: true })).toContainText("Godkänd");
  const revisions = await db.select().from(schema.resultRevisions).where(eq(schema.resultRevisions.raceId, setup.raceId));
  expect(revisions).toHaveLength(3);
  const raw = await db.select().from(schema.rawDeviceMessages).where(eq(schema.rawDeviceMessages.raceId, setup.raceId));
  expect(raw).toHaveLength(2);
  await panel.getByRole("button", { name: "Granska återtagande av godkännande", exact: true }).click();
  await checkCompactReview(page, panel, "Statusändring: Godkänd → Felstämplad", "Restaureringskälla: 3");
  for (const width of [390, 1366]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath(`approval-correction-${width}.png`), fullPage: true });
  }
  await panel.getByRole("button", { name: "Bekräfta återtagande av godkännande", exact: true }).click();
  await panel.getByRole("button", { name: "Försök igen med samma begäran", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("Godkännandet är återtaget.");
  await expect(page.getByRole("region", { name: "Gällande resultat", exact: true })).toContainText("Felstämplad");
  await expect(page.getByRole("region", { name: "Gällande resultat", exact: true })).toContainText("25:00");
  for (const attempts of Object.values(requests)) { expect(attempts).toHaveLength(2); expect(attempts[1]).toEqual(attempts[0]); }
  const after = await db.select().from(schema.resultRevisions).where(eq(schema.resultRevisions.raceId, setup.raceId));
  expect(after).toHaveLength(4);
  for (const original of revisions) expect(after.find(row => row.id === original.id)).toEqual(original);
  expect(after.find(row => row.revision === 4)).toMatchObject({ cause: "MANUAL_RESULT_APPROVAL_WITHDRAWAL", status: "MP",
    evaluation: revisions.find(row => row.revision === 3)?.evaluation });
  expect(await db.select().from(schema.rawDeviceMessages).where(eq(schema.rawDeviceMessages.raceId, setup.raceId))).toEqual(raw);
  expect(await db.select().from(schema.resultApprovalDecisions).where(eq(schema.resultApprovalDecisions.raceId, setup.raceId))).toHaveLength(1);
  expect(await db.select().from(schema.resultApprovalWithdrawals).where(eq(schema.resultApprovalWithdrawals.raceId, setup.raceId))).toHaveLength(1);
  const [race] = await db.select().from(schema.races).where(eq(schema.races.id, setup.raceId));
  expect(race?.snapshotVersion).toBe(1);
  const audits = await db.select().from(schema.auditEvents).where(eq(schema.auditEvents.raceId, setup.raceId));
  for (const action of ["RESULT_APPROVED", "RESULT_APPROVAL_WITHDRAWN"]) {
    expect(audits.find(row => row.action === action)).toMatchObject({ actorKind: "RACE_ADMIN_ACCESS_CREDENTIAL", actorId: setup.admin.credentialId });
  }
  await page.getByRole("button", { name: "Logga ut", exact: true }).click();
  await expect(page.getByLabel("Administratörsbehörighet", { exact: true })).toBeVisible();
  await expect(panel).toHaveCount(0);
});

test("TASK042 diskvalificering bevarar senare avläsning och rättas från granskad källa", async ({ page }, testInfo) => {
  const setup = await fixture();
  const base = `/api/admin/races/${setup.raceId}/administrator`;
  const deviceId = randomUUID();
  async function ingest(sequence: number, finish: string) {
    const payload = { cardNumber: "123456", startPunchedAt: "2026-09-12T10:30:00Z", finishPunchedAt: finish,
      punches: [{ code: 31, punchedAt: "2026-09-12T10:40:00Z" }] };
    const result = await ingestDeviceBatch(db, setup.raceId, { deviceId, sessionId: deviceId, packageVersion: 1,
      firstSequence: sequence, lastSequence: sequence, events: [{ localSequence: sequence, stationReceivedAt: finish,
        transport: "simulator", payload, contentHash: createHash("sha256").update(JSON.stringify(payload)).digest("hex") }] });
    expect(result.acknowledgements[0]?.status).toBe("stored");
  }
  await page.setViewportSize({ width: 390, height: 900 });
  await page.goto(`/admin/${setup.raceId}/manage`);
  await expect(page.getByRole("button", { name: "Logga in", exact: true })).toBeEnabled();
  await signIn(page, setup.admin.accessCredential);
  await page.getByRole("button", { name: "Åsa Testperson Test OK", exact: true }).click();
  await chooseResultAction(page, "Diskvalificering");
  const panel = page.getByRole("region", { name: "Diskvalificering", exact: true });
  await expect(panel).toContainText("Inget aktivt tekniskt resultat finns.");
  await expect(panel.getByRole("button", { name: "Granska diskvalificering", exact: true })).toHaveCount(0);
  await ingest(1, "2026-09-12T10:50:00Z");
  await panel.getByRole("button", { name: "Uppdatera diskvalificeringsunderlag", exact: true }).click();
  const requests: Record<string, { key: string | undefined; body: string | null }[]> = {};
  for (const endpoint of ["disqualification", "disqualification-withdrawal"]) {
    requests[endpoint] = [];
    await page.route(`**${base}/entries/${setup.entryId}/${endpoint}`, async route => {
      requests[endpoint]!.push({ key: route.request().headers()["idempotency-key"], body: route.request().postData() });
      const response = await route.fetch();
      expect(response.status()).toBe(200);
      if (requests[endpoint]!.length === 1) await route.abort("failed");
      else await route.fulfill({ response });
    });
  }
  await panel.getByRole("button", { name: "Granska diskvalificering", exact: true }).click();
  await checkCompactReview(page, panel, "Statusändring: Godkänd → Diskvalificerad", "Berörd teknisk revision: 1");
  await panel.locator("summary").click();
  await panel.getByRole("button", { name: "Ändra val", exact: true }).click();
  await panel.getByRole("button", { name: "Granska diskvalificering", exact: true }).click();
  await expect(panel.locator("details")).toHaveJSProperty("open", false);
  await panel.getByRole("button", { name: "Bekräfta diskvalificering", exact: true }).click();
  await expect(panel.getByText("Svaret saknas. Åtgärden kan vara sparad. Återförsök endast samma begäran.", { exact: true })).toBeVisible();
  await panel.getByRole("button", { name: "Försök igen med samma begäran", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("Diskvalificeringen är sparad.");
  await expect(page.getByRole("region", { name: "Gällande resultat", exact: true })).toContainText("Diskvalificerad");
  await ingest(2, "2026-09-12T10:55:00Z");
  await panel.getByRole("button", { name: "Uppdatera diskvalificeringsunderlag", exact: true }).click();
  await expect(page.getByRole("region", { name: "Gällande resultat", exact: true })).toContainText("Diskvalificerad");
  const revisions = await db.select().from(schema.resultRevisions).where(eq(schema.resultRevisions.raceId, setup.raceId));
  expect(revisions).toHaveLength(3);
  const raw = await db.select().from(schema.rawDeviceMessages).where(eq(schema.rawDeviceMessages.raceId, setup.raceId));
  expect(raw).toHaveLength(2);
  await panel.getByRole("button", { name: "Granska återtagande av diskvalificering", exact: true }).click();
  await checkCompactReview(page, panel, "Statusändring: Diskvalificerad → Godkänd", "Restaureringskälla: 3");
  for (const width of [390, 1366]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath(`dsq-correction-${width}.png`), fullPage: true });
  }
  await panel.getByRole("button", { name: "Bekräfta återtagande av diskvalificering", exact: true }).click();
  await panel.getByRole("button", { name: "Försök igen med samma begäran", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("Diskvalificeringen är återtagen.");
  await expect(page.getByRole("region", { name: "Gällande resultat", exact: true })).toContainText("Godkänd");
  await expect(page.getByRole("region", { name: "Gällande resultat", exact: true })).toContainText("25:00");
  for (const attempts of Object.values(requests)) { expect(attempts).toHaveLength(2); expect(attempts[1]).toEqual(attempts[0]); }
  const after = await db.select().from(schema.resultRevisions).where(eq(schema.resultRevisions.raceId, setup.raceId));
  expect(after).toHaveLength(4);
  for (const original of revisions) expect(after.find(row => row.id === original.id)).toEqual(original);
  expect(after.find(row => row.revision === 4)).toMatchObject({ cause: "MANUAL_DISQUALIFICATION_WITHDRAWAL", status: "OK",
    evaluation: revisions.find(row => row.revision === 3)?.evaluation });
  expect(await db.select().from(schema.rawDeviceMessages).where(eq(schema.rawDeviceMessages.raceId, setup.raceId))).toEqual(raw);
  expect(await db.select().from(schema.resultDisqualificationDecisions).where(eq(schema.resultDisqualificationDecisions.raceId, setup.raceId))).toHaveLength(1);
  expect(await db.select().from(schema.resultDisqualificationWithdrawals).where(eq(schema.resultDisqualificationWithdrawals.raceId, setup.raceId))).toHaveLength(1);
  const [race] = await db.select().from(schema.races).where(eq(schema.races.id, setup.raceId));
  expect(race?.snapshotVersion).toBe(1);
  const audits = await db.select().from(schema.auditEvents).where(eq(schema.auditEvents.raceId, setup.raceId));
  for (const action of ["RESULT_DISQUALIFIED", "RESULT_DISQUALIFICATION_WITHDRAWN"]) {
    expect(audits.find(row => row.action === action)).toMatchObject({ actorKind: "RACE_ADMIN_ACCESS_CREDENTIAL", actorId: setup.admin.credentialId });
  }
  await page.getByRole("button", { name: "Logga ut", exact: true }).click();
  await expect(page.getByLabel("Administratörsbehörighet", { exact: true })).toBeVisible();
  await expect(panel).toHaveCount(0);
});

test("TASK046 NT bevarar senare avläsning och rättas från granskad källa", async ({ page }, testInfo) => {
  const setup = await fixture();
  const base = `/api/admin/races/${setup.raceId}/administrator`;
  const deviceId = randomUUID();
  async function ingest(sequence: number, finish: string) {
    const payload = { cardNumber: "123456", startPunchedAt: "2026-09-12T10:30:00Z", finishPunchedAt: finish,
      punches: [{ code: 31, punchedAt: "2026-09-12T10:40:00Z" }] };
    const result = await ingestDeviceBatch(db, setup.raceId, { deviceId, sessionId: deviceId, packageVersion: 1,
      firstSequence: sequence, lastSequence: sequence, events: [{ localSequence: sequence, stationReceivedAt: finish,
        transport: "simulator", payload, contentHash: createHash("sha256").update(JSON.stringify(payload)).digest("hex") }] });
    expect(result.acknowledgements[0]?.status).toBe("stored");
  }
  await page.setViewportSize({ width: 390, height: 900 });
  await page.goto(`/admin/${setup.raceId}/manage`);
  await expect(page.getByRole("button", { name: "Logga in", exact: true })).toBeEnabled();
  await signIn(page, setup.admin.accessCredential);
  await page.getByRole("button", { name: "Åsa Testperson Test OK", exact: true }).click();
  await chooseResultAction(page, "Utan tidtagning");
  const panel = page.getByRole("region", { name: "Utan tidtagning", exact: true });
  await expect(panel).toContainText("Inget aktivt tekniskt resultat finns.");
  await expect(panel.getByRole("button", { name: "Granska utan tidtagning", exact: true })).toHaveCount(0);
  await ingest(1, "2026-09-12T10:50:00Z");
  await panel.getByRole("button", { name: "Uppdatera NT-underlag", exact: true }).click();
  const requests: Record<string, { key: string | undefined; body: string | null }[]> = {};
  for (const endpoint of ["without-timing", "without-timing-withdrawal"]) {
    requests[endpoint] = [];
    await page.route(`**${base}/entries/${setup.entryId}/${endpoint}`, async route => {
      requests[endpoint]!.push({ key: route.request().headers()["idempotency-key"], body: route.request().postData() });
      const response = await route.fetch();
      expect(response.status()).toBe(200);
      if (requests[endpoint]!.length === 1) await route.abort("failed");
      else await route.fulfill({ response });
    });
  }
  await panel.getByRole("button", { name: "Granska utan tidtagning", exact: true }).click();
  await checkCompactReview(page, panel, "Statusändring: Godkänd → Utan tidtagning", "Berörd teknisk revision: 1");
  await expect(panel.getByText(/IOF-export och finalisering blockeras/)).toBeVisible();
  await panel.locator("summary").click();
  await panel.getByRole("button", { name: "Ändra val", exact: true }).click();
  await panel.getByRole("button", { name: "Granska utan tidtagning", exact: true }).click();
  await expect(panel.locator("details")).toHaveJSProperty("open", false);
  await panel.getByRole("button", { name: "Bekräfta utan tidtagning", exact: true }).click();
  await panel.getByRole("button", { name: "Försök igen med samma begäran", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("Utan tidtagning är sparat.");
  await expect(page.getByRole("region", { name: "Gällande resultat", exact: true })).toContainText("Utan tidtagning");
  await expect(page.getByRole("region", { name: "Gällande resultat", exact: true })).not.toContainText("20:00");
  await ingest(2, "2026-09-12T10:55:00Z");
  await panel.getByRole("button", { name: "Uppdatera NT-underlag", exact: true }).click();
  await expect(page.getByRole("region", { name: "Gällande resultat", exact: true })).toContainText("Utan tidtagning");
  const revisions = await db.select().from(schema.resultRevisions).where(eq(schema.resultRevisions.raceId, setup.raceId));
  expect(revisions).toHaveLength(3);
  const raw = await db.select().from(schema.rawDeviceMessages).where(eq(schema.rawDeviceMessages.raceId, setup.raceId));
  expect(raw).toHaveLength(2);
  await panel.getByRole("button", { name: "Granska återtagande av utan tidtagning", exact: true }).click();
  await checkCompactReview(page, panel, "Statusändring: Utan tidtagning → Godkänd", "Restaureringskälla: 3");
  for (const width of [390, 1366]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath(`nt-correction-${width}.png`), fullPage: true });
  }
  await panel.getByRole("button", { name: "Bekräfta återtagande av utan tidtagning", exact: true }).click();
  await panel.getByRole("button", { name: "Försök igen med samma begäran", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("Beslutet om utan tidtagning är återtaget.");
  await expect(page.getByRole("region", { name: "Gällande resultat", exact: true })).toContainText("Godkänd");
  await expect(page.getByRole("region", { name: "Gällande resultat", exact: true })).toContainText("25:00");
  for (const attempts of Object.values(requests)) { expect(attempts).toHaveLength(2); expect(attempts[1]).toEqual(attempts[0]); }
  const after = await db.select().from(schema.resultRevisions).where(eq(schema.resultRevisions.raceId, setup.raceId));
  expect(after).toHaveLength(4);
  for (const original of revisions) expect(after.find(row => row.id === original.id)).toEqual(original);
  expect(after.find(row => row.revision === 4)).toMatchObject({ cause: "MANUAL_WITHOUT_TIMING_WITHDRAWAL", status: "OK",
    evaluation: revisions.find(row => row.revision === 3)?.evaluation });
  expect(await db.select().from(schema.rawDeviceMessages).where(eq(schema.rawDeviceMessages.raceId, setup.raceId))).toEqual(raw);
  expect(await db.select().from(schema.withoutTimingDecisions).where(eq(schema.withoutTimingDecisions.raceId, setup.raceId))).toHaveLength(1);
  expect(await db.select().from(schema.withoutTimingWithdrawals).where(eq(schema.withoutTimingWithdrawals.raceId, setup.raceId))).toHaveLength(1);
  const [race] = await db.select().from(schema.races).where(eq(schema.races.id, setup.raceId));
  expect(race?.snapshotVersion).toBe(1);
  const audits = await db.select().from(schema.auditEvents).where(eq(schema.auditEvents.raceId, setup.raceId));
  for (const action of ["WITHOUT_TIMING_DECIDED", "WITHOUT_TIMING_WITHDRAWN"]) {
    expect(audits.find(row => row.action === action)).toMatchObject({ actorKind: "RACE_ADMIN_ACCESS_CREDENTIAL", actorId: setup.admin.credentialId });
  }
  await page.getByRole("button", { name: "Logga ut", exact: true }).click();
  await expect(page.getByLabel("Administratörsbehörighet", { exact: true })).toBeVisible();
  await expect(panel).toHaveCount(0);
});

test("TASK045 OOC bevarar senare avläsning och rättas från granskad källa", async ({ page }, testInfo) => {
  const setup = await fixture();
  const base = `/api/admin/races/${setup.raceId}/administrator`;
  const deviceId = randomUUID();
  async function ingest(sequence: number, finish: string) {
    const payload = { cardNumber: "123456", startPunchedAt: "2026-09-12T10:30:00Z", finishPunchedAt: finish,
      punches: [{ code: 31, punchedAt: "2026-09-12T10:40:00Z" }] };
    const result = await ingestDeviceBatch(db, setup.raceId, { deviceId, sessionId: deviceId, packageVersion: 1,
      firstSequence: sequence, lastSequence: sequence, events: [{ localSequence: sequence, stationReceivedAt: finish,
        transport: "simulator", payload, contentHash: createHash("sha256").update(JSON.stringify(payload)).digest("hex") }] });
    expect(result.acknowledgements[0]?.status).toBe("stored");
  }
  await page.setViewportSize({ width: 390, height: 900 });
  await page.goto(`/admin/${setup.raceId}/manage`);
  await expect(page.getByRole("button", { name: "Logga in", exact: true })).toBeEnabled();
  await signIn(page, setup.admin.accessCredential);
  await page.getByRole("button", { name: "Åsa Testperson Test OK", exact: true }).click();
  await chooseResultAction(page, "Utom tävlan");
  const panel = page.getByRole("region", { name: "Utom tävlan", exact: true });
  await expect(panel).toContainText("Inget aktivt tekniskt resultat finns.");
  await expect(panel.getByRole("button", { name: "Granska utom tävlan", exact: true })).toHaveCount(0);
  await ingest(1, "2026-09-12T10:50:00Z");
  await panel.getByRole("button", { name: "Uppdatera OOC-underlag", exact: true }).click();
  const requests: Record<string, { key: string | undefined; body: string | null }[]> = {};
  for (const endpoint of ["out-of-competition", "out-of-competition-withdrawal"]) {
    requests[endpoint] = [];
    await page.route(`**${base}/entries/${setup.entryId}/${endpoint}`, async route => {
      requests[endpoint]!.push({ key: route.request().headers()["idempotency-key"], body: route.request().postData() });
      const response = await route.fetch();
      expect(response.status()).toBe(200);
      if (requests[endpoint]!.length === 1) await route.abort("failed");
      else await route.fulfill({ response });
    });
  }
  await panel.getByRole("button", { name: "Granska utom tävlan", exact: true }).click();
  await checkCompactReview(page, panel, "Statusändring: Godkänd → Utom tävlan", "Berörd teknisk revision: 1");
  await panel.locator("summary").click();
  await panel.getByRole("button", { name: "Ändra val", exact: true }).click();
  await panel.getByRole("button", { name: "Granska utom tävlan", exact: true }).click();
  await expect(panel.locator("details")).toHaveJSProperty("open", false);
  await panel.getByRole("button", { name: "Bekräfta utom tävlan", exact: true }).click();
  await panel.getByRole("button", { name: "Försök igen med samma begäran", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("Utom tävlan är sparat.");
  await expect(page.getByRole("region", { name: "Gällande resultat", exact: true })).toContainText("Utom tävlan");
  await ingest(2, "2026-09-12T10:55:00Z");
  await panel.getByRole("button", { name: "Uppdatera OOC-underlag", exact: true }).click();
  await expect(page.getByRole("region", { name: "Gällande resultat", exact: true })).toContainText("Utom tävlan");
  const revisions = await db.select().from(schema.resultRevisions).where(eq(schema.resultRevisions.raceId, setup.raceId));
  expect(revisions).toHaveLength(3);
  const raw = await db.select().from(schema.rawDeviceMessages).where(eq(schema.rawDeviceMessages.raceId, setup.raceId));
  expect(raw).toHaveLength(2);
  await panel.getByRole("button", { name: "Granska återtagande av utom tävlan", exact: true }).click();
  await checkCompactReview(page, panel, "Statusändring: Utom tävlan → Godkänd", "Restaureringskälla: 3");
  for (const width of [390, 1366]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath(`ooc-correction-${width}.png`), fullPage: true });
  }
  await panel.getByRole("button", { name: "Bekräfta återtagande av utom tävlan", exact: true }).click();
  await panel.getByRole("button", { name: "Försök igen med samma begäran", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("Beslutet om utom tävlan är återtaget.");
  await expect(page.getByRole("region", { name: "Gällande resultat", exact: true })).toContainText("Godkänd");
  await expect(page.getByRole("region", { name: "Gällande resultat", exact: true })).toContainText("25:00");
  for (const attempts of Object.values(requests)) { expect(attempts).toHaveLength(2); expect(attempts[1]).toEqual(attempts[0]); }
  const after = await db.select().from(schema.resultRevisions).where(eq(schema.resultRevisions.raceId, setup.raceId));
  expect(after).toHaveLength(4);
  for (const original of revisions) expect(after.find(row => row.id === original.id)).toEqual(original);
  expect(after.find(row => row.revision === 4)).toMatchObject({ cause: "MANUAL_OUT_OF_COMPETITION_WITHDRAWAL", status: "OK",
    evaluation: revisions.find(row => row.revision === 3)?.evaluation });
  expect(await db.select().from(schema.rawDeviceMessages).where(eq(schema.rawDeviceMessages.raceId, setup.raceId))).toEqual(raw);
  expect(await db.select().from(schema.notCompetingDecisions).where(eq(schema.notCompetingDecisions.raceId, setup.raceId))).toHaveLength(1);
  expect(await db.select().from(schema.notCompetingWithdrawals).where(eq(schema.notCompetingWithdrawals.raceId, setup.raceId))).toHaveLength(1);
  const [race] = await db.select().from(schema.races).where(eq(schema.races.id, setup.raceId));
  expect(race?.snapshotVersion).toBe(1);
  const audits = await db.select().from(schema.auditEvents).where(eq(schema.auditEvents.raceId, setup.raceId));
  for (const action of ["OUT_OF_COMPETITION_DECIDED", "OUT_OF_COMPETITION_WITHDRAWN"]) {
    expect(audits.find(row => row.action === action)).toMatchObject({ actorKind: "RACE_ADMIN_ACCESS_CREDENTIAL", actorId: setup.admin.credentialId });
  }
  await page.getByRole("button", { name: "Logga ut", exact: true }).click();
  await expect(page.getByLabel("Administratörsbehörighet", { exact: true })).toBeVisible();
  await expect(panel).toHaveCount(0);
});

test("TASK041 DNF bevarar senare avläsning och rättas från granskad källa", async ({ page }, testInfo) => {
  const setup = await fixture();
  const base = `/api/admin/races/${setup.raceId}/administrator`;
  const deviceId = randomUUID();
  async function ingest(sequence: number, finish: string) {
    const payload = { cardNumber: "123456", startPunchedAt: "2026-09-12T10:30:00Z", finishPunchedAt: finish,
      punches: [{ code: 31, punchedAt: "2026-09-12T10:40:00Z" }] };
    const result = await ingestDeviceBatch(db, setup.raceId, { deviceId, sessionId: deviceId, packageVersion: 1,
      firstSequence: sequence, lastSequence: sequence, events: [{ localSequence: sequence, stationReceivedAt: finish,
        transport: "simulator", payload, contentHash: createHash("sha256").update(JSON.stringify(payload)).digest("hex") }] });
    expect(result.acknowledgements[0]?.status).toBe("stored");
  }
  await page.setViewportSize({ width: 390, height: 900 });
  await page.goto(`/admin/${setup.raceId}/manage`);
  await expect(page.getByRole("button", { name: "Logga in", exact: true })).toBeEnabled();
  await signIn(page, setup.admin.accessCredential);
  await page.getByRole("button", { name: "Åsa Testperson Test OK", exact: true }).click();
  await chooseResultAction(page, "Avbrutit lopp");
  const panel = page.getByRole("region", { name: "Avbrutit lopp", exact: true });
  await expect(panel).toContainText("Inget aktivt tekniskt resultat finns.");
  await expect(panel.getByRole("button", { name: "Granska avbrutit lopp", exact: true })).toHaveCount(0);
  await ingest(1, "2026-09-12T10:50:00Z");
  await panel.getByRole("button", { name: "Uppdatera DNF-underlag", exact: true }).click();
  const requests: Record<string, { key: string | undefined; body: string | null }[]> = {};
  for (const endpoint of ["did-not-finish", "did-not-finish-withdrawal"]) {
    requests[endpoint] = [];
    await page.route(`**${base}/entries/${setup.entryId}/${endpoint}`, async route => {
      requests[endpoint]!.push({ key: route.request().headers()["idempotency-key"], body: route.request().postData() });
      const response = await route.fetch();
      expect(response.status()).toBe(200);
      if (requests[endpoint]!.length === 1) await route.abort("failed");
      else await route.fulfill({ response });
    });
  }
  await panel.getByRole("button", { name: "Granska avbrutit lopp", exact: true }).click();
  await checkCompactReview(page, panel, "Statusändring: Godkänd → Ej fullföljt", "Berörd teknisk revision: 1");
  await panel.locator("summary").click();
  await panel.getByRole("button", { name: "Ändra val", exact: true }).click();
  await panel.getByRole("button", { name: "Granska avbrutit lopp", exact: true }).click();
  await expect(panel.locator("details")).toHaveJSProperty("open", false);
  await panel.getByRole("button", { name: "Bekräfta avbrutit lopp", exact: true }).click();
  await panel.getByRole("button", { name: "Försök igen med samma begäran", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("Avbrutit lopp är sparat.");
  await expect(page.getByRole("region", { name: "Gällande resultat", exact: true })).toContainText("Ej fullföljt");
  await ingest(2, "2026-09-12T10:55:00Z");
  await panel.getByRole("button", { name: "Uppdatera DNF-underlag", exact: true }).click();
  await expect(page.getByRole("region", { name: "Gällande resultat", exact: true })).toContainText("Ej fullföljt");
  const revisions = await db.select().from(schema.resultRevisions).where(eq(schema.resultRevisions.raceId, setup.raceId));
  expect(revisions).toHaveLength(3);
  const raw = await db.select().from(schema.rawDeviceMessages).where(eq(schema.rawDeviceMessages.raceId, setup.raceId));
  expect(raw).toHaveLength(2);
  await panel.getByRole("button", { name: "Granska återtagande av DNF", exact: true }).click();
  await checkCompactReview(page, panel, "Statusändring: Ej fullföljt → Godkänd", "Restaureringskälla: 3");
  for (const width of [390, 1366]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath(`dnf-correction-${width}.png`), fullPage: true });
  }
  await panel.getByRole("button", { name: "Bekräfta återtagande av DNF", exact: true }).click();
  await panel.getByRole("button", { name: "Försök igen med samma begäran", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("DNF-beslutet är återtaget.");
  await expect(page.getByRole("region", { name: "Gällande resultat", exact: true })).toContainText("Godkänd");
  await expect(page.getByRole("region", { name: "Gällande resultat", exact: true })).toContainText("25:00");
  for (const attempts of Object.values(requests)) { expect(attempts).toHaveLength(2); expect(attempts[1]).toEqual(attempts[0]); }
  const after = await db.select().from(schema.resultRevisions).where(eq(schema.resultRevisions.raceId, setup.raceId));
  expect(after).toHaveLength(4);
  for (const original of revisions) expect(after.find(row => row.id === original.id)).toEqual(original);
  expect(after.find(row => row.revision === 4)).toMatchObject({ cause: "MANUAL_DID_NOT_FINISH_WITHDRAWAL", status: "OK",
    evaluation: revisions.find(row => row.revision === 3)?.evaluation });
  expect(await db.select().from(schema.rawDeviceMessages).where(eq(schema.rawDeviceMessages.raceId, setup.raceId))).toEqual(raw);
  expect(await db.select().from(schema.didNotFinishDecisions).where(eq(schema.didNotFinishDecisions.raceId, setup.raceId))).toHaveLength(1);
  expect(await db.select().from(schema.didNotFinishWithdrawals).where(eq(schema.didNotFinishWithdrawals.raceId, setup.raceId))).toHaveLength(1);
  const [race] = await db.select().from(schema.races).where(eq(schema.races.id, setup.raceId));
  expect(race?.snapshotVersion).toBe(1);
  const audits = await db.select().from(schema.auditEvents).where(eq(schema.auditEvents.raceId, setup.raceId));
  for (const action of ["DID_NOT_FINISH_DECIDED", "DID_NOT_FINISH_WITHDRAWN"]) {
    expect(audits.find(row => row.action === action)).toMatchObject({ actorKind: "RACE_ADMIN_ACCESS_CREDENTIAL", actorId: setup.admin.credentialId });
  }
  await page.getByRole("button", { name: "Logga ut", exact: true }).click();
  await expect(page.getByLabel("Administratörsbehörighet", { exact: true })).toBeVisible();
  await expect(panel).toHaveCount(0);
});
