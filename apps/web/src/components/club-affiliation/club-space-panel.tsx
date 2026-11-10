"use client";

import { useClubFailure } from "../club-archive/use-club-failure";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { clubAffiliationEn } from "../../i18n/club-space-en";
import { clubStartEn } from "../../i18n/club-space-en";
import { useTexts, useLocale } from "../language-provider";
import type { Texts } from "../../lib/language";
import type { ClubAccessSettingsResponse, ClubAffiliationPerson, ClubAffiliationView, ClubAreaAccess } from "@o-tid/contracts";
import { clubAffiliationSv } from "../../i18n/club-affiliation-sv";
import { clubBase } from "../../lib/club-archive-client";
import { affiliationRequest as clubRequest } from "../../lib/club-affiliation-client";
import { Button, Field, Notice } from "../ui";
import { EventorRequestDialog } from "../club-archive/club-start-card";
import { clubStartSv } from "../../i18n/club-start-sv";
import styles from "./club-affiliation.module.css";

type Message = { tone: "ok" | "error"; text: string } | undefined;
const problemText = (json: unknown, status: number, text: Texts<typeof clubAffiliationSv.space>, failure: (status: number) => string) => {
  const code = (json as { error?: string } | undefined)?.error;
  return code && text.problems[code] ? text.problems[code] : failure(status);
};
const when = (iso: string, locale: string) => new Date(iso).toLocaleString(locale, { dateStyle: "short", timeStyle: "short" });

/** Kom igång kan be panelen rulla fram kopplingen eller Vem ser vad; `seq` gör att samma val fungerar igen. */
export type ClubSpaceFocus = { target: "eventor" | "access"; seq: number };

/**
 * Kopplingen med klubbens Eventor-nyckel: klistra in, byt, ta bort, och medlemslistan (bara siffror). Utan koppling också "Be
 * klubbens Eventor-administratör koppla" för den som inte har nyckeln själv.
 */
function EventorCard({ view, clubId, clubName, onChanged, onInvite }: { view: ClubAffiliationView; clubId: string; clubName: string;
  onChanged: () => Promise<void>; onInvite: (() => void) | undefined }) {
  const locale = useLocale();
  const failure = useClubFailure();
  const text = useTexts(clubAffiliationSv.space, clubAffiliationEn.space);
  const clubStartText = useTexts(clubStartSv, clubStartEn);
  const [key, setKey] = useState("");
  const [asking, setAsking] = useState(false);
  const [replacing, setReplacing] = useState(false);
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState<Message>();
  const eventor = view.eventor;

  async function link(event: FormEvent) {
    event.preventDefault();
    setBusy("link"); setMessage(undefined);
    const result = await clubRequest(`${clubBase(clubId)}/eventor`, "PUT", { formatVersion: 1, apiKey: key.trim() });
    // Nyckeln stannar inte i sidan efter försöket.
    setKey("");
    setBusy("");
    if (result.status !== 200) { setMessage({ tone: "error", text: problemText(result.json, result.status, text, failure) }); return; }
    setReplacing(false);
    await onChanged();
  }
  async function act(method: "POST" | "DELETE") {
    if (method === "DELETE" && !window.confirm(text.unlinkConfirm)) return;
    setBusy(method); setMessage(undefined);
    const result = await clubRequest(`${clubBase(clubId)}/eventor`, method);
    setBusy("");
    if (result.status !== 200) { setMessage({ tone: "error", text: problemText(result.json, result.status, text, failure) }); return; }
    await onChanged();
  }

  return <section className={styles.panel} aria-labelledby="club-eventor" data-testid="club-eventor">
    <h2 id="club-eventor">{text.eventorTitle}</h2>
    {eventor.linked && view.organisation ? <>
      <p data-testid="club-eventor-linked"><strong>{text.linked(view.organisation.name, eventor.keyHint ?? "")}</strong></p>
      <p data-testid="club-eventor-counts">{text.counts(eventor.members, eventor.confirmedViaEventor)}</p>
      <p className={styles.muted}>{eventor.syncedAt ? text.syncedAt(when(eventor.syncedAt, locale)) : text.neverSynced}
        {eventor.problem && text.problems[eventor.problem] ? ` ${text.problems[eventor.problem]}` : ""}</p>
      <div className={styles.actions}>
        <Button variant="secondary" disabled={busy !== ""} onClick={() => void act("POST")}>{busy === "POST" ? text.syncing : text.sync}</Button>
        <Button variant="secondary" disabled={busy !== ""} onClick={() => setReplacing(value => !value)}>{text.replace}</Button>
        <Button variant="quiet" disabled={busy !== ""} onClick={() => void act("DELETE")}>{text.unlink}</Button>
      </div>
    </> : <p className={styles.muted}><span className={styles.badge}>{text.unlinked}</span> {text.unlinkedHelp}</p>}
    {(!eventor.linked || replacing) && <form className={styles.form} onSubmit={event => void link(event)} noValidate aria-label={text.eventorTitle}>
      <p className={styles.muted}>{text.eventorHelp}</p>
      <Field label={text.key}>
        <input type="password" autoComplete="off" spellCheck={false} value={key} maxLength={128} disabled={busy !== ""}
          onChange={event => setKey(event.target.value)} />
      </Field>
      <div className={styles.actions}><Button type="submit" disabled={busy !== "" || key.trim().length < 16}>{busy === "link" ? text.linking : text.link}</Button></div>
    </form>}
    {!eventor.linked && <div className={styles.actions}>
      <span className={styles.muted}>{clubStartText.steps.eventor.noKey}</span>
      <Button variant="secondary" onClick={() => setAsking(true)}>{clubStartText.ask.open}</Button>
    </div>}
    {asking && <EventorRequestDialog clubId={clubId} clubName={clubName} onClose={() => setAsking(false)} onInvite={onInvite} />}
    {message && <Notice tone={message.tone} role={message.tone === "ok" ? "status" : "alert"}>{message.text}</Notice>}
  </section>;
}

function AccessCard({ view, clubId, onSaved }: { view: ClubAffiliationView; clubId: string; onSaved: (view: ClubAffiliationView) => void }) {
  const failure = useClubFailure();
  const text = useTexts(clubAffiliationSv.space, clubAffiliationEn.space);
  const [archive, setArchive] = useState<ClubAreaAccess>(view.access.archive);
  const [mapBank, setMapBank] = useState<ClubAreaAccess>(view.access.mapBank);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<Message>();
  async function save(event: FormEvent) {
    event.preventDefault();
    setBusy(true); setMessage(undefined);
    const result = await clubRequest(`${clubBase(clubId)}/access`, "PUT", { formatVersion: 1, archive, mapBank });
    setBusy(false);
    if (result.status !== 200) { setMessage({ tone: "error", text: failure(result.status) }); return; }
    onSaved({ ...view, access: (result.json as ClubAccessSettingsResponse).access });
    setMessage({ tone: "ok", text: text.accessSaved });
  }
  // "Alla medlemmar" först; det är förvalet för båda delarna (ADR-0209 beslut 5).
  const choice = (name: string, legend: string, value: ClubAreaAccess, set: (value: ClubAreaAccess) => void, hint?: string) =>
    <fieldset className={styles.radios} aria-describedby={hint ? `club-access-${name}-hint` : undefined}>
      <legend>{legend}</legend>
      {(["MEMBERS", "LEADERS"] as const).map(option => <label key={option}>
        <input type="radio" name={name} value={option} checked={value === option} disabled={busy} onChange={() => set(option)} />{text[option]}
      </label>)}
      {hint && <small id={`club-access-${name}-hint`} className={styles.muted}>{hint}</small>}
    </fieldset>;
  return <section className={styles.panel} aria-labelledby="club-access">
    <h2 id="club-access">{text.accessTitle}</h2>
    <p className={styles.muted}>{text.accessHelp}</p>
    <form className={styles.form} onSubmit={event => void save(event)}>
      {choice("archive", text.archive, archive, setArchive)}
      {choice("mapBank", text.mapBank, mapBank, setMapBank, text.mapBankHint)}
      <div className={styles.actions}><Button type="submit" variant="secondary" disabled={busy}>{text.saveAccess}</Button></div>
    </form>
    {message && <Notice tone={message.tone} role={message.tone === "ok" ? "status" : "alert"}>{message.text}</Notice>}
  </section>;
}

/**
 * ADR-0209: fliken Klubben i klubbytan (ägare och administratörer): Koppla till Eventor, Vem ser vad, Väntar på bekräftelse
 * med Bekräfta och Avböj, och Bekräftade medlemmar. Bara namn, aldrig adresser.
 */
export function ClubSpacePanel({ clubId, clubName, focus, onInvite, onChanged }: { clubId: string; clubName: string;
  focus?: ClubSpaceFocus | undefined; onInvite?: () => void;
  /** Kopplingen ändrades: sidan hämtar klubbytan igen (märket i rubriken och Kom igång). */
  onChanged?: () => Promise<void> }) {
  const failure = useClubFailure();
  const clubAffiliationText = useTexts(clubAffiliationSv, clubAffiliationEn);
  const text = useTexts(clubAffiliationSv.space, clubAffiliationEn.space);
  const [view, setView] = useState<ClubAffiliationView>();
  const [failed, setFailed] = useState<number>();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<Message>();

  const load = useCallback(async () => {
    const result = await clubRequest(`${clubBase(clubId)}/affiliation`);
    if (result.status !== 200) { setFailed(result.status); return; }
    setFailed(undefined);
    setView(result.json as ClubAffiliationView);
  }, [clubId]);
  useEffect(() => { void load(); }, [load]);
  // Kom igång: rulla fram rutan när vyn finns, och lägg markören i nyckelfältet.
  const loaded = view !== undefined;
  useEffect(() => {
    if (!focus || !loaded) return;
    const section = document.getElementById(focus.target === "eventor" ? "club-eventor" : "club-access")?.closest("section");
    section?.scrollIntoView({ block: "start", behavior: "smooth" });
    if (focus.target === "eventor") section?.querySelector<HTMLInputElement>("input[type=password]")?.focus({ preventScroll: true });
  }, [focus, loaded]);

  async function decide(person: ClubAffiliationPerson, decision: "CONFIRM" | "DECLINE" | "REMOVE") {
    if (decision === "REMOVE" && !window.confirm(text.removeConfirm(person.displayName))) return;
    setBusy(true); setMessage(undefined);
    try {
      const result = await clubRequest(`${clubBase(clubId)}/affiliation/decisions`, "POST", { formatVersion: 1, membershipId: person.membershipId, decision });
      if (result.status !== 200) { setMessage({ tone: "error", text: failure(result.status) }); return; }
      setView(result.json as ClubAffiliationView);
    } catch {
      setMessage({ tone: "error", text: text.failed });
    } finally { setBusy(false); }
  }

  if (failed) return <Notice tone="error" role="alert">{failure(failed)}</Notice>;
  if (!view) return <p role="status">…</p>;
  const person = (row: ClubAffiliationPerson) => <div>
    <strong>{row.displayName}</strong>
    <span>{[row.freeText ? text.freeText(row.freeText) : "", row.via ? clubAffiliationText.confirmedVia[row.via] : ""].filter(Boolean).join(" · ")}</span>
  </div>;
  return <div className={styles.form} style={{ maxWidth: "48rem" }}>
    <EventorCard view={view} clubId={clubId} clubName={clubName} onChanged={async () => { await load(); await onChanged?.(); }} onInvite={onInvite} />
    {/* Ingen key på valen: en ändring som sparas byter view.access, och en ny komponent tappade beskedet "Vem ser vad är sparat." */}
    <AccessCard view={view} clubId={clubId} onSaved={setView} />
    <section className={styles.panel} aria-labelledby="club-pending">
      <h2 id="club-pending">{text.pending(view.pending.length)}</h2>
      <p className={styles.muted}>{text.pendingHelp}</p>
      {view.pending.length === 0 ? <p className={styles.muted}>{text.pendingNone}</p>
        : <ul className={styles.list} data-testid="club-pending">{view.pending.map(row => <li key={row.membershipId}>
          {person(row)}
          <div className={styles.actions}>
            <Button disabled={busy} aria-label={`${text.confirm}: ${row.displayName}`} onClick={() => void decide(row, "CONFIRM")}>{text.confirm}</Button>
            <Button variant="secondary" disabled={busy} aria-label={`${text.decline}: ${row.displayName}`} onClick={() => void decide(row, "DECLINE")}>
              {text.decline}</Button>
          </div>
        </li>)}</ul>}
    </section>
    <section className={styles.panel} aria-labelledby="club-confirmed">
      <h2 id="club-confirmed">{text.confirmed(view.confirmed.length)}</h2>
      {view.confirmed.length === 0 ? <p className={styles.muted}>{text.confirmedNone}</p>
        : <ul className={styles.list} data-testid="club-confirmed">{view.confirmed.map(row => <li key={row.membershipId}>
          {person(row)}
          <div className={styles.actions}><Button variant="secondary" disabled={busy} aria-label={`${text.removeMember}: ${row.displayName}`}
            onClick={() => void decide(row, "REMOVE")}>{text.removeMember}</Button></div>
        </li>)}</ul>}
    </section>
    {message && <Notice tone={message.tone} role={message.tone === "ok" ? "status" : "alert"}>{message.text}</Notice>}
  </div>;
}
