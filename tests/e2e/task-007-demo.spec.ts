import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, readFile, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test, expect } from "@playwright/test";
import { createDatabase, schema } from "@o-tid/database";
import { DemoInstallationSchema, DemoSummarySchema } from "@o-tid/contracts";
import { migrate } from "@o-tid/database";
import { validateDemoTarget } from "../../packages/application/src/demo-target-policy";

const databaseUrl = process.env.TEST_DATABASE_URL ?? "";
validateDemoTarget({ databaseUrl, environment: "test", confirmation: process.env.OTID_DEMO_TEST_CONFIRM ?? "" });
if (databaseUrl !== process.env.DATABASE_URL) throw new Error("Matching isolated demo databases required");
const { db, pool } = createDatabase(databaseUrl);
test.afterAll(async () => pool.end());

test("TASK007/TASK078 actual provisioning → administration → result → offline checkin", async ({ page, context, browser }, info) => {
  // The caller explicitly provides a new empty demo database; no reset or destructive cleanup.
  await migrate(db, { migrationsFolder: resolve("packages/database/migrations") });
  const privateDir = await mkdtemp(join(await realpath(tmpdir()), "otid-demo-browser-"));
  const root = resolve();
  const runCli = (script: string, args: string[]) => promisify(execFile)(process.execPath,
    [join(root, "node_modules/tsx/dist/cli.mjs"), join(root, "scripts", script), ...args],
    { cwd: root, env: { ...process.env, NODE_ENV: "test", DATABASE_URL: databaseUrl } });
  try {
    const output = join(privateDir, "credentials.json");
    const result = await runCli("demo-provision.ts", ["--confirm", "synthetic-empty-database", "--private-output", output]);
    const summary = DemoSummarySchema.parse(JSON.parse(result.stdout));
    const installation = DemoInstallationSchema.parse(JSON.parse(await readFile(output, "utf8")));
    expect(summary.raceId).toBe(installation.raceId);
    expect(summary.paths.manage).toBe(`/admin/${summary.raceId}/manage`);
    const credential = (capability: (typeof installation.credentials)[number]["capability"]) => {
      const row = installation.credentials.find(candidate => candidate.capability === capability);
      if (!row) throw new Error(`Missing ${capability} demo credential`);
      return row.accessCredential;
    };
    const classes = await db.select().from(schema.classes);
    const h21 = classes.find(candidate => candidate.name === "H21");
    const d21 = classes.find(candidate => candidate.name === "D21");
    if (!h21 || !d21) throw new Error("Synthetic demo classes missing");

    await page.goto(summary.paths.manage);
    await page.getByLabel("Administratörsbehörighet", { exact: true }).fill(credential("MANAGE_RACE"));
    await page.getByRole("button", { name: "Logga in", exact: true }).click();
    await page.getByRole("button", { name: "Deltagare", exact: true }).click();
    await page.getByLabel("Sök namn, klubb, klass eller bricka", { exact: true }).fill("Ada");
    await page.getByRole("button", { name: "Ada Löpare Centrum OK", exact: true }).click();
    await page.getByRole("combobox", { name: "Ny klass", exact: true }).selectOption(d21.id);
    await expect(page.getByText("Registrerade / gräns: 1 / 2", { exact: true })).toBeVisible();
    await page.getByLabel("Startdatum", { exact: true }).fill("2026-09-19");
    await page.getByLabel("Klockslag", { exact: true }).fill("10:05:00");
    await page.getByLabel("UTC-offset", { exact: true }).fill("+02:00");
    await page.getByRole("button", { name: "Granska klassbyte", exact: true }).click();
    await page.getByRole("button", { name: "Bekräfta klassbyte", exact: true }).click();
    await expect(page.getByRole("status")).toContainText("Klassbytet och starttiden är sparade.");

    // Restore the original mixed free/fixed-start demo before the readout flow.
    await page.getByRole("button", { name: "Klassbyte", exact: true }).click();
    await page.getByRole("combobox", { name: "Ny klass", exact: true }).selectOption(h21.id);
    await expect(page.getByLabel("Startdatum", { exact: true })).toHaveCount(0);
    await page.getByRole("button", { name: "Granska klassbyte", exact: true }).click();
    await page.getByRole("button", { name: "Bekräfta klassbyte", exact: true }).click();
    await expect(page.getByRole("status")).toContainText("Klassbytet och starttiden är sparade.");
    const entriesAfterAdministration = await db.select().from(schema.entries);
    expect(entriesAfterAdministration.find(entry => entry.givenName === "Ada")).toMatchObject({ classId: h21.id, fixedStartTime: null });
    expect(entriesAfterAdministration.find(entry => entry.givenName === "Bo")).toMatchObject({ classId: d21.id,
      fixedStartTime: new Date("2026-09-19T08:00:00.000Z") });

    await page.goto(summary.paths.simulator);
    const device = page.locator("small").filter({ hasText: "Enhet:" });
    await expect(device).toContainText(/[0-9a-f]{8}-[0-9a-f-]{27}/);
    const deviceId = (await device.innerText()).replace("Enhet: ", "").trim();
    const stationResult = await runCli("station-credential.ts", ["issue", "--device-id", deviceId, "--race-id", summary.raceId,
      "--expires-at", summary.expiresAt]);
    const station: unknown = JSON.parse(stationResult.stdout);
    if (!station || typeof station !== "object" || !("token" in station) || typeof station.token !== "string") throw new Error("Invalid station CLI output");
    await page.getByLabel("Stationscredential").fill(station.token);
    await page.getByLabel("Bricknummer", { exact: true }).fill("12345");
    await page.getByRole("button", { name: "Simulera och skicka", exact: true }).click();
    await expect(page.getByRole("status")).toContainText("stored");
    const publicContext = await browser.newContext({ baseURL: "http://127.0.0.1:3107" });
    try {
      const publicPage = await publicContext.newPage(); await publicPage.goto(summary.paths.results);
      await expect(publicPage.getByRole("row").filter({ hasText: "Ada Löpare" })).toContainText("Godkänd");
    } finally { await publicContext.close(); }

    await page.goto(summary.paths.checkin);
    await page.getByRole("button", { name: "Förbered offline-appskal", exact: true }).click();
    await expect(page.getByRole("status", { name: "Offline-appskal" })).toContainText("Appskal kontrollerat:");
    await page.getByRole("button", { name: "Kontrollera beständig lagring", exact: true }).click();
    await page.getByLabel("Loppets interna id").fill(summary.raceId);
    await page.getByLabel("Mobilens namn").fill("Syntetisk demo-start");
    await page.getByLabel("Personlig arbetsbehörighet", { exact: true }).fill(credential("START_CHECKIN"));
    const passphrase = "Syntetisk separat demonstrationsfras";
    await page.getByLabel("Separat lokal lösenfras (minst 16 tecken)").fill(passphrase);
    await page.getByLabel("Jag godkänner att den privata listan", { exact: false }).check();
    const risk = page.getByLabel("Jag accepterar den risken", { exact: false }); if (await risk.isVisible()) await risk.check();
    await page.getByRole("button", { name: "Förbered privat startlista", exact: true }).click();
    const bo = page.getByRole("article", { name: "Bo Skog" }); await expect(bo).toBeVisible();
    await context.setOffline(true); await page.getByLabel("Aktivera skrivläge", { exact: true }).check();
    await bo.getByRole("button", { name: "Markera startat", exact: true }).click();
    await expect(bo).toContainText("Väntar på serverkvittens: 1");
    await page.reload();
    const unlock = page.locator("form").filter({ has: page.getByRole("button", { name: "Lås upp lokal lista", exact: true }) });
    await unlock.getByLabel("Separat lokal lösenfras (minst 16 tecken)").fill(passphrase);
    await unlock.getByRole("button").click(); await expect(bo).toContainText("Väntar på serverkvittens: 1");
    await context.setOffline(false); await page.getByRole("button", { name: "Synka väntande markeringar", exact: true }).click();
    await expect(page.getByRole("status", { name: "Avprickning och synk" })).toContainText("Synk klar");
    await expect(bo).toContainText("Väntar på serverkvittens: 0");
    await page.goto(summary.paths.forestWatch);
    await page.getByLabel("Målpersonalens behörighet").fill(credential("FINISH_FOREST_WATCH"));
    await page.getByRole("button", { name: "Logga in", exact: true }).click();
    await expect(page.locator('[data-forest-group="STARTED_NO_RETURN"]')).toContainText("Bo Skog");
    await expect(page.locator('[data-forest-group="RETURNED"]')).toContainText("Ada Löpare");
    await page.emulateMedia({ media: "print" });
    await expect(page.getByRole("button", { name: "Skriv ut listan" })).toBeHidden();
    await expect(page.getByRole("region", { name: "Kvar i skogen – målpersonal" })).toContainText("garanterar inte att skogen är tom");
    await page.screenshot({ path: info.outputPath("demo-forest-print.png"), fullPage: true });
    expect(await db.select().from(schema.events)).toHaveLength(1);
    expect(await db.select().from(schema.entries)).toHaveLength(2);
    expect(await db.select().from(schema.rawDeviceMessages)).toHaveLength(1);
    expect(await db.select().from(schema.startCheckinOperations)).toHaveLength(1);
  } finally { await rm(privateDir, { recursive: true }); }
});
