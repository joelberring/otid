import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDatabase, migrate } from "@o-tid/database";
import { createMapProjectFromUpload, inviteMapProjectMember, readMapProject } from "../../src/map-projects";
import { deleteMapLayerProfile, listMapLayerProfiles, saveMapLayerProfile } from "../../src/map-layer-profiles";
import { registerTestAccount } from "./accounts";

/**
 * ADR-0219 K6b (migration 0105): lagermappningsprofiler. Den som får föreslå sparar lager → symbolnummer; samma namn ersätts;
 * en annan medlem ser inte en profil som inte delats; Läsa får inte; bara den som sparade tar bort.
 */
const base = process.env.TEST_DATABASE_URL;
if (!base) throw new Error("Testet kräver TEST_DATABASE_URL till en PostgreSQL-roll med CREATEDB");
const admin = createDatabase(base);
const databaseName = `otid_adr0219p_${randomUUID().replaceAll("-", "")}`;
const url = new URL(base);
url.pathname = `/${databaseName}`;
const { db, pool } = createDatabase(url.href);
const NOW = new Date("2026-11-09T01:00:00Z");
const mapBytes = new Uint8Array(await readFile(new URL("../../../../fixtures/maps/kartfil.omap", import.meta.url)));

beforeAll(async () => {
  await admin.pool.query(`CREATE DATABASE "${databaseName}"`);
  await migrate(db, { migrationsFolder: new URL("../../../database/migrations", import.meta.url).pathname });
}, 60_000);
afterAll(async () => {
  await pool.end();
  if (!/^otid_adr0219p_[a-f0-9]{32}$/.test(databaseName)) throw new Error("Ogiltig testdatabas för rensning");
  await admin.pool.query(`DROP DATABASE "${databaseName}"`);
  await admin.pool.end();
});

describe("ADR-0219 K6b: lagermappningsprofiler", () => {
  it("sparas, ersätts med samma namn, syns bara för den som sparade och tas bort av den", async () => {
    const owner = await registerTestAccount(db, undefined, NOW);
    const created = await createMapProjectFromUpload(db, { ...owner.proof, metadata: { formatVersion: 1, requestId: randomUUID(), name: "Profil",
      fileName: "Profil.omap" }, file: mapBytes }, NOW);
    if (created.status !== "created") throw new Error(created.status);
    const projectId = created.projectId;
    const member = await registerTestAccount(db, undefined, NOW);
    const reader = await registerTestAccount(db, undefined, NOW);
    for (const [account, role] of [[member, "SUGGEST"], [reader, "READ"]] as const) {
      await inviteMapProjectMember(db, { ...owner.proof, projectId, request: { formatVersion: 1, requestId: randomUUID(), email: account.email, role } }, NOW);
      await readMapProject(db, { ...account.proof, projectId }, NOW);
    }
    const request = (rules: { layer: string; code: string; kind: string }[], name = "Stockholms baskarta") =>
      ({ formatVersion: 1, requestId: randomUUID(), name, shareWithClub: true, rules });
    const saved = await saveMapLayerProfile(db, { ...owner.proof, projectId, request: request([{ layer: "0153", code: "516", kind: "line" },
      { layer: "HUS", code: "521", kind: "area" }]) }, NOW);
    // Projektet har ingen klubb: profilen delas inte.
    expect(saved).toMatchObject({ status: "saved", profile: { name: "Stockholms baskarta", shared: false, own: true, rules: [{ layer: "0153" }, { layer: "HUS" }] } });
    const again = await saveMapLayerProfile(db, { ...owner.proof, projectId, request: request([{ layer: "0153", code: "518", kind: "line" }]) }, NOW);
    expect(again).toMatchObject({ status: "saved", profile: { rules: [{ layer: "0153", code: "518" }] } });
    expect(await listMapLayerProfiles(db, { ...owner.proof, projectId }, NOW)).toMatchObject({ status: "ok", profiles: [{ name: "Stockholms baskarta" }] });
    expect(await listMapLayerProfiles(db, { ...member.proof, projectId }, NOW)).toEqual({ status: "ok", profiles: [] });
    expect((await listMapLayerProfiles(db, { ...reader.proof, projectId }, NOW)).status).toBe("forbidden");
    expect((await saveMapLayerProfile(db, { ...owner.proof, projectId, request: request([{ layer: "x", code: "abc", kind: "line" }]) }, NOW)).status)
      .toBe("invalid-request");
    if (again.status !== "saved") throw new Error(again.status);
    expect((await deleteMapLayerProfile(db, { ...member.proof, projectId, profileId: again.profile.profileId }, NOW)).status).toBe("not-found");
    expect(await deleteMapLayerProfile(db, { ...owner.proof, projectId, profileId: again.profile.profileId }, NOW)).toEqual({ status: "deleted" });
    expect(await listMapLayerProfiles(db, { ...owner.proof, projectId }, NOW)).toEqual({ status: "ok", profiles: [] });
  });
});
