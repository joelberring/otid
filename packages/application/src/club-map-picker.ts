import { asc, eq } from "drizzle-orm";
import type { UsableClubMap, UsableClubMapsResponse } from "@o-tid/contracts";
import { schema, type Database } from "@o-tid/database";
import { acceptClubInvitations, clubMembership, type ClubFailure, type ClubProof } from "./club-access";
import { clubMapViews } from "./club-archive";
import { clubMapUseIssues, mayUseClubMap } from "./club-map-use";
import { clubLinkFacts } from "./club-affiliation-access";
import type { DbExecutor } from "./snapshot";
import { authenticateUserAccountSessionForProtectedRead } from "./user-account";

/**
 * ADR-0210 beslut 7: kartorna att välja bland i "Välj karta från klubbarkivet", från alla klubbar där kontot är medlem.
 * Vem som får använda en karta avgör `mayUseClubMap`.
 */
async function memberClubs(tx: DbExecutor, accountId: string) {
  const rows = await tx.select({ clubId: schema.clubs.id, name: schema.clubs.name }).from(schema.clubMembers)
    .innerJoin(schema.clubs, eq(schema.clubs.id, schema.clubMembers.clubId)).where(eq(schema.clubMembers.accountId, accountId))
    .orderBy(asc(schema.clubs.name)).limit(200);
  const clubs = [];
  for (const row of rows) {
    // Samma prövning som klubbens övriga sidor (bekräftad e-post när någon annan lade till kontot).
    const member = await clubMembership(tx, { accountId, clubId: row.clubId }, "none");
    if (member) clubs.push({ ...row, role: member.role });
  }
  return clubs;
}

/** Kartorna (med versioner) i klubbarna där kontot är medlem och får använda kartan; kartor utan versioner tas inte med. */
export async function listUsableClubMaps(db: Database, proof: ClubProof, now = new Date()): Promise<ClubFailure | { status: "ok"; response: UsableClubMapsResponse }> {
  return db.transaction(async tx => {
    const auth = await authenticateUserAccountSessionForProtectedRead(tx, proof, now);
    if (auth.status !== "authenticated") return auth;
    await acceptClubInvitations(tx, auth.principal.accountId, now);
    const today = now.toISOString().slice(0, 10);
    const maps: UsableClubMap[] = [];
    for (const club of await memberClubs(tx, auth.principal.accountId)) {
      const mapBank = (await clubLinkFacts(tx, club.clubId)).access.MAP_BANK;
      for (const map of await clubMapViews(tx, club.clubId)) {
        if (map.versions.length === 0 || !mayUseClubMap({ role: club.role, clubId: club.clubId, mapBank }, map)) continue;
        maps.push({ clubId: club.clubId, clubName: club.name, map, issues: clubMapUseIssues(map, today) });
      }
    }
    return { status: "ok", response: { formatVersion: 1, maps } } as const;
  });
}

