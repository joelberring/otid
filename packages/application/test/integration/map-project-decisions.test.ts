import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDatabase, migrate } from "@o-tid/database";
import { createMapProjectFromUpload, inviteMapProjectMember, readMapProject } from "../../src/map-projects";
import { listMapProjectDecisions, recordMapProjectDecision } from "../../src/map-project-decisions";
import { registerTestAccount } from "./accounts";

/** Ägaren 2026-11-21 (idé 1): kartritarens beslut om ett utkast sparas, idempotent, bara för den som får föreslå; ägarna läser. */
const base = process.env.TEST_DATABASE_URL;
if (!base) throw new Error("Testet kräver TEST_DATABASE_URL till en PostgreSQL-roll med CREATEDB");
const admin = createDatabase(base);
const databaseName = `otid_beslut_${randomUUID().replaceAll("-", "")}`;
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
  if (!/^otid_beslut_[a-f0-9]{32}$/.test(databaseName)) throw new Error("Ogiltig testdatabas för rensning");
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

describe("kartritarens beslut (0132)", () => {
  it("sparas en gång, läses av ägaren, inte av läsare eller utomstående", async () => {
    const { owner, editor, reader, outsider, projectId } = await setup();
    const request = (decisionId: string) => ({ formatVersion: 1, decisionId, source: "Karttapullautin hela kartan – grundkarta", geoJobId: null,
      settings: { formline: 2 }, mode: "EXTEND", layers: [{ layer: "berg_i_dagen", symbol: "214", offered: 12, accepted: true },
        { layer: "oppen_mark_laser_foto", symbol: null, offered: 30, accepted: false }], addedKeys: ["new:1", "new:2"] });
    const id = randomUUID();
    expect(await recordMapProjectDecision(db, { ...editor.proof, projectId, request: request(id) }, NOW)).toEqual({ status: "recorded", replayed: false });
    expect(await recordMapProjectDecision(db, { ...editor.proof, projectId, request: request(id) }, NOW)).toEqual({ status: "recorded", replayed: true });
    expect((await recordMapProjectDecision(db, { ...owner.proof, projectId, request: request(id) }, NOW)).status).toBe("conflict");
    expect((await recordMapProjectDecision(db, { ...reader.proof, projectId, request: request(randomUUID()) }, NOW)).status).toBe("forbidden");
    expect((await recordMapProjectDecision(db, { ...outsider.proof, projectId, request: request(randomUUID()) }, NOW)).status).not.toBe("recorded");
    expect((await recordMapProjectDecision(db, { ...editor.proof, projectId, request: { ...request(randomUUID()), mode: "MERGE" } }, NOW)).status).toBe("invalid-request");
    const list = await listMapProjectDecisions(db, { ...owner.proof, projectId }, NOW);
    expect(list.status).toBe("ok");
    if (list.status === "ok") expect(list.list).toEqual([expect.objectContaining({ decisionId: id, mode: "EXTEND", added: 2 })]);
    expect((await listMapProjectDecisions(db, { ...editor.proof, projectId }, NOW)).status).toBe("forbidden");
  });
});
