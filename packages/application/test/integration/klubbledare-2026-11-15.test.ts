import { describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { schema } from "@o-tid/database";
import { requireRaceRole } from "../../src/race-session";
import { requireCourseSettingAccess } from "../../src/course-setting-access";
import { readRaceShortcut } from "../../src/race-shortcut";
import { ownOrganisationsForAccount } from "../../src/organisations";
import { registerTestAccount } from "./accounts";
import { clubHelpers, ledarDatabase } from "./ledarflode-fixtures";

/**
 * Ägaren 2026-11-15 (ADR-0209 tillägg 2026-11-15): ledarna i arrangörsklubbens klubbyta är administratörer för klubbens
 * träningar, härlett vid varje anrop i den gemensamma behörighetskontrollen. Mot PostgreSQL.
 */
const db = ledarDatabase("klubbledare");
const NOW = new Date("2026-11-15T12:00:00Z");
const { member, linkedClub, organisedRace } = clubHelpers(db, NOW);

type Proof = { sessionToken: string; csrfCookie: string; csrfHeader: string };
const adminOn = async (proof: Proof, raceId: string) =>
  (await requireRaceRole(db, { raceId, ...proof, role: "ADMIN" }, NOW)).status;
const shortCodeOf = async (raceId: string) =>
  (await db.select({ code: schema.races.shortCode }).from(schema.races).where(eq(schema.races.id, raceId)))[0]!.code;

describe("klubbens ledare och klubbens träningar", () => {
  it("en LEADER i arrangörsklubbens klubbyta är ADMIN på klubbens träning, också i banläggningen och snabblänken", async () => {
    const club = await linkedClub("OK Tisdag");
    const leader = await member(club.clubId, "LEADER", club.owner.accountId);
    const raceId = await organisedRace({ ownerId: club.owner.accountId, organisationId: club.organisationId, raceDate: "2026-11-17" });
    const auth = await requireRaceRole(db, { raceId, ...leader.proof, role: "ADMIN" }, NOW);
    expect(auth.status).toBe("authenticated");
    if (auth.status === "authenticated") expect(auth.principal.role).toBe("ADMIN");
    // Inga roller kopieras: evenemanget har bara ägarens rad.
    const grants = await db.select().from(schema.eventAdministrationGrants)
      .where(eq(schema.eventAdministrationGrants.accountId, leader.accountId));
    expect(grants).toHaveLength(0);
    const course = await db.transaction(tx => requireCourseSettingAccess(tx, { raceId, ...leader.proof, required: "ADMIN" }, NOW, "none"));
    expect(course.status).toBe("authenticated");
    const code = await shortCodeOf(raceId);
    expect(await readRaceShortcut(db, { sessionToken: leader.proof.sessionToken, code }, NOW))
      .toEqual({ formatVersion: 1, admin: { raceId, bingo: false } });
  });

  it("en skrivning som klubbledare får en auditpost en gång per inloggning", async () => {
    const club = await linkedClub("OK Journal");
    const leader = await member(club.clubId, "LEADER", club.owner.accountId);
    const raceId = await organisedRace({ ownerId: club.owner.accountId, organisationId: club.organisationId, raceDate: "2026-11-17" });
    for (let i = 0; i < 2; i++) {
      const auth = await db.transaction(tx => requireRaceRole(tx, { raceId, ...leader.proof, role: "ADMIN", requireCsrf: true }, NOW, "update"));
      expect(auth.status).toBe("authenticated");
    }
    await db.transaction(tx => requireRaceRole(tx, { raceId, ...leader.proof, role: "ADMIN" }, NOW, "share"));
    const rows = await db.select().from(schema.auditEvents).where(and(eq(schema.auditEvents.raceId, raceId),
      eq(schema.auditEvents.action, "RACE_ADMIN_VIA_CLUB_LEADER")));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.actorId).toBe(leader.accountId);
    // Ägarens egna skrivningar ger ingen sådan post.
    await db.transaction(tx => requireRaceRole(tx, { raceId, ...club.owner.proof, role: "ADMIN", requireCsrf: true }, NOW, "update"));
    expect(await db.select().from(schema.auditEvents).where(and(eq(schema.auditEvents.raceId, raceId),
      eq(schema.auditEvents.action, "RACE_ADMIN_VIA_CLUB_LEADER")))).toHaveLength(1);
  });

  it("en READER i klubbytan får inte admin och ingen snabblänk", async () => {
    const club = await linkedClub("OK Läsare");
    const reader = await member(club.clubId, "READER", club.owner.accountId);
    const raceId = await organisedRace({ ownerId: club.owner.accountId, organisationId: club.organisationId, raceDate: "2026-11-17" });
    expect(await adminOn(reader.proof, raceId)).toBe("unauthorized");
    const code = await shortCodeOf(raceId);
    expect(await readRaceShortcut(db, { sessionToken: reader.proof.sessionToken, code }, NOW)).toEqual({ formatVersion: 1, admin: null });
  });

  it("en LEADER får inte admin på en vanlig tävling med klubben som arrangör", async () => {
    const club = await linkedClub("OK Tävling");
    const leader = await member(club.clubId, "LEADER", club.owner.accountId);
    const raceId = await organisedRace({ ownerId: club.owner.accountId, organisationId: club.organisationId, raceDate: "2026-11-17",
      raceType: "STANDARD" });
    expect(await adminOn(leader.proof, raceId)).toBe("unauthorized");
    // En träning som görs om till tävling tappar ledarnas rätt direkt.
    const trainingId = await organisedRace({ ownerId: club.owner.accountId, organisationId: club.organisationId, raceDate: "2026-11-17" });
    expect(await adminOn(leader.proof, trainingId)).toBe("authenticated");
    await db.update(schema.races).set({ raceType: "SMALL" }).where(eq(schema.races.id, trainingId));
    expect(await adminOn(leader.proof, trainingId)).toBe("unauthorized");
  });

  it("en annan klubbs ledare får inte admin, och rätten försvinner när ledaren slutar", async () => {
    const club = await linkedClub("OK Egen");
    const other = await linkedClub("OK Annan");
    const otherLeader = await member(other.clubId, "LEADER", other.owner.accountId);
    const leader = await member(club.clubId, "LEADER", club.owner.accountId);
    const raceId = await organisedRace({ ownerId: club.owner.accountId, organisationId: club.organisationId, raceDate: "2026-11-17" });
    expect(await adminOn(otherLeader.proof, raceId)).toBe("unauthorized");
    const code = await shortCodeOf(raceId);
    expect((await readRaceShortcut(db, { sessionToken: otherLeader.proof.sessionToken, code }, NOW)).admin).toBeNull();
    expect(await adminOn(leader.proof, raceId)).toBe("authenticated");
    await db.update(schema.clubMembers).set({ role: "READER" })
      .where(and(eq(schema.clubMembers.clubId, club.clubId), eq(schema.clubMembers.accountId, leader.accountId)));
    expect(await adminOn(leader.proof, raceId)).toBe("unauthorized");
    // Utan arrangörsklubb har ingen klubbs ledare rätt.
    const lone = await organisedRace({ ownerId: club.owner.accountId, organisationId: null, raceDate: "2026-11-17" });
    expect(await adminOn(otherLeader.proof, lone)).toBe("unauthorized");
  });

  it("snabblänken är tom utan inloggning och för okända koder, och kontots egna klubbar ger förvalet", async () => {
    const club = await linkedClub("OK Förval");
    const raceId = await organisedRace({ ownerId: club.owner.accountId, organisationId: club.organisationId, raceDate: "2026-11-17" });
    const code = await shortCodeOf(raceId);
    expect(await readRaceShortcut(db, { sessionToken: null, code }, NOW)).toEqual({ formatVersion: 1, admin: null });
    expect(await readRaceShortcut(db, { sessionToken: club.owner.proof.sessionToken, code: "zzzzzz" }, NOW)).toEqual({ formatVersion: 1, admin: null });
    expect((await readRaceShortcut(db, { sessionToken: club.owner.proof.sessionToken, code }, NOW)).admin?.raceId).toBe(raceId);
    const mine = await ownOrganisationsForAccount(db, { sessionToken: club.owner.proof.sessionToken }, NOW);
    expect(mine.status === "ok" && mine.response.organisations.map(row => row.organisationId)).toEqual([club.organisationId]);
    const outsider = await registerTestAccount(db, undefined, NOW);
    const none = await ownOrganisationsForAccount(db, { sessionToken: outsider.proof.sessionToken }, NOW);
    expect(none.status === "ok" && none.response.organisations).toEqual([]);
  });
});
