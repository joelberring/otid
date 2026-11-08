import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { createDatabase, migrate, schema } from "@o-tid/database";
import { DEFAULT_RECON } from "@o-tid/map-revision";
import { createMapProjectFromUpload, inviteMapProjectMember, readMapProject, updateMapProject } from "../../src/map-projects";
import {
  addMapProjectTrackPart, changeMapProjectChecks, createMapProjectTrack, deleteMapProjectTrack, listMapProjectChecks, listMapProjectTracks,
  mapProjectTrackPoints, updateMapProjectTrack
} from "../../src/map-project-recon";
import { deleteAccountWithOwnedEvents } from "../../src/account-self-service";
import { registerTestAccount } from "./accounts";

/**
 * ADR-0219 tillägget om rekningen (K3): spår (skapa, delar som skickas igen, krock, namn, ta bort), att bara medlemmar ser dem
 * och bara den egna får ändras, att Läsa inte lägger till, bekräftelserna (sätta, ersätta, ta bort), inställningarna och att
 * spåren tas bort med kontot.
 */
const base = process.env.TEST_DATABASE_URL;
if (!base) throw new Error("Testet kräver TEST_DATABASE_URL till en PostgreSQL-roll med CREATEDB");
const admin = createDatabase(base);
const databaseName = `otid_adr0219r_${randomUUID().replaceAll("-", "")}`;
const url = new URL(base);
url.pathname = `/${databaseName}`;
const { db, pool } = createDatabase(url.href);
const NOW = new Date("2026-11-08T10:00:00Z");
const mapBytes = new Uint8Array(await readFile(new URL("../../../../fixtures/maps/kartfil.omap", import.meta.url)));

beforeAll(async () => {
  await admin.pool.query(`CREATE DATABASE "${databaseName}"`);
  await migrate(db, { migrationsFolder: new URL("../../../database/migrations", import.meta.url).pathname });
}, 60_000);
afterAll(async () => {
  await pool.end();
  if (!/^otid_adr0219r_[a-f0-9]{32}$/.test(databaseName)) throw new Error("Ogiltig testdatabas för rensning");
  await admin.pool.query(`DROP DATABASE "${databaseName}"`);
  await admin.pool.end();
});

async function setup() {
  const owner = await registerTestAccount(db, undefined, NOW);
  const created = await createMapProjectFromUpload(db, { ...owner.proof, metadata: { formatVersion: 1, requestId: randomUUID(), name: "Kungshatt",
    fileName: "Kungshatt.omap" }, file: mapBytes }, NOW);
  if (created.status !== "created") throw new Error(created.status);
  const projectId = created.projectId;
  const people = { editor: await registerTestAccount(db, undefined, NOW), reader: await registerTestAccount(db, undefined, NOW),
    outsider: await registerTestAccount(db, undefined, NOW) };
  for (const [person, role] of [[people.editor, "EDIT"], [people.reader, "READ"]] as const) {
    expect((await inviteMapProjectMember(db, { ...owner.proof, projectId, request: { formatVersion: 1, requestId: randomUUID(), email: person.email,
      role } }, NOW)).status).toBe("invited");
    expect((await readMapProject(db, { ...person.proof, projectId }, NOW)).status).toBe("ok");
  }
  return { owner, ...people, projectId };
}

const points = (count: number, start = 0): [number, number, number, number][] =>
  Array.from({ length: count }, (_, index) => [59.3 + (start + index) * 0.0001, 17.9, (start + index) * 2, 5]);

describe("ADR-0219 K3: rekningen", () => {
  it("spår: skapa, delar (samma igen, krock), namn, medlemmarna ser dem, bara den egna ändras, Läsa lägger inte till", async () => {
    const s = await setup();
    const trackId = randomUUID();
    const request = { formatVersion: 1, trackId, name: "Morgonrunda", source: "FIELD", startedAt: NOW.toISOString() };
    const created = await createMapProjectTrack(db, { ...s.editor.proof, projectId: s.projectId, request }, NOW);
    expect(created).toMatchObject({ status: "created", replayed: false, track: { own: true, pointCount: 0, parts: [] } });
    expect(await createMapProjectTrack(db, { ...s.editor.proof, projectId: s.projectId, request }, NOW)).toMatchObject({ status: "created", replayed: true });
    // Någon annan med samma id: krock.
    expect((await createMapProjectTrack(db, { ...s.owner.proof, projectId: s.projectId, request }, NOW)).status).toBe("conflict");
    const part = { formatVersion: 1, seq: 0, points: points(100) };
    const first = await addMapProjectTrackPart(db, { ...s.editor.proof, projectId: s.projectId, trackId, request: part }, NOW);
    expect(first).toMatchObject({ status: "ok", replayed: false, track: { pointCount: 100, parts: [0] } });
    // 99 steg om 0,0001° latitud är omkring 1,1 km.
    expect(first.status === "ok" && first.track.lengthM).toBeGreaterThan(1000);
    expect(await addMapProjectTrackPart(db, { ...s.editor.proof, projectId: s.projectId, trackId, request: part }, NOW))
      .toMatchObject({ status: "ok", replayed: true, track: { pointCount: 100 } });
    expect((await addMapProjectTrackPart(db, { ...s.editor.proof, projectId: s.projectId, trackId, request: { ...part, points: points(3) } }, NOW)).status)
      .toBe("conflict");
    const last = await addMapProjectTrackPart(db, { ...s.editor.proof, projectId: s.projectId, trackId,
      request: { formatVersion: 1, seq: 1, points: points(50, 100), endedAt: NOW.toISOString() } }, NOW);
    expect(last).toMatchObject({ status: "ok", track: { pointCount: 150, parts: [0, 1], endedAt: NOW.toISOString() } });
    // Ägaren ser spåret (inte som sitt eget) och punkterna; den utanför ser inget.
    const listed = await listMapProjectTracks(db, { ...s.owner.proof, projectId: s.projectId }, NOW);
    expect(listed.status === "ok" && listed.list.tracks.map(track => [track.name, track.own, track.account.accountId]))
      .toEqual([["Morgonrunda", false, s.editor.accountId]]);
    const read = await mapProjectTrackPoints(db, { ...s.reader.proof, projectId: s.projectId, trackId }, NOW);
    expect(read.status === "ok" && read.points.points.length).toBe(150);
    expect((await listMapProjectTracks(db, { ...s.outsider.proof, projectId: s.projectId }, NOW)).status).toBe("not-found");
    expect((await mapProjectTrackPoints(db, { ...s.outsider.proof, projectId: s.projectId, trackId }, NOW)).status).toBe("not-found");
    // Bara den egna: ägaren får inte döpa om, lägga till delar eller ta bort någon annans spår.
    expect((await updateMapProjectTrack(db, { ...s.owner.proof, projectId: s.projectId, trackId, request: { formatVersion: 1, name: "X" } }, NOW)).status)
      .toBe("forbidden");
    expect((await addMapProjectTrackPart(db, { ...s.owner.proof, projectId: s.projectId, trackId, request: { formatVersion: 1, seq: 2, points: points(2) } },
      NOW)).status).toBe("forbidden");
    expect((await deleteMapProjectTrack(db, { ...s.owner.proof, projectId: s.projectId, trackId }, NOW)).status).toBe("forbidden");
    expect(await updateMapProjectTrack(db, { ...s.editor.proof, projectId: s.projectId, trackId, request: { formatVersion: 1, name: "Västra stranden" } }, NOW))
      .toMatchObject({ status: "ok", track: { name: "Västra stranden" } });
    // Läsa lägger inte till spår.
    expect((await createMapProjectTrack(db, { ...s.reader.proof, projectId: s.projectId, request: { ...request, trackId: randomUUID() } }, NOW)).status)
      .toBe("forbidden");
    // Ogiltiga punkter.
    expect((await addMapProjectTrackPart(db, { ...s.editor.proof, projectId: s.projectId, trackId,
      request: { formatVersion: 1, seq: 3, points: [[91, 0, 0, 5]] } }, NOW)).status).toBe("invalid-request");
    // Ta bort det egna: delarna följer med.
    expect((await deleteMapProjectTrack(db, { ...s.editor.proof, projectId: s.projectId, trackId }, NOW)).status).toBe("deleted");
    expect(await db.select().from(schema.mapProjectTrackParts).where(eq(schema.mapProjectTrackParts.trackId, trackId))).toEqual([]);
  });

  it("bekräftelser: sätta, ersätta, ta bort; Läsa får inte", async () => {
    const s = await setup();
    const basis = randomUUID();
    const change = (proof: typeof s.owner.proof, request: unknown) => changeMapProjectChecks(db, { ...proof, projectId: s.projectId, request }, NOW);
    expect(await change(s.editor.proof, { formatVersion: 1, set: [{ key: "b:sten-1", basis: null }, { key: "n:ny", basis }] }))
      .toEqual({ status: "ok", set: 2, cleared: 0 });
    expect(await change(s.owner.proof, { formatVersion: 1, set: [{ key: "b:sten-1", basis }], clear: ["n:ny"] })).toEqual({ status: "ok", set: 1, cleared: 1 });
    const listed = await listMapProjectChecks(db, { ...s.reader.proof, projectId: s.projectId }, NOW);
    expect(listed.status === "ok" && listed.list.checks.map(check => [check.key, check.basis, check.accountId]))
      .toEqual([["b:sten-1", basis, s.owner.accountId]]);
    expect((await change(s.reader.proof, { formatVersion: 1, set: [{ key: "b:sten-2", basis: null }] })).status).toBe("forbidden");
    expect((await change(s.editor.proof, { formatVersion: 1 })).status).toBe("invalid-request");
  });

  it("inställningarna (ägarna) och spåren med kontot", async () => {
    const s = await setup();
    const recon = { ...DEFAULT_RECON, sightM: { ...DEFAULT_RECON.sightM, STONES: 10 } };
    expect((await updateMapProject(db, { ...s.editor.proof, projectId: s.projectId, request: { formatVersion: 1, recon } }, NOW)).status).toBe("forbidden");
    expect((await updateMapProject(db, { ...s.owner.proof, projectId: s.projectId, request: { formatVersion: 1, recon: { ...recon, coverM: 1 } } }, NOW))
      .status).toBe("invalid-request");
    expect((await updateMapProject(db, { ...s.owner.proof, projectId: s.projectId, request: { formatVersion: 1, recon } }, NOW)).status).toBe("ok");
    const view = await readMapProject(db, { ...s.editor.proof, projectId: s.projectId }, NOW);
    expect(view.status === "ok" && view.view.recon).toEqual(recon);
    const trackId = randomUUID();
    await createMapProjectTrack(db, { ...s.editor.proof, projectId: s.projectId, request: { formatVersion: 1, trackId, name: "GPX", source: "GPX" } }, NOW);
    await addMapProjectTrackPart(db, { ...s.editor.proof, projectId: s.projectId, trackId, request: { formatVersion: 1, seq: 0, points: points(5) } }, NOW);
    await db.transaction(tx => deleteAccountWithOwnedEvents(tx, s.editor.accountId, NOW));
    expect(await db.select().from(schema.mapProjectTracks).where(eq(schema.mapProjectTracks.id, trackId))).toEqual([]);
    expect(await db.select().from(schema.mapProjectTrackParts).where(eq(schema.mapProjectTrackParts.trackId, trackId))).toEqual([]);
  });
});
