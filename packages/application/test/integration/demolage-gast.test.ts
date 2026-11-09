import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDatabase, migrate } from "@o-tid/database";
import { startGuestDemo, sweepGuestAccounts, GUEST_LIFETIME_MS } from "../../src/guest-demo";
import { authenticateUserAccountSession, logoutUserAccountSession } from "../../src/user-account";
import { createOrganizerEvent } from "../../src/organizer-events";
import { requireRaceRole } from "../../src/race-session";
import { setRacePublicationAsAdmin } from "../../src/race-publication";
import { createMapLinkAsAdmin } from "../../src/course-setting-map-link";
import { publicRaceAccess } from "../../src/public-race-visibility";
import { runMaintenance } from "../../src/retention";
import { registerTestAccount } from "./accounts";

/**
 * Demoläget del 2 (ägaren 2026-11-09, migration 0108): gästkontot får en övningstävling med påhittade löpare. Det släpps bara in
 * på sin tävling (och förhandsvisningen av den), inte på kontots sidor; det kan inte publicera eller dela kartlänken; spärr per
 * IP; efter ett dygn gäller sessionen inte och underhållet tar bort kontot med tävlingen.
 */
const base = process.env.TEST_DATABASE_URL;
if (!base) throw new Error("Testet kräver TEST_DATABASE_URL till en PostgreSQL-roll med CREATEDB");
const admin = createDatabase(base);
const databaseName = `otid_demogast_${randomUUID().replaceAll("-", "")}`;
const url = new URL(base);
url.pathname = `/${databaseName}`;
const { db, pool } = createDatabase(url.href);
const NOW = new Date("2026-11-09T12:00:00Z");

beforeAll(async () => {
  await admin.pool.query(`CREATE DATABASE "${databaseName}"`);
  await migrate(db, { migrationsFolder: new URL("../../../database/migrations", import.meta.url).pathname });
}, 60_000);
afterAll(async () => {
  await pool.end();
  if (!/^otid_demogast_[a-f0-9]{32}$/.test(databaseName)) throw new Error("Ogiltig testdatabas för rensning");
  await admin.pool.query(`DROP DATABASE "${databaseName}"`);
  await admin.pool.end();
});

const count = async (sql: string, values: unknown[]) => Number((await pool.query<{ n: string }>(sql, values)).rows[0]!.n);

describe("demoläget: gästkontot", () => {
  it("övningstävlingen, bara den egna tävlingen, inget utåt, och borta efter ett dygn", async () => {
    const started = await startGuestDemo(db, { clientKey: "203.0.113.7", now: NOW });
    if (started.status !== "created") throw new Error(started.status);
    expect(started.expiresAt.getTime() - NOW.getTime()).toBe(GUEST_LIFETIME_MS);
    expect(await count("select count(*) as n from entry where race_id = $1", [started.raceId])).toBe(10);
    expect(await count("select count(*) as n from race where id = $1 and published_at is null", [started.raceId])).toBe(1);
    const proof = { sessionToken: started.sessionToken, csrfCookie: started.csrfToken, csrfHeader: started.csrfToken };

    // Kontots sidor släpper inte in gästen; frågan "vem är inloggad?" gör det när den uttryckligen tillåter gäster.
    expect((await authenticateUserAccountSession(db, proof, NOW)).status).toBe("unauthorized");
    const who = await authenticateUserAccountSession(db, { ...proof, allowGuest: true }, NOW);
    if (who.status !== "authenticated") throw new Error(who.status);
    expect(who.principal.guestExpiresAt).toBe(started.expiresAt.toISOString());
    expect((await createOrganizerEvent(db, { ...proof, idempotencyKey: `organizer-event-create:${randomUUID()}`,
      readBody: async () => ({ formatVersion: 1, eventName: "Egen", raceName: "Egen", raceDate: "2026-11-09", timeZone: "Europe/Stockholm" }) },
    NOW)).status).toBe("unauthorized");

    // Den egna tävlingen: arbetsytan och förhandsvisningen, men ingen publicering och ingen kartlänk.
    const role = await requireRaceRole(db, { ...proof, raceId: started.raceId, role: "ADMIN" }, NOW);
    if (role.status !== "authenticated") throw new Error(role.status);
    expect(role.principal.guest).toBe(true);
    expect((await setRacePublicationAsAdmin(db, { ...proof, raceId: started.raceId, published: true }, NOW)).status).toBe("forbidden");
    expect((await setRacePublicationAsAdmin(db, { ...proof, raceId: started.raceId, published: false }, NOW)).status).toBe("saved");
    expect((await createMapLinkAsAdmin(db, { ...proof, raceId: started.raceId,
      request: { formatVersion: 1, lastDay: null, showRaceName: true } }, NOW)).status).toBe("forbidden");
    expect(await publicRaceAccess(db, started.raceId, started.sessionToken, NOW)).toBe("PREVIEW");

    // Ett vanligt konto påverkas inte av spärren eller städningen.
    const regular = await registerTestAccount(db, undefined, NOW);
    expect((await authenticateUserAccountSession(db, regular.proof, NOW)).status).toBe("authenticated");

    // Efter ett dygn gäller sessionen inte; underhållet tar bort kontot och tävlingen.
    const later = new Date(NOW.getTime() + GUEST_LIFETIME_MS + 60_000);
    expect((await requireRaceRole(db, { ...proof, raceId: started.raceId, role: "ADMIN" }, later)).status).toBe("unauthorized");
    const maintenance = await runMaintenance(db, { mode: "off", months: 24 }, later);
    expect(maintenance.guests).toBe(1);
    expect(await count("select count(*) as n from race where id = $1", [started.raceId])).toBe(0);
    expect(await count("select count(*) as n from user_account where guest_expires_at is not null", [])).toBe(0);
    expect((await authenticateUserAccountSession(db, regular.proof, later)).status).toBe("authenticated");
    expect(await sweepGuestAccounts(db, later)).toBe(0);
  }, 60_000);

  it("spärr per IP och timme; gästen kan logga ut", async () => {
    const first = await startGuestDemo(db, { clientKey: "198.51.100.4", guestsPerHour: 1, now: NOW });
    if (first.status !== "created") throw new Error(first.status);
    expect((await startGuestDemo(db, { clientKey: "198.51.100.4", guestsPerHour: 1, now: NOW })).status).toBe("rate-limited");
    expect((await startGuestDemo(db, { clientKey: "198.51.100.5", guestsPerHour: 1, now: NOW })).status).toBe("created");
    const proof = { sessionToken: first.sessionToken, csrfCookie: first.csrfToken, csrfHeader: first.csrfToken };
    expect((await logoutUserAccountSession(db, proof, NOW)).status).toBe("logged-out");
    expect((await requireRaceRole(db, { ...proof, raceId: first.raceId, role: "ADMIN" }, NOW)).status).toBe("unauthorized");
  }, 60_000);
});
