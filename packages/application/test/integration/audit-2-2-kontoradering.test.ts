import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { schema } from "@o-tid/database";
import { deleteAccountWithOwnedEvents } from "../../src/account-self-service";
import { createMapProjectFromUpload, inviteMapProjectMember, readMapProject } from "../../src/map-projects";
import { registerTestAccount } from "./accounts";
import { db, useRaceDatabase } from "./race-fixtures";

/**
 * Granskningen 2.2: att ta bort ett konto lämnar delade kartprojekt, klubbarkivet och klubbplaneringen i ordning:
 * nyckeln ON DELETE SET NULL följs av `purgeRows` (raden bevaras), geo-körningar och klubbens lagerprofiler finns kvar för de
 * andra medlemmarna, och planeringen släpper kontot (och adressen) utan att kvarlämna personuppgifter.
 */
useRaceDatabase();
const NOW = new Date("2026-11-22T10:00:00Z");
const mapBytes = new Uint8Array(await readFile(new URL("../../../../fixtures/maps/kartfil.omap", import.meta.url)));

describe("granskning 2.2: borttaget konto", () => {
  it("bevarar arkivets personrader (SET NULL), klubbens profiler och delade körningar, och släpper planeringen", async () => {
    const owner = await registerTestAccount(db, undefined, NOW);
    const leaving = await registerTestAccount(db, undefined, NOW);
    const created = await createMapProjectFromUpload(db, { ...owner.proof, metadata: { formatVersion: 1, requestId: randomUUID(), name: "Delat",
      fileName: "Delat.omap" }, file: mapBytes }, NOW);
    if (created.status !== "created") throw new Error(created.status);
    const projectId = created.projectId;
    await inviteMapProjectMember(db, { ...owner.proof, projectId, request: { formatVersion: 1, requestId: randomUUID(), email: leaving.email, role: "SUGGEST" } }, NOW);
    await readMapProject(db, { ...leaving.proof, projectId }, NOW);

    const clubId = randomUUID(), termId = randomUUID(), sessionId = randomUUID(), archiveId = randomUUID();
    await db.insert(schema.clubs).values({ id: clubId, name: "Testklubb", createdAt: NOW, createdBy: owner.accountId, requestId: randomUUID() });
    // Klubbens delade profil och en personlig profil, båda av kontot som går.
    const profile = (clubShared: boolean) => ({ id: randomUUID(), accountId: leaving.accountId, clubId: clubShared ? clubId : null,
      name: clubShared ? "Delad" : "Egen", rules: [{ layer: "a", code: "516", kind: "line" as const }], createdAt: NOW, updatedAt: NOW, requestId: randomUUID() });
    const shared = profile(true), personal = profile(false);
    await db.insert(schema.mapLayerProfiles).values([shared, personal]);
    // En klar och en köad körning av kontot i det delade projektet.
    const job = (status: "DONE" | "QUEUED") => ({ id: randomUUID(), projectId, accountId: leaving.accountId, kind: "PULLAUTIN" as const, status,
      request: {}, createdAt: NOW, requestId: randomUUID() });
    const done = job("DONE"), queued = job("QUEUED");
    await db.insert(schema.mapProjectGeoJobs).values([done, queued]);
    // Arkivposten med kontot som ansvarig, och planeringen med kontot som ansvarig och som uppgiftens person (konto och adress).
    await db.insert(schema.clubArchiveEntries).values({ id: archiveId, clubId, place: "", title: "Träning", tags: [], createdAt: NOW, createdBy: owner.accountId, updatedAt: NOW });
    const personId = randomUUID();
    await db.insert(schema.clubArchiveEntryPersons).values({ id: personId, entryId: archiveId, kind: "RESPONSIBLE", accountId: leaving.accountId, position: 0 });
    await db.insert(schema.clubTerms).values({ id: termId, clubId, name: "HT", startsOn: "2026-08-01", endsOn: "2026-12-01", createdAt: NOW, createdBy: owner.accountId, requestId: randomUUID() });
    await db.insert(schema.clubPlanSessions).values({ id: sessionId, clubId, termId, sessionDate: "2026-11-25", title: "Pass", responsibleAccountId: leaving.accountId,
      createdAt: NOW, createdBy: owner.accountId, updatedAt: NOW, requestId: randomUUID() });
    const taskByAccount = randomUUID(), taskByEmail = randomUUID(), taskOther = randomUUID();
    await db.insert(schema.clubPlanTasks).values([
      { id: taskByAccount, sessionId, title: "A", assigneeAccountId: leaving.accountId, createdAt: NOW, createdBy: owner.accountId, requestId: randomUUID() },
      { id: taskByEmail, sessionId, title: "B", assigneeEmail: leaving.email.toLowerCase(), createdAt: NOW, createdBy: owner.accountId, requestId: randomUUID() },
      { id: taskOther, sessionId, title: "C", assigneeEmail: "annan@test.o-tid.se", createdAt: NOW, createdBy: owner.accountId, requestId: randomUUID() }
    ]);

    await db.transaction((tx) => deleteAccountWithOwnedEvents(tx, leaving.accountId, NOW));

    expect(await db.select().from(schema.userAccounts).where(eq(schema.userAccounts.id, leaving.accountId))).toHaveLength(0);
    // Arkivets personrad finns kvar utan konto.
    expect(await db.select().from(schema.clubArchiveEntryPersons).where(eq(schema.clubArchiveEntryPersons.id, personId)))
      .toMatchObject([{ accountId: null, kind: "RESPONSIBLE" }]);
    // Klubbens profil finns kvar (utan konto), den personliga är borta.
    expect(await db.select().from(schema.mapLayerProfiles).where(eq(schema.mapLayerProfiles.id, shared.id))).toMatchObject([{ accountId: null, clubId }]);
    expect(await db.select().from(schema.mapLayerProfiles).where(eq(schema.mapLayerProfiles.id, personal.id))).toHaveLength(0);
    // Den klara körningen finns kvar, den köade är borta.
    expect(await db.select().from(schema.mapProjectGeoJobs).where(eq(schema.mapProjectGeoJobs.id, done.id))).toMatchObject([{ accountId: null, status: "DONE" }]);
    expect(await db.select().from(schema.mapProjectGeoJobs).where(eq(schema.mapProjectGeoJobs.id, queued.id))).toHaveLength(0);
    // Planeringen släpper kontot och adressen; andras uppgifter rörs inte.
    const [plan] = await db.select().from(schema.clubPlanSessions).where(eq(schema.clubPlanSessions.id, sessionId));
    expect(plan?.responsibleAccountId).toBeNull();
    const tasks = await db.select().from(schema.clubPlanTasks).where(eq(schema.clubPlanTasks.sessionId, sessionId));
    expect(tasks.find((task) => task.id === taskByAccount)).toMatchObject({ assigneeAccountId: null, assigneeEmail: null });
    expect(tasks.find((task) => task.id === taskByEmail)).toMatchObject({ assigneeAccountId: null, assigneeEmail: null });
    expect(tasks.find((task) => task.id === taskOther)).toMatchObject({ assigneeEmail: "annan@test.o-tid.se" });
  });
});
