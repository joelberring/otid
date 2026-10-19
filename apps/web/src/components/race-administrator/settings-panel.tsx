"use client";

import { useState } from "react";
import Link from "next/link";
import styles from "../race-administrator-workspace.module.css";
import { raceTypeSv } from "../../i18n/race-type-sv";
import { sectionForPanel } from "../../lib/race-sections";
import { raceCopySv } from "../../i18n/race-copy-sv";
import { RaceTypeChoice } from "../race-type-choice";
import { CopyRaceDialog, type CopySource } from "../copy-race-dialog";
import { Button, DateInput, Field, Notice, Section } from "../ui";
import { EventorSection } from "./eventor-section";
import { RaceDeleteSection } from "./race-delete-section";
import { PeopleSection } from "./people-section";
import { RadioSection } from "./radio-section";
import type { Workspace } from "./workspace-state";

const text = raceTypeSv.settings;

/**
 * Inställningar (ADR-0170 beslut 1): namn, datum och tävlingstyp. Att byta typ ändrar bara vilka delar som
 * syns; inget tas bort. Här finns också en länk till steget Publicera, personer med behörighet (ADR-0172), Eventor (typer som använder Eventor), radiokontroller
 * (typer med tävlingsmoment), länken till importen, "Ny tävling som den här" (PLAN.md steg 21) och
 * (för ägaren) att ta bort tävlingen.
 */
export function SettingsPanel({ ws }: { ws: Workspace }) {
  const { changeSettings, data, navigateStep, profile, raceId, saveSettings, saving, setPeoplePending, settingsAttempt, settingsErrors, settingsForm,
    settingsMessage, shows, workflowLocked } = ws;
  const [copySource, setCopySource] = useState<CopySource>();
  if (!shows("SETTINGS") || !data) return null;
  const form = settingsForm ?? { eventName: data.eventName, raceName: data.raceName, raceDate: data.raceDate, raceType: data.raceType };
  // Tiderna tolkas mot loppets datum: med starttider eller resultat går datumet inte att ändra (servern kontrollerar också).
  const dateLocked = data.entries.some(entry => entry.fixedStartTime !== null || entry.effectiveResult.state !== "NO_PUBLISHED_RESULT");
  const locked = saving || workflowLocked;
  const id = `settings-${raceId}`;
  const publish = sectionForPanel(profile, "PUBLISH");
  return <div className={styles.workflowGroup}>
    <Section id={id} title={text.title} help={text.help}>
      <form className={styles.settingsForm} noValidate onSubmit={event => { event.preventDefault(); void saveSettings(); }}>
        <div className={styles.settingsFields}>
          <Field label={text.eventName} error={settingsErrors.eventName}><input value={form.eventName} minLength={2} maxLength={160} required disabled={locked || !!settingsAttempt}
            onChange={event => changeSettings({ eventName: event.target.value })} /></Field>
          <Field label={text.raceName} error={settingsErrors.raceName}><input value={form.raceName} minLength={2} maxLength={160} required disabled={locked || !!settingsAttempt}
            onChange={event => changeSettings({ raceName: event.target.value })} /></Field>
          <Field label={text.raceDate} error={settingsErrors.raceDate} help={dateLocked ? text.raceDateLocked : undefined}><DateInput value={form.raceDate}
            disabled={locked || dateLocked || !!settingsAttempt} onChange={event => changeSettings({ raceDate: event.target.value })} /></Field>
        </div>
        <RaceTypeChoice name={`${id}-type`} value={form.raceType} disabled={locked || !!settingsAttempt}
          onChange={raceType => changeSettings({ raceType })} />
        {settingsMessage && <Notice tone={settingsMessage.tone} role={settingsMessage.tone === "ok" ? "status" : "alert"}>
          {settingsMessage.text}</Notice>}
        <div><Button type="submit" disabled={locked}>{text.save}</Button></div>
      </form>
    </Section>
    {/* Publiceringen finns på ett ställe, steget Publicera (PLAN.md steg 24). */}
    {publish && <Section id={`${id}-publish`} title={raceTypeSv.sections.PUBLISH} help={text.publishLink}>
      <div><Button variant="secondary" onClick={() => navigateStep(publish.id)}>{text.publishOpen}</Button></div>
    </Section>}
    <PeopleSection raceId={raceId} disabled={locked} onPendingChange={setPeoplePending} />
    {profile.features.eventor && <EventorSection ws={ws} />}
    {profile.features.radio && <RadioSection raceId={raceId} disabled={locked} />}
    {profile.features.import && <Section id={`${id}-import`} title={text.import} help={text.importHelp}>
      <p><Link href={`/admin/${raceId}/imports`}>{text.importLink}</Link></p>
    </Section>}
    <Section id={`${id}-copy`} title={raceCopySv.settingsTitle} help={raceCopySv.settingsHelp}>
      <div><Button variant="secondary" disabled={locked} onClick={() => setCopySource({ raceId, eventName: data.eventName,
        raceName: data.raceName, raceDate: data.raceDate })}>{raceCopySv.settingsAction}</Button></div>
      <CopyRaceDialog source={copySource} onClose={() => setCopySource(undefined)} />
    </Section>
    <RaceDeleteSection raceId={raceId} eventName={data.eventName} disabled={locked} />
  </div>;
}
