import { randomUUID } from "node:crypto";
import { link, mkdir, mkdtemp, rm, stat, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDatabase, migrate } from "@o-tid/database";
import { createOrganizerEvent } from "../../src/organizer-events";
import { serverWatchSettings } from "../../src/server-report";
import {
  collectServerSnapshot, readHost, runServerWatch, superadminRecipients, type HostReadings, type ServerMessage
} from "../../src/server-status";
import { registerTestAccount } from "./accounts";

/**
 * ADR-0216: datainsamlingen till veckorapporten och larmen mot en riktig databas och riktiga kataloger (säkerhetskopiorna och
 * hälsokontrollens fil), och varvet som sparar mätningen, larmar en gång och skickar veckorapporten en gång.
 */
const base = process.env.TEST_DATABASE_URL;
if (!base) throw new Error("Testet kräver TEST_DATABASE_URL till en PostgreSQL-roll med CREATEDB");
const admin = createDatabase(base);
const databaseName = `otid_adr0216_${randomUUID().replaceAll("-", "")}`;
const url = new URL(base);
url.pathname = `/${databaseName}`;
const { db, pool } = createDatabase(url.href);
let dir = "";

beforeAll(async () => {
  await admin.pool.query(`CREATE DATABASE "${databaseName}"`);
  await migrate(db, { migrationsFolder: new URL("../../../database/migrations", import.meta.url).pathname });
  dir = await mkdtemp(join(tmpdir(), "otid-adr0216-"));
});
afterAll(async () => {
  await pool.end();
  if (!/^otid_adr0216_[a-f0-9]{32}$/.test(databaseName)) throw new Error("Ogiltig testdatabas för rensning");
  await admin.pool.query(`DROP DATABASE "${databaseName}"`);
  await admin.pool.end();
  if (dir) await rm(dir, { recursive: true, force: true });
});

const HOUR = 3_600_000;
const now = new Date();

describe("ADR-0216: serverrapporten och larmen", () => {
  it("samlar in databasen, säkerhetskopiorna och hälsokontrollen och larmar och rapporterar en gång", async () => {
    // Två superadmin (en spärrad, som inte får något) och en vanlig arrangör med en tävling om en vecka.
    const owner = await registerTestAccount(db);
    const superadmin = await registerTestAccount(db);
    const blocked = await registerTestAccount(db);
    await pool.query("update user_account set is_superadmin = true where id = any($1)", [[superadmin.accountId, blocked.accountId]]);
    await pool.query("update user_account set blocked_at = now() where id = $1", [blocked.accountId]);
    const raceDate = new Date(now.getTime() + 7 * 24 * HOUR).toISOString().slice(0, 10);
    const created = await createOrganizerEvent(db, { ...owner.proof, idempotencyKey: `organizer-event-create:${randomUUID()}`,
      readBody: async () => ({ formatVersion: 1, eventName: "Höstträningen", raceName: "Torsdag", raceDate, timeZone: "Europe/Stockholm",
        raceType: "STANDARD" }) });
    expect(created.status).toBe("created");
    expect(await superadminRecipients(db)).toEqual([superadmin.email]);

    // Säkerhetskopiorna: en timdump, samma dump som dagsbackup (hård länk, räknas en gång), kartinnehåll och en statusrad.
    const backups = join(dir, "backups"), status = join(dir, "status");
    await mkdir(join(backups, "hourly"), { recursive: true });
    await mkdir(join(backups, "daily"), { recursive: true });
    await mkdir(join(backups, "map-content"), { recursive: true });
    await mkdir(status, { recursive: true });
    const dump = join(backups, "hourly", "otid-2026-11-08T190000+0100.dump");
    await writeFile(dump, Buffer.alloc(3000));
    await link(dump, join(backups, "daily", "otid-2026-11-08.dump"));
    await writeFile(join(backups, "map-content", `${randomUUID()}.copy`), Buffer.alloc(5000));
    const old = new Date(now.getTime() - 5 * HOUR);
    await utimes(dump, old, old);
    const epoch = (date: Date) => Math.floor(date.getTime() / 1000);
    await writeFile(join(backups, ".backup-status"), `${epoch(old)}\tok\tBackup klar\n`);
    await writeFile(join(status, "monitor.log"), [30, 15, 1].map(minutes =>
      `${epoch(new Date(now.getTime() - minutes * 60_000))}\tfail\tpublic\tpublikens instans svarar inte (http://web-public:3000)`).join("\n") + "\n");

    const host = await readHost({ backupDir: backups, statusDir: status }, now);
    expect(host.backups).toMatchObject({ dumps: 1, dumpBytes: 3000, mapContentBytes: 5000, status: { ok: true } });
    expect(host.backups!.totalBytes).toBe(3000 + 5000 + (await stat(join(backups, ".backup-status"))).size);
    expect(host.backups!.newestAt!.getTime()).toBeCloseTo(old.getTime(), -4);
    expect(host.monitor).toHaveLength(3);
    expect(host.disk!.totalBytes).toBeGreaterThan(0);

    const snapshot = await collectServerSnapshot(db, host, now, {});
    expect(snapshot.counts).toMatchObject({ accounts: 3, accountsNew: 3, events: 1, races: 1, upcomingRaces: 1, upcomingPublished: 0,
      upcomingEntries: 0 });
    expect(snapshot.database.totalBytes).toBeGreaterThan(snapshot.database.mapBytes);
    expect(snapshot.maps).toEqual({ storedBytes: 0, quotaBytes: 20480 * 1024 * 1024 });

    // Första varvet: backupen är fem timmar gammal och hälsokontrollen har misslyckats tre gånger i rad (larm), veckorapporten
    // får bara sin tidpunkt.
    const sent: { message: ServerMessage; recipients: readonly string[] }[] = [];
    const send = async (message: ServerMessage, recipients: readonly string[]) => { sent.push({ message, recipients }); return recipients.length; };
    const settings = serverWatchSettings({});
    const quiet: HostReadings = { ...host, disk: { totalBytes: 100, freeBytes: 90 }, memory: { totalBytes: 100, availableBytes: 50 } };
    const first = await runServerWatch(db, { host: quiet, now, settings, serverName: "test", send, env: {} });
    expect(first.alerts.map(alert => alert.kind).sort()).toEqual(["BACKUP", "HEALTH"]);
    expect(first.report).toBe("baseline");
    expect(sent).toHaveLength(1);
    expect(sent[0]!.recipients).toEqual([superadmin.email]);
    expect(sent[0]!.message.subject).toBe("O-Tid test: larm – säkerhetskopian, hälsokontrollen");

    // En kvart senare: samma problem, inget nytt mejl. Sedan är backupen färsk: "löst" för den.
    const later = new Date(now.getTime() + 15 * 60_000);
    expect((await runServerWatch(db, { host: quiet, now: later, settings, serverName: "test", send, env: {} })).alerts).toEqual([]);
    const fresh: HostReadings = { ...quiet, backups: { ...quiet.backups!, newestAt: later } };
    const resolved = await runServerWatch(db, { host: fresh, now: new Date(later.getTime() + 60_000), settings, serverName: "test", send, env: {} });
    expect(resolved.alerts).toEqual([{ kind: "BACKUP", status: "RESOLVED" }]);
    expect(sent).toHaveLength(2);

    // Veckorapporten när tillfället har passerat sedan den förra (som om den senast gick för åtta dagar sedan); sedan inte igen.
    await pool.query("update server_notice set last_sent_at = $1 where kind = 'WEEKLY_REPORT'", [new Date(now.getTime() - 8 * 24 * HOUR)]);
    const week = new Date(later.getTime() + 2 * 60_000);
    expect((await runServerWatch(db, { host: fresh, now: week, settings, serverName: "test", send, env: {} })).report).toBe("sent");
    expect((await runServerWatch(db, { host: fresh, now: new Date(week.getTime() + 60_000), settings, serverName: "test", send, env: {} })).report)
      .toBe("not-due");
    const report = sent.at(-1)!.message;
    expect(report.subject).toMatch(/^O-Tid test: veckorapport vecka \d+/);
    expect(report.text).toContain("larm (säkerhetskopian)");
    expect(report.text).toContain("Kommande 14 dagar: 1 tävling (0 publicerade)");
    expect(report.text).toContain("1 dump ");
    expect(report.text).not.toContain(superadmin.email);

    const rows = await pool.query<{ samples: number; log: string[] }>(`select (select count(*)::int from server_sample) as samples,
      (select array_agg(kind || ':' || status order by sent_at, kind) from server_notice_log) as log`);
    expect(rows.rows[0]).toEqual({ samples: 5, log: ["BACKUP:ALERT", "HEALTH:ALERT", "BACKUP:RESOLVED", "WEEKLY_REPORT:REPORT"] });
  });

  it("ett misslyckat mejl rullar tillbaka varvet, så att larmet försöks igen", async () => {
    await pool.query("delete from server_notice; delete from server_notice_log; delete from server_sample");
    const host: HostReadings = { disk: { totalBytes: 100, freeBytes: 5 }, memory: null, load: null, backups: null, monitor: null };
    const settings = serverWatchSettings({});
    await expect(runServerWatch(db, { host, now, settings, serverName: "test", env: {},
      send: async () => { throw new Error("SMTP nere"); } })).rejects.toThrow("SMTP nere");
    expect((await pool.query("select count(*)::int as n from server_notice_log")).rows[0]).toEqual({ n: 0 });
    const retried = await runServerWatch(db, { host, now: new Date(now.getTime() + 60_000), settings, serverName: "test", env: {},
      send: async (_message, recipients) => recipients.length });
    expect(retried.alerts).toEqual([{ kind: "DISK", status: "ALERT" }]);
  });
});
