import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDatabase, migrate, schema } from "@o-tid/database";
import { readMapFile, type MapObject } from "@o-tid/map-file";
import { baseKey, mapperChangesFile, newKey, objectRefAt, type MapRevisionChangeSet, type ObjectState } from "@o-tid/map-revision";
import { eq } from "drizzle-orm";
import { createClub, inviteClubMember, listMyClubs, readClub } from "../../src/clubs";
import { readClubArchive } from "../../src/club-archive";
import { uploadClubMapVersion } from "../../src/club-maps";
import { createMapRevision, listMapRevisions, readMapRevision, readMapRevisionBase, readMapRevisionLog, setMapRevisionStatus } from "../../src/map-revisions";
import { syncMapRevision } from "../../src/map-revision-sync";
import { createMapRevisionVersion, revisionNote, unavailableMapRevisionWriter, type MapRevisionWriter } from "../../src/map-revision-version";
import { registerTestAccount } from "./accounts";

/**
 * ADR-0208: kartrevideringen. Behörigheten (ägare, administratör och Kartrevidering ändrar; läsare ser; andra får inget), synken
 * per objekt med krockar bara på samma objekt, att nya objekt aldrig krockar och att samma ändring två gånger görs en gång, en
 * avslutad revidering som inte kvitterar något, och "Skapa ny kartversion" med en skrivare i testet (grenen kartfil-skrivning är
 * inte ihopslagen): en ny version med anteckningen, grundversionen orörd, och skälet när skrivaren vägrar eller saknas.
 * Kartan är den syntetiska fixturen.
 */
const base = process.env.TEST_DATABASE_URL;
if (!base) throw new Error("Testet kräver TEST_DATABASE_URL till en PostgreSQL-roll med CREATEDB");
const admin = createDatabase(base);
const databaseName = `otid_adr0208_${randomUUID().replaceAll("-", "")}`;
const url = new URL(base);
url.pathname = `/${databaseName}`;
const { db, pool } = createDatabase(url.href);
const NOW = new Date("2026-11-03T12:00:00Z");
const mapText = await readFile(new URL("../../../../fixtures/maps/kartfil.omap", import.meta.url), "utf8");
const mapBytes = new TextEncoder().encode(mapText);
const parsed = readMapFile(mapBytes);
async function* chunks(bytes: Uint8Array) { yield bytes; }

beforeAll(async () => {
  await admin.pool.query(`CREATE DATABASE "${databaseName}"`);
  await migrate(db, { migrationsFolder: new URL("../../../database/migrations", import.meta.url).pathname });
}, 60_000);
afterAll(async () => {
  await pool.end();
  if (!/^otid_adr0208_[a-f0-9]{32}$/.test(databaseName)) throw new Error("Ogiltig testdatabas för rensning");
  await admin.pool.query(`DROP DATABASE "${databaseName}"`);
  await admin.pool.end();
});

const pointIndex = parsed.objects.findIndex(object => object.kind === "point");
const lineIndex = parsed.objects.findIndex(object => object.kind === "line");
const pointObject = parsed.objects[pointIndex] as Extract<MapObject, { kind: "point" }>;
const moved = (dx: number): ObjectState => ({ kind: "OBJECT", object: { ...pointObject, at: { x: pointObject.at.x + dx, y: pointObject.at.y } } });
const POINT_KEY = baseKey(objectRefAt(parsed, pointIndex));

function edit(key: string, state: ObjectState, editBase: string | null, kind = "MOVE") {
  const ref = key.startsWith("b:") ? { index: Number(key.slice(2)) } : null;
  return { editId: randomUUID(), key, ref, base: editBase, state, kind, at: NOW.toISOString() };
}

async function club() {
  const owner = await registerTestAccount(db, undefined, NOW);
  const created = await createClub(db, { ...owner.proof, request: { formatVersion: 1, requestId: randomUUID(), name: "OK Revidering" } }, NOW);
  if (created.status !== "created") throw new Error("Ingen klubb");
  const clubId = created.club.clubId;
  const uploaded = await uploadClubMapVersion(db, { ...owner.proof, clubId, mapId: null, newMapName: "Skogen", fileName: "Skogen.omap", versionDate: "2025-05-01",
    note: null, body: chunks(mapBytes) }, NOW);
  if (uploaded.status !== "created") throw new Error(`Ingen karta: ${uploaded.status}`);
  const people = { mapper: await registerTestAccount(db, undefined, NOW), reader: await registerTestAccount(db, undefined, NOW),
    outsider: await registerTestAccount(db, undefined, NOW) };
  for (const [person, role] of [[people.mapper, "MAP_REVISER"], [people.reader, "READER"]] as const) {
    expect((await inviteClubMember(db, { ...owner.proof, clubId, request: { formatVersion: 1, requestId: randomUUID(), email: person.email, role } }, NOW)).status)
      .toBe("invited");
    await listMyClubs(db, person.proof, NOW);
  }
  const revision = await createMapRevision(db, { ...owner.proof, clubId, request: { formatVersion: 1, requestId: randomUUID(),
    baseVersionId: uploaded.versionId, title: "Rekning våren 2026" } }, NOW);
  if (revision.status !== "created") throw new Error(`Ingen revidering: ${revision.status}`);
  return { owner, ...people, clubId, mapId: uploaded.mapId, versionId: uploaded.versionId, revisionId: revision.revision.revisionId };
}

type Proof = Awaited<ReturnType<typeof registerTestAccount>>["proof"];
async function sync(proof: Proof, ids: { clubId: string; revisionId: string }, edits: unknown[], since = 0, clientId = "telefon-1") {
  const result = await syncMapRevision(db, { ...proof, ...ids, request: { formatVersion: 1, clientId, since, edits } }, NOW);
  if (result.status !== "ok") throw new Error(`Synken: ${result.status}`);
  return result.response;
}

describe("ADR-0208 kartrevideringen", () => {
  it("ägare, administratör och Kartrevidering ändrar, läsare ser, andra får inget", async () => {
    const setup = await club();
    const ids = { clubId: setup.clubId, revisionId: setup.revisionId };
    const view = await readMapRevision(db, { ...setup.mapper.proof, ...ids }, NOW);
    expect(view.status === "ok" && view.view.viewer).toMatchObject({ role: "MAP_REVISER", canEdit: true, canCreateVersion: false });
    expect(view.status === "ok" && view.view.participants.map(row => row.role).sort()).toEqual(["MAP_REVISER", "OWNER"]);
    const reader = await readMapRevision(db, { ...setup.reader.proof, ...ids }, NOW);
    expect(reader.status === "ok" && reader.view.viewer.canEdit).toBe(false);
    expect((await syncMapRevision(db, { ...setup.reader.proof, ...ids, request: { formatVersion: 1, clientId: "lasare-1", since: 0,
      edits: [edit(POINT_KEY, moved(1), null)] } }, NOW)).status).toBe("forbidden");
    expect((await sync(setup.reader.proof, ids, [])).results).toEqual([]);
    expect((await readMapRevision(db, { ...setup.outsider.proof, ...ids }, NOW)).status).toBe("not-found");
    expect((await listMapRevisions(db, { ...setup.outsider.proof, clubId: setup.clubId }, NOW)).status).toBe("not-found");
    // Kartrevidering ser revideringarna och grundfilen men inte arkivets träningar och kartor, och inte medlemmarna.
    expect((await readClubArchive(db, { ...setup.mapper.proof, clubId: setup.clubId }, NOW)).status).toBe("forbidden");
    const clubView = await readClub(db, { ...setup.mapper.proof, clubId: setup.clubId }, NOW);
    expect(clubView.status === "ok" && clubView.view.members).toEqual([]);
    expect((await readMapRevisionBase(db, { ...setup.mapper.proof, ...ids }, NOW)).status).toBe("ok");
    expect((await listMapRevisions(db, { ...setup.mapper.proof, clubId: setup.clubId }, NOW)).status).toBe("ok");
    // Bara ägare och administratörer startar, avslutar och skapar nya versioner.
    expect((await createMapRevision(db, { ...setup.mapper.proof, clubId: setup.clubId, request: { formatVersion: 1, requestId: randomUUID(),
      baseVersionId: setup.versionId, title: "Egen" } }, NOW)).status).toBe("forbidden");
    expect((await setMapRevisionStatus(db, { ...setup.mapper.proof, ...ids, request: { formatVersion: 1, status: "CLOSED" } }, NOW)).status).toBe("forbidden");
    expect((await createMapRevisionVersion(db, { ...setup.mapper.proof, ...ids, request: { formatVersion: 1, requestId: randomUUID() },
      writer: unavailableMapRevisionWriter }, NOW)).status).toBe("forbidden");
  });

  it("synkar per objekt: krock bara på samma objekt, nya objekt krockar aldrig, samma ändring görs en gång", async () => {
    const setup = await club();
    const ids = { clubId: setup.clubId, revisionId: setup.revisionId };
    const lineKey = baseKey(objectRefAt(parsed, lineIndex));
    const first = edit(POINT_KEY, moved(2), null);
    const ownerAdd = edit(newKey(randomUUID()), moved(5), null, "ADD");
    const owner = await sync(setup.owner.proof, ids, [first, ownerAdd]);
    expect(owner.results.map(row => row.status)).toEqual(["APPLIED", "APPLIED"]);
    expect(owner.seq).toBe(2);
    // Samma omgång igen (svaret kom inte fram): inget görs två gånger.
    const again = await sync(setup.owner.proof, ids, [first, ownerAdd]);
    expect(again.results.map(row => row.status)).toEqual(["DUPLICATE", "DUPLICATE"]);
    expect(again.seq).toBe(2);

    // Kartritaren hade inte hämtat: samma punkt krockar, linjen och det nya objektet går igenom.
    const mine = edit(POINT_KEY, moved(-3), null);
    const mapper = await sync(setup.mapper.proof, ids, [mine, edit(lineKey, { kind: "DELETED" }, null, "DELETE"), edit(newKey(randomUUID()), moved(7), null, "ADD")],
      0, "telefon-2");
    expect(mapper.results.map(row => row.status)).toEqual(["CONFLICT", "APPLIED", "APPLIED"]);
    const conflict = mapper.results[0]!;
    expect(conflict.status === "CONFLICT" && conflict.current?.state).toEqual(moved(2));
    expect(conflict.status === "CONFLICT" && conflict.current?.authorId).toBe(setup.owner.accountId);
    // Den senare väljer sitt eget läge: en ändring som bygger på den andras.
    const resolved = await sync(setup.mapper.proof, ids, [{ ...edit(POINT_KEY, moved(-3), first.editId, "RESOLVE") }], mapper.seq, "telefon-2");
    expect(resolved.results[0]!.status).toBe("APPLIED");
    // Ägaren hämtar sedan det som ändrats.
    const pulled = await sync(setup.owner.proof, ids, [], owner.seq);
    expect(pulled.objects.map(row => row.key).sort()).toEqual([POINT_KEY, lineKey, expect.stringMatching(/^n:/)].sort());
    expect(pulled.objects.find(row => row.key === POINT_KEY)?.version).toBe(2);
    const log = await readMapRevisionLog(db, { ...setup.owner.proof, ...ids }, NOW);
    expect(log.status === "ok" && log.log.entries.map(row => row.status).sort()).toEqual(["APPLIED", "APPLIED", "APPLIED", "APPLIED", "APPLIED", "CONFLICT"]);
    const view = await readMapRevision(db, { ...setup.owner.proof, ...ids }, NOW);
    expect(view.status === "ok" && view.view.revision.changedObjects).toBe(4);
    expect(view.status === "ok" && view.view.participants.find(row => row.role === "MAP_REVISER")?.edits).toBe(3);
  });

  it("en ogiltig ändring avvisas och en avslutad revidering kvitterar ingenting", async () => {
    const setup = await club();
    const ids = { clubId: setup.clubId, revisionId: setup.revisionId };
    const wrongRef = { ...edit(POINT_KEY, moved(1), null), ref: { index: pointIndex + 1 } };
    const broken = edit(POINT_KEY, { kind: "OBJECT", object: { kind: "point", symbol: "", at: { x: 0, y: 0 }, angle: 0 } } as ObjectState, null);
    const response = await sync(setup.owner.proof, ids, [wrongRef, broken]);
    expect(response.results).toEqual([{ editId: wrongRef.editId, status: "REJECTED", reason: "ref" }, { editId: broken.editId, status: "REJECTED", reason: "state" }]);
    expect((await setMapRevisionStatus(db, { ...setup.owner.proof, ...ids, request: { formatVersion: 1, status: "CLOSED" } }, NOW)).status).toBe("ok");
    const closed = await sync(setup.mapper.proof, ids, [edit(POINT_KEY, moved(1), null)]);
    expect(closed.status).toBe("CLOSED");
    expect(closed.results).toEqual([]);
    expect((await setMapRevisionStatus(db, { ...setup.owner.proof, ...ids, request: { formatVersion: 1, status: "OPEN" } }, NOW)).status).toBe("ok");
  });

  it("skapar en ny kartversion med anteckningen och behåller grundversionen", async () => {
    const setup = await club();
    const ids = { clubId: setup.clubId, revisionId: setup.revisionId };
    await sync(setup.mapper.proof, ids, [edit(POINT_KEY, moved(4), null), edit(newKey(randomUUID()), moved(8), null, "ADD")]);
    let received: MapRevisionChangeSet | undefined;
    const writer: MapRevisionWriter = { write: async ({ base: bytes, changes }) => {
      received = changes;
      const file = mapperChangesFile(new TextDecoder().decode(bytes), readMapFile(bytes), changes.changes)!;
      return { ok: true, bytes: new TextEncoder().encode(file), verification: ["Läst igen: 2 objekt"] };
    } };
    const requestId = randomUUID();
    const created = await createMapRevisionVersion(db, { ...setup.owner.proof, ...ids, request: { formatVersion: 1, requestId }, writer }, NOW);
    if (created.status !== "created") throw new Error(`Ingen version: ${created.status} ${"problem" in created ? created.problem : ""}`);
    expect(received?.baseSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(received?.changes.map(change => change.kind).sort()).toEqual(["ADD", "MODIFY"]);
    expect(created.fileName).toBe("Skogen reviderad 2026-11-03.omap");
    const [mapperAccount] = await db.select({ name: schema.userAccounts.displayName }).from(schema.userAccounts)
      .where(eq(schema.userAccounts.id, setup.mapper.accountId));
    expect(created.note).toBe(`Reviderad av ${mapperAccount!.name}, 2 ändringar`);
    const archive = await readClubArchive(db, { ...setup.owner.proof, clubId: setup.clubId }, NOW);
    const versions = archive.status === "ok" ? archive.list.maps.find(map => map.mapId === setup.mapId)!.versions : [];
    expect(versions.map(version => version.versionId)).toContain(setup.versionId);
    expect(versions.find(version => version.versionId === created.versionId)?.note).toBe(created.note);
    // Grundversionen är orörd.
    const original = await readMapRevisionBase(db, { ...setup.owner.proof, ...ids }, NOW);
    expect(original.status === "ok" && original.byteLength).toBe(mapBytes.byteLength);
    const view = await readMapRevision(db, { ...setup.owner.proof, ...ids }, NOW);
    expect(view.status === "ok" && view.view.revision).toMatchObject({ status: "CLOSED", result: { versionId: created.versionId } });
    // Samma begäran igen ger samma version; den avslutade revideringen öppnas inte igen.
    const replay = await createMapRevisionVersion(db, { ...setup.owner.proof, ...ids, request: { formatVersion: 1, requestId }, writer }, NOW);
    expect(replay.status === "created" && replay.versionId).toBe(created.versionId);
    expect((await setMapRevisionStatus(db, { ...setup.owner.proof, ...ids, request: { formatVersion: 1, status: "OPEN" } }, NOW)).status).toBe("conflict");
  });

  it("säger skälet när skrivaren saknas eller vägrar, och när kartan har en nyare version", async () => {
    const setup = await club();
    const ids = { clubId: setup.clubId, revisionId: setup.revisionId };
    const request = () => ({ formatVersion: 1, requestId: randomUUID() });
    expect(await createMapRevisionVersion(db, { ...setup.owner.proof, ...ids, request: request(), writer: unavailableMapRevisionWriter }, NOW))
      .toMatchObject({ status: "problem", problem: "NO_CHANGES" });
    await sync(setup.owner.proof, ids, [edit(POINT_KEY, moved(4), null)]);
    expect(await createMapRevisionVersion(db, { ...setup.owner.proof, ...ids, request: request(), writer: unavailableMapRevisionWriter }, NOW))
      .toMatchObject({ status: "problem", problem: "WRITER_UNAVAILABLE" });
    const refusing: MapRevisionWriter = { write: async () => ({ ok: false, problem: "WRITER_REFUSED", detail: "Objektet finns inte i filen." }) };
    expect(await createMapRevisionVersion(db, { ...setup.owner.proof, ...ids, request: request(), writer: refusing }, NOW))
      .toEqual({ status: "problem", problem: "WRITER_REFUSED", detail: "Objektet finns inte i filen." });
    const garbage: MapRevisionWriter = { write: async () => ({ ok: true, bytes: new TextEncoder().encode("inte en karta"), verification: [] }) };
    expect(await createMapRevisionVersion(db, { ...setup.owner.proof, ...ids, request: request(), writer: garbage }, NOW))
      .toMatchObject({ status: "problem", problem: "VERIFICATION_FAILED" });
    const newer = new TextEncoder().encode(mapText.replace("Syntetisk testkarta", "Syntetisk testkarta, ny version"));
    expect((await uploadClubMapVersion(db, { ...setup.owner.proof, clubId: setup.clubId, mapId: setup.mapId, newMapName: null, fileName: "Skogen 2.omap",
      versionDate: "2026-11-02", note: null, body: chunks(newer) }, new Date(NOW.getTime() + 1000))).status).toBe("created");
    expect(await createMapRevisionVersion(db, { ...setup.owner.proof, ...ids, request: request(), writer: refusing }, NOW))
      .toEqual({ status: "problem", problem: "NEWER_VERSION", detail: "Skogen 2.omap" });
    const view = await readMapRevision(db, { ...setup.owner.proof, ...ids }, NOW);
    expect(view.status === "ok" && view.view.newerVersion?.fileName).toBe("Skogen 2.omap");
  });

  it("skriver anteckningen kort", () => {
    expect(revisionNote(["Anna"], 1)).toBe("Reviderad av Anna, 1 ändring");
    expect(revisionNote(["Anna", "Bo", "Cia"], 12)).toBe("Reviderad av Anna, Bo och Cia, 12 ändringar");
    expect(revisionNote(Array.from({ length: 80 }, (_, index) => `Person ${index}`), 3).length).toBeLessThanOrEqual(500);
  });
});
