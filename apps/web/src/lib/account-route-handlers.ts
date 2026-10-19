import {
  copyRaceAsAdmin,
  changeAccountDisplayName,
  changeAccountPassword,
  completePasswordReset,
  deleteEventAsOwner,
  deleteOwnAccount,
  readAccountProfile,
  requestPasswordReset
} from "@o-tid/application";
import {
  accountProfileSchema,
  deletedResponseSchema,
  organizerAccountLoginResponseSchema,
  passwordResetAvailabilitySchema,
  passwordResetCompleteResponseSchema,
  passwordResetRequestResponseSchema,
  raceCopyResponseSchema
} from "@o-tid/contracts";
import type { Database } from "@o-tid/database";
import {
  SecurityConfigurationError,
  type SecurityPolicy,
  accountFailure,
  clearSessionCookies,
  clientAddress,
  hasExpectedOrigin,
  hasNoRequestBody,
  privateJson,
  readJsonBody,
  securityPolicy,
  sessionProof,
  setSessionCookies
} from "./security-policy";
import { mailEnabled, mailErrorSummary, sendPasswordResetMail } from "./mail";
import { operatorContactEmail } from "./operator-contact";
import { UUID_PATTERN as UUID } from "@o-tid/contracts";

/**
 * Kontots egna anrop (ADR-0172): glömt lösenord, Mitt konto och att ta bort en egen tävling. Samma skydd som
 * inloggningen: Origin-kontroll och CSRF på skrivande anrop, privata svar utan cache.
 */
type Environment = Partial<Pick<NodeJS.ProcessEnv, "NODE_ENV" | "O_TID_PUBLIC_ORIGIN" | "OTID_SMTP_URL" | "OTID_MAIL_FROM" | "OTID_CONTACT_EMAIL">>;
type SendMail = typeof sendPasswordResetMail;

function policy(environment: Environment): { value: SecurityPolicy } | { response: Response } {
  try { return { value: securityPolicy(environment) }; }
  catch (error) {
    if (error instanceof SecurityConfigurationError) return { response: accountFailure(500, "INTERNAL_ERROR") };
    throw error;
  }
}

function failure(status: string): Response {
  switch (status) {
    case "unauthorized": return accountFailure(401, "UNAUTHORIZED");
    case "forbidden": return accountFailure(403, "FORBIDDEN");
    case "invalid-request": return accountFailure(400, "INVALID_REQUEST");
    case "not-found": case "invalid-token": return accountFailure(404, "NOT_FOUND");
    // Fel lösenord vid byte eller borttagning är en felaktig bekräftelse, inte saknad behörighet.
    case "wrong-password": case "confirmation-mismatch": return accountFailure(409, "CONFIRMATION_MISMATCH");
    case "conflict": return accountFailure(409, "CONFLICT");
    default: return accountFailure(500, "INTERNAL_ERROR");
  }
}

/** Skrivande anrop: rätt Origin, JSON-kropp och sessionen med CSRF. */
async function mutation(request: Request, environment: Environment) {
  const configured = policy(environment);
  if ("response" in configured) return configured;
  if (!hasExpectedOrigin(request, configured.value)) return { response: accountFailure(403, "FORBIDDEN") };
  let body: unknown;
  try { body = await readJsonBody(request); } catch { return { response: accountFailure(400, "INVALID_REQUEST") }; }
  return { policy: configured.value, body, proof: { ...sessionProof(request, configured.value, true), requireCsrf: true } };
}

export async function passwordResetAvailabilityRoute(request: Request, environment: Environment = process.env): Promise<Response> {
  if (!await hasNoRequestBody(request)) return accountFailure(400, "INVALID_REQUEST");
  return privateJson(passwordResetAvailabilitySchema.parse({
    formatVersion: 1, emailEnabled: mailEnabled(environment) !== undefined, contactEmail: operatorContactEmail(environment)
  }));
}

/** Samma svar oavsett om adressen finns. Bara ett befintligt, ospärrat konto får ett mejl. */
export async function passwordResetRequestRoute(
  db: Database, request: Request, environment: Environment = process.env, send: SendMail = sendPasswordResetMail,
  reset: typeof requestPasswordReset = requestPasswordReset
): Promise<Response> {
  const input = await mutation(request, environment);
  if ("response" in input) return input.response;
  const mail = mailEnabled(environment);
  if (!mail) return accountFailure(503, "MAIL_DISABLED");
  try {
    const result = await reset(db, input.body, { clientKey: clientAddress(request) });
    if (result.status === "invalid-request") return failure(result.status);
    if (result.delivery) {
      const link = `${input.policy.publicOrigin}/recover#token=${result.delivery.token}`;
      try {
        await send(mail, { to: result.delivery.email, displayName: result.delivery.displayName, link, expiresAt: result.delivery.expiresAt });
      } catch (error) {
        console.error(`Återställningsmejlet kunde inte skickas (${mailErrorSummary(error)}).`);
      }
    }
    return privateJson(passwordResetRequestResponseSchema.parse({ formatVersion: 1, status: "accepted" }), 202);
  } catch { return accountFailure(500, "INTERNAL_ERROR"); }
}

export async function passwordResetCompleteRoute(db: Database, request: Request, environment: Environment = process.env): Promise<Response> {
  const input = await mutation(request, environment);
  if ("response" in input) return input.response;
  try {
    const result = await completePasswordReset(db, input.body);
    if (result.status !== "reset") return failure(result.status);
    return privateJson(passwordResetCompleteResponseSchema.parse({ formatVersion: 1, status: "reset" }));
  } catch { return accountFailure(500, "INTERNAL_ERROR"); }
}

export async function accountProfileRoute(db: Database, request: Request, environment: Environment = process.env): Promise<Response> {
  const configured = policy(environment);
  if ("response" in configured) return configured.response;
  if (!await hasNoRequestBody(request)) return accountFailure(400, "INVALID_REQUEST");
  try {
    const result = await readAccountProfile(db, sessionProof(request, configured.value, false));
    if (result.status !== "ok") return failure(result.status);
    return privateJson(accountProfileSchema.parse(result.response));
  } catch { return accountFailure(500, "INTERNAL_ERROR"); }
}

export async function accountDisplayNameRoute(db: Database, request: Request, environment: Environment = process.env): Promise<Response> {
  const input = await mutation(request, environment);
  if ("response" in input) return input.response;
  try {
    const result = await changeAccountDisplayName(db, input.proof, input.body);
    if (result.status !== "changed") return failure(result.status);
    return privateJson({ formatVersion: 1, displayName: result.displayName });
  } catch { return accountFailure(500, "INTERNAL_ERROR"); }
}

/** Nytt lösenord: alla andra inloggningar slutar gälla och den här enheten får nya cookies. */
export async function accountPasswordRoute(db: Database, request: Request, environment: Environment = process.env): Promise<Response> {
  const input = await mutation(request, environment);
  if ("response" in input) return input.response;
  try {
    const result = await changeAccountPassword(db, input.proof, input.body);
    if (result.status !== "authenticated") return failure(result.status);
    const response = organizerAccountLoginResponseSchema.parse(result.response);
    return setSessionCookies(privateJson(response), input.policy, {
      sessionToken: result.sessionToken, csrfToken: result.csrfToken, expiresAt: response.expiresAt
    });
  } catch { return accountFailure(500, "INTERNAL_ERROR"); }
}

export async function accountDeleteRoute(db: Database, request: Request, environment: Environment = process.env): Promise<Response> {
  const input = await mutation(request, environment);
  if ("response" in input) return input.response;
  try {
    const result = await deleteOwnAccount(db, input.proof, input.body);
    if (result.status !== "deleted") return failure(result.status);
    return clearSessionCookies(privateJson(deletedResponseSchema.parse({ formatVersion: 1, status: "deleted" })), input.policy);
  } catch { return accountFailure(500, "INTERNAL_ERROR"); }
}

/** Ägaren tar bort sin tävling (Inställningar → Ta bort tävling). */
export async function organizerRaceDeleteRoute(
  db: Database, request: Request, raceId: string, environment: Environment = process.env
): Promise<Response> {
  if (!UUID.test(raceId)) return accountFailure(400, "INVALID_REQUEST");
  const input = await mutation(request, environment);
  if ("response" in input) return input.response;
  try {
    const result = await deleteEventAsOwner(db, { ...input.proof, raceId }, input.body);
    if (result.status !== "deleted") return failure(result.status);
    return privateJson(deletedResponseSchema.parse({ formatVersion: 1, status: "deleted" }));
  } catch { return accountFailure(500, "INTERNAL_ERROR"); }
}

/**
 * "Ny tävling som …" (PLAN.md steg 21): ägare och administratörer kopierar tävlingen med kontots inloggning, både från
 * Mina tävlingar och från Inställningar. Samma request-id ger samma kopia (200), en ny kopia ger 201.
 */
export async function organizerRaceCopyRoute(
  db: Database, request: Request, raceId: string, environment: Environment = process.env, copy: typeof copyRaceAsAdmin = copyRaceAsAdmin
): Promise<Response> {
  if (!UUID.test(raceId)) return accountFailure(400, "INVALID_REQUEST");
  const input = await mutation(request, environment);
  if ("response" in input) return input.response;
  try {
    const result = await copy(db, { ...input.proof, raceId, request: input.body });
    if (result.status !== "copied") return failure(result.status);
    const response = raceCopyResponseSchema.parse(result.response);
    return privateJson(response, response.replayed ? 200 : 201);
  } catch { return accountFailure(500, "INTERNAL_ERROR"); }
}
