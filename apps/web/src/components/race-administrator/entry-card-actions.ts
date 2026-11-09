import { useState, type FormEvent } from "react";
import { type AdminTexts } from "../../i18n/workspace-admin-en";

import {
  entryCardChangeRequestSchema, entryCardChangeResponseSchema, entryCardInUseResponseSchema, entryCardRentalChangeRequestSchema,
  entryCardRentalChangeResponseSchema, entryCardRentalReturnChangeRequestSchema, entryCardRentalReturnChangeResponseSchema,
  entryCardRentalReuseRequestSchema, entryCardRentalReuseResponseSchema, type EntryCardChangeResponse, type EntryCardInUseResponse
} from "@o-tid/contracts";

import type { CardAttempt, RentalAttempt, RentalReturnAttempt, RentalReuseAttempt } from "./types";
import type { Base } from "./workspace-state";
import type { RaceDataActions } from "./race-data";

/** Löparen som har brickan nu, och om bytet går (båda har exakt en aktiv bricka). */
export type CardSwap = { entryId: string; cardNumber: string; holder: EntryCardInUseResponse["holder"]; canSwap: boolean };

/** Raden efter ett sparat brickbyte: bytet, avläsningar som kopplades och resultat som väntar på ny avläsning. */
export function cardSavedMessage(receipt: EntryCardChangeResponse, text: AdminTexts): string {
  const parts = [receipt.swappedWith ? text.cardSwapped(receipt.swappedWith.displayName) : text.cardSaved];
  for (const linked of receipt.linkedReadouts ?? []) parts.push(text.cardReadoutLinked(linked.cardNumber, text.cardLinkedStatus[linked.status]));
  if (receipt.staleResults?.length) parts.push(text.cardStaleResults(receipt.staleResults.map((row) => row.displayName).join(", ")));
  return parts.join(" ");
}

/** Brickan och hyrbrickan: byte, byte med en annan löpare, hyrd, återlämnad och återanvänd. */
export function useEntryCardState() {
  const [cardAttempt, setCardAttempt] = useState<CardAttempt>();
  /** Översynen 2026-11-02: brickan är aktiv hos en annan löpare; "Byt bricka med …" erbjuds. */
  const [cardSwap, setCardSwap] = useState<CardSwap>();
  const [rentalAttempt, setRentalAttempt] = useState<RentalAttempt>();
  const [rentalReturnAttempt, setRentalReturnAttempt] = useState<RentalReturnAttempt>();
  const [rentalReuseAttempt, setRentalReuseAttempt] = useState<RentalReuseAttempt>();
  const [rentalReuseSourceId, setRentalReuseSourceId] = useState("");
  return { cardAttempt, setCardAttempt, cardSwap, setCardSwap, rentalAttempt, setRentalAttempt, rentalReturnAttempt, setRentalReturnAttempt,
    rentalReuseAttempt, setRentalReuseAttempt, rentalReuseSourceId, setRentalReuseSourceId };
}

/** Brickbyte och hyrbricka sparas direkt när formuläret skickas (inget resultat påverkas). */
export function createEntryCardActions(ws: Base & RaceDataActions) {
  const text = ws.adminText;
  const { raceId, data, entryId, newCard, rentalReuseSourceId, writingRef, pending, sent, requireSession, begin, finish, current, request, json, csrf,
    load, setMessage, setUnknown, setData, setEntryId, setClassId, setNewCard, setStartClock, setCardAttempt, setCardSwap, cardSwap,
    setRentalAttempt, setRentalReturnAttempt, setRentalReuseAttempt, setRentalReuseSourceId } = ws;
  function prepareCard(event: FormEvent) {
    event.preventDefault(); if (writingRef.current || pending.current || !requireSession()) return;
    const entry = data?.entries.find((row) => row.id === entryId);
    if (!data || !entry || entry.multipleActiveAssignments) { setMessage(text.cardInvalid); return; }
    const parsed = entryCardChangeRequestSchema.safeParse({ formatVersion: 1,
      expectedEntryVersion: entry.version, expectedClassId: entry.classId,
      expectedAssignment: entry.activeAssignment ? { id: entry.activeAssignment.id, cardNumber: entry.activeAssignment.cardNumber } : null,
      cardNumber: newCard });
    if (!parsed.success || parsed.data.cardNumber === entry.activeAssignment?.cardNumber) { setMessage(text.cardInvalid); return; }
    // Brickan är aktiv hos en annan löpare: säg vem och erbjud bytet i stället för att skicka.
    const holder = data.entries.find((row) => row.id !== entry.id && row.activeAssignment?.cardNumber === parsed.data.cardNumber);
    if (holder?.activeAssignment) {
      offerSwap(entry, parsed.data.cardNumber, { entryId: holder.id, displayName: holder.displayName, classId: holder.classId,
        className: data.classes.find((row) => row.id === holder.classId)?.name ?? "", version: holder.version,
        assignment: { id: holder.activeAssignment.id, cardNumber: holder.activeAssignment.cardNumber } }, !holder.multipleActiveAssignments);
      return;
    }
    setCardSwap(undefined);
    const value: CardAttempt = { kind: "CARD", id: crypto.randomUUID(), entryId: entry.id,
      displayName: entry.displayName, request: parsed.data };
    pending.current = value; sent.current = false; setCardAttempt(value); setUnknown(false); setMessage("");
    void submitCard(value);
  }
  function offerSwap(entry: { id: string; activeAssignment: { id: string; cardNumber: string } | null; multipleActiveAssignments: boolean },
    cardNumber: string, holder: EntryCardInUseResponse["holder"], holderSingle = true) {
    const canSwap = holderSingle && !!entry.activeAssignment && !entry.multipleActiveAssignments;
    setCardSwap({ entryId: entry.id, cardNumber, holder, canSwap });
    setMessage(text.cardInUse(cardNumber, holder.displayName, holder.className, canSwap));
  }
  /** "Byt bricka med …": båda löparnas brickor byts i en transaktion. */
  function prepareCardSwap() {
    if (writingRef.current || pending.current || !requireSession() || !cardSwap?.canSwap) return;
    const entry = data?.entries.find((row) => row.id === cardSwap.entryId);
    if (!data || !entry?.activeAssignment || entry.multipleActiveAssignments) { setMessage(text.cardInvalid); return; }
    const parsed = entryCardChangeRequestSchema.safeParse({ formatVersion: 1, expectedEntryVersion: entry.version,
      expectedClassId: entry.classId, expectedAssignment: { id: entry.activeAssignment.id, cardNumber: entry.activeAssignment.cardNumber },
      cardNumber: cardSwap.cardNumber, swapWith: { entryId: cardSwap.holder.entryId, expectedEntryVersion: cardSwap.holder.version,
        expectedClassId: cardSwap.holder.classId, expectedAssignment: cardSwap.holder.assignment } });
    if (!parsed.success) { setMessage(text.cardInvalid); return; }
    setCardSwap(undefined);
    const value: CardAttempt = { kind: "CARD", id: crypto.randomUUID(), entryId: entry.id, displayName: entry.displayName, request: parsed.data };
    pending.current = value; sent.current = false; setCardAttempt(value); setUnknown(false); setMessage("");
    void submitCard(value);
  }
  async function submitCard(value: CardAttempt) {
    if (writingRef.current || pending.current !== value || !requireSession()) return;
    const op = begin(); const wasUnknown = sent.current;
    let committed = false;
    try {
      const token = csrf(); sent.current = true;
      const response = await request(`/entries/${value.entryId}/card`, op, { method: "PATCH",
        headers: { "content-type": "application/json", "x-otid-csrf": token, "idempotency-key": `entry-card-change:${value.id}` },
        body: JSON.stringify(value.request) });
      if ([400, 404, 409].includes(response.status)) {
        if (wasUnknown) { setUnknown(true); setMessage(text.unreachable); return; }
        const inUse = response.status === 409 ? entryCardInUseResponseSchema.safeParse(await json(response, op).catch(() => null)) : undefined;
        pending.current = undefined; sent.current = false; setCardAttempt(undefined); setUnknown(false);
        if (inUse?.success) {
          // Brickan blev aktiv hos någon annan efter att listan lästes: säg vem i stället för "har ändrats under tiden".
          const entry = data?.entries.find((row) => row.id === value.entryId);
          if (entry) { offerSwap(entry, value.request.cardNumber, inUse.data.holder); return; }
        }
        setData(undefined); setEntryId(""); setClassId(""); setNewCard(""); setMessage(text.cardConflict); return;
      }
      if (!response.ok) throw new Error("Unknown card outcome");
      const receipt = entryCardChangeResponseSchema.parse(await json(response, op));
      if (receipt.requestId !== value.id || receipt.raceId !== raceId || receipt.entryId !== value.entryId ||
        receipt.classId !== value.request.expectedClassId || receipt.activeAssignment.cardNumber !== value.request.cardNumber ||
        receipt.previousAssignment?.id !== value.request.expectedAssignment?.id ||
        receipt.previousAssignment?.cardNumber !== value.request.expectedAssignment?.cardNumber ||
        receipt.entryVersionBefore !== value.request.expectedEntryVersion ||
        receipt.swappedWith?.entryId !== value.request.swapWith?.entryId) throw new Error("Card receipt mismatch");
      committed = true; pending.current = undefined; sent.current = false; setCardAttempt(undefined); setUnknown(false);
      setData(undefined); setClassId(""); setNewCard(""); setMessage(cardSavedMessage(receipt, text));
      setStartClock("");
      await load(op, value.entryId); setEntryId(value.entryId);
    } catch {
      if (current(op)) { setUnknown(!committed); setMessage(committed ? text.cardSavedLoadError : text.unreachable); }
    } finally { finish(op); }
  }
  function prepareRental() {
    if (writingRef.current || pending.current || !requireSession()) return;
    const entry = data?.entries.find((row) => row.id === entryId);
    if (!data || !entry || entry.multipleActiveAssignments || !entry.activeAssignment) {
      setMessage(text.rentalInvalid); return;
    }
    const parsed = entryCardRentalChangeRequestSchema.safeParse({ formatVersion: 1,
      expectedEntryVersion: entry.version, expectedClassId: entry.classId,
      expectedAssignment: {
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
    if (writingRef.current || pending.current !== value || !requireSession()) return;
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
        receipt.entryVersionBefore !== value.request.expectedEntryVersion) throw new Error("Rental receipt mismatch");
      committed = true; pending.current = undefined; sent.current = false; setRentalAttempt(undefined); setUnknown(false);
      setData(undefined); setMessage(text.rentalSaved); await load(op, value.entryId); setEntryId(value.entryId);
    } catch {
      if (current(op)) { setUnknown(!committed); setMessage(committed ? text.rentalSavedLoadError : text.unreachable); }
    } finally { finish(op); }
  }
  function prepareRentalReturn() {
    if (writingRef.current || pending.current || !requireSession()) return;
    const entry = data?.entries.find((row) => row.id === entryId);
    if (!data || !entry || entry.multipleActiveAssignments || !entry.activeAssignment?.isRental) {
      setMessage(text.rentalReturnInvalid); return;
    }
    const parsed = entryCardRentalReturnChangeRequestSchema.safeParse({ formatVersion: 1,
      expectedEntryVersion: entry.version, expectedClassId: entry.classId,
      expectedAssignment: entry.activeAssignment,
      rentalReturned: !entry.activeAssignment.rentalReturned });
    if (!parsed.success) { setMessage(text.rentalReturnInvalid); return; }
    const value: RentalReturnAttempt = { kind: "CARD_RENTAL_RETURN", id: crypto.randomUUID(), entryId: entry.id,
      displayName: entry.displayName, request: parsed.data };
    pending.current = value; sent.current = false; setRentalReturnAttempt(value); setUnknown(false); setMessage("");
    void submitRentalReturn(value);
  }
  async function submitRentalReturn(value: RentalReturnAttempt) {
    if (writingRef.current || pending.current !== value || !requireSession()) return;
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
        receipt.entryVersionBefore !== value.request.expectedEntryVersion) throw new Error("Rental return receipt mismatch");
      committed = true; pending.current = undefined; sent.current = false; setRentalReturnAttempt(undefined); setUnknown(false);
      setData(undefined); setMessage(text.rentalReturnSaved); await load(op, value.entryId); setEntryId(value.entryId);
    } catch {
      if (current(op)) { setUnknown(!committed); setMessage(committed ? text.rentalReturnSavedLoadError : text.unreachable); }
    } finally { finish(op); }
  }
  function prepareRentalReuse(event: FormEvent) {
    event.preventDefault(); if (writingRef.current || pending.current || !requireSession()) return;
    const target = data?.entries.find((row) => row.id === entryId);
    const source = data?.entries.find((row) => row.activeAssignment?.id === rentalReuseSourceId);
    if (!data || !target || !source || target.id === source.id || target.multipleActiveAssignments ||
      target.activeAssignment || source.multipleActiveAssignments || !source.activeAssignment) {
      setMessage(text.rentalReuseInvalid); return;
    }
    const parsed = entryCardRentalReuseRequestSchema.safeParse({ formatVersion: 1,
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
    if (writingRef.current || pending.current !== value || !requireSession()) return;
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
        receipt.sourceEntryVersionBefore !== value.request.source.entryVersion) throw new Error("Rental reuse receipt mismatch");
      committed = true; pending.current = undefined; sent.current = false; setRentalReuseAttempt(undefined); setUnknown(false);
      setData(undefined); setRentalReuseSourceId(""); setMessage(text.rentalReuseSaved); await load(op, value.entryId); setEntryId(value.entryId);
    } catch {
      if (current(op)) { setUnknown(!committed); setMessage(committed ? text.rentalReuseSavedLoadError : text.unreachable); }
    } finally { finish(op); }
  }
  return { prepareCard, prepareCardSwap, submitCard, prepareRental, submitRental, prepareRentalReturn, submitRentalReturn, prepareRentalReuse,
    submitRentalReuse };
}
