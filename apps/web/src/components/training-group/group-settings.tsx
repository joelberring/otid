"use client";

import { useState, type FormEvent } from "react";
import { trainingGroupEn } from "../../i18n/training-group-en";
import { useTexts } from "../language-provider";
import type { GroupLeaderView, GroupSettings } from "@o-tid/contracts";
import { trainingGroupSv } from "../../i18n/training-group-sv";
import { groupFailure, groupRequest } from "../../lib/training-group-client";
import { Button, Field, Notice } from "../ui";
import styles from "./training-group.module.css";


function Radios<T extends string>({ legend, name, options, value, onChange, disabled, help }: { legend: string; name: string;
  options: Record<T, string>; value: T; onChange: (value: T) => void; disabled: boolean; help?: string }) {
  return <fieldset className={styles.choice}>
    <legend>{legend}</legend>
    {(Object.keys(options) as T[]).map(option => <label key={option} className={styles.check}>
      <input type="radio" name={name} checked={value === option} disabled={disabled} onChange={() => onChange(option)} />{options[option]}</label>)}
    {help && <span className={styles.muted}>{help}</span>}
  </fieldset>;
}

/** Steg 68 (ADR-0182 beslut 7): synligheten per grupp med försiktiga standardvärden, poängserien och gruppens mall. */
export function GroupSettingsForm({ view, onSaved }: { view: GroupLeaderView; onSaved: (message: string) => void }) {
  const trainingGroupText = useTexts(trainingGroupSv, trainingGroupEn);
  const text = useTexts(trainingGroupSv.leader, trainingGroupEn.leader);
  const [settings, setSettings] = useState<GroupSettings>(view.settings);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState("");
  const set = (patch: Partial<GroupSettings>) => setSettings(current => ({ ...current, ...patch }));

  async function save(event: FormEvent) {
    event.preventDefault();
    setBusy(true); setProblem("");
    try {
      const result = await groupRequest(`/api/organizer/groups/${view.groupId}`, "PUT", { formatVersion: 1, name: settings.name.trim(),
        pageVisibility: settings.pageVisibility, nameDisplay: settings.nameDisplay, statsVisibility: settings.statsVisibility,
        pointsMode: settings.pointsMode, templateRaceId: settings.templateRaceId });
      if (result.status !== 200) { setProblem(groupFailure(result.status, trainingGroupText.leader.errors)); return; }
      onSaved(text.saved);
    } finally { setBusy(false); }
  }

  return <form className={styles.form} noValidate onSubmit={event => void save(event)} aria-label={text.sections.settings}>
    <p className={styles.muted}>{text.settingsHint}</p>
    <Field label={trainingGroupText.myGroups.name}><input value={settings.name} maxLength={120} disabled={busy}
      onChange={event => set({ name: event.target.value })} /></Field>
    <Radios legend={text.pageVisibility} name="page-visibility" options={text.pageVisibilityOptions} value={settings.pageVisibility}
      onChange={pageVisibility => set({ pageVisibility })} disabled={busy} />
    <Radios legend={text.nameDisplay} name="name-display" options={text.nameDisplayOptions} value={settings.nameDisplay}
      onChange={nameDisplay => set({ nameDisplay })} disabled={busy} help={text.nameDisplayHelp} />
    <Radios legend={text.statsVisibility} name="stats-visibility" options={text.statsVisibilityOptions} value={settings.statsVisibility}
      onChange={statsVisibility => set({ statsVisibility })} disabled={busy} />
    <Radios legend={text.pointsMode} name="points-mode" options={text.pointsModeOptions} value={settings.pointsMode}
      onChange={pointsMode => set({ pointsMode })} disabled={busy} />
    <Field label={text.templateRace}><select value={settings.templateRaceId ?? ""} disabled={busy}
      onChange={event => set({ templateRaceId: event.target.value || null })}>
      <option value="">{text.templateNone}</option>
      {view.sessions.map(session => <option key={session.raceId} value={session.raceId}>{session.raceDate} · {session.eventName}</option>)}
    </select></Field>
    <Button type="submit" disabled={busy || !settings.name.trim()}>{text.saveSettings}</Button>
    {problem && <Notice tone="error" role="alert">{problem}</Notice>}
  </form>;
}
