import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, readFile, realpath, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { DemoInstallationSchema, DemoSummarySchema } from "@o-tid/contracts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { createDatabase, schema } from "@o-tid/database";
import { provisionSyntheticDemo, type DemoInstallation } from "../../src/provision-synthetic-demo";

const base = process.env.TEST_DATABASE_URL;
if (!base) throw new Error("TEST_DATABASE_URL krävs");
const admin = createDatabase(base);
const targets: { name: string; pool: ReturnType<typeof createDatabase>["pool"] }[] = [];
beforeAll(async () => { await admin.pool.query("SELECT 1"); });
afterAll(async () => {
  for (const target of targets) {
    await target.pool.end();
    // Only databases created by this test process, with generated validated identifiers.
    if (!/^otid_demo_spec_[a-f0-9]{32}$/.test(target.name)) throw new Error("Invalid test database cleanup target");
    await admin.pool.query(`DROP DATABASE "${target.name}"`);
  }
  await admin.pool.end();
});
async function fixture() {
  const name = `otid_demo_spec_${randomUUID().replaceAll("-", "")}`;
  await admin.pool.query(`CREATE DATABASE "${name}"`);
  const url = new URL(base!); url.pathname = `/${name}`;
  const { db, pool } = createDatabase(url.href); targets.push({ name, pool });
  await migrate(db, { migrationsFolder: new URL("../../../database/migrations", import.meta.url).pathname });
  return { db, pool, input: { databaseUrl: url.href, environment: "test", confirmation: "synthetic-empty-database" } };
}

describe("TASK007 isolated synthetic demo provisioning", () => {
  it("runs the real CLI with private durable output, sanitized summary and no overwrite on retry", async () => {
    const f = await fixture(), directory = await mkdtemp(join(await realpath(tmpdir()), "otid-demo-cli-"));
    const output = join(directory, "credentials.json"), root = fileURLToPath(new URL("../../../../", import.meta.url));
    const args = [join(root, "node_modules/tsx/dist/cli.mjs"), join(root, "scripts/demo-provision.ts"),
      "--confirm", "synthetic-empty-database", "--private-output", output];
    try {
      const result = await promisify(execFile)(process.execPath, args, { cwd: root, env: { ...process.env, NODE_ENV: "test", DATABASE_URL: f.input.databaseUrl } });
      const privateBytes = await readFile(output, "utf8"), installation = DemoInstallationSchema.parse(JSON.parse(privateBytes));
      const summary = DemoSummarySchema.parse(JSON.parse(result.stdout));
      expect(summary.raceId).toBe(installation.raceId); expect(result.stderr).toBe("");
      expect((await stat(output)).mode & 0o777).toBe(0o600);
      for (const row of installation.credentials) expect(result.stdout).not.toContain(row.accessCredential);
      await expect(promisify(execFile)(process.execPath, args, { cwd: root, env: { ...process.env, NODE_ENV: "test", DATABASE_URL: f.input.databaseUrl } })).rejects.toMatchObject({ code: 1, stdout: "" });
      expect(await readFile(output, "utf8")).toBe(privateBytes);
      expect(await f.db.select().from(schema.events)).toHaveLength(1);
      expect(summary.paths.manage).toBe(`/admin/${summary.raceId}/manage`);
      expect(installation.credentials.map(row => row.capability)).toEqual([
        "VIEW_RACE_OVERVIEW", "START_CHECKIN", "FINISH_FOREST_WATCH", "MANAGE_RACE"
      ]);
    } finally { await rm(directory, { recursive: true }); }
  });
  it("rejects policy or actual target mismatch without writes or private output", async () => {
    const f = await fixture(); let called = false;
    const sink = async () => { called = true; };
    await expect(provisionSyntheticDemo(f.db, { ...f.input, confirmation: "" }, sink)).rejects.toThrow();
    const other = new URL(f.input.databaseUrl); other.pathname = "/otid_demo_wrong";
    await expect(provisionSyntheticDemo(f.db, { ...f.input, databaseUrl: other.href }, sink)).rejects.toThrow();
    expect(called).toBe(false); expect(await f.db.select().from(schema.events)).toHaveLength(0);
  });
  it("refuses a nonempty target rather than altering its existing competition", async () => {
    const f = await fixture();
    await f.db.insert(schema.events).values({ name: "Existing synthetic test", startsOn: "2026-09-06", timeZone: "Europe/Stockholm" });
    const before = await f.db.select().from(schema.events);
    await expect(provisionSyntheticDemo(f.db, f.input, async () => { throw new Error("Must not run"); })).rejects.toThrow();
    expect(await f.db.select().from(schema.events)).toEqual(before);
    expect(await f.db.select().from(schema.pairingAdminAccessCredentials)).toHaveLength(0);
  });
  it("rolls back nested imports and credentials on late private output failure and sanitizes error", async () => {
    const f = await fixture(); let sawCredentials = false;
    await expect(provisionSyntheticDemo(f.db, f.input, async value => {
      sawCredentials = value.credentials.length === 4;
      throw new Error("PRIVATE_SINK_SECRET");
    })).rejects.toThrow("Demoprovisionering kunde inte bekräftas");
    expect(sawCredentials).toBe(true);
    for (const table of [schema.events, schema.races, schema.entries, schema.pairingAdminAccessCredentials, schema.auditEvents]) {
      expect(await f.db.select().from(table)).toHaveLength(0);
    }
    await expect(provisionSyntheticDemo(f.db, f.input, async () => undefined)).resolves.toMatchObject({ formatVersion: 1 });
  });
  it("commits exactly one complete installation under competing provisioners without secret summary or audit", async () => {
    const f = await fixture(); const delivered: DemoInstallation[] = [];
    const sink = async (value: DemoInstallation) => { delivered.push(value); };
    const outcomes = await Promise.allSettled([provisionSyntheticDemo(f.db, f.input, sink), provisionSyntheticDemo(f.db, f.input, sink)]);
    expect(outcomes.filter(outcome => outcome.status === "fulfilled")).toHaveLength(1);
    expect(delivered).toHaveLength(1);
    expect(await f.db.select().from(schema.events)).toHaveLength(1);
    expect(await f.db.select().from(schema.entries)).toHaveLength(2);
    const rows = await f.db.select().from(schema.pairingAdminAccessCredentials);
    expect(rows).toHaveLength(4);
    expect(delivered[0]!.credentials.map(row => row.capability)).toEqual([
      "VIEW_RACE_OVERVIEW", "START_CHECKIN", "FINISH_FOREST_WATCH", "MANAGE_RACE"
    ]);
    const classes = await f.db.select().from(schema.classes);
    expect(classes.map(row => ({ name: row.name, startRule: row.startRule, maxEntries: row.maxEntries, capacityVersion: row.capacityVersion }))
      .sort((left, right) => left.name.localeCompare(right.name))).toEqual([
      { name: "D21", startRule: "FIXED", maxEntries: 2, capacityVersion: 1 },
      { name: "H21", startRule: "PUNCH", maxEntries: null, capacityVersion: 1 }
    ]);
    const entries = await f.db.select().from(schema.entries);
    expect(entries.map(row => ({ givenName: row.givenName, familyName: row.familyName, fixedStartTime: row.fixedStartTime?.toISOString() ?? null }))
      .sort((left, right) => left.givenName.localeCompare(right.givenName))).toEqual([
      { givenName: "Ada", familyName: "Löpare", fixedStartTime: null },
      { givenName: "Bo", familyName: "Skog", fixedStartTime: "2026-09-19T08:00:00.000Z" }
    ]);
    const publicEvidence = JSON.stringify({ outcomes, rows, audit: await f.db.select().from(schema.auditEvents) });
    for (const row of delivered[0]!.credentials) expect(publicEvidence).not.toContain(row.accessCredential);
    await expect(provisionSyntheticDemo(f.db, f.input, sink)).rejects.toThrow();
    expect(delivered).toHaveLength(1);
  });
});
