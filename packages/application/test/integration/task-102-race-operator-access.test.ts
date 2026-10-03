import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { and, eq } from "drizzle-orm";
import { createDatabase, schema } from "@o-tid/database";
import {
  createEvent, issuePairingAdminAccessCredential, issueRaceOperatorAccessAsAdministrator,
  listRaceOperatorAccessAsAdministrator, loginPairingAdmin, revokeRaceOperatorAccessAsAdministrator
} from "../../src";

const url = process.env.TEST_DATABASE_URL;
if (!url) throw new Error("TEST_DATABASE_URL krävs");
const { db, pool } = createDatabase(url);
const now = new Date("2026-09-20T10:00:00.000Z");

beforeAll(async () => migrate(db, { migrationsFolder: new URL("../../../database/migrations", import.meta.url).pathname }));
afterAll(async () => pool.end());

describe("TASK102 web-issued race operator access", () => {
  it("lets an administrator issue, list and revoke a start credential without retaining its secret", async () => {
    const { race } = await createEvent(db, { name: "TASK102 Synthetic", raceName: "Synthetic", raceDate: "2026-09-20", timeZone: "Europe/Stockholm" });
    const administrator = await issuePairingAdminAccessCredential(db, {
      raceId: race.id, capability: "MANAGE_RACE", label: "Synthetic issuer", expiresAt: new Date("2026-09-20T18:00:00.000Z")
    }, { now });
    const login = await loginPairingAdmin(db, { formatVersion: 1, accessCredential: administrator.accessCredential }, {
      expectedRaceId: race.id, expectedCapability: "MANAGE_RACE", now
    });
    if (login.status !== "authenticated") throw new Error("Synthetic administrator login failed");
    const proof = { raceId: race.id, sessionToken: login.sessionToken, csrfCookie: login.csrfToken, csrfHeader: login.csrfToken };
    const issued = await issueRaceOperatorAccessAsAdministrator(db, { ...proof, request: {
      formatVersion: 1, capability: "START_CHECKIN", label: "Startsyntet", expiresAt: "2026-09-20T14:00:00.000Z"
    } }, now);
    expect(issued.status).toBe("issued");
    if (issued.status !== "issued") throw new Error("Synthetic operator access was not issued");
    expect(issued.response.accessCredential).toMatch(/^otid_org_start_checkin_v1\./);
    expect(issued.response.access).toMatchObject({ raceId: race.id, capability: "START_CHECKIN", label: "Startsyntet", revokedAt: null });
    const listed = await listRaceOperatorAccessAsAdministrator(db, proof, now);
    expect(listed.status).toBe("ok");
    if (listed.status !== "ok") throw new Error("Synthetic operator access list unavailable");
    expect(listed.response.accesses).toEqual([issued.response.access]);
    expect(JSON.stringify(listed.response)).not.toContain(issued.response.accessCredential);
    const startLogin = await loginPairingAdmin(db, { formatVersion: 1, accessCredential: issued.response.accessCredential }, {
      expectedRaceId: race.id, expectedCapability: "START_CHECKIN", now
    });
    expect(startLogin.status).toBe("authenticated");
    const forbidden = await listRaceOperatorAccessAsAdministrator(db, {
      raceId: race.id, sessionToken: startLogin.status === "authenticated" ? startLogin.sessionToken : null
    }, now);
    expect(forbidden.status).toBe("forbidden");
    const revoked = await revokeRaceOperatorAccessAsAdministrator(db, { ...proof,
      request: { formatVersion: 1, credentialId: issued.response.access.credentialId } }, now);
    expect(revoked).toMatchObject({ status: "revoked", response: { status: "revoked", access: { revokedAt: now.toISOString() } } });
    expect((await loginPairingAdmin(db, { formatVersion: 1, accessCredential: issued.response.accessCredential }, {
      expectedRaceId: race.id, expectedCapability: "START_CHECKIN", now
    })).status).toBe("unauthorized");
    const audit = await db.select().from(schema.auditEvents).where(and(
      eq(schema.auditEvents.raceId, race.id), eq(schema.auditEvents.entityId, issued.response.access.credentialId)
    ));
    expect(audit.map((row) => [row.action, row.actorId])).toEqual(expect.arrayContaining([
      ["WEB_OPERATOR_ACCESS_ISSUED", administrator.credentialId], ["WEB_OPERATOR_ACCESS_REVOKED", administrator.credentialId]
    ]));
  });
});
