import {
  eventCreationRequestSchema,
  eventCreationResponseSchema,
  type EventCreationRequest,
  type EventCreationResponse
} from "@o-tid/contracts";
import { sv } from "../i18n/sv";
import { readEventCreationCsrfCookie } from "./event-creation-admin-cookies";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export interface EventCreationAttempt {
  requestId: string;
  request: EventCreationRequest;
}

export function createEventCreationAttempt(value: unknown, randomUuid: () => string): EventCreationAttempt {
  const request = eventCreationRequestSchema.parse(value);
  const requestId = randomUuid();
  if (!UUID_PATTERN.test(requestId)) throw new Error(sv.eventCreationRequestIdError);
  return { requestId, request };
}

export function parseEventCreationResponse(
  value: unknown,
  attempt: EventCreationAttempt
): EventCreationResponse {
  const parsed = eventCreationResponseSchema.safeParse(value);
  if (!parsed.success || parsed.data.requestId !== attempt.requestId) {
    throw new Error(sv.eventCreationInvalidResponse);
  }
  return parsed.data;
}

export function readEventCreationCsrf(cookieText: string, currentUrl: URL): string {
  const value = readEventCreationCsrfCookie(cookieText, currentUrl);
  if (value !== undefined && /^[A-Za-z0-9_-]{43}$/.test(value)) return value;
  throw new Error(sv.eventCreationLoginAgain);
}

export function isDefinitiveEventCreationRejection(status: number): boolean {
  return status === 400 || status === 409;
}
