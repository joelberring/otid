import {
  organizerAccountLoginRequestSchema,
  organizerAccountLoginResponseSchema,
  organizerEventCreateRequestSchema,
  organizerEventCreateResponseSchema,
  organizerMyEventsResponseSchema,
  organizerRaceEnterResponseSchema,
  organizerAdminGrantRequestSchema,
  organizerAdminGrantResponseSchema,
  organizerAdminListResponseSchema,
  organizerAdminRevokeRequestSchema,
  organizerAdminRevokeResponseSchema,
  type OrganizerAccountLoginRequest,
  type OrganizerEventCreateRequest,
  type OrganizerEventCreateResponse,
  type OrganizerMyEventsResponse
} from "@o-tid/contracts";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const PENDING_ATTEMPT_KEY = "otid.organizer.pending-event-create.v1";
const PENDING_ADMIN_KEY = "otid.organizer.pending-admin-mutation.v1";
const pendingAdminKey = (accountId: string, eventId: string) => `${PENDING_ADMIN_KEY}.${accountId}.${eventId}`;

export type OrganizerAdminMutationAttempt = {
  accountId: string;
  action: "grant" | "revoke";
  eventId: string;
  requestId: string;
  request: Record<string, unknown>;
};

export function parseOrganizerAdminList(value: unknown) {
  const parsed = organizerAdminListResponseSchema.safeParse(value);
  if (!parsed.success) throw new Error("Administratörslistan hade ett ogiltigt format.");
  return parsed.data;
}

export function parseOrganizerAdminGrantResponse(value: unknown, attempt: OrganizerAdminMutationAttempt) {
  const parsed = organizerAdminGrantResponseSchema.safeParse(value);
  if (!parsed.success || parsed.data.eventId !== attempt.eventId || parsed.data.requestId !== attempt.requestId ||
    parsed.data.email !== attempt.request.email) {
    throw new Error("Servern kunde inte bekräfta tilldelningen.");
  }
  return parsed.data;
}

export function parseOrganizerAdminRevokeResponse(value: unknown, attempt: OrganizerAdminMutationAttempt) {
  const parsed = organizerAdminRevokeResponseSchema.safeParse(value);
  if (!parsed.success || parsed.data.eventId !== attempt.eventId || parsed.data.requestId !== attempt.requestId ||
    parsed.data.grantId !== attempt.request.grantId) {
    throw new Error("Servern kunde inte bekräfta återkallelsen.");
  }
  return parsed.data;
}

export function saveOrganizerAdminAttempt(attempt: OrganizerAdminMutationAttempt): void {
  window.sessionStorage.setItem(pendingAdminKey(attempt.accountId, attempt.eventId), JSON.stringify(attempt));
}

export function restoreOrganizerAdminAttempt(accountId: string, eventId: string): OrganizerAdminMutationAttempt | undefined {
  const storageKey = pendingAdminKey(accountId, eventId);
  const raw = window.sessionStorage.getItem(storageKey);
  if (!raw) return undefined;
  try {
    const candidate: unknown = JSON.parse(raw);
    if (!candidate || typeof candidate !== "object") throw new Error("Ogiltigt försök");
    const record = candidate as OrganizerAdminMutationAttempt;
    if (!UUID_PATTERN.test(record.accountId) || !UUID_PATTERN.test(record.eventId) ||
      !UUID_PATTERN.test(record.requestId) || (record.action !== "grant" && record.action !== "revoke")) throw new Error("Ogiltig identitet");
    if (record.action === "grant") {
      const request = organizerAdminGrantRequestSchema.parse(record.request);
      if (request.requestId !== record.requestId || request.eventId !== record.eventId) throw new Error("Försöksidentiteten stämmer inte");
    } else {
      const request = organizerAdminRevokeRequestSchema.parse(record.request);
      if (request.requestId !== record.requestId || request.eventId !== record.eventId) throw new Error("Försöksidentiteten stämmer inte");
    }
    return record;
  } catch {
    window.sessionStorage.removeItem(storageKey);
    return undefined;
  }
}

export function clearOrganizerAdminAttempt(accountId: string, eventId: string): void {
  window.sessionStorage.removeItem(pendingAdminKey(accountId, eventId));
}

export interface OrganizerCreateAttempt {
  accountId: string;
  requestId: string;
  request: OrganizerEventCreateRequest;
}

export function createOrganizerAttempt(value: unknown, accountId: string, randomUuid: () => string): OrganizerCreateAttempt {
  const request = organizerEventCreateRequestSchema.parse(value);
  if (!UUID_PATTERN.test(accountId)) throw new Error("Kunde inte koppla försöket till kontot.");
  const requestId = randomUuid();
  if (!UUID_PATTERN.test(requestId)) throw new Error("Kunde inte skapa ett giltigt request-id.");
  return { accountId, requestId, request };
}

export function parseOrganizerCreateResponse(value: unknown, attempt: OrganizerCreateAttempt): OrganizerEventCreateResponse {
  const parsed = organizerEventCreateResponseSchema.safeParse(value);
  if (!parsed.success || parsed.data.requestId !== attempt.requestId) {
    throw new Error("Servern svarade med ett ogiltigt bekräftelsebesked.");
  }
  return parsed.data;
}

export function parseOrganizerEvents(value: unknown): OrganizerMyEventsResponse {
  const parsed = organizerMyEventsResponseSchema.safeParse(value);
  if (!parsed.success) throw new Error("Tävlingslistan hade ett ogiltigt format.");
  return parsed.data;
}

export function parseOrganizerSession(value: unknown) {
  const parsed = organizerAccountLoginResponseSchema.safeParse(value);
  if (!parsed.success) throw new Error("Sessionssvaret hade ett ogiltigt format.");
  return parsed.data;
}

/** Inloggning med e-post (ADR-0172). Ogiltig adress ger ett begripligt fel innan något skickas. */
export function parseOrganizerLoginRequest(email: string, password: string): OrganizerAccountLoginRequest {
  const parsed = organizerAccountLoginRequestSchema.safeParse({ formatVersion: 1, email, password });
  if (!parsed.success) throw new Error("Skriv en giltig e-postadress och ditt lösenord.");
  return parsed.data;
}

export function parseOrganizerEnterResponse(value: unknown, expectedRaceId: string): void {
  const parsed = organizerRaceEnterResponseSchema.safeParse(value);
  if (!parsed.success || parsed.data.raceId !== expectedRaceId) {
    throw new Error("Servern kunde inte bekräfta tävlingsåtkomsten.");
  }
}

export function readOrganizerCsrf(cookieText: string, currentUrl: URL): string {
  const isLoopback = currentUrl.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(currentUrl.hostname);
  const name = isLoopback ? "otid_organizer_csrf" : "__Host-otid-organizer-csrf";
  let value: string | undefined;
  for (const part of cookieText.split(";")) {
    const separator = part.indexOf("=");
    if (separator < 0 || part.slice(0, separator).trim() !== name) continue;
    if (value !== undefined) throw new Error("CSRF-cookien är tvetydig. Ladda om sidan och försök igen.");
    value = part.slice(separator + 1).trim();
  }
  if (!value || !/^[A-Za-z0-9_-]{43}$/.test(value)) {
    throw new Error("Sessionen saknar giltigt skydd. Logga in igen.");
  }
  return value;
}

export function saveOrganizerAttempt(attempt: OrganizerCreateAttempt): void {
  window.sessionStorage.setItem(PENDING_ATTEMPT_KEY, JSON.stringify(attempt));
}

export function restoreOrganizerAttempt(): OrganizerCreateAttempt | undefined {
  const raw = window.sessionStorage.getItem(PENDING_ATTEMPT_KEY);
  if (!raw) return undefined;
  try {
    const candidate: unknown = JSON.parse(raw);
    if (!candidate || typeof candidate !== "object") throw new Error("Ogiltigt försök");
    const record = candidate as { accountId?: unknown; requestId?: unknown; request?: unknown };
    if (typeof record.accountId !== "string" || !UUID_PATTERN.test(record.accountId)) throw new Error("Ogiltigt konto-id");
    if (typeof record.requestId !== "string" || !UUID_PATTERN.test(record.requestId)) throw new Error("Ogiltigt request-id");
    return { accountId: record.accountId, requestId: record.requestId,
      request: organizerEventCreateRequestSchema.parse(record.request) };
  } catch {
    window.sessionStorage.removeItem(PENDING_ATTEMPT_KEY);
    return undefined;
  }
}

export function clearOrganizerAttempt(): void {
  window.sessionStorage.removeItem(PENDING_ATTEMPT_KEY);
}
