import { randomBytes, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { createDatabase, migrate, schema } from "@o-tid/database";
import { createClub, inviteClubMember, readClub, removeClubMember } from "../../src/clubs";
import { createOrganizerEvent } from "../../src/organizer-events";
import { grantRacePersonAsAdmin, listRacePeopleAsAdmin, revokeRacePersonAsAdmin } from "../../src/race-people";
import { addGroupMember, createTrainingGroup, readGroupAsLeader } from "../../src/training-groups";
import { INVITATION_LINK_LIFETIME_MS, INVITATION_MAILS_PER_INVITER, INVITATION_MAILS_PER_RECIPIENT, INVITATION_RESEND_INTERVAL_MS, readInvitationLink,
  type InvitationMail, type InvitationMailer } from "../../src/invitation-links";
import { resendClubInvitation, resendGroupInvitation, resendRacePersonInvitation } from "../../src/invitation-resend";
import { loginUserAccount } from "../../src/user-account";
import { registerTestAccount, TEST_PASSWORD } from "./accounts";

/**
 * ADR-0206: inbjudningar med e-post mot PostgreSQL – ett mejl per adress via en testmejlare, "Skicka igen" (ny länk, spärr),
 * borttagen inbjudan, länksidan som inte avslöjar konton, att behörigheten kräver ett bekräftat konto med exakt adressen, och
 * att länken går ut.
 */
const base = process.env.TEST_DATABASE_URL;
if (!base) throw new Error("ADR-0206-testet kräver TEST_DATABASE_URL till en PostgreSQL-roll med CREATEDB");
const admin = createDatabase(base);
const databaseName = `otid_adr0206_${randomUUID().replaceAll("-", "")}`;
const url = new URL(base);
url.pathname = `/${databaseName}`;
const { db, pool } = createDatabase(url.href);
const NOW = new Date("2026-11-03T12:00:00Z");
const later = (ms: number) => new Date(NOW.getTime() + ms);
const MINUTE = 60 * 1000;

beforeAll(async () => {
  await admin.pool.query(`CREATE DATABASE "${databaseName}"`);
  await migrate(db, { migrationsFolder: new URL("../../../database/migrations", import.meta.url).pathname });
});
afterAll(async () => {
  await pool.end();
  if (!/^otid_adr0206_[a-f0-9]{32}$/.test(databaseName)) throw new Error("Ogiltig testdatabas för rensning");
  await admin.pool.query(`DROP DATABASE "${databaseName}"`);
  await admin.pool.end();
});

/** Testmejlaren: sparar mejlen i stället för att skicka dem. */
function testMailer(): { mailer: InvitationMailer; sent: InvitationMail[] } {
  const sent: InvitationMail[] = [];
  return { sent, mailer: async mail => { sent.push(mail); } };
}
const failingMailer: InvitationMailer = async () => { throw Object.assign(new Error("SMTP nere"), { code: "ECONNREFUSED" }); };
const address = (name: string) => `${name}.${randomUUID().slice(0, 8)}@exempel.se`;

async function club() {
  const owner = await registerTestAccount(db, undefined, NOW);
  const created = await createClub(db, { ...owner.proof, request: { formatVersion: 1, requestId: randomUUID(), name: "OK Påhitt" } }, NOW);
  if (created.status !== "created") throw new Error(created.status);
  return { owner, clubId: created.club.clubId };
}

async function race() {
  const owner = await registerTestAccount(db, undefined, NOW);
  const created = await createOrganizerEvent(db, { ...owner.proof, idempotencyKey: `organizer-event-create:${randomUUID()}`,
    readBody: async () => ({ formatVersion: 1, eventName: "Natt-KM", raceName: "", raceDate: "2027-10-07", timeZone: "Europe/Stockholm" }) }, NOW);
  if (created.status !== "created") throw new Error(created.status);
  return { owner, raceId: created.response.raceId, proof: { ...owner.proof, raceId: created.response.raceId } };
}

async function grant(proof: Awaited<ReturnType<typeof race>>["proof"], email: string, role: string, mailer?: InvitationMailer, now = NOW) {
  const requestId = randomUUID();
  return grantRacePersonAsAdmin(db, { ...proof, idempotencyKey: `race-person-grant:${requestId}`,
    readBody: async () => ({ formatVersion: 1, requestId, email, role }) }, now, mailer);
}

async function inviteToClub(input: Awaited<ReturnType<typeof club>>, email: string, mailer?: InvitationMailer, now = NOW, role = "READER") {
  const result = await inviteClubMember(db, { ...input.owner.proof, clubId: input.clubId,
    request: { formatVersion: 1, requestId: randomUUID(), email, role } }, now, mailer);
  if (result.status !== "invited") throw new Error(result.status);
  return result;
}

describe("ADR-0206: inbjudningar med e-post", () => {
  it("klubb, tävling och grupp: ett mejl per adress med vem, vad och rollen, och listan visar när det skickades", async () => {
    const { mailer, sent } = testMailer();
    const theClub = await club();
    const withAccount = await registerTestAccount(db, undefined, NOW);
    const newAddress = address("ny");
    const first = await inviteToClub(theClub, newAddress, mailer);
    const second = await inviteToClub(theClub, withAccount.email, mailer, NOW, "ADMIN");
    // Samma svar med och utan konto (ADR-0188 beslut 6), och var sitt mejl.
    expect(Object.keys(first).sort()).toEqual(Object.keys(second).sort());
    expect([first.mail, second.mail]).toEqual(["sent", "sent"]);
    expect(sent.map(mail => mail.to)).toEqual([newAddress, withAccount.email]);
    expect(sent[0]).toMatchObject({ inviterName: theClub.owner.login.response.displayName, role: "READER",
      target: { kind: "CLUB", name: "OK Påhitt" } });
    expect(sent[0]!.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    // Bara hashen sparas.
    const stored = await db.select().from(schema.invitationLinks).where(eq(schema.invitationLinks.clubInvitationId, first.invitationId));
    expect(stored).toHaveLength(1);
    expect(stored[0]!.tokenHash).not.toContain(sent[0]!.token);
    expect(JSON.stringify(stored)).not.toContain(newAddress);
    const view = await readClub(db, { ...theClub.owner.proof, clubId: theClub.clubId }, NOW);
    if (view.status !== "ok") throw new Error(view.status);
    expect(view.view.invitations.map(row => row.sentAt)).toEqual([NOW.toISOString(), NOW.toISOString()]);

    const theRace = await race();
    const granted = await grant(theRace.proof, address("banlaggare"), "COURSE_EDIT", mailer);
    if (granted.status !== "granted") throw new Error(granted.status);
    expect(granted.response.mail).toBe("sent");
    expect(sent.at(-1)).toMatchObject({ role: "COURSE_EDIT", target: { kind: "RACE", name: "Natt-KM", raceDate: "2027-10-07" } });
    const people = await listRacePeopleAsAdmin(db, theRace.proof, NOW);
    if (people.status !== "ok") throw new Error(people.status);
    expect(people.response.invitations[0]?.sentAt).toBe(NOW.toISOString());

    const leader = await registerTestAccount(db, undefined, NOW);
    const group = await createTrainingGroup(db, { ...leader.proof, request: { formatVersion: 1, requestId: randomUUID(), name: "Torsdag", code: "torsdag" } }, NOW);
    if (group.status !== "created") throw new Error(group.status);
    const member = await addGroupMember(db, { ...leader.proof, groupId: group.group.groupId,
      request: { formatVersion: 1, requestId: randomUUID(), email: address("medlem"), role: "MEMBER" } }, NOW, mailer);
    if (member.status !== "added") throw new Error(member.status);
    expect(member.mail).toBe("sent");
    expect(member.member.sentAt).toBe(NOW.toISOString());
    expect(sent.at(-1)).toMatchObject({ role: "MEMBER", target: { kind: "GROUP", name: "Torsdag" } });
    expect(sent).toHaveLength(4);
  });

  it("utan e-post sparas inbjudan som förut; Kopiera länken ger en länk, Skicka igen säger att e-posten saknas", async () => {
    const theClub = await club();
    const invited = await inviteToClub(theClub, address("utan"));
    expect(invited.mail).toBe("off");
    const input = { ...theClub.owner.proof, clubId: theClub.clubId, invitationId: invited.invitationId };
    expect(await resendClubInvitation(db, { ...input, request: { formatVersion: 1, delivery: "MAIL" } }, undefined, NOW))
      .toEqual({ status: "mail-off" });
    const copied = await resendClubInvitation(db, { ...input, request: { formatVersion: 1, delivery: "LINK" } }, undefined, NOW);
    if (copied.status !== "ok" || copied.response.status !== "link") throw new Error(JSON.stringify(copied));
    expect((await readInvitationLink(db, copied.response.token, NOW)).status).toBe("valid");
    // En läsare i klubben (eller någon utanför) får inte kopiera.
    const outsider = await registerTestAccount(db, undefined, NOW);
    expect((await resendClubInvitation(db, { ...outsider.proof, clubId: theClub.clubId, invitationId: invited.invitationId,
      request: { formatVersion: 1, delivery: "LINK" } }, undefined, NOW)).status).toBe("not-found");
  });

  it("Skicka igen ger en ny länk, den förra slutar gälla, och spärren slår till", async () => {
    const { mailer, sent } = testMailer();
    const theRace = await race();
    const email = address("igen");
    const granted = await grant(theRace.proof, email, "FUNCTIONARY", mailer);
    if (granted.status !== "granted") throw new Error(granted.status);
    const input = { ...theRace.proof, invitationId: granted.response.invitation.invitationId, request: { formatVersion: 1, delivery: "MAIL" } };
    // För tätt efter förra mejlet.
    const tooSoon = await resendRacePersonInvitation(db, input, mailer, later(MINUTE));
    expect(tooSoon).toEqual({ status: "ok", response: { formatVersion: 1, status: "throttled" } });
    const again = await resendRacePersonInvitation(db, input, mailer, later(INVITATION_RESEND_INTERVAL_MS + MINUTE));
    expect(again).toMatchObject({ status: "ok", response: { status: "sent" } });
    expect(sent).toHaveLength(2);
    expect(sent[1]!.token).not.toBe(sent[0]!.token);
    expect((await readInvitationLink(db, sent[0]!.token, later(INVITATION_RESEND_INTERVAL_MS + 2 * MINUTE))).status).toBe("invalid");
    expect((await readInvitationLink(db, sent[1]!.token, later(INVITATION_RESEND_INTERVAL_MS + 2 * MINUTE))).status).toBe("valid");
    // Per mottagare: högst tre i timmen, också från andra tävlingar.
    const other = await race();
    const third = await grant(other.proof, email, "FUNCTIONARY", mailer, later(INVITATION_RESEND_INTERVAL_MS + 3 * MINUTE));
    const fourth = await grant((await race()).proof, email, "FUNCTIONARY", mailer, later(INVITATION_RESEND_INTERVAL_MS + 4 * MINUTE));
    expect(INVITATION_MAILS_PER_RECIPIENT.hour).toBe(3);
    expect(third.status === "granted" && third.response.mail).toBe("sent");
    expect(fourth.status === "granted" && fourth.response.mail).toBe("throttled");
    expect(sent).toHaveLength(3);
  });

  it("ett mejl som inte gick iväg visas som inte skickat och kan skickas igen direkt", async () => {
    const { mailer, sent } = testMailer();
    const leader = await registerTestAccount(db, undefined, NOW);
    const group = await createTrainingGroup(db, { ...leader.proof, request: { formatVersion: 1, requestId: randomUUID(), name: "Fel", code: "fel" } }, NOW);
    if (group.status !== "created") throw new Error(group.status);
    const added = await addGroupMember(db, { ...leader.proof, groupId: group.group.groupId,
      request: { formatVersion: 1, requestId: randomUUID(), email: address("fel"), role: "LEADER" } }, NOW, failingMailer);
    if (added.status !== "added") throw new Error(added.status);
    expect(added.mail).toBe("failed");
    const view = await readGroupAsLeader(db, { ...leader.proof, groupId: group.group.groupId }, NOW);
    if (view.status !== "ok") throw new Error(view.status);
    expect(view.view.members.find(row => row.pending)?.sentAt).toBeNull();
    const retried = await resendGroupInvitation(db, { ...leader.proof, groupId: group.group.groupId, invitationId: added.member.memberId,
      request: { formatVersion: 1, delivery: "MAIL" } }, mailer, later(MINUTE));
    expect(retried).toMatchObject({ status: "ok", response: { status: "sent" } });
    expect(sent).toHaveLength(1);
  });

  it("en borttagen inbjudan: länken gäller inte längre och kan inte skickas igen", async () => {
    const { mailer, sent } = testMailer();
    const theClub = await club();
    const invited = await inviteToClub(theClub, address("bort"), mailer);
    expect((await readInvitationLink(db, sent[0]!.token, NOW)).status).toBe("valid");
    const removed = await removeClubMember(db, { ...theClub.owner.proof, clubId: theClub.clubId,
      request: { formatVersion: 1, memberId: null, invitationId: invited.invitationId } }, NOW);
    expect(removed.status).toBe("removed");
    expect(await readInvitationLink(db, sent[0]!.token, NOW)).toEqual({ formatVersion: 1, status: "invalid" });
    expect((await resendClubInvitation(db, { ...theClub.owner.proof, clubId: theClub.clubId, invitationId: invited.invitationId,
      request: { formatVersion: 1, delivery: "MAIL" } }, mailer, later(20 * MINUTE))).status).toBe("not-found");

    const theRace = await race();
    const granted = await grant(theRace.proof, address("bort"), "ADMIN", mailer);
    if (granted.status !== "granted") throw new Error(granted.status);
    const requestId = randomUUID();
    await revokeRacePersonAsAdmin(db, { ...theRace.proof, idempotencyKey: `race-person-revoke:${requestId}`,
      readBody: async () => ({ formatVersion: 1, requestId, grantId: granted.response.invitation.invitationId }) }, NOW);
    expect((await readInvitationLink(db, sent.at(-1)!.token, NOW)).status).toBe("invalid");
  });

  it("länksidan avslöjar inte om adressen har ett konto, och okända länkar ger samma svar", async () => {
    const { mailer, sent } = testMailer();
    const theClub = await club();
    const existing = await registerTestAccount(db, undefined, NOW);
    await inviteToClub(theClub, existing.email, mailer);
    await inviteToClub(theClub, address("okand"), mailer);
    const [withAccount, without] = await Promise.all(sent.map(mail => readInvitationLink(db, mail.token, NOW)));
    if (withAccount?.status !== "valid" || without?.status !== "valid") throw new Error("Länkarna gäller inte");
    const shape = (view: object) => Object.keys(view).sort();
    expect(shape(withAccount)).toEqual(shape(without));
    expect({ ...withAccount, email: "" }).toEqual({ ...without, email: "" });
    expect(withAccount).toMatchObject({ kind: "CLUB", targetName: "OK Påhitt", role: "READER", next: `/organizer/clubs/${theClub.clubId}` });
    // Även efter att kontot tagit inbjudan ser sidan likadan ut.
    await loginUserAccount(db, { formatVersion: 1, email: existing.email, password: TEST_PASSWORD }, { now: NOW });
    expect(await readInvitationLink(db, sent[0]!.token, NOW)).toEqual(withAccount);
    expect(await readInvitationLink(db, "B".repeat(43), NOW)).toEqual({ formatVersion: 1, status: "invalid" });
  });

  it("länken ger ingenting: bara ett bekräftat konto med exakt adressen blir medlem", async () => {
    const { mailer, sent } = testMailer();
    const theClub = await club();
    const name = `exakt.${randomUUID().slice(0, 8)}`;
    const email = `${name}@test.o-tid.se`;
    await inviteToClub(theClub, email, mailer, NOW, "ADMIN");
    // Att öppna länken ändrar ingenting.
    await readInvitationLink(db, sent[0]!.token, NOW);
    const members = async () => (await db.select({ accountId: schema.clubMembers.accountId }).from(schema.clubMembers)
      .where(eq(schema.clubMembers.clubId, theClub.clubId))).length;
    expect(await members()).toBe(1);
    // En liknande adress får ingenting.
    const similar = await registerTestAccount(db, `${name}.annan`, NOW);
    await loginUserAccount(db, { formatVersion: 1, email: similar.email, password: TEST_PASSWORD }, { now: NOW });
    expect(await members()).toBe(1);
    // Obekräftad: ingenting.
    const unverified = await registerTestAccount(db, name, NOW, { verified: false });
    expect((await readClub(db, { ...unverified.proof, clubId: theClub.clubId }, NOW)).status).toBe("not-found");
    expect(await members()).toBe(1);
    // Bekräftad: medlem med rollen från inbjudan.
    await db.update(schema.userAccounts).set({ emailVerifiedAt: NOW }).where(eq(schema.userAccounts.id, unverified.accountId));
    const view = await readClub(db, { ...unverified.proof, clubId: theClub.clubId }, NOW);
    expect(view.status === "ok" && view.view.viewer.role).toBe("ADMIN");
  });

  it("per avsändare: högst 100 mejl i timmen, sedan sparas inbjudan utan mejl", async () => {
    const { mailer, sent } = testMailer();
    const theClub = await club();
    const first = await inviteToClub(theClub, address("forsta"), mailer);
    // 99 tidigare mejl från samma avsändare den senaste timmen (till andra adresser).
    const hex = () => randomBytes(32).toString("hex");
    await db.insert(schema.invitationLinks).values(Array.from({ length: INVITATION_MAILS_PER_INVITER.hour - 1 }, (_, index) => ({
      id: randomUUID(), clubInvitationId: first.invitationId, tokenHash: hex(), recipientKey: hex(), issuedBy: theClub.owner.accountId,
      delivery: "MAIL" as const, createdAt: later(index * 1000), expiresAt: later(INVITATION_LINK_LIFETIME_MS), sentAt: later(index * 1000) })));
    const blocked = await inviteToClub(theClub, address("hundraforsta"), mailer, later(10 * MINUTE));
    expect(blocked.mail).toBe("throttled");
    expect(sent).toHaveLength(1);
    // En timme senare går det igen.
    expect((await inviteToClub(theClub, address("senare"), mailer, later(2 * 60 * MINUTE))).mail).toBe("sent");
  });

  it("länken går ut efter 14 dagar", async () => {
    const { mailer, sent } = testMailer();
    await inviteToClub(await club(), address("gammal"), mailer);
    expect((await readInvitationLink(db, sent[0]!.token, later(INVITATION_LINK_LIFETIME_MS - MINUTE))).status).toBe("valid");
    expect(await readInvitationLink(db, sent[0]!.token, later(INVITATION_LINK_LIFETIME_MS))).toEqual({ formatVersion: 1, status: "invalid" });
  });
});
