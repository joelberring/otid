import type { Texts } from "./language";
import type { clubPlanningSv } from "../i18n/club-planning-sv";
import { clubRequest } from "./club-archive-client";

/** ADR-0221: anropen från fliken Planering och Mina uppgifter. */
type PlanningTexts = Texts<typeof clubPlanningSv>;

export const planningBase = (clubId: string) => `/api/organizer/clubs/${encodeURIComponent(clubId)}/planning`;

export async function planRequest(path: string, method: "GET" | "POST" | "PUT" | "DELETE" = "GET", body?: unknown) {
  return clubRequest(path, method, body).catch(() => ({ status: 0, json: undefined as unknown }));
}

/** Ett begripligt besked för ett misslyckat anrop (422 med en kod från tjänsten, annars statusen). */
export function planFailure(status: number, json: unknown, text: PlanningTexts): string {
  const error = json && typeof json === "object" && "error" in json ? (json as { error: unknown }).error : undefined;
  if (status === 422 && error === "OUTSIDE_TERM") return text.session.outside;
  if (status === 422 && error === "TOO_MANY_SESSIONS") return text.session.tooMany;
  if (status === 422 && error === "TERM_NOT_EMPTY") return text.errors.notEmpty;
  if (status === 422 && error === "GROUP_LEADER_ONLY") return text.session.groupForbidden;
  if (status === 422 && error === "RACE_FORBIDDEN") return text.link.forbidden;
  if (status === 401) return text.errors.session;
  if (status === 400) return text.errors.invalid;
  if (status === 403) return text.errors.forbidden;
  if (status === 404) return text.errors.notFound;
  if (status === 409) return text.errors.conflict;
  return text.errors.generic(status);
}

/** Datumet med veckodag och månad på besökarens språk, t.ex. "tis 12 jan". */
export function shortDate(date: string, language: "sv" | "en"): string {
  return new Intl.DateTimeFormat(language === "en" ? "en-GB" : "sv-SE", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" })
    .format(new Date(`${date}T12:00:00Z`));
}

