import { useState, type FormEvent } from "react";
import {
  entryIdentityAdminListResponseSchema, entryIdentityChangeRequestSchema, type EntryIdentityAdminListResponse
} from "@o-tid/contracts";
import { parseIdentityReceipt } from "../../lib/entry-identity-client";
import { raceAdministratorSv as text } from "../../i18n/race-administrator-sv";
import type { IdentityAttempt } from "./types";
import type { Base } from "./workspace-state";
import type { RaceDataActions } from "./race-data";

/** Namn och klubb: sparas direkt när formuläret skickas. */
export function useEntryIdentityState() {
  const [identityCandidates, setIdentityCandidates] = useState<EntryIdentityAdminListResponse>();
  const [identityAttempt, setIdentityAttempt] = useState<IdentityAttempt>();
  return { identityCandidates, setIdentityCandidates, identityAttempt, setIdentityAttempt };
}

export function createEntryIdentityActions(ws: Base & RaceDataActions) {
  const { raceId, data, entryId, givenName, familyName, organisationName, identityCandidate, identityMatches, writingRef, pending, sent,
    requireSession, begin, finish, current, request, json, csrf, load, setGivenName, setFamilyName, setOrganisationName, setIdentityCandidates,
    setMessage, setUnknown, setData, setEntryId, setIdentityAttempt, setQuery, setPage } = ws;
  async function loadIdentity(selectedId = entryId) {
    if (writingRef.current || pending.current || !requireSession()) return;
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
  function prepareIdentity(event: FormEvent) {
    event.preventDefault(); if (writingRef.current || pending.current || !requireSession()) return;
    if (!data || !identityMatches || !identityCandidate) { setMessage(text.identityLoadError); return; }
    const parsed = entryIdentityChangeRequestSchema.safeParse({ formatVersion: 1, expectedEntryVersion: identityCandidate.version,
      expectedClassId: identityCandidate.classId, expectedIdentity: identityCandidate.identity,
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
    if (writingRef.current || pending.current !== value || !requireSession()) return;
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
  return { loadIdentity, prepareIdentity, submitIdentity };
}
