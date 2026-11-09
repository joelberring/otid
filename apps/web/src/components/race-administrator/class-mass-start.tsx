"use client";

import { useState } from "react";
import { classTableEn } from "../../i18n/workspace-admin-en";
import { useTexts } from "../language-provider";
import { startDrawPreviewResponseSchema, startDrawResponseSchema, startDrawSetupResponseSchema, type StartDrawRequest } from "@o-tid/contracts";
import { formatClockTime, parseRaceClock } from "@o-tid/domain";
import styles from "../race-administrator-workspace.module.css";
import { classTableSv } from "../../i18n/class-table-sv";
import { Button, Field } from "../ui";
import type { Workspace } from "./workspace-state";

/**
 * Masstart direkt på klassen (ägaren 2026-11-08): en lottning med masstart för bara den här klassen, samma väg som Start →
 * Lottning. Alla i klassen får tiden, och efteranmälda får den också (lottningens efteranmälan). Klassen ska ha minutstart.
 */
export function ClassMassStart({ ws, classId, startRule }: { ws: Workspace; classId: string; startRule: "PUNCH" | "FIXED" }) {
  const text = useTexts(classTableSv, classTableEn);
  const [clock, setClock] = useState("");
  const [message, setMessage] = useState<{ ok: boolean; text: string }>();
  const [busy, setBusy] = useState(false);
  if (startRule !== "FIXED") return <p className={styles.workflowHelp}>{text.massStartNeedsFixed}</p>;

  async function save() {
    if (ws.writingRef.current || ws.pending.current || !ws.requireSession()) return;
    setMessage(undefined); setBusy(true);
    const op = ws.begin(true);
    try {
      const setupResponse = await ws.request("/draw", op);
      if (!setupResponse.ok) throw new Error("Draw setup unavailable");
      const setup = startDrawSetupResponseSchema.parse(await ws.json(setupResponse, op));
      const firstStartTime = parseRaceClock(setup.raceDate, clock, setup.timeZone);
      if (!firstStartTime || Date.parse(firstStartTime) % 60_000 !== 0) { setMessage({ ok: false, text: text.massStartInvalid }); return; }
      const settings = { firstStartTime, clubSeparation: false,
        classes: [{ classId, method: "MASS" as const, intervalMinutes: 1, vacancies: { kind: "COUNT" as const, value: 0 } }] };
      const previewResponse = await ws.request("/draw-preview", op, { method: "POST",
        headers: { "content-type": "application/json", "x-otid-csrf": ws.csrf() }, body: JSON.stringify({ formatVersion: 1, ...settings }) });
      if (!previewResponse.ok) throw new Error("Draw preview unavailable");
      const preview = startDrawPreviewResponseSchema.parse(await ws.json(previewResponse, op));
      if (preview.requiresConfirmation && !window.confirm(text.massStartConfirm)) return;
      const request: StartDrawRequest = { formatVersion: 1, requestId: crypto.randomUUID(), seed: preview.seed, ...settings,
        confirmChanges: preview.requiresConfirmation };
      const response = await ws.request("/draw", op, { method: "POST",
        headers: { "content-type": "application/json", "x-otid-csrf": ws.csrf(), "idempotency-key": `start-draw:${request.requestId}` },
        body: JSON.stringify(request) });
      if (!response.ok) throw new Error("Draw not saved");
      startDrawResponseSchema.parse(await ws.json(response, op));
      setMessage({ ok: true, text: text.massStartSaved(formatClockTime(firstStartTime, setup.timeZone).slice(0, 5)) });
      await ws.readCourses(op);
    } catch { if (ws.current(op)) setMessage({ ok: false, text: text.massStartError }); }
    finally { ws.finish(op); setBusy(false); }
  }

  return <div className={styles.fieldRow} data-testid="class-mass-start">
    <Field label={text.massStart} help={text.massStartHelp} className={styles.narrowField}>
      <input inputMode="numeric" placeholder="19:00" value={clock} maxLength={5} disabled={busy} data-testid="class-mass-start-time"
        onChange={event => setClock(event.target.value)} /></Field>
    <Button variant="secondary" disabled={busy || !clock.trim()} onClick={() => void save()} data-testid="class-mass-start-save">{text.massStartSave}</Button>
    {message && <p role="status" className={styles.workflowHelp}>{message.text}</p>}
  </div>;
}
