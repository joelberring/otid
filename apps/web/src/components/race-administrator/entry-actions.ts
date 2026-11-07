import { useState } from "react";
import type { WorkspaceState, Base } from "./workspace-state";
import type { RaceDataActions } from "./race-data";
import type { Roster } from "./participant-roster";
import { deriveSections } from "./navigation";
import { createEntryCardActions, useEntryCardState } from "./entry-card-actions";
import { createEntryClassActions, useEntryClassState } from "./entry-class-actions";
import { createEntryIdentityActions, useEntryIdentityState } from "./entry-identity-actions";
import { createEntryRegistrationActions, useEntryRegistrationState } from "./entry-registration-actions";

/**
 * Formulärläge för ändringar av en deltagare: klass, bricka, hyrbricka, betalning, starttid, identitet och anmälan. Fälten
 * som flera formulär delar står här; varje område har sitt eget läge (`entry-*-actions.ts`).
 */
export function useEntryActionState() {
  const [classId, setClassId] = useState("");
  const [startClock, setStartClock] = useState("");
  const [newCard, setNewCard] = useState("");
  const [givenName, setGivenName] = useState("");
  const [familyName, setFamilyName] = useState("");
  const [organisationName, setOrganisationName] = useState("");
  return { classId, setClassId, startClock, setStartClock, newCard, setNewCard, givenName, setGivenName, familyName, setFamilyName,
    organisationName, setOrganisationName, ...useEntryCardState(), ...useEntryClassState(), ...useEntryIdentityState(),
    ...useEntryRegistrationState() };
}

export function deriveEntryActions(s: WorkspaceState, { selected }: Pick<Roster, "selected">) {
  const { data, classId, entryId, identityCandidates } = s;
  const target = data?.classes.find((row) => row.id === classId);
  const identityCandidate = identityCandidates?.entries.find((row) => row.id === entryId);
  const identityMatches = !!data && !!selected && !!identityCandidate && identityCandidates?.snapshotVersion === data.snapshotVersion &&
    identityCandidate.classId === selected.classId && identityCandidate.version === selected.version;
  const targetFull = !!target && target.maxEntries !== null && target.entryCount >= target.maxEntries;
  // Minutstart får lämnas utan tid när typen lottar: tiden ges när klassen lottas (PLAN.md steg 24).
  const startTimeOptional = !!target && target.startRule === "FIXED" && !target.startDrawn && s.data !== undefined &&
    deriveSections(s).profile.features.draw;
  return { target, targetFull, startTimeOptional, identityCandidate, identityMatches };
}

/**
 * Ändringar som inte påverkar något resultat (namn, klubb, bricka, hyrbricka) sparas direkt när
 * formuläret skickas. Klassbyte, starttid och anmälan har kvar ett granskningssteg (ADR-0169 beslut 4).
 */
export function createEntryActions(ws: Base & RaceDataActions) {
  return { ...createEntryIdentityActions(ws), ...createEntryClassActions(ws), ...createEntryCardActions(ws), ...createEntryRegistrationActions(ws) };
}
export type EntryActions = ReturnType<typeof createEntryActions>;
