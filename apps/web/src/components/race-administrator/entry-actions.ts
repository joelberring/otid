import { useState, type FormEvent } from "react";
import {
  entryCardChangeRequestSchema, entryCardChangeResponseSchema, entryCardRentalChangeRequestSchema,
  entryCardRentalChangeResponseSchema, entryCardRentalReturnChangeRequestSchema, entryCardRentalReturnChangeResponseSchema,
  entryCardRentalReuseRequestSchema, entryCardRentalReuseResponseSchema, entryIdentityAdminListResponseSchema,
  entryIdentityChangeRequestSchema,
  entryRegistrationCandidatesResponseSchema, entryRegistrationRequestSchema,
  entryStartTimeChangeRequestSchema, entryStartTimeChangeResponseSchema, entryTransferRequestSchema,
  entryTransferResponseSchema, type EntryIdentityAdminListResponse
} from "@o-tid/contracts";
import { parseRaceClock } from "../../lib/clock-time";
import { parseIdentityReceipt } from "../../lib/entry-identity-client";
import { parseRegistrationReceipt } from "../../lib/entry-registration-client";
import { raceAdministratorSv as text } from "../../i18n/race-administrator-sv";
import type { CardAttempt, IdentityAttempt, RegistrationAttempt, RentalAttempt, RentalReturnAttempt,
  RentalReuseAttempt, TimeAttempt, TransferAttempt } from "./types";
import type { Base, WorkspaceState } from "./workspace-state";
import type { RaceDataActions } from "./race-data";
import type { Roster } from "./participant-roster";

/** Formulärläge för ändringar av en deltagare: klass, bricka, hyrbricka, betalning, starttid, identitet och anmälan. */
export function useEntryActionState() {
  const [classId, setClassId] = useState("");
  const [startClock, setStartClock] = useState("");
  const [transferAttempt, setTransferAttempt] = useState<TransferAttempt>();
  const [newCard, setNewCard] = useState("");
  const [cardAttempt, setCardAttempt] = useState<CardAttempt>();
  const [rentalAttempt, setRentalAttempt] = useState<RentalAttempt>();
  const [rentalReturnAttempt, setRentalReturnAttempt] = useState<RentalReturnAttempt>();
  const [rentalReuseAttempt, setRentalReuseAttempt] = useState<RentalReuseAttempt>();
  const [rentalReuseSourceId, setRentalReuseSourceId] = useState("");
  const [timeAttempt, setTimeAttempt] = useState<TimeAttempt>();
  const [identityCandidates, setIdentityCandidates] = useState<EntryIdentityAdminListResponse>();
  const [identityAttempt, setIdentityAttempt] = useState<IdentityAttempt>();
  const [registrationAttempt, setRegistrationAttempt] = useState<RegistrationAttempt>();
  const [confirmDistinctPerson, setConfirmDistinctPerson] = useState(false);
  const [givenName, setGivenName] = useState("");
  const [familyName, setFamilyName] = useState("");
  const [organisationName, setOrganisationName] = useState("");
  return { classId, setClassId, startClock, setStartClock, transferAttempt,
    setTransferAttempt, newCard, setNewCard, cardAttempt, setCardAttempt, rentalAttempt, setRentalAttempt, rentalReturnAttempt,
    setRentalReturnAttempt, rentalReuseAttempt, setRentalReuseAttempt, rentalReuseSourceId, setRentalReuseSourceId,
    timeAttempt, setTimeAttempt,
    identityCandidates, setIdentityCandidates, identityAttempt, setIdentityAttempt, registrationAttempt, setRegistrationAttempt,
    confirmDistinctPerson, setConfirmDistinctPerson, givenName, setGivenName, familyName, setFamilyName, organisationName,
    setOrganisationName };
}

export function deriveEntryActions(s: WorkspaceState, { selected }: Pick<Roster, "selected">) {
  const { data, classId, entryId, identityCandidates } = s;
  const target = data?.classes.find((row) => row.id === classId);
  const identityCandidate = identityCandidates?.entries.find((row) => row.id === entryId);
  const identityMatches = !!data && !!selected && !!identityCandidate && identityCandidates?.snapshotVersion === data.snapshotVersion &&
    identityCandidate.classId === selected.classId && identityCandidate.version === selected.version;
  const targetFull = !!target && target.maxEntries !== null && target.entryCount >= target.maxEntries;
  return { target, targetFull, identityCandidate, identityMatches };
}

/**
 * Ändringar som inte påverkar något resultat (namn, klubb, bricka, hyrbricka) sparas direkt när
 * formuläret skickas. Klassbyte, starttid och anmälan har kvar ett granskningssteg (ADR-0169 beslut 4).
 */
export function createEntryActions(ws: Base & RaceDataActions) {
  const { raceId, data, entryId, classId, startClock, newCard, rentalReuseSourceId, givenName, familyName,
    organisationName, confirmDistinctPerson, target, targetFull, identityCandidate, identityMatches, busyRef, pending, sent,
    requireSession, begin, finish, current, request, json, csrf, load, setGivenName, setFamilyName,
    setOrganisationName, setIdentityCandidates, setMessage, setUnknown, setTransferAttempt, setData, setEntryId, setClassId,
    setNewCard, setStartClock, setCardAttempt, setRentalAttempt, setRentalReturnAttempt,
    setRentalReuseAttempt, setRentalReuseSourceId, setTimeAttempt, setIdentityAttempt, setQuery,
    setPage, setConfirmDistinctPerson, setRegistrationAttempt, setResultState, setAction } = ws;
  async function loadIdentity(selectedId = entryId) {
    if (busyRef.current || pending.current || !requireSession()) return;
    const op = begin(); setGivenName(""); setFamilyName(""); setOrganisationName("");
    try {
      const roster = await load(op, selectedId);
      const response = await request("/identity-candidates", op);
      if (!response.ok) throw new Error("Identity candidates unavailable");
      const candidates = entryIdentityAdminListResponseSchema.parse(await json(response, op));
      if (candidates.raceId !== raceId || candidates.snapshotVersion !== roster.snapshotVersion) throw new Error("Identity snapshot mismatch");
      const entry = roster.entries.find((row) => row.id === selectedId);
      const candidate = candidates.entries.find((row) => row.id === selectedId);
      if (selectedId && (!entry || !candidate || entry.classId !== candidate.classId || entry.version !== candidate.version)) throw new Error("Identity entry mismatch");
      setIdentityCandidates(candidates);
      if (candidate) { setGivenName(candidate.identity.givenName); setFamilyName(candidate.identity.familyName); setOrganisationName(candidate.identity.organisationName ?? ""); }
      setMessage("");
    } catch { if (current(op)) setMessage(text.identityLoadError); }
    finally { finish(op); }
  }
  function prepareTransfer(event: FormEvent) {
    event.preventDefault(); if (busyRef.current || pending.current || !requireSession()) return;
    const entry = data?.entries.find((row) => row.id === entryId);
    const target = data?.classes.find((row) => row.id === classId);
    const previous = data?.classes.find((row) => row.id === entry?.classId);
    if (!data || !entry || !target || !previous || entry.classId === target.id) { setMessage(text.invalid); return; }
    if (target.maxEntries !== null && target.entryCount >= target.maxEntries) { setMessage(text.classFull); return; }
    const fixedStartTime = target.startRule === "FIXED" ? parseRaceClock(data.raceDate, startClock, data.timeZone) : null;
    if (target.startRule === "FIXED" && fixedStartTime === null) { setMessage(text.invalidTime); return; }
    const value: TransferAttempt = { kind: "TRANSFER", id: crypto.randomUUID(), entryId: entry.id, displayName: entry.displayName,
      previousClassId: entry.classId, previousClassName: previous.name, className: target.name,
      request: entryTransferRequestSchema.parse({ formatVersion: 1, targetClassId: target.id,
        expectedEntryVersion: entry.version, expectedClassId: entry.classId,
        expectedSnapshotVersion: data.snapshotVersion, expectedFixedStartTime: entry.fixedStartTime,
        expectedTargetCourseVersionId: target.courseVersionId, expectedTargetStartRule: target.startRule,
        fixedStartTime }) };
    pending.current = value; sent.current = false; setTransferAttempt(value); setUnknown(false); setMessage("");
  }
  async function submitTransfer(value: TransferAttempt) {
    if (busyRef.current || pending.current !== value || !requireSession()) return;
    const op = begin(); const wasUnknown = sent.current;
    let committed = false;
    try {
      const token = csrf(); sent.current = true;
      const response = await request(`/entries/${value.entryId}/transfer`, op, { method: "PATCH",
        headers: { "content-type": "application/json", "x-otid-csrf": token, "idempotency-key": `entry-transfer:${value.id}` },
        body: JSON.stringify(value.request) });
      if ([400, 404, 409].includes(response.status)) {
        if (wasUnknown) { setUnknown(true); setMessage(text.unreachable); return; }
        pending.current = undefined; sent.current = false; setTransferAttempt(undefined); setUnknown(false);
        setData(undefined); setEntryId(""); setClassId(""); setMessage(text.conflict); return;
      }
      if (!response.ok) throw new Error("Unknown outcome");
      const receipt = entryTransferResponseSchema.parse(await json(response, op));
      if (receipt.requestId !== value.id || receipt.raceId !== raceId || receipt.entryId !== value.entryId ||
        JSON.stringify(receipt.request) !== JSON.stringify(value.request)) throw new Error("Receipt mismatch");
      committed = true; pending.current = undefined; sent.current = false; setTransferAttempt(undefined); setUnknown(false);
      setData(undefined); setClassId(""); setMessage(text.saved); setNewCard("");
      setStartClock("");
      await load(op, value.entryId); setEntryId(value.entryId);
    } catch {
      if (current(op)) { setUnknown(!committed); setMessage(committed ? text.savedLoadError : text.unreachable); }
    } finally { finish(op); }
  }
  function prepareCard(event: FormEvent) {
    event.preventDefault(); if (busyRef.current || pending.current || !requireSession()) return;
    const entry = data?.entries.find((row) => row.id === entryId);
    if (!data || !entry || entry.multipleActiveAssignments) { setMessage(text.cardInvalid); return; }
    const parsed = entryCardChangeRequestSchema.safeParse({ formatVersion: 1,
      expectedEntryVersion: entry.version, expectedClassId: entry.classId,
      expectedSnapshotVersion: data.snapshotVersion,
      expectedAssignment: entry.activeAssignment ? { id: entry.activeAssignment.id, cardNumber: entry.activeAssignment.cardNumber } : null,
      cardNumber: newCard });
    if (!parsed.success || parsed.data.cardNumber === entry.activeAssignment?.cardNumber) { setMessage(text.cardInvalid); return; }
    const value: CardAttempt = { kind: "CARD", id: crypto.randomUUID(), entryId: entry.id,
      displayName: entry.displayName, request: parsed.data };
    pending.current = value; sent.current = false; setCardAttempt(value); setUnknown(false); setMessage("");
    void submitCard(value);
  }
  async function submitCard(value: CardAttempt) {
    if (busyRef.current || pending.current !== value || !requireSession()) return;
    const op = begin(); const wasUnknown = sent.current;
    let committed = false;
    try {
      const token = csrf(); sent.current = true;
      const response = await request(`/entries/${value.entryId}/card`, op, { method: "PATCH",
        headers: { "content-type": "application/json", "x-otid-csrf": token, "idempotency-key": `entry-card-change:${value.id}` },
        body: JSON.stringify(value.request) });
      if ([400, 404, 409].includes(response.status)) {
        if (wasUnknown) { setUnknown(true); setMessage(text.unreachable); return; }
        pending.current = undefined; sent.current = false; setCardAttempt(undefined); setUnknown(false);
        setData(undefined); setEntryId(""); setClassId(""); setNewCard(""); setMessage(text.cardConflict); return;
      }
      if (!response.ok) throw new Error("Unknown card outcome");
      const receipt = entryCardChangeResponseSchema.parse(await json(response, op));
      if (receipt.requestId !== value.id || receipt.raceId !== raceId || receipt.entryId !== value.entryId ||
        receipt.classId !== value.request.expectedClassId || receipt.activeAssignment.cardNumber !== value.request.cardNumber ||
        receipt.previousAssignment?.id !== value.request.expectedAssignment?.id ||
        receipt.previousAssignment?.cardNumber !== value.request.expectedAssignment?.cardNumber ||
        receipt.entryVersionBefore !== value.request.expectedEntryVersion ||
        receipt.snapshotVersionBefore !== value.request.expectedSnapshotVersion) throw new Error("Card receipt mismatch");
      committed = true; pending.current = undefined; sent.current = false; setCardAttempt(undefined); setUnknown(false);
      setData(undefined); setClassId(""); setNewCard(""); setMessage(text.cardSaved);
      setStartClock("");
      await load(op, value.entryId); setEntryId(value.entryId);
    } catch {
      if (current(op)) { setUnknown(!committed); setMessage(committed ? text.cardSavedLoadError : text.unreachable); }
    } finally { finish(op); }
  }
  function prepareRental() {
    if (busyRef.current || pending.current || !requireSession()) return;
    const entry = data?.entries.find((row) => row.id === entryId);
    if (!data || !entry || entry.multipleActiveAssignments || !entry.activeAssignment) {
      setMessage(text.rentalInvalid); return;
    }
    const parsed = entryCardRentalChangeRequestSchema.safeParse({ formatVersion: 1,
      expectedEntryVersion: entry.version, expectedClassId: entry.classId,
      expectedSnapshotVersion: data.snapshotVersion, expectedAssignment: {
        id: entry.activeAssignment.id, cardNumber: entry.activeAssignment.cardNumber,
        isRental: entry.activeAssignment.isRental
      },
      isRental: !entry.activeAssignment.isRental });
    if (!parsed.success) { setMessage(text.rentalInvalid); return; }
    const value: RentalAttempt = { kind: "CARD_RENTAL", id: crypto.randomUUID(), entryId: entry.id,
      displayName: entry.displayName, request: parsed.data };
    pending.current = value; sent.current = false; setRentalAttempt(value); setUnknown(false); setMessage("");
    void submitRental(value);
  }
  async function submitRental(value: RentalAttempt) {
    if (busyRef.current || pending.current !== value || !requireSession()) return;
    const op = begin(); const wasUnknown = sent.current; let committed = false;
    try {
      const token = csrf(); sent.current = true;
      const response = await request(`/entries/${value.entryId}/card-rental`, op, { method: "PATCH",
        headers: { "content-type": "application/json", "x-otid-csrf": token,
          "idempotency-key": `entry-card-rental-change:${value.id}` }, body: JSON.stringify(value.request) });
      if ([400, 404, 409].includes(response.status)) {
        if (wasUnknown) { setUnknown(true); setMessage(text.unreachable); return; }
        pending.current = undefined; sent.current = false; setRentalAttempt(undefined); setUnknown(false);
        setData(undefined); setEntryId(""); setMessage(text.rentalConflict); return;
      }
      if (!response.ok) throw new Error("Unknown rental outcome");
      const receipt = entryCardRentalChangeResponseSchema.parse(await json(response, op));
      if (receipt.requestId !== value.id || receipt.raceId !== raceId || receipt.entryId !== value.entryId ||
        receipt.classId !== value.request.expectedClassId || receipt.assignment.id !== value.request.expectedAssignment.id ||
        receipt.assignment.cardNumber !== value.request.expectedAssignment.cardNumber ||
        receipt.previousIsRental !== value.request.expectedAssignment.isRental || receipt.isRental !== value.request.isRental ||
        receipt.entryVersionBefore !== value.request.expectedEntryVersion ||
        receipt.snapshotVersionBefore !== value.request.expectedSnapshotVersion) throw new Error("Rental receipt mismatch");
      committed = true; pending.current = undefined; sent.current = false; setRentalAttempt(undefined); setUnknown(false);
      setData(undefined); setMessage(text.rentalSaved); await load(op, value.entryId); setEntryId(value.entryId);
    } catch {
      if (current(op)) { setUnknown(!committed); setMessage(committed ? text.rentalSavedLoadError : text.unreachable); }
    } finally { finish(op); }
  }
  function prepareRentalReturn() {
    if (busyRef.current || pending.current || !requireSession()) return;
    const entry = data?.entries.find((row) => row.id === entryId);
    if (!data || !entry || entry.multipleActiveAssignments || !entry.activeAssignment?.isRental) {
      setMessage(text.rentalReturnInvalid); return;
    }
    const parsed = entryCardRentalReturnChangeRequestSchema.safeParse({ formatVersion: 1,
      expectedEntryVersion: entry.version, expectedClassId: entry.classId,
      expectedSnapshotVersion: data.snapshotVersion, expectedAssignment: entry.activeAssignment,
      rentalReturned: !entry.activeAssignment.rentalReturned });
    if (!parsed.success) { setMessage(text.rentalReturnInvalid); return; }
    const value: RentalReturnAttempt = { kind: "CARD_RENTAL_RETURN", id: crypto.randomUUID(), entryId: entry.id,
      displayName: entry.displayName, request: parsed.data };
    pending.current = value; sent.current = false; setRentalReturnAttempt(value); setUnknown(false); setMessage("");
    void submitRentalReturn(value);
  }
  async function submitRentalReturn(value: RentalReturnAttempt) {
    if (busyRef.current || pending.current !== value || !requireSession()) return;
    const op = begin(); const wasUnknown = sent.current; let committed = false;
    try {
      const token = csrf(); sent.current = true;
      const response = await request(`/entries/${value.entryId}/card-rental-return`, op, { method: "PATCH",
        headers: { "content-type": "application/json", "x-otid-csrf": token,
          "idempotency-key": `entry-card-rental-return-change:${value.id}` }, body: JSON.stringify(value.request) });
      if ([400, 404, 409].includes(response.status)) {
        if (wasUnknown) { setUnknown(true); setMessage(text.unreachable); return; }
        pending.current = undefined; sent.current = false; setRentalReturnAttempt(undefined); setUnknown(false);
        setData(undefined); setEntryId(""); setMessage(text.rentalReturnConflict); return;
      }
      if (!response.ok) throw new Error("Unknown rental return outcome");
      const receipt = entryCardRentalReturnChangeResponseSchema.parse(await json(response, op));
      if (receipt.requestId !== value.id || receipt.raceId !== raceId || receipt.entryId !== value.entryId ||
        receipt.classId !== value.request.expectedClassId || receipt.assignment.id !== value.request.expectedAssignment.id ||
        receipt.assignment.cardNumber !== value.request.expectedAssignment.cardNumber ||
        receipt.previousRentalReturned !== value.request.expectedAssignment.rentalReturned ||
        receipt.rentalReturned !== value.request.rentalReturned ||
        receipt.entryVersionBefore !== value.request.expectedEntryVersion ||
        receipt.snapshotVersionBefore !== value.request.expectedSnapshotVersion) throw new Error("Rental return receipt mismatch");
      committed = true; pending.current = undefined; sent.current = false; setRentalReturnAttempt(undefined); setUnknown(false);
      setData(undefined); setMessage(text.rentalReturnSaved); await load(op, value.entryId); setEntryId(value.entryId);
    } catch {
      if (current(op)) { setUnknown(!committed); setMessage(committed ? text.rentalReturnSavedLoadError : text.unreachable); }
    } finally { finish(op); }
  }
  function prepareRentalReuse(event: FormEvent) {
    event.preventDefault(); if (busyRef.current || pending.current || !requireSession()) return;
    const target = data?.entries.find((row) => row.id === entryId);
    const source = data?.entries.find((row) => row.activeAssignment?.id === rentalReuseSourceId);
    if (!data || !target || !source || target.id === source.id || target.multipleActiveAssignments ||
      target.activeAssignment || source.multipleActiveAssignments || !source.activeAssignment) {
      setMessage(text.rentalReuseInvalid); return;
    }
    const parsed = entryCardRentalReuseRequestSchema.safeParse({ formatVersion: 1,
      expectedSnapshotVersion: data.snapshotVersion,
      source: { entryId: source.id, classId: source.classId, entryVersion: source.version,
        assignment: source.activeAssignment },
      expectedTargetClassId: target.classId, expectedTargetEntryVersion: target.version });
    if (!parsed.success) { setMessage(text.rentalReuseInvalid); return; }
    const value: RentalReuseAttempt = { kind: "CARD_RENTAL_REUSE", id: crypto.randomUUID(), entryId: target.id,
      displayName: target.displayName, sourceDisplayName: source.displayName, request: parsed.data };
    pending.current = value; sent.current = false; setRentalReuseAttempt(value); setUnknown(false); setMessage("");
    void submitRentalReuse(value);
  }
  async function submitRentalReuse(value: RentalReuseAttempt) {
    if (busyRef.current || pending.current !== value || !requireSession()) return;
    const op = begin(); const wasUnknown = sent.current; let committed = false;
    try {
      const token = csrf(); sent.current = true;
      const response = await request(`/entries/${value.entryId}/card-rental-reuse`, op, { method: "PATCH",
        headers: { "content-type": "application/json", "x-otid-csrf": token,
          "idempotency-key": `entry-card-rental-reuse:${value.id}` }, body: JSON.stringify(value.request) });
      if ([400, 404, 409].includes(response.status)) {
        if (wasUnknown) { setUnknown(true); setMessage(text.unreachable); return; }
        pending.current = undefined; sent.current = false; setRentalReuseAttempt(undefined); setUnknown(false);
        setData(undefined); setEntryId(""); setRentalReuseSourceId(""); setMessage(text.rentalReuseConflict); return;
      }
      if (!response.ok) throw new Error("Unknown rental reuse outcome");
      const receipt = entryCardRentalReuseResponseSchema.parse(await json(response, op));
      if (receipt.requestId !== value.id || receipt.raceId !== raceId || receipt.target.entryId !== value.entryId ||
        receipt.target.classId !== value.request.expectedTargetClassId ||
        receipt.targetEntryVersionBefore !== value.request.expectedTargetEntryVersion ||
        receipt.source.entryId !== value.request.source.entryId || receipt.source.classId !== value.request.source.classId ||
        receipt.source.assignment.id !== value.request.source.assignment.id ||
        receipt.source.assignment.cardNumber !== value.request.source.assignment.cardNumber ||
        receipt.sourceEntryVersionBefore !== value.request.source.entryVersion ||
        receipt.snapshotVersionBefore !== value.request.expectedSnapshotVersion) throw new Error("Rental reuse receipt mismatch");
      committed = true; pending.current = undefined; sent.current = false; setRentalReuseAttempt(undefined); setUnknown(false);
      setData(undefined); setRentalReuseSourceId(""); setMessage(text.rentalReuseSaved); await load(op, value.entryId); setEntryId(value.entryId);
    } catch {
      if (current(op)) { setUnknown(!committed); setMessage(committed ? text.rentalReuseSavedLoadError : text.unreachable); }
    } finally { finish(op); }
  }
  function prepareTime(event: FormEvent) {
    event.preventDefault(); if (busyRef.current || pending.current || !requireSession()) return;
    const entry = data?.entries.find((row) => row.id === entryId);
    const currentClass = data?.classes.find((row) => row.id === entry?.classId);
    const fixedStartTime = data ? parseRaceClock(data.raceDate, startClock, data.timeZone) : null;
    if (!data || !entry || currentClass?.startRule !== "FIXED" || fixedStartTime === null || fixedStartTime === entry.fixedStartTime) {
      setMessage(text.timeInvalid); return;
    }
    const value: TimeAttempt = { kind: "TIME", id: crypto.randomUUID(), entryId: entry.id,
      displayName: entry.displayName, timeZone: data.timeZone,
      request: entryStartTimeChangeRequestSchema.parse({ formatVersion: 1, expectedEntryVersion: entry.version,
        expectedClassId: entry.classId, expectedSnapshotVersion: data.snapshotVersion,
        expectedFixedStartTime: entry.fixedStartTime, fixedStartTime }) };
    pending.current = value; sent.current = false; setTimeAttempt(value); setUnknown(false); setMessage("");
  }
  async function submitTime(value: TimeAttempt) {
    if (busyRef.current || pending.current !== value || !requireSession()) return;
    const op = begin(); const wasUnknown = sent.current;
    let committed = false;
    try {
      const token = csrf(); sent.current = true;
      const response = await request(`/entries/${value.entryId}/start-time`, op, { method: "PATCH",
        headers: { "content-type": "application/json", "x-otid-csrf": token, "idempotency-key": `entry-start-time-change:${value.id}` },
        body: JSON.stringify(value.request) });
      if ([400, 404, 409].includes(response.status)) {
        if (wasUnknown) { setUnknown(true); setMessage(text.unreachable); return; }
        pending.current = undefined; sent.current = false; setTimeAttempt(undefined); setUnknown(false);
        setData(undefined); setEntryId(""); setClassId(""); setMessage(text.timeConflict); return;
      }
      if (!response.ok) throw new Error("Unknown start time outcome");
      const receipt = entryStartTimeChangeResponseSchema.parse(await json(response, op));
      if (receipt.requestId !== value.id || receipt.raceId !== raceId || receipt.entryId !== value.entryId ||
        receipt.classId !== value.request.expectedClassId || receipt.previousFixedStartTime !== value.request.expectedFixedStartTime ||
        receipt.fixedStartTime !== value.request.fixedStartTime || receipt.entryVersionBefore !== value.request.expectedEntryVersion ||
        receipt.snapshotVersionBefore !== value.request.expectedSnapshotVersion) throw new Error("Start time receipt mismatch");
      committed = true; pending.current = undefined; sent.current = false; setTimeAttempt(undefined); setUnknown(false);
      setData(undefined); setStartClock(""); setMessage(text.timeSaved);
      await load(op, value.entryId); setEntryId(value.entryId);
    } catch {
      if (current(op)) { setUnknown(!committed); setMessage(committed ? text.timeSavedLoadError : text.unreachable); }
    } finally { finish(op); }
  }
  function prepareIdentity(event: FormEvent) {
    event.preventDefault(); if (busyRef.current || pending.current || !requireSession()) return;
    if (!data || !identityMatches || !identityCandidate) { setMessage(text.identityLoadError); return; }
    const parsed = entryIdentityChangeRequestSchema.safeParse({ formatVersion: 1, expectedEntryVersion: identityCandidate.version,
      expectedClassId: identityCandidate.classId, expectedSnapshotVersion: data.snapshotVersion, expectedIdentity: identityCandidate.identity,
      identity: { givenName, familyName, organisationName: organisationName.trim() || null } });
    if (!parsed.success || (parsed.data.identity.givenName === parsed.data.expectedIdentity.givenName &&
      parsed.data.identity.familyName === parsed.data.expectedIdentity.familyName && parsed.data.identity.organisationName === parsed.data.expectedIdentity.organisationName)) {
      setMessage(text.identityInvalid); return;
    }
    const value: IdentityAttempt = { kind: "IDENTITY", id: crypto.randomUUID(), entryId: identityCandidate.id, request: parsed.data };
    pending.current = value; sent.current = false; setIdentityAttempt(value); setUnknown(false); setMessage("");
    void submitIdentity(value);
  }
  async function submitIdentity(value: IdentityAttempt) {
    if (busyRef.current || pending.current !== value || !requireSession()) return;
    const op = begin(); const wasUnknown = sent.current;
    let committed = false;
    try {
      const token = csrf(); sent.current = true;
      const response = await request(`/entries/${value.entryId}/identity`, op, { method: "PATCH",
        headers: { "content-type": "application/json", "x-otid-csrf": token, "idempotency-key": `entry-identity-change:${value.id}` },
        body: JSON.stringify(value.request) });
      if ([400, 404, 409].includes(response.status)) {
        if (wasUnknown) { setUnknown(true); setMessage(text.unreachable); return; }
        pending.current = undefined; sent.current = false; setIdentityAttempt(undefined); setUnknown(false);
        setData(undefined); setEntryId(""); setMessage(text.identityConflict); return;
      }
      if (!response.ok) throw new Error("Unknown identity outcome");
      parseIdentityReceipt(await json(response, op), raceId, value);
      committed = true; pending.current = undefined; sent.current = false; setIdentityAttempt(undefined); setUnknown(false);
      setData(undefined); setGivenName(""); setFamilyName(""); setOrganisationName(""); setQuery(""); setPage(0); setMessage(text.identitySaved);
      await load(op, value.entryId); setEntryId(value.entryId);
    } catch {
      if (current(op)) { setUnknown(!committed); setMessage(committed ? text.identitySavedLoadError : text.unreachable); }
    } finally { finish(op); }
  }
  async function prepareRegistration(event: FormEvent) {
    event.preventDefault(); if (busyRef.current || pending.current || !requireSession()) return;
    if (!data || !target || targetFull) { setMessage(text.registrationInvalid); return; }
    const parsed = entryRegistrationRequestSchema.safeParse({ formatVersion: 1, classId: target.id,
      expectedCourseVersionId: target.courseVersionId, expectedStartRule: target.startRule, expectedSnapshotVersion: data.snapshotVersion,
      givenName, familyName, organisationName: organisationName.trim() || null, cardNumber: newCard.trim() || null,
      // Lottad klass: appen ger första lediga vakanta tid när anmälan sparas (PLAN.md steg 9).
      fixedStartTime: target.startRule === "FIXED" && !target.startDrawn ? parseRaceClock(data.raceDate, startClock, data.timeZone) : null });
    if (!parsed.success || (target.startRule === "FIXED" && !target.startDrawn && parsed.data.fixedStartTime === null)) {
      setMessage(text.registrationInvalid); return;
    }
    const frozen = { kind: "REGISTRATION" as const, id: crypto.randomUUID(), className: target.name, timeZone: data.timeZone, request: parsed.data };
    const op = begin(); setConfirmDistinctPerson(false); setMessage(text.registrationSearching);
    try {
      const response = await request("/registration-candidates", op, { method: "POST",
        headers: { "content-type": "application/json", "x-otid-csrf": csrf() },
        body: JSON.stringify({ formatVersion: 1, expectedSnapshotVersion: frozen.request.expectedSnapshotVersion,
          givenName: frozen.request.givenName, familyName: frozen.request.familyName, cardNumber: frozen.request.cardNumber }) });
      if (!response.ok) throw new Error("Registration candidate search failed");
      const candidates = entryRegistrationCandidatesResponseSchema.parse(await json(response, op));
      if (candidates.raceId !== raceId || candidates.snapshotVersion !== frozen.request.expectedSnapshotVersion) throw new Error("Registration candidate scope mismatch");
      const value: RegistrationAttempt = { ...frozen, candidates };
      pending.current = value; sent.current = false; setRegistrationAttempt(value); setUnknown(false); setMessage("");
    } catch { if (current(op)) setMessage(text.registrationSearchError); }
    finally { finish(op); }
  }
  async function submitRegistration(value: RegistrationAttempt) {
    if (busyRef.current || pending.current !== value || !requireSession()) return;
    if (!sent.current && (value.candidates.candidates.some((row) => row.reasons.includes("CARD_ALREADY_ASSIGNED")) ||
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
        setData(undefined); setMessage(text.registrationConflict); return;
      }
      if (!response.ok) throw new Error("Unknown registration outcome");
      const receipt = parseRegistrationReceipt(await json(response, op), raceId, value);
      committed = true; pending.current = undefined; sent.current = false; setRegistrationAttempt(undefined); setUnknown(false);
      setData(undefined); setGivenName(""); setFamilyName(""); setOrganisationName(""); setNewCard(""); setClassId("");
      setStartClock(""); setQuery(""); setResultState("ALL");
      setPage(0); setAction("INFO"); setEntryId(receipt.entryId);
      setMessage(text.registrationSaved); await load(op, receipt.entryId);
    } catch {
      if (current(op)) { setUnknown(!committed); setMessage(committed ? text.registrationSavedLoadError : text.unreachable); }
    } finally { finish(op); }
  }
  return { loadIdentity, prepareTransfer, submitTransfer, prepareCard,
    submitCard, prepareRental, submitRental, prepareRentalReturn, submitRentalReturn, prepareRentalReuse, submitRentalReuse,
    prepareTime, submitTime, prepareIdentity, submitIdentity, prepareRegistration,
    submitRegistration };
}
export type EntryActions = ReturnType<typeof createEntryActions>;
