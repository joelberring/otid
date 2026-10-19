import { and, asc, eq, inArray } from "drizzle-orm";
import { schema } from "@o-tid/database";
import type { DbExecutor } from "./snapshot";
import { authorizeUserAccountSession } from "./user-account";

/**
 * En sessionsnivå (ADR-0168 beslut 4, ADR-0172 beslut 3, ADR-0173 beslut 4). En adminförfrågan bär kontots
 * session; rollen på tävlingen är kontots behörighet på eventet:
 *
 * - ADMIN: ägare eller administratör (OWNER/ADMIN) får göra allt i eventets tävlingar.
 * - FUNCTIONARY: funktionären får avläsning, direktanmälan av okänd bricka, kvar i skogen, start och speaker.
 *   En administratör har alltid också funktionärens rättigheter.
 *
 * Utan gällande behörighet på eventet är svaret "unauthorized", med för låg roll "forbidden".
 */
export type RaceRole = "ADMIN" | "FUNCTIONARY";
export type EventGrantRole = "OWNER" | "ADMIN" | "FUNCTIONARY";

/** Det en adminförfrågan bär: tävlingen, kontots sessionskaka och (för en skrivning) CSRF-paret. */
export interface RaceSessionProof {
  raceId: string;
  sessionToken: string | null;
  csrfCookie?: string | null;
  csrfHeader?: string | null;
}

export interface RaceRoleRequest extends RaceSessionProof {
  role: RaceRole;
  /** Skrivningar kräver att CSRF-kakan och rubriken är kontosessionens. */
  requireCsrf?: boolean;
}

export interface RacePrincipal {
  accountId: string;
  sessionId: string;
  raceId: string;
  eventId: string;
  grantId: string;
  grantRole: EventGrantRole;
  /** Rollen på tävlingen: ADMIN för ägare och administratör, annars FUNCTIONARY. */
  role: RaceRole;
  expiresAt: string;
}

export type RaceRoleResult =
  | { status: "unauthorized" }
  | { status: "forbidden" }
  | { status: "authenticated"; principal: RacePrincipal };

/**
 * Låsning: "none" för en kontroll före transaktionen, "share" för en läsning (behörigheten låses delat och en
 * samtidig återkallelse ger "unauthorized"), "update" för en skrivning (först i transaktionen, så att lås alltid
 * tas i ordningen session → konto → behörighet → tävling).
 */
export type RaceRoleLock = "none" | "share" | "update";

const ROLE_ORDER: Record<EventGrantRole, number> = { OWNER: 0, ADMIN: 1, FUNCTIONARY: 2 };

/**
 * Kontots gällande behörighet på eventet. `roles` begränsar vilka roller som räknas (förval: OWNER och ADMIN).
 * Har kontot flera gäller den starkaste (ägare före administratör före funktionär).
 */
export async function activeEventAdministrationGrant(
  tx: DbExecutor,
  input: { accountId: string; eventId: string; grantId?: string; ownerOnly?: boolean; roles?: readonly EventGrantRole[] },
  lock: RaceRoleLock
): Promise<{ id: string; role: EventGrantRole } | undefined> {
  const grantQuery = tx.select({ id: schema.eventAdministrationGrants.id, role: schema.eventAdministrationGrants.role })
    .from(schema.eventAdministrationGrants)
    .where(and(eq(schema.eventAdministrationGrants.accountId, input.accountId),
      eq(schema.eventAdministrationGrants.eventId, input.eventId),
      input.grantId ? eq(schema.eventAdministrationGrants.id, input.grantId) : undefined,
      input.ownerOnly ? eq(schema.eventAdministrationGrants.role, "OWNER") :
        inArray(schema.eventAdministrationGrants.role, [...(input.roles ?? ["OWNER", "ADMIN"])])))
    .orderBy(asc(schema.eventAdministrationGrants.grantedAt), asc(schema.eventAdministrationGrants.id));
  const grants = (lock === "share" ? await grantQuery.for("share") : lock === "update" ? await grantQuery.for("update") :
    await grantQuery).sort((a, b) => ROLE_ORDER[a.role] - ROLE_ORDER[b.role]);
  for (const grant of grants) {
    const guardQuery = tx.select({ grantId: schema.eventAdministrationGrantGuards.grantId })
      .from(schema.eventAdministrationGrantGuards)
      .where(eq(schema.eventAdministrationGrantGuards.grantId, grant.id));
    const [guard] = lock === "share" ? await guardQuery.for("share") : lock === "update" ? await guardQuery.for("update") :
      await guardQuery;
    if (!guard) continue;
    const [revocation] = await tx.select({ id: schema.eventAdministrationGrantRevocations.id })
      .from(schema.eventAdministrationGrantRevocations)
      .where(eq(schema.eventAdministrationGrantRevocations.grantId, grant.id));
    if (!revocation) return grant;
  }
  return undefined;
}

async function authorize(tx: DbExecutor, request: RaceRoleRequest, now: Date, lock: RaceRoleLock): Promise<RaceRoleResult> {
  const account = await authorizeUserAccountSession(tx, {
    sessionToken: request.sessionToken, csrfCookie: request.csrfCookie ?? null, csrfHeader: request.csrfHeader ?? null,
    ...(request.requireCsrf ? { requireCsrf: true } : {})
  }, now, lock);
  if (account.status !== "authenticated") return account;
  const [race] = await tx.select({ id: schema.races.id, eventId: schema.races.eventId }).from(schema.races)
    .where(eq(schema.races.id, request.raceId));
  if (!race) return { status: "unauthorized" };
  const grant = await activeEventAdministrationGrant(tx, { accountId: account.principal.accountId, eventId: race.eventId,
    roles: ["OWNER", "ADMIN", "FUNCTIONARY"] }, lock);
  if (!grant) return { status: "unauthorized" };
  const role: RaceRole = grant.role === "FUNCTIONARY" ? "FUNCTIONARY" : "ADMIN";
  if (request.role === "ADMIN" && role !== "ADMIN") return { status: "forbidden" };
  return { status: "authenticated", principal: {
    accountId: account.principal.accountId, sessionId: account.principal.sessionId, raceId: race.id, eventId: race.eventId,
    grantId: grant.id, grantRole: grant.role, role, expiresAt: account.principal.expiresAt
  } };
}

/** Den enda rollkontrollen för en tävling. Routes och tjänster anropar den innan något annat görs. */
export async function requireRaceRole(
  executor: DbExecutor,
  request: RaceRoleRequest,
  now = new Date(),
  lock: RaceRoleLock = "none"
): Promise<RaceRoleResult> {
  if (!Number.isFinite(now.getTime())) throw new Error("Autentiseringstiden är ogiltig");
  if (lock !== "share") return authorize(executor, request, now, lock);
  try {
    // En egen savepoint: en samtidig återkallelse avbryter bara kontrollen, aldrig den yttre läsningen.
    return await executor.transaction((authTx) => authorize(authTx, request, now, "share"));
  } catch (error) {
    if (postgresSerializationFailure(error)) return { status: "unauthorized" };
    throw error;
  }
}

function postgresSerializationFailure(error: unknown): boolean {
  const seen = new Set<unknown>();
  let current = error;
  for (let depth = 0; depth < 8 && current !== null && typeof current === "object" && !seen.has(current); depth++) {
    seen.add(current);
    if ("code" in current && current.code === "40001") return true;
    current = "cause" in current ? current.cause : undefined;
  }
  return false;
}
