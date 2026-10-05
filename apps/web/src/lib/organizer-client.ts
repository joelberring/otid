import {
  organizerAccountLoginRequestSchema,
  organizerAccountLoginResponseSchema,
  organizerEventCreateRequestSchema,
  organizerEventCreateResponseSchema,
  organizerMyEventsResponseSchema,
  organizerRaceEnterResponseSchema,
  type OrganizerAccountLoginRequest,
  type OrganizerEventCreateRequest,
  type OrganizerEventCreateResponse,
  type OrganizerMyEventsResponse
} from "@o-tid/contracts";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const PENDING_ATTEMPT_KEY = "otid.organizer.pending-event-create.v1";

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
