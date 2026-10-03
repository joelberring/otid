import { authenticatePairingAdminSession, issuePairingAdminAccessCredential, loginPairingAdmin, validateDemoTarget } from "@o-tid/application";
import { raceAdministratorLoginResponseSchema } from "@o-tid/contracts";
import type { Database } from "@o-tid/database";
import {
  entryClassAdminJson,
  entryClassAdminSecurityPolicy,
  entryClassAdminSessionProof,
  hasNoEntryClassAdminRequestBody,
  privateEntryClassAdminHeaders,
  setEntryClassAdminCookies
} from "./entry-class-admin-security";
import { RACE_ADMINISTRATOR_LOOPBACK_COOKIES } from "./race-administrator-cookies";

type DevelopmentDemoEnvironment = Partial<Pick<NodeJS.ProcessEnv,
  "NODE_ENV" | "O_TID_DEV_AUTO_LOGIN_RACE_ID" | "O_TID_PUBLIC_ORIGIN" | "DATABASE_URL" | "O_TID_DEMO_E2E">>;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const NO_STORE = { ...privateEntryClassAdminHeaders };

function configuredDemoTarget(environment: DevelopmentDemoEnvironment): { raceId: string; databaseName: string; origin: URL } | null {
  const raceId = environment.O_TID_DEV_AUTO_LOGIN_RACE_ID;
  const publicOrigin = environment.O_TID_PUBLIC_ORIGIN;
  const databaseUrl = environment.DATABASE_URL;
  if (environment.NODE_ENV !== "development" || environment.O_TID_DEMO_E2E === "1" ||
      !raceId || !UUID.test(raceId) || !publicOrigin || !databaseUrl) return null;
  try {
    const origin = new URL(publicOrigin);
    if (publicOrigin !== origin.origin || origin.protocol !== "http:" ||
        origin.username || origin.password || origin.pathname !== "/" || origin.search || origin.hash ||
        !["localhost", "127.0.0.1", "[::1]"].includes(origin.hostname)) return null;
    const target = validateDemoTarget({ databaseUrl, environment: environment.NODE_ENV, confirmation: "synthetic-empty-database" });
    return { raceId, databaseName: target.databaseName, origin };
  } catch {
    return null;
  }
}

/** Enables the local auto-session for one canonical race on an isolated demo target only. */
export function developmentDemoAccessEnabled(raceId: string, environment: DevelopmentDemoEnvironment = process.env): boolean {
  const target = configuredDemoTarget(environment);
  return target !== null && raceId === target.raceId;
}

type Authentication = typeof authenticatePairingAdminSession;
type Issue = typeof issuePairingAdminAccessCredential;
type Login = typeof loginPairingAdmin;
export interface DevelopmentDemoAccessDependencies {
  currentDatabaseName: (db: Database) => Promise<string>;
  authenticate: Authentication;
  issue: Issue;
  login: Login;
  now: () => Date;
}

const defaultDependencies = {
  authenticate: authenticatePairingAdminSession,
  issue: issuePairingAdminAccessCredential,
  login: loginPairingAdmin,
  now: () => new Date()
};

function response(status: number): Response {
  return new Response(null, { status, headers: NO_STORE });
}

export async function developmentDemoSessionRoute(
  db: Database,
  request: Request,
  raceId: string,
  dependencies: Pick<DevelopmentDemoAccessDependencies, "currentDatabaseName"> & Partial<Omit<DevelopmentDemoAccessDependencies, "currentDatabaseName">>,
  environment: DevelopmentDemoEnvironment = process.env
): Promise<Response> {
  const target = configuredDemoTarget(environment);
  if (!target || raceId !== target.raceId) return response(404);
  if (request.method !== "POST") return response(405);
  // Next may normalize request.url to its internal hostname; the incoming Host
  // and browser Origin must both match the explicitly configured loopback origin.
  if (request.headers.get("origin") !== target.origin.origin ||
      request.headers.get("host") !== target.origin.host) return response(403);
  try {
    if (!await hasNoEntryClassAdminRequestBody(request)) return response(400);
  } catch {
    return response(400);
  }

  const services = { ...defaultDependencies, ...dependencies };
  try {
    if (await services.currentDatabaseName(db) !== target.databaseName) return response(404);
    const policy = {
      ...entryClassAdminSecurityPolicy(environment),
      cookieNames: RACE_ADMINISTRATOR_LOOPBACK_COOKIES
    };
    const proof = entryClassAdminSessionProof(request, policy, true);
    if (proof.sessionToken && proof.csrfCookie) {
      const existing = await services.authenticate(db, {
        sessionToken: proof.sessionToken,
        raceId,
        capability: "MANAGE_RACE",
        csrfCookie: proof.csrfCookie,
        csrfHeader: proof.csrfCookie,
        requireCsrf: true
      });
      if (existing.status === "authenticated" && existing.principal.raceId === raceId &&
          existing.principal.capability === "MANAGE_RACE") {
        const body = raceAdministratorLoginResponseSchema.parse({
          formatVersion: 1, raceId, capability: "MANAGE_RACE", expiresAt: existing.principal.expiresAt
        });
        return setEntryClassAdminCookies(entryClassAdminJson(body), policy, {
          sessionToken: proof.sessionToken,
          csrfToken: proof.csrfCookie,
          expiresAt: body.expiresAt
        });
      }
    }

    const now = services.now();
    const credential = await services.issue(db, {
      raceId,
      capability: "MANAGE_RACE",
      label: "Lokal utvecklingsåtkomst",
      expiresAt: new Date(now.getTime() + 8 * 60 * 60 * 1000)
    }, { now });
    const login = await services.login(db, {
      formatVersion: 1,
      accessCredential: credential.accessCredential
    }, { expectedRaceId: raceId, expectedCapability: "MANAGE_RACE", now });
    if (login.status !== "authenticated") return response(500);
    const body = raceAdministratorLoginResponseSchema.parse(login.response);
    return setEntryClassAdminCookies(entryClassAdminJson(body), policy, {
      sessionToken: login.sessionToken,
      csrfToken: login.csrfToken,
      expiresAt: body.expiresAt
    });
  } catch {
    return response(500);
  }
}
