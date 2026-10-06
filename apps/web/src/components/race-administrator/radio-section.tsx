"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { radioFetchResponseSchema, radioSettingsResponseSchema, type RadioSettingsResponse, type RadioSource } from "@o-tid/contracts";
import { radioControlName, radioSv } from "../../i18n/radio-sv";
import { readRaceAdministratorCsrfCookie } from "../../lib/race-administrator-cookies";
import { formatClockTime } from "../../lib/clock-time";
import { Button, Field, Notice, Section } from "../ui";
import { sourceTime } from "./eventor-section";
import styles from "./radio-section.module.css";

const text = radioSv.settings;
type Message = { tone: "ok" | "error"; text: string };
type Draft = { enabled: boolean; source: RadioSource; unitId: string; controls: Map<number, string> };

function draftFrom(settings: RadioSettingsResponse): Draft {
  const link = settings.link;
  return { enabled: link?.enabled ?? true, source: link?.source ?? "ROC", unitId: link?.unitId ?? "",
    controls: new Map((link?.controls ?? []).map(control => [control.code, control.label ?? ""])) };
}

/**
 * Inställningar → Radiokontroller (ADR-0172 beslut 5): källa (ROC eller OResults), enhetens id, vilka kontroller som är
 * radiokontroller (med valfritt namn) och på/av. Under formuläret: hämtningens läge, senaste fel i klartext, antal
 * stämplingar och okända brickor, "Hämta nu" och de senaste stämplingarna. Servern kontrollerar allt.
 */
export function RadioSection({ raceId, disabled }: { raceId: string; disabled: boolean }) {
  const base = `/api/admin/races/${encodeURIComponent(raceId)}/administrator/radio`;
  const [settings, setSettings] = useState<RadioSettingsResponse>();
  const [draft, setDraft] = useState<Draft>();
  const [loadFailed, setLoadFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<Message>();

  const show = useCallback((value: RadioSettingsResponse) => {
    if (value.raceId !== raceId) throw new Error("Inställningarna gäller en annan tävling");
    setSettings(value); setDraft(draftFrom(value));
  }, [raceId]);

  const load = useCallback(async () => {
    setLoadFailed(false);
    try {
      const response = await fetch(base, { credentials: "same-origin", cache: "no-store" });
      if (!response.ok) throw new Error(`Radioinställningarna svarade ${response.status}`);
      show(radioSettingsResponseSchema.parse(await response.json()));
    } catch { setLoadFailed(true); }
  }, [base, show]);
  useEffect(() => { void load(); }, [load]);

  async function send(path: string, method: "PUT" | "POST", body?: unknown): Promise<{ status: number; value?: unknown }> {
    const csrf = readRaceAdministratorCsrfCookie(document.cookie, new URL(window.location.href));
    if (!csrf) return { status: 401 };
    const response = await fetch(path, { method, credentials: "same-origin", cache: "no-store",
      headers: { "x-otid-csrf": csrf, ...(body === undefined ? {} : { "content-type": "application/json" }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    return { status: response.status, value: response.ok ? await response.json() as unknown : undefined };
  }
  const failure = (status: number) => status === 401 ? text.sessionExpired : status === 400 ? text.invalid : text.failed;

  async function save(event: FormEvent) {
    event.preventDefault();
    if (busy || !draft) return;
    setBusy(true); setMessage(undefined);
    try {
      const controls = [...draft.controls.entries()].sort(([a], [b]) => a - b)
        .map(([code, label]) => ({ code, label: label.trim() ? label.trim() : null }));
      const result = await send(base, "PUT", { formatVersion: 1, source: draft.source, unitId: draft.unitId.trim(), enabled: draft.enabled, controls });
      if (result.status !== 200) { setMessage({ tone: "error", text: failure(result.status) }); return; }
      show(radioSettingsResponseSchema.parse(result.value));
      setMessage({ tone: "ok", text: text.saved });
    } catch { setMessage({ tone: "error", text: text.failed }); }
    finally { setBusy(false); }
  }

  async function fetchNow() {
    if (busy) return;
    setBusy(true); setMessage(undefined);
    try {
      const result = await send(`${base}/fetch`, "POST");
      if (result.status !== 200) { setMessage({ tone: "error", text: failure(result.status) }); return; }
      const value = radioFetchResponseSchema.parse(result.value);
      setSettings(value.settings);
      if (value.outcome === "FETCHED") setMessage({ tone: "ok", text: text.fetched(value.newPunches) });
      else if (value.outcome === "NOT_CONFIGURED") setMessage({ tone: "error", text: text.notConfigured });
      // Felet visas i lägesrutan nedan (samma text som pollerns fel).
    } catch { setMessage({ tone: "error", text: text.failed }); }
    finally { setBusy(false); }
  }

  const id = `settings-${raceId}-radio`;
  if (!settings || !draft) return <Section id={id} title={text.title} help={text.help}>
    {loadFailed ? <Notice tone="error" role="alert"><p>{text.loadError}</p>
      <div><Button variant="secondary" onClick={() => void load()}>{text.retry}</Button></div></Notice>
      : <p className={styles.muted} role="status">{text.loading}</p>}
  </Section>;

  const locked = busy || disabled;
  const timeZone = settings.timeZone;
  // Kontroller att välja bland: banornas kontroller och de som redan är valda (även om banan ändrats).
  const choices = [...settings.candidates, ...(settings.link?.controls ?? [])
    .filter(control => !settings.candidates.some(candidate => candidate.code === control.code))
    .map(control => ({ code: control.code, courses: [] as string[] }))].sort((a, b) => a.code - b.code);
  const toggle = (code: number, on: boolean) => setDraft(current => {
    if (!current) return current;
    const controls = new Map(current.controls);
    if (on) controls.set(code, controls.get(code) ?? ""); else controls.delete(code);
    return { ...current, controls };
  });
  const status = settings.status;
  const source = settings.link ? text.sourceShort[settings.link.source] : "";
  const labelOf = (code: number) => radioControlName(code, settings.link?.controls.find(control => control.code === code)?.label ?? null, true);
  return <Section id={id} title={text.title} help={text.help}>
    <form className={styles.form} onSubmit={event => void save(event)} aria-label={text.title}>
      <label className={styles.switch}>
        <input type="checkbox" checked={draft.enabled} disabled={locked} onChange={event => setDraft({ ...draft, enabled: event.target.checked })} />
        <span><strong>{text.enabled}</strong><small>{text.enabledHelp}</small></span>
      </label>
      <div className={styles.fields}>
        <Field label={text.source}>
          <select value={draft.source} disabled={locked} onChange={event => setDraft({ ...draft, source: event.target.value === "ORESULTS" ? "ORESULTS" : "ROC" })}>
            <option value="ROC">{text.sources.ROC}</option>
            <option value="ORESULTS">{text.sources.ORESULTS}</option>
          </select>
        </Field>
        <Field label={text.unit} help={text.unitHelp}>
          <input value={draft.unitId} required maxLength={64} pattern="[A-Za-z0-9_\-]{1,64}" autoComplete="off" spellCheck={false}
            inputMode="text" disabled={locked} onChange={event => setDraft({ ...draft, unitId: event.target.value })} />
        </Field>
      </div>
      <fieldset className={styles.controls} disabled={locked}>
        <legend>{text.controls}</legend>
        <p className={styles.muted}>{text.controlsHelp}</p>
        {choices.length === 0 ? <p className={styles.muted}>{text.noCandidates}</p> : <ul>
          {choices.map(choice => {
            const checked = draft.controls.has(choice.code);
            return <li key={choice.code} data-checked={checked || undefined}>
              <label className={styles.check}>
                <input type="checkbox" checked={checked} onChange={event => toggle(choice.code, event.target.checked)} />
                <span><strong>{text.controlLabel(choice.code)}</strong>
                  {choice.courses.length > 0 && <small>{text.controlCourses(choice.courses)}</small>}</span>
              </label>
              <input className={styles.label} aria-label={text.labelFor(choice.code)} placeholder={text.labelPlaceholder} maxLength={40}
                value={draft.controls.get(choice.code) ?? ""} disabled={!checked}
                onChange={event => setDraft({ ...draft, controls: new Map(draft.controls).set(choice.code, event.target.value) })} />
            </li>;
          })}
        </ul>}
      </fieldset>
      {settings.relay && <Notice tone="info">{text.relay}</Notice>}
      {message && <Notice tone={message.tone} role={message.tone === "ok" ? "status" : "alert"}>{message.text}</Notice>}
      <div className={styles.actions}>
        <Button type="submit" disabled={locked || !draft.unitId.trim()}>{text.save}</Button>
        {settings.link && <Button variant="secondary" disabled={locked} onClick={() => void fetchNow()}>{text.fetchNow}</Button>}
      </div>
    </form>
    {status && <div className={styles.status} role="status" aria-live="polite">
      <p><strong>{status.polling === "NOT_TODAY" ? text.polling.NOT_TODAY(settings.raceDate) : text.polling[status.polling]}</strong></p>
      <p>{status.lastSuccessAt ? text.lastFetch(sourceTime(status.lastSuccessAt, timeZone)) : text.neverFetched}</p>
      <p className={styles.counts}>{text.counts(status.punches, status.unknownCards, status.otherControls)}</p>
      {status.malformedLines > 0 && <p className={styles.muted}>{text.malformed(status.malformedLines)}</p>}
      {status.lastError && status.lastErrorAt && <Notice tone="error" role="alert">
        {text.lastError(sourceTime(status.lastErrorAt, timeZone), text.errors[status.lastError](source))}
        {status.consecutiveFailures > 1 && <> {text.retrying(status.consecutiveFailures)}</>}
      </Notice>}
    </div>}
    {settings.latest.length > 0 && <div className={styles.latest}>
      <h3>{text.latestTitle}</h3>
      <ul>{settings.latest.map((row, index) => <li key={`${row.punchedAt}-${row.cardNumber}-${row.controlCode}-${index}`}
        data-unknown={row.runner === null || undefined}>
        <span className={styles.clock}>{formatClockTime(row.punchedAt, timeZone)}</span>
        <span>{labelOf(row.controlCode)}</span>
        <span className={styles.who}>{row.runner ? <>{row.runner}{row.className && <small> · {row.className}</small>}</>
          : <><span aria-hidden="true">? </span>{text.unknownCard(row.cardNumber)}</>}</span>
      </li>)}</ul>
    </div>}
  </Section>;
}

