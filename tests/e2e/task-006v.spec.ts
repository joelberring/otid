import { randomUUID } from "node:crypto";
import { test, expect } from "@playwright/test";
import { eq } from "drizzle-orm";
import { createDatabase, schema } from "@o-tid/database";
import { createEventorConnection, createEventorRaceImportGrant, issueEventCreationAccessCredential,
  issuePairingAdminAccessCredential, importEventorEventAsAdmin,
  listEventorConnectionsAsAdmin, loginEventCreationAdmin, previewEventorImportAsAdmin } from "@o-tid/application";
import { fetchEventorEvent } from "../../packages/eventor/src/index";
import { eventorImportRoute } from "../../apps/web/src/lib/eventor-import-route";
import { eventorEntryImportCommitRoute, eventorEntryImportPreviewRoute } from "../../apps/web/src/lib/eventor-entry-import-route";

const url = process.env.TEST_DATABASE_URL;
if (!url) throw new Error("TEST_DATABASE_URL required");
const { db, pool } = createDatabase(url);
test.afterAll(async () => pool.end());

test("TASK 006V mobilgranskning och atomisk import med syntetisk upstream och same-id-retry", async ({ page }) => {
  const masterKey = new Uint8Array(32).fill(27);
  const credential = await issueEventCreationAccessCredential(db, { label: "Eventor E2E",
    expiresAt: new Date(Date.now() + 60 * 60 * 1000) });
  const connection = await createEventorConnection(db, { ownerCredentialId: credential.credentialId,
    label: "Syntetisk Testeventor", operatorLabel: "E2E fixture", keyId: "fixture-master",
    environment: "testeventor-se", apiKey: "SyntheticEventorKey-1234567890ab", masterKey });
  await createEventorConnection(db, { ownerCredentialId: credential.credentialId,
    label: "Syntetisk produktion", operatorLabel: "E2E fixture", keyId: "fixture-master",
    environment: "production-se", apiKey: "SyntheticEventorKey-1234567890ab", masterKey });
  const externalId = "fixture-" + randomUUID();
  const xml = `<Event><EventId>${externalId}</EventId><Name>Mobiltest Eventor</Name><StartDate><Date>2026-09-05</Date></StartDate>
    <EventRace><EventRaceId>first</EventRaceId><EventId>${externalId}</EventId><Name>Etapp ett</Name><RaceDate><Date>2026-09-05</Date></RaceDate></EventRace>
    <EventRace><EventRaceId>second</EventRaceId><EventId>${externalId}</EventId><Name>Etapp två</Name><RaceDate><Date>2026-09-06</Date></RaceDate></EventRace></Event>`;
  let fetches = 0; let dropCommit = true; const keys: string[] = [];
  // Real session/list routes, shared route security, application and PostgreSQL.
  // POST dispatch is hosted in this test to inject fake upstream only; no
  // production test mode, plaintext key endpoint or live Eventor call is added.
  await page.route(/\/api\/admin\/eventor-import(?:\/preview)?$/, async (route) => {
    if (route.request().method() === "GET") { await route.continue(); return; }
    const request = new Request(route.request().url(), { method: "POST", headers: await route.request().allHeaders(), body: route.request().postData() });
    const mode = request.url.endsWith("/preview") ? "preview" : "commit";
    if (mode === "commit") keys.push(request.headers.get("idempotency-key")!);
    const response = await eventorImportRoute(db, request, mode, {
      list: listEventorConnectionsAsAdmin, preview: previewEventorImportAsAdmin, commit: importEventorEventAsAdmin,
      runtime: { masterKeyFor: () => masterKey, fetchEvent: (input) => fetchEventorEvent(input, { fetch: async () => {
        fetches += 1; return new Response(xml, { headers: { "content-type": "application/xml" } });
      } }) },
    }, { NODE_ENV: "development", O_TID_PUBLIC_ORIGIN: "http://127.0.0.1:3000" });
    if (mode === "commit" && response.ok && dropCommit) { dropCommit = false; await route.abort("failed"); return; }
    await route.fulfill({ status: response.status, headers: Object.fromEntries(response.headers), body: await response.text() });
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/admin/events/eventor");
  await expect(page.getByRole("button", { name: "Logga in", exact: true })).toBeEnabled();
  await page.getByLabel("Skapandebehörighet").fill(credential.accessCredential);
  await page.getByRole("button", { name: "Logga in", exact: true }).click();
  await expect(page.getByRole("option", { name: "Syntetisk produktion · Eventor Sverige – produktion" })).toBeAttached();
  await page.getByLabel("Eventoranslutning").selectOption(connection.connectionId);
  await page.getByLabel("Eventors tävlings-id").fill(externalId);
  await page.getByRole("button", { name: "Hämta och granska" }).click();
  await expect(page.getByRole("heading", { name: "Mobiltest Eventor" })).toBeVisible();
  await page.getByLabel("Eventors tävlings-id").fill("another-search");
  await expect(page.getByRole("heading", { name: "Mobiltest Eventor" })).toHaveCount(0);
  await page.getByLabel("Eventors tävlings-id").fill(externalId);
  await page.getByRole("button", { name: "Hämta och granska" }).click();
  await expect(page.getByRole("heading", { name: "Mobiltest Eventor" })).toBeVisible();
  expect(await db.select().from(schema.eventorImportRequests).where(eq(schema.eventorImportRequests.externalEventId, externalId))).toHaveLength(0);
  await expect(page.getByLabel("Lopp att importera")).toHaveValue("");
  await page.getByLabel("Lopp att importera").selectOption("second");
  await page.getByLabel("Tidszon (IANA)").fill("Europe/Stockholm");
  const button = page.getByRole("button", { name: "Bekräfta och skapa tävling" });
  expect((await button.boundingBox())!.height).toBeGreaterThanOrEqual(52);
  await page.screenshot({ path: "test-results/task-006v-preview.png", fullPage: true });
  await button.click();
  await page.getByRole("button", { name: "Försök igen med samma id" }).click();
  await expect(page.getByRole("heading", { name: "Tävlingen har importerats." })).toBeVisible();
  expect(keys).toHaveLength(2); expect(keys[0]).toBe(keys[1]); expect(fetches).toBe(3);
  const journals = await db.select().from(schema.eventorImportRequests).where(eq(schema.eventorImportRequests.externalEventId, externalId));
  expect(journals).toHaveLength(1); expect(journals[0]!.raceName).toBe("Etapp två");
  expect(await db.select().from(schema.races).where(eq(schema.races.eventId, journals[0]!.eventId))).toHaveLength(1);
  expect(await page.evaluate(() => Object.keys(localStorage))).toEqual([]);
  await page.getByRole("button", { name: "Logga ut", exact: true }).click();
  await expect(page.getByLabel("Skapandebehörighet")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Tävlingen har importerats." })).toHaveCount(0);
});

test("TASK098 deltagarimportpanelen förhandsvisar D21 och återhämtar tappat svar med samma idempotency key", async ({ page }) => {
  const masterKey = new Uint8Array(32).fill(31);
  const owner = await issueEventCreationAccessCredential(db, { label: "TASK098 owner", expiresAt: new Date(Date.now() + 3600000) });
  const connection = await createEventorConnection(db, { ownerCredentialId: owner.credentialId, label: "TASK098 synthetic",
    operatorLabel: "E2E fixture", environment: "testeventor-se", keyId: "fixture-master", apiKey: "SyntheticEventorKey-1234567890ab", masterKey });
  const eventId = "fixture-" + randomUUID();
  const ownerLogin = await loginEventCreationAdmin(db, { formatVersion: 1, accessCredential: owner.accessCredential });
  if (ownerLogin.status !== "authenticated") throw new Error("TASK098 owner login failed");
  const projection = { eventId, eventName: "TASK098 tävling", startDate: "2026-09-05", races: [{ eventRaceId: "race", raceName: "TASK098 lopp", raceDate: "2026-09-05" }] };
  const event = await importEventorEventAsAdmin(db, { sessionToken: ownerLogin.sessionToken, csrfCookie: ownerLogin.csrfToken, csrfHeader: ownerLogin.csrfToken,
    idempotencyKey: `eventor-import:${randomUUID()}`, readBody: async () => ({ formatVersion: 1, connectionId: connection.connectionId,
      eventId, eventRaceId: "race", timeZone: "Europe/Stockholm", sourceHash: "a".repeat(64) }) },
    { masterKeyFor: () => masterKey, fetchEvent: async () => ({ projection, sourceHash: "a".repeat(64) }) });
  if (event.status !== "created") throw new Error("TASK098 race setup failed");
  const raceId = event.response.raceId;
  const courseId = randomUUID(), courseVersionId = randomUUID(), classId = randomUUID();
  await pool.query("INSERT INTO course(id,race_id,name) VALUES($1,$2,'TASK098 course')", [courseId, raceId]);
  await pool.query("INSERT INTO course_version(id,course_id,version) VALUES($1,$2,1)", [courseVersionId, courseId]);
  await pool.query("INSERT INTO class(id,race_id,name,course_version_id) VALUES($1,$2,'D21',$3)", [classId, raceId, courseVersionId]);
  const [provenance] = await db.select().from(schema.eventorImportRequests).where(eq(schema.eventorImportRequests.requestId, event.response.requestId));
  if (!provenance) throw new Error("TASK098 provenance missing");
  const recipient = await issuePairingAdminAccessCredential(db, { raceId, capability: "IMPORT_IOF", label: "TASK098 recipient", expiresAt: new Date(Date.now() + 3600000) });
  const grant = await createEventorRaceImportGrant(db, { eventorImportRequestId: provenance.requestId, ownerCredentialId: owner.credentialId,
    recipientCredentialId: recipient.credentialId, label: "TASK098 grant", operatorLabel: "E2E fixture" });
  const source = { projection: { classes: [{ externalId: "D21", name: "D21" }], entries: [{ externalId: "entry-1", externalClassId: "D21", givenName: "Ada", familyName: "Synthetic" }] }, eventClassesSourceHash: "b".repeat(64), entriesSourceHash: "c".repeat(64) };
  const keys: string[] = []; let drop = true;
  await page.route(new RegExp(`/api/admin/races/${raceId}/eventor-entry-import(?:/preview)?$`), async (route) => {
    const headers = new Headers(await route.request().allHeaders());
    // The browser holds HttpOnly session cookies, but Playwright's dispatched
    // handler request omits them. Copying the browser jar preserves the real
    // session proof while the upstream source itself remains synthetic.
    headers.set("cookie", (await page.context().cookies()).map(({ name, value }) => `${name}=${value}`).join("; "));
    const request = new Request(route.request().url(), { method: "POST", headers, body: route.request().postData() });
    const preview = request.url.endsWith("/preview");
    if (!preview) keys.push(request.headers.get("idempotency-key")!);
    const response = preview ? await eventorEntryImportPreviewRoute(db, request, raceId, undefined, { masterKeyFor: () => masterKey, fetchEntryImport: async () => source }, { NODE_ENV: "development", O_TID_PUBLIC_ORIGIN: "http://127.0.0.1:3000" }) : await eventorEntryImportCommitRoute(db, request, raceId, undefined, { masterKeyFor: () => masterKey, fetchEntryImport: async () => source }, { NODE_ENV: "development", O_TID_PUBLIC_ORIGIN: "http://127.0.0.1:3000" });
    if (!preview && response.ok && drop) { drop = false; await route.abort("failed"); return; }
    const body = await response.text();
    if (preview && !response.ok) throw new Error(`TASK098 preview returned ${response.status}: ${body}`);
    await route.fulfill({ status: response.status, headers: Object.fromEntries(response.headers), body });
  });
  await page.goto(`/admin/${raceId}/imports`);
  await page.getByLabel("Accesscredential för import").fill(recipient.accessCredential);
  const loginResponse = page.waitForResponse((response) => response.url().endsWith(`/api/admin/races/${raceId}/import-session`) && response.request().method() === "POST");
  await page.getByRole("button", { name: "Logga in säkert", exact: true }).click();
  await loginResponse;
  await page.getByLabel("Importbidragets UUID").fill(grant.grantId);
  await page.getByRole("button", { name: "Hämta förhandsvisning" }).click();
  await expect(page.getByText("D21 (1)")).toBeVisible();
  await page.getByLabel(/D21 \(1\)/).selectOption(classId);
  await page.getByRole("button", { name: "Importera deltagare" }).click();
  await page.getByRole("button", { name: "Försök igen med samma id" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Deltagarna är importerade" })).toContainText("Deltagarna är importerade");
  expect(keys).toHaveLength(2); expect(keys[0]).toBe(keys[1]);
  expect(await db.select().from(schema.entries).where(eq(schema.entries.raceId, raceId))).toHaveLength(1);
});
