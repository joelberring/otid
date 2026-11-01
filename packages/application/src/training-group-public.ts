import { and, eq } from "drizzle-orm";
import type { GroupPublicResult, GroupPublicSession, GroupPublicView } from "@o-tid/contracts";
import { schema, type Database } from "@o-tid/database";
import { GROUP_CODE_PATTERN, shownPersonName, type GroupNameDisplay } from "@o-tid/domain";
import { publicResults } from "./results";
import { groupMembership } from "./training-group-access";
import { groupSeason, groupSessions, groupToday } from "./training-groups";
import { authenticateUserAccountSessionForProtectedRead } from "./user-account";
import { UUID_PATTERN } from "./serialization";

/**
 * Steg 68 (ADR-0182 beslut 2 och 7): gruppsidan (/g/<kod>) och namnen på gruppens tävlingars publika sidor.
 *
 * - Gruppsidan visar gruppens publicerade tillfällen: kommande, det senaste med resultat (resultatlistan per klass) och
 *   arkivet. Sidan för alla med länken (standard) eller bara för inloggade ledare och medlemmar.
 * - Namnen visas som gruppen valt: förnamn (standard), fullt namn eller inga namn – på gruppsidan och på tävlingens egna
 *   publika sidor (`raceGroupNameDisplay`, som webben använder för resultat, startlista, Live, mellantider, deltagarsidan,
 *   GPS-rutterna och kontrollkartan). Ledare och tävlingens administratörer och funktionärer ser fullständiga namn i
 *   arbetsytan som förut.
 * - Närvaro och statistik: bara ledarna (standard; i Mina tävlingar → gruppen) eller också medlemmarna (inloggade) här.
 */
export type GroupPublicResultRead = { status: "not-found" } | { status: "login-required"; name: string } | { status: "ok"; view: GroupPublicView };

/** Namninställningen för en tävlings publika sidor: gruppens, eller fullt namn när tävlingen inte hör till en grupp. */
export async function raceGroupNameDisplay(db: Database, raceId: string): Promise<GroupNameDisplay> {
  if (!UUID_PATTERN.test(raceId)) return "FULL";
  const [row] = await db.select({ nameDisplay: schema.trainingGroups.nameDisplay }).from(schema.races)
    .innerJoin(schema.events, eq(schema.events.id, schema.races.eventId))
    .innerJoin(schema.trainingGroups, eq(schema.trainingGroups.id, schema.events.trainingGroupId))
    .where(eq(schema.races.id, raceId)).limit(1);
  return row?.nameDisplay ?? "FULL";
}

const MAX_RESULTS = 500;

export async function readGroupPublicView(db: Database, input: { code: string; sessionToken: string | null }, now = new Date())
  : Promise<GroupPublicResultRead> {
  const code = input.code.trim().toLowerCase();
  if (!GROUP_CODE_PATTERN.test(code)) return { status: "not-found" };
  const read = await db.transaction(async tx => {
    const [group] = await tx.select().from(schema.trainingGroups).where(eq(schema.trainingGroups.code, code));
    if (!group) return { status: "not-found" } as const;
    let role: "LEADER" | "MEMBER" | undefined;
    if (input.sessionToken) {
      const auth = await authenticateUserAccountSessionForProtectedRead(tx, { sessionToken: input.sessionToken }, now);
      if (auth.status === "authenticated") role = (await groupMembership(tx, { accountId: auth.principal.accountId, groupId: group.id }))?.role;
    }
    if (group.pageVisibility === "MEMBERS" && !role) return { status: "login-required", name: group.name } as const;
    const { today } = await groupToday(tx, group.id, now);
    // Bara publicerade tillfällen (samma grind som tävlingens egna sidor).
    const sessions = (await groupSessions(tx, group.id)).filter(session => session.published);
    const [todayOpen] = await tx.select({ raceId: schema.races.id }).from(schema.races).innerJoin(schema.events, eq(schema.events.id, schema.races.eventId))
      .where(and(eq(schema.events.trainingGroupId, group.id), eq(schema.races.raceDate, today), eq(schema.races.selfRegistration, true)))
      .limit(1);
    return { status: "ok" as const, group, role, today, sessions, todayRaceId: todayOpen?.raceId };
  }, { isolationLevel: "repeatable read" });
  if (read.status !== "ok") return read;
  const { group, sessions, today } = read;
  const view = (session: (typeof sessions)[number]): GroupPublicSession => ({ raceId: session.raceId, eventName: session.eventName,
    raceName: session.raceName, raceDate: session.raceDate, firstStartTime: session.firstStartTime, shortCode: session.shortCode,
    hasResults: session.hasResults });
  const upcoming = sessions.filter(session => session.raceDate >= today && !session.hasResults);
  const past = sessions.filter(session => session.raceDate < today || session.hasResults).reverse();
  const latestSession = past.find(session => session.hasResults);
  let latest: GroupPublicView["latest"] = null;
  if (latestSession) {
    const list = await publicResults(db, latestSession.raceId);
    const results: GroupPublicResult[] = list.results.slice(0, MAX_RESULTS).flatMap(row => "givenName" in row ? [{
      className: row.className, ...shownPersonName(group.nameDisplay, row.givenName, row.familyName), status: row.status,
      position: "position" in row && row.position !== undefined ? row.position : null,
      elapsedMs: "elapsedMs" in row && row.elapsedMs !== undefined ? row.elapsedMs : null }] : []);
    latest = { ...view(latestSession), results };
  }
  const statsVisible = read.role === "LEADER" || (read.role === "MEMBER" && group.statsVisibility === "MEMBERS");
  const season = statsVisible ? await groupSeason(db, sessions, today, group.pointsMode) : null;
  const todaySession = sessions.find(session => session.raceId === read.todayRaceId);
  return { status: "ok", view: { formatVersion: 1, name: group.name, code: group.code, nameDisplay: group.nameDisplay,
    pageVisibility: group.pageVisibility, viewer: read.role ?? "PUBLIC", upcoming: upcoming.map(view),
    latest, archive: past.filter(session => session !== latestSession).map(view), today: todaySession ? view(todaySession) : null,
    // Nyckeln bygger på namnet och visas aldrig publikt.
    season: season ? { pointsMode: group.pointsMode, rows: season.rows.map((row, index) => ({ key: `p${index + 1}`, attended: row.attended, points: row.points,
      ...shownPersonName(group.nameDisplay, row.givenName, row.familyName) })) } : null } };
}
