import { createHash, randomBytes, randomUUID } from "node:crypto";
import { and, asc, count, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import {
  CLUB_IMPORT_TOKEN_HOURS, clubCreateRequestSchema, clubMemberInviteRequestSchema, clubMemberRemoveRequestSchema, clubMemberRoleRequestSchema,
  type ClubSummary, type ClubUsage, type ClubView
} from "@o-tid/contracts";
import { schema, type Database } from "@o-tid/database";
import {
  acceptClubInvitations, clubJournal, clubRoleAtLeast, requireClubRole, type ClubFailure, type ClubProof, type ClubRole, type ClubTransaction
} from "./club-access";
import { mapStorageQuota, mapStorageUsage } from "./map-content";
import { UUID_PATTERN } from "./serialization";
import { authenticateUserAccountSessionForMutation, authenticateUserAccountSessionForProtectedRead } from "./user-account";
import type { DbExecutor } from "./snapshot";

/**
 * ADR-0194 beslut 1 och 7: klubben – skapa, Mina klubbar, klubbens vy (medlemmar, inbjudningar, användning, importnycklar),
 * bjuda in och ta bort medlemmar, ändra roll, och importnyckeln.
 */
export async function createClub(db: Database, input: ClubProof & { request: unknown }, now = new Date())
  : Promise<ClubFailure | { status: "created"; replayed: boolean; club: ClubSummary }> {
  const parsed = clubCreateRequestSchema.safeParse(input.request);
  if (!parsed.success) return { status: "invalid-request" };
  return db.transaction(async tx => {
    const auth = await authenticateUserAccountSessionForMutation(tx, { ...input, requireCsrf: true }, now);
    if (auth.status !== "authenticated") return auth;
    const accountId = auth.principal.accountId;
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`club-create:${parsed.data.requestId}`}, 0))`);
    const [prior] = await tx.select().from(schema.clubs).where(eq(schema.clubs.requestId, parsed.data.requestId));
    if (prior) {
      if (prior.createdBy !== accountId || prior.name !== parsed.data.name) return { status: "conflict" } as const;
      return { status: "created", replayed: true, club: { clubId: prior.id, name: prior.name, role: "OWNER", entries: 0 } } as const;
    }
    // Ägarens 2026-11-03: samma namn två gånger är nästan alltid ett misstag (en klubb man redan är med i).
    const [same] = await tx.select({ id: schema.clubs.id }).from(schema.clubs)
      .innerJoin(schema.clubMembers, eq(schema.clubMembers.clubId, schema.clubs.id))
      .where(and(eq(schema.clubMembers.accountId, accountId), sql`lower(${schema.clubs.name}) = lower(${parsed.data.name})`)).limit(1);
    if (same) return { status: "name-taken" } as const;
    const clubId = randomUUID();
    await tx.insert(schema.clubs).values({ id: clubId, name: parsed.data.name, createdAt: now, createdBy: accountId, requestId: parsed.data.requestId });
    await tx.insert(schema.clubMembers).values({ id: randomUUID(), clubId, accountId, role: "OWNER", addedAt: now, addedBy: accountId,
      requestId: randomUUID() });
    await clubJournal(tx, { clubId, action: "CLUB_CREATED", actorAccountId: accountId, details: { name: parsed.data.name }, now });
    return { status: "created", replayed: false, club: { clubId, name: parsed.data.name, role: "OWNER", entries: 0 } } as const;
  });
}

/** Mina tävlingar → Mina klubbar. Tar inbjudningar först (som Mina tävlingar). */
export async function listMyClubs(db: Database, proof: ClubProof, now = new Date()): Promise<ClubFailure | { status: "ok"; clubs: ClubSummary[] }> {
  return db.transaction(async tx => {
    const auth = await authenticateUserAccountSessionForProtectedRead(tx, proof, now);
    if (auth.status !== "authenticated") return auth;
    await acceptClubInvitations(tx, auth.principal.accountId, now);
    const rows = await tx.select({ clubId: schema.clubs.id, name: schema.clubs.name, role: schema.clubMembers.role, addedBy: schema.clubMembers.addedBy })
      .from(schema.clubMembers).innerJoin(schema.clubs, eq(schema.clubs.id, schema.clubMembers.clubId))
      .where(eq(schema.clubMembers.accountId, auth.principal.accountId)).orderBy(asc(schema.clubs.name)).limit(200);
    if (rows.length === 0) return { status: "ok", clubs: [] } as const;
    const entries = new Map((await tx.select({ clubId: schema.clubArchiveEntries.clubId, value: count() }).from(schema.clubArchiveEntries)
      .where(inArray(schema.clubArchiveEntries.clubId, rows.map(row => row.clubId))).groupBy(schema.clubArchiveEntries.clubId))
      .map(row => [row.clubId, row.value]));
    return { status: "ok", clubs: rows.map(row => ({ clubId: row.clubId, name: row.name, role: row.role, entries: entries.get(row.clubId) ?? 0 })) } as const;
  });
}

/** Klubbens användning: unika kartfiler (en gång per innehåll) och banfilerna. */
export async function clubUsage(tx: DbExecutor, clubId: string): Promise<ClubUsage> {
  const [row] = (await tx.execute<{ map_bytes: string; course_bytes: string; maps: string; versions: string; entries: string; course_files: string }>(sql`
    select
      (select coalesce(sum(byte_length), 0) from (select distinct on (content_sha256) byte_length from club_map_version where club_id = ${clubId}) v)::text as map_bytes,
      (select coalesce(sum(byte_length), 0) from club_archive_course_file where club_id = ${clubId})::text as course_bytes,
      (select count(*) from club_map where club_id = ${clubId})::text as maps,
      (select count(*) from club_map_version where club_id = ${clubId})::text as versions,
      (select count(*) from club_archive_entry where club_id = ${clubId})::text as entries,
      (select count(*) from club_archive_course_file where club_id = ${clubId})::text as course_files`)).rows;
  return { mapBytes: Number(row?.map_bytes ?? 0), courseFileBytes: Number(row?.course_bytes ?? 0), maps: Number(row?.maps ?? 0),
    versions: Number(row?.versions ?? 0), entries: Number(row?.entries ?? 0), courseFiles: Number(row?.course_files ?? 0) };
}

async function clubView(tx: ClubTransaction, clubId: string, viewer: { accountId: string; role: ClubRole }): Promise<ClubView | undefined> {
  const [club] = await tx.select().from(schema.clubs).where(eq(schema.clubs.id, clubId));
  if (!club) return undefined;
  const members = await tx.select({ memberId: schema.clubMembers.id, accountId: schema.clubMembers.accountId, email: schema.userAccounts.email,
    displayName: schema.userAccounts.displayName, role: schema.clubMembers.role, addedAt: schema.clubMembers.addedAt })
    .from(schema.clubMembers).innerJoin(schema.userAccounts, eq(schema.userAccounts.id, schema.clubMembers.accountId))
    .where(eq(schema.clubMembers.clubId, clubId)).orderBy(asc(schema.clubMembers.addedAt)).limit(2000);
  const admin = clubRoleAtLeast(viewer.role, "ADMIN");
  const invitations = admin ? await tx.select({ invitationId: schema.clubInvitations.id, email: schema.clubInvitations.email,
    role: schema.clubInvitations.role, createdAt: schema.clubInvitations.createdAt }).from(schema.clubInvitations)
    .where(and(eq(schema.clubInvitations.clubId, clubId), isNull(schema.clubInvitations.acceptedAt), isNull(schema.clubInvitations.revokedAt)))
    .orderBy(asc(schema.clubInvitations.createdAt)).limit(2000) : [];
  const tokens = admin ? await tx.select({ tokenId: schema.clubImportTokens.id, createdAt: schema.clubImportTokens.createdAt,
    expiresAt: schema.clubImportTokens.expiresAt, revokedAt: schema.clubImportTokens.revokedAt, lastUsedAt: schema.clubImportTokens.lastUsedAt,
    createdByName: schema.userAccounts.displayName }).from(schema.clubImportTokens)
    .innerJoin(schema.userAccounts, eq(schema.userAccounts.id, schema.clubImportTokens.accountId))
    .where(eq(schema.clubImportTokens.clubId, clubId)).orderBy(desc(schema.clubImportTokens.createdAt)).limit(20) : [];
  const quota = mapStorageQuota();
  const used = await mapStorageUsage(tx, viewer.accountId);
  return {
    formatVersion: 1, clubId, name: club.name, viewer,
    // Läsare ser medlemmarnas namn men inte adresserna.
    members: members.map(member => ({ ...member, email: admin ? member.email : "", addedAt: member.addedAt.toISOString() })),
    invitations: invitations.map(row => ({ ...row, createdAt: row.createdAt.toISOString() })),
    usage: await clubUsage(tx, clubId),
    tokens: tokens.map(row => ({ ...row, createdAt: row.createdAt.toISOString(), expiresAt: row.expiresAt.toISOString(),
      revokedAt: row.revokedAt?.toISOString() ?? null, lastUsedAt: row.lastUsedAt?.toISOString() ?? null })),
    quota: { accountLimitBytes: quota.accountBytes, accountUsedBytes: used.accountBytes }
  };
}

export async function readClub(db: Database, input: ClubProof & { clubId: string }, now = new Date())
  : Promise<ClubFailure | { status: "ok"; view: ClubView }> {
  return db.transaction(async tx => {
    const member = await requireClubRole(tx, input, "READER", now, false);
    if (member.status !== "ok") return member;
    const view = await clubView(tx, input.clubId, { accountId: member.accountId, role: member.role });
    return view ? { status: "ok", view } as const : { status: "not-found" } as const;
  });
}

/**
 * Bjud in med e-postadressen (ADR-0188 beslut 6): samma svar med och utan konto; medlemskapet skapas när personen loggar in
 * med adressen och har bekräftat den. En ägare bjuds bara in av en ägare. En adress som redan är medlem eller inbjuden ger 409
 * (den syns redan i listan).
 */
export async function inviteClubMember(db: Database, input: ClubProof & { clubId: string; request: unknown }, now = new Date())
  : Promise<ClubFailure | { status: "invited"; replayed: boolean; invitationId: string }> {
  const parsed = clubMemberInviteRequestSchema.safeParse(input.request);
  if (!parsed.success) return { status: "invalid-request" };
  const { requestId, email, role } = parsed.data;
  return db.transaction(async tx => {
    const actor = await requireClubRole(tx, input, "ADMIN", now, true);
    if (actor.status !== "ok") return actor;
    if (role === "OWNER" && actor.role !== "OWNER") return { status: "forbidden" } as const;
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`club-invitation:${input.clubId}:${email}`}, 0))`);
    const [prior] = await tx.select().from(schema.clubInvitations).where(eq(schema.clubInvitations.requestId, requestId));
    if (prior) {
      if (prior.clubId !== input.clubId || prior.email !== email || prior.role !== role) return { status: "conflict" } as const;
      return { status: "invited", replayed: true, invitationId: prior.id } as const;
    }
    const [openInvitation] = await tx.select({ id: schema.clubInvitations.id }).from(schema.clubInvitations)
      .where(and(eq(schema.clubInvitations.clubId, input.clubId), eq(schema.clubInvitations.email, email), isNull(schema.clubInvitations.acceptedAt),
        isNull(schema.clubInvitations.revokedAt)));
    const [existing] = await tx.select({ id: schema.clubMembers.id }).from(schema.clubMembers)
      .innerJoin(schema.userAccounts, eq(schema.userAccounts.id, schema.clubMembers.accountId))
      .where(and(eq(schema.clubMembers.clubId, input.clubId), eq(schema.userAccounts.email, email)));
    if (openInvitation || existing) return { status: "conflict" } as const;
    const invitationId = randomUUID();
    await tx.insert(schema.clubInvitations).values({ id: invitationId, requestId, clubId: input.clubId, email, role,
      actorAccountId: actor.accountId, createdAt: now });
    await clubJournal(tx, { clubId: input.clubId, action: "CLUB_MEMBER_INVITED", actorAccountId: actor.accountId,
      details: { invitationId, role }, now });
    // Den som redan har ett konto med bekräftad adress tar inbjudan nästa gång hen öppnar något; ingenting här säger om kontot finns.
    return { status: "invited", replayed: false, invitationId } as const;
  });
}

/** Ta bort en medlem eller en öppen inbjudan. Den sista ägaren kan inte tas bort; en ägare tas bara bort av en ägare. */
export async function removeClubMember(db: Database, input: ClubProof & { clubId: string; request: unknown }, now = new Date())
  : Promise<ClubFailure | { status: "removed" }> {
  const parsed = clubMemberRemoveRequestSchema.safeParse(input.request);
  if (!parsed.success) return { status: "invalid-request" };
  return db.transaction(async tx => {
    const actor = await requireClubRole(tx, input, "ADMIN", now, true);
    if (actor.status !== "ok") return actor;
    if (parsed.data.invitationId) {
      const [row] = await tx.update(schema.clubInvitations).set({ revokedAt: now })
        .where(and(eq(schema.clubInvitations.id, parsed.data.invitationId), eq(schema.clubInvitations.clubId, input.clubId),
          isNull(schema.clubInvitations.acceptedAt), isNull(schema.clubInvitations.revokedAt))).returning();
      if (!row) return { status: "not-found" } as const;
      if (row.role === "OWNER" && actor.role !== "OWNER") throw new ForbiddenRollback();
      await clubJournal(tx, { clubId: input.clubId, action: "CLUB_INVITATION_REVOKED", actorAccountId: actor.accountId,
        details: { invitationId: row.id }, now });
      return { status: "removed" } as const;
    }
    const [member] = await tx.select().from(schema.clubMembers)
      .where(and(eq(schema.clubMembers.id, parsed.data.memberId!), eq(schema.clubMembers.clubId, input.clubId))).for("update");
    if (!member) return { status: "not-found" } as const;
    if (member.role === "OWNER") {
      if (actor.role !== "OWNER") return { status: "forbidden" } as const;
      if (await ownerCount(tx, input.clubId) <= 1) return { status: "conflict" } as const;
    }
    await tx.delete(schema.clubMembers).where(eq(schema.clubMembers.id, member.id));
    await clubJournal(tx, { clubId: input.clubId, action: "CLUB_MEMBER_REMOVED", actorAccountId: actor.accountId,
      details: { memberId: member.id, accountId: member.accountId, role: member.role }, now });
    return { status: "removed" } as const;
  }).catch((error: unknown) => {
    if (error instanceof ForbiddenRollback) return { status: "forbidden" } as const;
    throw error;
  });
}

class ForbiddenRollback extends Error {}

async function ownerCount(tx: ClubTransaction, clubId: string): Promise<number> {
  const rows = await tx.select({ id: schema.clubMembers.id }).from(schema.clubMembers)
    .where(and(eq(schema.clubMembers.clubId, clubId), eq(schema.clubMembers.role, "OWNER"))).for("update");
  return rows.length;
}

export async function setClubMemberRole(db: Database, input: ClubProof & { clubId: string; request: unknown }, now = new Date())
  : Promise<ClubFailure | { status: "ok" }> {
  const parsed = clubMemberRoleRequestSchema.safeParse(input.request);
  if (!parsed.success) return { status: "invalid-request" };
  return db.transaction(async tx => {
    const actor = await requireClubRole(tx, input, "ADMIN", now, true);
    if (actor.status !== "ok") return actor;
    const [member] = await tx.select().from(schema.clubMembers)
      .where(and(eq(schema.clubMembers.id, parsed.data.memberId), eq(schema.clubMembers.clubId, input.clubId))).for("update");
    if (!member) return { status: "not-found" } as const;
    if ((member.role === "OWNER" || parsed.data.role === "OWNER") && actor.role !== "OWNER") return { status: "forbidden" } as const;
    if (member.role === "OWNER" && parsed.data.role !== "OWNER" && await ownerCount(tx, input.clubId) <= 1) return { status: "conflict" } as const;
    await tx.update(schema.clubMembers).set({ role: parsed.data.role }).where(eq(schema.clubMembers.id, member.id));
    await clubJournal(tx, { clubId: input.clubId, action: "CLUB_MEMBER_ROLE_CHANGED", actorAccountId: actor.accountId,
      details: { memberId: member.id, from: member.role, to: parsed.data.role }, now });
    return { status: "ok" } as const;
  });
}

export const importTokenHash = (token: string) => createHash("sha256").update(token, "utf8").digest("hex");

/** ADR-0194 beslut 7: en ny importnyckel (visas en gång), 12 timmar, bara för den här klubben. */
export async function createClubImportToken(db: Database, input: ClubProof & { clubId: string }, now = new Date())
  : Promise<ClubFailure | { status: "created"; token: string; tokenId: string; expiresAt: string }> {
  return db.transaction(async tx => {
    const actor = await requireClubRole(tx, input, "ADMIN", now, true);
    if (actor.status !== "ok") return actor;
    const token = `otid-imp-${randomBytes(32).toString("base64url")}`;
    const tokenId = randomUUID();
    const expiresAt = new Date(now.getTime() + CLUB_IMPORT_TOKEN_HOURS * 3_600_000);
    await tx.insert(schema.clubImportTokens).values({ id: tokenId, clubId: input.clubId, accountId: actor.accountId, tokenSha256: importTokenHash(token),
      createdAt: now, expiresAt });
    await clubJournal(tx, { clubId: input.clubId, action: "CLUB_IMPORT_TOKEN_CREATED", actorAccountId: actor.accountId, details: { tokenId }, now });
    return { status: "created", token, tokenId, expiresAt: expiresAt.toISOString() } as const;
  });
}

export async function revokeClubImportToken(db: Database, input: ClubProof & { clubId: string; tokenId: string }, now = new Date())
  : Promise<ClubFailure | { status: "revoked" }> {
  if (!UUID_PATTERN.test(input.tokenId)) return { status: "not-found" };
  return db.transaction(async tx => {
    const actor = await requireClubRole(tx, input, "ADMIN", now, true);
    if (actor.status !== "ok") return actor;
    const [row] = await tx.update(schema.clubImportTokens).set({ revokedAt: now })
      .where(and(eq(schema.clubImportTokens.id, input.tokenId), eq(schema.clubImportTokens.clubId, input.clubId), isNull(schema.clubImportTokens.revokedAt)))
      .returning({ id: schema.clubImportTokens.id });
    if (!row) return { status: "not-found" } as const;
    await clubJournal(tx, { clubId: input.clubId, action: "CLUB_IMPORT_TOKEN_REVOKED", actorAccountId: actor.accountId, details: { tokenId: row.id }, now });
    return { status: "revoked" } as const;
  });
}
