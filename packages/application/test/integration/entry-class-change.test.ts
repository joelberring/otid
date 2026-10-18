import { describe, expect, it } from "vitest";
import { and, count, eq } from "drizzle-orm";
import { schema } from "@o-tid/database";
import { changeEntryClassAsAdmin, listEntryClassesAsAdmin } from "../../src";
import {
  authenticatePairingAdminSession, issuePairingAdminAccessCredential, loginPairingAdmin,
  logoutPairingAdminSession, revokePairingAdminAccessCredential
} from "../../src/pairing-admin";
import { db, importedRace, useRaceDatabase } from "./race-fixtures";

useRaceDatabase();

describe("TASK 005H autentiserad deltagarklassändring PostgreSQL", () => {
  const issuedAt = new Date("2026-08-31T18:00:00.000Z");
  const usedAt = new Date("2026-08-31T18:02:00.000Z");

  async function classAdmin(raceId: string, marker: number) {
    const installation = await issuePairingAdminAccessCredential(db, {
      raceId,
      capability: "CHANGE_ENTRY_CLASS",
      label: `Klassadministratör ${marker}`,
      expiresAt: new Date(issuedAt.getTime() + 8 * 60 * 60 * 1000)
    }, { now: issuedAt, secretBytes: Buffer.alloc(32, marker) });
    const login = await loginPairingAdmin(db, {
      formatVersion: 1,
      accessCredential: installation.accessCredential
    }, {
      expectedRaceId: raceId,
      expectedCapability: "CHANGE_ENTRY_CLASS",
      now: new Date("2026-08-31T18:01:00.000Z"),
      sessionSecretBytes: Buffer.alloc(32, marker + 1),
      csrfSecretBytes: Buffer.alloc(32, marker + 2)
    });
    if (login.status !== "authenticated") throw new Error("Klassadministratörssession kunde inte skapas");
    return { installation, login };
  }

  function changeInput(
    raceId: string,
    login: Awaited<ReturnType<typeof classAdmin>>["login"],
    entryId: string,
    requestId: string,
    classId: string,
    expectedEntryVersion: number
  ) {
    if (login.status !== "authenticated") throw new Error("Klassadministratörssession saknas");
    return {
      sessionToken: login.sessionToken,
      raceId,
      csrfCookie: login.csrfToken,
      csrfHeader: login.csrfToken,
      entryId,
      idempotencyKey: `entry-class-change:${requestId}`,
      request: { formatVersion: 1, classId, expectedEntryVersion }
    };
  }

  async function classFixture() {
    const { raceId, overview } = await importedRace();
    const ada = overview.entries.find((entry) => entry.givenName === "Ada");
    const h21 = overview.classes.find((raceClass) => raceClass.name === "H21");
    const d21 = overview.classes.find((raceClass) => raceClass.name === "D21");
    if (!ada || !h21 || !d21) throw new Error("Fixture saknar Ada, H21 eller D21");
    const [entry] = await db.select().from(schema.entries).where(eq(schema.entries.id, ada.id));
    const [race] = await db.select().from(schema.races).where(eq(schema.races.id, raceId));
    if (!entry || !race) throw new Error("Fixture saknar deltagare eller lopp");
    return { raceId, ada, h21, d21, entry, race };
  }

  it("separerar prefix, capability, race och livslängd samt listar endast minsta DTO", async () => {
    const fixture = await classFixture();
    const other = await classFixture();
    const admin = await classAdmin(fixture.raceId, 211);
    expect(admin.installation.accessCredential).toMatch(/^otid_org_entry_class_v1\./);
    expect(admin.login.response).toEqual({
      formatVersion: 1,
      raceId: fixture.raceId,
      capability: "CHANGE_ENTRY_CLASS",
      expiresAt: "2026-08-31T19:01:00.000Z"
    });

    const issueAudits = await db.select().from(schema.auditEvents).where(and(
      eq(schema.auditEvents.entityId, admin.installation.credentialId),
      eq(schema.auditEvents.action, "ENTRY_CLASS_ACCESS_CREDENTIAL_ISSUED")
    ));
    expect(issueAudits).toHaveLength(1);
    expect(issueAudits[0]?.entityType).toBe("entry_class_access_credential");
    await expect(authenticatePairingAdminSession(db, {
      sessionToken: admin.login.sessionToken,
      raceId: fixture.raceId,
      capability: "IMPORT_IOF"
    }, usedAt)).resolves.toEqual({ status: "forbidden" });
    await expect(loginPairingAdmin(db, {
      formatVersion: 1,
      accessCredential: admin.installation.accessCredential
    }, {
      expectedRaceId: other.raceId,
      expectedCapability: "CHANGE_ENTRY_CLASS",
      now: usedAt
    })).resolves.toEqual({ status: "unauthorized" });
    await expect(issuePairingAdminAccessCredential(db, {
      raceId: fixture.raceId,
      capability: "CHANGE_ENTRY_CLASS",
      label: "För lång",
      expiresAt: new Date(issuedAt.getTime() + 8 * 60 * 60 * 1000 + 1)
    }, { now: issuedAt })).rejects.toThrow(/högst 8 timmar/);

    const listed = await listEntryClassesAsAdmin(db, {
      sessionToken: admin.login.sessionToken,
      raceId: fixture.raceId
    }, usedAt);
    expect(listed.status).toBe("ok");
    if (listed.status !== "ok") throw new Error("Klasslistan kunde inte läsas");
    expect(listed.response).toMatchObject({
      formatVersion: 1,
      raceId: fixture.raceId,
      snapshotVersion: fixture.race.snapshotVersion,
      classes: [{ name: "D21" }, { name: "H21" }]
    });
    const listedAda = listed.response.entries.find((entry) => entry.id === fixture.ada.id);
    expect(listedAda).toEqual({
      id: fixture.ada.id,
      displayName: "Ada Löpare",
      organisationName: "Centrum OK",
      classId: fixture.h21.id,
      version: fixture.entry.version
    });
    expect(Object.keys(listedAda ?? {}).sort()).toEqual([
      "classId", "displayName", "id", "organisationName", "version"
    ]);
  });

  it("committar 100 samtidiga exakta requests exakt en gång utan resultatrevision", async () => {
    const fixture = await classFixture();
    const admin = await classAdmin(fixture.raceId, 221);
    const requestId = crypto.randomUUID();
    const input = changeInput(
      fixture.raceId, admin.login, fixture.ada.id, requestId, fixture.d21.id, fixture.entry.version
    );
    const beforeResults = await db.select({ value: count() }).from(schema.resultRevisions)
      .where(eq(schema.resultRevisions.raceId, fixture.raceId));
    const results = await Promise.all(Array.from(
      { length: 100 },
      () => changeEntryClassAsAdmin(db, input, usedAt)
    ));
    expect(results.filter((result) => result.status === "changed")).toHaveLength(100);
    expect(results.filter((result) => result.status === "changed" && !result.response.replayed)).toHaveLength(1);
    expect(results.filter((result) => result.status === "changed" && result.response.replayed)).toHaveLength(99);

    const [entry] = await db.select().from(schema.entries).where(eq(schema.entries.id, fixture.ada.id));
    const [race] = await db.select().from(schema.races).where(eq(schema.races.id, fixture.raceId));
    const requests = await db.select().from(schema.entryClassChangeRequests)
      .where(eq(schema.entryClassChangeRequests.requestId, requestId));
    const audits = await db.select().from(schema.auditEvents).where(and(
      eq(schema.auditEvents.raceId, fixture.raceId),
      eq(schema.auditEvents.action, "ENTRY_CLASS_CHANGED_BY_ADMIN")
    ));
    const afterResults = await db.select({ value: count() }).from(schema.resultRevisions)
      .where(eq(schema.resultRevisions.raceId, fixture.raceId));
    expect({
      classId: entry?.classId,
      entryVersion: entry?.version,
      snapshotVersion: race?.snapshotVersion,
      requests: requests.length,
      audits: audits.length,
      resultRevisions: afterResults[0]?.value
    }).toEqual({
      classId: fixture.d21.id,
      entryVersion: fixture.entry.version + 1,
      snapshotVersion: fixture.race.snapshotVersion + 1,
      requests: 1,
      audits: 1,
      resultRevisions: beforeResults[0]?.value
    });
    expect(audits[0]).toMatchObject({
      entityType: "entry",
      entityId: fixture.ada.id,
      actorKind: "ENTRY_CLASS_ACCESS_CREDENTIAL",
      actorId: admin.installation.credentialId,
      requestId,
      before: {
        classId: fixture.h21.id,
        entryVersion: fixture.entry.version,
        snapshotVersion: fixture.race.snapshotVersion
      },
      after: {
        classId: fixture.d21.id,
        entryVersion: fixture.entry.version + 1,
        snapshotVersion: fixture.race.snapshotVersion + 1
      }
    });
    const auditJson = JSON.stringify(audits);
    expect(auditJson).not.toContain("Ada");
    expect(auditJson).not.toContain("Löpare");
    expect(auditJson).not.toContain("Centrum OK");
    expect(auditJson).not.toContain(admin.installation.accessCredential);
    expect(auditJson).not.toContain(admin.login.sessionToken);
    expect(auditJson).not.toContain(admin.login.csrfToken);
    await expect(db.update(schema.entryClassChangeRequests).set({ classId: fixture.h21.id })
      .where(eq(schema.entryClassChangeRequests.requestId, requestId))).rejects.toThrow();
    await expect(db.delete(schema.entryClassChangeRequests)
      .where(eq(schema.entryClassChangeRequests.requestId, requestId))).rejects.toThrow();
  });

  it("avvisar no-op, stale version och objekt från annat lopp atomärt", async () => {
    const fixture = await classFixture();
    const other = await classFixture();
    const admin = await classAdmin(fixture.raceId, 231);
    const beforeRequests = await db.select({ value: count() }).from(schema.entryClassChangeRequests)
      .where(eq(schema.entryClassChangeRequests.raceId, fixture.raceId));
    const beforeAudits = await db.select({ value: count() }).from(schema.auditEvents).where(and(
      eq(schema.auditEvents.raceId, fixture.raceId),
      eq(schema.auditEvents.action, "ENTRY_CLASS_CHANGED_BY_ADMIN")
    ));
    const cases = [
      changeInput(fixture.raceId, admin.login, fixture.ada.id, crypto.randomUUID(), fixture.h21.id, fixture.entry.version),
      changeInput(fixture.raceId, admin.login, fixture.ada.id, crypto.randomUUID(), fixture.d21.id, fixture.entry.version + 1)
    ];
    for (const input of cases) {
      await expect(changeEntryClassAsAdmin(db, input, usedAt)).resolves.toEqual({ status: "conflict" });
    }
    await expect(changeEntryClassAsAdmin(db, changeInput(
      fixture.raceId, admin.login, other.ada.id, crypto.randomUUID(), fixture.d21.id, other.entry.version
    ), usedAt)).resolves.toEqual({ status: "not-found" });
    await expect(changeEntryClassAsAdmin(db, changeInput(
      fixture.raceId, admin.login, fixture.ada.id, crypto.randomUUID(), other.d21.id, fixture.entry.version
    ), usedAt)).resolves.toEqual({ status: "not-found" });

    const [entry] = await db.select().from(schema.entries).where(eq(schema.entries.id, fixture.ada.id));
    const [race] = await db.select().from(schema.races).where(eq(schema.races.id, fixture.raceId));
    const afterRequests = await db.select({ value: count() }).from(schema.entryClassChangeRequests)
      .where(eq(schema.entryClassChangeRequests.raceId, fixture.raceId));
    const afterAudits = await db.select({ value: count() }).from(schema.auditEvents).where(and(
      eq(schema.auditEvents.raceId, fixture.raceId),
      eq(schema.auditEvents.action, "ENTRY_CLASS_CHANGED_BY_ADMIN")
    ));
    expect({
      classId: entry?.classId,
      entryVersion: entry?.version,
      snapshotVersion: race?.snapshotVersion,
      requests: afterRequests[0]?.value,
      audits: afterAudits[0]?.value
    }).toEqual({
      classId: fixture.entry.classId,
      entryVersion: fixture.entry.version,
      snapshotVersion: fixture.race.snapshotVersion,
      requests: beforeRequests[0]?.value,
      audits: beforeAudits[0]?.value
    });
  });

  it("låter två olika request-id med samma expected version ge exakt en vinnare", async () => {
    const fixture = await classFixture();
    const admin = await classAdmin(fixture.raceId, 241);
    const results = await Promise.all([
      changeEntryClassAsAdmin(db, changeInput(
        fixture.raceId, admin.login, fixture.ada.id, crypto.randomUUID(), fixture.d21.id, fixture.entry.version
      ), usedAt),
      changeEntryClassAsAdmin(db, changeInput(
        fixture.raceId, admin.login, fixture.ada.id, crypto.randomUUID(), fixture.d21.id, fixture.entry.version
      ), usedAt)
    ]);
    expect(results.filter((result) => result.status === "changed")).toHaveLength(1);
    expect(results.filter((result) => result.status === "conflict")).toHaveLength(1);
    const requests = await db.select().from(schema.entryClassChangeRequests)
      .where(eq(schema.entryClassChangeRequests.raceId, fixture.raceId));
    expect(requests).toHaveLength(1);
  });

  it("replayar originalsvaret efter senare ändring men binder request till exakt actor och kontext", async () => {
    const fixture = await classFixture();
    const otherRace = await classFixture();
    const firstAdmin = await classAdmin(fixture.raceId, 251);
    const otherAdmin = await classAdmin(fixture.raceId, 261);
    const otherRaceAdmin = await classAdmin(otherRace.raceId, 262);
    const firstRequestId = crypto.randomUUID();
    const firstInput = changeInput(
      fixture.raceId, firstAdmin.login, fixture.ada.id, firstRequestId, fixture.d21.id, fixture.entry.version
    );
    const first = await changeEntryClassAsAdmin(db, firstInput, usedAt);
    expect(first).toMatchObject({ status: "changed", response: { replayed: false, classId: fixture.d21.id } });
    const second = await changeEntryClassAsAdmin(db, changeInput(
      fixture.raceId,
      firstAdmin.login,
      fixture.ada.id,
      crypto.randomUUID(),
      fixture.h21.id,
      fixture.entry.version + 1
    ), new Date(usedAt.getTime() + 1));
    expect(second).toMatchObject({ status: "changed", response: { replayed: false, classId: fixture.h21.id } });
    const replay = await changeEntryClassAsAdmin(db, firstInput, new Date(usedAt.getTime() + 2));
    expect(replay).toEqual(first.status === "changed"
      ? { status: "changed", response: { ...first.response, replayed: true } }
      : first);
    await expect(changeEntryClassAsAdmin(db, changeInput(
      fixture.raceId,
      otherAdmin.login,
      fixture.ada.id,
      firstRequestId,
      fixture.d21.id,
      fixture.entry.version
    ), new Date(usedAt.getTime() + 3))).resolves.toEqual({ status: "conflict" });
    await expect(changeEntryClassAsAdmin(db, changeInput(
      fixture.raceId,
      firstAdmin.login,
      crypto.randomUUID(),
      firstRequestId,
      fixture.d21.id,
      fixture.entry.version
    ), new Date(usedAt.getTime() + 4))).resolves.toEqual({ status: "conflict" });
    await expect(changeEntryClassAsAdmin(db, changeInput(
      fixture.raceId,
      firstAdmin.login,
      fixture.ada.id,
      firstRequestId,
      fixture.h21.id,
      fixture.entry.version
    ), new Date(usedAt.getTime() + 5))).resolves.toEqual({ status: "conflict" });
    await expect(changeEntryClassAsAdmin(db, changeInput(
      fixture.raceId,
      firstAdmin.login,
      fixture.ada.id,
      firstRequestId,
      fixture.d21.id,
      fixture.entry.version + 1
    ), new Date(usedAt.getTime() + 6))).resolves.toEqual({ status: "conflict" });
    await expect(changeEntryClassAsAdmin(db, changeInput(
      otherRace.raceId,
      otherRaceAdmin.login,
      otherRace.ada.id,
      firstRequestId,
      otherRace.d21.id,
      otherRace.entry.version
    ), new Date(usedAt.getTime() + 7))).resolves.toEqual({ status: "conflict" });
  });

  it("stoppar mutation efter capability-säker logout och revocation", async () => {
    const fixture = await classFixture();
    const loggedOut = await classAdmin(fixture.raceId, 271);
    await expect(logoutPairingAdminSession(db, {
      sessionToken: loggedOut.login.sessionToken,
      raceId: fixture.raceId,
      capability: "IMPORT_IOF",
      csrfCookie: loggedOut.login.csrfToken,
      csrfHeader: loggedOut.login.csrfToken
    }, usedAt)).resolves.toEqual({ status: "forbidden" });
    await expect(logoutPairingAdminSession(db, {
      sessionToken: loggedOut.login.sessionToken,
      raceId: fixture.raceId,
      capability: "CHANGE_ENTRY_CLASS",
      csrfCookie: loggedOut.login.csrfToken,
      csrfHeader: loggedOut.login.csrfToken
    }, usedAt)).resolves.toEqual({ status: "logged-out" });
    await expect(changeEntryClassAsAdmin(db, changeInput(
      fixture.raceId,
      loggedOut.login,
      fixture.ada.id,
      crypto.randomUUID(),
      fixture.d21.id,
      fixture.entry.version
    ), usedAt)).resolves.toEqual({ status: "unauthorized" });

    const revoked = await classAdmin(fixture.raceId, 281);
    await expect(revokePairingAdminAccessCredential(db, {
      credentialId: revoked.installation.credentialId,
      capability: "IMPORT_IOF"
    }, usedAt)).rejects.toThrow(/finns inte/);
    await expect(revokePairingAdminAccessCredential(db, {
      credentialId: revoked.installation.credentialId,
      capability: "CHANGE_ENTRY_CLASS"
    }, usedAt)).resolves.toMatchObject({ status: "revoked" });
    await expect(changeEntryClassAsAdmin(db, changeInput(
      fixture.raceId,
      revoked.login,
      fixture.ada.id,
      crypto.randomUUID(),
      fixture.d21.id,
      fixture.entry.version
    ), usedAt)).resolves.toEqual({ status: "unauthorized" });
    const revokeAudits = await db.select().from(schema.auditEvents).where(and(
      eq(schema.auditEvents.entityId, revoked.installation.credentialId),
      eq(schema.auditEvents.action, "ENTRY_CLASS_ACCESS_CREDENTIAL_REVOKED")
    ));
    expect(revokeAudits).toHaveLength(1);
    expect(revokeAudits[0]?.entityType).toBe("entry_class_access_credential");
  });
});
