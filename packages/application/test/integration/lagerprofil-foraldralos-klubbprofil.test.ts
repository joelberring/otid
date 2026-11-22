import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { schema } from "@o-tid/database";
import { createMapProjectFromUpload, inviteMapProjectMember, readMapProject } from "../../src/map-projects";
import { deleteMapLayerProfile } from "../../src/map-layer-profiles";
import { registerTestAccount } from "./accounts";
import { db, useRaceDatabase } from "./race-fixtures";

/**
 * Granskningen (runda 2, fynd 9): en delad klubbprofil vars skapare tagit bort sitt konto (account_id NULL) kan tas bort av klubbens
 * administratörer, men inte av en vanlig projektmedlem eller av någon i ett projekt utan klubben.
 */
useRaceDatabase();
const NOW = new Date("2026-11-22T10:00:00Z");
const mapBytes = new Uint8Array(await readFile(new URL("../../../../fixtures/maps/kartfil.omap", import.meta.url)));

describe("föräldralös klubbprofil", () => {
  it("tas bort av klubbens administratör, inte av en vanlig medlem", async () => {
    const owner = await registerTestAccount(db, undefined, NOW);
    const clubAdmin = await registerTestAccount(db, undefined, NOW);
    const member = await registerTestAccount(db, undefined, NOW);
    const created = await createMapProjectFromUpload(db, { ...owner.proof, metadata: { formatVersion: 1, requestId: randomUUID(), name: "Klubbkarta",
      fileName: "K.omap" }, file: mapBytes }, NOW);
    if (created.status !== "created") throw new Error(created.status);
    const projectId = created.projectId;
    await inviteMapProjectMember(db, { ...owner.proof, projectId, request: { formatVersion: 1, requestId: randomUUID(), email: member.email, role: "SUGGEST" } }, NOW);
    await readMapProject(db, { ...member.proof, projectId }, NOW);
    const clubId = randomUUID();
    await db.insert(schema.clubs).values({ id: clubId, name: "Testklubb", createdAt: NOW, createdBy: clubAdmin.accountId, requestId: randomUUID() });
    await db.insert(schema.clubMembers).values({ id: randomUUID(), clubId, accountId: clubAdmin.accountId, role: "ADMIN", addedAt: NOW,
      addedBy: clubAdmin.accountId, requestId: randomUUID() });
    await db.update(schema.mapProjects).set({ clubId }).where(eq(schema.mapProjects.id, projectId));
    const profileId = randomUUID();
    await db.insert(schema.mapLayerProfiles).values({ id: profileId, accountId: null, clubId, name: "Delad", rules: [{ layer: "a", code: "516", kind: "line" }],
      createdAt: NOW, updatedAt: NOW, requestId: randomUUID() });
    expect((await deleteMapLayerProfile(db, { ...member.proof, projectId, profileId }, NOW)).status).toBe("not-found");
    expect(await deleteMapLayerProfile(db, { ...clubAdmin.proof, projectId, profileId }, NOW)).toEqual({ status: "deleted" });
  });
});
