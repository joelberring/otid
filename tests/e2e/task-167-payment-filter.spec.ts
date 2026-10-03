import { expect, test } from "@playwright/test";
import { entryTransferCandidatesSchema, administratorEffectiveResultResponseSchema,
  adminCourseControlGeometryStateResponseSchema, speakerBoardResponseSchema, administratorForestWatchResponseSchema,
  publicResultListResponseV7Schema, unknownReadoutResolutionCandidateResponseSchema,
  type EntryTransferCandidates } from "@o-tid/contracts";

const raceId = "10000000-0000-4000-8000-000000000001";
const classId = "20000000-0000-4000-8000-000000000001";
const fixedClassId = "20000000-0000-4000-8000-000000000002";
const courseVersionId = "30000000-0000-4000-8000-000000000001";

function entry(index: number, paymentStatus: "UNMARKED" | "UNPAID" | "PAID" | "WAIVED") {
  const selectedRevision = { id: "50000000-0000-4000-8000-000000000001", revision: 1 };
  const effectiveResult = index === 1 ? { state: "ACTIVE_RESULT" as const, selectedRevision,
    resultSnapshotVersion: 1, result: { revision: 1, status: "MP" as const,
      reason: "MISSING_CONTROL" as const, elapsedMs: 300_000 } }
    : index === 2 ? { state: "ACTIVE_RESULT" as const, selectedRevision,
      resultSnapshotVersion: 2, result: { revision: 1, status: "OK" as const,
        reason: "COMPLETE" as const, elapsedMs: 240_000 } }
      : index === 3 ? { state: "NO_ACTIVE_RESULT" as const, selectedRevision }
        : { state: "NO_PUBLISHED_RESULT" as const, selectedRevision: null };
  return {
    id: `40000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
    displayName: ["Åsa Omarkerad", "Bo Obetald", "Cecilia Betald", "David Deltagare",
      "Elsa Exempel", "Filip Fiktiv"][index - 1],
    organisationName: "Syntetiska OK", classId, version: 1,
    paymentStatus, paymentStatusVersion: 1,
    resultFreshness: index === 1 ? "OLDER_SNAPSHOT" as const : index === 2 ? "CURRENT_SNAPSHOT" as const :
      index === 3 ? "NO_ACTIVE_RESULT" as const : "NO_PUBLISHED_RESULT" as const,
    effectiveResult,
    resultRevisionMarker: null, fixedStartTime: null, activeAssignment: null,
    multipleActiveAssignments: false,
  };
}

const roster = entryTransferCandidatesSchema.parse({
  formatVersion: 2, raceId, eventName: "Syntetisk tävling", raceName: "Lång",
  snapshotVersion: 2, raceDate: "2026-09-23", generatedAt: "2026-09-23T10:00:00.000Z",
  timeZone: "Europe/Stockholm",
  classes: [{ id: classId, name: "Öppen 5", courseVersionId, courseName: "Långbanan", courseVersion: 1, startRule: "PUNCH",
    maxEntries: null, capacityVersion: 1, entryCount: 5 },
  { id: fixedClassId, name: "D21", courseVersionId, courseName: "Långbanan", courseVersion: 1, startRule: "FIXED",
    maxEntries: 40, capacityVersion: 1, entryCount: 1 }],
  entries: [entry(1, "UNMARKED"), entry(2, "UNPAID"), { ...entry(3, "PAID"), classId: fixedClassId },
    entry(4, "PAID"), entry(5, "WAIVED"), entry(6, "PAID")],
});

const publicLeaders = publicResultListResponseV7Schema.parse({ formatVersion: 7, results: [
  { publicResultId: "80000000-0000-4000-8000-000000000001", className: "Öppen 5", givenName: "Klara",
    familyName: "Ledare", organisationName: "Syntetiska OK", revision: 1, status: "OK", reason: "COMPLETE",
    elapsedMs: 230_000, splits: [], missingControls: [], extraPunches: [], rankingState: "RANKED",
    position: 1, timeBehindMs: 0 },
  { publicResultId: "80000000-0000-4000-8000-000000000002", className: "Öppen 5", givenName: "Linn",
    familyName: "Delad", organisationName: null, revision: 1, status: "OK", reason: "COMPLETE",
    elapsedMs: 230_000, splits: [], missingControls: [], extraPunches: [], rankingState: "RANKED",
    position: 1, timeBehindMs: 0 },
  { publicResultId: "80000000-0000-4000-8000-000000000003", className: "Öppen 5", givenName: "Bo",
    familyName: "Obetald", organisationName: "Syntetiska OK", revision: 1, status: "OK", reason: "COMPLETE",
    elapsedMs: 240_000, splits: [], missingControls: [], extraPunches: [], rankingState: "RANKED",
    position: 3, timeBehindMs: 10_000 },
  { publicResultId: "80000000-0000-4000-8000-000000000004", className: "D21", givenName: "Åsa",
    familyName: "Omarkerad", organisationName: "Syntetiska OK", revision: 1, status: "MP",
    reason: "MISSING_CONTROL", elapsedMs: 300_000, splits: [], missingControls: [32], extraPunches: [],
    rankingState: "NOT_RANKABLE_STATUS" }
] });

test("TASK167/183/184/185 upplägg, tät deltagarvy, speaker och betalningsuppföljning", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  let currentRoster: EntryTransferCandidates = roster;
  let releaseCorrection: (() => void) | undefined;
  let speakerReads = 0;
  let publicResultReads = 0;
  let courseUnavailable = false;
  let readoutUnavailable = false;
  let readoutCount = 1;
  await page.route("**/api/**", async route => {
    const path = new URL(route.request().url()).pathname;
    if (path === `/api/public/races/${raceId}/results`) {
      publicResultReads++;
      return route.fulfill({ status: 200, json: publicLeaders });
    }
    if (path === `/api/admin/races/${raceId}/administrator/session`) {
      return route.request().method() === "POST"
        ? route.fulfill({ status: 200, json: { formatVersion: 1, raceId, capability: "MANAGE_RACE",
          expiresAt: new Date(Date.now() + 60 * 60 * 1_000).toISOString() } })
        : route.fulfill({ status: 401, json: { error: "UNAUTHORIZED" } });
    }
    if (path === `/api/admin/races/${raceId}/administrator/transfer-candidates`) {
      return route.fulfill({ status: 200, json: currentRoster });
    }
    if (path.endsWith("/effective-result")) {
      const participant = currentRoster.entries.find(row => path.includes(row.id))!;
      const effective = participant.effectiveResult;
      const common = { formatVersion: 1, raceId, entryId: participant.id, entryVersion: participant.version,
        currentClassId: participant.classId, snapshotVersion: currentRoster.snapshotVersion,
        generatedAt: currentRoster.generatedAt, timeZone: currentRoster.timeZone };
      if (effective.state !== "ACTIVE_RESULT") return route.fulfill({ status: 200,
        json: administratorEffectiveResultResponseSchema.parse({ ...common, ...effective }) });
      return route.fulfill({ status: 200, json: administratorEffectiveResultResponseSchema.parse({
        ...common, ...effective,
        resultClass: { id: participant.classId, name: participant.classId === classId ? "Öppen 5" : "D21" },
        governingDecision: "NONE",
        controlDetails: effective.result.status === "MP" ? { courseName: "Långbanan", courseVersionId,
          startTime: "2026-09-23T08:00:00.000Z", finishTime: "2026-09-23T08:05:00.000Z",
          controls: [
            { sequence: 1, controlCode: 31, occurrence: 1, elapsedMs: 60_000, legMs: 60_000 },
            { sequence: 2, controlCode: 32, occurrence: 1, elapsedMs: null, legMs: null },
            { sequence: 3, controlCode: 33, occurrence: 1, elapsedMs: 180_000, legMs: 120_000 }
          ], missingControls: [32], extraPunches: [] } : null
      }) });
    }
    if (path.endsWith("/course-control-geometries")) return courseUnavailable
      ? route.fulfill({ status: 503, json: { error: "UNAVAILABLE" } }) : route.fulfill({ status: 200,
      json: adminCourseControlGeometryStateResponseSchema.parse({ formatVersion: 1, raceId, geometries: [],
        courses: [{ courseVersionId, courseName: "Långbanan", version: 1, controls: [31, 32, 33].map((controlCode, index) => ({
          courseControlId: `60000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`, sequence: index + 1, controlCode
        })) }] }) });
    if (path.endsWith("/administrator/speaker-board")) {
      speakerReads++;
      return route.fulfill({ status: 200, json: speakerBoardResponseSchema.parse({ formatVersion: 1, raceId,
        eventName: roster.eventName, raceName: roster.raceName, raceSnapshotVersion: roster.snapshotVersion,
        generatedAt: roster.generatedAt, timeZone: roster.timeZone, selection: "LATEST_PUBLISHED_HEADS_BY_REGISTRATION",
        rows: [{ slot: 1, givenName: "Bo", familyName: "Obetald", organisationName: "Syntetiska OK", className: "Öppen 5",
          selectedRevision: 1, registeredAt: roster.generatedAt, state: "ACTIVE_RESULT",
          result: { revision: 1, status: "OK", reason: "COMPLETE", elapsedMs: 240_000 } },
        { slot: 2, givenName: "Åsa", familyName: "Omarkerad", organisationName: "Syntetiska OK", className: "Öppen 5",
          selectedRevision: 1, registeredAt: roster.generatedAt, state: "ACTIVE_RESULT",
          result: { revision: 1, status: "MP", reason: "MISSING_CONTROL", elapsedMs: 300_000 } }] }) });
    }
    if (path.endsWith("/administrator/forest-watch")) return route.fulfill({ status: 200,
      json: administratorForestWatchResponseSchema.parse({ formatVersion: 1, raceId, snapshotVersion: roster.snapshotVersion,
        generatedAt: roster.generatedAt, timeZone: roster.timeZone, knowledge: "LAST_SYNCED_ONLY", devices: [],
        entries: currentRoster.entries.map((row, index) => ({ entryId: row.id, entryVersion: row.version,
          classId: row.classId, className: row.classId === classId ? "Öppen 5" : "D21", displayName: row.displayName,
          organisationName: row.organisationName, startRule: row.classId === classId ? "PUNCH" : "FIXED",
          fixedStartTime: null, cardNumber: null, multipleActiveAssignments: false, revision: index === 1 ? 1 : 0,
          startState: index === 1 ? "STARTED" : "UNMARKED", manualReturnRegistered: false, readoutReturnRegistered: false,
          activeDns: false, conflictingReports: index === 0,
          forestState: index === 0 ? "CONFLICT" : index === 1 ? "STARTED_NO_RETURN" : "UNCONFIRMED",
          needsFollowUp: true })),
        reportedStarts: currentRoster.entries.map((row, index) => ({ entryId: row.id,
          observedAt: index === 1 ? "2026-09-23T09:00:00.000Z" : null })) }) });
    if (path.endsWith("/administrator/unknown-readout-resolution")) return readoutUnavailable
      ? route.fulfill({ status: 503, json: { error: "UNAVAILABLE" } })
      : route.fulfill({ status: 200, json: unknownReadoutResolutionCandidateResponseSchema.parse({ formatVersion: 1, raceId,
        snapshotVersion: roster.snapshotVersion, engineVersion: "synthetic", classes: [], entries: [],
        readouts: [{ id: "90000000-0000-4000-8000-000000000001", cardNumber: "1234567",
          readAt: "2026-09-23T10:01:00.000Z", finishPunchedAt: "2026-09-23T09:59:00.000Z" }].slice(0, readoutCount) }) });
    if (path.endsWith("/finish-time-correction")) {
      await new Promise<void>(resolve => { releaseCorrection = resolve; });
      return route.fulfill({ status: 503, json: { error: "UNAVAILABLE" } });
    }
    return route.abort();
  });
  await page.goto(`/admin/${raceId}/manage`);
  await expect(page.locator("body > header")).toBeVisible();
  const genericHeading = page.locator("main.race-admin-manage-page > h1");
  await expect(genericHeading).toBeVisible();
  await expect(page.getByRole("status")).toHaveText("Behörighet saknas eller har gått ut. Logga in igen.");
  await page.getByLabel("Administratörsbehörighet", { exact: true })
    .fill(`otid_org_race_admin_v1.${raceId}.${"a".repeat(43)}`);
  await page.getByRole("button", { name: "Logga in", exact: true }).click();
  await expect(page.locator("body > header")).toBeHidden();
  expect((await genericHeading.boundingBox())?.width).toBe(1);
  const backToEvents = page.getByRole("link", { name: "Mina tävlingar", exact: true });
  await expect(backToEvents).toHaveAttribute("href", "/organizer");
  expect((await backToEvents.boundingBox())?.height).toBeGreaterThanOrEqual(44);

  const modes = page.getByRole("navigation", { name: "Arbetslägen" });
  const overview = page.getByRole("region", { name: "Tävlingsbild", exact: true });
  const raceHeading = page.getByRole("heading", { name: "Syntetisk tävling", exact: true });
  const competitionStatus = page.getByRole("region", { name: "Tävlingsstatus", exact: true });
  const mobileHeadingBox = await raceHeading.boundingBox();
  const mobileStatusBox = await competitionStatus.boundingBox();
  expect(mobileHeadingBox && mobileStatusBox && mobileStatusBox.y > mobileHeadingBox.y).toBe(true);
  await expect(competitionStatus.locator("dl > div")).toHaveCount(6);
  await expect(competitionStatus).toContainText("Underlag version 2");
  const modeButtons = modes.getByRole("button");
  await expect(modeButtons).toHaveCount(5);
  for (const modeButton of await modeButtons.all()) {
    expect((await modeButton.boundingBox())?.height).toBeGreaterThanOrEqual(44);
  }
  const modeBoxes = await Promise.all((await modeButtons.all()).map(button => button.boundingBox()));
  expect(modeBoxes[0] && modeBoxes[1] && modeBoxes[2] && modeBoxes[3] && modeBoxes[4] &&
    Math.abs(modeBoxes[0].y - modeBoxes[2].y) < 2 && Math.abs(modeBoxes[3].y - modeBoxes[4].y) < 2 &&
    modeBoxes[3].y > modeBoxes[0].y).toBe(true);
  await expect(modes.getByRole("button", { name: "Översikt", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(overview).toBeVisible();
  await expect(page.locator("body")).toHaveCSS("background-color", "rgb(247, 248, 248)");
  const classTable = overview.getByRole("table");
  await expect(classTable.getByRole("row", { name: /Öppen 5/ })).toContainText("Fri start");
  await expect(classTable.getByRole("row", { name: /Öppen 5/ }).getByRole("button")).toHaveCount(1);
  await expect(classTable.getByRole("row", { name: /Öppen 5/ })
    .getByRole("button", { name: "Öppen 5 – öppna klassupplägg" })).toBeVisible();
  await expect(classTable.getByRole("row", { name: /D21/ })).toContainText("1 / 40");
  await expect(overview.locator("dl > div").filter({ hasText: "Minutstart utan fast tid" }).locator("dd")).toHaveText("1");
  await expect(page.getByText("Rätta observerad måltid", { exact: true })).toBeHidden();
  await expect(page.getByRole("link", { name: "Kartsläpp", exact: true })).toBeHidden();
  const overviewAreas = overview.locator('[aria-label="Arbetsområden"] > section');
  await expect(overviewAreas).toHaveCount(4);
  for (const area of await overviewAreas.all()) {
    const button = area.getByRole("button");
    await expect(button).toBeVisible();
    expect((await button.boundingBox())?.height).toBeGreaterThanOrEqual(44);
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: test.info().outputPath("overview-mobile.png"), fullPage: true });
  const mobileClassLink = classTable.getByRole("button", { name: "Öppen 5 – öppna klassupplägg" });
  expect((await mobileClassLink.boundingBox())?.height).toBeGreaterThanOrEqual(44);
  await mobileClassLink.click();
  await expect(page.locator("summary").filter({ hasText: "Deltagargränser per klass · Öppen 5" })).toBeVisible();
  await page.screenshot({ path: test.info().outputPath("class-context-mobile.png"), fullPage: true });
  await modes.getByRole("button", { name: "Översikt", exact: true }).click();
  await classTable.getByRole("button", { name: "Visa 1 deltagare i D21 utan fast starttid" }).click();
  const missingTimeList = page.locator('[data-panel="LIST"]');
  await expect(missingTimeList.getByText("Endast minutstart utan fast tid", { exact: true })).toBeVisible();
  await expect(missingTimeList.getByLabel("Filtrera klass")).toHaveValue(fixedClassId);
  await expect(missingTimeList.locator("tbody tr")).toHaveCount(1);
  await expect(missingTimeList.getByRole("row", { name: /Cecilia Betald/ })).toContainText("Ingen fast starttid");
  const setCeciliaStart = missingTimeList.getByRole("button", { name: "Sätt starttid för Cecilia Betald" });
  expect((await setCeciliaStart.boundingBox())?.height).toBeGreaterThanOrEqual(44);
  let startTimeWrites = 0;
  page.on("request", request => {
    if (request.method() === "PATCH" && new URL(request.url()).pathname.endsWith("/start-time")) startTimeWrites++;
  });
  await page.screenshot({ path: test.info().outputPath("missing-fixed-start-mobile.png"), fullPage: true });
  await setCeciliaStart.click();
  const startWork = page.locator('[data-panel="WORK"]');
  await expect(startWork.getByRole("region", { name: "Rätta starttid" })).toBeVisible();
  await expect(startWork).toContainText("Cecilia Betald");
  await expect(startWork.getByRole("button", { name: "Ändra starttid" })).toHaveAttribute("aria-pressed", "true");
  expect(startTimeWrites).toBe(0);
  await page.getByRole("button", { name: "Deltagarlista", exact: true }).click();
  await missingTimeList.getByRole("button", { name: "Visa alla starttider" }).click();
  await expect(missingTimeList.getByText("Endast minutstart utan fast tid", { exact: true })).toHaveCount(0);
  await missingTimeList.getByLabel("Filtrera klass").selectOption("");
  await expect(missingTimeList.locator("tbody tr")).toHaveCount(6);
  await expect(missingTimeList.getByRole("row", { name: /Åsa Omarkerad/ }).getByRole("button", { name: /Sätt starttid/ })).toHaveCount(0);
  await expect(missingTimeList.getByRole("row", { name: /Åsa Omarkerad/ })).toContainText("Felstämplad");
  await expect(missingTimeList.getByRole("row", { name: /Åsa Omarkerad/ }).locator("td").nth(2).locator("strong").first())
    .toHaveCSS("color", "rgb(164, 45, 41)");
  await expect(missingTimeList.getByRole("row", { name: /Åsa Omarkerad/ })).toContainText("5:00");
  await expect(missingTimeList.getByRole("row", { name: /Åsa Omarkerad/ })).toContainText("Äldre resultat");
  await expect(missingTimeList.getByRole("row", { name: /Bo Obetald/ })).toContainText("Godkänd");
  await expect(missingTimeList.getByRole("row", { name: /Cecilia Betald/ })).toContainText("Inget aktivt resultat");
  await expect(missingTimeList.getByRole("row", { name: /David Deltagare/ })).toContainText("Inget publicerat");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: test.info().outputPath("roster-results-mobile.png"), fullPage: true });
  const resultStateFilter = missingTimeList.getByRole("combobox", { name: "Resultatläge" });
  await resultStateFilter.selectOption("MP");
  await expect(missingTimeList.locator("tbody tr")).toHaveCount(1);
  await expect(missingTimeList.locator("tbody tr")).toContainText("Åsa Omarkerad");
  await missingTimeList.getByRole("checkbox", { name: "Visa endast äldre resultat (1)" }).check();
  await expect(missingTimeList.locator("tbody tr")).toHaveCount(1);
  await resultStateFilter.selectOption("OK");
  await expect(missingTimeList.locator("tbody tr")).toHaveCount(0);
  await missingTimeList.getByRole("checkbox", { name: "Visa endast äldre resultat (1)" }).uncheck();
  await expect(missingTimeList.locator("tbody tr")).toContainText("Bo Obetald");
  await resultStateFilter.selectOption("NO_ACTIVE_RESULT");
  await missingTimeList.getByLabel("Filtrera klass").selectOption(fixedClassId);
  await expect(missingTimeList.locator("tbody tr")).toContainText("Cecilia Betald");
  await resultStateFilter.selectOption("NO_PUBLISHED_RESULT");
  await expect(missingTimeList.locator("tbody tr")).toHaveCount(0);
  await missingTimeList.getByLabel("Filtrera klass").selectOption("");
  await expect(missingTimeList.locator("tbody tr")).toHaveCount(3);
  await resultStateFilter.selectOption("ALL");
  await expect(missingTimeList.locator("tbody tr")).toHaveCount(6);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await modes.getByRole("button", { name: "Översikt", exact: true }).click();
  await overview.getByRole("button", { name: "Betalning att följa upp 2" }).click();

  const list = page.locator('[data-panel="LIST"]');
  const mobileOptions = await Promise.all(["Filtrera klass", "Resultatläge", "Ordning", "Rader per sida"]
    .map(name => list.getByRole("combobox", { name }).boundingBox()));
  expect(mobileOptions.every(box => box !== null && box.height >= 44)).toBe(true);
  expect(Math.round(mobileOptions[0]!.y)).toBe(Math.round(mobileOptions[1]!.y));
  expect(Math.round(mobileOptions[2]!.y)).toBe(Math.round(mobileOptions[3]!.y));
  expect(mobileOptions[2]!.y).toBeGreaterThan(mobileOptions[0]!.y);
  const mobileOlderFilter = list.getByRole("checkbox", { name: "Visa endast äldre resultat (1)" }).locator("..");
  await expect(mobileOlderFilter.getByText("Visa endast äldre resultat (1)", { exact: true })).toBeVisible();
  expect((await list.getByRole("checkbox").locator("..").evaluateAll(labels =>
    labels.map(label => label.getBoundingClientRect().height))).every(height => height >= 44)).toBe(true);
  await page.screenshot({ path: test.info().outputPath("filters-mobile.png"), fullPage: true });
  const reviewFilter = list.getByRole("checkbox", { name: "Visa betalning att kontrollera (2)" });
  await expect(reviewFilter).toBeChecked();
  await expect(list.locator("tbody tr")).toHaveCount(2);
  await reviewFilter.uncheck();
  await expect(list.locator("tbody tr")).toHaveCount(6);
  await reviewFilter.check();
  await expect(list.locator("tbody tr")).toHaveCount(2);
  await expect(list.getByText("Cecilia Betald", { exact: true })).toHaveCount(0);
  await list.getByRole("button", { name: "Åsa Omarkerad Syntetiska OK" }).click();
  const work = page.locator('[data-panel="WORK"]');
  await expect(work.getByRole("heading", { name: "Betalstatus", exact: true })).toBeVisible();
  await expect(work.getByText("Aktuell betalstatus: Inte markerad", { exact: false })).toBeVisible();

  await page.getByRole("button", { name: "Deltagarlista", exact: true }).click();
  await reviewFilter.uncheck();
  await expect(list.locator("tbody tr")).toHaveCount(6);
  const mobilePrimaryControls = page.getByRole("navigation", { name: "Växla mobilvy", exact: true }).getByRole("button");
  await expect(mobilePrimaryControls).toHaveCount(2);
  expect((await mobilePrimaryControls.evaluateAll(elements => elements.map(element =>
    element.getBoundingClientRect().height))).every(height => height >= 44)).toBe(true);

  currentRoster = entryTransferCandidatesSchema.parse({ ...roster,
    entries: roster.entries.map(row => ({ ...row, paymentStatus: "PAID" })) });
  await reviewFilter.check();
  await list.getByRole("button", { name: "Uppdatera deltagare", exact: true }).click();
  await expect(list.getByRole("checkbox", { name: "Visa betalning att kontrollera (0)" })).toBeChecked();
  await expect(list.locator("tbody tr")).toHaveCount(0);
  await expect(list.getByText("Inga anmälningar har omarkerad eller obetald betalstatus.")).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

  await list.getByRole("checkbox", { name: "Visa betalning att kontrollera (0)" }).uncheck();
  const search = list.getByRole("searchbox", { name: "Sök namn, klubb, klass eller bricka" });
  await search.fill("Åsa");
  await expect(list.locator("tbody tr")).toHaveCount(1);
  await list.getByRole("button", { name: "Åsa Omarkerad Syntetiska OK" }).click();
  await modes.getByRole("button", { name: "Före tävlingen" }).click();
  const before = page.getByRole("navigation", { name: "Tävlingsförberedelser" });
  await before.getByRole("button", { name: "Upplägg", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Tävlingsupplägg", exact: true })).toBeVisible();
  const preparationNames = ["Upplägg", "Banor", "Klasser", "Deltagare", "Lottning & starttider", "Startlista", "Funktionärer"];
  const preparationButtons = before.getByRole("button");
  await expect(preparationButtons).toHaveCount(7);
  for (const name of preparationNames) {
    const button = before.getByRole("button", { name, exact: true });
    await expect(button).toBeVisible();
    expect((await button.boundingBox())?.height).toBeGreaterThanOrEqual(44);
  }
  expect(await preparationButtons.evaluateAll(buttons => buttons.map(button => button.getAttribute("aria-label"))))
    .toEqual(preparationNames);
  const preparationBoxes = await Promise.all((await preparationButtons.all()).map(button => button.boundingBox()));
  expect(preparationBoxes.slice(0, 4).every(box => box && preparationBoxes[0] && Math.abs(box.y - preparationBoxes[0].y) < 2)).toBe(true);
  expect(preparationBoxes.slice(4).every(box => box && preparationBoxes[4] && Math.abs(box.y - preparationBoxes[4].y) < 2)).toBe(true);
  expect(preparationBoxes[4] && preparationBoxes[0] && preparationBoxes[4].y > preparationBoxes[0].y).toBe(true);
  expect((await page.getByRole("heading", { name: "Tävlingsupplägg", exact: true }).boundingBox())?.y).toBeLessThan(550);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: test.info().outputPath("preparation-nav-mobile.png"), fullPage: true });
  for (const name of preparationNames.slice(1)) {
    const button = before.getByRole("button", { name, exact: true });
    await button.click();
    await expect(button).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator(`section[aria-label="${name}"]:visible`).first()).toBeVisible();
  }
  await before.getByRole("button", { name: "Upplägg", exact: true }).click();
  await page.setViewportSize({ width: 320, height: 720 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  expect((await preparationButtons.evaluateAll(buttons => buttons.map(button => button.getBoundingClientRect().height)))
    .every(height => height >= 44)).toBe(true);
  await page.setViewportSize({ width: 390, height: 844 });
  const preparationGuide = page.locator('section[aria-labelledby="race-preparation-title"]');
  await expect(preparationGuide.getByRole("button")).toHaveCount(0);
  await expect(preparationGuide.locator("ol > li")).toHaveCount(6);
  expect(await preparationGuide.evaluate(panel => Array.from(panel.children).map(child =>
    child.getAttribute("aria-labelledby") ?? child.tagName.toLowerCase())))
    .toEqual(["header", "race-preparation-classes", "race-preparation-steps"]);
  await before.getByRole("button", { name: "Klasser", exact: true }).click();
  const classOverview = page.getByRole("region", { name: "Klasser", exact: true });
  await expect(classOverview).toContainText("1 utan fast starttid");
  await expect(classOverview.getByRole("row", { name: /D21/ })).toContainText("1 saknar tid");
  await expect(classOverview.getByRole("row", { name: /D21/ })).toContainText("Långbanan · version 1");
  await expect(classOverview.getByRole("row", { name: /Öppen 5/ })).toContainText("Ej aktuellt");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await before.getByRole("button", { name: "Banor", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Långbanan", exact: true })).toBeVisible();
  const courseRow = page.locator('section[aria-labelledby="race-course-overview-title"] > ul > li').first();
  await expect(courseRow.locator("summary")).toBeVisible();
  await expect(courseRow.locator("details")).not.toHaveAttribute("open", "");
  await expect(page.getByText("Förbered bana och klass", { exact: true })).toBeVisible();
  const courseSetup = page.locator("details").filter({ has: page.getByText("Förbered bana och klass", { exact: true }) });
  await courseSetup.locator("summary").click();
  await courseSetup.getByLabel("Bannamn").fill("Provbana");
  await courseSetup.getByLabel("Klassnamn").fill("Provklass");
  await courseSetup.getByLabel("Kontrollföljd").fill("31, 32");
  await courseSetup.getByRole("button", { name: "Granska bana och klass" }).click();
  await expect(modes.getByRole("button", { name: "Under tävlingen" })).toBeDisabled();
  await expect(work.locator('nav[aria-label="Deltagare i aktuellt urval"] button').first()).toBeDisabled();
  await expect(work.locator('nav[aria-label="Deltagare i aktuellt urval"] button').last()).toBeDisabled();
  await expect(backToEvents).toHaveCount(0);
  await expect(page.getByText("Mina tävlingar", { exact: true })).toHaveAttribute("aria-disabled", "true");
  await courseSetup.getByRole("button", { name: "Ändra uppgifter" }).click();
  await expect(backToEvents).toBeVisible();
  await before.getByRole("button", { name: "Startlista", exact: true }).click();
  const preparationList = page.getByRole("region", { name: "Aktuellt startunderlag", exact: true });
  await expect(preparationList).toBeVisible();
  await expect(preparationList).toContainText("Arbetslista för administratörer – inte den publicerade startlistan");
  await expect(preparationList.locator("tbody tr")).toHaveCount(6);
  await expect(preparationList.getByRole("row", { name: /Cecilia Betald/ })).toContainText("Saknar fast starttid");
  await expect(preparationList.getByRole("row", { name: /Åsa Omarkerad/ })).toContainText("Fri start");
  const startSearch = preparationList.getByRole("searchbox", { name: "Sök namn, klubb, klass eller bricka" });
  await startSearch.fill("Åsa");
  await expect(preparationList.locator("tbody tr")).toHaveCount(1);
  await preparationList.getByRole("combobox", { name: "Klass" }).selectOption(fixedClassId);
  await expect(preparationList).toContainText("Inga deltagare matchar urvalet.");
  await preparationList.getByRole("combobox", { name: "Klass" }).selectOption("");
  await preparationList.getByRole("button", { name: "Öppna Åsa Omarkerad i deltagarvyn" }).click();
  await expect(work.getByRole("region", { name: "Deltagaruppgifter", exact: true })).toContainText("Åsa Omarkerad");
  await before.getByRole("button", { name: "Startlista", exact: true }).click();
  await expect(page.locator("summary").filter({ hasText: "Publicera startlista" })).toBeVisible();
  await modes.getByRole("button", { name: "Under tävlingen" }).click();
  const during = page.getByRole("navigation", { name: "Tävlingsdagens arbetsytor" });
  await expect(during.getByRole("button")).toHaveCount(4);
  for (const subButton of await during.getByRole("button").all()) {
    expect((await subButton.boundingBox())?.height).toBeGreaterThanOrEqual(44);
  }
  const duringBoxes = await Promise.all((await during.getByRole("button").all()).map(button => button.boundingBox()));
  expect(duringBoxes.every(box => box && duringBoxes[0] && Math.abs(box.y - duringBoxes[0].y) < 2)).toBe(true);
  const attention = page.getByRole("region", { name: "Avvikelser att följa upp" });
  await expect(attention).toBeVisible();
  await expect(attention).toContainText("Tävlingsversion 2 · serverunderlag 2026-09-23 12:00:00 GMT+02:00");
  await expect(attention).toContainText("Tävlingsversion 2 · hämtad lokalt kl.");
  const attentionRow = (label: string) => attention.locator("li").filter({ hasText: label });
  await expect(attentionRow("Motstridiga uppgifter").locator("strong")).toHaveText("1");
  await expect(attentionRow("Startade utan registrerad återkomst").locator("strong")).toHaveText("1");
  await expect(attentionRow("Okänd startstatus").locator("strong")).toHaveText("4");
  await expect(attentionRow("Olösta okända avläsningar").locator("strong")).toHaveText("1");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: test.info().outputPath("race-day-attention-mobile.png"), fullPage: true });
  for (const button of await attention.getByRole("button").all()) {
    expect((await button.boundingBox())?.height).toBeGreaterThanOrEqual(44);
  }
  await page.setViewportSize({ width: 1280, height: 800 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: test.info().outputPath("race-day-attention-desktop.png"), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  readoutUnavailable = true;
  await attention.getByRole("button", { name: "Uppdatera avvikelser" }).click();
  await expect(attentionRow("Olösta okända avläsningar").locator("strong")).toHaveText("Okänt – uppdatera");
  await expect(attention).toContainText("Avläsningsunderlaget är gammalt, misslyckat eller inte hämtat");
  readoutUnavailable = false;
  readoutCount = 0;
  await attention.getByRole("button", { name: "Uppdatera avvikelser" }).click();
  await expect(attentionRow("Olösta okända avläsningar").locator("strong")).toHaveText("0");
  readoutCount = 1;
  await attention.getByRole("button", { name: "Uppdatera avvikelser" }).click();
  await expect(attentionRow("Olösta okända avläsningar").locator("strong")).toHaveText("1");
  await attentionRow("Motstridiga uppgifter").getByRole("button", { name: "Öppna" }).click();
  const forestPanel = page.locator(`#forest-watch-${raceId}`);
  await expect(forestPanel.locator('[data-forest-group="CONFLICT"]')).toBeVisible();
  await forestPanel.getByRole("searchbox", { name: "Sök namn, klubb eller bricknummer" }).fill("saknas");
  await attentionRow("Startade utan registrerad återkomst").getByRole("button", { name: "Öppna" }).click();
  await expect(forestPanel.getByRole("searchbox", { name: "Sök namn, klubb eller bricknummer" })).toHaveValue("");
  await expect(forestPanel.locator('[data-forest-group="STARTED_NO_RETURN"]')).toContainText("Bo Obetald");
  await expect(page.locator("summary").filter({ hasText: "Kvar i skogen – målpersonal" })).toBeVisible();
  await expect(page.locator("summary").filter({ hasText: "Publicera startlista" })).toBeHidden();
  await during.getByRole("button", { name: "Speaker", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Speaker", exact: true })).toBeVisible();
  expect((await page.getByRole("heading", { name: "Speaker", exact: true }).boundingBox())?.y).toBeLessThan(540);
  await expect(page.getByRole("heading", { name: "Bo Obetald", exact: true })).toBeVisible();
  await expect(page.getByText("Felstämplad (MP)", { exact: true }).last()).toHaveCSS("color", "rgb(164, 45, 41)");
  const classLeaders = page.getByRole("region", { name: "Publika klassledare" });
  expect((await classLeaders.boundingBox())?.y).toBeLessThan(830);
  expect(publicResultReads).toBe(0);
  await classLeaders.getByRole("button", { name: "Visa klassledare" }).click();
  await expect(classLeaders).toContainText("Klara Ledare");
  await expect(classLeaders).toContainText("Linn Delad");
  await expect(classLeaders).not.toContainText("Bo Obetald");
  await expect(classLeaders).not.toContainText("Åsa Omarkerad");
  await expect(classLeaders.locator("ul li")).toHaveCount(2);
  await expect(classLeaders.locator("ul li").first().getByText("Ledare", { exact: true }))
    .toHaveCSS("color", "rgb(39, 103, 73)");
  await expect(classLeaders.locator("ul li").first().getByText("3:50", { exact: true }))
    .toHaveCSS("color", "rgb(39, 103, 73)");
  const leadersBox = await classLeaders.boundingBox();
  const firstFeedBox = await page.getByRole("heading", { name: "Bo Obetald", exact: true }).boundingBox();
  expect(leadersBox && firstFeedBox && leadersBox.y < firstFeedBox.y).toBe(true);
  expect(publicResultReads).toBe(1);
  await expect(classLeaders.getByRole("button", { name: "Uppdatera klassledare" })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: test.info().outputPath("speaker-mobile.png"), fullPage: true });
  await page.setViewportSize({ width: 1280, height: 800 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: test.info().outputPath("speaker-desktop.png"), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(speakerReads).toBeGreaterThan(0);
  await during.getByRole("button", { name: "Alla deltagare", exact: true }).click();
  const readsAfterLeavingSpeaker = speakerReads;
  await expect(during.getByRole("button", { name: "Alla deltagare", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(work.getByRole("heading", { name: "Deltagaruppgifter", exact: true })).toBeVisible();
  const participantFacts = work.locator('section[aria-labelledby="race-participant-facts-title"]');
  expect(await participantFacts.evaluate(element => getComputedStyle(element).borderTopWidth)).toBe("1px");
  const controls = work.getByRole("region", { name: "Kontroller och sträcktider", exact: true }).first();
  expect(await controls.evaluate(element => getComputedStyle(element).borderLeftWidth)).toBe("1px");
  await expect(controls.getByRole("row", { name: /1 31/ })).toContainText("1:00,000");
  await expect(controls.getByRole("row", { name: /2 32/ })).toContainText("Ingen mellantid");
  await expect(controls.getByRole("row", { name: /3 33/ })).toContainText("3:00,000");
  await page.screenshot({ path: test.info().outputPath("person-mobile.png"), fullPage: true });
  await during.getByRole("button", { name: "Tid- & kontrollrättning", exact: true }).click();
  const correction = page.locator("details").filter({ has: page.getByText("Rätta observerad måltid", { exact: true }) });
  await correction.locator("summary").click();
  await correction.getByRole("combobox", { name: "Deltagare", exact: true }).selectOption(roster.entries[0]!.id);
  await correction.getByRole("button", { name: "Hämta resultatuppgift", exact: true }).click();
  await expect(modes.getByRole("button", { name: "Översikt", exact: true })).toBeDisabled();
  await correction.locator("summary").click();
  await expect(correction).toHaveAttribute("open", "");
  await expect.poll(() => !!releaseCorrection).toBe(true);
  releaseCorrection!();
  await expect(correction.getByText("Resultatuppgiften kunde inte läsas. Ingen ändring har gjorts.")).toBeVisible();
  await expect(modes.getByRole("button", { name: "Översikt", exact: true })).toBeEnabled();
  await modes.getByRole("button", { name: "Efter tävlingen" }).click();
  await expect(page.getByText("Resultatexport · IOF 3.0", { exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "Kartsläpp", exact: true })).toBeVisible();
  await expect(correction).toBeHidden();
  await modes.getByRole("button", { name: "Deltagare", exact: true }).click();
  await page.getByRole("button", { name: "Deltagarlista", exact: true }).click();
  await expect(search).toHaveValue("Åsa");
  await expect(list.locator("tbody tr")).toHaveCount(1);
  await expect(list.locator("tbody tr button")).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "Arbetsvy", exact: true }).click();
  await expect(work.getByRole("heading", { name: "Deltagaruppgifter", exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

  await page.setViewportSize({ width: 900, height: 800 });
  await expect(page.locator("body > header")).toBeHidden();
  const tabletHeadingBox = await raceHeading.boundingBox();
  const tabletStatusBox = await competitionStatus.boundingBox();
  expect(tabletHeadingBox && tabletStatusBox && tabletStatusBox.y > tabletHeadingBox.y).toBe(true);
  await expect(list).toBeVisible();
  await expect(work).toBeVisible();
  const tabletToolbar = list.getByRole("heading", { name: "Deltagare", exact: true }).locator("..");
  const toolbarButtons = tabletToolbar.getByRole("button");
  await expect(toolbarButtons).toHaveCount(3);
  const toolbarBoxes = await Promise.all((await toolbarButtons.all()).map(button => button.boundingBox()));
  expect(toolbarBoxes.every(box => box !== null)).toBe(true);
  expect(new Set(toolbarBoxes.map(box => Math.round(box!.y))).size).toBe(1);
  for (let index = 1; index < toolbarBoxes.length; index += 1) {
    expect(toolbarBoxes[index - 1]!.x + toolbarBoxes[index - 1]!.width).toBeLessThan(toolbarBoxes[index]!.x);
  }
  await expect(toolbarButtons.nth(1)).toHaveText("Bred tabell");
  const tabletStatus = page.getByRole("region", { name: "Tävlingsstatus", exact: true });
  const tabletStatusGeometry = await tabletStatus.evaluate(section => ({
    height: section.getBoundingClientRect().height,
    metricTops: Array.from(section.querySelectorAll("dl > div")).map(row => Math.round(row.getBoundingClientRect().top)),
    basisHeight: section.querySelector("p")!.getBoundingClientRect().height,
  }));
  await expect(tabletStatus.locator("dl > div")).toHaveCount(6);
  for (const metric of await tabletStatus.locator("dl > div").all()) await expect(metric).toBeVisible();
  expect(new Set(tabletStatusGeometry.metricTops).size).toBe(1);
  expect(tabletStatusGeometry.height).toBeLessThan(50);
  expect(tabletStatusGeometry.basisHeight).toBeLessThan(20);
  await expect(tabletStatus).toContainText("Underlag version 2");
  await expect(tabletStatus).toContainText("läst 2026-09-23 12:00:00 GMT+02:00");
  const tabletOlderFilter = list.getByRole("checkbox", { name: "Visa endast äldre resultat (1)" }).locator("..");
  const tabletRentalFilter = list.getByRole("checkbox", { name: "Visa endast ej återlämnade hyrbrickor (0)" }).locator("..");
  const tabletPaymentFilter = list.getByRole("checkbox", { name: "Visa betalning att kontrollera (0)" }).locator("..");
  await expect(tabletOlderFilter.getByText("Endast äldre resultat (1)", { exact: true })).toBeVisible();
  await expect(tabletRentalFilter.getByText("Ej återlämnade hyrbrickor (0)", { exact: true })).toBeVisible();
  await expect(tabletPaymentFilter.getByText("Betalning att kontrollera (0)", { exact: true })).toBeVisible();
  const tabletFilterBoxes = await Promise.all([tabletOlderFilter, tabletRentalFilter, tabletPaymentFilter]
    .map(label => label.boundingBox()));
  expect(tabletFilterBoxes.every(box => box !== null)).toBe(true);
  expect(Math.round(tabletFilterBoxes[0]!.y)).toBe(Math.round(tabletFilterBoxes[1]!.y));
  expect(new Set(tabletFilterBoxes.map(box => Math.round(box!.y))).size).toBe(2);
  const tabletPersonRow = list.locator("tbody tr").first();
  await expect(tabletPersonRow.getByRole("button", { name: "Åsa Omarkerad Syntetiska OK" })).toBeVisible();
  await expect(tabletPersonRow).toContainText("Syntetiska OKBetalning · Betald");
  await expect(tabletPersonRow).toContainText("Felstämplad");
  await expect(tabletPersonRow).toContainText("Äldre resultat");
  expect(await tabletPersonRow.evaluate(row => row.getBoundingClientRect().height)).toBeLessThan(78);
  await page.screenshot({ path: test.info().outputPath("participants-tablet.png"), fullPage: true });
  expect(await participantFacts.evaluate(element => getComputedStyle(element).borderTopWidth)).toBe("0px");
  expect(await controls.evaluate(element => getComputedStyle(element).borderLeftWidth)).toBe("0px");
  expect(await controls.evaluate(element => getComputedStyle(element).borderTopWidth)).toBe("1px");
  expect(await controls.evaluate(element => getComputedStyle(element).paddingLeft)).toBe("0px");
  const tabletList = await list.boundingBox(), tabletWork = await work.boundingBox();
  expect(tabletList).not.toBeNull();
  expect(tabletWork).not.toBeNull();
  expect(Math.abs((tabletList?.y ?? 0) - (tabletWork?.y ?? 0))).toBeLessThan(4);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  expect(await work.evaluate(panel => panel.scrollHeight > panel.clientHeight)).toBe(true);
  await work.press("PageDown");
  await expect.poll(() => work.evaluate(panel => panel.scrollTop)).toBeGreaterThan(0);
  expect(Math.abs((await list.boundingBox())!.y - tabletList!.y)).toBeLessThan(1);
  await work.evaluate(panel => { panel.scrollTop = 0; });
  await toolbarButtons.nth(1).click();
  await expect(work).toBeHidden();
  await expect(toolbarButtons.nth(1)).toHaveText("Delad vy");
  await toolbarButtons.nth(1).click();
  await expect(work).toBeVisible();
  await modes.getByRole("button", { name: "Översikt", exact: true }).click();
  const tabletAreaBoxes = await Promise.all((await overviewAreas.all()).map(area => area.boundingBox()));
  expect(tabletAreaBoxes.every(box => box !== null)).toBe(true);
  expect(Math.abs(tabletAreaBoxes[0]!.y - tabletAreaBoxes[1]!.y)).toBeLessThan(2);
  expect(Math.abs(tabletAreaBoxes[2]!.y - tabletAreaBoxes[3]!.y)).toBeLessThan(2);
  expect(tabletAreaBoxes[2]!.y).toBeGreaterThan(tabletAreaBoxes[0]!.y);
  expect(await overview.getByText("Senast hämtat deltagarunderlag", { exact: false })
    .evaluate(element => element.getBoundingClientRect().height)).toBeLessThan(20);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: test.info().outputPath("overview-tablet.png"), fullPage: true });
  await modes.getByRole("button", { name: "Deltagare", exact: true }).click();

  await page.setViewportSize({ width: 1280, height: 800 });
  await expect(page.locator("body > header")).toBeHidden();
  await expect.poll(async () => {
    const heading = await raceHeading.boundingBox();
    const status = await competitionStatus.boundingBox();
    return heading && status ? Math.abs(heading.y - status.y) : Number.POSITIVE_INFINITY;
  }).toBeLessThan(30);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await search.fill("");
  await list.getByLabel("Filtrera klass").selectOption(fixedClassId);
  await expect(list.locator("tbody tr")).toHaveCount(1);
  await list.getByLabel("Filtrera klass").selectOption("");
  const desktopPersonRow = list.locator("tbody tr").first();
  await expect(desktopPersonRow).toContainText("Äldre resultat");
  await expect(desktopPersonRow).toContainText("Betalning · Betald");
  expect(await desktopPersonRow.evaluate(row => row.getBoundingClientRect().height)).toBeLessThan(66);
  await page.screenshot({ path: test.info().outputPath("roster-results-desktop.png"), fullPage: true });
  await list.getByLabel("Rader per sida").selectOption("100");
  await expect(list.locator("tbody tr")).toHaveCount(6);
  await page.evaluate(() => window.scrollTo(0, 0));
  const searchBox = list.getByRole("searchbox", { name: "Sök namn, klubb, klass eller bricka", exact: true });
  const participantCoreFacts = participantFacts.locator("dl");
  expect(await participantFacts.evaluate(element => getComputedStyle(element).paddingTop)).toBe("0px");
  expect(await controls.evaluate(element => getComputedStyle(element).borderLeftWidth)).toBe("0px");
  expect(await controls.evaluate(element => getComputedStyle(element).borderTopWidth)).toBe("1px");
  expect(await controls.evaluate(element => getComputedStyle(element).paddingLeft)).toBe("0px");
  await expect(competitionStatus).toBeVisible();
  await expect(searchBox).toBeVisible();
  await expect(participantFacts).toContainText("Åsa Omarkerad");
  await expect(participantFacts).toContainText("Syntetiska OK");
  await expect(participantFacts).toContainText("Öppen 5");
  await expect(participantFacts).toContainText("Ingen aktiv bricka");
  await expect(participantFacts).toContainText("Fri start · startstämpling");
  await expect(work.getByRole("region", { name: "Gällande resultat", exact: true }))
    .toContainText("Resultatet bygger på äldre tävlingsunderlag");
  const activeEdit = work.getByRole("region", { name: "Betalstatus", exact: true });
  await expect(activeEdit).toBeVisible();
  const workOrder = await work.evaluate(panel => Array.from(panel.children).map(child =>
    child.getAttribute("aria-label") === "Vald deltagare" ? "context" :
      child.getAttribute("aria-label") === "Deltagare i aktuellt urval" ? "sequence" :
      child.getAttribute("aria-labelledby") === "race-participant-facts-title" ? "facts" :
      child.getAttribute("aria-label") === "Gällande resultat" ? "result" :
        child.getAttribute("aria-label") === "Betalstatus" ? "edit" :
          child.getAttribute("aria-labelledby") === "race-result-controls-title" ? "controls" :
            child.querySelector("summary")?.textContent?.includes("Resultatbeslut och historik") ? "decisions" :
              child.querySelector("summary")?.textContent?.includes("Kontokoppling · frivillig") ? "claim" : "other"));
  expect(workOrder).toEqual(["context", "sequence", "facts", "result", "edit", "controls", "decisions", "claim"]);
  await work.getByText("Resultatbeslut och historik", { exact: true }).click();
  await expect(work.getByRole("button", { name: "Historik", exact: true })).toBeVisible();
  await work.getByText("Resultatbeslut och historik", { exact: true }).click();
  await page.evaluate(() => window.scrollTo(0, 0));
  await work.evaluate(panel => { panel.scrollTop = 0; });
  const viewportHeight = page.viewportSize()?.height ?? 800;
  for (const locator of [competitionStatus, searchBox, participantCoreFacts, activeEdit]) {
    const box = await locator.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.y).toBeGreaterThanOrEqual(0);
    expect(box!.y + box!.height).toBeLessThanOrEqual(viewportHeight);
  }
  const completeRows = await list.locator("tbody tr").evaluateAll((rows, height) => rows.filter(row => {
    const box = row.getBoundingClientRect();
    const scrollBox = row.closest("table")?.parentElement?.getBoundingClientRect();
    return box.top >= Math.max(0, scrollBox?.top ?? 0) &&
      box.bottom <= Math.min(height, scrollBox?.bottom ?? height);
  }).length, viewportHeight);
  expect(completeRows).toBeGreaterThanOrEqual(5);
  await page.screenshot({ path: test.info().outputPath("participants-desktop.png"), fullPage: true });
  await list.getByRole("button", { name: "Bred tabell – visa deltagartabellen över hela arbetsytan", exact: true }).click();
  await expect(work).toBeHidden();
  await list.getByRole("button", { name: "Åsa Omarkerad Syntetiska OK" }).click();
  await expect(work).toBeVisible();
  await expect.poll(async () => {
    const filterBoxes = await Promise.all([
      "Visa endast äldre resultat (1)",
      "Visa endast ej återlämnade hyrbrickor (0)",
      "Visa betalning att kontrollera (0)",
    ].map(name => list.getByRole("checkbox", { name }).locator("..").boundingBox()));
    if (filterBoxes.some(box => box === null)) return Number.POSITIVE_INFINITY;
    const tops = filterBoxes.map(box => box!.y);
    return Math.max(...tops) - Math.min(...tops);
  }).toBeLessThan(4);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await modes.getByRole("button", { name: "Översikt", exact: true }).click();
  await expect(overview).toBeVisible();
  const desktopAreaBoxes = await Promise.all((await overviewAreas.all()).map(area => area.boundingBox()));
  expect(desktopAreaBoxes.every(box => box !== null)).toBe(true);
  expect(Math.max(...desktopAreaBoxes.map(box => box!.y)) - Math.min(...desktopAreaBoxes.map(box => box!.y))).toBeLessThan(2);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: test.info().outputPath("overview-desktop.png"), fullPage: true });
  await modes.getByRole("button", { name: "Före tävlingen", exact: true }).click();
  await before.getByRole("button", { name: "Upplägg", exact: true }).click();
  await page.screenshot({ path: test.info().outputPath("preparation-desktop.png"), fullPage: true });
  await before.getByRole("button", { name: "Banor", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Långbanan", exact: true })).toBeVisible();
  await expect(courseRow.locator("summary")).toBeVisible();
  await expect(courseRow.locator("details")).not.toHaveAttribute("open", "");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await before.getByRole("button", { name: "Klasser", exact: true }).click();
  await expect(classOverview.getByRole("row", { name: /D21/ })).toContainText("1 saknar tid");
  await expect(classOverview.getByRole("row", { name: /D21/ })).toContainText("Långbanan · version 1");
  await page.screenshot({ path: test.info().outputPath("classes-desktop.png"), fullPage: true });
  await modes.getByRole("button", { name: "Översikt", exact: true }).click();
  await expect(classTable.getByRole("row", { name: /D21/ })).toContainText("Långbanan · version 1");
  await classTable.getByRole("button", { name: "D21 – öppna klassupplägg" }).click();
  await expect(before.getByRole("button", { name: "Klasser", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(classOverview).toBeVisible();
  const capacitySummary = page.locator("summary").filter({ hasText: "Deltagargränser per klass · D21" });
  const startRuleSummary = page.locator("summary").filter({ hasText: "Klassens startupplägg · D21" });
  await expect(capacitySummary).toBeVisible();
  await expect(startRuleSummary).toBeVisible();
  await page.screenshot({ path: test.info().outputPath("class-context-desktop.png"), fullPage: true });
  await capacitySummary.click();
  await expect(page.getByRole("combobox", { name: "Klass för deltagargräns" })).toHaveValue(fixedClassId);
  await capacitySummary.click();
  await startRuleSummary.click();
  await expect(page.getByRole("combobox", { name: "Klass för startupplägg" })).toHaveValue(fixedClassId);
  await startRuleSummary.click();
  await classOverview.getByRole("button", { name: "1 saknar tid i D21 – visa deltagare" }).click();
  await expect(list.getByLabel("Filtrera klass")).toHaveValue(fixedClassId);
  await expect(list.locator("tbody tr")).toHaveCount(1);
  await modes.getByRole("button", { name: "Före tävlingen", exact: true }).click();
  await expect(classOverview).toBeVisible();
  currentRoster = entryTransferCandidatesSchema.parse({ ...currentRoster, classes: [
    ...currentRoster.classes.map(row => row.id === fixedClassId ? { ...row, entryCount: 2, maxEntries: 1,
      courseVersionId: "30000000-0000-4000-8000-000000000002", courseName: "Bana utan kontroller", courseVersion: 101 }
      : row),
    { id: "20000000-0000-4000-8000-000000000003", name: "Stängd provklass", courseVersionId,
      courseName: "Långbanan", courseVersion: 1,
      startRule: "PUNCH", maxEntries: 0, capacityVersion: 1, entryCount: 0 },
  ] });
  await page.getByRole("button", { name: "Uppdatera underlag" }).click();
  await expect(classOverview).toContainText("1 klass har avvikande deltagarantal");
  await expect(classOverview.getByRole("row", { name: /D21/ })).toContainText("Full");
  await expect(classOverview.getByRole("row", { name: /D21/ })).toContainText("Bana utan kontroller · version 101");
  await expect(classOverview.getByRole("row", { name: /D21/ })).toContainText("Kontrollera antal");
  await expect(classOverview.getByRole("row", { name: /D21/ }).getByRole("button")).toHaveCount(0);
  await expect(classOverview.getByRole("row", { name: /Stängd provklass/ })).toContainText("Stängd");
  courseUnavailable = true;
  await before.getByRole("button", { name: "Banor", exact: true }).click();
  await before.getByRole("button", { name: "Klasser", exact: true }).click();
  await expect(classOverview.getByRole("row", { name: /D21/ })).toContainText("Bana utan kontroller · version 101");
  await before.getByRole("button", { name: "Startlista", exact: true }).click();
  await expect(preparationList.locator("tbody tr")).toHaveCount(6);
  await startSearch.fill("Cecilia");
  await expect(preparationList.locator("tbody tr")).toHaveCount(1);
  await expect(preparationList.getByRole("row", { name: /Cecilia Betald/ })).toContainText("Saknar fast starttid");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  expect(speakerReads).toBe(readsAfterLeavingSpeaker);
  currentRoster = entryTransferCandidatesSchema.parse({ ...currentRoster, entries: currentRoster.entries.map(row =>
    row.id === roster.entries[2]!.id ? { ...row, fixedStartTime: "2026-09-23T08:00:00.000Z" } : row) });
  await page.getByRole("button", { name: "Uppdatera underlag" }).click();
  await modes.getByRole("button", { name: "Deltagare", exact: true }).click();
  await list.getByRole("button", { name: "Visa alla starttider" }).click();
  await list.getByLabel("Filtrera klass").selectOption("");
  await search.fill("");
  await list.getByRole("combobox", { name: "Ordning" }).selectOption("FIXED_START");
  await expect(list.locator("tbody tr").first()).toContainText("Cecilia Betald");
  await expect(list.locator("tbody tr").first()).toContainText("Minutstart");
  await expect(list.locator("tbody tr").first()).toContainText("2026-09-23");
  await expect(list.locator("tbody tr").first()).toContainText("10:00:00 GMT+02:00");
  await expect(list.locator("tbody tr").first().getByRole("button", { name: /Sätt starttid/ })).toHaveCount(0);
  await expect(list.getByText("Fri start och saknad fast tid sist")).toBeVisible();
  await page.screenshot({ path: test.info().outputPath("participants-start-order-desktop.png"), fullPage: true });
  await list.getByRole("combobox", { name: "Ordning" }).selectOption("NAME");
  await expect(list.locator("tbody tr").first()).toContainText("Åsa Omarkerad");
  await list.getByRole("button", { name: "Åsa Omarkerad Syntetiska OK" }).click();
  await search.fill("Cecilia");
  const selectionContext = page.getByLabel("Vald deltagare utanför synlig tabellsida");
  await expect(selectionContext).toContainText("Vald: Åsa Omarkerad · utanför aktuellt urval");
  const participantSequence = work.getByRole("navigation", { name: "Deltagare i aktuellt urval" });
  await expect(participantSequence).toContainText("Vald deltagare är utanför aktuellt urval");
  await expect(participantSequence.getByRole("button", { name: "Föregående" })).toBeDisabled();
  await expect(participantSequence.getByRole("button", { name: "Nästa" })).toBeDisabled();
  await expect(work.getByRole("heading", { name: "Deltagaruppgifter", exact: true })).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(selectionContext).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: test.info().outputPath("selection-context-mobile.png"), fullPage: true });
  await selectionContext.getByRole("button", { name: "Rensa filter och visa vald" }).click();
  await expect(search).toHaveValue("");
  await expect(list.getByRole("button", { name: "Åsa Omarkerad Syntetiska OK" })).toHaveAttribute("aria-pressed", "true");
  await expect(selectionContext).toHaveCount(0);
  await list.getByRole("combobox", { name: "Resultatläge" }).selectOption("OK");
  await expect(selectionContext).toContainText("utanför aktuellt urval");
  await selectionContext.getByRole("button", { name: "Rensa filter och visa vald" }).click();
  await expect(list.getByRole("combobox", { name: "Resultatläge" })).toHaveValue("ALL");
  await expect(selectionContext).toHaveCount(0);
  await page.getByRole("button", { name: "Arbetsvy", exact: true }).click();
  await expect(work.getByRole("heading", { name: "Deltagaruppgifter", exact: true })).toBeVisible();
  await page.setViewportSize({ width: 1280, height: 800 });

  currentRoster = entryTransferCandidatesSchema.parse({ ...roster,
    classes: roster.classes.map(row => row.id === classId ? { ...row, entryCount: 30 } : row),
    entries: [...roster.entries, ...Array.from({ length: 25 }, (_, offset) => {
      const index = offset + 7;
      return { ...entry(index, "PAID"), displayName: `Testperson ${String(index).padStart(2, "0")}`,
        activeAssignment: offset === 0 ? { id: "70000000-0000-4000-8000-000000000001",
          cardNumber: "777777", isRental: true, rentalReturned: false } : null };
    })],
  });
  await list.getByRole("button", { name: "Uppdatera deltagare", exact: true }).click();
  await expect(list.getByRole("row", { name: /Testperson 07/ })).toContainText("Hyrbricka · 777777 · Inte registrerad som återlämnad");
  await list.getByRole("combobox", { name: "Rader per sida" }).selectOption("25");
  await list.getByRole("button", { name: "Åsa Omarkerad Syntetiska OK" }).click();
  await list.getByRole("button", { name: "Nästa", exact: true }).click();
  await expect(selectionContext).toContainText("Vald: Åsa Omarkerad · på sida 1");
  await page.screenshot({ path: test.info().outputPath("selection-context-page-desktop.png"), fullPage: true });
  await list.getByRole("combobox", { name: "Resultatläge" }).selectOption("MP");
  await expect(list.locator("tbody tr")).toHaveCount(1);
  await expect(list.locator("tbody tr")).toContainText("Åsa Omarkerad");
  await expect(list.getByRole("combobox", { name: "Rader per sida" })).toHaveValue("25");
  await list.getByRole("combobox", { name: "Resultatläge" }).selectOption("ALL");
  await expect(list.locator("tbody tr")).toHaveCount(25);
  await list.getByRole("button", { name: "Nästa", exact: true }).click();
  await expect(selectionContext).toContainText("Vald: Åsa Omarkerad · på sida 1");
  await selectionContext.getByRole("button", { name: "Visa vald på sida 1" }).click();
  await expect(list.getByRole("button", { name: "Åsa Omarkerad Syntetiska OK" })).toHaveAttribute("aria-pressed", "true");
  await expect(selectionContext).toHaveCount(0);
  await expect(participantSequence).toContainText("1 av 31 i aktuellt urval");
  await expect(participantSequence.getByRole("button", { name: "Föregående" })).toBeDisabled();
  await list.getByLabel("Filtrera klass").selectOption(classId);
  await expect(list.locator("tbody tr")).toHaveCount(25);
  await page.setViewportSize({ width: 390, height: 844 });
  await list.getByRole("button", { name: "Testperson 26 Syntetiska OK" }).click();
  await expect(page.getByRole("button", { name: "Arbetsvy", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(participantSequence).toContainText("25 av 30 i aktuellt urval");
  expect((await participantSequence.getByRole("button", { name: "Nästa" }).boundingBox())?.height).toBeGreaterThanOrEqual(44);
  await participantSequence.getByRole("button", { name: "Nästa" }).click();
  await expect(participantSequence).toContainText("26 av 30 i aktuellt urval");
  await expect(work.getByRole("region", { name: "Deltagaruppgifter", exact: true })).toContainText("Testperson 27");
  await expect(list.getByLabel("Filtrera klass")).toHaveValue(classId);
  await expect(list.locator("tbody tr").first()).toContainText("Testperson 27");
  await expect(selectionContext).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: test.info().outputPath("participant-sequence-mobile.png"), fullPage: true });
  await page.getByRole("button", { name: "Deltagarlista", exact: true }).click();
  await list.getByRole("button", { name: "Testperson 31 Syntetiska OK" }).click();
  await expect(participantSequence).toContainText("30 av 30 i aktuellt urval");
  await expect(participantSequence.getByRole("button", { name: "Nästa" })).toBeDisabled();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await backToEvents.click();
  await expect(page).toHaveURL("/organizer");
});

test("TASK220 separat speaker är neutral och tät utan påhittad ledare", async ({ page, context }) => {
  const generatedAt = "2026-09-27T12:00:00.000Z";
  const rows = Array.from({ length: 25 }, (_, index) => ({
    slot: index + 1, givenName: "Test", familyName: `Person ${String(index + 1).padStart(2, "0")}`,
    organisationName: index % 2 === 0 ? "Syntetiska OK" : null, className: index < 2 ? "Öppen 5" : "D21",
    selectedRevision: 2,
    registeredAt: new Date(Date.parse(generatedAt) - index * 1_000).toISOString(),
    ...(index === 2 ? { state: "NO_ACTIVE_RESULT" as const } : {
      state: "ACTIVE_RESULT" as const,
      result: index === 0 ? { revision: 2, status: "MP" as const, reason: "MISSING_CONTROL" as const,
        elapsedMs: 300_000 } : index === 1 ? { revision: 2, status: "OK" as const, reason: "COMPLETE" as const,
        elapsedMs: 240_000 } : { revision: 2, status: "NT" as const, reason: "WITHOUT_TIMING" as const }
    })
  }));
  const board = speakerBoardResponseSchema.parse({ formatVersion: 1, raceId, eventName: "Syntetisk tävling",
    raceName: "Lång", raceSnapshotVersion: 5, generatedAt, timeZone: "Europe/Stockholm",
    selection: "LATEST_PUBLISHED_HEADS_BY_REGISTRATION", rows });
  let authenticated = false;
  await page.route(`**/api/admin/races/${raceId}/speaker-board-session`, route => {
    if (route.request().method() === "POST") {
      authenticated = true;
      return route.fulfill({ status: 200, json: { formatVersion: 1, raceId,
        capability: "VIEW_SPEAKER_BOARD", expiresAt: new Date(Date.now() + 3_600_000).toISOString() } });
    }
    return route.fulfill({ status: 401, json: { error: "UNAUTHORIZED" } });
  });
  await page.route(`**/api/admin/races/${raceId}/speaker-board`, route => route.fulfill({
    status: authenticated ? 200 : 401, json: authenticated ? board : { error: "UNAUTHORIZED" }
  }));
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/admin/${raceId}/speaker`);
  const credential = page.getByLabel("Speakerns behörighet");
  await expect(credential).toBeEnabled();
  expect((await credential.boundingBox())?.height).toBeGreaterThanOrEqual(44);
  await expect(page.locator("body")).toHaveCSS("background-color", "rgb(247, 248, 248)");
  await page.screenshot({ path: test.info().outputPath("speaker-separate-login-mobile.png") });
  await credential.fill(`otid_org_speaker_board_v1.${raceId}.${"a".repeat(43)}`);
  await page.getByRole("button", { name: "Logga in", exact: true }).click();
  const report = page.getByRole("region", { name: "Speaker – senaste resultatunderlag" });
  await expect(report).toBeVisible();
  const visibleRows = report.getByRole("listitem");
  await expect(visibleRows).toHaveCount(25);
  await expect(visibleRows.first()).toContainText("Test Person 01");
  await expect(visibleRows.last()).toContainText("Test Person 25");
  await expect(visibleRows.first()).toContainText("Vald revision: 2");
  await expect(visibleRows.first()).toContainText("Effektiv revision: 2");
  await expect(visibleRows.first().getByText("Felstämplad (MP)")).toHaveCSS("color", "rgb(164, 45, 41)");
  await expect(report).toContainText("Tävlingsversion: 5");
  await expect(report).toContainText("Europe/Stockholm");
  await expect(page.getByText(/Privat läsvy med högst 25 resultatunderlag/)).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: test.info().outputPath("speaker-separate-mobile.png") });
  await context.setOffline(true);
  await expect(report.getByRole("alert")).toContainText("Underlaget kan vara gammalt");
  await expect(report.getByRole("alert")).toHaveCSS("color", "rgb(130, 83, 0)");
  await expect(page.getByText("Webbläsaren uppger att nätanslutning saknas.")).toBeVisible();
  await expect(page.getByText("Webbläsaren uppger att nätanslutning saknas.")).toHaveCSS("color", "rgb(130, 83, 0)");
  await expect(visibleRows).toHaveCount(25);
  await page.screenshot({ path: test.info().outputPath("speaker-separate-offline-mobile.png") });
  await context.setOffline(false);
  await page.setViewportSize({ width: 900, height: 800 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: test.info().outputPath("speaker-separate-tablet.png") });
  await page.setViewportSize({ width: 1280, height: 800 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  expect((await visibleRows.first().boundingBox())?.height).toBeLessThan(100);
  await page.screenshot({ path: test.info().outputPath("speaker-separate-desktop.png") });
});

test("TASK284/TASK285/TASK286 speaker skiljer läskällor, sökning, signalstatus och exakta publika länkar", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  const now = new Date();
  await page.clock.install({ time: now });
  await page.clock.pauseAt(now);
  const board = speakerBoardResponseSchema.parse({ formatVersion: 1, raceId,
    eventName: roster.eventName, raceName: roster.raceName, raceSnapshotVersion: 2,
    generatedAt: roster.generatedAt, timeZone: roster.timeZone,
    selection: "LATEST_PUBLISHED_HEADS_BY_REGISTRATION", rows: [
      { slot: 1, givenName: "Bo", familyName: "Obetald", organisationName: "Syntetiska OK",
        className: "Öppen 5", selectedRevision: 1, registeredAt: roster.generatedAt,
        state: "ACTIVE_RESULT", result: { revision: 1, status: "OK", reason: "COMPLETE", elapsedMs: 240_000 } },
      { slot: 2, givenName: "Åsa", familyName: "Omarkerad", organisationName: "Syntetiska OK",
        className: "Öppen 5", selectedRevision: 1, registeredAt: roster.generatedAt,
        state: "ACTIVE_RESULT", result: { revision: 1, status: "MP", reason: "MISSING_CONTROL", elapsedMs: 300_000 } },
      { slot: 3, givenName: "Cecilia", familyName: "Betald", organisationName: null,
        className: "D21", selectedRevision: 1, registeredAt: roster.generatedAt, state: "NO_ACTIVE_RESULT" }
    ] });
  let publicReads = 0, httpRequests = 0, writes = 0, feedFailure = false, leaderFailure = false, denied = false;
  await page.route("**/api/**", route => {
    httpRequests++;
    const request = route.request(), path = new URL(request.url()).pathname;
    if (path.endsWith("/administrator/session")) return request.method() === "POST"
      ? route.fulfill({ status: 200, json: { formatVersion: 1, raceId, capability: "MANAGE_RACE",
        expiresAt: new Date(Date.now() + 3_600_000).toISOString() } })
      : route.fulfill({ status: 401, json: { error: "UNAUTHORIZED" } });
    if (request.method() !== "GET") writes++;
    if (path.endsWith("/administrator/transfer-candidates")) return route.fulfill({ status: 200, json: roster });
    if (path.endsWith("/administrator/speaker-board")) return route.fulfill({
      status: denied ? 403 : feedFailure ? 503 : 200,
      json: denied ? { error: "FORBIDDEN" } : feedFailure ? { error: "UNAVAILABLE" } : board });
    if (path === `/api/public/races/${raceId}/results`) {
      publicReads++;
      return route.fulfill({ status: leaderFailure ? 503 : 200,
        json: leaderFailure ? { error: "UNAVAILABLE" } : publicLeaders });
    }
    return route.fulfill({ status: 404, json: { error: "NOT_FOUND" } });
  });
  await page.goto(`/admin/${raceId}/manage`);
  await page.getByLabel("Administratörsbehörighet", { exact: true })
    .fill(`otid_org_race_admin_v1.${raceId}.${"a".repeat(43)}`);
  await page.getByRole("button", { name: "Logga in", exact: true }).click();
  await page.getByRole("navigation", { name: "Arbetslägen", exact: true })
    .getByRole("button", { name: "Under tävlingen", exact: true }).click();
  await page.getByRole("navigation", { name: "Tävlingsdagens arbetsytor", exact: true })
    .getByRole("button", { name: "Speaker", exact: true }).click();
  const speaker = page.getByRole("region", { name: "Speaker", exact: true });
  const leaders = speaker.getByRole("region", { name: "Publika klassledare", exact: true });
  const feed = speaker.getByRole("region", { name: "Senaste resultatuppdateringarna", exact: true });
  const search = speaker.getByRole("searchbox", { name: "Sök i läst speakerunderlag", exact: true });
  const clearSearch = speaker.getByRole("button", { name: "Rensa sökning", exact: true });
  await expect(feed.getByRole("table")).toContainText("Bo Obetald");
  await expect(feed.getByRole("table").getByText("Felstämplad (MP)", { exact: true })).toHaveCSS("color", "rgb(164, 45, 41)");
  await expect(feed.getByRole("table").getByText("Inget aktivt resultat", { exact: true })).toHaveCSS("color", "rgb(130, 83, 0)");
  expect(publicReads).toBe(0);
  await expect(feed).toContainText("Visar 3 av 3");
  await expect(leaders).not.toContainText("Visar 0 av 0");
  const beforeUnreadSearch = httpRequests;
  await search.fill("  bO  ");
  await expect(feed).toContainText("Visar 1 av 3");
  await expect(feed.getByRole("table").locator("tbody tr")).toHaveCount(1);
  expect(httpRequests).toBe(beforeUnreadSearch);
  expect(publicReads).toBe(0);
  await clearSearch.click();
  await expect(feed).toContainText("Visar 3 av 3");
  await leaders.getByRole("button", { name: "Visa klassledare", exact: true }).click();
  await expect(leaders.getByRole("table")).toContainText("Klara Ledare");
  await expect(leaders.getByRole("table")).not.toContainText("Bo Obetald");
  const klaraDesktop = leaders.getByRole("table").getByRole("link", { name: /Visa publicerat resultat för Klara Ledare/ });
  await expect(klaraDesktop).toHaveAttribute("href", `/results/${raceId}/participants/${publicLeaders.results[0]!.publicResultId}`);
  await expect(klaraDesktop).toHaveAttribute("target", "_blank");
  await expect(klaraDesktop).toHaveAttribute("rel", "noopener noreferrer");
  await expect(feed.getByRole("link")).toHaveCount(0);
  await expect(leaders.getByRole("table").locator("tbody").getByText("Ledare", { exact: true }).first())
    .toHaveCSS("color", "rgb(39, 103, 73)");
  const leaderBox = await leaders.boundingBox(), feedBox = await feed.boundingBox();
  expect(leaderBox && feedBox && Math.abs(leaderBox.y - feedBox.y) < 8).toBe(true);
  expect(leaderBox && feedBox && (leaderBox.x + leaderBox.width <= feedBox.x || feedBox.x + feedBox.width <= leaderBox.x)).toBe(true);
  await expect(leaders).toContainText("Mottaget av webbläsaren");
  await expect(feed).toContainText("Underlag läst på servern");
  const beforeSearch = httpRequests;
  await search.fill(" ÖPPEN 5 ");
  await expect(feed).toContainText("Visar 2 av 3");
  await expect(leaders).toContainText("Visar 2 av 2");
  await search.fill("kLaRa");
  await expect(feed).toContainText("Visar 0 av 3");
  await expect(leaders).toContainText("Visar 1 av 2");
  await search.fill("D21");
  await expect(feed).toContainText("Visar 1 av 3");
  await expect(leaders).toContainText("Visar 0 av 2");
  await search.fill("ingen sådan person");
  await expect(feed).toContainText("Visar 0 av 3");
  await expect(leaders).toContainText("Visar 0 av 2");
  await expect(feed).not.toContainText("Inga publicerade resultatunderlag finns ännu");
  await expect(leaders).not.toContainText("Inga säkra publicerade klassledare finns");
  await clearSearch.click();
  await expect(search).toHaveValue("");
  await expect(feed).toContainText("Visar 3 av 3");
  await expect(leaders).toContainText("Visar 2 av 2");
  expect(httpRequests).toBe(beforeSearch);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: test.info().outputPath("speaker-compact-desktop.png"), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(feed.getByRole("listitem")).toHaveCount(3);
  await expect(leaders.getByRole("listitem")).toHaveCount(2);
  const klaraMobile = leaders.getByRole("list").getByRole("link", { name: /Visa publicerat resultat för Klara Ledare/ });
  await expect(klaraMobile).toHaveAttribute("href", `/results/${raceId}/participants/${publicLeaders.results[0]!.publicResultId}`);
  await expect(klaraMobile).toHaveAttribute("target", "_blank");
  expect((await klaraMobile.boundingBox())?.height).toBeGreaterThanOrEqual(44);
  await expect(feed.getByRole("link")).toHaveCount(0);
  await search.fill("ÅSA");
  await expect(feed.getByRole("listitem")).toHaveCount(1);
  await expect(leaders.getByRole("listitem")).toHaveCount(0);
  await clearSearch.click();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: test.info().outputPath("speaker-compact-mobile.png"), fullPage: true });
  leaderFailure = true;
  await leaders.getByRole("button", { name: "Uppdatera klassledare", exact: true }).click();
  await expect(leaders.getByRole("status")).toContainText("tidigare publika ögonblicksbilden");
  await expect(feed).toContainText("Bo Obetald");
  feedFailure = true;
  await speaker.getByRole("button", { name: "Uppdatera underlag", exact: true }).click();
  await expect(speaker.getByRole("status").filter({ hasText: "Visar senast hämtade uppgifter" })).toBeVisible();
  await expect(feed).toContainText("Felstämplad (MP)");
  await search.fill("ingen sådan person");
  await expect(feed).toContainText("Visar 0 av 3");
  await expect(leaders.getByRole("status")).toContainText("tidigare publika ögonblicksbilden");
  await expect(feed.getByRole("status")).toContainText("Visar senast hämtade uppgifter");
  denied = true;
  await speaker.getByRole("button", { name: "Uppdatera underlag", exact: true }).click();
  await expect(speaker.getByRole("alert")).toContainText("sessionen saknas eller har gått ut");
  await expect(speaker).not.toContainText("Bo Obetald");
  await expect(speaker).not.toContainText("Klara Ledare");
  await expect(search).toHaveCount(0);
  expect(writes).toBe(0);
});

test("TASK281/TASK283/TASK290/TASK292/TASK297/TASK298 deltagarval prioriterar resultat efter spärrad sessionsstart", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  let unintendedWrites = 0;
  let manualSessionPosts = 0;
  let transferReads = 0;
  let initialSessionGets = 0;
  let releaseJavascript!: () => void;
  let releaseInitialSession!: () => void;
  let markInitialSessionRequested!: () => void;
  const javascriptGate = new Promise<void>(resolve => { releaseJavascript = resolve; });
  const initialSessionGate = new Promise<void>(resolve => { releaseInitialSession = resolve; });
  const initialSessionRequested = new Promise<void>(resolve => { markInitialSessionRequested = resolve; });
  await page.route(/\/_next\/static\/.*\.js(?:\?.*)?$/, async route => {
    await javascriptGate;
    await route.continue();
  });
  let assignedCourseMode: "ok" | "missing" | "unavailable" | "denied" = "ok";
  const assignedCourseId = "30000000-0000-4000-8000-000000000002";
  const otherCourseId = "30000000-0000-4000-8000-000000000003";
  const participantRoster = entryTransferCandidatesSchema.parse({ ...roster,
    classes: roster.classes.map((row, index) => ({ ...row, courseVersionId: index === 0 ? assignedCourseId : otherCourseId,
      courseName: "Tilldelade banan", courseVersion: 2 })) });
  await page.route("**/api/**", async route => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (path === `/api/admin/races/${raceId}/administrator/session`) {
      if (request.method() === "POST") {
        manualSessionPosts++;
        return route.fulfill({ status: 200, json: { formatVersion: 1, raceId, capability: "MANAGE_RACE",
          expiresAt: new Date(Date.now() + 3_600_000).toISOString() } });
      }
      if (initialSessionGets++ === 0) markInitialSessionRequested();
      await initialSessionGate;
      return route.fulfill({ status: 401, json: { error: "UNAUTHORIZED" } });
    }
    if (request.method() !== "GET") unintendedWrites++;
    if (path === `/api/admin/races/${raceId}/administrator/transfer-candidates`) {
      transferReads++;
      return route.fulfill({ status: 200, json: participantRoster });
    }
    if (path === `/api/admin/races/${raceId}/course-control-geometries`) {
      if (assignedCourseMode === "denied") return route.fulfill({ status: 403, json: { error: "FORBIDDEN" } });
      if (assignedCourseMode === "unavailable") return route.fulfill({ status: 503, json: { error: "UNAVAILABLE" } });
      return route.fulfill({ status: 200, json: adminCourseControlGeometryStateResponseSchema.parse({
        formatVersion: 1, raceId, geometries: [], courses: assignedCourseMode === "missing" ? [] : [{
          courseVersionId: otherCourseId, courseName: "Tilldelade banan", version: 2,
          controls: [{ courseControlId: "60000000-0000-4000-8000-000000000004", sequence: 1, controlCode: 71 }],
        }, {
          courseVersionId: assignedCourseId, courseName: "Tilldelade banan", version: 2,
          controls: [31, 44, 31].map((controlCode, index) => ({
            courseControlId: `60000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
            sequence: index + 1, controlCode,
          })).reverse(),
        }],
      }) });
    }
    if (path.endsWith("/effective-result")) {
      const participant = roster.entries.find(row => path.includes(row.id))!;
      const effective = participant.effectiveResult;
      const common = { formatVersion: 1, raceId, entryId: participant.id, entryVersion: participant.version,
        currentClassId: participant.classId, snapshotVersion: roster.snapshotVersion,
        generatedAt: roster.generatedAt, timeZone: roster.timeZone };
      return route.fulfill({ status: 200, json: administratorEffectiveResultResponseSchema.parse(effective.state === "ACTIVE_RESULT"
        ? { ...common, ...effective, resultClass: { id: participant.classId, name: "Öppen 5" }, governingDecision: "NONE",
          controlDetails: effective.result.status === "MP" ? { courseName: "Långbanan", courseVersionId,
            startTime: "2026-09-23T08:00:00.000Z", finishTime: "2026-09-23T08:05:00.000Z",
            controls: [
              { sequence: 1, controlCode: 31, occurrence: 1, elapsedMs: 60_000, legMs: 60_000 },
              { sequence: 2, controlCode: 32, occurrence: 1, elapsedMs: null, legMs: null },
              { sequence: 3, controlCode: 33, occurrence: 1, elapsedMs: 180_000, legMs: 120_000 }
            ], missingControls: [32], extraPunches: [] } : null }
        : { ...common, ...effective }) });
    }
    return route.fulfill({ status: 404, json: { error: "NOT_FOUND" } });
  });
  const credentialInput = page.getByLabel("Administratörsbehörighet", { exact: true });
  const loginButton = page.getByRole("button", { name: "Logga in", exact: true });
  try {
    await page.goto(`/admin/${raceId}/manage`, { waitUntil: "commit" });
    await expect(credentialInput).toBeDisabled();
    await expect(loginButton).toBeDisabled();
    releaseJavascript();
    await initialSessionRequested;
    await expect(credentialInput).toBeDisabled();
    await expect(loginButton).toBeDisabled();
    releaseInitialSession();
    await expect(credentialInput).toBeEnabled();
    await expect(loginButton).toBeEnabled();
  } finally {
    releaseJavascript();
    releaseInitialSession();
  }
  await credentialInput.fill(`otid_org_race_admin_v1.${raceId}.${"a".repeat(43)}`);
  await loginButton.click();
  await page.getByRole("navigation", { name: "Arbetslägen" }).getByRole("combobox").selectOption("PARTICIPANTS");
  expect(manualSessionPosts).toBe(1);
  expect(transferReads).toBeGreaterThanOrEqual(1);
  const list = page.locator('[data-panel="LIST"]');
  const work = page.locator('[data-panel="WORK"]');
  const identity = work.getByRole("region", { name: "Vald deltagare", exact: true });
  await expect(identity).toHaveCount(0);
  await list.getByRole("button", { name: "Åsa Omarkerad Syntetiska OK" }).click();
  await expect(identity).toContainText("Åsa Omarkerad");
  await expect(identity).toContainText("Öppen 5");
  expect(await identity.evaluate(element => getComputedStyle(element).position)).toBe("static");
  await expect(work.getByRole("region", { name: "Deltagaruppgifter" })).toContainText("Åsa Omarkerad");
  await expect(work.getByRole("region", { name: "Gällande resultat" })).toContainText("Felstämplad");
  const controls = work.locator('section[aria-labelledby="race-result-controls-title"]');
  const assignedCourse = work.getByRole("region", { name: "Tilldelad bana", exact: true });
  const participantFacts = work.locator('section[aria-labelledby="race-participant-facts-title"]');
  const expectInfoOrder = async () => {
    const positions = await work.evaluate(element => {
      const children = [...element.children];
      return ["race-participant-facts-title", "Gällande resultat", "race-participant-course-title", "race-result-controls-title"]
        .map(marker => children.findIndex(child => child.getAttribute("aria-labelledby") === marker || child.getAttribute("aria-label") === marker));
    });
    expect(positions.every((position, index) => position >= 0 && (index === 0 || position > positions[index - 1]!))).toBe(true);
  };
  await expect(assignedCourse).toContainText("Tilldelade banan");
  await expect(assignedCourse.getByRole("listitem")).toHaveText(["1.31", "2.44", "3.31"]);
  await expect(controls).toContainText("Långbanan");
  await expect(controls).not.toContainText("Tilldelade banan");
  await expect(controls.getByRole("row", { name: /32/ })).toContainText("Ingen mellantid");
  await expect(controls).toContainText("Saknade kontroller");
  await assignedCourse.getByRole("button", { name: "Visa i Banor" }).click();
  const courseOverview = page.getByRole("region", { name: "Banor och kontroller" });
  await expect(courseOverview).toBeVisible();
  const courseDetails = courseOverview.locator("details");
  await expect(courseDetails).toHaveCount(2);
  await expect(courseDetails.first()).not.toHaveAttribute("open", "");
  await expect(courseDetails.last()).toHaveAttribute("open", "");
  await expect(courseDetails.last().locator("summary")).toBeFocused();
  await expect(courseDetails.last().getByRole("listitem")).toHaveText(["1.31", "2.44", "3.31"]);
  await page.getByRole("navigation", { name: "Arbetslägen" }).getByRole("combobox").selectOption("PARTICIPANTS");
  await expect(identity).toContainText("Åsa Omarkerad");
  await expect(assignedCourse).toContainText("Tilldelade banan");
  await expect(work.getByRole("combobox", { name: "Ny klass" })).toHaveCount(0);
  await expectInfoOrder();
  for (const section of [participantFacts, assignedCourse]) {
    const boxStyle = await section.evaluate(element => {
      const style = getComputedStyle(element);
      return { left: style.borderLeftWidth, right: style.borderRightWidth, bottom: style.borderBottomWidth,
        radius: style.borderRadius, background: style.backgroundColor, paddingLeft: style.paddingLeft, paddingRight: style.paddingRight };
    });
    expect(boxStyle).toEqual({ left: "0px", right: "0px", bottom: "0px", radius: "0px",
      background: "rgba(0, 0, 0, 0)", paddingLeft: "0px", paddingRight: "0px" });
    for (const button of await section.getByRole("button").all()) {
      expect(await button.evaluate(element => element.getBoundingClientRect().height)).toBeGreaterThanOrEqual(44);
    }
  }
  await work.screenshot({ path: test.info().outputPath("participant-info-mobile.png") });
  await page.setViewportSize({ width: 1280, height: 800 });
  await assignedCourse.getByRole("button", { name: "Visa i Banor" }).click();
  await expect(courseOverview).toBeVisible();
  await expect(courseDetails.last()).toHaveAttribute("open", "");
  await expect(courseDetails.last().locator("summary")).toBeFocused();
  await page.getByRole("navigation", { name: "Arbetslägen" }).getByRole("button", { name: "Deltagare", exact: true }).click();
  await expect(identity).toContainText("Åsa Omarkerad");
  await expectInfoOrder();
  for (const section of [participantFacts, assignedCourse]) {
    for (const button of await section.getByRole("button").all()) {
      expect(await button.evaluate(element => element.getBoundingClientRect().height)).toBeGreaterThanOrEqual(44);
    }
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await work.screenshot({ path: test.info().outputPath("participant-info-desktop.png") });
  await work.evaluate(panel => { panel.scrollTop = panel.scrollHeight; });
  await expect.poll(() => work.evaluate(panel => panel.scrollTop)).toBeGreaterThan(0);
  const panelBox = await work.boundingBox(), identityBox = await identity.boundingBox();
  expect(panelBox && identityBox && Math.abs(panelBox.y - identityBox.y) < 3).toBe(true);
  await expect(identity).toContainText("Åsa Omarkerad");
  await work.screenshot({ path: test.info().outputPath("participant-context-scrolled-desktop.png") });
  await work.evaluate(panel => { panel.scrollTop = 0; });
  await page.setViewportSize({ width: 390, height: 844 });
  await work.getByRole("button", { name: "Byt klass", exact: true }).click();
  await expect(work.getByRole("combobox", { name: "Ny klass" })).toBeVisible();
  await work.getByRole("navigation", { name: "Deltagare i aktuellt urval" }).getByRole("button", { name: "Nästa" }).click();
  await expect(work.getByRole("region", { name: "Deltagaruppgifter" })).toContainText("Bo Obetald");
  await expect(identity).toContainText("Bo Obetald");
  await expect(identity).not.toContainText("Åsa Omarkerad");
  await expect(work.getByRole("combobox", { name: "Ny klass" })).toHaveCount(0);
  expect(unintendedWrites).toBe(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.getByRole("button", { name: "Deltagarlista", exact: true }).click();
  await list.getByRole("button", { name: "Ny deltagare", exact: true }).click();
  await expect(identity).toHaveCount(0);
  expect(unintendedWrites).toBe(0);
  await page.getByRole("button", { name: "Deltagarlista", exact: true }).click();
  await list.getByRole("button", { name: "David Deltagare Syntetiska OK", exact: true }).click();
  await expect(work.getByRole("region", { name: "Gällande resultat", exact: true })).toContainText("Inget publicerat resultat");
  await expect(assignedCourse.getByRole("listitem")).toHaveText(["1.31", "2.44", "3.31"]);
  const retryCourse = assignedCourse.getByRole("button", { name: "Läs tilldelad bana igen", exact: true });
  assignedCourseMode = "missing";
  await retryCourse.click();
  await expect(assignedCourse.getByRole("status")).toContainText("Tilldelad banversion saknas eller kunde inte läsas.");
  await expect(assignedCourse.getByRole("listitem")).toHaveCount(0);
  await expect(assignedCourse).not.toContainText("Långbanan");
  await assignedCourse.getByRole("button", { name: "Visa i Banor" }).click();
  await expect(courseOverview.getByText("Den valda banversionen saknas i det lästa banunderlaget.", { exact: true })).toBeVisible();
  await expect(courseDetails).toHaveCount(0);
  await page.getByRole("navigation", { name: "Arbetslägen" }).getByRole("combobox").selectOption("PARTICIPANTS");
  await expect(work.getByRole("region", { name: "Deltagaruppgifter" })).toContainText("David Deltagare");
  assignedCourseMode = "unavailable";
  await retryCourse.click();
  await expect(assignedCourse.getByRole("status")).toContainText("Tilldelad banversion saknas eller kunde inte läsas.");
  assignedCourseMode = "denied";
  await retryCourse.click();
  await expect(page.getByRole("status").filter({ hasText: "Behörighet saknas eller har gått ut." })).toBeVisible();
  await expect(assignedCourse).toHaveCount(0);
  await expect(page.getByText("David Deltagare", { exact: true })).toHaveCount(0);
  expect(unintendedWrites).toBe(0);
});
