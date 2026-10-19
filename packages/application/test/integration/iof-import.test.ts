import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { and, asc, count, eq } from "drizzle-orm";
import { schema } from "@o-tid/database";
import { contentHash, createEvent, importIofXml, importIofXmlAsAdmin, ingestDeviceBatch } from "../../src";
import { requireRaceRole } from "../../src/race-session";
import { logoutUserAccountSession } from "../../src/user-account";
import { db, courseXml, entryXml, startListXml, readoutPackage, batch, okPayload, useRaceDatabase } from "./race-fixtures";
import { raceLogin, revokeRaceGrants } from "./accounts";

useRaceDatabase();

describe("TASK 005G autentiserad IOF-import PostgreSQL", () => {
  const usedAt = new Date("2026-08-31T16:02:00.000Z");

  async function emptyRace() {
    const created = await createEvent(db, {
      name: `Importtest ${crypto.randomUUID()}`,
      raceName: "Individuellt",
      raceDate: "2026-08-31",
      timeZone: "Europe/Stockholm"
    });
    return created.race.id;
  }

  async function importAdmin(raceId: string) {
    const login = await raceLogin(db, raceId, "ADMIN", new Date("2026-08-31T16:01:00.000Z"));
    return { login };
  }

  function authenticatedInput(
    raceId: string,
    login: Awaited<ReturnType<typeof importAdmin>>["login"],
    requestId: string,
    xml: string
  ) {
    if (login.status !== "authenticated") throw new Error("Importsession saknas");
    return {
      sessionToken: login.sessionToken,
      raceId,
      csrfCookie: login.csrfToken,
      csrfHeader: login.csrfToken,
      idempotencyKey: `iof-import:${requestId}`,
      xmlBytes: Buffer.from(xml, "utf8")
    };
  }

  it("gäller administratören på tävlingens event men inte en annan tävling eller funktionären", async () => {
    const raceId = await emptyRace();
    const otherRaceId = await emptyRace();
    const admin = await importAdmin(raceId);
    await expect(requireRaceRole(db, { sessionToken: admin.login.sessionToken, raceId, role: "ADMIN" }, usedAt))
      .resolves.toMatchObject({ status: "authenticated" });
    await expect(requireRaceRole(db, { sessionToken: admin.login.sessionToken, raceId: otherRaceId, role: "ADMIN" }, usedAt))
      .resolves.toEqual({ status: "unauthorized" });
    const functionary = await raceLogin(db, raceId, "FUNCTIONARY", usedAt);
    await expect(importIofXmlAsAdmin(db, authenticatedInput(raceId, functionary, crypto.randomUUID(), courseXml), usedAt))
      .resolves.toEqual({ status: "forbidden" });
  });

  it("committar 100 samtidiga exakta requests en gång och spårar nya content-duplicates", async () => {
    const raceId = await emptyRace();
    const admin = await importAdmin(raceId);
    const requestId = crypto.randomUUID();
    const input = authenticatedInput(raceId, admin.login, requestId, courseXml);
    const results = await Promise.all(Array.from({ length: 100 }, () => importIofXmlAsAdmin(db, input, usedAt)));
    const successes = results.filter((result) => result.status === "stored");
    expect(successes).toHaveLength(100);
    expect(successes.filter((result) => result.status === "stored" && !result.response.replayed)).toHaveLength(1);
    expect(successes.filter((result) => result.status === "stored" && result.response.replayed)).toHaveLength(99);

    const [race] = await db.select().from(schema.races).where(eq(schema.races.id, raceId));
    const requests = await db.select().from(schema.iofImportRequests)
      .where(eq(schema.iofImportRequests.requestId, requestId));
    const imports = await db.select().from(schema.importFiles).where(eq(schema.importFiles.raceId, raceId));
    const audits = await db.select().from(schema.auditEvents).where(and(
      eq(schema.auditEvents.raceId, raceId),
      eq(schema.auditEvents.action, "IOF_IMPORT_STORED_BY_ADMIN")
    ));
    expect({ snapshot: race?.snapshotVersion, requests: requests.length, imports: imports.length, audits: audits.length })
      .toEqual({ snapshot: 2, requests: 1, imports: 1, audits: 1 });
    expect(audits[0]).toMatchObject({
      entityType: "import_file",
      entityId: imports[0]?.id,
      actorKind: "USER_ACCOUNT",
      actorId: admin.login.accountId,
      requestId,
      after: {
        kind: "CourseData",
        byteCount: Buffer.byteLength(courseXml, "utf8"),
        imported: { courses: 2, classes: 2 },
        snapshotVersionBefore: 1,
        snapshotVersionAfter: 2
      }
    });
    expect(JSON.stringify(audits)).not.toContain(contentHash(courseXml));
    expect(JSON.stringify(audits)).not.toContain("course-short");
    expect(JSON.stringify(audits)).not.toContain("Korta");
    expect(JSON.stringify(audits)).not.toContain(courseXml);
    expect(JSON.stringify(audits)).not.toContain(admin.login.sessionToken);
    expect(JSON.stringify(audits)).not.toContain(admin.login.csrfToken);
    expect(JSON.stringify(audits)).not.toContain("secret-course-data.xml");
    await expect(db.update(schema.importFiles).set({ report: { changed: true } })
      .where(eq(schema.importFiles.id, imports[0]?.id ?? crypto.randomUUID()))).rejects.toThrow();
    await expect(db.delete(schema.iofImportRequests)
      .where(eq(schema.iofImportRequests.requestId, requestId))).rejects.toThrow();

    const duplicateRequestId = crypto.randomUUID();
    const duplicate = await importIofXmlAsAdmin(
      db,
      authenticatedInput(raceId, admin.login, duplicateRequestId, courseXml),
      usedAt
    );
    expect(duplicate).toMatchObject({
      status: "duplicate",
      response: { status: "duplicate", replayed: false, requestId: duplicateRequestId }
    });
    const [raceAfterDuplicate] = await db.select().from(schema.races).where(eq(schema.races.id, raceId));
    const duplicateAudits = await db.select().from(schema.auditEvents).where(and(
      eq(schema.auditEvents.raceId, raceId),
      eq(schema.auditEvents.action, "IOF_IMPORT_STORED_BY_ADMIN")
    ));
    expect(raceAfterDuplicate?.snapshotVersion).toBe(2);
    expect(duplicateAudits).toHaveLength(1);
  });

  it("ger request-konflikt före parserfel och binder request till actor, race och hash", async () => {
    const raceId = await emptyRace();
    const otherRaceId = await emptyRace();
    const first = await importAdmin(raceId);
    const otherActor = await importAdmin(raceId);
    const otherRaceActor = await importAdmin(otherRaceId);
    const requestId = crypto.randomUUID();
    await expect(importIofXmlAsAdmin(
      db,
      authenticatedInput(raceId, first.login, requestId, courseXml),
      usedAt
    )).resolves.toMatchObject({ status: "stored" });
    await expect(importIofXmlAsAdmin(
      db,
      authenticatedInput(raceId, first.login, requestId, "<malformed>"),
      usedAt
    )).resolves.toEqual({ status: "conflict" });
    await expect(importIofXmlAsAdmin(
      db,
      authenticatedInput(raceId, otherActor.login, requestId, courseXml),
      usedAt
    )).resolves.toEqual({ status: "conflict" });
    await expect(importIofXmlAsAdmin(
      db,
      authenticatedInput(otherRaceId, otherRaceActor.login, requestId, courseXml),
      usedAt
    )).resolves.toEqual({ status: "conflict" });
  });

  it("avvisar ogiltig XML atomärt och stoppar import efter capability-säker logout", async () => {
    const raceId = await emptyRace();
    const admin = await importAdmin(raceId);
    const before = await db.select({ value: count() }).from(schema.iofImportRequests)
      .where(eq(schema.iofImportRequests.raceId, raceId));
    await expect(importIofXmlAsAdmin(db, authenticatedInput(
      raceId,
      admin.login,
      crypto.randomUUID(),
      `<!DOCTYPE EntryList [<!ENTITY x "y">]><EntryList>&x;</EntryList>`
    ), usedAt)).resolves.toMatchObject({ status: "invalid-iof-xml", issues: [expect.any(String)] });
    const after = await db.select({ value: count() }).from(schema.iofImportRequests)
      .where(eq(schema.iofImportRequests.raceId, raceId));
    expect(after[0]?.value).toBe(before[0]?.value);

    await expect(logoutUserAccountSession(db, { sessionToken: admin.login.sessionToken, csrfCookie: admin.login.csrfToken,
      csrfHeader: admin.login.csrfToken }, usedAt)).resolves.toEqual({ status: "logged-out" });
    await expect(importIofXmlAsAdmin(
      db,
      authenticatedInput(raceId, admin.login, crypto.randomUUID(), courseXml),
      usedAt
    )).resolves.toEqual({ status: "unauthorized" });

    const revokedAdmin = await importAdmin(raceId);
    await revokeRaceGrants(db, revokedAdmin.login.accountId, usedAt);
    await expect(importIofXmlAsAdmin(
      db,
      authenticatedInput(raceId, revokedAdmin.login, crypto.randomUUID(), courseXml),
      usedAt
    )).resolves.toEqual({ status: "unauthorized" });
  });

  it("importerar EntryList genom skyddad yta efter betrodd CourseData-setup", async () => {
    const raceId = await emptyRace();
    await importIofXml(db, raceId, courseXml);
    const admin = await importAdmin(raceId);
    const result = await importIofXmlAsAdmin(
      db,
      authenticatedInput(raceId, admin.login, crypto.randomUUID(), entryXml),
      usedAt
    );
    expect(result).toMatchObject({
      status: "stored",
      response: { report: { kind: "EntryList", imported: { entries: 2 } } }
    });
  });

  it("importerar StartList atomärt, versionsstyrt och utan automatisk resultatrevision", async () => {
    const raceId = await emptyRace();
    await importIofXml(db, raceId, courseXml);
    await importIofXml(db, raceId, entryXml);
    await ingestDeviceBatch(db, raceId, batch(crypto.randomUUID(), okPayload));
    const admin = await importAdmin(raceId);
    const requestId = crypto.randomUUID();
    const [raceBefore] = await db.select().from(schema.races).where(eq(schema.races.id, raceId));
    const entriesBefore = await db.select().from(schema.entries)
      .where(eq(schema.entries.raceId, raceId)).orderBy(asc(schema.entries.externalId));
    const rawBefore = await db.select().from(schema.rawDeviceMessages)
      .where(eq(schema.rawDeviceMessages.raceId, raceId));
    const readoutsBefore = await db.select().from(schema.cardReadouts)
      .where(eq(schema.cardReadouts.raceId, raceId));
    const revisionsBefore = await db.select().from(schema.resultRevisions)
      .where(eq(schema.resultRevisions.raceId, raceId));
    const oldPayload = await readoutPackage(raceId);

    const result = await importIofXmlAsAdmin(
      db,
      authenticatedInput(raceId, admin.login, requestId, startListXml),
      usedAt
    );
    expect(result).toMatchObject({
      status: "stored",
      response: {
        status: "stored",
        replayed: false,
        requestId,
        report: {
          kind: "StartList",
          imported: { classes: 1, entries: 2 },
          changed: { classes: 1, entries: 2 },
          resultsRequiringRecalculation: 1,
          snapshotChanged: true
        }
      }
    });

    const [raceClass] = await db.select().from(schema.classes).where(and(
      eq(schema.classes.raceId, raceId),
      eq(schema.classes.externalId, "class-h21")
    ));
    const entriesAfter = await db.select().from(schema.entries)
      .where(eq(schema.entries.raceId, raceId)).orderBy(asc(schema.entries.externalId));
    const [raceAfter] = await db.select().from(schema.races).where(eq(schema.races.id, raceId));
    const rawAfter = await db.select().from(schema.rawDeviceMessages)
      .where(eq(schema.rawDeviceMessages.raceId, raceId));
    const readoutsAfter = await db.select().from(schema.cardReadouts)
      .where(eq(schema.cardReadouts.raceId, raceId));
    const revisionsAfter = await db.select().from(schema.resultRevisions)
      .where(eq(schema.resultRevisions.raceId, raceId));
    expect(raceClass?.startRule).toBe("FIXED");
    expect(entriesAfter.map((entry) => ({
      externalId: entry.externalId,
      fixedStartTime: entry.fixedStartTime?.toISOString(),
      versionDelta: entry.version - (entriesBefore.find((before) => before.id === entry.id)?.version ?? 0)
    }))).toEqual([
      { externalId: "entry-ada", fixedStartTime: "2026-08-31T08:00:00.000Z", versionDelta: 1 },
      { externalId: "entry-bo", fixedStartTime: "2026-08-31T08:03:00.000Z", versionDelta: 1 }
    ]);
    expect(raceAfter?.snapshotVersion).toBe((raceBefore?.snapshotVersion ?? 0) + 1);
    expect(rawAfter).toEqual(rawBefore);
    expect(readoutsAfter).toEqual(readoutsBefore);
    expect(revisionsAfter).toEqual(revisionsBefore);

    const [saved] = await db.select().from(schema.importFiles).where(and(
      eq(schema.importFiles.raceId, raceId),
      eq(schema.importFiles.kind, "StartList")
    ));
    expect(saved).toMatchObject({
      contentHash: contentHash(startListXml),
      originalXml: startListXml,
      report: {
        kind: "StartList",
        changed: { classes: 1, entries: 2 },
        resultsRequiringRecalculation: 1,
        snapshotChanged: true
      }
    });
    const audits = await db.select().from(schema.auditEvents).where(and(
      eq(schema.auditEvents.entityId, saved?.id ?? crypto.randomUUID()),
      eq(schema.auditEvents.action, "IOF_IMPORT_STORED_BY_ADMIN")
    ));
    expect(audits).toHaveLength(1);
    expect(audits[0]?.after).toMatchObject({
      kind: "StartList",
      changed: { classes: 1, entries: 2 },
      resultsRequiringRecalculation: 1,
      snapshotChanged: true,
      snapshotVersionBefore: raceBefore?.snapshotVersion,
      snapshotVersionAfter: raceAfter?.snapshotVersion
    });
    expect(JSON.stringify(audits)).not.toContain("entry-ada");
    expect(JSON.stringify(audits)).not.toContain(startListXml);

    const payload = await readoutPackage(raceId);
    expect(oldPayload.raceSnapshot.classes.find((item) => item.externalIdentity?.externalId === "class-h21")?.startRule)
      .toBe("PUNCH");
    expect(oldPayload.raceSnapshot.entries.find((item) => item.externalIdentity?.externalId === "entry-ada")?.fixedStartTime)
      .toBeUndefined();
    expect(payload.packageVersion).toBe(raceAfter?.snapshotVersion);
    expect(payload.raceSnapshot.classes.find((item) => item.externalIdentity?.externalId === "class-h21")?.startRule)
      .toBe("FIXED");
    expect(payload.raceSnapshot.entries.find((item) => item.externalIdentity?.externalId === "entry-ada")?.fixedStartTime)
      .toBe("2026-08-31T08:00:00.000Z");

    const staleResponse = await ingestDeviceBatch(db, raceId, batch(
      crypto.randomUUID(),
      { ...okPayload, cardNumber: "999999" },
      { packageVersion: oldPayload.packageVersion }
    ));
    expect(staleResponse).toMatchObject({
      currentPackageVersion: payload.packageVersion,
      packageVersionStatus: "stale",
      packageUpdateRequired: true,
      acknowledgements: [{ status: "stored" }]
    });
  });

  it("återspelar StartList exakt och bevarar en ny fil med identisk effekt utan versionschurn", async () => {
    const raceId = await emptyRace();
    await importIofXml(db, raceId, courseXml);
    await importIofXml(db, raceId, entryXml);
    const admin = await importAdmin(raceId);
    const firstRequestId = crypto.randomUUID();
    const input = authenticatedInput(raceId, admin.login, firstRequestId, startListXml);
    const first = await importIofXmlAsAdmin(db, input, usedAt);
    expect(first).toMatchObject({ status: "stored", response: { replayed: false } });
    const replay = await importIofXmlAsAdmin(db, input, usedAt);
    expect(replay).toMatchObject({ status: "stored", response: { replayed: true, requestId: firstRequestId } });
    const duplicate = await importIofXmlAsAdmin(
      db,
      authenticatedInput(raceId, admin.login, crypto.randomUUID(), startListXml),
      usedAt
    );
    expect(duplicate).toMatchObject({ status: "duplicate", response: { replayed: false } });

    const [raceAfterFirst] = await db.select().from(schema.races).where(eq(schema.races.id, raceId));
    const entriesAfterFirst = await db.select().from(schema.entries)
      .where(eq(schema.entries.raceId, raceId)).orderBy(asc(schema.entries.id));
    const sameEffectXml = startListXml.replace(
      'creator="O-Tid fixture"',
      'creator="O-Tid fixture semantic retry"'
    );
    const sameEffect = await importIofXmlAsAdmin(
      db,
      authenticatedInput(raceId, admin.login, crypto.randomUUID(), sameEffectXml),
      usedAt
    );
    expect(sameEffect).toMatchObject({
      status: "stored",
      response: {
        report: {
          kind: "StartList",
          changed: { classes: 0, entries: 0 },
          resultsRequiringRecalculation: 0,
          snapshotChanged: false
        }
      }
    });
    const [raceAfterSameEffect] = await db.select().from(schema.races).where(eq(schema.races.id, raceId));
    const entriesAfterSameEffect = await db.select().from(schema.entries)
      .where(eq(schema.entries.raceId, raceId)).orderBy(asc(schema.entries.id));
    const imports = await db.select().from(schema.importFiles).where(and(
      eq(schema.importFiles.raceId, raceId),
      eq(schema.importFiles.kind, "StartList")
    ));
    expect(imports).toHaveLength(2);
    expect(raceAfterSameEffect?.snapshotVersion).toBe(raceAfterFirst?.snapshotVersion);
    expect(entriesAfterSameEffect.map((entry) => [entry.id, entry.version, entry.fixedStartTime?.toISOString()]))
      .toEqual(entriesAfterFirst.map((entry) => [entry.id, entry.version, entry.fixedStartTime?.toISOString()]));
  });

  it("avvisar okänd, partiell eller klasskonfliktande StartList utan writes", async () => {
    const raceId = await emptyRace();
    await importIofXml(db, raceId, courseXml);
    await importIofXml(db, raceId, entryXml);
    const admin = await importAdmin(raceId);
    const startList = (classId: string, entryIds: readonly string[]) => `<StartList xmlns="http://www.orienteering.org/datastandard/3.0" iofVersion="3.0"><Event><Name>Test</Name></Event><ClassStart><Class><Id>${classId}</Id></Class>${entryIds.map((entryId, index) => `<PersonStart><EntryId>${entryId}</EntryId><Start><StartTime>2026-08-31T08:0${index}:00Z</StartTime></Start></PersonStart>`).join("")}</ClassStart></StartList>`;
    const [raceBefore] = await db.select().from(schema.races).where(eq(schema.races.id, raceId));
    const entriesBefore = await db.select().from(schema.entries).where(eq(schema.entries.raceId, raceId));
    const [importsBefore] = await db.select({ value: count() }).from(schema.importFiles)
      .where(eq(schema.importFiles.raceId, raceId));
    const [requestsBefore] = await db.select({ value: count() }).from(schema.iofImportRequests)
      .where(eq(schema.iofImportRequests.raceId, raceId));
    for (const xml of [
      startList("class-unknown", ["entry-ada", "entry-bo"]),
      startList("class-h21", ["entry-ada"]),
      startList("class-d21", ["entry-ada", "entry-bo"])
    ]) {
      await expect(importIofXmlAsAdmin(
        db,
        authenticatedInput(raceId, admin.login, crypto.randomUUID(), xml),
        usedAt
      )).resolves.toEqual({ status: "conflict" });
    }
    const [raceAfter] = await db.select().from(schema.races).where(eq(schema.races.id, raceId));
    const entriesAfter = await db.select().from(schema.entries).where(eq(schema.entries.raceId, raceId));
    const [importsAfter] = await db.select({ value: count() }).from(schema.importFiles)
      .where(eq(schema.importFiles.raceId, raceId));
    const [requestsAfter] = await db.select({ value: count() }).from(schema.iofImportRequests)
      .where(eq(schema.iofImportRequests.raceId, raceId));
    expect(raceAfter?.snapshotVersion).toBe(raceBefore?.snapshotVersion);
    expect(entriesAfter).toEqual(entriesBefore);
    expect(importsAfter?.value).toBe(importsBefore?.value);
    expect(requestsAfter?.value).toBe(requestsBefore?.value);
  });

  it("bevarar FIXED och fasta starttider vid senare CourseData- och EntryList-import", async () => {
    const raceId = await emptyRace();
    await importIofXml(db, raceId, courseXml);
    await importIofXml(db, raceId, entryXml);
    const admin = await importAdmin(raceId);
    await importIofXmlAsAdmin(
      db,
      authenticatedInput(raceId, admin.login, crypto.randomUUID(), startListXml),
      usedAt
    );
    await importIofXmlAsAdmin(
      db,
      authenticatedInput(raceId, admin.login, crypto.randomUUID(), courseXml.replace(
        "</CourseData>",
        "<!-- after-start-list --></CourseData>"
      )),
      usedAt
    );
    await importIofXmlAsAdmin(
      db,
      authenticatedInput(raceId, admin.login, crypto.randomUUID(), entryXml.replace(
        "</EntryList>",
        "<!-- after-start-list --></EntryList>"
      )),
      usedAt
    );
    const [raceClass] = await db.select().from(schema.classes).where(and(
      eq(schema.classes.raceId, raceId),
      eq(schema.classes.externalId, "class-h21")
    ));
    const entries = await db.select().from(schema.entries)
      .where(eq(schema.entries.raceId, raceId)).orderBy(asc(schema.entries.externalId));
    expect(raceClass?.startRule).toBe("FIXED");
    expect(entries.map((entry) => entry.fixedStartTime?.toISOString())).toEqual([
      "2026-08-31T08:00:00.000Z",
      "2026-08-31T08:03:00.000Z"
    ]);
  });

  it("binder hash och byteantal till exakta UTF-8-bytes inklusive BOM", async () => {
    const raceId = await emptyRace();
    const admin = await importAdmin(raceId);
    const xmlBytes = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(courseXml, "utf8")]);
    const requestId = crypto.randomUUID();
    const result = await importIofXmlAsAdmin(db, {
      sessionToken: admin.login.sessionToken,
      raceId,
      csrfCookie: admin.login.csrfToken,
      csrfHeader: admin.login.csrfToken,
      idempotencyKey: `iof-import:${requestId}`,
      xmlBytes
    }, usedAt);
    expect(result).toMatchObject({
      status: "stored",
      response: {
        byteCount: xmlBytes.byteLength,
        contentHash: createHash("sha256").update(xmlBytes).digest("hex")
      }
    });
    const [saved] = await db.select().from(schema.importFiles).where(eq(schema.importFiles.raceId, raceId));
    expect(saved?.originalXml.codePointAt(0)).toBe(0xfeff);
    expect(Buffer.from(saved?.originalXml ?? "", "utf8")).toEqual(xmlBytes);
  });
});
