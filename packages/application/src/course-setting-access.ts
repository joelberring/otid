import { and, eq } from "drizzle-orm";
import { acceptRacePersonInvitations } from "./race-person-invitations";
import { schema } from "@o-tid/database";
import type { CourseSettingLevel } from "@o-tid/contracts";
import { activeEventAdministrationGrant, type RaceRoleLock, type RaceSessionProof } from "./race-session";
import type { DbExecutor } from "./snapshot";
import { authorizeUserAccountSession } from "./user-account";
import { accountEmailVerified } from "./email-verification";

/**
 * Steg 66 (ADR-0181 beslut 5): behörigheten i banläggningen. Ägare och administratörer på eventet har EDIT (och `admin`:
 * överföring till tävlingen, arbetssättet, behörigheterna). Andra har den nivå som står i `course_setting_grant` för
 * tävlingen: EDIT ändrar, SUGGEST föreslår, COMMENT läser och skriver notiser, MAP (kartritaren, ADR-0181 beslut 8) ser
 * bara kartfilen och kartfelen. Den behörigheten ger bara banläggningens
 * sidor och API (den här kontrollen); resten av tävlingen kräver `requireRaceRole`, som den inte påverkar.
 * Banhemligheten gäller alla nivåer: inget av detta är publikt.
 */
export type CourseSettingRequirement = CourseSettingLevel | "ADMIN";

export interface CourseSettingPrincipal {
  accountId: string;
  displayName: string;
  raceId: string;
  eventId: string;
  level: CourseSettingLevel;
  admin: boolean;
}

export type CourseSettingAccessResult = { status: "unauthorized" } | { status: "forbidden" }
  | { status: "authenticated"; principal: CourseSettingPrincipal };

const RANK: Record<CourseSettingLevel, number> = { MAP: -1, COMMENT: 0, SUGGEST: 1, EDIT: 2 };

/** Nivån räcker för kravet. */
export function courseSettingAllows(principal: Pick<CourseSettingPrincipal, "level" | "admin">, required: CourseSettingRequirement): boolean {
  return required === "ADMIN" ? principal.admin : RANK[principal.level] >= RANK[required];
}

async function authorize(tx: DbExecutor, request: RaceSessionProof & { required: CourseSettingRequirement; requireCsrf?: boolean },
  now: Date, lock: RaceRoleLock, accepted = false): Promise<CourseSettingAccessResult> {
  const account = await authorizeUserAccountSession(tx, {
    sessionToken: request.sessionToken, csrfCookie: request.csrfCookie ?? null, csrfHeader: request.csrfHeader ?? null,
    ...(request.requireCsrf ? { requireCsrf: true } : {})
  }, now, lock);
  if (account.status !== "authenticated") return account;
  const [race] = await tx.select({ id: schema.races.id, eventId: schema.races.eventId }).from(schema.races).where(eq(schema.races.id, request.raceId));
  if (!race) return { status: "unauthorized" };
  const accountId = account.principal.accountId;
  const [named] = await tx.select({ displayName: schema.userAccounts.displayName }).from(schema.userAccounts)
    .where(eq(schema.userAccounts.id, accountId));
  const grant = await activeEventAdministrationGrant(tx, { accountId, eventId: race.eventId, roles: ["OWNER", "ADMIN", "FUNCTIONARY"] }, lock);
  let principal: CourseSettingPrincipal | undefined;
  if (grant && grant.role !== "FUNCTIONARY") {
    principal = { accountId, displayName: named?.displayName ?? "", raceId: race.id, eventId: race.eventId, level: "EDIT", admin: true };
  } else if (await accountEmailVerified(tx, accountId)) {
    // ADR-0186: banläggningens behörighet kommer från någon annan och gäller först med bekräftad e-postadress.
    const query = tx.select({ level: schema.courseSettingGrants.level }).from(schema.courseSettingGrants)
      .where(and(eq(schema.courseSettingGrants.raceId, race.id), eq(schema.courseSettingGrants.accountId, accountId)));
    const [row] = lock === "share" ? await query.for("share") : lock === "update" ? await query.for("update") : await query;
    if (row) principal = { accountId, displayName: named?.displayName ?? "", raceId: race.id, eventId: race.eventId, level: row.level, admin: false };
  }
  // ADR-0188 beslut 6: en behörighet sparad för kontots adress på tävlingen gäller från första besöket.
  if (!principal && !accepted && await acceptRacePersonInvitations(tx, accountId, now, race.id) > 0) {
    return authorize(tx, request, now, lock, true);
  }
  // Funktionären utan banläggning är inloggad på tävlingen men får inte se banorna (403); övriga har ingen roll (401).
  if (!principal) return grant ? { status: "forbidden" } : { status: "unauthorized" };
  if (!courseSettingAllows(principal, request.required)) return { status: "forbidden" };
  return { status: "authenticated", principal };
}

/** Den enda kontrollen för banläggningens tjänster och routes (samma låsning som `requireRaceRole`). */
export async function requireCourseSettingAccess(executor: DbExecutor, request: RaceSessionProof & { required: CourseSettingRequirement;
  requireCsrf?: boolean }, now = new Date(), lock: RaceRoleLock = "none"): Promise<CourseSettingAccessResult> {
  if (!Number.isFinite(now.getTime())) throw new Error("Autentiseringstiden är ogiltig");
  if (lock !== "share") return authorize(executor, request, now, lock);
  try {
    return await executor.transaction(authTx => authorize(authTx, request, now, "share"));
  } catch (error) {
    if (typeof error === "object" && error !== null && "code" in error && error.code === "40001") return { status: "unauthorized" };
    throw error;
  }
}
