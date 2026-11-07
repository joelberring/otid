"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import type { ClubView } from "@o-tid/contracts";
import { clubStartSv } from "../../i18n/club-start-sv";
import { CLUB_START_STEPS, clubStartHidden, clubStartStatus, hideClubStart, mailtoHref, showClubStart, type ClubStartStep } from "../../lib/club-start";
import { Button, Notice } from "../ui";
import styles from "./club-start.module.css";

const text = clubStartSv;
/** Vart en knapp i kortet leder: en flik, eller en ruta under fliken Klubben. */
export type ClubStartTarget = "eventor" | "access" | "members" | "maps" | "import";

/**
 * "Be klubbens Eventor-administratör koppla": en färdig text att kopiera eller öppna i e-post (mailto utan mottagare). Ingen
 * nyckel och inget skickas av O-Tid; länken går till klubbytans flik Klubben (som kräver inloggning och medlemskap).
 */
export function EventorRequestDialog({ clubId, clubName, onClose, onInvite }: { clubId: string; clubName: string; onClose: () => void;
  onInvite?: (() => void) | undefined }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const area = useRef<HTMLTextAreaElement>(null);
  const [copy, setCopy] = useState<"copied" | "failed">();
  const [link, setLink] = useState(`/organizer/clubs/${encodeURIComponent(clubId)}#club`);
  useEffect(() => {
    setLink(`${window.location.origin}/organizer/clubs/${encodeURIComponent(clubId)}#club`);
    dialog.current?.showModal();
  }, [clubId]);
  const subject = text.ask.subject(clubName);
  const body = text.ask.body(clubName, link);

  async function copyText() {
    try {
      await navigator.clipboard.writeText(body);
      setCopy("copied");
    } catch {
      area.current?.select();
      setCopy("failed");
    }
  }

  return <dialog ref={dialog} className={styles.dialog} aria-labelledby="eventor-request-title" onClose={onClose} data-testid="eventor-request">
    <div className={styles.dialogBody}>
      <h2 id="eventor-request-title">{text.ask.title}</h2>
      <p>{text.ask.intro}</p>
      <label className={styles.textLabel}>{text.ask.label}
        <textarea ref={area} readOnly value={body} rows={12} spellCheck={false} onFocus={event => event.currentTarget.select()} />
      </label>
      <p className={styles.small}>{text.ask.noSecret}</p>
      {copy && <Notice tone={copy === "copied" ? "ok" : "attention"} role="status">{copy === "copied" ? text.ask.copied : text.ask.copyFailed}</Notice>}
      <div className={styles.actions}>
        <Button onClick={() => void copyText()}>{text.ask.copy}</Button>
        <a className={styles.buttonLink} href={mailtoHref(subject, body)}>{text.ask.mail}</a>
        {onInvite && <Button variant="secondary" onClick={() => { dialog.current?.close(); onInvite(); }}>{text.ask.invite}</Button>}
        <Button variant="quiet" onClick={() => dialog.current?.close()}>{text.ask.close}</Button>
      </div>
    </div>
  </dialog>;
}

/**
 * ADR-0209 (ändrat 2026-11-07): "Kom igång" överst i klubbytan för ägare och administratörer, tills klubbytan är kopplad till
 * Eventor och har minst en karta. "Dölj" sparas i webbläsaren per klubbyta. En ny klubbyta (inget gjort) säger att nästa steg
 * är kopplingen till Eventor.
 */
export function ClubStartCard({ club, clubName, onGo }: { club: ClubView; clubName: string; onGo: (target: ClubStartTarget) => void }) {
  // Läses först efter första ritningen: sidan ritas på servern utan lagring.
  const [hidden, setHidden] = useState(true);
  const [asking, setAsking] = useState(false);
  useEffect(() => { setHidden(clubStartHidden(club.clubId)); }, [club.clubId]);
  if (!showClubStart(club, hidden)) return null;
  const status = clubStartStatus(club);
  const doneCount = CLUB_START_STEPS.filter(step => status.done[step]).length;

  const step = (name: ClubStartStep, help: string, actions: ReactNode) => {
    const done = status.done[name];
    const next = status.next === name;
    return <li key={name} className={styles.step} data-testid={`club-start-${name}`} data-done={done} data-next={next}>
      <span className={styles.mark} aria-hidden="true">{done ? "✓" : CLUB_START_STEPS.indexOf(name) + 1}</span>
      <div className={styles.stepBody}>
        <h3>{text.steps[name].title}
          <span className={styles.state}>{done ? text.done : next ? text.next : text.todo}</span></h3>
        <p className={styles.small}>{help}</p>
        {actions && <div className={styles.actions}>{actions}</div>}
      </div>
    </li>;
  };

  return <section className={styles.card} aria-labelledby="club-start-title" data-testid="club-start" data-fresh={status.fresh}>
    <div className={styles.head}>
      <div>
        <h2 id="club-start-title">{status.fresh ? text.freshTitle(clubName) : text.title}
          <span className={styles.progress}>{text.progress(doneCount, CLUB_START_STEPS.length)}</span></h2>
        <p className={status.fresh ? styles.nextLine : styles.small} data-testid="club-start-intro">{status.fresh ? text.freshNext : text.intro}</p>
      </div>
      <Button variant="quiet" aria-label={text.hideLabel} onClick={() => { hideClubStart(club.clubId); setHidden(true); }}>{text.hide}</Button>
    </div>
    <ol className={styles.steps}>
      {step("eventor", club.eventorClub ? text.steps.eventor.linked(club.eventorClub) : text.steps.eventor.help, club.eventorClub ? null : <>
        <Button onClick={() => onGo("eventor")}>{text.steps.eventor.action}</Button>
        <span className={styles.small}>{text.steps.eventor.noKey}</span>
        <Button variant="secondary" onClick={() => setAsking(true)}>{text.ask.open}</Button>
      </>)}
      {step("people", text.steps.people.help, <Button variant="secondary" onClick={() => onGo("members")}>{text.steps.people.action}</Button>)}
      {step("maps", text.steps.maps.help, <>
        <Button variant={status.done.eventor && !status.done.maps ? "primary" : "secondary"} onClick={() => onGo("maps")}>{text.steps.maps.upload}</Button>
        <Button variant="secondary" onClick={() => onGo("import")}>{text.steps.maps.import}</Button>
      </>)}
      {step("access", text.steps.access.help, <Button variant="quiet" onClick={() => onGo("access")}>{text.steps.access.action}</Button>)}
    </ol>
    {asking && <EventorRequestDialog clubId={club.clubId} clubName={clubName} onClose={() => setAsking(false)}
      onInvite={() => onGo("members")} />}
  </section>;
}
