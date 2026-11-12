import {
  authenticateUserAccountSession,
  checkEmailVerificationToken,
  createOrganizerEvent,
  listMyEvents,
  loginUserAccount,
  logoutUserAccountSession,
  newRegistrationBrowserSecret,
  REGISTRATION_BROWSER_LIFETIME_MS,
  registerUserAccount,
  registerUserAccountWithVerification,
  verifyEmailAndLogIn,
  type EmailVerificationDelivery
} from "@o-tid/application";
import {
  emailVerificationCheckResponseSchema,
  organizerAccountLoginRequestSchema,
  organizerAccountLoginResponseSchema,
  organizerEventCreateIdempotencyKeySchema,
  organizerEventCreateResponseSchema,
  organizerEventCreateRequestSchema,
  organizerMyEventsResponseSchema,
  organizerAccountSessionStatusSchema,
  organizerAccountRegistrationPendingSchema,
  organizerAccountRegistrationRequestSchema
} from "@o-tid/contracts";
import type { Database } from "@o-tid/database";
import {
  SecurityConfigurationError,
  accountFailure,
  clearSessionCookies,
  clientAddress,
  hasExpectedOrigin,
  hasNoRequestBody,
  organizerFailure,
  privateHeaders,
  privateJson,
  readJsonBody,
  readUniqueCookie,
  securityPolicy,
  sessionProof,
  setSessionCookies,
  type SecurityPolicy
} from "./security-policy";
import { registrationCookieName } from "./organizer-account-cookies";
import {
  alreadyRegisteredMessage, emailVerificationMessage, mailEnabled, runInBackground, sendMessage, type Background, type MailConfiguration
} from "./mail";
import { logServerError } from "./server-error-log";
import { languageOfRequest, type Language } from "./language";

type Environment = Partial<Pick<NodeJS.ProcessEnv, "NODE_ENV" | "O_TID_PUBLIC_ORIGIN" | "OTID_REGISTRATION_LIMIT_PER_HOUR" | "OTID_SMTP_URL" |
  "OTID_MAIL_FROM">>;
type Mail = Extract<MailConfiguration, { status: "on" }>;
type Send = typeof sendMessage;
type Login = typeof loginUserAccount;
type Register = typeof registerUserAccount;
type RegisterWithVerification = typeof registerUserAccountWithVerification;
type Verify = typeof verifyEmailAndLogIn;
type Check = typeof checkEmailVerificationToken;
type Authenticate = typeof authenticateUserAccountSession;
type Logout = typeof logoutUserAccountSession;
type Create = typeof createOrganizerEvent;
type List = typeof listMyEvents;

function policy(environment: Environment) {
  try { return { value: securityPolicy(environment) } as const; }
  catch (error) {
    if (error instanceof SecurityConfigurationError) return { response: organizerFailure(500, "INTERNAL_ERROR") } as const;
    throw error;
  }
}

function authenticationFailure(status: string): Response {
  return status === "unauthorized" ? organizerFailure(401, "UNAUTHORIZED") : organizerFailure(403, "FORBIDDEN");
}

function requestFailure(status: string): Response {
  switch (status) {
    case "unauthorized": return organizerFailure(401, "UNAUTHORIZED");
    case "forbidden": return organizerFailure(403, "FORBIDDEN");
    case "invalid-request": return organizerFailure(400, "INVALID_REQUEST");
    case "conflict": return organizerFailure(409, "CONFLICT");
    case "not-found": return organizerFailure(404, "UNAUTHORIZED");
    default: return organizerFailure(500, "INTERNAL_ERROR");
  }
}

/** ADR-0205 tillägg 2026-11-12: kakan med registreringens hemlighet (eller en som tar bort den, med `maxAgeSeconds` 0). */
function registrationCookie(policy: SecurityPolicy, value: string, maxAgeSeconds: number): string {
  return [`${registrationCookieName(policy.secureCookies)}=${value}`, "Path=/", `Max-Age=${maxAgeSeconds}`, "SameSite=Strict", "HttpOnly",
    ...(policy.secureCookies ? ["Secure"] : [])].join("; ");
}

function registrationSecret(request: Request, policy: SecurityPolicy): string | undefined {
  return readUniqueCookie(request, registrationCookieName(policy.secureCookies)) ?? undefined;
}

/** ADR-0186: mejlet med bekräftelselänken, eller att adressen redan har ett konto. */
async function sendVerification(mail: Mail, origin: string, delivery: EmailVerificationDelivery, send: Send, language: Language): Promise<void> {
  if (delivery.kind === "ALREADY_REGISTERED") {
    await send(mail, delivery.email, alreadyRegisteredMessage({ displayName: delivery.displayName, loginLink: `${origin}/organizer`,
      recoverLink: `${origin}/recover`, language }));
    return;
  }
  await send(mail, delivery.email, emailVerificationMessage({ to: delivery.email, displayName: delivery.displayName,
    link: `${origin}/verify#token=${delivery.token}`, expiresAt: delivery.expiresAt, language }));
}

export async function organizerLoginRoute(
  db: Database, request: Request, login: Login = loginUserAccount, environment: Environment = process.env,
  send: Send = sendMessage, background: Background = runInBackground
): Promise<Response> {
  const configured = policy(environment);
  if ("response" in configured) return configured.response;
  if (!hasExpectedOrigin(request, configured.value)) return organizerFailure(403, "FORBIDDEN");
  let body: unknown;
  try { body = await readJsonBody(request); } catch { return organizerFailure(400, "INVALID_REQUEST"); }
  const parsed = organizerAccountLoginRequestSchema.safeParse(body);
  if (!parsed.success) return organizerFailure(400, "INVALID_REQUEST");
  try {
    // ADR-0186: med e-post loggas ett obekräftat konto inte in (samma svar som fel lösenord); det får en ny länk.
    const mail = mailEnabled(environment);
    const result = await login(db, parsed.data, { clientKey: clientAddress(request), ...(mail ? { requireVerifiedEmail: true } : {}) });
    if (result.status === "unauthorized" && result.verification && mail) {
      const delivery = result.verification;
      background("Bekräftelsemejlet", () => sendVerification(mail, configured.value.publicOrigin, delivery, send, languageOfRequest(request)));
    }
    if (result.status !== "authenticated") {
      return result.status === "rate-limited" ? accountFailure(429, "RATE_LIMITED")
        : result.status === "blocked" ? accountFailure(403, "ACCOUNT_BLOCKED") : organizerFailure(401, "UNAUTHORIZED");
    }
    const response = organizerAccountLoginResponseSchema.parse(result.response);
    return setSessionCookies(privateJson(response), configured.value, {
      sessionToken: result.sessionToken, csrfToken: result.csrfToken, expiresAt: response.expiresAt
    });
  } catch (error) { logServerError("organizer-account", "organizerLoginRoute", error); return organizerFailure(500, "INTERNAL_ERROR"); }
}

/** Antal registreringar per IP och timme (`OTID_REGISTRATION_LIMIT_PER_HOUR`, förval 10). */
export function registrationsPerHour(environment: Environment): number | undefined {
  const value = environment.OTID_REGISTRATION_LIMIT_PER_HOUR?.trim();
  return value && /^[1-9]\d{0,5}$/.test(value) ? Number(value) : undefined;
}

/**
 * Öppen registrering (ADR-0172), med spärr per IP. ADR-0186: med e-post inställd blir svaret detsamma oavsett om adressen
 * redan har ett konto (202, "kolla e-posten"), och allt arbete görs efter svaret; kontot loggas in när länken öppnas. Utan
 * e-post skapas kontot och loggas in direkt som förut (adressen är då obekräftad tills superadmin bekräftar den).
 * ADR-0205 tillägg 2026-11-12: svaret sätter alltid (oavsett adress) en kaka med en ny slumpad hemlighet, som länken från just
 * den här registreringen minns; öppnas länken i samma webbläsare behöver lösenordet inte skrivas igen.
 */
export async function organizerRegisterRoute(
  db: Database, request: Request, register: Register = registerUserAccount, environment: Environment = process.env,
  registerWithVerification: RegisterWithVerification = registerUserAccountWithVerification, send: Send = sendMessage,
  background: Background = runInBackground
): Promise<Response> {
  const configured = policy(environment);
  if ("response" in configured) return configured.response;
  if (!hasExpectedOrigin(request, configured.value)) return organizerFailure(403, "FORBIDDEN");
  let body: unknown;
  try { body = await readJsonBody(request); } catch { return organizerFailure(400, "INVALID_REQUEST"); }
  const mail = mailEnabled(environment);
  if (mail) {
    if (!organizerAccountRegistrationRequestSchema.safeParse(body).success) return organizerFailure(400, "INVALID_REQUEST");
    const limit = registrationsPerHour(environment);
    const clientKey = clientAddress(request);
    const browserSecret = newRegistrationBrowserSecret();
    background("Registreringen", async () => {
      const result = await registerWithVerification(db, body, { clientKey, browserSecret, ...(limit ? { registrationsPerHour: limit } : {}) });
      if (result.delivery) await sendVerification(mail, configured.value.publicOrigin, result.delivery, send, languageOfRequest(request));
    });
    const response = privateJson(organizerAccountRegistrationPendingSchema.parse({ formatVersion: 1, status: "check-email" }), 202);
    response.headers.append("set-cookie", registrationCookie(configured.value, browserSecret, REGISTRATION_BROWSER_LIFETIME_MS / 1000));
    return response;
  }
  try {
    const limit = registrationsPerHour(environment);
    const result = await register(db, body, { clientKey: clientAddress(request), ...(limit ? { registrationsPerHour: limit } : {}) });
    if (result.status === "rate-limited") return accountFailure(429, "RATE_LIMITED");
    if (result.status !== "authenticated") return requestFailure(result.status);
    const response = organizerAccountLoginResponseSchema.parse(result.response);
    return setSessionCookies(privateJson(response, 201), configured.value, {
      sessionToken: result.sessionToken, csrfToken: result.csrfToken, expiresAt: response.expiresAt
    });
  } catch (error) { logServerError("organizer-account", "organizerRegisterRoute", error); return organizerFailure(500, "INTERNAL_ERROR"); }
}

/**
 * ADR-0186, ändrat av ADR-0205: länken i bekräftelsemejlet och lösenordet som personen väljer på sidan. Bekräftar adressen och
 * loggar in. En länk till ett konto som redan är bekräftat ger 409 (sidan visar inloggningen), en ogiltig 404. Tillägg
 * 2026-11-12: utan lösenord gäller registreringens, om kakan från registreringen hör till länken; annars 403 (välj lösenord).
 */
export async function organizerVerifyEmailRoute(
  db: Database, request: Request, verify: Verify = verifyEmailAndLogIn, environment: Environment = process.env
): Promise<Response> {
  const configured = policy(environment);
  if ("response" in configured) return configured.response;
  if (!hasExpectedOrigin(request, configured.value)) return organizerFailure(403, "FORBIDDEN");
  let body: unknown;
  try { body = await readJsonBody(request); } catch { return organizerFailure(400, "INVALID_REQUEST"); }
  try {
    const browserSecret = registrationSecret(request, configured.value);
    const result = await verify(db, body, { clientKey: clientAddress(request), ...(browserSecret ? { browserSecret } : {}) });
    if (result.status === "invalid-request") return organizerFailure(400, "INVALID_REQUEST");
    if (result.status === "already-verified") return accountFailure(409, "CONFLICT");
    if (result.status === "password-required") return accountFailure(403, "FORBIDDEN");
    if (result.status !== "authenticated") return accountFailure(404, "NOT_FOUND");
    const response = organizerAccountLoginResponseSchema.parse(result.response);
    const verified = setSessionCookies(privateJson(response), configured.value, {
      sessionToken: result.sessionToken, csrfToken: result.csrfToken, expiresAt: response.expiresAt
    });
    // Registreringens kaka behövs inte längre (länkarna är förbrukade).
    if (browserSecret) verified.headers.append("set-cookie", registrationCookie(configured.value, "deleted", 0));
    return verified;
  } catch (error) { logServerError("organizer-account", "organizerVerifyEmailRoute", error); return organizerFailure(500, "INTERNAL_ERROR"); }
}

/**
 * ADR-0205: vad bekräftelselänken leder till (välj lösenord, redan bekräftad eller ogiltig) innan personen skriver något.
 * Tillägg 2026-11-12: `sameBrowser` när kakan från registreringen hör till länken.
 */
export async function organizerVerifyEmailCheckRoute(
  db: Database, request: Request, check: Check = checkEmailVerificationToken, environment: Environment = process.env
): Promise<Response> {
  const configured = policy(environment);
  if ("response" in configured) return configured.response;
  if (!hasExpectedOrigin(request, configured.value)) return organizerFailure(403, "FORBIDDEN");
  let body: unknown;
  try { body = await readJsonBody(request); } catch { return organizerFailure(400, "INVALID_REQUEST"); }
  try {
    const browserSecret = registrationSecret(request, configured.value);
    const result = await check(db, body, browserSecret ? { browserSecret } : {});
    if (result.status !== "checked") return organizerFailure(400, "INVALID_REQUEST");
    return privateJson(emailVerificationCheckResponseSchema.parse({ formatVersion: 1, state: result.state,
      ...(result.sameBrowser ? { sameBrowser: true } : {}) }));
  } catch (error) { logServerError("organizer-account", "organizerVerifyEmailCheckRoute", error); return organizerFailure(500, "INTERNAL_ERROR"); }
}

export async function organizerSessionStatusRoute(
  db: Database, request: Request, authenticate: Authenticate = authenticateUserAccountSession,
  environment: Environment = process.env
): Promise<Response> {
  const configured = policy(environment);
  if ("response" in configured) return configured.response;
  if (!await hasNoRequestBody(request)) return organizerFailure(400, "INVALID_REQUEST");
  try {
    // Demoläget del 2: kontomenyn visar gästläget, så gäster får ett svar här (men inte på kontots sidor).
    const result = await authenticate(db, { ...sessionProof(request, configured.value, false), allowGuest: true });
    // Frågan "är jag inloggad?" är ett normalt svar, inte ett fel: inget 401 i webbläsarens konsol (PLAN.md steg 22).
    if (result.status === "unauthorized") return privateJson(organizerAccountSessionStatusSchema.parse({ formatVersion: 1, authenticated: false }));
    if (result.status !== "authenticated") return authenticationFailure(result.status);
    return privateJson(organizerAccountSessionStatusSchema.parse({
      formatVersion: 1, accountId: result.principal.accountId, email: result.principal.email,
      displayName: result.principal.displayName, superadmin: result.principal.superadmin, expiresAt: result.principal.expiresAt,
      emailVerified: result.principal.emailVerified,
      ...(result.principal.guestExpiresAt ? { guestExpiresAt: result.principal.guestExpiresAt } : {})
    }));
  } catch (error) { logServerError("organizer-account", "organizerSessionStatusRoute", error); return organizerFailure(500, "INTERNAL_ERROR"); }
}

export async function organizerLogoutRoute(
  db: Database, request: Request, logout: Logout = logoutUserAccountSession,
  environment: Environment = process.env
): Promise<Response> {
  const configured = policy(environment);
  if ("response" in configured) return configured.response;
  if (!hasExpectedOrigin(request, configured.value)) return organizerFailure(403, "FORBIDDEN");
  if (!await hasNoRequestBody(request)) return organizerFailure(400, "INVALID_REQUEST");
  // Städrundan 2026-11-07: exakt Origin och sessionskakan räcker för att logga ut (utan CSRF-kakan), så att sessionen alltid
  // spärras på servern. En annan webbplats kan inte sätta Origin, och utloggning ger ingen behörighet.
  const proof = sessionProof(request, configured.value, false);
  try {
    const result = await logout(db, { ...proof, requireCsrf: false }, undefined);
    if (result.status === "unauthorized") return clearSessionCookies(organizerFailure(401, "UNAUTHORIZED"), configured.value);
    if (result.status === "forbidden") return organizerFailure(403, "FORBIDDEN");
    return clearSessionCookies(new Response(null, { status: 204, headers: privateHeaders }), configured.value);
  } catch (error) { logServerError("organizer-account", "organizerLogoutRoute", error); return organizerFailure(500, "INTERNAL_ERROR"); }
}

export async function organizerEventsListRoute(
  db: Database, request: Request, list: List = listMyEvents,
  environment: Environment = process.env
): Promise<Response> {
  const configured = policy(environment);
  if ("response" in configured) return configured.response;
  if (request.method !== "GET" || !await hasNoRequestBody(request)) return organizerFailure(400, "INVALID_REQUEST");
  try {
    const result = await list(db, sessionProof(request, configured.value, false));
    if (result.status !== "ok") return authenticationFailure(result.status);
    return privateJson(organizerMyEventsResponseSchema.parse(result.response));
  } catch (error) { logServerError("organizer-account", "organizerEventsListRoute", error); return organizerFailure(500, "INTERNAL_ERROR"); }
}

export async function organizerEventCreateRoute(
  db: Database, request: Request, authenticate: Authenticate = authenticateUserAccountSession,
  create: Create = createOrganizerEvent, environment: Environment = process.env
): Promise<Response> {
  const configured = policy(environment);
  if ("response" in configured) return configured.response;
  if (!hasExpectedOrigin(request, configured.value)) return organizerFailure(403, "FORBIDDEN");
  const proof = sessionProof(request, configured.value, true);
  try {
    const auth = await authenticate(db, { ...proof, requireCsrf: true });
    if (auth.status !== "authenticated") return authenticationFailure(auth.status);
  } catch (error) { logServerError("organizer-account", "organizerEventCreateRoute", error); return organizerFailure(500, "INTERNAL_ERROR"); }
  const idempotencyKey = request.headers.get("idempotency-key");
  if (!organizerEventCreateIdempotencyKeySchema.safeParse(idempotencyKey).success) return organizerFailure(400, "INVALID_REQUEST");
  let body: unknown;
  try { body = await readJsonBody(request); } catch { return organizerFailure(400, "INVALID_REQUEST"); }
  const parsed = organizerEventCreateRequestSchema.safeParse(body);
  if (!parsed.success) return organizerFailure(400, "INVALID_REQUEST");
  try {
    const result = await create(db, { ...proof, requireCsrf: true, idempotencyKey,
      readBody: async () => parsed.data });
    if (result.status !== "created") return requestFailure(result.status);
    const response = organizerEventCreateResponseSchema.parse(result.response);
    return privateJson(response, response.replayed ? 200 : 201);
  } catch (error) { logServerError("organizer-account", "organizerEventCreateRoute", error); return organizerFailure(500, "INTERNAL_ERROR"); }
}

