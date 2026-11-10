import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDatabase, migrate } from "@o-tid/database";
import { createMapProjectFromUpload, inviteMapProjectMember, readMapProject } from "../../src/map-projects";
import {
  createMapProjectSketch, createMapProjectSketches, createMapProjectWorkLayer, deleteMapProjectSketch, deleteMapProjectWorkLayer, listMapProjectWorkLayers, updateMapProjectWorkLayer
} from "../../src/map-project-work-layers";
import { registerTestAccount } from "./accounts";

/**
 * ADR-0219 (ägaren 2026-11-09, lagren fas 2, migration 0107): arbetslager (normens symboler i en egen grupp) och skisslager med
 * skisser. Ändra kan lägga till, Läsa bara se; den som skapade och ägarna ändrar och tar bort; ett skisslager tas bort med
 * sina skisser; samma id två gånger blir ett.
 */
const base = process.env.TEST_DATABASE_URL;
if (!base) throw new Error("Testet kräver TEST_DATABASE_URL till en PostgreSQL-roll med CREATEDB");
const admin = createDatabase(base);
const databaseName = `otid_adr0219w_${randomUUID().replaceAll("-", "")}`;
const url = new URL(base);
url.pathname = `/${databaseName}`;
const { db, pool } = createDatabase(url.href);
const NOW = new Date("2026-11-09T12:00:00Z");
const mapBytes = new Uint8Array(await readFile(new URL("../../../../fixtures/maps/kartfil.omap", import.meta.url)));

beforeAll(async () => {
  await admin.pool.query(`CREATE DATABASE "${databaseName}"`);
  await migrate(db, { migrationsFolder: new URL("../../../database/migrations", import.meta.url).pathname });
}, 60_000);
afterAll(async () => {
  await pool.end();
  if (!/^otid_adr0219w_[a-f0-9]{32}$/.test(databaseName)) throw new Error("Ogiltig testdatabas för rensning");
  await admin.pool.query(`DROP DATABASE "${databaseName}"`);
  await admin.pool.end();
});

describe("ADR-0219: arbetslager och skisslager", () => {
  it("lägga till, lista, ändra och ta bort; behörigheten; skisslagret tas bort med skisserna", async () => {
    const owner = await registerTestAccount(db, undefined, NOW);
    const created = await createMapProjectFromUpload(db, { ...owner.proof, metadata: { formatVersion: 1, requestId: randomUUID(), name: "Lager",
      fileName: "Lager.omap" }, file: mapBytes }, NOW);
    if (created.status !== "created") throw new Error(created.status);
    const projectId = created.projectId;
    const editor = await registerTestAccount(db, undefined, NOW), reader = await registerTestAccount(db, undefined, NOW);
    for (const [person, role] of [[editor, "EDIT"], [reader, "READ"]] as const) {
      await inviteMapProjectMember(db, { ...owner.proof, projectId, request: { formatVersion: 1, requestId: randomUUID(), email: person.email, role } }, NOW);
      await readMapProject(db, { ...person.proof, projectId }, NOW);
    }
    const work = { formatVersion: 1, layerId: randomUUID(), kind: "SYMBOLS", name: "Stigar att reka", codes: ["505", "506", "505", "507"] };
    expect((await createMapProjectWorkLayer(db, { ...reader.proof, projectId, request: work }, NOW)).status).toBe("forbidden");
    expect((await createMapProjectWorkLayer(db, { ...editor.proof, projectId, request: { ...work, codes: [] } }, NOW)).status).toBe("invalid-request");
    const added = await createMapProjectWorkLayer(db, { ...editor.proof, projectId, request: work }, NOW);
    expect(added).toMatchObject({ status: "created", replayed: false, layer: { kind: "SYMBOLS", name: "Stigar att reka", codes: ["505", "506", "507"], own: true } });
    expect(await createMapProjectWorkLayer(db, { ...editor.proof, projectId, request: work }, NOW)).toMatchObject({ status: "created", replayed: true });
    expect((await createMapProjectWorkLayer(db, { ...owner.proof, projectId, request: work }, NOW)).status).toBe("conflict");

    const sketchLayer = { formatVersion: 1, layerId: randomUUID(), kind: "SKETCH", name: "Fältskisser", color: "#1f5fbf" };
    expect(await createMapProjectWorkLayer(db, { ...editor.proof, projectId, request: sketchLayer }, NOW)).toMatchObject({ status: "created",
      layer: { kind: "SKETCH", codes: [], color: "#1f5fbf" } });
    const line = { formatVersion: 1, sketchId: randomUUID(), layerId: sketchLayer.layerId, kind: "LINE", points: [[1, 2], [3, 4], [5, 4]] };
    expect(await createMapProjectSketch(db, { ...editor.proof, projectId, request: line }, NOW)).toMatchObject({ status: "created", sketch: { kind: "LINE", own: true } });
    expect(await createMapProjectSketch(db, { ...editor.proof, projectId, request: line }, NOW)).toMatchObject({ status: "created", replayed: true });
    const text = { formatVersion: 1, sketchId: randomUUID(), layerId: sketchLayer.layerId, kind: "TEXT", points: [[7, 7]], text: "Ny stig?" };
    expect((await createMapProjectSketch(db, { ...owner.proof, projectId, request: text }, NOW)).status).toBe("created");
    expect((await createMapProjectSketch(db, { ...owner.proof, projectId, request: { ...text, sketchId: randomUUID(), text: undefined } }, NOW)).status)
      .toBe("invalid-request");
    // Ägaren 2026-11-10: många skisser i ett anrop (en äldre vektorfil); samma id igen räknas inte två gånger.
    const many = { formatVersion: 1, layerId: sketchLayer.layerId, sketches: [
      { sketchId: randomUUID(), kind: "POINT", points: [[10, 10]] }, { sketchId: randomUUID(), kind: "LINE", points: [[0, 0], [5, 5]] }] };
    expect(await createMapProjectSketches(db, { ...editor.proof, projectId, request: many }, NOW)).toEqual({ status: "created", created: 2 });
    expect(await createMapProjectSketches(db, { ...editor.proof, projectId, request: many }, NOW)).toEqual({ status: "created", created: 0 });
    expect((await createMapProjectSketches(db, { ...reader.proof, projectId, request: many }, NOW)).status).toBe("forbidden");
    expect((await createMapProjectSketches(db, { ...editor.proof, projectId, request: { ...many, layerId: work.layerId } }, NOW)).status).toBe("not-found");
    // En skiss i ett arbetslager (inte skisslager) finns inte.
    expect((await createMapProjectSketch(db, { ...owner.proof, projectId, request: { ...line, sketchId: randomUUID(), layerId: work.layerId } }, NOW)).status)
      .toBe("not-found");
    expect((await createMapProjectSketch(db, { ...reader.proof, projectId, request: { ...line, sketchId: randomUUID() } }, NOW)).status).toBe("forbidden");

    const listed = await listMapProjectWorkLayers(db, { ...reader.proof, projectId }, NOW);
    expect(listed.status === "ok" && [listed.list.layers.map(layer => layer.name).sort(), listed.list.sketches.map(sketch => sketch.kind).sort()])
      .toEqual([["Fältskisser", "Stigar att reka"], ["LINE", "LINE", "POINT", "TEXT"]]);

    // Ändra: den som skapade eller ägarna; skisslager har inga symboler.
    expect((await updateMapProjectWorkLayer(db, { ...reader.proof, projectId, layerId: work.layerId, request: { formatVersion: 1, name: "X" } }, NOW)).status)
      .toBe("forbidden");
    expect(await updateMapProjectWorkLayer(db, { ...owner.proof, projectId, layerId: work.layerId, request: { formatVersion: 1, codes: ["505"] } }, NOW))
      .toMatchObject({ status: "ok", layer: { codes: ["505"], own: false } });
    expect((await updateMapProjectWorkLayer(db, { ...editor.proof, projectId, layerId: sketchLayer.layerId, request: { formatVersion: 1, codes: ["505"] } },
      NOW)).status).toBe("invalid-request");

    // Ta bort: en annan persons skiss bara som ägare; skisslagret tar skisserna med sig.
    expect((await deleteMapProjectSketch(db, { ...editor.proof, projectId, sketchId: text.sketchId }, NOW)).status).toBe("forbidden");
    expect((await deleteMapProjectSketch(db, { ...owner.proof, projectId, sketchId: text.sketchId }, NOW)).status).toBe("deleted");
    expect((await deleteMapProjectWorkLayer(db, { ...editor.proof, projectId, layerId: sketchLayer.layerId }, NOW)).status).toBe("deleted");
    const after = await listMapProjectWorkLayers(db, { ...owner.proof, projectId }, NOW);
    expect(after.status === "ok" && [after.list.layers.length, after.list.sketches.length]).toEqual([1, 0]);
  });
});
