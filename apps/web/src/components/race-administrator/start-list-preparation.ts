import { useState } from "react";
import { startListPublicationPreviewResponseSchema, startListPublicationRequestSchema,
  type StartListPublicationPreviewResponse } from "@o-tid/contracts";
import { parseAdministratorPublicationReceipt, type AdministratorPublicationAttempt } from "../../lib/administrator-publication-client";
import { startListPublicationSv as publicationText } from "../../i18n/start-list-publication-sv";
import { raceAdministratorSv as text } from "../../i18n/race-administrator-sv";
import type { Operation } from "./types";
import type { Base } from "./workspace-state";
import type { RaceDataActions } from "./race-data";

/** Startlistan: publicering och funktionärer. Lottningen finns i `start-draw.ts`. */
export function useStartListState() {
  const [publicationPreview, setPublicationPreview] = useState<StartListPublicationPreviewResponse>();
  const [publicationAttempt, setPublicationAttempt] = useState<AdministratorPublicationAttempt>();
  const [operatorAccessPending, setOperatorAccessPending] = useState(false);
  return { publicationPreview, setPublicationPreview, publicationAttempt, setPublicationAttempt,
    operatorAccessPending, setOperatorAccessPending };
}

export function createStartListActions(ws: Base & RaceDataActions) {
  const { raceId, publicationPreview, busyRef, pending, sent, requireSession, beginRequest, finish, current, request, json, csrf,
    setMessage, setUnknown, setPublicationPreview, setPublicationAttempt } = ws;
  async function readPublication(op: Operation) {
    const response = await request("/publication-preview", op);
    if (!response.ok) throw new Error("Publication preview unavailable");
    const value = startListPublicationPreviewResponseSchema.parse(await json(response, op));
    if (value.raceId !== raceId) throw new Error("Publication scope mismatch");
    setPublicationPreview(value);
  }
  async function loadPublication() {
    if (busyRef.current || pending.current || !requireSession()) return;
    const op = beginRequest(); setPublicationPreview(undefined); setMessage("");
    try { await readPublication(op); }
    catch { if (current(op)) setMessage(publicationText.loadError); } finally { finish(op); }
  }
  function preparePublication(action: "PUBLISH" | "WITHDRAW") {
    if (busyRef.current || pending.current || !requireSession() || !publicationPreview) return;
    try {
      const request = startListPublicationRequestSchema.parse(action === "PUBLISH" ? {
        formatVersion: 1, action, expectedRevision: publicationPreview.latestDecision?.revision ?? 0,
        expectedSnapshotVersion: publicationPreview.snapshotVersion, expectedSourceHash: publicationPreview.sourceHash
      } : { formatVersion: 1, action, expectedRevision: publicationPreview.latestDecision?.revision });
      const value: AdministratorPublicationAttempt = { kind: "PUBLICATION", id: crypto.randomUUID(), request,
        content: action === "PUBLISH" ? publicationPreview.content : null };
      // Publicering ändrar inga resultat eller starttider: sparas direkt utan granskningssteg (ADR-0169 beslut 4).
      pending.current = value; sent.current = false; setUnknown(false); setPublicationAttempt(value); setMessage("");
      void submitPublication(value);
    } catch { setMessage(publicationText.error); }
  }
  async function submitPublication(value: AdministratorPublicationAttempt) {
    if (busyRef.current || pending.current !== value || !requireSession()) return;
    const op = beginRequest(); const wasSent = sent.current; let committed = false;
    try {
      const token = csrf(); sent.current = true;
      const response = await request("/publication", op, { method: "POST", headers: {
        "content-type": "application/json", "x-otid-csrf": token, "idempotency-key": `start-list-publication:${value.id}` },
      body: JSON.stringify(value.request) });
      if ([400, 404, 409].includes(response.status) && !wasSent) {
        pending.current = undefined; sent.current = false; setPublicationAttempt(undefined); setPublicationPreview(undefined);
        setUnknown(false); setMessage(publicationText.conflict); return;
      }
      if (!response.ok) throw new Error("Unknown publication outcome");
      parseAdministratorPublicationReceipt(await json(response, op), raceId, value);
      committed = true; pending.current = undefined; sent.current = false; setPublicationAttempt(undefined); setUnknown(false);
      setMessage(publicationText.saved); await readPublication(op);
    } catch { if (current(op)) { setUnknown(!committed); setMessage(committed ? `${publicationText.saved} ${publicationText.loadError}` : text.unreachable); } }
    finally { finish(op); }
  }
  return { loadPublication, preparePublication, submitPublication };
}
export type StartListActions = ReturnType<typeof createStartListActions>;
