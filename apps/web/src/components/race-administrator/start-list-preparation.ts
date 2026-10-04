import { useState, type FormEvent } from "react";
import { classStartDrawClassesResponseSchema, classStartDrawParametersSchema, classStartDrawPreviewResponseSchema,
  startListPublicationPreviewResponseSchema, startListPublicationRequestSchema, type ClassStartDrawClassesResponse,
  type StartListPublicationPreviewResponse } from "@o-tid/contracts";
import { parseAdministratorDrawReceipt, type AdministratorDrawAttempt } from "../../lib/administrator-start-draw-client";
import { parseAdministratorPublicationReceipt, type AdministratorPublicationAttempt } from "../../lib/administrator-publication-client";
import { classStartDrawSv as drawText } from "../../i18n/class-start-draw-sv";
import { startListPublicationSv as publicationText } from "../../i18n/start-list-publication-sv";
import { raceAdministratorSv as text } from "../../i18n/race-administrator-sv";
import { parseRaceClock } from "../../lib/clock-time";
import type { Operation } from "./types";
import type { Base } from "./workspace-state";
import type { RaceDataActions } from "./race-data";

/** Startlistan: lottning av starttider, publicering och funktionärer. */
export function useStartListState() {
  const [publicationPreview, setPublicationPreview] = useState<StartListPublicationPreviewResponse>();
  const [publicationAttempt, setPublicationAttempt] = useState<AdministratorPublicationAttempt>();
  const [drawClasses, setDrawClasses] = useState<ClassStartDrawClassesResponse>();
  const [drawClassId, setDrawClassId] = useState("");
  const [drawFirst, setDrawFirst] = useState("");
  const [drawInterval, setDrawInterval] = useState("60");
  const [drawAttempt, setDrawAttempt] = useState<AdministratorDrawAttempt>();
  const [operatorAccessPending, setOperatorAccessPending] = useState(false);
  return { publicationPreview, setPublicationPreview, publicationAttempt, setPublicationAttempt, drawClasses, setDrawClasses,
    drawClassId, setDrawClassId, drawFirst, setDrawFirst, drawInterval, setDrawInterval, drawAttempt, setDrawAttempt,
    operatorAccessPending, setOperatorAccessPending };
}

export function createStartListActions(ws: Base & RaceDataActions) {
  const { raceId, data, publicationPreview, drawClasses, drawFirst, drawInterval, drawClassId, busyRef, pending, sent,
    requireSession, beginRequest, finish, current, request, json, csrf, load, setMessage, setUnknown, setPublicationPreview,
    setPublicationAttempt, setDrawClasses, setDrawClassId, setDrawAttempt, setFinalizationCandidates } = ws;
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
  async function loadDrawClasses(preselectClassId = "") {
    if (busyRef.current || pending.current || !requireSession()) return;
    const op = beginRequest(); setDrawClasses(undefined); setDrawClassId(""); setMessage("");
    try {
      const response = await request("/draw-classes", op);
      if (!response.ok) throw new Error("Draw classes unavailable");
      const value = classStartDrawClassesResponseSchema.parse(await json(response, op));
      if (value.raceId !== raceId) throw new Error("Draw scope mismatch");
      const selected = preselectClassId ? value.classes.find(row => row.id === preselectClassId && row.entryCount > 0) : undefined;
      if (preselectClassId && !selected) throw new Error("Selected class is no longer drawable");
      setDrawClasses(value); setDrawClassId(selected?.id ?? "");
    } catch { if (current(op)) setMessage(drawText.error); } finally { finish(op); }
  }
  async function previewDraw(event: FormEvent) {
    event.preventDefault();
    if (busyRef.current || pending.current || !requireSession() || !drawClasses || !data) return;
    // Första start skrivs som klockslag på tävlingsdagen; appen lägger till datum och tidszon.
    const parameters = classStartDrawParametersSchema.safeParse({ algorithmVersion: "xorshift32-fisher-yates-v1",
      seed: drawClasses.seed, firstStartTime: parseRaceClock(data.raceDate, drawFirst, drawClasses.timeZone),
      intervalSeconds: Number(drawInterval) });
    if (!parameters.success || !drawClassId) { setMessage(drawText.invalid); return; }
    const op = beginRequest(); setMessage("");
    try {
      const response = await request("/draw-preview", op, { method: "POST", headers: {
        "content-type": "application/json", "x-otid-csrf": csrf() },
      body: JSON.stringify({ formatVersion: 1, classId: drawClassId, parameters: parameters.data }) });
      if (!response.ok) throw new Error("Draw preview unavailable");
      const preview = classStartDrawPreviewResponseSchema.parse(await json(response, op));
      if (preview.raceId !== raceId || preview.classId !== drawClassId ||
        JSON.stringify(preview.parameters) !== JSON.stringify(parameters.data)) throw new Error("Draw preview mismatch");
      const value: AdministratorDrawAttempt = { kind: "DRAW", id: crypto.randomUUID(), preview,
        request: { formatVersion: 1, classId: preview.classId, parameters: preview.parameters,
          expectedSnapshotVersion: preview.snapshotVersion, sourceHash: preview.sourceHash } };
      pending.current = value; sent.current = false; setUnknown(false); setDrawAttempt(value);
    } catch { if (current(op)) setMessage(drawText.error); } finally { finish(op); }
  }
  async function submitDraw(value: AdministratorDrawAttempt) {
    if (busyRef.current || pending.current !== value || !requireSession()) return;
    const op = beginRequest(); const wasSent = sent.current; let committed = false;
    try {
      const token = csrf(); sent.current = true;
      const response = await request("/draw", op, { method: "POST", headers: {
        "content-type": "application/json", "x-otid-csrf": token, "idempotency-key": `class-start-draw:${value.id}` },
      body: JSON.stringify(value.request) });
      if ([400, 404, 409].includes(response.status) && !wasSent) {
        pending.current = undefined; sent.current = false; setDrawAttempt(undefined); setDrawClasses(undefined);
        setUnknown(false); setMessage(drawText.conflict); return;
      }
      if (!response.ok) throw new Error("Unknown draw outcome");
      const receipt = parseAdministratorDrawReceipt(await json(response, op), raceId, value);
      if (receipt.entryCount !== value.preview.entries.length || receipt.changedEntryCount !== value.preview.entries.filter(row => row.changed).length) throw new Error("Draw count mismatch");
      committed = true; pending.current = undefined; sent.current = false; setDrawAttempt(undefined); setDrawClasses(undefined);
      setPublicationPreview(undefined);
      setFinalizationCandidates(undefined); setUnknown(false); setMessage(drawText.saved);
      await load(op);
    } catch { if (current(op)) { setUnknown(!committed); setMessage(committed ? `${drawText.saved} ${text.error}` : text.unreachable); } }
    finally { finish(op); }
  }
  return { loadPublication, preparePublication, submitPublication, loadDrawClasses, previewDraw, submitDraw };
}
export type StartListActions = ReturnType<typeof createStartListActions>;
