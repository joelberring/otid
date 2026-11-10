import { asc, eq, inArray } from "drizzle-orm";
import type { UsableClubMap, UsableClubMapsResponse } from "@o-tid/contracts";
import { schema, type Database } from "@o-tid/database";
import { clubAreaAllowed, swedishToday } from "@o-tid/domain";
import { acceptClubInvitations, type ClubFailure, type ClubProof, type ClubRole } from "./club-access";
import { clubMapViewsByClub } from "./club-archive";
import { clubMapUseIssues, mayUseClubMap } from "./club-map-use";
import { applyEventorMemberships, clubLinkFactsMany, derivedClubIds } from "./club-affiliation-access";
import type { DbExecutor } from "./snapshot";
import { UUID_PATTERN } from "./serialization";
import { authenticateUserAccountSessionForProtectedRead } from "./user-account";

/**
 * ADR-0210 beslut 7: kartorna att välja bland i "Välj karta från klubbarkivet", från alla klubbar där kontot är medlem.
 * Vem som får använda en karta avgör `mayUseClubMap`.
 *
 * Ändrat 2026-11-07: medlem är som i `clubMembership` (club-access.ts) – ett uttryckligt medlemskap (med bekräftad e-post när
 * någon annan lade till kontot), annars en bekräftad tillhörighet (för hand eller via Eventor, ADR-0209 beslut 3). Förut
 * räknades bara uttryckliga medlemskap, så bekräftade medlemmar såg inga kartor fast de fick använda dem. Prövningen görs för
 * alla klubbar på en gång i stället för en fråga per klubb.
 */
async function memberClubs(tx: DbExecutor, accountId: string): Promise<{ clubId: string; name: string; role: ClubRole }[]> {
  const explicit = await tx.select({ clubId: schema.clubs.id, name: schema.clubs.name, role: schema.clubMembers.role, addedBy: schema.clubMembers.addedBy })
    .from(schema.clubMembers).innerJoin(schema.clubs, eq(schema.clubs.id, schema.clubMembers.clubId))
    .where(eq(schema.clubMembers.accountId, accountId)).orderBy(asc(schema.clubs.name)).limit(200);
  const [account] = await tx.select({ verifiedAt: schema.userAccounts.emailVerifiedAt, blockedAt: schema.userAccounts.blockedAt })
    .from(schema.userAccounts).where(eq(schema.userAccounts.id, accountId));
  const othersCount = !!account?.verifiedAt && !account.blockedAt;
  // Som `clubMembership`: ett uttryckligt medlemskap som inte gäller (obekräftad adress) ger inte heller den härledda rollen.
  const clubs = explicit.filter(row => row.addedBy === accountId || othersCount).map(({ clubId, name, role }) => ({ clubId, name, role }));
  const known = new Set(explicit.map(row => row.clubId));
  const derived = (await derivedClubIds(tx, accountId)).filter(clubId => !known.has(clubId));
  if (derived.length > 0) {
    const rows = await tx.select({ clubId: schema.clubs.id, name: schema.clubs.name }).from(schema.clubs)
      .where(inArray(schema.clubs.id, derived));
    clubs.push(...rows.map(row => ({ ...row, role: "READER" as const })));
  }
  return clubs.sort((a, b) => a.name.localeCompare(b.name, "sv"));
}

/** Kartorna (med versioner) i klubbarna där kontot är medlem och får använda kartan; kartor utan versioner tas inte med. */
export async function listUsableClubMaps(db: Database, proof: ClubProof, now = new Date(), raceId?: string)
  : Promise<ClubFailure | { status: "ok"; response: UsableClubMapsResponse }> {
  return db.transaction(async tx => {
    const auth = await authenticateUserAccountSessionForProtectedRead(tx, proof, now);
    if (auth.status !== "authenticated") return auth;
    const accountId = auth.principal.accountId;
    await acceptClubInvitations(tx, accountId, now);
    // Som när klubben öppnas: adressen i en kopplad klubbs medlemslista gör kontot till bekräftad medlem.
    await applyEventorMemberships(tx, accountId, now);
    const today = swedishToday(now);
    const maps: UsableClubMap[] = [];
    // B5: inställningarna och kartorna för alla klubbar i samma frågor, inte några frågor per klubb.
    const clubs = await memberClubs(tx, accountId);
    const links = await clubLinkFactsMany(tx, clubs.map(club => club.clubId));
    const open = clubs.filter(club => clubAreaAllowed(club.role, links.get(club.clubId)!.access.MAP_BANK));
    const views = await clubMapViewsByClub(tx, open.map(club => club.clubId), undefined, { merges: false });
    for (const club of open) {
      // Kartbanken stängd för rollen: inga kartor att läsa in (klubben är inte med i `open`).
      const facts = { role: club.role, clubId: club.clubId, mapBank: links.get(club.clubId)!.access.MAP_BANK };
      for (const map of views.get(club.clubId) ?? []) {
        if (map.versions.length === 0 || !mayUseClubMap(facts, map)) continue;
        maps.push({ clubId: club.clubId, clubName: club.name, map, issues: clubMapUseIssues(map, today) });
      }
    }
    // ADR-0221: tävlingen skapades ur klubbens terminsplan med en vald karta; den visas först (bara om kontot får använda den).
    let plannedMapId: string | null = null;
    if (raceId && UUID_PATTERN.test(raceId)) {
      const [planned] = await tx.select({ mapId: schema.clubPlanSessions.clubMapId, clubId: schema.clubPlanSessions.clubId })
        .from(schema.clubPlanSessions).where(eq(schema.clubPlanSessions.raceId, raceId)).limit(1);
      if (planned?.mapId && maps.some(item => item.map.mapId === planned.mapId && item.clubId === planned.clubId)) plannedMapId = planned.mapId;
    }
    return { status: "ok", response: { formatVersion: 1, maps, plannedMapId } } as const;
  });
}
