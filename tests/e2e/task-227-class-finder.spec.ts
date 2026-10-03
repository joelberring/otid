import { expect, test } from "@playwright/test";
import { adminCourseControlGeometryStateResponseSchema, entryTransferCandidatesSchema } from "@o-tid/contracts";

const raceId = "10000000-0000-4000-8000-000000000001";
const id = (prefix: string, number: number) => `${prefix}-0000-4000-8000-${String(number).padStart(12, "0")}`;
const classes = Array.from({ length: 60 }, (_, index) => {
  const number = index + 1;
  const course = Math.floor(index / 5) + 1;
  return {
    id: id("20000000", number), name: `Klass ${String(number).padStart(2, "0")}`,
    courseVersionId: id("30000000", number === 50 ? 13 : course),
    courseName: `Bana ${String(number === 50 ? 13 : course).padStart(2, "0")}`,
    courseVersion: 1, startRule: number === 31 ? "FIXED" as const : "PUNCH" as const,
    maxEntries: null, capacityVersion: 1, entryCount: number <= 20 ? 9 : 8,
  };
});
const entries = Array.from({ length: 500 }, (_, index) => ({
  id: id("40000000", index + 1), displayName: `Deltagare ${index + 1}`,
  organisationName: "Syntetiska OK", classId: classes[index % classes.length]!.id, version: 1,
  paymentStatus: "PAID" as const, paymentStatusVersion: 1,
  resultFreshness: "NO_PUBLISHED_RESULT" as const,
  effectiveResult: { state: "NO_PUBLISHED_RESULT" as const, selectedRevision: null },
  resultRevisionMarker: null, fixedStartTime: null, activeAssignment: null,
  multipleActiveAssignments: false,
}));
const roster = entryTransferCandidatesSchema.parse({
  formatVersion: 2, raceId, eventName: "Syntetisk stor tävling", raceName: "Lång",
  snapshotVersion: 2, raceDate: "2026-09-27", generatedAt: "2026-09-27T10:00:00.000Z",
  timeZone: "Europe/Stockholm", classes, entries,
});
const courseData = adminCourseControlGeometryStateResponseSchema.parse({
  formatVersion: 1, raceId, geometries: [],
  courses: Array.from({ length: 12 }, (_, courseIndex) => ({
    courseVersionId: id("30000000", courseIndex + 1),
    courseName: `Bana ${String(courseIndex + 1).padStart(2, "0")}`, version: 1,
    controls: Array.from({ length: 18 }, (_, controlIndex) => ({
      courseControlId: id("60000000", courseIndex * 100 + controlIndex + 1),
      sequence: controlIndex + 1, controlCode: controlIndex === 5 ? 31 : 31 + controlIndex,
    })).reverse(),
  })),
});

test("TASK227 TASK228 TASK229 TASK230 TASK231 TASK232 TASK233 TASK234 TASK245 TASK251 TASK288 TASK289 TASK293 TASK294 TASK295 TASK296 TASK299 TASK300 TASK301 överblickar klasser och banor i stor syntetisk tävling", async ({ page }) => {
  test.setTimeout(90_000);
  await page.setViewportSize({ width: 390, height: 844 });
  let currentRoster = roster;
  let courseUnavailable = false;
  let unexpectedWriteRequests = 0;
  let holdRosterResponse = false;
  let releaseRosterResponse: (() => void) | undefined;
  const manualClassRequests: { body: string; key: string }[] = [];
  const classNameRequests: { body: string; key: string }[] = [];
  await page.route("**/api/**", async route => {
    const path = new URL(route.request().url()).pathname;
    if (path === `/api/admin/races/${raceId}/administrator/classes/${id("20000000", 61)}/name`) {
      const raceClass = currentRoster.classes.find(row => row.id === id("20000000", 61));
      if (!raceClass) return route.abort();
      if (route.request().method() === "GET") return route.fulfill({ status: 200, json: {
        formatVersion: 1, raceId, classId: raceClass.id, snapshotVersion: currentRoster.snapshotVersion,
        className: raceClass.name, courseVersionId: raceClass.courseVersionId, editable: true,
      } });
      classNameRequests.push({ body: route.request().postData() ?? "", key: route.request().headers()["idempotency-key"] ?? "" });
      const submitted = JSON.parse(classNameRequests[0]!.body) as { formatVersion: 1; requestId: string;
        expectedSnapshotVersion: number; expectedClassName: string; className: string };
      currentRoster = entryTransferCandidatesSchema.parse({ ...currentRoster,
        snapshotVersion: submitted.expectedSnapshotVersion + 1,
        classes: currentRoster.classes.map(row => row.id === raceClass.id ? { ...row, name: submitted.className } : row) });
      return route.fulfill({ status: 200, json: { formatVersion: 1, replayed: false,
        requestId: submitted.requestId, raceId, classId: raceClass.id,
        courseVersionId: raceClass.courseVersionId, previousClassName: submitted.expectedClassName,
        className: submitted.className, request: submitted,
        snapshotVersionBefore: submitted.expectedSnapshotVersion,
        snapshotVersionAfter: submitted.expectedSnapshotVersion + 1, changedAt: "2026-10-03T10:05:00.000Z" } });
    }
    if (path === `/api/admin/races/${raceId}/administrator/classes` && route.request().method() === "POST") {
      manualClassRequests.push({ body: route.request().postData() ?? "", key: route.request().headers()["idempotency-key"] ?? "" });
      if (manualClassRequests.length === 1) return route.fulfill({ status: 503, json: { error: "UNAVAILABLE" } });
      const submitted = JSON.parse(manualClassRequests[1]!.body) as { formatVersion: 1; requestId: string;
        expectedSnapshotVersion: number; courseVersionId: string; className: string; startRule: "PUNCH" | "FIXED" };
      currentRoster = entryTransferCandidatesSchema.parse({ ...currentRoster,
        snapshotVersion: submitted.expectedSnapshotVersion + 1,
        classes: [...currentRoster.classes, { ...currentRoster.classes[0]!, id: id("20000000", 61),
          name: submitted.className, courseVersionId: submitted.courseVersionId,
          startRule: submitted.startRule, entryCount: 0 }] });
      return route.fulfill({ status: 200, json: { formatVersion: 1, replayed: false, requestId: submitted.requestId,
        raceId, courseId: id("70000000", 1), courseVersionId: submitted.courseVersionId,
        courseName: "Bana 01", courseVersion: 1, classId: id("20000000", 61), request: submitted,
        snapshotVersionBefore: submitted.expectedSnapshotVersion,
        snapshotVersionAfter: submitted.expectedSnapshotVersion + 1, createdAt: "2026-10-03T10:00:00.000Z" } });
    }
    if (route.request().method() !== "GET" && path !== `/api/admin/races/${raceId}/administrator/session`) {
      unexpectedWriteRequests++;
    }
    if (path === `/api/admin/races/${raceId}/administrator/session`) {
      return route.request().method() === "POST"
        ? route.fulfill({ status: 200, json: { formatVersion: 1, raceId, capability: "MANAGE_RACE",
          expiresAt: new Date(Date.now() + 3_600_000).toISOString() },
          headers: { "set-cookie": `otid_race_administrator_csrf=${"c".repeat(43)}; Path=/; SameSite=Strict` } })
        : route.fulfill({ status: 401, json: { error: "UNAUTHORIZED" } });
    }
    if (path === `/api/admin/races/${raceId}/administrator/transfer-candidates`) {
      if (holdRosterResponse) {
        await new Promise<void>(resolve => { releaseRosterResponse = resolve; });
        holdRosterResponse = false;
        releaseRosterResponse = undefined;
      }
      return route.fulfill({ status: 200, json: currentRoster });
    }
    if (path === `/api/admin/races/${raceId}/course-control-geometries`) {
      return courseUnavailable ? route.fulfill({ status: 503, json: { error: "UNAVAILABLE" } })
        : route.fulfill({ status: 200, json: courseData });
    }
    return route.abort();
  });
  await page.goto(`/admin/${raceId}/manage`);
  await expect(page.getByRole("status")).toHaveText("Behörighet saknas eller har gått ut. Logga in igen.");
  await page.waitForLoadState("networkidle");
  await page.getByLabel("Administratörsbehörighet", { exact: true })
    .fill(`otid_org_race_admin_v1.${raceId}.${"a".repeat(43)}`);
  await page.getByRole("button", { name: "Logga in", exact: true }).click();
  async function chooseWorkflow(mode: "OVERVIEW" | "BEFORE" | "PARTICIPANTS" | "DURING" | "AFTER", label: string) {
    const navigation = page.getByRole("navigation", { name: "Arbetslägen" });
    if ((page.viewportSize()?.width ?? 0) <= 720) await navigation.getByRole("combobox").selectOption(mode);
    else await navigation.getByRole("button", { name: label, exact: true }).click();
  }
  async function choosePreparation(area: "OVERVIEW" | "COURSES" | "CLASSES", label: string) {
    const navigation = page.getByRole("navigation", { name: "Tävlingsförberedelser" });
    if ((page.viewportSize()?.width ?? 0) <= 720) await navigation.getByRole("combobox").selectOption(area);
    else await navigation.getByRole("button", { name: label, exact: true }).click();
  }
  const landing = page.getByRole("region", { name: "Tävlingsbild", exact: true });
  await expect(landing).toBeVisible();
  const landingRows = landing.locator("table tbody tr");
  const landingSearch = landing.getByRole("searchbox", { name: "Sök klass eller bana" });
  await expect(landingRows).toHaveCount(60);
  await expect(landingRows.first()).toContainText("Klass 31");
  await expect(landingRows.first().getByRole("button", { name: "Visa 8 deltagare i Klass 31 utan fast starttid" }))
    .toBeVisible();
  await expect(landing.locator("dl > div").filter({ hasText: "Minutstart utan fast tid" }).locator("dd"))
    .toHaveText("8");
  await page.screenshot({ path: test.info().outputPath("landing-overview-mobile.png"), fullPage: true });
  await landingSearch.fill("Klass 31");
  await expect(landingRows).toHaveCount(1);
  await expect(landing).toContainText("Visar 1 av 60 klasser.");
  await landingSearch.fill("Bana 08");
  await expect(landingRows).toHaveCount(5);
  await expect(landing).toContainText("Visar 5 av 60 klasser.");
  await landingSearch.fill("finns inte");
  await expect(landingRows).toHaveCount(0);
  await expect(landing).toContainText("Inga klasser matchar sökningen.");
  await landingSearch.clear();
  await expect(landingRows).toHaveCount(60);
  const landingMissing = landingRows.first().getByRole("button", { name: "Visa 8 deltagare i Klass 31 utan fast starttid" });
  expect((await landingMissing.boundingBox())?.height).toBeGreaterThanOrEqual(44);
  await landingMissing.click();
  const landingList = page.locator('[data-panel="LIST"]');
  await expect(landingList.getByLabel("Filtrera klass")).toHaveValue(classes[30]!.id);
  await expect(landingList.getByText("Endast minutstart utan fast tid", { exact: true })).toBeVisible();
  await chooseWorkflow("OVERVIEW", "Översikt");
  await chooseWorkflow("BEFORE", "Före tävlingen");
  const preparation = page.getByRole("region", { name: "Upplägg", exact: true });
  const importLink = preparation.getByRole("link", { name: "Öppna import för detta lopp" });
  await expect(importLink).toBeVisible();
  await expect(importLink).toHaveAttribute("href", `/admin/${raceId}/imports`);
  await expect(preparation).toContainText("vanlig tävlingsadministration ger inte importrätt");
  const steps = [
    ["Kontrollera banor", "COURSES", "Banor"],
    ["Gå igenom klasser", "CLASSES", "Klasser"],
    ["Stäm av deltagare", "PARTICIPANTS", "Deltagare"],
    ["Planera starten", "DRAW", "Lottning & starttider"],
    ["Publicera startlista", "PUBLICATION", "Startlista"],
    ["Ordna bemanning", "STAFF", "Funktionärer"],
  ] as const;
  for (const width of [390, 1280]) {
    await page.setViewportSize({ width, height: 844 });
    await choosePreparation("OVERVIEW", "Upplägg");
    await page.screenshot({ path: test.info().outputPath(`preparation-steps-${width}.png`), fullPage: true });
    for (const [title, value, label] of steps) {
      const step = preparation.getByRole("button", { name: title, exact: true });
      expect((await step.boundingBox())?.height).toBeGreaterThanOrEqual(44);
      await step.focus();
      await page.keyboard.press("Enter");
      const navigation = page.getByRole("navigation", { name: "Tävlingsförberedelser" });
      if (width <= 720) {
        await expect(navigation.getByRole("combobox")).toHaveValue(value);
        await expect(navigation.getByRole("combobox")).toBeFocused();
      } else {
        await expect(navigation.getByRole("button", { name: label, exact: true })).toHaveAttribute("aria-pressed", "true");
        await expect(navigation.getByRole("button", { name: label, exact: true })).toBeFocused();
      }
      if (value === "STAFF") {
        const staffPanel = page.getByText("Ge åtkomst till tävlingspersonal", { exact: true }).locator("..");
        if ((await staffPanel.getAttribute("open")) === null) await staffPanel.locator("summary").click();
        await expect(staffPanel).toContainText("väljer sin utfärdade arbetsroll");
        await expect(staffPanel).toContainText("förbereder enheten online före offlinearbete");
        const destinations = [
          ["Öppna start- och målappen för loppet", `/checkin/index.html#${raceId}`],
          ["Öppna tävlingsadministrationen för loppet", `/admin/${raceId}/manage`],
        ] as const;
        for (const [name, href] of destinations) {
          const link = staffPanel.getByRole("link", { name, exact: true });
          await expect(link).toHaveAttribute("href", href);
          await expect(link).toHaveAttribute("target", "_blank");
          await expect(link).toHaveAttribute("rel", "noreferrer");
          expect((await link.boundingBox())?.height).toBeGreaterThanOrEqual(44);
        }
      }
      expect(unexpectedWriteRequests).toBe(0);
      await choosePreparation("OVERVIEW", "Upplägg");
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
  const preparationMissing = preparation.getByRole("button", { name: "8 saknar fast starttid – visa deltagare", exact: true });
  await expect(preparationMissing).toBeVisible();
  await preparationMissing.click();
  const allMissingList = page.locator('[data-panel="LIST"]');
  await expect(allMissingList.getByLabel("Filtrera klass")).toHaveValue("");
  await expect(allMissingList).toBeFocused();
  await expect(allMissingList.locator("tbody tr")).toHaveCount(8);
  await expect(allMissingList).toContainText("Endast minutstart utan fast tid");
  await chooseWorkflow("BEFORE", "Före tävlingen");
  await choosePreparation("OVERVIEW", "Upplägg");
  const secondFixedClass = classes[31]!.id;
  const alreadyTimedEntry = roster.entries.find(entry => entry.classId === secondFixedClass)!;
  currentRoster = entryTransferCandidatesSchema.parse({ ...roster,
    classes: roster.classes.map(row => row.id === secondFixedClass ? { ...row, startRule: "FIXED" } : row),
    entries: roster.entries.map(entry => entry.id === alreadyTimedEntry.id
      ? { ...entry, fixedStartTime: "2026-09-27T10:00:00.000Z" } : entry),
  });
  await page.getByRole("button", { name: "Uppdatera underlag", exact: true }).click();
  const fifteenMissing = preparation.getByRole("button", { name: "15 saknar fast starttid – visa deltagare", exact: true });
  await expect(fifteenMissing).toBeVisible();
  await fifteenMissing.click();
  await expect(allMissingList.getByLabel("Filtrera klass")).toHaveValue("");
  await expect(allMissingList.locator("tbody tr")).toHaveCount(15);
  await expect(allMissingList.locator("tbody")).not.toContainText(alreadyTimedEntry.displayName);
  await chooseWorkflow("BEFORE", "Före tävlingen");
  await choosePreparation("OVERVIEW", "Upplägg");
  currentRoster = entryTransferCandidatesSchema.parse({ ...roster,
    entries: roster.entries.map(entry => entry.classId === classes[30]!.id
      ? { ...entry, fixedStartTime: "2026-09-27T10:00:00.000Z" } : entry),
  });
  await page.getByRole("button", { name: "Uppdatera underlag", exact: true }).click();
  await expect(preparation).toContainText("I hämtat minutstartunderlag saknas inga fasta starttider.");
  await expect(preparation.getByRole("button", { name: /saknar fast starttid/ })).toHaveCount(0);
  currentRoster = roster;
  await page.getByRole("button", { name: "Uppdatera underlag", exact: true }).click();
  await expect(preparationMissing).toBeVisible();
  expect(unexpectedWriteRequests).toBe(0);
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: test.info().outputPath("preparation-import-mobile.png"), fullPage: true });
  await choosePreparation("CLASSES", "Klasser");

  const area = page.getByRole("region", { name: "Klasser", exact: true });
  const warningContext = area.locator('[data-course-warning-context="true"]');
  await expect(warningContext).toHaveCount(0);
  const search = area.getByRole("searchbox", { name: "Sök klass eller bana" });
  const rows = area.locator("table tbody tr");
  await expect(rows).toHaveCount(60);
  await expect(area).toContainText("I hämtat underlag: 8 utan fast starttid · 0 klasser utan ledig plats.");
  expect((await search.boundingBox())?.height).toBeGreaterThanOrEqual(44);
  for (const number of [1, 31, 60]) {
    await search.fill(`klass ${String(number).padStart(2, "0")}`);
    await expect(rows).toHaveCount(1);
    await expect(rows.first()).toContainText(`Klass ${String(number).padStart(2, "0")}`);
    await expect(area).toContainText("Visar 1 av 60 klasser");
  }
  await search.fill("Klass 05");
  const directClassMobile = rows.first().getByRole("button", { name: "Välj klassrad 5: Klass 05 för inställningar" });
  expect((await directClassMobile.boundingBox())?.height).toBeGreaterThanOrEqual(44);
  await directClassMobile.click();
  await expect(rows.first()).toHaveAttribute("data-selected", "true");
  await expect(rows.first()).toBeFocused();
  await expect(rows.first()).toContainText("Vald klassrad 5");
  await expect(area.locator('[data-course-class-context="true"]')).toHaveCount(0);
  await expect(warningContext).toHaveCount(0);
  await expect(page.getByLabel("Klass för deltagargräns")).toHaveValue(classes[4]!.id);
  await expect(page.getByLabel("Klass för startupplägg")).toHaveValue(classes[4]!.id);
  await search.fill("Klass 60");
  const classCourseButton = rows.first().getByRole("button", {
    name: "Öppna tilldelad bana för klassrad 60: Klass 60 — Bana 12, version 1",
  });
  expect((await classCourseButton.boundingBox())?.height).toBeGreaterThanOrEqual(44);
  await classCourseButton.click();
  const targetedCoursePanel = page.locator('section[aria-labelledby="race-course-overview-title"]');
  const targetedCourseDetails = targetedCoursePanel.locator(":scope > ul > li").last().locator("details");
  await expect(targetedCourseDetails).toHaveAttribute("open", "");
  await expect(targetedCourseDetails.locator("summary")).toBeFocused();
  await expect(targetedCourseDetails.locator("ol > li")).toHaveCount(18);
  await choosePreparation("CLASSES", "Klasser");
  await expect(warningContext).toHaveCount(0);
  await search.fill("Bana 08");
  await expect(rows).toHaveCount(5);
  await expect(area).toContainText("Visar 5 av 60 klasser");
  await search.fill("finns inte");
  await expect(rows).toHaveCount(0);
  await expect(area).toContainText("Inga klasser matchar sökningen.");
  await expect(area).toContainText("I hämtat underlag: 8 utan fast starttid · 0 klasser utan ledig plats.");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: test.info().outputPath("classes-mobile.png"), fullPage: true });

  await search.fill("Klass 31");
  const missing = rows.getByRole("button", { name: "8 saknar tid i Klass 31 – visa deltagare" });
  expect((await missing.boundingBox())?.height).toBeGreaterThanOrEqual(44);
  await missing.click();
  const participantList = page.locator('[data-panel="LIST"]');
  await expect(participantList.getByLabel("Filtrera klass")).toHaveValue(classes[30]!.id);
  await expect(participantList.getByText("Endast minutstart utan fast tid", { exact: true })).toBeVisible();
  await expect(participantList.locator("tbody tr")).toHaveCount(8);
  await participantList.getByRole("searchbox", { name: "Sök namn, klubb, klass eller bricka" }).fill("finns inte");
  await expect(participantList.locator("tbody tr")).toHaveCount(0);
  await chooseWorkflow("BEFORE", "Före tävlingen");
  await choosePreparation("CLASSES", "Klasser");
  await search.fill("Klass 31");
  const mobileClassCount = rows.first().getByRole("button", { name: "Visa 8 anmälda i klassrad 31: Klass 31" });
  expect((await mobileClassCount.boundingBox())?.height).toBeGreaterThanOrEqual(44);
  await mobileClassCount.click();
  await expect(participantList).toBeFocused();
  await expect(participantList.getByLabel("Filtrera klass")).toHaveValue(classes[30]!.id);
  await expect(participantList.getByRole("searchbox", { name: "Sök namn, klubb, klass eller bricka" })).toHaveValue("");
  await expect(participantList.getByText("Endast minutstart utan fast tid", { exact: true })).toHaveCount(0);
  await expect(participantList.locator("tbody tr")).toHaveCount(8);

  await chooseWorkflow("BEFORE", "Före tävlingen");
  await choosePreparation("COURSES", "Banor");
  const coursePanel = page.locator('section[aria-labelledby="race-course-overview-title"]');
  const statusStrip = page.getByRole("region", { name: "Tävlingsstatus" });
  await expect(statusStrip.locator("dl > div")).toHaveCount(6);
  await expect(statusStrip).toContainText("Underlag version 2");
  const mobileCourseSelect = page.getByRole("navigation", { name: "Tävlingsförberedelser" }).getByRole("combobox");
  await expect(mobileCourseSelect).toHaveValue("COURSES");
  await expect(page.getByRole("navigation", { name: "Arbetslägen" }).getByRole("combobox")).toHaveValue("BEFORE");
  const courseTop = await coursePanel.evaluate(element => element.getBoundingClientRect().top + window.scrollY);
  expect(courseTop).toBeLessThanOrEqual(440);
  const courseRows = coursePanel.locator(":scope > ul > li");
  await expect(courseRows).toHaveCount(12);
  const courseSearch = coursePanel.getByRole("searchbox", { name: "Sök bana eller klass" });
  expect((await courseSearch.boundingBox())?.height).toBeGreaterThanOrEqual(44);
  await expect(coursePanel.getByRole("status", { name: "" }).filter({ hasText: "Visar 12 av 12 banor." })).toBeVisible();
  await courseSearch.fill("  bANA 08  ");
  await expect(courseRows).toHaveCount(1);
  await expect(courseRows.first()).toContainText("Bana 08");
  await expect(coursePanel).toContainText("Visar 1 av 12 banor.");
  await courseSearch.fill("KLASS 37");
  await expect(courseRows).toHaveCount(1);
  await expect(courseRows.first()).toContainText("Bana 08");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: test.info().outputPath("course-search-mobile.png"), fullPage: true });
  await courseSearch.fill("finns inte");
  await expect(courseRows).toHaveCount(0);
  await expect(coursePanel).toContainText("Visar 0 av 12 banor.");
  await expect(coursePanel).toContainText("Ingen bana matchar sökningen.");
  await expect(coursePanel).toContainText("1 klass har en tilldelad banversion som saknas i det lästa banunderlaget.");
  await courseSearch.clear();
  await expect(courseRows).toHaveCount(12);
  await expect(page.getByRole("heading", { name: "Bana 01", exact: true })).toBeVisible();
  await expect(courseRows.first()).toContainText("Kontroller 18");
  await expect(courseRows.first()).toContainText("Klass 01");
  await expect(courseRows.first()).toContainText("Klass 05");
  await expect(courseRows.last()).toContainText("Kontroller 18");
  const courseWarning = coursePanel.getByRole("status").filter({ hasText: "tilldelad banversion som saknas" });
  await expect(courseWarning).toContainText("1 klass har en tilldelad banversion som saknas i det lästa banunderlaget.");
  await expect(courseWarning).toContainText("Klass 50 — Bana 13, version 1");
  const warningBox = await courseWarning.boundingBox(), courseListBox = await coursePanel.locator(":scope > ul").boundingBox();
  expect(warningBox && courseListBox && warningBox.y < courseListBox.y).toBe(true);
  const firstCourse = courseRows.first().locator("details");
  await expect(firstCourse).not.toHaveAttribute("open", "");
  await expect(firstCourse.locator("ol")).toBeHidden();
  const courseSummary = firstCourse.locator("summary");
  expect((await courseSummary.boundingBox())?.height).toBeGreaterThanOrEqual(44);
  await courseSummary.click();
  await expect(firstCourse).toHaveAttribute("open", "");
  await expect(firstCourse.locator("ol > li")).toHaveText(Array.from({ length: 18 }, (_, index) =>
    `${index + 1}.${index === 5 ? 31 : 31 + index}`));
  await expect(courseRows.nth(1).locator("ol")).toBeHidden();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await coursePanel.screenshot({ path: test.info().outputPath("course-open-mobile.png") });
  const assignedClass = courseRows.first().getByRole("button", { name: "Öppna klassrad 2: Klass 02" });
  expect((await assignedClass.boundingBox())?.height).toBeGreaterThanOrEqual(44);
  await expect(firstCourse.locator("summary").getByRole("button")).toHaveCount(0);
  await assignedClass.click();
  const assignedContext = area.locator('[data-course-class-context="true"]');
  await expect(assignedContext).toContainText("Klassrad 2: Öppnad från banöversikten.");
  await expect(warningContext).toHaveCount(0);
  await expect(area.locator('table tbody tr[data-selected="true"]')).toContainText("Vald klassrad 2");
  await expect(area.locator('table tbody tr[data-selected="true"]')).toBeFocused();
  await expect(page.getByLabel("Klass för deltagargräns")).toHaveValue(classes[1]!.id);
  await expect(page.getByLabel("Klass för startupplägg")).toHaveValue(classes[1]!.id);
  await assignedContext.getByRole("button", { name: "Tillbaka till Banor" }).click();
  await expect(mobileCourseSelect).toHaveValue("COURSES");
  await expect(mobileCourseSelect).toBeFocused();
  await courseSummary.click();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: test.info().outputPath("courses-mobile.png"), fullPage: true });
  holdRosterResponse = true;
  await page.getByRole("button", { name: "Uppdatera underlag" }).click();
  await expect(mobileCourseSelect).toBeDisabled();
  await expect(assignedClass).toHaveCount(0);
  releaseRosterResponse?.();
  await expect(mobileCourseSelect).toBeEnabled();

  await page.setViewportSize({ width: 320, height: 740 });
  await expect(mobileCourseSelect.locator("option")).toHaveCount(7);
  await expect(mobileCourseSelect).toHaveValue("COURSES");
  expect((await mobileCourseSelect.boundingBox())?.height).toBeGreaterThanOrEqual(44);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await chooseWorkflow("DURING", "Under tävlingen");
  const duringSelect = page.getByRole("navigation", { name: "Tävlingsdagens arbetsytor" }).getByRole("combobox");
  await expect(duringSelect.locator("option")).toHaveCount(4);
  await expect(duringSelect).toHaveValue("OVERVIEW");
  await chooseWorkflow("BEFORE", "Före tävlingen");
  await expect(mobileCourseSelect).toHaveValue("COURSES");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

  await page.setViewportSize({ width: 768, height: 800 });
  await expect(page.getByRole("navigation", { name: "Arbetslägen" }).getByRole("button", { name: "Före tävlingen" })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Tävlingsförberedelser" }).getByRole("button", { name: "Banor" })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.setViewportSize({ width: 1280, height: 800 });
  await choosePreparation("OVERVIEW", "Upplägg");
  await expect(importLink).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: test.info().outputPath("preparation-import-desktop.png"), fullPage: true });
  await page.getByRole("navigation", { name: "Tävlingsförberedelser" })
    .getByRole("button", { name: "Klasser" }).click();
  const selectedPreparationTab = page.getByRole("navigation", { name: "Tävlingsförberedelser" })
    .getByRole("button", { name: "Klasser" });
  await expect(selectedPreparationTab).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
  await expect(selectedPreparationTab).toHaveCSS("border-bottom-color", "rgb(37, 40, 44)");
  await expect(rows).toHaveCount(60);
  await search.fill("Bana 12");
  await expect(rows).toHaveCount(5);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: test.info().outputPath("classes-desktop.png"), fullPage: true });
  expect((await rows.first().boundingBox())?.height).toBeLessThanOrEqual(50);
  await rows.getByRole("button", { name: "Visa 8 anmälda i klassrad 60: Klass 60" }).click();
  await expect(participantList).toBeFocused();
  await expect(participantList.getByLabel("Filtrera klass")).toHaveValue(classes[59]!.id);
  await expect(participantList.locator("tbody tr")).toHaveCount(8);
  await expect(page.locator('[data-panel="WORK"]').getByRole("region", { name: "Vald deltagare" })).toHaveCount(0);
  await chooseWorkflow("BEFORE", "Före tävlingen");
  await choosePreparation("CLASSES", "Klasser");
  await search.fill("Bana 12");
  await rows.getByRole("button", { name: "Välj klassrad 60: Klass 60 för inställningar" }).click();
  await expect(area.locator('table tbody tr[data-selected="true"]')).toContainText("Vald klassrad 60");
  await expect(area.locator('table tbody tr[data-selected="true"]')).toBeFocused();
  await expect(page.getByLabel("Klass för deltagargräns")).toHaveValue(classes[59]!.id);
  await expect(page.getByLabel("Klass för startupplägg")).toHaveValue(classes[59]!.id);
  await expect(area.locator('[data-course-class-context="true"]')).toHaveCount(0);
  await expect(warningContext).toHaveCount(0);
  await page.getByText("Deltagargränser per klass · Klass 60", { exact: true }).click();
  await page.getByLabel("Klass för deltagargräns").selectOption(classes[58]!.id);
  await expect(area.locator('table tbody tr[data-selected="true"]')).toHaveCount(0);
  await expect(page.getByLabel("Klass för startupplägg")).toHaveValue(classes[59]!.id);
  await rows.getByRole("button", { name: "Öppna tilldelad bana för klassrad 60: Klass 60 — Bana 12, version 1" }).click();
  await expect(targetedCourseDetails).toHaveAttribute("open", "");
  await expect(targetedCourseDetails.locator("summary")).toBeFocused();
  await choosePreparation("CLASSES", "Klasser");
  await expect(area).toBeVisible();
  await page.getByRole("navigation", { name: "Arbetslägen" })
    .getByRole("button", { name: "Översikt", exact: true }).click();
  const desktopLanding = page.getByRole("region", { name: "Tävlingsbild", exact: true });
  await expect(desktopLanding.locator("table tbody tr").first()).toContainText("Klass 31");
  await desktopLanding.getByRole("searchbox", { name: "Sök klass eller bana" }).fill("Bana 12");
  await expect(desktopLanding.locator("table tbody tr")).toHaveCount(5);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: test.info().outputPath("landing-overview-desktop.png"), fullPage: true });
  await page.getByRole("navigation", { name: "Arbetslägen" })
    .getByRole("button", { name: "Före tävlingen" }).click();
  await page.getByRole("navigation", { name: "Tävlingsförberedelser" })
    .getByRole("button", { name: "Banor" }).click();
  await expect(courseRows).toHaveCount(12);
  await expect(firstCourse.locator("ol")).toBeHidden();
  expect((await courseSummary.boundingBox())?.height).toBeGreaterThanOrEqual(44);
  expect((await assignedClass.boundingBox())?.height).toBeGreaterThanOrEqual(44);
  expect((await courseRows.first().boundingBox())?.height).toBeLessThanOrEqual(56);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: test.info().outputPath("courses-desktop.png"), fullPage: true });
  await courseSearch.fill("Klass 60");
  await expect(courseRows).toHaveCount(1);
  await expect(courseRows.first()).toContainText("Bana 12");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: test.info().outputPath("course-search-desktop.png"), fullPage: true });
  await courseSearch.clear();
  await expect(courseRows).toHaveCount(12);
  await courseSummary.click();
  await expect(firstCourse.locator("ol > li")).toHaveCount(18);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await coursePanel.screenshot({ path: test.info().outputPath("course-open-desktop.png") });
  await courseRows.first().getByRole("button", { name: "Öppna klassrad 2: Klass 02" }).click();
  await expect(assignedContext).toContainText("Öppnad från banöversikten.");
  await expect(area.locator('table tbody tr[data-selected="true"]')).toContainText("Vald klassrad 2");
  await expect(page.getByLabel("Klass för deltagargräns")).toHaveValue(classes[1]!.id);
  await expect(page.getByLabel("Klass för startupplägg")).toHaveValue(classes[1]!.id);
  await assignedContext.getByRole("button", { name: "Tillbaka till Banor" }).click();
  await expect(page.getByRole("navigation", { name: "Tävlingsförberedelser" }).getByRole("button", { name: "Banor" })).toBeFocused();
  const courseSetup = page.locator("details").filter({ has: page.getByText("Förbered bana och klass", { exact: true }) });
  await courseSetup.locator("summary").click();
  await courseSetup.getByLabel("Bannamn").fill("Provbana");
  await courseSetup.getByLabel("Klassnamn").fill("Provklass");
  await courseSetup.getByLabel("Kontrollföljd").fill("31, 32");
  await courseSetup.getByRole("button", { name: "Granska bana och klass" }).click();
  const neutralReview = courseSetup.getByRole("alert").filter({ hasText: "Granska före sparande" });
  await expect(neutralReview).toHaveCSS("background-color", "rgb(255, 255, 255)");
  await expect(neutralReview).toHaveCSS("border-left-color", "rgb(174, 183, 189)");
  await courseSetup.getByRole("button", { name: "Ändra uppgifter" }).click();
  await courseSetup.locator("summary").click();

  currentRoster = entryTransferCandidatesSchema.parse({ ...roster, snapshotVersion: 3,
    classes: roster.classes.map((row, index) => index >= 46 && index <= 49 ? {
      ...row, name: index <= 47 ? "Samma klass" : row.name,
      courseVersionId: id("30000000", 13), courseName: "Bana 13", courseVersion: 1,
    } : row) });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "Uppdatera underlag" }).click();
  const missingDetails = coursePanel.locator(":scope > details");
  const missingSummary = missingDetails.locator("summary");
  await expect(missingSummary).toContainText("4 klasser har tilldelade banversioner som saknas i det lästa banunderlaget.");
  await expect(missingSummary).toContainText("Visa berörda klasser");
  await courseSearch.fill("Samma klass");
  await expect(courseRows).toHaveCount(0);
  await expect(missingSummary).toContainText("4 klasser har tilldelade banversioner som saknas i det lästa banunderlaget.");
  await courseSearch.clear();
  await expect(courseRows).toHaveCount(12);
  expect((await missingSummary.boundingBox())?.height).toBeGreaterThanOrEqual(44);
  await missingSummary.click();
  const affectedRows = missingDetails.locator("li");
  await expect(affectedRows).toHaveCount(4);
  await expect(affectedRows.nth(0)).toContainText("Samma klass — Bana 13, version 1");
  await expect(affectedRows.nth(1)).toContainText("Samma klass — Bana 13, version 1");
  await expect(affectedRows.nth(2)).toContainText("Klass 49 — Bana 13, version 1");
  await expect(affectedRows.nth(3)).toContainText("Klass 50 — Bana 13, version 1");
  await expect(affectedRows.nth(0)).toContainText("Klassrad 47");
  await expect(affectedRows.nth(1)).toContainText("Klassrad 48");
  const secondDuplicate = affectedRows.nth(1).getByRole("button", {
    name: "Öppna klassrad 48: Samma klass — Bana 13, version 1",
  });
  expect((await secondDuplicate.boundingBox())?.height).toBeGreaterThanOrEqual(44);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  expect(await coursePanel.innerText()).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/);
  await coursePanel.screenshot({ path: test.info().outputPath("missing-courses-mobile.png") });

  await secondDuplicate.click();
  await expect(area).toBeVisible();
  await expect(area.locator('table tbody tr[data-selected="true"]')).toContainText("Vald klassrad 48");
  await expect(area.locator('table tbody tr[data-selected="true"]')).toContainText("Samma klass");
  await expect(warningContext).toHaveText(/Klassrad 48: Tilldelad banversion saknades i det lästa banunderlaget när klassen öppnades\./);
  expect(await area.innerText()).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/);
  await search.fill("finns inte");
  await expect(rows).toHaveCount(0);
  await search.clear();
  await expect(area.locator('table tbody tr[data-selected="true"]')).toContainText("Vald klassrad 48");
  const returnToCourses = warningContext.getByRole("button", { name: "Tillbaka till Banor" });
  expect((await returnToCourses.boundingBox())?.height).toBeGreaterThanOrEqual(44);
  await returnToCourses.click();
  await expect(mobileCourseSelect).toHaveValue("COURSES");
  await expect(mobileCourseSelect).toBeFocused();
  await missingDetails.locator("summary").click();
  const firstDuplicate = missingDetails.locator("li").nth(0).getByRole("button", {
    name: "Öppna klassrad 47: Samma klass — Bana 13, version 1",
  });
  await firstDuplicate.focus();
  await page.keyboard.press("Enter");
  await expect(area).toBeVisible();
  await expect(area.locator('table tbody tr[data-selected="true"]')).toContainText("Vald klassrad 47");
  await expect(warningContext).toContainText("Klassrad 47: Tilldelad banversion saknades i det lästa banunderlaget när klassen öppnades.");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: test.info().outputPath("selected-duplicate-class-mobile.png"), fullPage: true });
  await page.setViewportSize({ width: 1280, height: 800 });
  const coursesTab = page.getByRole("navigation", { name: "Tävlingsförberedelser" })
    .getByRole("button", { name: "Banor" });
  await expect(area.locator('table tbody tr[data-selected="true"]')).toContainText("Vald klassrad 47");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: test.info().outputPath("selected-duplicate-class-desktop.png"), fullPage: true });
  await warningContext.getByRole("button", { name: "Tillbaka till Banor" }).focus();
  await page.keyboard.press("Enter");
  await expect(coursesTab).toHaveAttribute("aria-pressed", "true");
  await expect(coursesTab).toBeFocused();
  await missingDetails.locator("summary").click();
  await missingDetails.locator("li").nth(0).getByRole("button", {
    name: "Öppna klassrad 47: Samma klass — Bana 13, version 1",
  }).click();
  await expect(warningContext).toHaveCount(1);
  await page.getByRole("button", { name: "Uppdatera underlag" }).click();
  await expect(warningContext).toHaveCount(0);
  await expect(area.locator('table tbody tr[data-selected="true"]')).toHaveCount(0);
  await coursesTab.click();

  await choosePreparation("CLASSES", "Klasser");
  await rows.nth(46).getByRole("button", {
    name: "Öppna tilldelad bana för klassrad 47: Samma klass — Bana 13, version 1",
  }).click();
  await expect(targetedCoursePanel.getByText("Den valda banversionen saknas i det lästa banunderlaget.", { exact: true })).toBeVisible();
  await expect(targetedCoursePanel.locator(":scope > ul > li > details[open]")).toHaveCount(0);

  currentRoster = entryTransferCandidatesSchema.parse({ ...roster, snapshotVersion: 4,
    classes: roster.classes.map((row) => row.id === id("20000000", 50) ? {
      ...row, courseVersionId: id("30000000", 10), courseName: "Bana 10", courseVersion: 1,
    } : row) });
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.getByRole("button", { name: "Uppdatera underlag" }).click();
  await expect(courseRows).toHaveCount(12);
  await expect(coursePanel.getByText(/banversioner? som saknas i det lästa banunderlaget/)).toHaveCount(0);
  courseUnavailable = true;
  await coursePanel.getByRole("button", { name: "Uppdatera", exact: true }).click();
  await expect(coursePanel.getByRole("status")).toHaveText("Banunderlaget kunde inte läsas.");
  await expect(coursePanel.getByText(/banversioner? som saknas i det lästa banunderlaget/)).toHaveCount(0);
  expect(unexpectedWriteRequests).toBe(0);
  await page.setViewportSize({ width: 390, height: 844 });
  await choosePreparation("CLASSES", "Klasser");
  const manualClassPanel = page.locator("details").filter({ has: page.getByText("Skapa klass på befintlig bana", { exact: true }) });
  await expect(manualClassPanel).not.toHaveAttribute("open");
  await manualClassPanel.locator("summary").click();
  await expect(manualClassPanel.getByLabel("Befintlig banversion").getByRole("option")).toHaveCount(13);
  await manualClassPanel.getByLabel("Nytt klassnamn").fill("H55 delad bana");
  await manualClassPanel.getByLabel("Befintlig banversion").selectOption(id("30000000", 1));
  await manualClassPanel.getByLabel("Startupplägg").selectOption("FIXED");
  await manualClassPanel.getByRole("button", { name: "Granska ny klass" }).click();
  await expect(manualClassPanel).toContainText("Bana 01, version 1 · klassrad 1");
  expect(manualClassRequests).toHaveLength(0);
  for (const control of await manualClassPanel.locator("input, select, button").all()) {
    expect((await control.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  }
  await expect(page.getByRole("navigation", { name: "Tävlingsförberedelser" }).getByRole("combobox")).toBeDisabled();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await manualClassPanel.screenshot({ path: test.info().outputPath("manual-class-review-mobile.png") });
  await manualClassPanel.getByRole("button", { name: "Bekräfta och skapa klass" }).click();
  await expect(manualClassPanel.getByText("Svaret saknas. Klassen kan vara sparad. Försök igen med exakt samma begäran.")).toBeVisible();
  await expect(manualClassPanel.getByLabel("Nytt klassnamn")).toBeDisabled();
  await expect(manualClassPanel.getByLabel("Befintlig banversion")).toBeDisabled();
  await expect(manualClassPanel.getByLabel("Startupplägg")).toBeDisabled();
  await expect(page.getByRole("navigation", { name: "Tävlingsförberedelser" }).getByRole("combobox")).toBeDisabled();
  expect(manualClassRequests).toHaveLength(1);
  expect(manualClassRequests[0]!.key).toMatch(/^manual-class-create:[0-9a-f-]{36}$/);
  await page.setViewportSize({ width: 1280, height: 800 });
  for (const control of await manualClassPanel.locator("input, select, button").all()) {
    expect((await control.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await manualClassPanel.screenshot({ path: test.info().outputPath("manual-class-retry-desktop.png") });
  await manualClassPanel.getByRole("button", { name: "Försök igen med samma begäran" }).click();
  await expect(manualClassPanel.getByLabel("Nytt klassnamn")).toHaveValue("");
  expect(manualClassRequests).toHaveLength(2);
  expect(manualClassRequests[1]).toEqual(manualClassRequests[0]);
  await expect(page.getByRole("button", { name: "Välj klassrad 61: H55 delad bana för inställningar", exact: true })).toBeVisible();
  await expect(manualClassPanel.getByLabel("Befintlig banversion").getByRole("option")).toHaveCount(13);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "Välj klassrad 61: H55 delad bana för inställningar", exact: true }).click();
  const classNamePanel = page.locator("details").filter({ has: page.getByText("Rätta klassnamn · H55 delad bana", { exact: true }) });
  await expect(classNamePanel).not.toHaveAttribute("open");
  await classNamePanel.locator("summary").click();
  await expect(classNamePanel.getByText("Nuvarande namn:")).toBeVisible();
  await expect(classNamePanel.getByLabel("Nytt klassnamn")).toHaveValue("H55 delad bana");
  await classNamePanel.getByLabel("Nytt klassnamn").fill("H55 rättad rubrik");
  await classNamePanel.getByRole("button", { name: "Granska namnändring" }).click();
  expect(classNameRequests).toHaveLength(0);
  await expect(classNamePanel).toContainText("H55 delad bana → H55 rättad rubrik");
  await expect(page.getByRole("navigation", { name: "Tävlingsförberedelser" }).getByRole("combobox")).toBeDisabled();
  for (const control of await classNamePanel.locator("input, button").all()) {
    expect((await control.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await classNamePanel.screenshot({ path: test.info().outputPath("class-name-review-mobile.png") });
  await page.setViewportSize({ width: 1280, height: 800 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await classNamePanel.screenshot({ path: test.info().outputPath("class-name-review-desktop.png") });
  await classNamePanel.getByRole("button", { name: "Bekräfta namnändring" }).click();
  await expect(page.getByRole("button", { name: "Välj klassrad 61: H55 rättad rubrik för inställningar", exact: true })).toBeVisible();
  expect(classNameRequests).toHaveLength(1);
  expect(classNameRequests[0]!.key).toMatch(/^manual-class-name:[0-9a-f-]{36}$/);
  expect(JSON.parse(classNameRequests[0]!.body)).toMatchObject({ expectedClassName: "H55 delad bana",
    className: "H55 rättad rubrik", expectedSnapshotVersion: 5 });
  expect(currentRoster.classes[60]!.id).toBe(id("20000000", 61));
  expect(currentRoster.classes[60]!.courseVersionId).toBe(id("30000000", 1));
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await choosePreparation("OVERVIEW", "Upplägg");
  await importLink.click();
  await expect(page).toHaveURL(new RegExp(`/admin/${raceId}/imports$`));
  await expect(page.getByRole("heading", { name: "Skyddad IOF-import" })).toBeVisible();
  await expect(page.getByRole("heading", { name: /Importera deltagare från/ })).toBeVisible();
});
