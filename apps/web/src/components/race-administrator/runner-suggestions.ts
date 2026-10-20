"use client";

import { useEffect, useState } from "react";
import { runnerSearchResponseSchema, type RunnerClub, type RunnerSearchRequest, type RunnerSuggestion } from "@o-tid/contracts";
import { readAccountCsrfCookie } from "../../lib/organizer-account-cookies";

/**
 * Ny deltagare (PLAN.md steg 29): förslag ur löpardatabasen på servern medan namnet och klubben skrivs. Sökningen är
 * en hjälp vid sidan av arbetsytans anrop (den låser och avbryter inget). Utan löpardatabas, utan nät eller vid
 * serverfel blir det inga förslag; formuläret fungerar som vanligt.
 */
const DEBOUNCE_MS = 250;

function fold(value: string): string {
  return value.toLocaleLowerCase("sv").normalize("NFD").replace(/\p{M}/gu, "").trim();
}

async function search(base: string, request: RunnerSearchRequest, signal: AbortSignal) {
  const token = readAccountCsrfCookie(document.cookie, new URL(window.location.href));
  if (!token) return undefined;
  let response: Response;
  try {
    response = await fetch(`${base}/runner-database/search`, { method: "POST", credentials: "same-origin", cache: "no-store", signal,
      headers: { "content-type": "application/json", "x-otid-csrf": token }, body: JSON.stringify(request) });
  } catch (error) {
    // Avbruten (nytt tecken skrivet) eller inget nät: inga förslag den här gången.
    if (error instanceof DOMException || error instanceof TypeError) return undefined;
    throw error;
  }
  return response.ok ? runnerSearchResponseSchema.parse(await response.json()) : undefined;
}

function useSearch<T>(base: string, request: RunnerSearchRequest | undefined, pick: (value: NonNullable<Awaited<ReturnType<typeof search>>>) => T[]) {
  const [found, setFound] = useState<T[]>([]);
  const key = request ? JSON.stringify(request) : "";
  useEffect(() => {
    if (!request) { setFound([]); return; }
    const controller = new AbortController();
    const timer = setTimeout(() => {
      void search(base, request, controller.signal).then((value) => { if (!controller.signal.aborted) setFound(value ? pick(value) : []); });
    }, DEBOUNCE_MS);
    return () => { clearTimeout(timer); controller.abort(); };
    // `key` beskriver begäran; `pick` är stabil per anrop.
  }, [base, key]);
  return found;
}

/** Löpare som matchar namnet (minst två tecken) och klubbar som matchar klubbfältet. */
export function useRunnerSuggestions(raceId: string, name: string, club: string, active: boolean) {
  const base = `/api/admin/races/${encodeURIComponent(raceId)}/administrator`;
  const text = name.trim();
  const runners = useSearch<RunnerSuggestion>(base, active && text.length >= 2 ? { formatVersion: 1, kind: "NAME", text: text.slice(0, 80) } : undefined,
    (value) => value.runners);
  const clubText = club.trim();
  const clubs = useSearch<RunnerClub>(base, active && clubText.length >= 1 ? { formatVersion: 1, kind: "CLUB", text: clubText.slice(0, 80) } : undefined,
    (value) => value.clubs);
  return { runners, clubs };
}

/** Eventors id gäller bara så länge namnet är löparens och klubben löparens eller en vald klubb ur Eventor. */
export function registrationEventorIds(fields: { givenName: string; familyName: string; organisationName: string },
  runner: RunnerSuggestion | undefined, clubs: readonly RunnerClub[]): { eventorPersonId?: string; eventorOrganisationId?: string } {
  const sameName = runner && fold(runner.givenName) === fold(fields.givenName) && fold(runner.familyName) === fold(fields.familyName);
  const club = fold(fields.organisationName);
  const clubId = !club ? undefined : runner?.clubId && runner.club && fold(runner.club) === club ? runner.clubId
    : clubs.find((row) => fold(row.name) === club)?.id;
  return { ...(sameName && runner.personId ? { eventorPersonId: runner.personId } : {}), ...(clubId ? { eventorOrganisationId: clubId } : {}) };
}

/** "Testa Testsson · OK Skogsfalken · 1975 · bricka 8100101". */
export function runnerSuggestionLabel(runner: RunnerSuggestion): string {
  return [`${runner.givenName} ${runner.familyName}`, runner.club, runner.birthYear ? String(runner.birthYear) : undefined,
    runner.cards.length > 0 ? `bricka ${runner.cards.join(", ")}` : undefined].filter(Boolean).join(" · ");
}
