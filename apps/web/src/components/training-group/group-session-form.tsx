"use client";

import { useState, type FormEvent } from "react";
import { trainingGroupEn } from "../../i18n/training-group-en";
import { useTexts } from "../language-provider";
import type { GroupLeaderView, MapAgreementIssueCode } from "@o-tid/contracts";
import { mapAgreementIssues } from "@o-tid/domain";
import { trainingGroupSv } from "../../i18n/training-group-sv";
import { groupFailure, groupRequest, repetitionCount, weekdayOf } from "../../lib/training-group-client";
import { Button, DateInput, Field, Notice } from "../ui";
import { isIsoDate } from "../../lib/form-validation";
import { MapAgreementSummary } from "./map-agreement";
import styles from "./training-group.module.css";

type Source = "TEMPLATE" | "PREVIOUS" | "RACE";

/**
 * Steg 68 (ADR-0182 beslut 3–4): ny träning ur gruppens mall, förra tillfället eller ett valt tillfälle, med en karta ur
 * biblioteket (avtalet visas där kartan väljs) och valfri upprepning varje vecka. Säger servern till om kartans avtal
 * visas varningen med "Skapa ändå".
 */
export function GroupSessionForm({ view, onCreated }: { view: GroupLeaderView; onCreated: (message: string) => void }) {
  const trainingGroupText = useTexts(trainingGroupSv, trainingGroupEn);
  const text = useTexts(trainingGroupSv.leader, trainingGroupEn.leader);
  // Användartestet 2026-11-12 (F): utan mall och tidigare tillfälle finns inget att utgå från; träningen blir tom och
  // publiceras inte som förval (ledaren lägger banor och klasser först).
  const first = !view.settings.templateRaceId && view.sessions.length === 0;
  const [source, setSource] = useState<Source>(view.settings.templateRaceId ? "TEMPLATE" : "PREVIOUS");
  const [sourceRaceId, setSourceRaceId] = useState(view.sessions.at(-1)?.raceId ?? "");
  const [eventName, setEventName] = useState(view.settings.name);
  const [raceDate, setRaceDate] = useState(view.today);
  const [startTime, setStartTime] = useState("18:00");
  const [mapId, setMapId] = useState("");
  const [includeCourseSetting, setIncludeCourseSetting] = useState(false);
  const [publish, setPublish] = useState(!first);
  const [repeat, setRepeat] = useState(false);
  const [lastDate, setLastDate] = useState("");
  const [requestId, setRequestId] = useState(() => crypto.randomUUID());
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState("");
  const [agreementIssues, setAgreementIssues] = useState<MapAgreementIssueCode[]>();

  const changed = <T,>(set: (value: T) => void) => (value: T) => { set(value); setRequestId(crypto.randomUUID()); setAgreementIssues(undefined); };
  const map = view.maps.find(row => row.mapId === mapId);
  const lastUse = repeat && lastDate ? lastDate : raceDate;
  const issues = map ? mapAgreementIssues(map, { date: lastUse, publicUse: publish }) : [];
  // ADR-0188: datumen skrivs som ÅÅÅÅ-MM-DD (samma fält som Skapa tävling); ogiltiga räknas inte.
  const datesValid = isIsoDate(raceDate) && (!repeat || isIsoDate(lastDate));
  const count = repeat && datesValid ? repetitionCount(raceDate, lastDate) : 1;

  async function submit(event: FormEvent, acknowledgeAgreement = false) {
    event.preventDefault();
    if (eventName.trim().length < 2 || !datesValid || (startTime !== "" && !/^([01]\d|2[0-3]):[0-5]\d$/.test(startTime)) || (repeat && count < 1)) {
      setProblem(text.errors.invalid); return;
    }
    setBusy(true); setProblem("");
    try {
      const result = await groupRequest(`/api/organizer/groups/${view.groupId}/sessions`, "POST", { formatVersion: 1, requestId, source,
        sourceRaceId: source === "RACE" ? sourceRaceId || null : null, eventName: eventName.trim(), raceDate, startTime: startTime || null,
        mapId: mapId || null, includeCourseSetting: includeCourseSetting && !!map?.courseSetting, publish,
        repeat: repeat ? { weekday: weekdayOf(raceDate), lastDate } : null, acknowledgeAgreement });
      const body = result.json as { error?: string; issues?: MapAgreementIssueCode[]; raceIds?: string[] } | undefined;
      if (result.status === 409 && body?.error === "MAP_AGREEMENT") { setAgreementIssues(body.issues ?? []); return; }
      if (result.status !== 201 && result.status !== 200) { setProblem(groupFailure(result.status, trainingGroupText.leader.errors)); return; }
      setRequestId(crypto.randomUUID()); setAgreementIssues(undefined);
      onCreated(text.created(body?.raceIds?.length ?? 1));
    } finally { setBusy(false); }
  }

  return <form className={styles.form} noValidate onSubmit={event => void submit(event)} aria-label={text.sections.new}>
    {first ? <Notice role="status">{text.firstSession}</Notice> : <p className={styles.muted}>{text.newHint}</p>}
    {!first && <fieldset className={styles.choice}>
      <legend>{text.source}</legend>
      {(["TEMPLATE", "PREVIOUS", "RACE"] as const).filter(option => option !== "TEMPLATE" || view.settings.templateRaceId).map(option =>
        <label key={option} className={styles.check}><input type="radio" name="session-source" checked={source === option} disabled={busy}
          onChange={() => changed(setSource)(option)} />{text.sources[option]}</label>)}
    </fieldset>}
    {source === "RACE" && <Field label={text.sourceRace}><select value={sourceRaceId} disabled={busy}
      onChange={event => changed(setSourceRaceId)(event.target.value)}>
      {view.sessions.map(session => <option key={session.raceId} value={session.raceId}>{session.raceDate} · {session.eventName}</option>)}
    </select></Field>}
    <Field label={text.eventName}><input value={eventName} maxLength={160} disabled={busy} onChange={event => changed(setEventName)(event.target.value)} /></Field>
    <div className={styles.inline}>
      <Field label={text.date}><DateInput value={raceDate} disabled={busy} onChange={event => changed(setRaceDate)(event.target.value)} /></Field>
      <Field label={text.time}><input type="text" inputMode="numeric" autoComplete="off" placeholder="TT:MM" maxLength={5} value={startTime}
        disabled={busy} onChange={event => changed(setStartTime)(event.target.value)} /></Field>
    </div>
    <Field label={text.map}><select value={mapId} disabled={busy} onChange={event => changed(setMapId)(event.target.value)}>
      <option value="">{text.mapFromSource}</option>
      {view.maps.map(row => <option key={row.mapId} value={row.mapId}>{row.name}</option>)}
    </select></Field>
    {map && <MapAgreementSummary agreement={map} issues={issues} title={text.agreementTitle} />}
    {map?.courseSetting && <label className={styles.check}><input type="checkbox" checked={includeCourseSetting} disabled={busy}
      onChange={event => changed(setIncludeCourseSetting)(event.target.checked)} />{text.withCourseSetting}</label>}
    <label className={styles.check}><input type="checkbox" checked={publish} disabled={busy}
      onChange={event => changed(setPublish)(event.target.checked)} />{text.publish}</label>
    <label className={styles.check}><input type="checkbox" checked={repeat} disabled={busy}
      onChange={event => changed(setRepeat)(event.target.checked)} />{text.repeat}</label>
    {repeat && <Field label={text.repeatUntil} help={isIsoDate(raceDate) ? text.repeatHelp(text.weekdays[weekdayOf(raceDate) - 1] ?? "") : undefined}>
      <DateInput value={lastDate} disabled={busy} onChange={event => changed(setLastDate)(event.target.value)} /></Field>}
    {agreementIssues && <div role="alert">
      <Notice tone="attention">{text.agreementStop}</Notice>
      {map && <MapAgreementSummary agreement={map} issues={agreementIssues} />}
      {!map && <ul className={styles.issues}>{agreementIssues.map(issue => <li key={issue}>{trainingGroupText.agreement.issues[issue]}</li>)}</ul>}
      <Button variant="secondary" disabled={busy} onClick={event => void submit(event, true)}>{text.createAnyway}</Button>
    </div>}
    <Button type="submit" disabled={busy || (repeat && count < 1)} aria-busy={busy}>{repeat ? text.createRepeat(Math.max(count, 0)) : text.create}</Button>
    {problem && <Notice tone="error" role="alert">{problem}</Notice>}
  </form>;
}
