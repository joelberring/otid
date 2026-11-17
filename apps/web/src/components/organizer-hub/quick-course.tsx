"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import type { OrganisationSearchResponse, OrganisationSummary, OrganizerMyEventsResponse } from "@o-tid/contracts";
import { clubLeadersEn } from "../../i18n/club-leaders-en";
import { clubLeadersSv } from "../../i18n/club-leaders-sv";
import { organizerEn } from "../../i18n/organizer-en";
import { organizerSv } from "../../i18n/organizer-sv";
import { courseSettingCandidates, quickCourseName } from "../../lib/hub-start";
import { useTexts } from "../language-provider";
import { Button, Field } from "../ui";
import styles from "./organizer-hub.module.css";

const NONE = "none";

/**
 * Översynen av navet 2026-11-17: "Lägg banor" utan att först förstå "Skapa tävling". Panelen erbjuder de kommande loppen där
 * kontot får lägga banor, och en ny banläggning: en Träning med dagens datum och ett förvalt namn som går att byta. Navet skapar
 * den med samma anrop och samma försök som formuläret och öppnar banläggningen. Arrangörsklubben gissas aldrig (ADR-0209
 * tillägg 2026-11-17): har kontot klubbar, eller kunde de inte läsas, måste en av dem eller "Ingen klubb (eget)" väljas.
 */
export function QuickCourse({ events, busy, onOpen, onCreate, onClose }: {
  events: OrganizerMyEventsResponse["events"]; busy: boolean; onOpen: (raceId: string) => void;
  onCreate: (eventName: string, organisationId: string | null) => void; onClose: () => void }) {
  const text = useTexts(organizerSv, organizerEn).quick;
  const noneText = useTexts(clubLeadersSv.organiser, clubLeadersEn.organiser).none;
  const [name, setName] = useState(() => quickCourseName(new Date(), text.defaultName));
  const [nameError, setNameError] = useState<string>();
  /** Kontots klubbar; undefined medan de läses, null om de inte kunde läsas (då krävs ändå ett val). */
  const [mine, setMine] = useState<readonly OrganisationSummary[] | null>();
  const [chosen, setChosen] = useState<string>();
  const [choiceError, setChoiceError] = useState<string>();
  const heading = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    heading.current?.focus({ preventScroll: true });
    heading.current?.scrollIntoView({ block: "nearest" });
    let current = true;
    void fetch("/api/organizer/organisations?mine=1", { credentials: "same-origin", cache: "no-store" })
      .then(async response => response.ok ? (await response.json() as OrganisationSearchResponse).organisations : null)
      .catch(() => null)
      .then(result => { if (current) setMine(result); });
    return () => { current = false; };
  }, []);

  const candidates = courseSettingCandidates(events, new Date());
  const mustChoose = mine === null || (mine !== undefined && mine.length > 0);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = name.trim();
    const badName = trimmed.length < 2 || trimmed.length > 160;
    setNameError(badName ? text.nameError : undefined);
    setChoiceError(mustChoose && chosen === undefined ? text.organiserError : undefined);
    if (badName) { event.currentTarget.querySelector<HTMLInputElement>("input[name=quickName]")?.focus(); return; }
    if (mustChoose && chosen === undefined) { event.currentTarget.querySelector<HTMLInputElement>("input[name=quickOrganiser]")?.focus(); return; }
    onCreate(trimmed, chosen === undefined || chosen === NONE ? null : chosen);
  }

  return <section id="lagg-banor" className={styles.quick} aria-labelledby="lagg-banor-title" data-testid="quick-course">
    <div className={styles.quickHead}>
      <h2 id="lagg-banor-title" ref={heading} tabIndex={-1}>{text.title}</h2>
      <Button variant="quiet" onClick={onClose}>{text.close}</Button>
    </div>
    {candidates.length > 0 && <div className={styles.quickPart}>
      <h3>{text.existing}</h3>
      <ul className={styles.existing} data-testid="quick-course-existing">
        {candidates.map(race => <li key={race.raceId}>
          <Button variant="secondary" className={styles.existingButton} disabled={busy} onClick={() => onOpen(race.raceId)}>
            <strong>{race.raceName ? `${race.eventName} · ${race.raceName}` : race.eventName}</strong><span>{race.raceDate}</span>
          </Button>
        </li>)}
      </ul>
    </div>}
    <form className={styles.quickPart} noValidate onSubmit={submit}>
      {candidates.length > 0 && <h3>{text.newTitle}</h3>}
      <Field label={text.name} error={nameError} help={text.nameHelp}>
        <input name="quickName" value={name} maxLength={160} disabled={busy} autoComplete="off"
          onChange={event => { setName(event.target.value); setNameError(undefined); }} />
      </Field>
      {mustChoose && <fieldset className={styles.organiser} disabled={busy} data-testid="quick-course-organiser"
        aria-invalid={choiceError ? true : undefined} aria-describedby="quick-organiser-help">
        <legend>{text.organiserLegend}</legend>
        <p id="quick-organiser-help" className={styles.muted}>{text.organiserHelp}</p>
        {(mine ?? []).map(organisation => <label key={organisation.organisationId}>
          <input type="radio" name="quickOrganiser" value={organisation.organisationId} checked={chosen === organisation.organisationId}
            onChange={() => { setChosen(organisation.organisationId); setChoiceError(undefined); }} />
          {organisation.name}</label>)}
        <label><input type="radio" name="quickOrganiser" value={NONE} checked={chosen === NONE}
          onChange={() => { setChosen(NONE); setChoiceError(undefined); }} />{noneText}</label>
        {choiceError && <p role="alert" className={styles.error} data-testid="quick-course-organiser-error">{choiceError}</p>}
      </fieldset>}
      <Button type="submit" className={styles.start} disabled={busy || mine === undefined} aria-busy={busy}
        data-testid="quick-course-start">{text.start}</Button>
    </form>
  </section>;
}
