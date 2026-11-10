import {
  readInvitationLink, resendClubInvitation, resendGroupInvitation, resendMapProjectInvitation, type InvitationMailer,
  type InvitationResendResult
} from "@o-tid/application";
import { invitationLinkRequestSchema, invitationLinkViewSchema, invitationResendResponseSchema, UUID_PATTERN } from "@o-tid/contracts";
import type { Database } from "@o-tid/database";
import { invitationMailer } from "./invitation-mail";
import { languageOfRequest } from "./language";
import {
  SecurityConfigurationError, accountFailure, hasExpectedOrigin, privateJson, readJsonBody, securityPolicy, sessionProof, type SecurityPolicy
} from "./security-policy";
import { logServerError } from "./server-error-log";

/**
 * ADR-0206: länksidans fråga (POST /api/invitation med nyckeln i kroppen, utan inloggning) och "Skicka igen"/"Kopiera länken"
 * i klubbens, gruppens och kartprojektets listor (inloggad administratör, exakt Origin och CSRF; tävlingens går genom arbetsytans route).
 * Svaren är privata och cachas inte.
 */
type Environment = Record<string, string | undefined>;
const BODY_MAX = 2 * 1024;

function policy(environment: Environment): SecurityPolicy | undefined {
  try { return securityPolicy(environment); }
  catch (error) {
    if (error instanceof SecurityConfigurationError) return undefined;
    throw error;
  }
}

/** Mejlaren för en route (undefined utan e-post på servern), med mejlet på språket hos den som bjuder in. */
export function routeMailer(environment: Environment = process.env, request?: Request): InvitationMailer | undefined {
  const configured = policy(environment);
  return configured ? invitationMailer(environment, configured.publicOrigin, undefined, undefined, request ? languageOfRequest(request) : "sv") : undefined;
}

/** Om e-post finns på servern, för listornas "Skicka igen" eller "Kopiera länken". */
export const mailAvailable = (environment: Environment = process.env) => routeMailer(environment) !== undefined;

/** Länksidan. Samma svar för okänd, ersatt, gammal och återkallad länk; inget om huruvida adressen har ett konto. */
export async function invitationLinkRoute(db: Database, request: Request, environment: Environment = process.env): Promise<Response> {
  const configured = policy(environment);
  if (!configured) return accountFailure(500, "INTERNAL_ERROR");
  if (!hasExpectedOrigin(request, configured)) return accountFailure(403, "FORBIDDEN");
  let body: unknown;
  try { body = await readJsonBody(request, BODY_MAX); } catch { return accountFailure(400, "INVALID_REQUEST"); }
  const parsed = invitationLinkRequestSchema.safeParse(body);
  if (!parsed.success) return privateJson(invitationLinkViewSchema.parse({ formatVersion: 1, status: "invalid" }));
  try {
    return privateJson(invitationLinkViewSchema.parse(await readInvitationLink(db, parsed.data.token)));
  } catch (error) {
    logServerError("invitation", "link", error);
    return accountFailure(500, "INTERNAL_ERROR");
  }
}

/** Svaret på Skicka igen eller Kopiera länken (också tävlingens, som går genom arbetsytans route). */
export function invitationResendResponse(result: InvitationResendResult): Response {
  switch (result.status) {
    case "ok": return privateJson(invitationResendResponseSchema.parse(result.response));
    case "unauthorized": return accountFailure(401, "UNAUTHORIZED");
    case "forbidden": return accountFailure(403, "FORBIDDEN");
    case "not-found": return accountFailure(404, "NOT_FOUND");
    case "mail-off": return accountFailure(503, "MAIL_DISABLED");
    default: return accountFailure(400, "INVALID_REQUEST");
  }
}

type Scope = { kind: "CLUB"; clubId: string } | { kind: "GROUP"; groupId: string } | { kind: "MAP_PROJECT"; projectId: string };

/** POST …/invitations/{invitationId} med `{ delivery: "MAIL" | "LINK" }`. */
export async function invitationResendRoute(db: Database, request: Request, scope: Scope, invitationId: string,
  environment: Environment = process.env): Promise<Response> {
  const scopeId = scope.kind === "CLUB" ? scope.clubId : scope.kind === "GROUP" ? scope.groupId : scope.projectId;
  if (!UUID_PATTERN.test(scopeId) || !UUID_PATTERN.test(invitationId)) return accountFailure(404, "NOT_FOUND");
  const configured = policy(environment);
  if (!configured) return accountFailure(500, "INTERNAL_ERROR");
  if (!hasExpectedOrigin(request, configured)) return accountFailure(403, "FORBIDDEN");
  let body: unknown;
  try { body = await readJsonBody(request, BODY_MAX); } catch { return accountFailure(400, "INVALID_REQUEST"); }
  const proof = sessionProof(request, configured, true);
  const mailer = routeMailer(environment, request);
  try {
    const input = { ...proof, invitationId, request: body };
    const result = scope.kind === "CLUB" ? await resendClubInvitation(db, { ...input, clubId: scope.clubId }, mailer)
      : scope.kind === "GROUP" ? await resendGroupInvitation(db, { ...input, groupId: scope.groupId }, mailer)
      : await resendMapProjectInvitation(db, { ...input, projectId: scope.projectId }, mailer);
    return invitationResendResponse(result);
  } catch (error) {
    logServerError("invitation", "resend", error);
    return accountFailure(500, "INTERNAL_ERROR");
  }
}
