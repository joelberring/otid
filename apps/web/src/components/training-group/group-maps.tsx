"use client";

import Link from "next/link";
import { trainingGroupEn } from "../../i18n/training-group-en";
import { useTexts } from "../language-provider";
import { useState, type FormEvent } from "react";
import type { GroupLeaderView, GroupLibraryMap, MapAgreement } from "@o-tid/contracts";
import { trainingGroupSv } from "../../i18n/training-group-sv";
import { groupFailure, groupRequest } from "../../lib/training-group-client";
import { Button, Field, Notice } from "../ui";
import { MapAgreementFields, MapAgreementSummary, emptyAgreement } from "./map-agreement";
import styles from "./training-group.module.css";


const agreementOf = (map: GroupLibraryMap): MapAgreement => ({ ownership: map.ownership, ownerKind: map.ownerKind, ownerName: map.ownerName,
  agreement: map.agreement, validUntil: map.validUntil, contact: map.contact, trainingOnly: map.trainingOnly, feePerPrint: map.feePerPrint,
  noPublicDisplay: map.noPublicDisplay });

/**
 * Steg 68 (ADR-0182 beslut 4): gruppens kartbibliotek. En karta sparas från ett tillfälle (bilden, kartfilen och om man vill
 * banläggningen kopieras) med sina rättigheter; avtalet kan ändras och gäller då också tillfällena som valt kartan.
 */
export function GroupMaps({ view, onChanged }: { view: GroupLeaderView; onChanged: (message: string) => void }) {
  const trainingGroupText = useTexts(trainingGroupSv, trainingGroupEn);
  const text = useTexts(trainingGroupSv.leader, trainingGroupEn.leader);
  const [editing, setEditing] = useState<string>();
  const [draft, setDraft] = useState<MapAgreement>(emptyAgreement);
  const [draftName, setDraftName] = useState("");
  const [raceId, setRaceId] = useState(view.sessions.at(-1)?.raceId ?? "");
  const [name, setName] = useState("");
  const [includeCourseSetting, setIncludeCourseSetting] = useState(true);
  const [agreement, setAgreement] = useState<MapAgreement>(emptyAgreement);
  const [requestId, setRequestId] = useState(() => crypto.randomUUID());
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState("");

  async function save(event: FormEvent) {
    event.preventDefault();
    setBusy(true); setProblem("");
    try {
      const result = await groupRequest(`/api/organizer/groups/${view.groupId}/maps`, "POST", { formatVersion: 1, requestId, raceId,
        name: name.trim(), includeCourseSetting, agreement });
      if (result.status !== 201 && result.status !== 200) { setProblem(groupFailure(result.status, trainingGroupText.leader.errors)); return; }
      setName(""); setAgreement(emptyAgreement); setRequestId(crypto.randomUUID());
      onChanged(text.saved);
    } finally { setBusy(false); }
  }

  async function update(event: FormEvent, mapId: string) {
    event.preventDefault();
    setBusy(true); setProblem("");
    try {
      const result = await groupRequest(`/api/organizer/groups/${view.groupId}/maps/${mapId}`, "PUT", { formatVersion: 1, name: draftName.trim(),
        agreement: draft });
      if (result.status !== 200) { setProblem(groupFailure(result.status, trainingGroupText.leader.errors)); return; }
      setEditing(undefined);
      onChanged(text.mapUpdated((result.json as { races: number }).races));
    } finally { setBusy(false); }
  }

  async function remove(mapId: string) {
    if (!window.confirm(text.deleteMapConfirm)) return;
    setBusy(true); setProblem("");
    try {
      const result = await groupRequest(`/api/organizer/groups/${view.groupId}/maps/${mapId}`, "DELETE");
      if (result.status !== 200) { setProblem(groupFailure(result.status, trainingGroupText.leader.errors)); return; }
      onChanged(text.saved);
    } finally { setBusy(false); }
  }

  return <>
    <p className={styles.muted}>{text.mapsHint}</p>
    {view.maps.length === 0 && <p className={styles.muted}>{text.noMaps}</p>}
    <ul className={styles.plainList} aria-label={text.sections.maps}>
      {view.maps.map(map => <li key={map.mapId} style={{ display: "grid" }}>
        <div><strong>{map.name}</strong><span>{[map.source ? `${map.source.fileName} · 1:${map.source.scale}` : map.fileName,
          map.courseSetting ? text.withCourseSetting : ""].filter(Boolean).join(" · ")}</span>
          {map.clubMap && <span>{text.fromClub(map.clubMap.clubName)}{map.clubMap.latest ? "" : " · "}
            {!map.clubMap.latest && <Link href={`/organizer/clubs/${map.clubMap.clubId}#maps`}>{text.newerInClub}</Link>}</span>}</div>
        {editing !== map.mapId && <MapAgreementSummary agreement={map} />}
        {editing !== map.mapId && <div className={styles.rowActions}>
          <Button variant="secondary" disabled={busy} onClick={() => { setEditing(map.mapId); setDraft(agreementOf(map)); setDraftName(map.name); }}>
            {text.editAgreement}</Button>
          <Button variant="quiet" disabled={busy} onClick={() => void remove(map.mapId)}>{text.deleteMap}</Button>
        </div>}
        {editing === map.mapId && <form className={styles.form} noValidate onSubmit={event => void update(event, map.mapId)}>
          <Field label={text.mapName}><input value={draftName} maxLength={120} disabled={busy} onChange={event => setDraftName(event.target.value)} /></Field>
          <MapAgreementFields value={draft} onChange={setDraft} disabled={busy} />
          <div className={styles.rowActions}>
            <Button type="submit" disabled={busy || !draftName.trim()}>{text.saveAgreement}</Button>
            <Button variant="quiet" disabled={busy} onClick={() => setEditing(undefined)}>{text.cancel}</Button>
          </div>
        </form>}
      </li>)}
    </ul>
    {view.sessions.length > 0 && <details>
      <summary className={styles.check}>{text.saveMap}</summary>
      <form className={styles.form} noValidate onSubmit={event => void save(event)}>
        <Field label={text.saveMapFrom}><select value={raceId} disabled={busy} onChange={event => { setRaceId(event.target.value); setRequestId(crypto.randomUUID()); }}>
          {view.sessions.map(session => <option key={session.raceId} value={session.raceId}>{session.raceDate} · {session.eventName}</option>)}
        </select></Field>
        <Field label={text.mapName}><input value={name} maxLength={120} disabled={busy}
          onChange={event => { setName(event.target.value); setRequestId(crypto.randomUUID()); }} /></Field>
        <label className={styles.check}><input type="checkbox" checked={includeCourseSetting} disabled={busy}
          onChange={event => setIncludeCourseSetting(event.target.checked)} />{text.withCourseSetting}</label>
        <MapAgreementFields value={agreement} onChange={value => { setAgreement(value); setRequestId(crypto.randomUUID()); }} disabled={busy} />
        <Button type="submit" disabled={busy || !name.trim() || !raceId}>{text.saveMapButton}</Button>
      </form>
    </details>}
    {problem && <Notice tone="error" role="alert">{problem}</Notice>}
  </>;
}
