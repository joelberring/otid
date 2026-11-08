import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { createDatabase, migrate, schema } from "@o-tid/database";
import { sha256Hex } from "@o-tid/map-file";
import { createMapProjectFromUpload, inviteMapProjectMember, readMapProject } from "../../src/map-projects";
import {
  createMapProjectLayer, deleteMapProjectLayer, listMapProjectLayers, readMapProjectLayerImage, updateMapProjectLayer
} from "../../src/map-project-layers";
import { registerTestAccount } from "./accounts";

/**
 * ADR-0219 tillägget om underlagen (K4a): en georefererad bild läggs till, listas, ändras och tas bort; samma bild igen,
 * fel filtyp och Läsa; innehållet släpps när sista referensen försvinner. Rättelsen i 0097: innehåll som ett kartprojekt
 * pekar på släpps inte (borttagningen gav förut ett fel från främmande nyckeln).
 */
const base = process.env.TEST_DATABASE_URL;
if (!base) throw new Error("Testet kräver TEST_DATABASE_URL till en PostgreSQL-roll med CREATEDB");
const admin = createDatabase(base);
const databaseName = `otid_adr0219u_${randomUUID().replaceAll("-", "")}`;
const url = new URL(base);
url.pathname = `/${databaseName}`;
const { db, pool } = createDatabase(url.href);
const NOW = new Date("2026-11-08T12:00:00Z");
const mapBytes = new Uint8Array(await readFile(new URL("../../../../fixtures/maps/kartfil.omap", import.meta.url)));

beforeAll(async () => {
  await admin.pool.query(`CREATE DATABASE "${databaseName}"`);
  await migrate(db, { migrationsFolder: new URL("../../../database/migrations", import.meta.url).pathname });
}, 60_000);
afterAll(async () => {
  await pool.end();
  if (!/^otid_adr0219u_[a-f0-9]{32}$/.test(databaseName)) throw new Error("Ogiltig testdatabas för rensning");
  await admin.pool.query(`DROP DATABASE "${databaseName}"`);
  await admin.pool.end();
});

/** En PNG med rätt signatur och IHDR (200 × 100 px); resten behöver inte vara en riktig bild (servern avkodar aldrig). */
function png(seed: number): Uint8Array {
  const bytes = new Uint8Array(64);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
  const view = new DataView(bytes.buffer);
  view.setUint32(16, 200); view.setUint32(20, 100);
  bytes[40] = seed;
  return bytes;
}
const TRANSFORM = { a: 0.5, b: 0, c: 674000.25, d: 0, e: -0.5, f: 6581000.25 };

describe("ADR-0219 K4a: underlag", () => {
  it("lägga till, lista, ändra, ta bort; samma igen, fel typ och Läsa; innehållet släpps", async () => {
    const owner = await registerTestAccount(db, undefined, NOW);
    const created = await createMapProjectFromUpload(db, { ...owner.proof, metadata: { formatVersion: 1, requestId: randomUUID(), name: "Underlag",
      fileName: "Underlag.omap" }, file: mapBytes }, NOW);
    if (created.status !== "created") throw new Error(created.status);
    const projectId = created.projectId;
    const editor = await registerTestAccount(db, undefined, NOW), reader = await registerTestAccount(db, undefined, NOW);
    for (const [person, role] of [[editor, "EDIT"], [reader, "READ"]] as const) {
      await inviteMapProjectMember(db, { ...owner.proof, projectId, request: { formatVersion: 1, requestId: randomUUID(), email: person.email, role } }, NOW);
      await readMapProject(db, { ...person.proof, projectId }, NOW);
    }
    const metadata = { formatVersion: 1, requestId: randomUUID(), name: "Ortofoto 2023", crs: 3006, transform: TRANSFORM };
    const image = png(1);
    const added = await createMapProjectLayer(db, { ...editor.proof, projectId, metadata, file: image }, NOW);
    expect(added).toMatchObject({ status: "created", replayed: false, layer: { name: "Ortofoto 2023", mediaType: "image/png", width: 200, height: 100,
      crs: 3006, opacity: 0.5, own: true, byteLength: 64, sha256: sha256Hex(image) } });
    expect(await createMapProjectLayer(db, { ...editor.proof, projectId, metadata, file: image }, NOW)).toMatchObject({ status: "created", replayed: true });
    expect((await createMapProjectLayer(db, { ...editor.proof, projectId, metadata: { ...metadata, requestId: randomUUID() },
      file: new TextEncoder().encode("inte en bild") }, NOW)).status).toBe("unsupported-file");
    expect((await createMapProjectLayer(db, { ...editor.proof, projectId, metadata: { ...metadata, requestId: randomUUID(),
      transform: { ...TRANSFORM, a: 0, b: 0 } }, file: png(2) }, NOW)).status).toBe("invalid-request");
    expect((await createMapProjectLayer(db, { ...reader.proof, projectId, metadata: { ...metadata, requestId: randomUUID() }, file: png(3) }, NOW)).status)
      .toBe("forbidden");
    const layerId = added.status === "created" ? added.layer.layerId : "";
    const listed = await listMapProjectLayers(db, { ...reader.proof, projectId }, NOW);
    expect(listed.status === "ok" && listed.list.layers.map(layer => [layer.name, layer.own])).toEqual([["Ortofoto 2023", false]]);
    expect(await readMapProjectLayerImage(db, { ...reader.proof, projectId, layerId }, NOW)).toMatchObject({ status: "ok", mediaType: "image/png", byteLength: 64 });
    // Läsa får inte ändra; den som lade till får.
    expect((await updateMapProjectLayer(db, { ...reader.proof, projectId, layerId, request: { formatVersion: 1, opacity: 0.8 } }, NOW)).status).toBe("forbidden");
    const updated = await updateMapProjectLayer(db, { ...editor.proof, projectId, layerId, request: { formatVersion: 1, opacity: 0.8, name: "Flygbild" } }, NOW);
    expect(updated).toMatchObject({ status: "ok", layer: { name: "Flygbild" } });
    expect(updated.status === "ok" && updated.layer.opacity).toBeCloseTo(0.8, 5);
    // Ta bort: innehållet försvinner (ingen annan pekar på det).
    expect((await deleteMapProjectLayer(db, { ...owner.proof, projectId, layerId }, NOW)).status).toBe("deleted");
    expect(await db.select().from(schema.mapContents).where(eq(schema.mapContents.sha256, sha256Hex(image)))).toEqual([]);
  });

  it("rättelsen: innehåll som ett kartprojekt pekar på släpps inte", async () => {
    const owner = await registerTestAccount(db, undefined, NOW);
    const created = await createMapProjectFromUpload(db, { ...owner.proof, metadata: { formatVersion: 1, requestId: randomUUID(), name: "Grund",
      fileName: "Grund.omap" }, file: mapBytes }, NOW);
    expect(created.status).toBe("created");
    const sha = sha256Hex(mapBytes);
    // Förut: borttagningen av innehållet stoppades av främmande nyckeln (fel); nu släpps det inte alls.
    await db.execute(sql`select otid_map_content_release(${sha})`);
    expect((await db.select().from(schema.mapContents).where(eq(schema.mapContents.sha256, sha))).length).toBe(1);
  });
});
