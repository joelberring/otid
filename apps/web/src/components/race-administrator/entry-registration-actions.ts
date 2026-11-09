import { useRef, useState, type FormEvent } from "react";


import {
  entryRegistrationCandidatesResponseSchema, entryRegistrationRequestSchema, type RunnerClub, type RunnerSuggestion
} from "@o-tid/contracts";
import { registrationEventorIds } from "./runner-suggestions";
import { formatClockTime, parseRaceClockNear, startReference } from "../../lib/clock-time";
import { hasErrors, validateRegistration, type FieldErrors } from "../../lib/form-validation";
import { focusFirstError, focusWhenEnabled } from "../ui";
import { parseRegistrationReceipt } from "../../lib/entry-registration-client";

import type { RegistrationAttempt } from "./types";
import type { Base } from "./workspace-state";
import type { RaceDataActions } from "./race-data";

export type RegistrationField = "classId" | "givenName" | "familyName" | "card" | "startClock";

/** Ny deltagare i ett steg (PLAN.md steg 24): formulärets fel, dubblettsökningen och raden om vem som lades till. */
export function useEntryRegistrationState() {
  const [registrationAttempt, setRegistrationAttempt] = useState<RegistrationAttempt>();
  const [confirmDistinctPerson, setConfirmDistinctPerson] = useState(false);
  /** Ny deltagare i ett steg (PLAN.md steg 24): fälten visar sina fel, raden under formuläret säger vem som lades till. */
  const [registrationErrors, setRegistrationErrors] = useState<FieldErrors<RegistrationField>>({});
  const [registrationSaved, setRegistrationSaved] = useState("");
  const registrationForm = useRef<HTMLFormElement | null>(null);
  /** PLAN.md steg 29: löparen och klubbarna som valts ur löpardatabasen (Eventors id följer med anmälan). */
  const [registrationRunner, setRegistrationRunner] = useState<RunnerSuggestion>();
  const [registrationClubs, setRegistrationClubs] = useState<readonly RunnerClub[]>([]);
  return { registrationAttempt, setRegistrationAttempt, confirmDistinctPerson, setConfirmDistinctPerson, registrationErrors, setRegistrationErrors,
    registrationSaved, setRegistrationSaved, registrationForm, registrationRunner, setRegistrationRunner, registrationClubs, setRegistrationClubs };
}

export function createEntryRegistrationActions(ws: Base & RaceDataActions) {
  const text = ws.adminText;
  const { raceId, data, startClock, newCard, givenName, familyName, organisationName, confirmDistinctPerson, target, targetFull, startTimeOptional,
    registrationForm, writingRef, pending, sent, registrationRunner, registrationClubs, setRegistrationRunner, requireSession, begin, finish,
    current, request, json, csrf, load, setGivenName, setFamilyName, setMessage, setUnknown, setNewCard, setStartClock, setConfirmDistinctPerson,
    setRegistrationAttempt, setRegistrationErrors, setRegistrationSaved } = ws;
  /**
   * Ny deltagare i ett steg (PLAN.md steg 24): fälten kontrolleras, möjliga dubbletter söks och finns inga läggs
   * deltagaren till direkt. Formuläret står kvar med klass och klubb för nästa deltagare. Bara en möjlig dubblett
   * (samma namn eller bricka) visas och kräver ett val.
   */
  async function prepareRegistration(event: FormEvent) {
    event.preventDefault(); if (writingRef.current || pending.current || !requireSession() || !data) return;
    setRegistrationSaved("");
    const errors = validateRegistration({ classId: target?.id ?? "", classFull: targetFull, givenName, familyName, card: newCard,
      startClock, fixedStart: target?.startRule === "FIXED" && !target.startDrawn, timeOptional: startTimeOptional });
    setRegistrationErrors(errors);
    if (hasErrors(errors) || !target) { focusFirstError(registrationForm.current); return; }
    const clock = startClock.trim();
    const parsed = entryRegistrationRequestSchema.safeParse({ formatVersion: 1, classId: target.id,
      expectedCourseVersionId: target.courseVersionId, expectedStartRule: target.startRule, givenName, familyName,
      organisationName: organisationName.trim() || null, cardNumber: newCard.trim() || null,
      // Lottad klass: appen ger första lediga vakanta tid. Inte lottad än och tomt fält: tiden ges vid lottningen.
      fixedStartTime: target.startRule === "FIXED" && !target.startDrawn && clock
        ? parseRaceClockNear(data.raceDate, clock, data.timeZone, startReference(data.entries, target.id)) : null,
      ...registrationEventorIds({ givenName, familyName, organisationName }, registrationRunner, registrationClubs) });
    if (!parsed.success) { setMessage(text.registrationConflict); return; }
    const frozen = { kind: "REGISTRATION" as const, id: crypto.randomUUID(), className: target.name, timeZone: data.timeZone, request: parsed.data };
    // Dubblettsökningen hör till anmälan och räknas som en skrivning, så att inget annat avbryter den.
    const op = begin(true); setConfirmDistinctPerson(false);
    let value: RegistrationAttempt | undefined;
    try {
      const response = await request("/registration-candidates", op, { method: "POST",
        headers: { "content-type": "application/json", "x-otid-csrf": csrf() },
        body: JSON.stringify({ formatVersion: 1, givenName: frozen.request.givenName, familyName: frozen.request.familyName, cardNumber: frozen.request.cardNumber }) });
      if (!response.ok) throw new Error("Registration candidate search failed");
      const candidates = entryRegistrationCandidatesResponseSchema.parse(await json(response, op));
      if (candidates.raceId !== raceId) throw new Error("Registration candidate scope mismatch");
      value = { ...frozen, candidates };
      pending.current = value; sent.current = false; setRegistrationAttempt(value); setUnknown(false); setMessage("");
      if (candidates.candidates.some(row => row.reasons.includes("CARD_ALREADY_ASSIGNED"))) {
        // Brickan är tagen: felet står vid fältet och inget sparas.
        pending.current = undefined; setRegistrationAttempt(undefined); value = undefined;
        setRegistrationErrors({ card: text.registrationCardConflict }); focusFirstError(registrationForm.current);
      }
    } catch { if (current(op)) setMessage(text.registrationSearchError); value = undefined; }
    finally { finish(op); }
    if (value && value.candidates.candidates.length === 0) await submitRegistration(value, true);
  }
  async function submitRegistration(value: RegistrationAttempt, direct = false) {
    if (writingRef.current || pending.current !== value || !requireSession()) return;
    if (!direct && !sent.current && (value.candidates.candidates.some((row) => row.reasons.includes("CARD_ALREADY_ASSIGNED")) ||
      (value.candidates.candidates.some((row) => row.reasons.includes("SAME_NAME")) && !confirmDistinctPerson))) return;
    const op = begin(); const wasUnknown = sent.current;
    let committed = false;
    try {
      const token = csrf(); sent.current = true;
      const response = await request("/registration", op, { method: "POST",
        headers: { "content-type": "application/json", "x-otid-csrf": token, "idempotency-key": `entry-registration:${value.id}` },
        body: JSON.stringify(value.request) });
      if ([400, 404, 409].includes(response.status)) {
        if (wasUnknown) { setUnknown(true); setMessage(text.unreachable); return; }
        pending.current = undefined; sent.current = false; setRegistrationAttempt(undefined); setUnknown(false);
        setMessage(text.registrationConflict); return;
      }
      if (!response.ok) throw new Error("Unknown registration outcome");
      const receipt = parseRegistrationReceipt(await json(response, op), raceId, value);
      committed = true; pending.current = undefined; sent.current = false; setRegistrationAttempt(undefined); setUnknown(false);
      // Klass och klubb står kvar för nästa deltagare; namn, bricka och tid töms.
      setGivenName(""); setFamilyName(""); setNewCard(""); setStartClock(""); setRegistrationErrors({}); setRegistrationRunner(undefined);
      const runner = `${receipt.givenName} ${receipt.familyName}`;
      setRegistrationSaved((receipt.fixedStartTime ? text.registrationAddedTime(runner, value.className,
        formatClockTime(receipt.fixedStartTime, value.timeZone)) : text.registrationAdded(runner, value.className)) +
        (receipt.linkedReadout ? ` ${text.cardReadoutLinked(receipt.linkedReadout.cardNumber, text.cardLinkedStatus[receipt.linkedReadout.status])}` : ""));
      setMessage(""); await load(op);
    } catch {
      if (current(op)) { setUnknown(!committed); setMessage(committed ? text.registrationSavedLoadError : text.unreachable); }
    } finally {
      finish(op);
      // Fokus till Förnamn när formuläret är upplåst igen, så att nästa deltagare kan skrivas direkt.
      if (committed) focusWhenEnabled(registrationForm, 'input[name="givenName"]');
    }
  }
  return { prepareRegistration, submitRegistration };
}
