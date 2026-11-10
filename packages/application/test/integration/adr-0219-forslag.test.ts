import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { createDatabase, migrate, schema } from "@o-tid/database";
import { readMapFile, sha256Hex, type MapObject } from "@o-tid/map-file";
import { baseKey, newKey, objectRefFor, type ObjectState } from "@o-tid/map-revision";
import { createMapProjectFromUpload, inviteMapProjectMember, readMapProject, removeMapProjectMember, updateMapProject } from "../../src/map-projects";
import { syncMapProject } from "../../src/map-project-sync";
import { createMapProjectArea, deleteMapProjectArea, listMapProjectAreas, updateMapProjectArea } from "../../src/map-project-areas";
import { createMapProjectProposal, decideAllMapProjectProposals, decideMapProjectProposal, listMapProjectProposals } from "../../src/map-project-proposals";
import { deleteAccountWithOwnedEvents } from "../../src/account-self-service";
import { registerTestAccount } from "./accounts";

/**
 * ADR-0219 tillägget om arbetssätt (K1): Gemensamt och Huvudkartritare, Föreslå, delområden (eget och någon annans), synken som
 * gör ändringar till ett förslag per anrop med `PROPOSED` och samma förslag igen, godkänna (gjord och krock), avvisa, dra
 * tillbaka, ett uttryckligt förslag med anteckning, behörigheten och att den som fått ett område nollställs.
 */
const base = process.env.TEST_DATABASE_URL;
if (!base) throw new Error("Testet kräver TEST_DATABASE_URL till en PostgreSQL-roll med CREATEDB");
const admin = createDatabase(base);
const databaseName = `otid_adr0219f_${randomUUID().replaceAll("-", "")}`;
const url = new URL(base);
url.pathname = `/${databaseName}`;
const { db, pool } = createDatabase(url.href);
const NOW = new Date("2026-11-07T21:00:00Z");
const mapBytes = new Uint8Array(await readFile(new URL("../../../../fixtures/maps/kartfil.omap", import.meta.url)));
const SHA = sha256Hex(mapBytes);
const parsed = readMapFile(mapBytes, "Skogen.omap", { sources: true });

beforeAll(async () => {
  await admin.pool.query(`CREATE DATABASE "${databaseName}"`);
  await migrate(db, { migrationsFolder: new URL("../../../database/migrations", import.meta.url).pathname });
}, 60_000);
afterAll(async () => {
  await pool.end();
  if (!/^otid_adr0219f_[a-f0-9]{32}$/.test(databaseName)) throw new Error("Ogiltig testdatabas för rensning");
  await admin.pool.query(`DROP DATABASE "${databaseName}"`);
  await admin.pool.end();
});

const pointObject = parsed.objects.find(object => object.kind === "point") as Extract<MapObject, { kind: "point" }>;
const lineObject = parsed.objects.find(object => object.kind === "line")!;
const POINT_REF = objectRefFor(SHA, pointObject)!;
const LINE_REF = objectRefFor(SHA, lineObject)!;
const moved = (dx: number): ObjectState => ({ kind: "OBJECT", object: { ...pointObject, at: { x: pointObject.at.x + dx, y: pointObject.at.y } } });
const added = (x: number, y: number): ObjectState => ({ kind: "OBJECT", object: { kind: "point", symbol: pointObject.symbol, at: { x, y }, angle: 0 } });
const square = (x0: number, y0: number, size = 100) => [[{ x: x0, y: y0 }, { x: x0 + size, y: y0 }, { x: x0 + size, y: y0 + size }, { x: x0, y: y0 + size }]];
// Kartritarens område och den andra kartritarens, långt från grundfilens objekt.
const MINE = { x: 10_000, y: 10_000 }, THEIRS = { x: 20_000, y: 10_000 };
const inMine = () => added(MINE.x + 50, MINE.y + 50), inTheirs = () => added(THEIRS.x + 50, THEIRS.y + 50), outside = () => added(-30_000, 0);

function edit(key: string, state: ObjectState, editBase: string | null, kind = "MOVE", extra: Record<string, unknown> = {}) {
  const ref = key === baseKey(POINT_REF) ? POINT_REF : key === baseKey(LINE_REF) ? LINE_REF : null;
  return { editId: randomUUID(), key, ref, base: editBase, state, kind, at: NOW.toISOString(), ...extra };
}
const add = (state: ObjectState) => edit(newKey(randomUUID()), state, null, "ADD");
type Proof = Awaited<ReturnType<typeof registerTestAccount>>["proof"];
type Result = { editId: string; status: string; proposalId?: string };

async function setup() {
  const owner = await registerTestAccount(db, undefined, NOW);
  const created = await createMapProjectFromUpload(db, { ...owner.proof, metadata: { formatVersion: 1, requestId: randomUUID(), name: "Kungshatt",
    fileName: "Kungshatt.omap" }, file: mapBytes }, NOW);
  if (created.status !== "created") throw new Error(created.status);
  const projectId = created.projectId;
  const people = { editor: await registerTestAccount(db, undefined, NOW), editor2: await registerTestAccount(db, undefined, NOW),
    suggester: await registerTestAccount(db, undefined, NOW), reader: await registerTestAccount(db, undefined, NOW),
    outsider: await registerTestAccount(db, undefined, NOW) };
  for (const [person, role] of [[people.editor, "EDIT"], [people.editor2, "EDIT"], [people.suggester, "SUGGEST"], [people.reader, "READ"]] as const) {
    expect((await inviteMapProjectMember(db, { ...owner.proof, projectId, request: { formatVersion: 1, requestId: randomUUID(), email: person.email,
      role } }, NOW)).status).toBe("invited");
    // Inbjudan tas när projektet öppnas.
    expect((await readMapProject(db, { ...person.proof, projectId }, NOW)).status).toBe("ok");
  }
  const area = async (name: string, corner: { x: number; y: number }, assigneeAccountId: string | null) => {
    const result = await createMapProjectArea(db, { ...owner.proof, projectId, request: { formatVersion: 1, requestId: randomUUID(), name,
      polygon: square(corner.x, corner.y), assigneeAccountId } }, NOW);
    if (result.status !== "created") throw new Error(`Inget område: ${result.status}`);
    return result.area.areaId;
  };
  const mine = await area("Norra delen", MINE, people.editor.accountId);
  const theirs = await area("Södra delen", THEIRS, people.editor2.accountId);
  return { owner, ...people, projectId, areas: { mine, theirs } };
}

async function sync(proof: Proof, projectId: string, edits: unknown[], since = 0) {
  const result = await syncMapProject(db, { ...proof, projectId, request: { formatVersion: 1, clientId: "dator-1", since, edits } }, NOW);
  if (result.status !== "ok") throw new Error(`Synken: ${result.status}`);
  return { ...result.response, results: result.response.results as Result[] };
}
const statuses = (results: Result[], edits: { editId: string }[]) => edits.map(row => results.find(result => result.editId === row.editId)?.status);
async function proposalCount(projectId: string) {
  return (await db.select().from(schema.mapProjectProposals).where(eq(schema.mapProjectProposals.projectId, projectId))).length;
}

describe("ADR-0219 K1: arbetssätt, förslag och delområden", () => {
  it("Gemensamt: Ändra direkt utom i någon annans område, Föreslå alltid förslag, ett förslag per anrop och samma igen", async () => {
    const s = await setup();
    const edits = [add(outside()), add(inMine()), add(inTheirs()), add(inTheirs())];
    const first = await sync(s.editor.proof, s.projectId, edits);
    expect(statuses(first.results, edits)).toEqual(["APPLIED", "APPLIED", "PROPOSED", "PROPOSED"]);
    const proposalId = first.results.find(result => result.status === "PROPOSED")!.proposalId!;
    expect(first.results.filter(result => result.status === "PROPOSED").map(result => result.proposalId)).toEqual([proposalId, proposalId]);
    expect(first.openProposals).toEqual([proposalId]);
    expect(first.seq).toBe(2);
    // Samma omgång igen (svaret kom aldrig fram): samma utfall, inget nytt förslag.
    const again = await sync(s.editor.proof, s.projectId, edits, first.seq);
    expect(statuses(again.results, edits)).toEqual(["DUPLICATE", "DUPLICATE", "PROPOSED", "PROPOSED"]);
    expect(again.results.find(result => result.status === "PROPOSED")!.proposalId).toBe(proposalId);
    expect(await proposalCount(s.projectId)).toBe(1);
    // Den andra kartritaren ritar fritt i sitt område; ägaren överallt; Föreslå bara förslag.
    const editor2 = [add(inTheirs())];
    expect(statuses((await sync(s.editor2.proof, s.projectId, editor2)).results, editor2)).toEqual(["APPLIED"]);
    const owner = [add(inMine()), add(inTheirs())];
    expect(statuses((await sync(s.owner.proof, s.projectId, owner)).results, owner)).toEqual(["APPLIED", "APPLIED"]);
    const suggested = [add(outside()), edit(baseKey(POINT_REF), moved(3), null)];
    const suggester = await sync(s.suggester.proof, s.projectId, suggested);
    expect(statuses(suggester.results, suggested)).toEqual(["PROPOSED", "PROPOSED"]);
    expect(suggester.openProposals).toHaveLength(1);
    expect(await proposalCount(s.projectId)).toBe(2);
    // Läsa kan inte föreslå; den som inte är med ser inget.
    expect((await syncMapProject(db, { ...s.reader.proof, projectId: s.projectId, request: { formatVersion: 1, clientId: "l", since: 0,
      edits: [add(outside())] } }, NOW)).status).toBe("forbidden");
    expect((await createMapProjectProposal(db, { ...s.reader.proof, projectId: s.projectId, request: { formatVersion: 1, requestId: randomUUID(),
      edits: [add(outside())] } }, NOW)).status).toBe("forbidden");
    expect((await listMapProjectProposals(db, { ...s.outsider.proof, projectId: s.projectId }, NOW)).status).toBe("not-found");
    expect((await listMapProjectAreas(db, { ...s.outsider.proof, projectId: s.projectId }, NOW)).status).toBe("not-found");
    expect((await decideMapProjectProposal(db, { ...s.outsider.proof, projectId: s.projectId, proposalId, request: { formatVersion: 1,
      action: "ACCEPT" } }, NOW)).status).toBe("not-found");
    // Projektets vy: arbetssättet, områdena, öppna förslag och vad var och en får.
    const view = await readMapProject(db, { ...s.suggester.proof, projectId: s.projectId }, NOW);
    expect(view.status === "ok" && view.view).toMatchObject({ role: "SUGGEST", mode: "SHARED", openProposals: 2,
      viewer: { canEdit: false, canPropose: true, canDecide: false } });
    expect(view.status === "ok" && view.view.areas.map(area => [area.name, area.assignee?.accountId, area.status])).toEqual([
      ["Norra delen", s.editor.accountId, "BASE"], ["Södra delen", s.editor2.accountId, "BASE"]]);
    const reader = await readMapProject(db, { ...s.reader.proof, projectId: s.projectId }, NOW);
    expect(reader.status === "ok" && reader.view.viewer).toMatchObject({ canPropose: false, canDecide: false });
    const owners = await readMapProject(db, { ...s.owner.proof, projectId: s.projectId }, NOW);
    expect(owners.status === "ok" && owners.view.viewer).toMatchObject({ canPropose: true, canDecide: true });
    expect(owners.status === "ok" && owners.view.members.map(member => member.role)).toEqual(["OWNER", "EDIT", "EDIT", "SUGGEST", "READ"]);
  });

  it("Huvudkartritare: Ändra direkt bara i eget område; delområdenas status och behörighet", async () => {
    const s = await setup();
    expect((await updateMapProject(db, { ...s.editor.proof, projectId: s.projectId, request: { formatVersion: 1, mode: "LEAD" } }, NOW)).status)
      .toBe("forbidden");
    expect((await updateMapProject(db, { ...s.owner.proof, projectId: s.projectId, request: { formatVersion: 1, mode: "LEAD" } }, NOW)).status)
      .toBe("ok");
    const view = await readMapProject(db, { ...s.editor.proof, projectId: s.projectId }, NOW);
    expect(view.status === "ok" && view.view.mode).toBe("LEAD");
    // Borttagning av ett objekt som servern bara har i grundfilen: platsen är ändringens punkt.
    const line = edit(baseKey(LINE_REF), { kind: "DELETED" }, null, "DELETE", { point: { x: MINE.x + 10, y: MINE.y + 10 } });
    const point = edit(baseKey(POINT_REF), { kind: "DELETED" }, null, "DELETE");
    const edits = [add(inMine()), add(outside()), add(inTheirs()), line, point];
    expect(statuses((await sync(s.editor.proof, s.projectId, edits)).results, edits)).toEqual(["APPLIED", "PROPOSED", "PROPOSED", "APPLIED", "PROPOSED"]);
    const owner = [add(outside())];
    expect(statuses((await sync(s.owner.proof, s.projectId, owner)).results, owner)).toEqual(["APPLIED"]);
    // Tillbaka till Gemensamt.
    expect((await updateMapProject(db, { ...s.owner.proof, projectId: s.projectId, request: { formatVersion: 1, mode: "SHARED" } }, NOW)).status)
      .toBe("ok");
    const shared = [add(outside())];
    expect(statuses((await sync(s.editor.proof, s.projectId, shared)).results, shared)).toEqual(["APPLIED"]);

    // Den som fått området ändrar bara statusen; ägarna allt.
    const status = (proof: Proof, areaId: string, request: Record<string, unknown>) =>
      updateMapProjectArea(db, { ...proof, projectId: s.projectId, areaId, request: { formatVersion: 1, ...request } }, NOW);
    expect(await status(s.editor.proof, s.areas.mine, { status: "SURVEYED" })).toMatchObject({ status: "ok", area: { status: "SURVEYED", revisedOn: null } });
    // Etapperna (0098): klart utan datum ger dagens; den som fått området sätter och tar bort datumet; fel datum avvisas.
    expect(await status(s.editor.proof, s.areas.mine, { status: "DONE" })).toMatchObject({ status: "ok", area: { status: "DONE",
      revisedOn: NOW.toISOString().slice(0, 10) } });
    expect(await status(s.editor.proof, s.areas.mine, { revisedOn: "2024-05-31" })).toMatchObject({ status: "ok", area: { revisedOn: "2024-05-31" } });
    expect(await status(s.editor.proof, s.areas.mine, { status: "SURVEYED" })).toMatchObject({ area: { revisedOn: "2024-05-31" } });
    expect(await status(s.editor.proof, s.areas.mine, { status: "DONE" })).toMatchObject({ area: { revisedOn: "2024-05-31" } });
    expect((await status(s.editor.proof, s.areas.mine, { revisedOn: "2024-02-30" })).status).toBe("invalid-request");
    expect(await status(s.owner.proof, s.areas.mine, { revisedOn: null })).toMatchObject({ status: "ok", area: { revisedOn: null } });
    expect(await status(s.editor.proof, s.areas.mine, { status: "SURVEYED" })).toMatchObject({ status: "ok" });
    expect((await status(s.editor.proof, s.areas.mine, { name: "Mitt" })).status).toBe("forbidden");
    expect((await status(s.editor.proof, s.areas.theirs, { status: "DONE" })).status).toBe("forbidden");
    expect(await status(s.owner.proof, s.areas.theirs, { name: "Södra", assigneeAccountId: s.editor.accountId }))
      .toMatchObject({ status: "ok", area: { name: "Södra", assignee: { accountId: s.editor.accountId } } });
    expect((await status(s.owner.proof, s.areas.theirs, { assigneeAccountId: s.outsider.accountId })).status).toBe("invalid-request");
    expect((await status(s.owner.proof, s.areas.theirs, { polygon: [[{ x: 0, y: 0 }, { x: 1, y: 1 }]] })).status).toBe("invalid-request");
    const requestId = randomUUID();
    const create = () => createMapProjectArea(db, { ...s.owner.proof, projectId: s.projectId, request: { formatVersion: 1, requestId, name: "Öster",
      polygon: square(0, 0), status: "DRAFTED" } }, NOW);
    const created = await create();
    expect(created).toMatchObject({ status: "created", replayed: false, area: { name: "Öster", assignee: null, status: "DRAFTED" } });
    expect(await create()).toMatchObject({ status: "created", replayed: true });
    expect((await createMapProjectArea(db, { ...s.editor.proof, projectId: s.projectId, request: { formatVersion: 1, requestId: randomUUID(),
      name: "Eget", polygon: square(0, 0) } }, NOW)).status).toBe("forbidden");
    if (created.status !== "created") throw new Error("inget område");
    expect((await deleteMapProjectArea(db, { ...s.editor.proof, projectId: s.projectId, areaId: created.area.areaId }, NOW)).status).toBe("forbidden");
    expect((await deleteMapProjectArea(db, { ...s.owner.proof, projectId: s.projectId, areaId: created.area.areaId }, NOW)).status).toBe("removed");
    const list = await listMapProjectAreas(db, { ...s.reader.proof, projectId: s.projectId }, NOW);
    expect(list.status === "ok" && list.list.areas).toHaveLength(2);
  });

  it("Godkänn alla: alla öppna förslag i omgångar, bara ägarna (ägaren 2026-11-10)", async () => {
    const s = await setup();
    for (let index = 0; index < 4; index += 1) {
      const created = await createMapProjectProposal(db, { ...s.suggester.proof, projectId: s.projectId, request: { formatVersion: 1,
        requestId: randomUUID(), edits: [add(outside())] } }, NOW);
      expect(created.status).toBe("created");
    }
    const all = (proof: Proof, action: string, budget?: number) => decideAllMapProjectProposals(db, { ...proof, projectId: s.projectId,
      request: { formatVersion: 1, action } }, NOW, budget);
    expect((await all(s.editor.proof, "ACCEPT")).status).toBe("forbidden");
    expect((await all(s.owner.proof, "WITHDRAW")).status).toBe("invalid-request");
    // Ingen tid kvar efter det första: ett i taget, resten i nästa omgång.
    expect(await all(s.owner.proof, "ACCEPT", -1)).toMatchObject({ status: "ok", decided: 1, remaining: 3 });
    expect(await all(s.owner.proof, "ACCEPT")).toMatchObject({ status: "ok", decided: 3, conflicts: 0, remaining: 0 });
    const list = await listMapProjectProposals(db, { ...s.owner.proof, projectId: s.projectId }, NOW);
    expect(list.status === "ok" && list.list.proposals.map(row => row.status)).toEqual(["ACCEPTED", "ACCEPTED", "ACCEPTED", "ACCEPTED"]);
  });

  it("godkänna (gjord och krock), avvisa, dra tillbaka och ett uttryckligt förslag med anteckning", async () => {
    const s = await setup();
    const move = edit(baseKey(POINT_REF), moved(5), null);
    const extra = add(outside());
    const proposed = await sync(s.suggester.proof, s.projectId, [move, extra]);
    const proposalId = proposed.results[0]!.proposalId!;
    // Ägaren hinner flytta punkten själv: förslagets flytt bygger på grundfilens läge och krockar när det godkänns.
    const direct = await sync(s.owner.proof, s.projectId, [edit(baseKey(POINT_REF), moved(1), null)]);
    expect(direct.results[0]!.status).toBe("APPLIED");
    const decide = (proof: Proof, id: string, action: string, note?: string) => decideMapProjectProposal(db, { ...proof, projectId: s.projectId,
      proposalId: id, request: { formatVersion: 1, action, ...(note ? { note } : {}) } }, NOW);
    expect((await decide(s.editor.proof, proposalId, "ACCEPT")).status).toBe("forbidden");
    const accepted = await decide(s.owner.proof, proposalId, "ACCEPT");
    expect(accepted).toMatchObject({ status: "ok", replayed: false, seq: direct.seq + 1, proposal: { status: "ACCEPTED", source: "PERSON",
      author: { accountId: s.suggester.accountId }, decidedBy: { accountId: s.owner.accountId } } });
    expect(accepted.status === "ok" && accepted.proposal.edits.map(row => [row.editId, row.outcome])).toEqual([[move.editId, "CONFLICT"],
      [extra.editId, "APPLIED"]]);
    expect(await decide(s.owner.proof, proposalId, "ACCEPT")).toMatchObject({ status: "ok", replayed: true });
    expect((await decide(s.owner.proof, proposalId, "REJECT")).status).toBe("conflict");
    // Loggen: den som föreslog är författaren, den som godkände står i accepted_by.
    const [logged] = await db.select().from(schema.mapProjectEdits).where(and(eq(schema.mapProjectEdits.projectId, s.projectId),
      eq(schema.mapProjectEdits.editId, extra.editId)));
    expect(logged).toMatchObject({ status: "APPLIED", authorAccountId: s.suggester.accountId, acceptedBy: s.owner.accountId, proposalId });
    // Den som föreslog får objektet i hämtningen och förslaget är inte längre öppet.
    const after = await sync(s.suggester.proof, s.projectId, [], proposed.seq);
    expect(after.objects.map(object => (object as { lastEditId: string }).lastEditId)).toContain(extra.editId);
    expect(after.openProposals).toEqual([]);
    // Samma ändring igen efter godkännandet: redan gjord.
    expect((await sync(s.suggester.proof, s.projectId, [extra], after.seq)).results[0]!.status).toBe("DUPLICATE");

    // Ett uttryckligt förslag med anteckning; samma begäran igen ger samma förslag.
    const requestId = randomUUID();
    const explicit = () => createMapProjectProposal(db, { ...s.suggester.proof, projectId: s.projectId, request: { formatVersion: 1, requestId,
      note: "Stigen går längre norrut", edits: [add(outside()), add(inTheirs())] } }, NOW);
    const second = await explicit();
    expect(second).toMatchObject({ status: "created", replayed: false, proposal: { status: "OPEN", note: "Stigen går längre norrut" } });
    if (second.status !== "created") throw new Error("inget förslag");
    expect(await explicit()).toMatchObject({ status: "created", replayed: true, proposal: { proposalId: second.proposal.proposalId } });
    // En ändring som redan finns i projektet kan inte föreslås igen.
    expect((await createMapProjectProposal(db, { ...s.suggester.proof, projectId: s.projectId, request: { formatVersion: 1,
      requestId: randomUUID(), edits: [extra] } }, NOW)).status).toBe("invalid-request");
    // Bara den som föreslog drar tillbaka; ett tillbakadraget förslag kan inte godkännas.
    expect((await decide(s.owner.proof, second.proposal.proposalId, "WITHDRAW")).status).toBe("forbidden");
    expect(await decide(s.suggester.proof, second.proposal.proposalId, "WITHDRAW")).toMatchObject({ status: "ok", proposal: { status: "WITHDRAWN" } });
    expect((await decide(s.owner.proof, second.proposal.proposalId, "ACCEPT")).status).toBe("conflict");
    // Avvisa med anteckning.
    const third = await createMapProjectProposal(db, { ...s.editor.proof, projectId: s.projectId, request: { formatVersion: 1, requestId: randomUUID(),
      edits: [add(outside())] } }, NOW);
    if (third.status !== "created") throw new Error("inget förslag");
    const open = await createMapProjectProposal(db, { ...s.editor2.proof, projectId: s.projectId, request: { formatVersion: 1, requestId: randomUUID(),
      edits: [add(outside())] } }, NOW);
    expect(await decide(s.owner.proof, third.proposal.proposalId, "REJECT", "Finns redan")).toMatchObject({ status: "ok",
      proposal: { status: "REJECTED", decisionNote: "Finns redan" } });
    // Listan: öppna först, sedan de senast avgjorda; alla medlemmar ser den.
    const list = await listMapProjectProposals(db, { ...s.reader.proof, projectId: s.projectId }, NOW);
    // (Alla avgjordes vid samma tid, så de avgjordas inbördes ordning prövas inte.)
    const order = list.status === "ok" ? list.list.proposals.map(row => row.status) : [];
    expect([order[0], [...order.slice(1)].sort()]).toEqual(["OPEN", ["ACCEPTED", "REJECTED", "WITHDRAWN"]]);
    expect(list.status === "ok" && list.list.proposals[0]).toMatchObject({ proposalId: open.status === "created" && open.proposal.proposalId,
      author: { accountId: s.editor2.accountId } });
    expect(list.status === "ok" && typeof list.list.proposals[0]!.author.name).toBe("string");
    // Ett avslutat projekt tar inte emot godkännanden.
    expect((await updateMapProject(db, { ...s.owner.proof, projectId: s.projectId, request: { formatVersion: 1, status: "CLOSED" } }, NOW)).status).toBe("ok");
    expect((await decide(s.owner.proof, list.status === "ok" ? list.list.proposals[0]!.proposalId : "", "ACCEPT")).status).toBe("conflict");
  });

  it("den som fått ett område nollställs när personen tas bort och när kontot tas bort; förslagen står kvar", async () => {
    const s = await setup();
    const proposed = await sync(s.editor.proof, s.projectId, [add(inTheirs())]);
    expect(proposed.results[0]!.status).toBe("PROPOSED");
    expect((await removeMapProjectMember(db, { ...s.owner.proof, projectId: s.projectId, request: { formatVersion: 1, accountId: s.editor.accountId,
      invitationId: null } }, NOW)).status).toBe("removed");
    await db.transaction(tx => deleteAccountWithOwnedEvents(tx, s.editor2.accountId, NOW));
    const areas = await listMapProjectAreas(db, { ...s.owner.proof, projectId: s.projectId }, NOW);
    expect(areas.status === "ok" && areas.list.areas.map(area => area.assignee)).toEqual([null, null]);
    const list = await listMapProjectProposals(db, { ...s.owner.proof, projectId: s.projectId }, NOW);
    expect(list.status === "ok" && list.list.proposals.map(row => [row.status, row.author.accountId])).toEqual([["OPEN", s.editor.accountId]]);
  });
});
