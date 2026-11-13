import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { createDatabase, migrate, schema } from "@o-tid/database";
import { createClub, inviteClubMember, listMyClubs } from "../../src/clubs";
import {
  acceptMapProjectJoinLink, addMapProjectClubMember, createMapProjectJoinLink, listMapProjectClubMembers, readMapProjectJoinLink,
  revokeMapProjectJoinLink
} from "../../src/map-project-join";
import { createMapProjectFromUpload, readMapProject, removeMapProjectMember, setMapProjectMemberRole } from "../../src/map-projects";
import { registerTestAccount } from "./accounts";

/**
 * Ägaren 2026-11-13: bjud in till ett kartprojekt utan e-post. Klubbmedlemmar läggs till direkt (bara konton i en klubb som
 * ägaren är med i, aldrig e-postadresser i listan) och en länk med en roll (gäller 14 dagar, kan användas av flera, kan tas bort).
 */
const base = process.env.TEST_DATABASE_URL;
if (!base) throw new Error("Testet kräver TEST_DATABASE_URL till en PostgreSQL-roll med CREATEDB");
const admin = createDatabase(base);
const databaseName = `otid_kartlank_${randomUUID().replaceAll("-", "")}`;
const url = new URL(base);
url.pathname = `/${databaseName}`;
const { db, pool } = createDatabase(url.href);
const NOW = new Date("2026-11-13T10:00:00Z");
const DAY = 24 * 60 * 60 * 1000;
const mapBytes = new Uint8Array(await readFile(new URL("../../../../fixtures/maps/kartfil.omap", import.meta.url)));

beforeAll(async () => {
  await admin.pool.query(`CREATE DATABASE "${databaseName}"`);
  await migrate(db, { migrationsFolder: new URL("../../../database/migrations", import.meta.url).pathname });
}, 60_000);
afterAll(async () => {
  await pool.end();
  if (!/^otid_kartlank_[a-f0-9]{32}$/.test(databaseName)) throw new Error("Ogiltig testdatabas för rensning");
  await admin.pool.query(`DROP DATABASE "${databaseName}"`);
  await admin.pool.end();
});

type Person = Awaited<ReturnType<typeof registerTestAccount>>;

async function joinClub(owner: Person, clubId: string, person: Person) {
  const invited = await inviteClubMember(db, { ...owner.proof, clubId, request: { formatVersion: 1, requestId: randomUUID(), email: person.email,
    role: "READER" } }, NOW);
  expect(invited.status).toBe("invited");
  await listMyClubs(db, person.proof, NOW);
}

async function setup() {
  const owner = await registerTestAccount(db, undefined, NOW);
  const created = await createClub(db, { ...owner.proof, request: { formatVersion: 1, requestId: randomUUID(), name: "OK Länk" } }, NOW);
  if (created.status !== "created") throw new Error("Ingen klubb");
  const clubId = created.club.clubId;
  const other = await createClub(db, { ...(await registerTestAccount(db, undefined, NOW)).proof, request: { formatVersion: 1, requestId: randomUUID(),
    name: "OK Annan" } }, NOW);
  if (other.status !== "created") throw new Error("Ingen annan klubb");
  const tag = randomUUID().slice(0, 6);
  const people = { anna: await registerTestAccount(db, `anna.${tag}`, NOW), bertil: await registerTestAccount(db, `bertil.${tag}`, NOW),
    elsewhere: await registerTestAccount(db, `annanklubb.${tag}`, NOW), nobody: await registerTestAccount(db, undefined, NOW),
    editor: await registerTestAccount(db, undefined, NOW), loner: await registerTestAccount(db, undefined, NOW) };
  await joinClub(owner, clubId, people.anna);
  await joinClub(owner, clubId, people.bertil);
  // Ett eget projekt (utan klubb): klubbmedlemskapet är ägarens, inte projektets.
  const project = await createMapProjectFromUpload(db, { ...owner.proof, metadata: { formatVersion: 1, requestId: randomUUID(), name: "Eget",
    fileName: "Eget.omap" }, file: mapBytes }, NOW);
  if (project.status !== "created") throw new Error(project.status);
  const projectId = project.projectId;
  // Någon med Ändra (får inte hantera medlemmar).
  const link = await createMapProjectJoinLink(db, { ...owner.proof, projectId, request: { formatVersion: 1, role: "EDIT" } }, NOW);
  if (link.status !== "created") throw new Error(link.status);
  expect((await acceptMapProjectJoinLink(db, { ...people.editor.proof, request: { formatVersion: 1, token: link.token } }, NOW)).status).toBe("joined");
  expect((await revokeMapProjectJoinLink(db, { ...owner.proof, projectId, request: { formatVersion: 1, linkId: link.linkId } }, NOW)).status).toBe("removed");
  return { owner, ...people, tag, clubId, otherClubId: other.club.clubId, projectId };
}

describe("kartprojekt: klubbmedlemmar och länk utan e-post", () => {
  it("listan visar bara namn från ägarens klubbar, aldrig e-postadresser eller konton utanför klubben", async () => {
    const s = await setup();
    const result = await listMapProjectClubMembers(db, { ...s.owner.proof, projectId: s.projectId }, NOW);
    if (result.status !== "ok") throw new Error(result.status);
    expect(result.response.clubs).toEqual(["OK Länk"]);
    expect(result.response.members.map(member => member.name)).toEqual([`Arrangör anna.${s.tag}`, `Arrangör bertil.${s.tag}`]);
    expect(result.response.members[0]).toEqual({ accountId: s.anna.accountId, name: `Arrangör anna.${s.tag}`, clubNames: ["OK Länk"] });
    expect(JSON.stringify(result.response)).not.toContain("@");
    expect(result.response.members.some(member => [s.elsewhere.accountId, s.nobody.accountId, s.owner.accountId].includes(member.accountId))).toBe(false);
    // Sökning på namn.
    const search = await listMapProjectClubMembers(db, { ...s.owner.proof, projectId: s.projectId, query: "BERT" }, NOW);
    expect(search.status === "ok" && search.response.members.map(member => member.name)).toEqual([`Arrangör bertil.${s.tag}`]);
    // Den som inte är med i någon klubb ser ingen lista.
    expect((await listMapProjectClubMembers(db, { ...s.editor.proof, projectId: s.projectId }, NOW)).status).toBe("forbidden");
  });

  it("en klubbmedlem läggs till direkt som medlem; ett konto utanför klubben går inte; redan med ger konflikt", async () => {
    const s = await setup();
    const add = (accountId: string, role = "EDIT") => addMapProjectClubMember(db,
      { ...s.owner.proof, projectId: s.projectId, request: { formatVersion: 1, accountId, role } }, NOW);
    expect((await add(s.anna.accountId)).status).toBe("added");
    expect((await add(s.anna.accountId)).status).toBe("conflict");
    expect((await add(s.elsewhere.accountId)).status).toBe("not-found");
    expect((await add(s.nobody.accountId)).status).toBe("not-found");
    expect((await add(randomUUID())).status).toBe("not-found");
    expect((await add(s.bertil.accountId, "ADMIN")).status).toBe("invalid-request");
    const view = await readMapProject(db, { ...s.anna.proof, projectId: s.projectId }, NOW);
    expect(view.status === "ok" && view.view).toMatchObject({ role: "EDIT", viewer: { canEdit: true, canManage: false } });
    // Annan är med nu och finns inte längre i listan.
    const list = await listMapProjectClubMembers(db, { ...s.owner.proof, projectId: s.projectId }, NOW);
    expect(list.status === "ok" && list.response.members.map(member => member.name)).toEqual([`Arrangör bertil.${s.tag}`]);
    // Den som inte får hantera medlemmar nekas, och den som inte är med ser inte projektet.
    expect((await addMapProjectClubMember(db, { ...s.anna.proof, projectId: s.projectId, request: { formatVersion: 1, accountId: s.bertil.accountId,
      role: "READ" } }, NOW)).status).toBe("forbidden");
    expect((await addMapProjectClubMember(db, { ...s.nobody.proof, projectId: s.projectId, request: { formatVersion: 1, accountId: s.bertil.accountId,
      role: "READ" } }, NOW)).status).toBe("not-found");
    // Ändringen står i medlemslistan som en vanlig medlem (rollen byts och tas bort som förut).
    expect((await setMapProjectMemberRole(db, { ...s.owner.proof, projectId: s.projectId, request: { formatVersion: 1, accountId: s.anna.accountId,
      role: "READ" } }, NOW)).status).toBe("ok");
    expect((await removeMapProjectMember(db, { ...s.owner.proof, projectId: s.projectId, request: { formatVersion: 1, accountId: s.anna.accountId,
      invitationId: null } }, NOW)).status).toBe("removed");
  });

  it("ägare utan klubb kan inte lägga till någon", async () => {
    const s = await setup();
    const project = await createMapProjectFromUpload(db, { ...s.loner.proof, metadata: { formatVersion: 1, requestId: randomUUID(), name: "Ensam",
      fileName: "Ensam.omap" }, file: mapBytes }, NOW);
    if (project.status !== "created") throw new Error(project.status);
    const list = await listMapProjectClubMembers(db, { ...s.loner.proof, projectId: project.projectId }, NOW);
    expect(list.status === "ok" && list.response).toEqual({ formatVersion: 1, clubs: [], members: [] });
    expect((await addMapProjectClubMember(db, { ...s.loner.proof, projectId: project.projectId, request: { formatVersion: 1,
      accountId: s.anna.accountId, role: "READ" } }, NOW)).status).toBe("not-found");
  });

  it("länken: skapas med roll, hashas, kan användas av flera, går ut efter 14 dagar och kan tas bort", async () => {
    const s = await setup();
    const proof = { ...s.owner.proof, projectId: s.projectId };
    // Bara ägare skapar länkar; Ägare kan inte vara länkens roll.
    expect((await createMapProjectJoinLink(db, { ...s.editor.proof, projectId: s.projectId, request: { formatVersion: 1, role: "READ" } }, NOW)).status).toBe("forbidden");
    expect((await createMapProjectJoinLink(db, { ...s.nobody.proof, projectId: s.projectId, request: { formatVersion: 1, role: "READ" } }, NOW)).status).toBe("not-found");
    expect((await createMapProjectJoinLink(db, { ...proof, request: { formatVersion: 1, role: "OWNER" } }, NOW)).status).toBe("invalid-request");
    const link = await createMapProjectJoinLink(db, { ...proof, request: { formatVersion: 1, role: "SUGGEST" } }, NOW);
    if (link.status !== "created") throw new Error(link.status);
    expect(link.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(link.expiresAt.getTime()).toBe(NOW.getTime() + 14 * DAY);
    // Bara hashen sparas.
    const stored = await db.select().from(schema.mapProjectJoinLinks).where(eq(schema.mapProjectJoinLinks.id, link.linkId));
    expect(stored[0]?.tokenHash).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(stored)).not.toContain(link.token);
    // Länksidan utan inloggning: projekt, roll och avsändare; okänd nyckel ger "invalid".
    expect(await readMapProjectJoinLink(db, link.token, NOW)).toMatchObject({ status: "valid", projectName: "Eget", role: "SUGGEST",
      inviterName: `Arrangör ${s.owner.email.split("@")[0]}` });
    expect(await readMapProjectJoinLink(db, "A".repeat(43), NOW)).toEqual({ formatVersion: 1, status: "invalid" });
    // Ägaren ser den öppna länken (aldrig nyckeln).
    const owner = await readMapProject(db, proof, NOW);
    expect(owner.status === "ok" && owner.view.joinLinks).toEqual([{ linkId: link.linkId, role: "SUGGEST", createdAt: NOW.toISOString(),
      expiresAt: new Date(NOW.getTime() + 14 * DAY).toISOString() }]);
    const asEditor = await readMapProject(db, { ...s.editor.proof, projectId: s.projectId }, NOW);
    expect(asEditor.status === "ok" && asEditor.view.joinLinks).toEqual([]);
    // Flera kan använda länken; var och en blir medlem med länkens roll. Den som redan är med får inte rollen sänkt.
    const join = (person: Person, at = NOW) => acceptMapProjectJoinLink(db, { ...person.proof, request: { formatVersion: 1, token: link.token } }, at);
    expect(await join(s.anna)).toMatchObject({ status: "joined", projectId: s.projectId, role: "SUGGEST", alreadyMember: false });
    expect(await join(s.bertil)).toMatchObject({ status: "joined", role: "SUGGEST" });
    expect(await join(s.bertil)).toMatchObject({ status: "joined", alreadyMember: true });
    expect(await join(s.editor)).toMatchObject({ status: "joined", role: "EDIT", alreadyMember: true });
    const view = await readMapProject(db, { ...s.anna.proof, projectId: s.projectId }, NOW);
    expect(view.status === "ok" && view.view).toMatchObject({ role: "SUGGEST", viewer: { canPropose: true, canEdit: false, canManage: false } });
    // Utan inloggning, med fel nyckel eller utan bekräftad e-post går det inte.
    expect((await acceptMapProjectJoinLink(db, { sessionToken: "x".repeat(43), csrfCookie: "y", csrfHeader: "y", request: { formatVersion: 1, token: link.token } }, NOW)).status).toBe("unauthorized");
    expect((await acceptMapProjectJoinLink(db, { ...s.nobody.proof, request: { formatVersion: 1, token: "B".repeat(43) } }, NOW)).status).toBe("not-found");
    expect((await acceptMapProjectJoinLink(db, { ...s.nobody.proof, request: { formatVersion: 1, token: "kort" } }, NOW)).status).toBe("invalid-request");
    const unverified = await registerTestAccount(db, undefined, NOW, { verified: false });
    expect((await join(unverified)).status).toBe("forbidden");
    // Efter 14 dagar gäller den inte.
    const late = new Date(NOW.getTime() + 14 * DAY);
    expect(await readMapProjectJoinLink(db, link.token, late)).toEqual({ formatVersion: 1, status: "invalid" });
    expect((await join(s.nobody, late)).status).toBe("not-found");
    expect((await join(s.nobody, new Date(late.getTime() - 1000))).status).toBe("joined");
    // Ta bort: ingen kan gå med, de som redan gått med står kvar; den som inte hanterar medlemmar kan inte ta bort.
    expect((await revokeMapProjectJoinLink(db, { ...s.editor.proof, projectId: s.projectId, request: { formatVersion: 1, linkId: link.linkId } }, NOW)).status).toBe("forbidden");
    expect((await revokeMapProjectJoinLink(db, { ...proof, request: { formatVersion: 1, linkId: link.linkId } }, NOW)).status).toBe("removed");
    expect((await revokeMapProjectJoinLink(db, { ...proof, request: { formatVersion: 1, linkId: link.linkId } }, NOW)).status).toBe("not-found");
    expect(await readMapProjectJoinLink(db, link.token, NOW)).toEqual({ formatVersion: 1, status: "invalid" });
    expect((await join(s.loner)).status).toBe("not-found");
    const after = await readMapProject(db, { ...s.anna.proof, projectId: s.projectId }, NOW);
    expect(after.status === "ok" && after.view.role).toBe("SUGGEST");
    const again = await readMapProject(db, proof, NOW);
    expect(again.status === "ok" && again.view.joinLinks).toEqual([]);
  });

  it("länken slutar gälla när den som skapade den inte längre är ägare, och högst tjugo öppna länkar", async () => {
    const s = await setup();
    const proof = { ...s.owner.proof, projectId: s.projectId };
    // Anna blir ägare och skapar en länk; sedan blir hon läsare.
    expect((await addMapProjectClubMember(db, { ...proof, request: { formatVersion: 1, accountId: s.anna.accountId, role: "OWNER" } }, NOW)).status).toBe("added");
    const link = await createMapProjectJoinLink(db, { ...s.anna.proof, projectId: s.projectId, request: { formatVersion: 1, role: "READ" } }, NOW);
    if (link.status !== "created") throw new Error(link.status);
    expect((await acceptMapProjectJoinLink(db, { ...s.nobody.proof, request: { formatVersion: 1, token: link.token } }, NOW)).status).toBe("joined");
    expect((await setMapProjectMemberRole(db, { ...proof, request: { formatVersion: 1, accountId: s.anna.accountId, role: "READ" } }, NOW)).status).toBe("ok");
    expect(await readMapProjectJoinLink(db, link.token, NOW)).toEqual({ formatVersion: 1, status: "invalid" });
    expect((await acceptMapProjectJoinLink(db, { ...s.loner.proof, request: { formatVersion: 1, token: link.token } }, NOW)).status).toBe("not-found");
    for (let count = 0; count < 19; count += 1) {
      expect((await createMapProjectJoinLink(db, { ...proof, request: { formatVersion: 1, role: "READ" } }, NOW)).status).toBe("created");
    }
    expect((await createMapProjectJoinLink(db, { ...proof, request: { formatVersion: 1, role: "READ" } }, NOW)).status).toBe("conflict");
  });
});
