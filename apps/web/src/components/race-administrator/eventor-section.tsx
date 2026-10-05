"use client";

import { useEffect, useState } from "react";
import {
  eventorEventChoiceResponseSchema, eventorEventsResponseSchema, eventorSettingsResponseSchema, eventorSyncProblemSchema,
  eventorTestResponseSchema, syncPreviewResponseSchema, type EventorEventSummary, type EventorSettingsResponse
} from "@o-tid/contracts";
import { formatClockTime, zonedDate } from "../../lib/clock-time";
import { sourcesSv } from "../../i18n/sources-sv";
import { Button, Field, Notice, Section } from "../ui";
import styles from "./sources.module.css";
import { SourceReviewPanel } from "./source-review";
import { useSourceReview, type Message } from "./source-sync-actions";
import type { Workspace } from "./workspace-state";

const text = sourcesSv.eventor;

/** "Senast uppdaterad från Eventor 09:41" (samma dag) eller med datum. */
export function sourceTime(instant: string, timeZone: string): string {
  const time = formatClockTime(instant, timeZone).slice(0, 5);
  return zonedDate(instant, timeZone) === zonedDate(new Date().toISOString(), timeZone) ? time : `${zonedDate(instant, timeZone)} ${time}`;
}

/**
 * Inställningar → Eventor (ADR-0170 beslut 4): klistra in klubbens API-nyckel (sparas krypterad och
 * visas bara som "Nyckel sparad"), testa anslutningen, välj tävlingen i Eventor och hämta eller
 * uppdatera klasser och anmälningar med granskning av skillnaderna.
 */
export function EventorSection({ ws }: { ws: Workspace }) {
  const { authenticated, busy, busyRef, beginRequest, request, json, finish, current, csrf, requireSession, data, raceId } = ws;
  const [settings, setSettings] = useState<EventorSettingsResponse>();
  const [keyInput, setKeyInput] = useState("");
  const [editingKey, setEditingKey] = useState(false);
  const [events, setEvents] = useState<EventorEventSummary[]>();
  const [chosenEvent, setChosenEvent] = useState("");
  const [pastedId, setPastedId] = useState("");
  const [choosing, setChoosing] = useState(false);
  const [message, setMessage] = useState<Message>();
  const [loadFailed, setLoadFailed] = useState(false);
  const review = useSourceReview(ws);
  const timeZone = data?.timeZone ?? "Europe/Stockholm";

  async function run(action: (op: ReturnType<typeof beginRequest>) => Promise<void>) {
    if (busyRef.current || !requireSession()) return;
    const op = beginRequest();
    try { await action(op); } catch { if (current(op)) setMessage({ tone: "error", text: text.failed }); } finally { finish(op); }
  }
  const post = (path: string, op: ReturnType<typeof beginRequest>, body?: unknown, method = "POST") => request(path, op, { method,
    headers: { "x-otid-csrf": csrf(), ...(body === undefined ? {} : { "content-type": "application/json" }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }) });

  useEffect(() => {
    if (!authenticated || settings || loadFailed || busy || busyRef.current) return;
    void run(async op => {
      const response = await request("/eventor", op);
      if (!response.ok) { setLoadFailed(true); throw new Error("Eventor settings unavailable"); }
      setSettings(eventorSettingsResponseSchema.parse(await json(response, op)));
    });
  }, [authenticated, settings, loadFailed, busy]);

  const saveKey = () => run(async op => {
    const response = await post("/eventor", op, { formatVersion: 1, apiKey: keyInput.trim() }, "PUT");
    if (!response.ok) throw new Error("Key not saved");
    const value = eventorTestResponseSchema.parse(await json(response, op));
    setSettings(value.settings); setKeyInput(""); setEditingKey(false);
    setMessage({ tone: value.outcome === "CONNECTED" ? "ok" : "error", text: text.outcome[value.outcome] });
  });
  const removeKey = () => run(async op => {
    const response = await post("/eventor", op, undefined, "DELETE");
    if (!response.ok) throw new Error("Key not removed");
    setSettings(eventorSettingsResponseSchema.parse(await json(response, op))); setEvents(undefined); setMessage(undefined);
  });
  const test = () => run(async op => {
    const response = await post("/eventor/test", op);
    if (!response.ok) throw new Error("Test failed");
    const value = eventorTestResponseSchema.parse(await json(response, op));
    setSettings(value.settings);
    setMessage({ tone: value.outcome === "CONNECTED" ? "ok" : "error", text: text.outcome[value.outcome] });
  });
  const listEvents = () => run(async op => {
    const response = await request("/eventor/events", op);
    if (!response.ok) throw new Error("Events unavailable");
    const value = eventorEventsResponseSchema.parse(await json(response, op));
    if (value.outcome !== "CONNECTED") { setMessage({ tone: "error", text: text.outcome[value.outcome] }); return; }
    setEvents(value.events); setChosenEvent(value.events[0]?.id ?? "");
  });
  const choose = (eventId: string) => run(async op => {
    const response = await post("/eventor/event", op, { formatVersion: 1, eventId });
    if (!response.ok) throw new Error("Choice failed");
    const value = eventorEventChoiceResponseSchema.parse(await json(response, op));
    setSettings(value.settings);
    if (value.outcome === "CONNECTED") { setChoosing(false); setEvents(undefined); setPastedId(""); setMessage(undefined); }
    else setMessage({ tone: "error", text: value.outcome === "NOT_FOUND" ? text.eventNotFound : text.outcome[value.outcome] });
  });
  const fetchDiff = () => run(async op => {
    setMessage(undefined); review.setMessage(undefined);
    const response = await post("/eventor/preview", op);
    if (!response.ok) throw new Error("Preview failed");
    const value: unknown = await json(response, op);
    const problem = eventorSyncProblemSchema.safeParse(value);
    if (problem.success) { setMessage({ tone: "error", text: text.problem[problem.data.problem] }); return; }
    review.show(syncPreviewResponseSchema.parse(value));
  });
  // Efter godkännande: läs om läget (senast uppdaterad).
  useEffect(() => { if (review.message?.tone === "ok") setSettings(undefined); }, [review.message]);

  if (!settings) return <Section id={`eventor-${raceId}`} title={text.title} help={text.help}>
    {loadFailed ? <Notice tone="error" role="alert"><p>{text.failed}</p>
      <div><Button variant="secondary" disabled={busy} onClick={() => setLoadFailed(false)}>{text.retry}</Button></div></Notice>
      : <p className={styles.muted}>…</p>}
  </Section>;
  const locked = busy;
  const keyForm = <form className={styles.inlineForm} onSubmit={event => { event.preventDefault(); void saveKey(); }}>
    <Field label={text.keyLabel} help={text.keyHelp}><input type="password" autoComplete="off" spellCheck={false} value={keyInput}
      minLength={16} maxLength={128} required disabled={locked} onChange={event => setKeyInput(event.target.value)} /></Field>
    <div className={styles.actions}><Button type="submit" disabled={locked || keyInput.trim().length < 16}>{text.saveKey}</Button>
      {editingKey && <Button variant="quiet" disabled={locked} onClick={() => { setEditingKey(false); setKeyInput(""); }}>{text.cancel}</Button>}</div>
  </form>;
  const event = settings.event;
  return <Section id={`eventor-${raceId}`} title={text.title} help={text.help}>
    <div className={styles.block}>
      {settings.server === "MISSING" && <Notice tone="attention">{text.serverMissing}</Notice>}
      {settings.server === "INVALID" && <Notice tone="error">{text.serverInvalid}</Notice>}
      {settings.server === "OK" && <>
        {settings.key === "UNREADABLE" && <Notice tone="attention">{text.keyUnreadable}</Notice>}
        {settings.key === "SAVED" && !editingKey ? <div className={styles.block}><div className={styles.line}>
          <span className={styles.keyState}>{text.keySaved}</span>
          {settings.organisation && <span className={styles.muted}>{text.connectedAs(settings.organisation.name)}</span>}
        </div><div className={styles.actions}>
          <Button variant="secondary" disabled={locked} onClick={() => void test()}>{text.test}</Button>
          <Button variant="quiet" disabled={locked} onClick={() => setEditingKey(true)}>{text.replaceKey}</Button>
          <Button variant="quiet" disabled={locked} onClick={() => void removeKey()}>{text.removeKey}</Button>
        </div></div> : keyForm}
        {message && <Notice tone={message.tone} role={message.tone === "ok" ? "status" : "alert"}>{message.text}</Notice>}
        {settings.key === "SAVED" && <div className={styles.block}>
          <h3 className={styles.subhead}>{text.eventTitle}</h3>
          {event && !choosing ? <div className={styles.line}>
            <span>{text.eventLine(event.name, event.date, text.eventForm[event.form], event.id)}</span>
            <Button variant="quiet" disabled={locked || !!review.preview} onClick={() => setChoosing(true)}>{text.changeEvent}</Button>
          </div> : <div className={styles.eventList}>
            {!event && <p className={styles.muted}>{text.noEvent}</p>}
            {events === undefined ? <div><Button variant="secondary" disabled={locked} onClick={() => void listEvents()}>{text.showEvents}</Button></div>
              : events.length === 0 ? <p className={styles.muted}>{text.eventsEmpty}</p>
                : <form className={styles.inlineForm} onSubmit={submit => { submit.preventDefault(); void choose(chosenEvent); }}>
                  <Field label={text.chooseEvent}><select value={chosenEvent} disabled={locked} onChange={change => setChosenEvent(change.target.value)}>
                    {events.map(row => <option key={row.id} value={row.id}>{row.date} · {row.name} ({text.eventForm[row.form]})</option>)}
                  </select></Field>
                  <div className={styles.actions}><Button type="submit" disabled={locked || !chosenEvent}>{text.choose}</Button></div>
                </form>}
            <form className={styles.inlineForm} onSubmit={submit => { submit.preventDefault(); void choose(pastedId.trim()); }}>
              <Field label={text.pasteLabel} help={text.pasteHelp}><input inputMode="numeric" value={pastedId} maxLength={12} disabled={locked}
                onChange={change => setPastedId(change.target.value.replace(/\D/g, ""))} /></Field>
              <div className={styles.actions}><Button type="submit" variant="secondary" disabled={locked || !pastedId.trim()}>{text.choose}</Button>
                {event && <Button variant="quiet" disabled={locked} onClick={() => { setChoosing(false); setEvents(undefined); }}>{text.cancel}</Button>}</div>
            </form>
          </div>}
          {event && !choosing && !review.preview && <div className={styles.line}>
            <Button disabled={locked} onClick={() => void fetchDiff()}>{settings.lastAppliedAt ? text.update : text.fetch}</Button>
            <span className={styles.muted}>{settings.lastAppliedAt ? text.lastUpdated(sourceTime(settings.lastAppliedAt, timeZone)) : text.neverUpdated}</span>
          </div>}
        </div>}
      </>}
      {review.message && <Notice tone={review.message.tone} role={review.message.tone === "ok" ? "status" : "alert"}>{review.message.text}</Notice>}
      <SourceReviewPanel review={review} busy={busy} sourceName={text.title} />
    </div>
  </Section>;
}
