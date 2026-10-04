"use client";

import Link from "next/link";
import styles from "../race-administrator-workspace.module.css";
import { raceTypeSv } from "../../i18n/race-type-sv";
import { RaceOperatorAccess } from "../race-operator-access";
import { RaceTypeChoice } from "../race-type-choice";
import { Button, Field, Notice, Section } from "../ui";
import type { Workspace } from "./workspace-state";

const text = raceTypeSv.settings;

/**
 * Inställningar (ADR-0170 beslut 1): namn, datum och tävlingstyp. Att byta typ ändrar bara vilka delar som
 * syns; inget tas bort. Här finns också funktionärer och, för typer med import, länken till importen.
 */
export function SettingsPanel({ ws }: { ws: Workspace }) {
  const { busy, changeSettings, data, profile, raceId, saveSettings, setOperatorAccessPending, settingsAttempt, settingsForm,
    settingsMessage, shows, workflowLocked } = ws;
  if (!shows("SETTINGS") || !data) return null;
  const form = settingsForm ?? { eventName: data.eventName, raceName: data.raceName, raceDate: data.raceDate, raceType: data.raceType };
  // Tiderna tolkas mot loppets datum: med starttider eller resultat går datumet inte att ändra (servern kontrollerar också).
  const dateLocked = data.entries.some(entry => entry.fixedStartTime !== null || entry.effectiveResult.state !== "NO_PUBLISHED_RESULT");
  const locked = busy || workflowLocked;
  const id = `settings-${raceId}`;
  return <div className={styles.workflowGroup}>
    <Section id={id} title={text.title} help={text.help}>
      <form className={styles.settingsForm} onSubmit={event => { event.preventDefault(); void saveSettings(); }}>
        <div className={styles.settingsFields}>
          <Field label={text.eventName}><input value={form.eventName} minLength={2} maxLength={160} required disabled={locked || !!settingsAttempt}
            onChange={event => changeSettings({ eventName: event.target.value })} /></Field>
          <Field label={text.raceName}><input value={form.raceName} minLength={2} maxLength={160} required disabled={locked || !!settingsAttempt}
            onChange={event => changeSettings({ raceName: event.target.value })} /></Field>
          <Field label={text.raceDate} help={dateLocked ? text.raceDateLocked : undefined}><input type="date" value={form.raceDate} required
            disabled={locked || dateLocked || !!settingsAttempt} onChange={event => changeSettings({ raceDate: event.target.value })} /></Field>
        </div>
        <RaceTypeChoice name={`${id}-type`} value={form.raceType} disabled={locked || !!settingsAttempt}
          onChange={raceType => changeSettings({ raceType })} />
        {settingsMessage && <Notice tone={settingsMessage.tone} role={settingsMessage.tone === "ok" ? "status" : "alert"}>
          {settingsMessage.text}</Notice>}
        <div><Button type="submit" disabled={locked}>{text.save}</Button></div>
      </form>
    </Section>
    <Section id={`${id}-staff`} title={text.staff} help={text.staffHelp}>
      <RaceOperatorAccess raceId={raceId} onPendingChange={setOperatorAccessPending} />
    </Section>
    {profile.features.import && <Section id={`${id}-import`} title={text.import} help={text.importHelp}>
      <p><Link href={`/admin/${raceId}/imports`}>{text.importLink}</Link></p>
    </Section>}
  </div>;
}

/** Rogaining (ADR-0170 beslut 5): poäng per kontroll kommer i steg 15. Tills dess en kort notis där inställningen hör hemma. */
export function RogainingNote({ ws }: { ws: Workspace }) {
  if (!ws.shows("ROGAINING_NOTE")) return null;
  return <Notice tone="info">{raceTypeSv.rogainingNote}</Notice>;
}
